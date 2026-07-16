import { normalizeAuth, persistAuth, getCloudState } from "./cloud";
import { prepareProfileSyncAfterAuth } from "./profile-sync";
import type { CloudState } from "@/shared/types";

const LOCAL_CLOUD_STATE_KEY = "infillCloudState";
const AUTH_STATE_KEY = "infillAuthState";
const AUTH_CODE_VERIFIER_KEY = "infillAuthCodeVerifier";
const AUTH_ERROR_KEY = "infillAuthError";

export async function startAuthFlow(): Promise<void> {
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);

  await chrome.storage.session.set({
    [AUTH_STATE_KEY]: state,
    [AUTH_CODE_VERIFIER_KEY]: codeVerifier,
  });

  const cloudState = await getCloudStateWithPersistedConfig();
  const webBaseUrl = cloudState.config.webBaseUrl;

  if (!webBaseUrl) {
    throw new Error("Set the cloud web base URL in settings before signing in.");
  }

  const extensionCallbackUrl = `${webBaseUrl.replace(/\/$/, "")}${__VITE_EXTENSION_REDIRECT_PATH__}`;
  const authPath = "/account";

  const authUrl = new URL(authPath, webBaseUrl);
  authUrl.searchParams.set("returnTo", extensionCallbackUrl);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("client", "browser-extension");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  await chrome.tabs.create({
    url: authUrl.toString(),
    active: true,
  });
}

export async function handlePossibleAuthCallback(tabId: number, rawUrl: string): Promise<void> {
  const cloudState = await getCloudStateWithPersistedConfig();
  const webBaseUrl = cloudState.config.webBaseUrl;
  if (!webBaseUrl) return;

  const extensionCallbackUrl = `${webBaseUrl.replace(/\/$/, "")}${__VITE_EXTENSION_REDIRECT_PATH__}`;
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  if (url.origin + url.pathname !== new URL(extensionCallbackUrl).origin + new URL(extensionCallbackUrl).pathname) {
    return;
  }

  let shouldClearTemporaryAuthState = false;

  try {
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    shouldClearTemporaryAuthState = true;

    if (error) {
      const errorDescription = url.searchParams.get("error_description") ?? error;
      throw new Error(errorDescription);
    }

    if (!code) {
      throw new Error("Missing authorization code in callback.");
    }

    const stored = await chrome.storage.session.get([AUTH_STATE_KEY, AUTH_CODE_VERIFIER_KEY]);

    if (!stored[AUTH_STATE_KEY] || !stored[AUTH_CODE_VERIFIER_KEY]) {
      throw new Error("Missing temporary auth state. Try signing in again.");
    }

    if (returnedState !== stored[AUTH_STATE_KEY]) {
      throw new Error("Auth state mismatch. This may be a CSRF attempt.");
    }

    const apiBaseUrl = cloudState.config.apiBaseUrl;
    if (!apiBaseUrl) {
      throw new Error("Set the cloud API base URL in settings before completing sign-in.");
    }

    const exchangeUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/extension/auth/exchange`;

    const response = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        state: returnedState,
        code_verifier: stored[AUTH_CODE_VERIFIER_KEY],
        client: "browser-extension",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const message =
        typeof errorBody === "object" && errorBody !== null && "error" in errorBody
          ? String((errorBody as { error?: { message?: string } }).error?.message ?? "Token exchange failed.")
          : "Token exchange failed.";
      throw new Error(message);
    }

    const rawSession = await response.json();
    const auth = normalizeAuth(rawSession);
    await persistAuth(auth);
    await prepareProfileSyncAfterAuth();

    await openOptionsProfile(tabId);
  } catch (error) {
    console.error("[auth] OAuth callback failed:", error);
    const message = error instanceof Error ? error.message : "Sign-in failed. Try again.";
    await chrome.storage.session.set({ [AUTH_ERROR_KEY]: message });
    await openOptionsProfile(tabId);
  } finally {
    if (shouldClearTemporaryAuthState) {
      await chrome.storage.session.remove([AUTH_STATE_KEY, AUTH_CODE_VERIFIER_KEY]);
    }
  }
}

async function openOptionsProfile(tabId: number): Promise<void> {
  const url = chrome.runtime.getURL("src/options/index.html#/sync");
  if (tabId === chrome.tabs.TAB_ID_NONE) {
    await chrome.tabs.create({ url, active: true });
    return;
  }

  await chrome.tabs.update(tabId, { url });
}

async function getCloudStateWithPersistedConfig(): Promise<CloudState> {
  const cloudState = getCloudState();
  if (cloudState.config.webBaseUrl && cloudState.config.apiBaseUrl) {
    return cloudState;
  }

  const local = await chrome.storage.local.get(LOCAL_CLOUD_STATE_KEY);
  const persisted = local[LOCAL_CLOUD_STATE_KEY];
  const persistedState = persisted && typeof persisted === "object" && "state" in persisted
    ? (persisted as { state?: Partial<CloudState> }).state
    : undefined;

  return {
    ...cloudState,
    config: {
      ...cloudState.config,
      ...persistedState?.config,
      webBaseUrl: (cloudState.config.webBaseUrl || persistedState?.config?.webBaseUrl || __VITE_WEB_BASE_URL__).trim().replace(/\/$/, ""),
      apiBaseUrl: (cloudState.config.apiBaseUrl || persistedState?.config?.apiBaseUrl || __VITE_API_BASE_URL__).trim().replace(/\/$/, "")
    }
  };
}
function generateCodeVerifier(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return base64UrlEncode(randomBytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
