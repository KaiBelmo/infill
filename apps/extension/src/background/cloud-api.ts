import {
  AccountInfoSchema,
  AuthSessionEnvelopeSchema,
  CloudProfileListResponseSchema,
  CloudProfileUpsertResponseSchema,
  EncryptedProfileSyncListResponseSchema,
  type CloudProfile,
  type EncryptedCloudProfileEnvelope
} from "@infill/shared";
import ky, { HTTPError } from "ky";
import { useCloudStore } from "./cloud-store";
import { getActivePrivateSyncAttemptId, recordPrivateSyncDebug } from "./private-sync-debug";
import type { CloudAuthState, CloudConfig, CloudState } from "@/shared/types";

export function getCloudState(): CloudState {
  return useCloudStore.getState().getCloudState();
}

export function saveCloudConfig(input: Partial<CloudConfig>): CloudState {
  return useCloudStore.getState().saveConfig(input);
}

let refreshPromise: Promise<CloudState> | null = null;

function createCloudApi() {
  return ky.create({
    hooks: {
      beforeRequest: [
        ({ request }) => {
          const state = getCloudState();
          const requestId = crypto.randomUUID();
          request.headers.set("x-infill-debug-request-id", requestId);
          const syncAttemptId = getActivePrivateSyncAttemptId();
          if (syncAttemptId) {
            request.headers.set("x-infill-sync-attempt-id", syncAttemptId);
          }
          if (state.auth?.sessionToken) {
            request.headers.set("authorization", `Bearer ${state.auth.sessionToken}`);
          }
          void logCloudRequestStart(request, requestId, Boolean(state.auth?.sessionToken), syncAttemptId);
        },
      ],
      afterResponse: [
        async ({ request, response }) => {
          await logCloudResponse(request, response);
          if (response.status !== 401) return response;
          const errorCode = await readApiErrorCode(response);
          if (isRevokedSessionCode(errorCode)) {
            useCloudStore.getState().clearAuth();
            return response;
          }

          // Token may be expired — try refreshing once (coalesce concurrent refreshes)
          if (!refreshPromise) {
            refreshPromise = refreshCloudSession().finally(() => { refreshPromise = null; });
          }

          try {
            const refreshed = await refreshPromise;
            if (!refreshed.auth?.sessionToken) return response;

            const headers = new Headers(request.headers);
            headers.set("authorization", `Bearer ${refreshed.auth.sessionToken}`);
            return ky.retry({ request: new Request(request, { headers }) });
          } catch {
            return response;
          }
        },
      ],
      beforeError: [
        async ({ error }) => {
          if (!(error instanceof HTTPError)) return error;

          const data = await readApiErrorPayload(error.response);
          const requestId = error.request.headers.get("x-infill-debug-request-id") ?? "";
          let errorMessage = "Cloud request failed.";
          if (
            data &&
            typeof data === "object" &&
            "error" in data
          ) {
            const apiError = (data as { error?: { message?: string; code?: string } }).error;
            const msg = apiError?.message;
            if (msg) errorMessage = String(msg);
            if (apiError?.code && isRevokedSessionCode(apiError.code)) {
              useCloudStore.getState().clearAuth();
              errorMessage = "This cloud session was revoked. Connect Infill again to continue.";
            }
          } else if (
            data &&
            typeof data === "object" &&
            "text" in data &&
            typeof (data as { text?: unknown }).text === "string" &&
            (data as { text: string }).text.trim()
          ) {
            errorMessage = (data as { text: string }).text.trim();
          }
          console.error("[cloud-api] request failed", {
            requestId,
            method: error.request.method,
            path: safePath(error.request.url),
            status: error.response.status,
            apiError: extractApiError(data)
          });
          await recordPrivateSyncDebug("cloud-request-failed", {
            requestId,
            method: error.request.method,
            path: safePath(error.request.url),
            status: error.response.status,
            apiError: extractApiError(data)
          }, error.request.headers.get("x-infill-sync-attempt-id") ?? undefined);
          error.message = errorMessage;
          return error;
        },
      ],
    },
    retry: { limit: 0 },
  });
}

async function logCloudRequestStart(request: Request, requestId: string, signedIn: boolean, syncAttemptId?: string): Promise<void> {
  const details = {
    requestId,
    method: request.method,
    path: safePath(request.url),
    signedIn
  };
  console.log("[cloud-api] request start", details);
  if (syncAttemptId) {
    await recordPrivateSyncDebug("cloud-request-start", details, syncAttemptId);
  }
}

async function logCloudResponse(request: Request, response: Response): Promise<void> {
  const syncAttemptId = request.headers.get("x-infill-sync-attempt-id") ?? undefined;
  if (response.ok) {
    const details = {
      requestId: request.headers.get("x-infill-debug-request-id") ?? "",
      method: request.method,
      path: safePath(request.url),
      status: response.status
    };
    console.log("[cloud-api] response ok", details);
    if (syncAttemptId) {
      await recordPrivateSyncDebug("cloud-response-ok", details, syncAttemptId);
    }
    return;
  }

  const payload = await readApiErrorPayload(response);
  const details = {
    requestId: request.headers.get("x-infill-debug-request-id") ?? "",
    method: request.method,
    path: safePath(request.url),
    status: response.status,
    apiError: extractApiError(payload)
  };
  console.warn("[cloud-api] response error", details);
  if (syncAttemptId) {
    await recordPrivateSyncDebug("cloud-response-error", details, syncAttemptId);
  }
}

async function readApiErrorPayload(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    try {
      const text = await response.clone().text();
      return text ? { text: text.slice(0, 500) } : undefined;
    } catch {
      return undefined;
    }
  }
}

