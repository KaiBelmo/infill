import { create } from "zustand";
import type { CloudState, DeviceInfo } from "@/shared/types";
import { useCloudStore } from "@/background/cloud-store";
import {
  createBillingCheckout,
  checkLocalOllama,
  getCloudState,
  listDevices,
  logoutCloudSession,
  refreshCloudSession,
  saveCloudConfig,
  startOAuthFlow,
  syncCloudSession
} from "@/cloudClient";

type CloudClientState = {
  cloudState: CloudState | null;
  isSignedIn: boolean;
  cloudPlan: string;
  canUseCloud: boolean;
  devices: DeviceInfo[];
  cloudMessage: string;
};

type CloudClientActions = {
  init: () => Promise<void>;
  setCloudState: (next: CloudState | null | ((prev: CloudState | null) => CloudState | null)) => void;
  startOAuth: () => Promise<void>;
  openBilling: () => boolean;
  toggleCloudAssist: (enabled: boolean) => Promise<string>;
  saveLocalOllamaConfig: (input: {
    localOllamaEnabled: boolean;
    ollamaBaseUrl: string;
    ollamaModel: string;
    localOllamaFallbackToCloud: boolean;
  }) => Promise<string>;
  detectLocalOllamaModels: (input: { baseUrl: string; model?: string }) => Promise<{
    clearModels?: boolean;
    message: string;
    models: string[];
    selectedModel?: string;
  }>;
  refreshSession: () => Promise<string>;
  disconnectCloud: () => Promise<string>;
  openCheckout: () => Promise<string>;
  loadDevices: () => Promise<void>;
  syncOnVisible: () => void;
  setCloudMessage: (message: string) => void;
};

let initPromise: Promise<void> | null = null;

