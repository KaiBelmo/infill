import {
  buildLlmBatchKeyMatchPrompt,
  buildLlmBatchKeyMatchRequest,
  getCachedLlmBatchKeyMatchResponse,
  setCachedLlmBatchKeyMatchResponse,
  type LlmBatchKeyMatchRequest,
  type LlmBatchKeyMatchResponse,
  type ProfileFactResolverOptions
} from "@infill/form-brain";
import type { ExtractedField, ProfileFact } from "@infill/shared";
import type { LlmKeyMatcherDebug } from "@/shared/types";
import { debugLog } from "@/shared/debug-log";
import { useCloudStore, validateOllamaBaseUrl } from "./cloud-store";
import { parseLlmBatchKeyMatchResponse } from "./llm-key-matcher-parser";
import { runCloudKeyMatch } from "./cloud-assist";


type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  model?: unknown;
};

type LocalLlmKeyMatcherResult = {
  resolverOptions: ProfileFactResolverOptions;
  debug: LlmKeyMatcherDebug;
};

type LocalOllamaKeyMatchResult = {
  response: LlmBatchKeyMatchResponse;
  prompt: string;
  rawResponseText: string;
  providerId: string;
  model: string;
};

export async function buildLocalLlmKeyMatcherResolverOptions(
  fields: ExtractedField[],
  facts: ProfileFact[]
): Promise<LocalLlmKeyMatcherResult | undefined> {
  const state = useCloudStore.getState().getCloudState();
  if (!state.config.enableLlmKeyMatcherFallback || !state.config.localOllamaEnabled) {
    return undefined;
  }

  const request = buildLlmBatchKeyMatchRequest(fields, facts);
  if (!request) {
    return {
      resolverOptions: {},
      debug: {
        enabled: true,
        providerId: "ollama",
        model: state.config.ollamaModel,
        status: "skipped",
        reason: "No unresolved canonical target keys needed LLM matching.",
        request
      }
    };
  }

  const resolverOptionsKey = {
    enableLlmKeyMatcherFallback: true,
    modelVersion: state.config.ollamaModel,
  };
  const cachedResponse = getCachedLlmBatchKeyMatchResponse(request, resolverOptionsKey);
  if (cachedResponse) {
    debugLog("[llmKeyMatcher] Ollama cache hit for batch key match", {
      targets: request.targets.map((target) => target.targetKey),
    });
    return {
      resolverOptions: {
        enableLlmKeyMatcherFallback: true,
        modelVersion: state.config.ollamaModel,
        llmKeyMatcher: (singleRequest) => {
          const match = cachedResponse.matches.find((item) => item.targetKey === singleRequest.targetKey);
          if (!match) return undefined;
          const { targetKey: _targetKey, ...singleResponse } = match;
          return singleResponse;
        }
      },
      debug: {
        enabled: true,
        providerId: "ollama",
        model: state.config.ollamaModel,
        status: "success",
        durationMs: 0,
        prompt: "",
        rawResponseText: JSON.stringify(cachedResponse),
        request,
        response: cachedResponse
      }
    };
  }

  const startedAt = Date.now();
  try {
    const baseUrl = validateOllamaBaseUrl(state.config.ollamaBaseUrl);
    const result = await requestOllamaBatchKeyMatch(baseUrl, state.config.ollamaModel, request, (state.config.ollamaTimeout ?? 60) * 1000);
    const response = result.response;
    setCachedLlmBatchKeyMatchResponse(request, response, resolverOptionsKey);
    const durationMs = Date.now() - startedAt;

    debugLog("[llmKeyMatcher] Ollama batch key match completed", {
      targets: request.targets.map((target) => target.targetKey),
      matches: response.matches.map((match) => `${match.targetKey}:${match.bestFactKey ?? "none"}:${match.confidence}`),
      durationMs
    });

    return {
      resolverOptions: {
        enableLlmKeyMatcherFallback: true,
        modelVersion: state.config.ollamaModel,
        llmKeyMatcher: (singleRequest) => {
          const match = response.matches.find((item) => item.targetKey === singleRequest.targetKey);
          if (!match) {
            return undefined;
          }

          const { targetKey: _targetKey, ...singleResponse } = match;
          return singleResponse;
        }
      },
      debug: {
        enabled: true,
        providerId: "ollama",
        model: state.config.ollamaModel,
        status: "success",
        durationMs,
        prompt: result.prompt,
        rawResponseText: result.rawResponseText,
        request,
        response
      }
    };
  } catch (error) {
    return {
      resolverOptions: {},
      debug: {
        enabled: true,
        providerId: "ollama",
        model: state.config.ollamaModel,
        status: "error",
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : String(error),
        request
      }
    };
  }
}

