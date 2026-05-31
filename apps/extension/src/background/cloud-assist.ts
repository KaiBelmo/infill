import {
  CloudAssistRequestSchema,
  CloudAssistResponseSchema,
  ParseProfileRequestSchema,
  ParseProfileResponseSchema,
  type CloudAssistRequest,
  type CloudAssistResponse,
  type ParseProfileRequest,
  type ParseProfileResponse
} from "@infill/shared";
import { useCloudStore } from "./cloud-store";
import { cloudApi, getCloudState, requireApiBaseUrl } from "./cloud-api";

export async function runCloudAssist(request: CloudAssistRequest): Promise<CloudAssistResponse> {
  const state = getCloudState();
  requireApiBaseUrl(state.config.apiBaseUrl);
  if (!state.config.cloudAssistEnabled) {
    throw new Error("Cloud assist is disabled in extension settings.");
  }
  if (!state.auth?.sessionToken) {
    throw new Error("No cloud session is connected.");
  }

  const payload = CloudAssistRequestSchema.parse(request);
  const assisted = CloudAssistResponseSchema.parse(
    await cloudApi.post(`${state.config.apiBaseUrl}/v1/assist/mappings`, {
      json: payload,
    }).json()
  );
  useCloudStore.getState().persistAuth({
    ...state.auth,
    account: {
      ...state.auth.account,
      credits: {
        monthlyLimit: assisted.credits.monthlyLimit,
        usedThisPeriod: assisted.credits.usedThisPeriod,
        remaining: assisted.credits.remaining,
        resetAt: assisted.credits.resetAt ?? null
      }
    },
    updatedAt: new Date().toISOString()
  });
  return assisted;
}

export async function runCloudParseProfile(request: ParseProfileRequest): Promise<ParseProfileResponse> {
  const state = getCloudState();
  requireApiBaseUrl(state.config.apiBaseUrl);
  if (!state.config.cloudAssistEnabled) {
    throw new Error("Cloud assist is disabled in extension settings.");
  }
  if (!state.auth?.sessionToken) {
    throw new Error("No cloud session is connected.");
  }

  const payload = ParseProfileRequestSchema.parse(request);
  const result = ParseProfileResponseSchema.parse(
    await cloudApi.post(`${state.config.apiBaseUrl}/v1/assist/parse-profile`, {
      json: payload,
    }).json()
  );
  useCloudStore.getState().persistAuth({
    ...state.auth,
    account: {
      ...state.auth.account,
      credits: {
        monthlyLimit: result.credits.monthlyLimit,
        usedThisPeriod: result.credits.usedThisPeriod,
        remaining: result.credits.remaining,
        resetAt: result.credits.resetAt ?? null
      }
    },
    updatedAt: new Date().toISOString()
  });
  return result;
}
