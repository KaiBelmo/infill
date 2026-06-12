import {
  CloudAssistRequestSchema,
  CloudAssistResponseSchema,
  CloudKeyMatchRequestSchema,
  CloudKeyMatchResponseSchema,
  ParseProfileRequestSchema,
  ParseProfileResponseSchema,
  type CloudAssistRequest,
  type CloudAssistResponse,
  type CloudKeyMatchRequest,
  type CloudKeyMatchResponse,
  type ParseProfileRequest,
  type ParseProfileResponse
} from "@infill/shared";
import { useCloudStore } from "./cloud-store";
import { cloudApi, getCloudState, requireApiBaseUrl } from "./cloud-api";
import { backgroundSnaplog } from "./snaplog";

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

export async function runCloudKeyMatch(request: CloudKeyMatchRequest): Promise<CloudKeyMatchResponse> {
  const state = getCloudState();
  requireApiBaseUrl(state.config.apiBaseUrl);
  if (!state.config.cloudAssistEnabled) {
    throw new Error("Cloud assist is disabled in extension settings.");
  }
  if (!state.auth?.sessionToken) {
    throw new Error("No cloud session is connected.");
  }

  const payload = CloudKeyMatchRequestSchema.parse(request);
  backgroundSnaplog.injectLog({
    event: "key_match_request",
    apiBaseUrl: state.config.apiBaseUrl,
    cloudAssistEnabled: state.config.cloudAssistEnabled,
    hasSessionToken: Boolean(state.auth?.sessionToken),
    promptLength: payload.prompt.length,
    promptTargetCount: (payload.prompt.match(/"targetKey":/g) ?? []).length,
    promptFactCount: (payload.prompt.match(/"key":/g) ?? []).length
  }, { source: "background/cloud-key-match" });
  const result = CloudKeyMatchResponseSchema.parse(
    await cloudApi.post(`${state.config.apiBaseUrl}/v1/assist/key-match`, {
      json: payload,
    }).json()
  );
  backgroundSnaplog.injectLog({
    event: "key_match_response",
    source: result.source,
    warningCount: result.warnings.length,
    rawResponseLength: result.rawResponseText.length,
    rawResponsePreview: result.rawResponseText.slice(0, 200),
    creditsRemaining: result.credits.remaining
  }, { source: "background/cloud-key-match" });
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
  backgroundSnaplog.injectLog({
    event: "parse_profile_request",
    apiBaseUrl: state.config.apiBaseUrl,
    cloudAssistEnabled: state.config.cloudAssistEnabled,
    hasSessionToken: Boolean(state.auth?.sessionToken),
    plan: state.auth?.account.subscription.plan,
    subscriptionStatus: state.auth?.account.subscription.status,
    rawTextLength: payload.rawText.length,
    rawLineCount: payload.rawText.split(/\r?\n/).filter((line) => line.trim()).length,
    locale: payload.locale
  }, { source: "background/cloud-parse-profile" });
  const result = ParseProfileResponseSchema.parse(
    await cloudApi.post(`${state.config.apiBaseUrl}/v1/assist/parse-profile`, {
      json: payload,
    }).json()
  );
  backgroundSnaplog.injectLog({
    event: "parse_profile_response",
    source: result.source,
    attemptedCloudCall: result.attemptedCloudCall,
    fieldCount: result.fields.length,
    fieldKeys: result.fields.map((field) => field.key),
    warnings: result.warnings,
    creditsRemaining: result.credits.remaining
  }, { source: "background/cloud-parse-profile" });
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
