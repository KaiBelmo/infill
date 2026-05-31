import type { DeviceInfo } from "@/shared/types";
import { cloudApi, getCloudState, requireApiBaseUrl } from "./cloud-api";

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

  return await cloudApi.post(`${state.config.apiBaseUrl}/v1/billing/checkouts`).json<{ checkoutUrl: string; billingMode: string }>();
}

export async function listDevices(): Promise<{ devices: DeviceInfo[] }> {
  const state = getCloudState();
  requireApiBaseUrl(state.config.apiBaseUrl);
  if (!state.auth?.sessionToken) {
    throw new Error("No cloud session is connected.");
  }

  return await cloudApi.get(`${state.config.apiBaseUrl}/v1/devices`).json<{ devices: DeviceInfo[] }>();
}