export async function buildLlmKeyMatcherResolverOptions(
  fields: ExtractedField[],
  facts: ProfileFact[],
  provider: "cloud" | "ollama"
): Promise<LocalLlmKeyMatcherResult | undefined> {
  const state = useCloudStore.getState().getCloudState();
  if (!state.config.enableLlmKeyMatcherFallback) {
    return undefined;
  }

  const request = buildLlmBatchKeyMatchRequest(fields, facts);
  const providerId = provider === "cloud" ? "cloud" : "ollama";
  const model = provider === "cloud" ? "managed-cloud" : state.config.ollamaModel;
  if (!request) {
    return {
      resolverOptions: {},
      debug: {
        enabled: true,
        providerId,
        model,
        status: "skipped",
        reason: "No unresolved canonical target keys needed LLM matching.",
        request
      }
    };
  }

  const resolverOptionsKey = {
    enableLlmKeyMatcherFallback: true,
    modelVersion: provider === "cloud" ? "managed-cloud" : state.config.ollamaModel,
  };
  const cachedResponse = getCachedLlmBatchKeyMatchResponse(request, resolverOptionsKey);
  if (cachedResponse) {
    debugLog("[llmKeyMatcher] cache hit for batch key match", {
      provider,
      targets: request.targets.map((target) => target.targetKey),
    });
    return {
      resolverOptions: {
        enableLlmKeyMatcherFallback: true,
        modelVersion: resolverOptionsKey.modelVersion,
        llmKeyMatcher: (singleRequest) => {
          const match = cachedResponse.matches.find((item) => item.targetKey === singleRequest.targetKey);
          if (!match) return undefined;
          const { targetKey: _targetKey, ...singleResponse } = match;
          return singleResponse;
        }
      },
      debug: {
        enabled: true,
        providerId,
        model,
        status: "success",
        durationMs: 0,
        prompt: "",
        rawResponseText: JSON.stringify(cachedResponse),
        request,
        response: cachedResponse
      }
    };
  }

  const startedAt = Date.now();
  try {
    const result = provider === "cloud"
      ? await requestCloudBatchKeyMatch(request)
      : await requestOllamaBatchKeyMatch(
        validateOllamaBaseUrl(state.config.ollamaBaseUrl),
        state.config.ollamaModel,
        request,
        (state.config.ollamaTimeout ?? 60) * 1000
      );
    const response = result.response;
    setCachedLlmBatchKeyMatchResponse(request, response, resolverOptionsKey);
    const durationMs = Date.now() - startedAt;

    debugLog("[llmKeyMatcher] batch key match completed", {
      providerId: result.providerId,
      targets: request.targets.map((target) => target.targetKey),
      matches: response.matches.map((match) => `${match.targetKey}:${match.bestFactKey ?? "none"}:${match.confidence}`),
      durationMs
    });

    return {
      resolverOptions: {
        enableLlmKeyMatcherFallback: true,
        modelVersion: result.model,
        llmKeyMatcher: (singleRequest) => {
          const match = response.matches.find((item) => item.targetKey === singleRequest.targetKey);
          if (!match) {
            return undefined;
          }

          const { targetKey: _targetKey, ...singleResponse } = match;
          return singleResponse;
        }
      },
      debug: {
        enabled: true,
        providerId: result.providerId,
        model: result.model,
        status: "success",
        durationMs,
        prompt: result.prompt,
        rawResponseText: result.rawResponseText,
        request,
        response
      }
    };
  } catch (error) {
    return {
      resolverOptions: {},
      debug: {
        enabled: true,
        providerId,
        model,
        status: "error",
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : String(error),
        request
      }
    };
  }
}

async function requestOllamaBatchKeyMatch(
  baseUrl: string,
  model: string,
  request: LlmBatchKeyMatchRequest,
  timeoutMs: number = 60_000
): Promise<LocalOllamaKeyMatchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const prompt = buildLlmBatchKeyMatchPrompt(request);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0,
        max_tokens: 1200,
        stream: false,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama key matcher returned HTTP ${response.status}.`);
    }

    const data = await response.json() as OpenAiChatResponse;
    const text = typeof data.choices?.[0]?.message?.content === "string"
      ? data.choices[0].message.content
      : "";

    return {
      response: parseLlmBatchKeyMatchResponse(text, "Ollama"),
      prompt,
      rawResponseText: text,
      providerId: "ollama",
      model
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestCloudBatchKeyMatch(request: LlmBatchKeyMatchRequest): Promise<LocalOllamaKeyMatchResult> {
  const prompt = buildLlmBatchKeyMatchPrompt(request);
  const result = await runCloudKeyMatch({
    prompt,
    requestedAt: new Date().toISOString()
  });
  return {
    response: parseLlmBatchKeyMatchResponse(result.rawResponseText, "Cloud"),
    prompt,
    rawResponseText: result.rawResponseText,
    providerId: result.providerId ?? "cloud",
    model: result.model ?? "managed-cloud"
  };
}