function extractApiError(data: unknown): unknown {
  if (!data || typeof data !== "object" || !("error" in data)) return data;
  const error = (data as { error?: unknown }).error;
  if (!error || typeof error !== "object") return error;
  const input = error as { code?: unknown; message?: unknown; status?: unknown };
  return {
    code: typeof input.code === "string" ? input.code : undefined,
    message: typeof input.message === "string" ? input.message : undefined,
    status: typeof input.status === "number" ? input.status : undefined
  };
}

function safePath(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}

async function readApiErrorCode(response: Response): Promise<string | undefined> {
  try {
    const data = await response.clone().json() as { error?: { code?: string } };
    return data.error?.code;
  } catch {
    return undefined;
  }
}

function isRevokedSessionCode(code: string | undefined): boolean {
  return code === "revoked_device" || code === "invalid_session" || code === "expired_session";
}

export const cloudApi = createCloudApi();

export async function refreshCloudSession(): Promise<CloudState> {
  const state = getCloudState();
  if (!state.auth?.refreshToken) {
    throw new Error("No refresh token is stored.");
  }

  const payload = AuthSessionEnvelopeSchema.parse(
    await cloudApi.post(`${state.config.apiBaseUrl}/v1/auth/refresh`, {
      json: { refreshToken: state.auth.refreshToken },
    }).json()
  );
  const auth = normalizeAuth(payload);
  useCloudStore.getState().persistAuth(auth);
  return useCloudStore.getState().getCloudState();
}

export async function logoutCloudSession(): Promise<void> {
  const state = getCloudState();
  if (state.auth?.sessionToken) {
    await cloudApi.post(`${state.config.apiBaseUrl}/v1/auth/logout`).catch(() => undefined);
  }

  useCloudStore.getState().clearAuth();
}

export async function syncCloudSession(): Promise<CloudState> {
  const state = getCloudState();
  if (!state.auth?.sessionToken) {
    return state;
  }

  const account = AccountInfoSchema.parse(
    await cloudApi.get(`${state.config.apiBaseUrl}/v1/me`).json()
  );
  const auth: CloudAuthState = {
    ...state.auth,
    user: account.user,
    account,
    updatedAt: new Date().toISOString()
  };
  useCloudStore.getState().persistAuth(auth);
  return useCloudStore.getState().getCloudState();
}

export async function listEncryptedCloudProfiles(): Promise<EncryptedCloudProfileEnvelope[]> {
  const state = getCloudState();
  if (!state.auth?.sessionToken) {
    throw new Error("Sign in before loading cloud profiles.");
  }
  const payload = EncryptedProfileSyncListResponseSchema.parse(
    await cloudApi.get(`${state.config.apiBaseUrl}/v1/profiles/encrypted`).json()
  );
  console.log("[profile-sync] encrypted cloud profiles fetched", { count: payload.envelopes.length });
  return payload.envelopes;
}

export async function listCloudProfiles(): Promise<CloudProfile[]> {
  const state = getCloudState();
  if (!state.auth?.sessionToken) {
    throw new Error("Sign in before loading cloud profile metadata.");
  }
  const payload = CloudProfileListResponseSchema.parse(
    await cloudApi.get(`${state.config.apiBaseUrl}/v1/profiles`).json()
  );
  return payload.profiles;
}

export async function saveCloudProfileMetadata(profiles: CloudProfile[]): Promise<CloudProfile[]> {
  const state = getCloudState();
  if (!state.auth?.sessionToken) {
    throw new Error("Sign in before saving cloud profile metadata.");
  }
  const metadataOnly = profiles.map((profile) => ({ ...profile, facts: [] }));
  const payload = CloudProfileUpsertResponseSchema.parse(
    await cloudApi.post(`${state.config.apiBaseUrl}/v1/profiles`, {
      json: { profiles: metadataOnly }
    }).json()
  );
  return payload.profiles;
}

export async function saveEncryptedCloudProfiles(envelopes: EncryptedCloudProfileEnvelope[]): Promise<EncryptedCloudProfileEnvelope[]> {
  const state = getCloudState();
  if (!state.auth?.sessionToken) {
    throw new Error("Sign in before saving cloud profiles.");
  }
  const payload = EncryptedProfileSyncListResponseSchema.parse(
    await cloudApi.post(`${state.config.apiBaseUrl}/v1/profiles/encrypted`, {
      json: { envelopes }
    }).json()
  );
  console.log("[profile-sync] encrypted sync persisted to cloud", { count: payload.envelopes.length });
  return payload.envelopes;
}

export async function deleteCloudProfile(profileId: string): Promise<void> {
  const state = getCloudState();
  if (!state.auth?.sessionToken) {
    throw new Error("Sign in before deleting cloud profiles.");
  }
  await cloudApi.delete(`${state.config.apiBaseUrl}/v1/profiles/${encodeURIComponent(profileId)}`);
}

export function normalizeAuth(value: unknown): CloudAuthState {
  const parsed = AuthSessionEnvelopeSchema.parse(value);
  return {
    user: parsed.user,
    session: parsed.session,
    account: parsed.account,
    sessionToken: parsed.sessionToken,
    refreshToken: parsed.refreshToken,
    updatedAt: new Date().toISOString()
  };
}

export function persistAuth(auth: CloudAuthState): void {
  useCloudStore.getState().persistAuth(auth);
}

export function requireApiBaseUrl(value: string): void {
  if (!value) {
    throw new Error("Set the cloud API base URL in settings before connecting.");
  }
}

export function messageFromUnknownError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}
