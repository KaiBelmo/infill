import { validateOllamaBaseUrl } from "./cloud-store";

const OLLAMA_HEALTH_TIMEOUT_MS = 3_000;

type OllamaTagsResponse = {
  models?: Array<{ name?: unknown }>;
};

export type OllamaHealthResult = {
  baseUrl: string;
  modelCount: number;
  models: string[];
  ok: boolean;
  selectedModel?: string;
  version?: string;
};

export async function checkLocalOllama(input: { baseUrl: string; model?: string }): Promise<OllamaHealthResult> {
  const baseUrl = validateOllamaBaseUrl(input.baseUrl);
  const nativeBaseUrl = baseUrl.replace(/\/v1\/?$/, "");
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), OLLAMA_HEALTH_TIMEOUT_MS);

  try {
    const [tagsResponse, versionResponse] = await Promise.all([
      fetch(`${nativeBaseUrl}/api/tags`, { signal: controller.signal }),
      fetch(`${nativeBaseUrl}/api/version`, { signal: controller.signal }).catch(() => undefined)
    ]);

    if (!tagsResponse.ok) {
      throw new Error(`Ollama returned HTTP ${tagsResponse.status}.`);
    }

    const tags = await tagsResponse.json() as OllamaTagsResponse;
    const models = Array.isArray(tags.models)
      ? tags.models.map((model) => typeof model.name === "string" ? model.name : "").filter(Boolean)
      : [];
    const preferredModel = input.model?.trim();
    const selectedModel = preferredModel && models.includes(preferredModel)
      ? preferredModel
      : models[0];
    const version = versionResponse?.ok
      ? String(((await versionResponse.json()) as { version?: unknown }).version ?? "")
      : undefined;

    return {
      baseUrl,
      modelCount: models.length,
      models,
      ok: models.length > 0,
      selectedModel,
      version: version || undefined
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
