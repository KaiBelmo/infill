import type { DeviceInfo } from "@/shared/types";
import { cloudApi, getCloudState, requireApiBaseUrl } from "./cloud-api";

type BillingPlansResponse = {
  billingMode?: "disabled" | "test" | "live";
};

export async function checkApiHealth(): Promise<{ ok: boolean; name?: string; version?: string }> {
  const state = getCloudState();
  requireApiBaseUrl(state.config.apiBaseUrl);

  const payload = await cloudApi.get(`${state.config.apiBaseUrl}/health`).json<{ status?: string; name?: string; version?: string }>();
  return { ok: payload.status === "ok", name: payload.name, version: payload.version };
}

export async function createBillingCheckout(): Promise<{ checkoutUrl: string; billingMode: string }> {
  const state = getCloudState();
  requireApiBaseUrl(state.config.apiBaseUrl);
  if (!state.auth?.sessionToken) {
    throw new Error("No cloud session is connected.");
  }

  const plans = await cloudApi.get(`${state.config.apiBaseUrl}/v1/plans`).json<BillingPlansResponse>();
  if (plans.billingMode === "disabled") {
    throw new Error("Billing is disabled for this environment.");
  }

  const response = await cloudApi.post(`${state.config.apiBaseUrl}/v1/billing/checkouts`, {
    throwHttpErrors: false
  });
  const payload = await response.json<CheckoutResponse | ApiErrorResponse>().catch(() => undefined);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(payload) ?? "Unable to create a billing checkout.");
  }
  if (!payload || !("checkoutUrl" in payload)) {
    throw new Error("No checkout URL returned from the billing service.");
  }

  return payload;
}

export async function listDevices(): Promise<{ devices: DeviceInfo[] }> {
  const state = getCloudState();
  requireApiBaseUrl(state.config.apiBaseUrl);
  if (!state.auth?.sessionToken) {
    throw new Error("No cloud session is connected.");
  }

  return await cloudApi.get(`${state.config.apiBaseUrl}/v1/devices`).json<{ devices: DeviceInfo[] }>();
}

type CheckoutResponse = { checkoutUrl: string; billingMode: string };
type ApiErrorResponse = { error?: { message?: unknown } };

function readApiErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return undefined;
  }
  const error = (payload as ApiErrorResponse).error;
  return typeof error?.message === "string" && error.message.trim() ? error.message : undefined;
}
