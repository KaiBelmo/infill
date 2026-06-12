import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudState } from "@/shared/types";

const saveCloudConfig = vi.fn();
const checkLocalOllama = vi.fn();

vi.mock("@/cloudClient", () => ({
  createBillingCheckout: vi.fn(),
  checkLocalOllama,
  getCloudState: vi.fn(async () => baseCloudState),
  listDevices: vi.fn(),
  logoutCloudSession: vi.fn(),
  refreshCloudSession: vi.fn(),
  saveCloudConfig,
  startOAuthFlow: vi.fn(),
  syncCloudSession: vi.fn()
}));

const baseCloudState: CloudState = {
  config: {
    apiBaseUrl: "https://api.example.test",
    webBaseUrl: "https://app.example.test",
    cloudAssistEnabled: true,
    localOllamaEnabled: true,
    ollamaBaseUrl: "http://localhost:11434/v1",
    ollamaModel: "llama3.1",
    ollamaModelOptions: ["llama3.1"],
    ollamaTimeout: 60,
    localOllamaFallbackToCloud: false,
    enableLlmKeyMatcherFallback: true
  }
};

describe("useCloudClientStore AI settings", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    saveCloudConfig.mockImplementation(async (config: Partial<CloudState["config"]>) => ({
      ...baseCloudState,
      config: {
        ...baseCloudState.config,
        ...config
      }
    }));
  });

  it("persists disabling local Ollama without probing local health", async () => {
    const { useCloudClientStore } = await import("./cloud-client-store");

    const message = await useCloudClientStore.getState().saveLocalOllamaConfig({
      localOllamaEnabled: false,
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaModel: "mistral",
      ollamaTimeout: 90,
      localOllamaFallbackToCloud: false
    });

    expect(checkLocalOllama).not.toHaveBeenCalled();
    expect(saveCloudConfig).toHaveBeenCalledWith({
      localOllamaEnabled: false,
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaModel: "mistral",
      ollamaTimeout: 90,
      localOllamaFallbackToCloud: false
    });
    expect(useCloudClientStore.getState().cloudState?.config.localOllamaEnabled).toBe(false);
    expect(useCloudClientStore.getState().cloudState?.config.ollamaModel).toBe("mistral");
    expect(message).toBe("Local Ollama assist disabled.");
  });

  it("keeps the selected detected model after saving local Ollama settings", async () => {
    const { useCloudClientStore } = await import("./cloud-client-store");
    checkLocalOllama.mockResolvedValue({
      ok: true,
      baseUrl: "http://localhost:11434/v1",
      models: ["llama3.1", "mistral"],
      modelCount: 2,
      selectedModel: "mistral"
    });

    const message = await useCloudClientStore.getState().saveLocalOllamaConfig({
      localOllamaEnabled: true,
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaModel: "mistral",
      ollamaTimeout: 120,
      localOllamaFallbackToCloud: false
    });

    expect(saveCloudConfig).toHaveBeenCalledWith({
      localOllamaEnabled: true,
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaModel: "mistral",
      ollamaModelOptions: ["llama3.1", "mistral"],
      ollamaTimeout: 120,
      localOllamaFallbackToCloud: false
    });
    expect(useCloudClientStore.getState().cloudState?.config.ollamaModel).toBe("mistral");
    expect(message).toBe("Local Ollama assist enabled.");
  });

  it("preserves the user's selected model even when health reports a different selected model", async () => {
    const { useCloudClientStore } = await import("./cloud-client-store");
    checkLocalOllama.mockResolvedValue({
      ok: true,
      baseUrl: "http://localhost:11434/v1",
      models: ["llama3.2:latest", "qwen2.5:3b-instruct-q4_K_M", "qwen2.5:0.5b"],
      modelCount: 3,
      selectedModel: "llama3.2:latest"
    });

    await useCloudClientStore.getState().saveLocalOllamaConfig({
      localOllamaEnabled: true,
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaModel: "qwen2.5:0.5b",
      ollamaTimeout: 60,
      localOllamaFallbackToCloud: false
    });

    expect(saveCloudConfig).toHaveBeenCalledWith({
      localOllamaEnabled: true,
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaModel: "qwen2.5:0.5b",
      ollamaModelOptions: ["llama3.2:latest", "qwen2.5:3b-instruct-q4_K_M", "qwen2.5:0.5b"],
      ollamaTimeout: 60,
      localOllamaFallbackToCloud: false
    });
    expect(useCloudClientStore.getState().cloudState?.config.ollamaModel).toBe("qwen2.5:0.5b");
  });
});
