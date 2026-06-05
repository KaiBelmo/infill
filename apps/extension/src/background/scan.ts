import { mapFieldsToProfile, scoreFieldMatch, generateDummyDataForField } from "@infill/form-brain";
import type { CloudAssistRequest, ExtractedForm, FieldMapping, ProfileFact, Sensitivity } from "@infill/shared";
import { toPublicExtensionState, useProfileStore } from "./profile-store";
import { useScanStore } from "./scan-store";
import { runCloudAssist } from "./cloud-assist";
import { runLocalAssist } from "./local-assist";
import { useCloudStore } from "./cloud-store";
import { sendMessage } from "webext-bridge/background";
import { canToggleMappingValue } from "@/popup/utils/mapping-display";
import type { ScanDebugState, ScanStatus } from "@/shared/types";
import { debugLog, debugWarn } from "@/shared/debug-log";

const MESSAGE_TIMEOUT_MS = 8_000;

function getContentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest();
  return manifest.content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];
}

const RESTRICTED_HOSTS = [
  "accounts.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "paypal.com",
  "stripe.com",
  "bankofamerica.com",
  "chase.com",
  "wellsfargo.com",
];

function isUnsupportedUrl(url: string): boolean {
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(url)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return RESTRICTED_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
  } catch {
    return true;
  }
}

function withTimeout<T>(promise: Promise<T>, ms = MESSAGE_TIMEOUT_MS): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  // Use lightweight "ping" instead of full "scan" as probe
  debugLog("[ensureContentScript] pinging tabId=", tabId);
  const probe = await withTimeout(sendMessage("ping", null, { context: "content-script", tabId }));
  debugLog("[ensureContentScript] ping result=", probe);
  if (probe) return true;

  debugLog("[ensureContentScript] injecting content script into tabId=", tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: getContentScriptFiles(),
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

  debugLog("[ensureContentScript] re-pinging tabId=", tabId);
  const recheck = await withTimeout(sendMessage("ping", null, { context: "content-script", tabId }));
  debugLog("[ensureContentScript] re-ping result=", recheck);
  return Boolean(recheck);
}

function sanitizeFormsForCloud(forms: ExtractedForm[]): ExtractedForm[] {
  return forms.map((form) => ({
    ...form,
    fields: form.fields.map((field) => ({
      ...field,
      currentValue: undefined,
      domPathHint: "",
      boundingBox: undefined,
    })),
  }));
}

function normalizeReviewMapping(mapping: FieldMapping): FieldMapping {
  return canToggleMappingValue(mapping) ? mapping : { ...mapping, preselected: false };
}

type AutoFillDebugResult = {
  filledFieldIds: string[];
  skippedFields: Array<{ fieldId: string; reason: string }>;
};