export const useCloudClientStore = create<CloudClientState & CloudClientActions>()((set, get) => ({
  cloudState: null,
  isSignedIn: false,
  cloudPlan: "free",
  canUseCloud: false,
  devices: [],
  cloudMessage: "Cloud mode is optional and can stay off while local mode remains active.",

  async init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const state = await getCloudState();
        set(deriveCloudFlags(state));
        if (state.auth?.sessionToken) {
          try {
            const synced = await syncCloudSession();
            set(deriveCloudFlags(synced));
          } catch { /* non-critical */ }
        }
      } catch { /* non-critical */ }
    })();
    return initPromise;
  },

  setCloudState(next) {
    set((current) => {
      const resolved = typeof next === "function" ? next(current.cloudState) : next;
      return deriveCloudFlags(resolved);
    });
  },

  setCloudMessage(cloudMessage) {
    set({ cloudMessage: normalizeCloudMessage(cloudMessage) });
  },

  async startOAuth() {
    await startOAuthFlow();
  },

  openBilling() {
    const baseUrl = get().cloudState?.config.webBaseUrl;
    if (!baseUrl) return false;
    window.open(`${baseUrl.replace(/\/$/, "")}/billing`, "_blank", "noopener,noreferrer");
    return true;
  },

  async toggleCloudAssist(enabled) {
    try {
      const next = await saveCloudConfig({ cloudAssistEnabled: enabled });
      set(deriveCloudFlags(next));
      const msg = enabled ? "Cloud assist enabled." : "Cloud assist disabled. Local mode still works.";
      set({ cloudMessage: msg });
      return msg;
    } catch (error) {
      const msg = normalizeCloudMessage(error instanceof Error ? error.message : "Unable to update cloud assist.");
      set({ cloudMessage: msg });
      return msg;
    }
  },

  async saveLocalOllamaConfig(input) {
    try {
      if (input.localOllamaEnabled) {
        const health = await checkLocalOllama({ baseUrl: input.ollamaBaseUrl, model: input.ollamaModel });
        if (!health.ok) {
          const next = await saveCloudConfig({ ...input, localOllamaEnabled: false });
          set(deriveCloudFlags(next));
          const msg = "Ollama is reachable, but no local models are installed. Pull a model, then save AI settings again.";
          set({ cloudMessage: msg });
          return msg;
        }
      }

      const next = await saveCloudConfig(input);
      set(deriveCloudFlags(next));
      const msg = input.localOllamaEnabled ? "Local Ollama assist enabled." : "Local Ollama assist disabled.";
      set({ cloudMessage: msg });
      return msg;
    } catch (error) {
      const next = await saveCloudConfig({ ...input, localOllamaEnabled: false }).catch(() => undefined);
      if (next) set(deriveCloudFlags(next));
      const msg = normalizeCloudMessage(error instanceof Error ? `Ollama is not reachable: ${error.message}` : "Ollama is not reachable. Check that Ollama is running, then save AI settings again.");
      set({ cloudMessage: msg });
      return msg;
    }
  },

  async detectLocalOllamaModels(input) {
    try {
      const health = await checkLocalOllama(input);
      if (!health.ok) {
        const msg = "Ollama is reachable, but no local models are installed.";
        const next = await saveCloudConfig({
          ollamaBaseUrl: health.baseUrl,
          ollamaModelOptions: []
        });
        set({ ...deriveCloudFlags(next), cloudMessage: msg });
        return { clearModels: true, message: msg, models: [], selectedModel: undefined };
      }

      const selectedSuffix = health.selectedModel ? ` Selected ${health.selectedModel}.` : "";
      const versionSuffix = health.version ? ` Ollama ${health.version}.` : "";
      const msg = `Found ${health.modelCount} Ollama model${health.modelCount === 1 ? "" : "s"}.${selectedSuffix}${versionSuffix}`;
      const next = await saveCloudConfig({
        ollamaBaseUrl: health.baseUrl,
        ollamaModel: health.selectedModel ?? input.model ?? "",
        ollamaModelOptions: health.models
      });
      set({ ...deriveCloudFlags(next), cloudMessage: msg });
      return {
        message: msg,
        models: health.models,
        selectedModel: health.selectedModel
      };
    } catch (error) {
      const msg = normalizeCloudMessage(error instanceof Error ? `Ollama is not reachable: ${error.message}` : "Ollama is not reachable. Check that Ollama is running, then try again.");
      set({ cloudMessage: msg });
      return { clearModels: false, message: msg, models: [], selectedModel: undefined };
    }
  },

  async refreshSession() {
    try {
      const next = await refreshCloudSession();
      set(deriveCloudFlags(next));
      const msg = `Session refreshed for ${next.auth?.user.email ?? "account"}.`;
      set({ cloudMessage: msg });
      return msg;
    } catch (error) {
      const msg = normalizeCloudMessage(error instanceof Error ? error.message : "Unable to refresh the cloud session.");
      set({ cloudMessage: msg });
      return msg;
    }
  },

  async disconnectCloud() {
    try {
      await logoutCloudSession();
      const next = await getCloudState();
      set({ ...deriveCloudFlags(next), devices: [] });
      const msg = "Cloud session removed. Local mode is still available.";
      set({ cloudMessage: msg });
      return msg;
    } catch (error) {
      const msg = normalizeCloudMessage(error instanceof Error ? error.message : "Unable to disconnect the cloud session.");
      set({ cloudMessage: msg });
      return msg;
    }
  },

  async openCheckout() {
    try {
      const result = await createBillingCheckout();
      if (result.checkoutUrl) {
        window.open(result.checkoutUrl, "_blank", "noopener,noreferrer");
        return "";
      }
      const msg = "No checkout URL returned from the billing service.";
      set({ cloudMessage: msg });
      return msg;
    } catch (error) {
      const msg = normalizeCloudMessage(error instanceof Error ? error.message : "Unable to create a billing checkout.");
      set({ cloudMessage: msg });
      return msg;
    }
  },

  async loadDevices() {
    try {
      const result = await listDevices();
      set({ devices: result });
    } catch {
      // not critical
    }
  },

  syncOnVisible() {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const { cloudState } = get();
      if (cloudState?.auth?.sessionToken) return;
      getCloudState()
        .then((state) => {
          set(deriveCloudFlags(state));
          if (state.auth?.sessionToken) {
            return syncCloudSession().then((synced) => {
              set(deriveCloudFlags(synced));
              set({ cloudMessage: `Cloud session ready for ${synced.auth?.user.email ?? "connected account"}.` });
            }).catch(() => undefined);
          }
          return undefined;
        })
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
}));

function deriveCloudFlags(cloudState: CloudState | null): Pick<CloudClientState, "cloudState" | "isSignedIn" | "cloudPlan" | "canUseCloud"> {
  const isSignedIn = Boolean(cloudState?.auth?.sessionToken);
  const cloudPlan = cloudState?.auth?.account.subscription.plan ?? "free";
  const canUseCloud = cloudPlan === "pro" && (
    cloudState?.auth?.account.subscription.status === "active" ||
    cloudState?.auth?.account.subscription.status === "on_trial"
  );
  return { cloudState, isSignedIn, cloudPlan, canUseCloud };
}

export function normalizeCloudMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Cloud mode is optional and can stay off while local mode remains active.";

  const lower = trimmed.toLowerCase();
  if (lower === "document is not defined" || lower === "window is not defined") {
    return "Cloud session could not be completed. Try signing in again.";
  }

  return trimmed;
}

// Cross-context sync: when another context writes to chrome.storage.local,
// the cloud store already handles rehydration — we just need to read the latest.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    const cloudStateChanged = areaName === "local" && "infillCloudState" in changes;
    const cloudTokensChanged = areaName === "session" && "infillCloudSessionTokens" in changes;
    if (!cloudStateChanged && !cloudTokensChanged) return;
    // Re-derive from the updated cloud store
    const latest = useCloudStore.getState().getCloudState();
    useCloudClientStore.setState(deriveCloudFlags(latest));
  });
}
