import {
  CloudAssistRequestSchema,
  CloudAssistResponseSchema,
  type CloudAssistRequest,
  type CloudAssistResponse,
  type CreditBalance
} from "@infill/shared";
import { mergeAssistAnswersWithLocal, mergeCachedWithLocal, parseAssistAnswers, prepareAssistInput } from "@infill/form-brain";
import { useCloudStore, validateOllamaBaseUrl } from "./cloud-store";

const OLLAMA_TIMEOUT_MS = 20_000;

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  model?: unknown;
};

export async function runLocalAssist(request: CloudAssistRequest): Promise<CloudAssistResponse> {
  const payload = CloudAssistRequestSchema.parse(request);
  const state = useCloudStore.getState().getCloudState();
  if (!state.config.localOllamaEnabled) {
    throw new Error("Local Ollama assist is disabled.");
  }

  const prepared = prepareAssistInput(payload);
  const credits = state.auth?.account.credits ?? localCreditPlaceholder();

  if (prepared.llmFields.length === 0) {
    return CloudAssistResponseSchema.parse({
      mappings: mergeCachedWithLocal(payload.localMappings, prepared.cachedMappings),
      source: "local_fallback",
      warnings: ["Local deterministic mapping was enough; no Ollama call was needed."],
      providerId: "ollama",
      model: state.config.ollamaModel,
      credits
    });
  }

  const baseUrl = validateOllamaBaseUrl(state.config.ollamaBaseUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: state.config.ollamaModel,
        messages: prepared.promptMessages,
        temperature: 0.3,
        max_tokens: 900,
        stream: false,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}.`);
    }

    const data = await response.json() as OpenAiChatResponse;
    const text = typeof data.choices?.[0]?.message?.content === "string"
      ? data.choices[0].message.content
      : "";
    const answersByFieldId = parseAssistAnswers(text);
    const mappings = mergeAssistAnswersWithLocal({
      localMappings: payload.localMappings,
      cachedMappings: prepared.cachedMappings,
      allFields: prepared.allFields,
      answersByFieldId,
      safeFacts: prepared.safeFacts
    });

    return CloudAssistResponseSchema.parse({
      mappings,
      source: answersByFieldId.size > 0 ? "local_model" : "local_fallback",
      warnings: answersByFieldId.size > 0 ? [] : ["Ollama returned no usable answers, so Infill used deterministic local mapping."],
      providerId: "ollama",
      model: typeof data.model === "string" ? data.model : state.config.ollamaModel,
      credits
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function localCreditPlaceholder(): CreditBalance {
  return {
    monthlyLimit: 1,
    usedThisPeriod: 0,
    remaining: 1,
    resetAt: null
  };
}
