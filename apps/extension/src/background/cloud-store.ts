import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CloudAuthState, CloudConfig, CloudState } from "@/shared/types";

const LOCAL_CLOUD_STATE_KEY = "infillCloudState";
const SESSION_TOKENS_KEY = "infillCloudSessionTokens";
const LEGACY_CONFIG_KEY = "infillCloudConfig";
const LEGACY_AUTH_KEY = "infillCloudAuth";


type CloudStoreActions = {
  saveConfig: (input: Partial<CloudConfig>) => CloudState;
  persistAuth: (auth: CloudAuthState) => void;
  clearAuth: () => void;
  getCloudState: () => CloudState;
};

function defaultConfig(): CloudConfig {
  return {
    apiBaseUrl: trimBaseUrl(__VITE_API_BASE_URL__),
    webBaseUrl: trimBaseUrl(__VITE_WEB_BASE_URL__),
    cloudAssistEnabled: true,
    localOllamaEnabled: false,
    ollamaBaseUrl: "http://localhost:11434/v1",
    ollamaModel: "llama3.1",
    ollamaModelOptions: [],
    ollamaTimeout: 60,
    localOllamaFallbackToCloud: false,
    enableLlmKeyMatcherFallback: true
  };
}

function chromeLocalStorageAdapter() {
  return {
    getItem: async (name: string): Promise<string | null> => {
      const result = await chrome.storage.local.get(name);
      const value = result[name];
      if (value == null) return null;
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    setItem: async (name: string, value: string): Promise<void> => {
      await chrome.storage.local.set({ [name]: JSON.parse(value) });
    },
    removeItem: async (name: string): Promise<void> => {
      await chrome.storage.local.remove(name);
    }
  };
}

function chromeSessionStorageAdapter() {
  return {
    getItem: async (name: string): Promise<string | null> => {
      const result = await chrome.storage.session.get(name);
      const value = result[name];
      if (value == null) return null;
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    setItem: async (name: string, value: string): Promise<void> => {
      await chrome.storage.session.set({ [name]: JSON.parse(value) });
    },
    removeItem: async (name: string): Promise<void> => {
      await chrome.storage.session.remove(name);
    }
  };
}

// Separate tiny store for session tokens — persisted to chrome.storage.session
// (in-memory, not written to disk, not readable by other extensions)
export const useSessionTokenStore = create<{ sessionToken: string; refreshToken: string }>()(
  persist(
    () => ({
      sessionToken: "",
      refreshToken: ""
    }),
    {
      name: SESSION_TOKENS_KEY,
      storage: createJSONStorage(() => chromeSessionStorageAdapter())
    }
  )
);

export const useCloudStore = create<CloudState & CloudStoreActions>()(
  persist(
    (set, get) => ({
      config: defaultConfig(),
      auth: undefined,

      getCloudState(): CloudState {
        const { config, auth } = get();
        const tokens = useSessionTokenStore.getState();
        return {
          config: {
            ...defaultConfig(),
            ...config
          },
          auth: auth
            ? { ...auth, sessionToken: tokens.sessionToken || auth.sessionToken, refreshToken: tokens.refreshToken || auth.refreshToken }
            : undefined
        };
      },

      saveConfig(input: Partial<CloudConfig>): CloudState {
        const current = get().config;
        const next: CloudConfig = {
          ...current,
          ...input,
          apiBaseUrl: validateCloudBaseUrl(trimBaseUrl(input.apiBaseUrl ?? current.apiBaseUrl), "API"),
          webBaseUrl: validateCloudBaseUrl(trimBaseUrl(input.webBaseUrl ?? current.webBaseUrl), "web"),
          ollamaBaseUrl: validateOllamaBaseUrl(trimBaseUrl(input.ollamaBaseUrl ?? current.ollamaBaseUrl)),
          ollamaModel: (input.ollamaModel ?? current.ollamaModel).trim() || defaultConfig().ollamaModel,
          ollamaModelOptions: sanitizeOllamaModelOptions(input.ollamaModelOptions ?? current.ollamaModelOptions),
          ollamaTimeout: Math.max(1, input.ollamaTimeout ?? current.ollamaTimeout ?? 60)
        };
        set({ config: next });
        return get().getCloudState();
      },

      persistAuth(auth: CloudAuthState): void {
        // Tokens → session storage (in-memory only)
        useSessionTokenStore.setState({
          sessionToken: auth.sessionToken,
          refreshToken: auth.refreshToken
        });
        // Auth metadata → local storage WITHOUT plaintext tokens
        const { sessionToken: _, refreshToken: __, ...authWithoutTokens } = auth;
        set({ auth: { ...authWithoutTokens, sessionToken: "", refreshToken: "" } });
      },

      clearAuth(): void {
        useSessionTokenStore.setState({ sessionToken: "", refreshToken: "" });
        set({ auth: undefined });
      }
    }),
    {
      name: LOCAL_CLOUD_STATE_KEY,
      storage: createJSONStorage(() => chromeLocalStorageAdapter()),
      // Only persist config + auth metadata (tokens are in session store)
      partialize: (state) => ({ config: state.config, auth: state.auth }),
      version: 2,
      migrate: (persistedState, version) => {
        const state = persistedState as CloudState;
        if (version < 2) {
          return {
            ...state,
            config: {
              ...defaultConfig(),
              ...(state.config ?? {})
            }
          } satisfies CloudState;
        }
        if (version === 0) {
          // v0 had config/auth as separate top-level keys inside the persisted blob
          // v1 uses { config, auth } shape — same shape, just bump to trigger onRehydrateStorage
          return persistedState as CloudState;
        }
        return {
          ...state,
          config: {
            ...defaultConfig(),
            ...(state.config ?? {})
          }
        } satisfies CloudState;
      },
      onRehydrateStorage: () => {
        return async (state, error) => {
          if (error || state) return;
          // No persisted state found under new key — try legacy migration
          const legacy = await chrome.storage.local.get([LEGACY_CONFIG_KEY, LEGACY_AUTH_KEY]);
          const legacyConfig = legacy[LEGACY_CONFIG_KEY] as CloudConfig | undefined;
          const legacyAuth = legacy[LEGACY_AUTH_KEY] as Omit<CloudAuthState, "sessionToken" | "refreshToken"> & { sessionToken: string; refreshToken: string } | undefined;

          if (!legacyConfig && !legacyAuth) return;

          const migrated: CloudState = {
            config: {
              ...defaultConfig(),
              ...(legacyConfig ?? {})
            },
            auth: legacyAuth ? { ...legacyAuth, sessionToken: "", refreshToken: "" } : undefined
          };
          useCloudStore.setState(migrated);

          // Clean up orphaned legacy keys
          await chrome.storage.local.remove([LEGACY_CONFIG_KEY, LEGACY_AUTH_KEY]);
        };
      }
    }
  )
);

function trimBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function sanitizeOllamaModelOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
}

function validateCloudBaseUrl(value: string, label: string): string {
  if (!value) return "";

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Cloud ${label} URL must be a valid URL.`);
  }

  const isLocalDevHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalDevHost)) {
    throw new Error(`Cloud ${label} URL must use HTTPS, except localhost development URLs.`);
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function validateOllamaBaseUrl(value: string): string {
  if (!value) return defaultConfig().ollamaBaseUrl;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Ollama Base URL must be a valid URL.");
  }

  const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
  if (!isLocalHost) {
    throw new Error("Ollama Base URL must point to localhost, 127.0.0.1, or ::1.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ollama Base URL must use HTTP or HTTPS.");
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