export async function scanTab(tabId: number, tabUrl: string): Promise<void> {
  const store = useScanStore.getState();

  debugLog("[scanTab] START tabId=", tabId, "url=", tabUrl);

  if (isUnsupportedUrl(tabUrl)) {
    debugLog("[scanTab] Blocked â€” unsupported URL");
    store.setScanState({
      status: "Blocked",
      error: "This page cannot be scanned.",
      tabId,
      url: tabUrl,
      forms: [],
      mappings: [],
      scannedAt: "",
      debug: undefined,
    });
    return;
  }

  store.setScanState({
    status: "Scanning",
    error: "",
    tabId,
    url: tabUrl,
    forms: [],
    mappings: [],
    scannedAt: "",
    debug: undefined,
  });

  const facts = toPublicExtensionState(useProfileStore.getState()).facts;
  debugLog("[scanTab] facts count=", facts.length);
  let allForms: ExtractedForm[] = [];

  // Scan main frame
  debugLog("[scanTab] ensureContentScript tabId=", tabId);
  const loaded = await ensureContentScript(tabId);
  debugLog("[scanTab] ensureContentScript result=", loaded);
  if (!loaded) {
    debugLog("[scanTab] ERROR â€” content script could not load");
    store.setScanState({
      status: "Error",
      error: "Could not load content script on this page.",
      tabId,
      url: tabUrl,
      forms: [],
      mappings: [],
      scannedAt: "",
      debug: undefined,
    });
    return;
  }

  debugLog("[scanTab] sending 'scan' message to content script tabId=", tabId);
  const response = await withTimeout(sendMessage("scan", null, { context: "content-script", tabId }));
  debugLog("[scanTab] scan response=", response ? `forms=${response.forms?.length}` : "undefined (timed out)");
  if (response) {
    allForms = [...allForms, ...response.forms];
  }

  // Scan iframes
  try {
    const frameResults = await chrome.webNavigation.getAllFrames({ tabId });
    debugLog("[scanTab] iframe frames count=", frameResults?.length ?? 0);
    if (frameResults) {
      const iframeIds = frameResults
        .filter((frame) => frame.frameId !== 0)
        .map((frame) => frame.frameId);
      debugLog("[scanTab] iframe IDs (non-main)=", iframeIds);

      for (const frameId of iframeIds) {
        debugLog("[scanTab] scanning iframe frameId=", frameId);
        let frameResponse = await withTimeout(
          sendMessage("scan", null, { context: "content-script", tabId, frameId })
        );

        if (!frameResponse) {
          debugLog("[scanTab] iframe frameId=", frameId, "no response, injecting script");
          try {
            await chrome.scripting.executeScript({
              target: { tabId, frameIds: [frameId] },
              files: getContentScriptFiles(),
            });
          } catch (injectErr) {
            debugLog("[scanTab] iframe frameId=", frameId, "inject failed:", injectErr);
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          frameResponse = await withTimeout(
            sendMessage("scan", null, { context: "content-script", tabId, frameId })
          );
        }

        if (frameResponse) {
          debugLog("[scanTab] iframe frameId=", frameId, "forms=", frameResponse.forms?.length);
          const taggedForms = frameResponse.forms.map((form: ExtractedForm) => ({
            ...form,
            formId: `frame_${frameId}_${form.formId}`,
            fields: form.fields.map((field) => ({
              ...field,
              frameId: String(frameId),
            })),
          }));
          allForms = [...allForms, ...taggedForms];
        } else {
          debugLog("[scanTab] iframe frameId=", frameId, "no response after retry");
        }
      }
    }
  } catch (scanError) {
    debugWarn("[scanTab] iframe scanning not available:", scanError);
  }

  debugLog("[scanTab] total allForms=", allForms.length, "total fields=", allForms.reduce((s, f) => s + f.fields.length, 0));
  if (allForms.length === 0 || allForms.every((form) => form.fields.length === 0)) {
    debugLog("[scanTab] Blocked â€” no visible/enabled fields");
    store.setScanState({
      status: "Blocked",
      error: "No visible or enabled form fields were detected on this page.",
      tabId,
      url: tabUrl,
      forms: [],
      mappings: [],
      scannedAt: "",
      debug: undefined,
    });
    return;
  }

  // Map fields to profile facts
  debugLog("[scanTab] mapping fields to profile facts...");
  debugLog("[scanTab] profile facts keys=", facts.map((f) => `${f.key}=${String(f.value).slice(0, 30)}`).join(", "));
  let nextMappings = allForms.flatMap((form) => mapFieldsToProfile(form.fields, facts));
  debugLog("[scanTab] local mappings count=", nextMappings.length);
  for (const m of nextMappings) {
    debugLog(`[scanTab] field=${m.fieldId} key=${m.profileKey} source=${m.valueSource} value=${String(m.value ?? "").slice(0, 50)} preselected=${m.preselected} reason=${m.reason} usedFactIds=${(m.usedFactIds ?? []).join(",") || "none"} warnings=${(m.warnings ?? []).join("|") || "none"}`);
  }

  // AI assist
  const cloudState = useCloudStore.getState().getCloudState();
  const canUseCloudAssist = cloudState.auth?.account.subscription.plan === "pro" &&
    (
      cloudState.auth.account.subscription.status === "active" ||
      cloudState.auth.account.subscription.status === "on_trial"
    );
  const shouldUseCloudAssist = Boolean(
    cloudState.config.cloudAssistEnabled && cloudState.auth?.sessionToken && canUseCloudAssist
  );
  const shouldUseLocalAssist = Boolean(cloudState.config.localOllamaEnabled);
  debugLog("[scanTab] localOllamaEnabled=", shouldUseLocalAssist, "cloudAssistEnabled=", cloudState.config.cloudAssistEnabled, "hasSession=", Boolean(cloudState.auth?.sessionToken), "canUseCloud=", canUseCloudAssist, "shouldUseCloud=", shouldUseCloudAssist);

  let assistStatusSuffix = "";
  let assistUsed = false;
  const assistRequest: CloudAssistRequest = {
    forms: sanitizeFormsForCloud(allForms),
    facts: facts.filter((fact) => fact.sensitivity === "public" || fact.sensitivity === "normal"),
    localMappings: nextMappings,
    requestedAt: new Date().toISOString(),
    locale: "en",
  };

  if (shouldUseLocalAssist) {
    try {
      debugLog("[scanTab] calling runLocalAssist...");
      const assisted = await runLocalAssist(assistRequest);
      debugLog("[scanTab] localAssist result source=", assisted.source, "mappings=", assisted.mappings?.length);
      nextMappings = assisted.mappings;
      assistUsed = true;
      assistStatusSuffix = assisted.source === "local_model" ? "Local AI assist ready" : "Local fallback ready";
    } catch (assistError) {
      debugWarn("[scanTab] Local Ollama assist FAILED:", assistError);
      assistStatusSuffix = "Local Ollama unavailable. Basic matching only";
      if (cloudState.config.localOllamaFallbackToCloud && shouldUseCloudAssist) {
        try {
          debugLog("[scanTab] local failed; calling runCloudAssist because fallback is enabled...");
          const assisted = await runCloudAssist(assistRequest);
          debugLog("[scanTab] cloudAssist fallback result source=", assisted.source, "mappings=", assisted.mappings?.length);
          nextMappings = assisted.mappings;
          assistUsed = true;
          assistStatusSuffix = assisted.source === "cloud_model" ? "Cloud assist ready" : "Local fallback ready";
        } catch (cloudError) {
          debugWarn("[scanTab] Cloud assist fallback FAILED:", cloudError);
        }
      }
    }
  } else if (shouldUseCloudAssist) {
    try {
      debugLog("[scanTab] calling runCloudAssist...");
      const assisted = await runCloudAssist(assistRequest);
      debugLog("[scanTab] cloudAssist result source=", assisted.source, "mappings=", assisted.mappings?.length);
      nextMappings = assisted.mappings;
      assistUsed = true;
      assistStatusSuffix = assisted.source === "cloud_model" ? "Cloud assist ready" : "Local fallback ready";
    } catch (assistError) {
      debugWarn("[scanTab] Cloud assist FAILED:", assistError);
    }
  } else {
    assistStatusSuffix = "AI assist not configured. Basic matching only";
  }

  const finalStatus: ScanStatus = assistStatusSuffix && assistStatusSuffix !== "Local Ollama unavailable" && assistUsed
    ? (assistStatusSuffix as ScanStatus)
    : nextMappings.length > 0
      ? "Review fill"
      : "Blocked";

  debugLog("[scanTab] DONE — finalStatus=", finalStatus, "mappings=", nextMappings.length);
  const finalMappings = nextMappings.map(normalizeReviewMapping);
  const scannedAt = new Date().toISOString();
  const initialDebug = buildScanDebug({
    forms: allForms,
    mappings: finalMappings,
    facts,
    cloudAssistUsed: assistUsed,
    cloudAssistStatus: assistStatusSuffix || "Local mapping",
    generatedAt: scannedAt
  });
  store.setScanState({
    status: finalStatus,
    forms: allForms,
    mappings: finalMappings,
    error: "",
    scannedAt,
    debug: initialDebug,
  });

  // Auto-fill non-sensitive fields and install inline overlays
  if (finalMappings.length > 0) {
    const fillDebug = await autoFillAndOverlay(tabId, allForms, finalMappings);
    store.setScanState({
      debug: buildScanDebug({
        forms: allForms,
        mappings: finalMappings,
        facts,
        cloudAssistUsed: assistUsed,
        cloudAssistStatus: assistStatusSuffix || "Local mapping",
        generatedAt: new Date().toISOString(),
        fillDebug
      })
    });
  }
}

export async function autoFillAndOverlay(tabId: number, forms: ExtractedForm[], mappings: FieldMapping[]): Promise<AutoFillDebugResult> {
  await ensureContentScript(tabId);

  const byFrame = new Map<string | undefined, FieldMapping[]>();
  for (const mapping of mappings) {
    const field = forms.flatMap((form) => form.fields).find((item) => item.fieldId === mapping.fieldId);
    const frameId = field?.frameId;
    byFrame.set(frameId, [...(byFrame.get(frameId) ?? []), mapping]);
  }

  const filledFieldIds: string[] = [];
  const skippedFields: Array<{ fieldId: string; reason: string }> = [];

  for (const [frameId, frameMappings] of byFrame) {
    const destination = frameId
      ? { context: "content-script" as const, tabId, frameId: Number(frameId) }
      : { context: "content-script" as const, tabId };
    debugLog("[autoFillAndOverlay] frame start", {
      tabId,
      frameId,
      mappings: frameMappings.length,
      readyMappings: frameMappings.filter((mapping) => mapping.preselected && mapping.value !== undefined).length,
      mappingKeys: frameMappings.map((mapping) => `${mapping.fieldId}:${mapping.profileKey ?? "none"}:${mapping.valueSource}`)
    });
    const result = await withTimeout(sendMessage("auto-fill-and-overlay", { mappings: frameMappings }, destination));
    if (result) {
      debugLog("[autoFillAndOverlay] frame result", {
        tabId,
        frameId,
        filledFieldIds: result.filledFieldIds ?? [],
        skippedFields: result.skippedFields ?? []
      });
      filledFieldIds.push(...(result.filledFieldIds ?? []));
      skippedFields.push(...(result.skippedFields ?? []));
    } else {
      debugLog("[autoFillAndOverlay] frame timed out", { tabId, frameId });
      skippedFields.push(
        ...frameMappings
          .filter((mapping) => mapping.preselected && mapping.value !== undefined)
          .map((mapping) => ({ fieldId: mapping.fieldId, reason: "Timed out waiting for content script fill result" }))
      );
    }
  }

  return { filledFieldIds, skippedFields };
}

export async function removeOverlays(tabId: number): Promise<void> {
  await ensureContentScript(tabId);
  await withTimeout(sendMessage("remove-overlays", null, { context: "content-script", tabId }));
}

export async function getScanState() {
  return useScanStore.getState().getScanState();
}

export async function clearScanState() {
  useScanStore.getState().clearScanState();
}

function buildScanDebug(input: {
  forms: ExtractedForm[];
  mappings: FieldMapping[];
  facts: ProfileFact[];
  cloudAssistUsed: boolean;
  cloudAssistStatus: string;
  generatedAt: string;
  fillDebug?: AutoFillDebugResult;
}): ScanDebugState {
  const allFields = input.forms.flatMap((form) => form.fields);
  const fieldById = new Map(allFields.map((field) => [field.fieldId, field]));
  const filled = new Set(input.fillDebug?.filledFieldIds ?? []);
  const skippedByField = new Map((input.fillDebug?.skippedFields ?? []).map((item) => [item.fieldId, item.reason]));
  const readyCount = input.mappings.filter(isReadyMapping).length;
  const blockedCount = input.mappings.filter((mapping) => mapping.risk === "restricted" || mapping.risk === "secret").length;

  return {
    factCount: input.facts.length,
    formCount: input.forms.length,
    fieldCount: allFields.length,
    mappingCount: input.mappings.length,
    readyCount,
    blockedCount,
    filledCount: filled.size,
    skippedFillCount: skippedByField.size,
    cloudAssistUsed: input.cloudAssistUsed,
    cloudAssistStatus: input.cloudAssistStatus,
    generatedAt: input.generatedAt,
    facts: input.facts.map(toDebugFact),
    forms: input.forms.map(toDebugForm),
    fields: input.mappings.map((mapping) => {
      const field = fieldById.get(mapping.fieldId);
      const valuePreview = previewMappingValue(mapping);
      const ready = isReadyMapping(mapping);
      const fillReason = skippedByField.get(mapping.fieldId);
      const match = field ? scoreFieldMatch(field) : undefined;
      return {
        fieldId: mapping.fieldId,
        label: getDebugFieldLabel(field),
        fieldMeta: getDebugFieldMeta(field),
        profileKey: mapping.profileKey,
        valuePreview,
        valueSource: mapping.valueSource,
        risk: mapping.risk,
        preselected: mapping.preselected,
        ready,
        reason: mapping.reason,
        warnings: mapping.warnings,
        usedFactIds: mapping.usedFactIds,
        fillStatus: filled.has(mapping.fieldId) ? "filled" : fillReason ? "skipped" : ready ? "pending" : undefined,
        fillReason,
        matchScore: match?.score,
        matchConfidence: match?.confidence,
        matchEvidence: match?.evidence,
        matchRejectedReason: match?.rejectedReason
      };
    })
  };
}

function toDebugFact(fact: ProfileFact): ScanDebugState["facts"][number] {
  return {
    id: fact.id,
    key: fact.key,
    label: fact.label,
    category: fact.category,
    sensitivity: fact.sensitivity,
    source: fact.source,
    verified: fact.verified,
    confidence: fact.confidence,
    valueKind: getDebugValueKind(fact.value),
    valuePreview: previewFactValue(fact),
    sourceRefCount: fact.sourceRefs.length,
    hasNotes: Boolean(fact.notes?.trim())
  };
}

function toDebugForm(form: ExtractedForm): ScanDebugState["forms"][number] {
  return {
    formId: form.formId,
    urlOrigin: form.urlOrigin,
    urlPathHash: form.urlPathHash,
    pageTitle: form.pageTitle,
    formTitle: form.formTitle,
    detectedDomain: form.detectedDomain,
    fieldCount: form.fields.length,
    scanWarnings: form.scanWarnings,
    createdAt: form.createdAt,
    fields: form.fields.map((field) => ({
      fieldId: field.fieldId,
      formId: field.formId,
      frameId: field.frameId,
      tagName: field.tagName,
      inputType: field.inputType,
      role: field.role,
      name: field.name,
      id: field.id,
      className: field.className,
      dataAttributes: field.dataAttributes,
      autocomplete: field.autocomplete,
      labelText: field.labelText,
      ariaLabel: field.ariaLabel,
      ariaDescription: field.ariaDescription,
      placeholder: field.placeholder,
      title: field.title,
      nearbyText: field.nearbyText,
      sectionHeading: field.sectionHeading,
      groupLabel: field.groupLabel,
      required: field.required,
      disabled: field.disabled,
      readonly: field.readonly,
      visible: field.visible,
      hasUserValue: field.hasUserValue,
      currentValuePreview: previewFieldCurrentValue(field),
      maxLength: field.maxLength,
      pattern: field.pattern,
      min: field.min,
      max: field.max,
      step: field.step,
      domPathHint: field.domPathHint,
      cssPath: field.cssPath,
      optionCount: field.options.length,
      options: field.options.slice(0, 20).map((option) => ({
        label: previewText(option.label, 80),
        value: previewText(option.value, 80),
        selected: option.selected
      }))
    }))
  };
}

function isReadyMapping(mapping: FieldMapping): boolean {
  return mapping.preselected && mapping.value !== undefined && mapping.risk !== "restricted" && mapping.risk !== "secret";
}

function getDebugFieldLabel(field: ExtractedForm["fields"][number] | undefined): string {
  return [
    field?.labelText,
    field?.ariaLabel,
    field?.placeholder,
    field?.name,
    field?.id,
    field?.fieldId
  ].find((value) => value && value.trim().length > 0) ?? "Unnamed field";
}

function getDebugFieldMeta(field: ExtractedForm["fields"][number] | undefined): string {
  if (!field) return "field metadata missing";
  return [
    field.tagName === "input" && field.inputType ? `input:${field.inputType}` : field.tagName,
    field.name ? `name=${field.name}` : undefined,
    field.id ? `id=${field.id}` : undefined,
    field.autocomplete ? `autocomplete=${field.autocomplete}` : undefined
  ].filter(Boolean).join(" | ");
}

function getDebugValueKind(value: ProfileFact["value"]): ScanDebugState["facts"][number]["valueKind"] {
  if (Array.isArray(value)) return "list";
  if (value !== null && typeof value === "object") return "object";
  return typeof value;
}

function previewFactValue(fact: ProfileFact): string {
  return shouldRedactSensitivity(fact.sensitivity) ? "[redacted]" : previewText(fact.value, 120);
}

function previewMappingValue(mapping: FieldMapping): string {
  if (mapping.value === undefined) return "";
  return shouldRedactSensitivity(mapping.risk) ? "[redacted]" : previewText(mapping.value, 120);
}

function previewFieldCurrentValue(field: ExtractedForm["fields"][number]): string {
  if (!field.currentValue) return "";
  if (field.inputType === "password") return "[redacted]";
  return previewText(field.currentValue, 120);
}

function shouldRedactSensitivity(sensitivity: Sensitivity): boolean {
  return sensitivity === "restricted" || sensitivity === "secret";
}

function previewText(value: unknown, maxLength: number): string {
  const text = Array.isArray(value)
    ? value.join(", ")
    : value !== null && typeof value === "object"
      ? JSON.stringify(value)
      : String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

export async function qaDummyFillTab(tabId: number, tabUrl: string): Promise<void> {
  debugLog("[qaDummyFillTab] START tabId=", tabId, "url=", tabUrl);

  if (isUnsupportedUrl(tabUrl)) {
    return;
  }

  let allForms: ExtractedForm[] = [];

  const loaded = await ensureContentScript(tabId);
  if (!loaded) return;

  const response = await withTimeout(sendMessage("scan", null, { context: "content-script", tabId }));
  if (response) {
    allForms = [...allForms, ...response.forms];
  }

  try {
    const frameResults = await chrome.webNavigation.getAllFrames({ tabId });
    if (frameResults) {
      const iframeIds = frameResults
        .filter((frame) => frame.frameId !== 0)
        .map((frame) => frame.frameId);

      for (const frameId of iframeIds) {
        let frameResponse = await withTimeout(
          sendMessage("scan", null, { context: "content-script", tabId, frameId })
        );

        if (!frameResponse) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId, frameIds: [frameId] },
              files: getContentScriptFiles(),
            });
          } catch (injectErr) {
            // ignore
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          frameResponse = await withTimeout(
            sendMessage("scan", null, { context: "content-script", tabId, frameId })
          );
        }

        if (frameResponse) {
          const taggedForms = frameResponse.forms.map((form: ExtractedForm) => ({
            ...form,
            formId: `frame_${frameId}_${form.formId}`,
            fields: form.fields.map((field) => ({
              ...field,
              frameId: String(frameId),
            })),
          }));
          allForms = [...allForms, ...taggedForms];
        }
      }
    }
  } catch (scanError) {
    debugWarn("[qaDummyFillTab] iframe scanning not available:", scanError);
  }

  if (allForms.length === 0) return;

  const mappings: FieldMapping[] = allForms.flatMap((form) =>
    form.fields
      .filter((f) => f.isVisible && !f.disabled && !f.readOnly)
      .map((field) => ({
        fieldId: field.fieldId,
        profileKey: "qa.dummy",
        value: generateDummyDataForField(field),
        valueSource: "manual",
        confidence: 1.0,
        risk: "safe",
        preselected: true,
        requiresExplicitApproval: false,
        reason: "QA Dummy Fill",
        usedFactIds: []
      }))
  );

  const byFrame = new Map<string | undefined, FieldMapping[]>();
  for (const mapping of mappings) {
    const field = allForms.flatMap((form) => form.fields).find((item) => item.fieldId === mapping.fieldId);
    const frameId = field?.frameId;
    byFrame.set(frameId, [...(byFrame.get(frameId) ?? []), mapping]);
  }

  for (const [frameId, frameMappings] of byFrame) {
    const destination = frameId
      ? { context: "content-script" as const, tabId, frameId: Number(frameId) }
      : { context: "content-script" as const, tabId };
    await withTimeout(sendMessage("fill", { mappings: frameMappings }, destination));
  }
}