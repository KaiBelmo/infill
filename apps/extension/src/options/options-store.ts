import { create } from "zustand";
import { type MemoryFactDraft, parseMemoryFacts } from "@infill/profile-vault";
import type { ParsedProfileField, ProfileCategory, ProfileFact, Sensitivity } from "@infill/shared";
import { type LocalProfileRecord, useProfileStore, toPublicExtensionState } from "@/background/profile-store";
import { useSyncEncryptionStore } from "@/background/sync-encryption-store";
import { runCloudParseProfile } from "@/cloudClient";
import { applyProfileSyncDecision, prepareProfileSync, resolveProfileSyncConflict as resolveCloudProfileSyncConflict } from "@/cloudClient";
import type { LearnedFactConflict } from "@/shared/types";
import { useCloudClientStore } from "@/shared/stores/cloud-client-store";
import { findProfileKeyFromLabel, categoryForProfileKey, extractJson } from "@infill/form-brain";
import { debugLog } from "@/shared/debug-log";

export type ReviewableFact = MemoryFactDraft & {
  approved: boolean;
};

export type SettingsView = "memory" | "profile" | "facts" | "sync";

type ClearedFactsUndo = {
  type: "cleared_facts";
  profileId: string;
  profileName: string;
  facts: ProfileFact[];
} | {
  type: "deleted_profile";
  profile: LocalProfileRecord;
} | {
  type: "deleted_fact";
  profileId: string;
  fact: ProfileFact;
};

type OptionsToastMessage = {
  id: string;
  message: string;
  tone?: "default" | "error";
};

type OptionsState = {
  activeView: SettingsView;
  memoryText: string;
  detectedFacts: ReviewableFact[];
  newProfileName: string;
  status: string;
  parsingWithLlm: boolean;
  clearedFactsUndo?: ClearedFactsUndo;
  clearedFactsUndoId?: string;
  pendingEncryptedProfileSync: boolean;
  toast?: OptionsToastMessage;
};

type OptionsActions = {
  setActiveView: (view: SettingsView) => void;
  setMemoryText: (text: string) => void;
  setNewProfileName: (name: string) => void;
  setStatus: (status: string, tone?: OptionsToastMessage["tone"]) => void;
  reviewMemory: () => void;
  reviewMemoryWithLlm: () => Promise<void>;
  saveApprovedFacts: () => Promise<void>;
  updateDetectedFact: (index: number, patch: Partial<ReviewableFact>) => void;
  removeDetectedFact: (index: number) => void;
  removeFact: (id: string) => Promise<void>;
  editFact: (input: { id: string; label: string; value: string; category: ProfileCategory; sensitivity: Sensitivity }) => Promise<void>;
  switchProfile: (profileId: string) => Promise<void>;
  createProfile: () => Promise<void>;
  removeActiveProfile: () => Promise<void>;
  undoClearFacts: () => Promise<void>;
  dismissUndoNotification: () => void;
  notify: (message: string, tone?: OptionsToastMessage["tone"]) => void;
  dismissToast: () => void;
  resolveConflict: (conflict: LearnedFactConflict, action: "replace" | "keep_existing") => Promise<void>;
  refreshProfileSync: () => Promise<void>;
  applyProfileSync: (action: "keep_local" | "import_cloud" | "merge") => Promise<void>;
  resolveProfileSyncConflict: (conflictId: string, action: "keep_local" | "use_cloud" | "keep_both") => Promise<void>;
  enableEncryptedSync: (passphrase: string) => Promise<void>;
  unlockEncryptedSync: (passphrase: string) => Promise<void>;
  lockEncryptedSync: () => Promise<void>;
  syncStatusFromProfile: () => void;
};


export const useOptionsStore = create<OptionsState & OptionsActions>()((set, get) => ({
  activeView: "memory",
  memoryText: "",
  detectedFacts: [],
  newProfileName: "",
  status: "Profile not loaded",
  parsingWithLlm: false,
  clearedFactsUndo: undefined,
  clearedFactsUndoId: undefined,
  pendingEncryptedProfileSync: false,
  toast: undefined,

  setActiveView(activeView) {
    set({ activeView });
  },

  setMemoryText(memoryText) {
    set({ memoryText });
  },

  setNewProfileName(newProfileName) {
    set({ newProfileName });
  },

  setStatus(status, tone) {
    const resolvedTone = tone ?? inferToastTone(status);
    debugLog("[options-toast] setStatus", { status, tone: resolvedTone });
    set({ status });
    get().notify(status, resolvedTone);
  },

  syncStatusFromProfile() {
    const currentStatus = get().status;
    // Don't overwrite action-specific status messages (e.g. "Saved 5 approved facts", "Created profile Work")
    const isDefaultStatus = !currentStatus || currentStatus === "Profile not loaded" || currentStatus.startsWith("Profile loaded:") || currentStatus.startsWith("No profile data in");
    if (!isDefaultStatus) return;

    const ext = toPublicExtensionState(useProfileStore.getState());
    const activeProfile = ext.profiles.find((p) => p.id === ext.activeProfileId);
    set({
      status: ext.facts.length > 0
        ? `Profile loaded: ${activeProfile?.name ?? "Profile"}`
        : `No profile data in ${activeProfile?.name ?? "Profile"}`
    });
  },

  reviewMemory() {
    const { memoryText } = get();
    const parsed = parseMemoryFacts(memoryText);
    if (parsed.length === 0) {
      const message = "Paste facts as Label: Value before reviewing.";
      set({ detectedFacts: [], status: message });
      get().notify(message, "error");
      return;
    }
    const message = `${parsed.length} possible facts detected`;
    set({
      detectedFacts: parsed.map((fact) => ({
        ...fact,
        approved: fact.sensitivity === "normal"
      })),
      status: message
    });
    get().notify(message);
  },

  async reviewMemoryWithLlm() {
    const { memoryText } = get();
    if (!memoryText.trim()) {
      const message = "Paste your profile data before parsing with AI.";
      set({ status: message });
      get().notify(message, "error");
      return;
    }

    const cloudState = useCloudClientStore.getState().cloudState;
    const canUseCloud = cloudState?.auth?.account.subscription.plan === "pro" &&
      (cloudState.auth.account.subscription.status === "active" || cloudState.auth.account.subscription.status === "on_trial") &&
      cloudState.auth.sessionToken;

    if (!canUseCloud) {
      set({ parsingWithLlm: true, status: "Checking local AI (Ollama)..." });
      
      const userBaseUrl = cloudState?.config?.ollamaBaseUrl?.trim().replace(/\/$/, "") || "http://localhost:11434/v1";
      const nativeBaseUrl = userBaseUrl.replace(/\/v1\/?$/, ""); // strip /v1 if present for native tags API
      const tagsEndpoint = `${nativeBaseUrl}/api/tags`;
      const completionsEndpoint = `${userBaseUrl}/chat/completions`;

      let ollamaModel = cloudState?.config?.ollamaModel || "llama3.1";
      let hasOllama = false;

      try {
        const tagsRes = await fetch(tagsEndpoint);
        if (tagsRes.ok) {
          const tagsData = (await tagsRes.json()) as { models?: Array<{ name: string }> };
          if (tagsData.models && tagsData.models.length > 0) {
            hasOllama = true;
            // Prefer the user's configured model if available, otherwise pick the first available one
            const cleanConfigured = ollamaModel.split(":")[0] ?? ollamaModel;
            const found = tagsData.models.find(
              (m) =>
                m.name === ollamaModel ||
                m.name.startsWith(cleanConfigured + ":") ||
                m.name === cleanConfigured
            );
            if (found) {
              ollamaModel = found.name;
            } else {
              ollamaModel = tagsData.models[0].name;
            }
          }
        }
      } catch (e) {
        console.warn("Ollama is not running or unreachable at", tagsEndpoint, e);
      }

      if (!hasOllama) {
        const message = `Ollama is not running at ${nativeBaseUrl} or has no models installed. Local review is limited until an LLM is connected.`;
        set({ parsingWithLlm: false, status: message });
        get().notify(message, "error");
        get().reviewMemory();
        return;
      }

      set({ status: `Parsing profile with local AI (${ollamaModel})...` });

      try {
        const systemPrompt = [
          "You produce JSON only.",
          "Parse the user's raw profile text into structured fields.",
          "Extract: first name, last name, full name, email, phone, company, job title, street, city, state/region, zip/postal code, country, and any other identifiable fields.",
          "Use these profile key prefixes: identity (first_name, last_name, full_name, middle_name), contact (email, phone), address (street_1, street_2, city, region, postal_code, country), work (current_title), company (name).",
          "For anything that doesn't fit, use the 'custom' prefix.",
          "Return a JSON object where each key is the field label and each value is the parsed answer.",
          "Example: {\"First Name\": \"Sam\", \"Email\": \"sam@example.com\", \"City\": \"Austin\"}",
          "Never include passwords, payment details, government IDs, or secret values."
        ].join(" ");

        const res = await fetch(completionsEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: ollamaModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: memoryText }
            ],
            temperature: 0.05,
            response_format: { type: "json_object" },
            stream: false
          })
        });

        if (!res.ok) {
          throw new Error(`Ollama returned status ${res.status}`);
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from Ollama");
        }

        const jsonText = extractJson(content);
        const parsedObj = JSON.parse(jsonText);

        if (typeof parsedObj !== "object" || parsedObj === null || Array.isArray(parsedObj)) {
          throw new Error("Invalid JSON structure from Ollama");
        }

        const llmFacts: ReviewableFact[] = [];
        for (const [label, rawValue] of Object.entries(parsedObj)) {
          const valStr = typeof rawValue === "string" ? rawValue.trim() : String(rawValue).trim();
          const value = valStr.replace(/(?:\s*\[[^\]\r\n]{1,80}\]\s*)+$/g, "").trim(); // strip brackets
          if (!label || !value) continue;

          const key = findProfileKeyFromLabel(label) ?? `custom.${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
          
          const normalizedLabel = label.toLowerCase();
          let sensitivity: "secret" | "restricted" | "normal" = "normal";
          if (/\bpassword|card|bank|ssn|passport|secret|token|key\b/.test(normalizedLabel)) {
            sensitivity = "secret";
          } else if (/\bdob|birth|salary|medical|legal|citizenship\b/.test(normalizedLabel)) {
            sensitivity = "restricted";
          }

          const category = categoryForProfileKey(key);

          llmFacts.push({
            key,
            label,
            value,
            category,
            sensitivity,
            approved: sensitivity === "normal"
          });
        }

        const localParsed = parseMemoryFacts(memoryText);
        const llmKeys = new Set(llmFacts.map((fact) => fact.key));
        const extraLocal = localParsed.filter((fact) => !llmKeys.has(fact.key)).map((fact) => ({
          ...fact,
          approved: fact.sensitivity === "normal"
        }));

        set({
          detectedFacts: [...llmFacts, ...extraLocal],
          status: `Ollama (${ollamaModel}) detected ${llmFacts.length} fields${extraLocal.length > 0 ? ` + ${extraLocal.length} from local parse` : ""}`,
          parsingWithLlm: false
        });
        get().notify(`Ollama (${ollamaModel}) detected ${llmFacts.length} fields${extraLocal.length > 0 ? ` + ${extraLocal.length} from local parse` : ""}`);
      } catch (error) {
        console.error("Local AI parsing failed, falling back to local review", error);
        const message = error instanceof Error ? `Local AI failed: ${error.message}. Local review is limited until an LLM is connected.` : "Local AI failed. Local review is limited until an LLM is connected.";
        set({
          status: message,
          parsingWithLlm: false
        });
        get().notify(message, "error");
        get().reviewMemory();
      }
      return;
    }

    set({ parsingWithLlm: true, status: "Parsing profile with AI..." });

    try {
      const result = await runCloudParseProfile({ rawText: memoryText, locale: "en" });
      if (result.fields.length === 0) {
        const message = "AI could not detect any profile fields. Try local review instead.";
        set({ status: message, parsingWithLlm: false });
        get().notify(message, "error");
        return;
      }

      const llmFacts: ReviewableFact[] = result.fields.map((field: ParsedProfileField) => ({
        key: field.key,
        label: field.label,
        value: field.value,
        category: field.category,
        sensitivity: "normal" as const,
        approved: true
      }));

      const localParsed = parseMemoryFacts(memoryText);
      const llmKeys = new Set(llmFacts.map((fact) => fact.key));
      const extraLocal = localParsed.filter((fact) => !llmKeys.has(fact.key)).map((fact) => ({
        ...fact,
        approved: fact.sensitivity === "normal"
      }));

      const message = `AI detected ${result.fields.length} fields${extraLocal.length > 0 ? ` + ${extraLocal.length} from local parse` : ""}`;
      set({
        detectedFacts: [...llmFacts, ...extraLocal],
        status: message,
        parsingWithLlm: false
      });
      get().notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI parsing failed. Try local review.";
      set({ status: message, parsingWithLlm: false });
      get().notify(message, "error");
      get().reviewMemory();
    }
  },

  async saveApprovedFacts() {
    const { detectedFacts } = get();
    const approvedFacts = detectedFacts.filter((fact) => fact.approved);
    if (approvedFacts.length === 0) {
      const message = "Approve at least one detected fact before saving.";
      set({ status: message });
      get().notify(message, "error");
      return;
    }

    const profileId = useProfileStore.getState().activeProfileId;
    const store = useProfileStore.getState();
    for (const fact of approvedFacts) {
      store.saveLocalFact({
        key: fact.key,
        label: fact.label,
        value: fact.value,
        category: fact.category,
        sensitivity: fact.sensitivity,
        source: "pasted_memory",
        verified: true,
        confidence: 1
      }, profileId);
    }

    const message = `Saved ${approvedFacts.length} approved facts`;
    set({ memoryText: "", detectedFacts: [], status: message });
    get().notify(message);
  },

  updateDetectedFact(index, patch) {
    set((state) => ({
      detectedFacts: state.detectedFacts.map((fact, factIndex) =>
        factIndex === index ? { ...fact, ...patch } : fact
      )
    }));
  },

  removeDetectedFact(index) {
    set((state) => ({
      detectedFacts: state.detectedFacts.filter((_, factIndex) => factIndex !== index)
    }));
  },

  async removeFact(id) {
    const { activeProfileId, profiles } = useProfileStore.getState();
    const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
    const fact = activeProfile?.facts.find((item) => item.id === id);
    if (!fact) {
      const message = "That fact is no longer available.";
      set({ status: message });
      get().notify(message, "error");
      return;
    }
    useProfileStore.getState().deleteLocalFact(id, activeProfileId);
    const undoId = crypto.randomUUID();
    set({
      status: `Removed ${fact.label}.`,
      clearedFactsUndo: { type: "deleted_fact", profileId: activeProfileId, fact },
      clearedFactsUndoId: undoId
    });
    scheduleUndoNotificationDismiss(undoId, syncEncryptedProfilesAfterUndoWindow);
  },

  async editFact(input) {
    const { activeProfileId, profiles } = useProfileStore.getState();
    const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
    const fact = activeProfile?.facts.find((item) => item.id === input.id);
    if (!fact) {
      const message = "That fact is no longer available.";
      set({ status: message });
      get().notify(message, "error");
      return;
    }

    const label = input.label.trim();
    const value = input.value.trim();
    if (!label || !value) {
      const message = "Fact label and value are required.";
      set({ status: message });
      get().notify(message, "error");
      return;
    }

    useProfileStore.getState().saveLocalFact({
      id: fact.id,
      key: fact.key,
      label,
      value,
      category: input.category,
      sensitivity: input.sensitivity,
      source: fact.source,
      verified: fact.verified,
      confidence: fact.confidence
    }, activeProfileId);

    set({ status: `Updated ${label}.` });
    get().notify(`Updated ${label}.`);
  },

  async switchProfile(profileId) {
    useProfileStore.getState().setActiveProfile(profileId);
  },

  async createProfile() {
    const { newProfileName } = get();
    const name = newProfileName.trim();
    if (!name) {
      const message = "Enter a profile name before creating it.";
      set({ status: message });
      get().notify(message, "error");
      return;
    }
    useProfileStore.getState().createLocalProfile(name, "custom");
    const message = `Created profile ${name}`;
    set({ newProfileName: "", status: message });
    get().notify(message);
  },

  async removeActiveProfile() {
    const { activeProfileId, profiles } = useProfileStore.getState();
    const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
    try {
      if (activeProfile?.isDefault) {
        const facts = [...activeProfile.facts];
        useProfileStore.getState().clearLocalProfileFacts(activeProfileId);
        const undoId = crypto.randomUUID();
        set({
          status: `Cleared ${facts.length} fact${facts.length === 1 ? "" : "s"}.`,
          clearedFactsUndo: facts.length > 0
            ? { type: "cleared_facts", profileId: activeProfileId, profileName: activeProfile.name, facts }
            : undefined,
          clearedFactsUndoId: facts.length > 0 ? undoId : undefined
        });
        if (facts.length > 0) {
          scheduleUndoNotificationDismiss(undoId, syncEncryptedProfilesAfterUndoWindow);
        } else {
          void syncEncryptedProfilesAfterUndoWindow();
        }
        return;
      }
      if (!activeProfile) {
        throw new Error("That profile is no longer available.");
      }
      const deletedProfile = { ...activeProfile, facts: [...activeProfile.facts] };
      useProfileStore.getState().deleteLocalProfile(activeProfileId);
      const undoId = crypto.randomUUID();
      set({
        status: `Profile ${activeProfile.name} removed.`,
        clearedFactsUndo: { type: "deleted_profile", profile: deletedProfile },
        clearedFactsUndoId: undoId
      });
      scheduleUndoNotificationDismiss(undoId);
      const cloudState = useCloudClientStore.getState().cloudState;
      void deleteCloudProfileAfterLocalChange(activeProfileId, cloudState?.auth?.sessionToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not remove profile.";
      set({ status: message });
      get().notify(message, "error");
    }
  },

  async undoClearFacts() {
    const undo = get().clearedFactsUndo;
    if (!undo) {
      const message = "Nothing to undo.";
      set({ status: message });
      get().notify(message, "error");
      return;
    }
    try {
      if (undo.type === "deleted_profile") {
        useProfileStore.getState().restoreLocalProfile(undo.profile);
        const message = `Restored ${undo.profile.name}.`;
        set({ status: message, clearedFactsUndo: undefined, clearedFactsUndoId: undefined });
        get().notify(message);
        return;
      }

      if (undo.type === "deleted_fact") {
        useProfileStore.getState().restoreLocalFact(undo.profileId, undo.fact);
        const message = `Restored ${undo.fact.label}.`;
        set({ status: message, clearedFactsUndo: undefined, clearedFactsUndoId: undefined });
        get().notify(message);
        return;
      }

      useProfileStore.getState().replaceLocalProfileFacts(undo.profileId, undo.facts);
      const message = `Restored ${undo.facts.length} fact${undo.facts.length === 1 ? "" : "s"} to ${undo.profileName}.`;
      set({ status: message, clearedFactsUndo: undefined, clearedFactsUndoId: undefined });
      get().notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not restore cleared facts.";
      set({ status: message });
      get().notify(message, "error");
    }
  },

  dismissUndoNotification() {
    set({ clearedFactsUndo: undefined, clearedFactsUndoId: undefined });
  },

  notify(message, tone = "default") {
    const id = crypto.randomUUID();
    debugLog("[options-toast] notify", { id, message, tone });
    set({ toast: { id, message, tone } });
    debugLog("[options-toast] state after notify", { toast: get().toast });
    scheduleToastDismiss(id);
  },

  dismissToast() {
    debugLog("[options-toast] dismiss", { toast: get().toast });
    set({ toast: undefined });
  },

  async resolveConflict(conflict, action) {
    useProfileStore.getState().resolveLearnedFactConflict(conflict.id, action);
    const message = action === "replace"
        ? `Updated ${conflict.existingFact.label} in ${conflict.profileName}`
        : `Kept the existing ${conflict.existingFact.label} value`;
    set({ status: message });
    get().notify(message);
  },

  async refreshProfileSync() {
    try {
      const preview = await prepareProfileSync();
      const message = preview ? `Sync review ready: ${preview.cloudProfileCount} cloud profiles, ${preview.conflictCount} conflicts` : "Sign in before checking profile sync.";
      set({ status: message });
      get().notify(message, preview ? "default" : "error");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare profile sync.";
      set({ status: message });
      get().notify(message, "error");
    }
  },

  async applyProfileSync(action) {
    try {
      const preview = await applyProfileSyncDecision(action);
      const message = preview?.conflictCount
          ? `Merged profiles with ${preview.conflictCount} conflicts to review.`
          : action === "keep_local"
            ? "Kept local profiles only."
            : action === "import_cloud"
              ? "Imported cloud profiles into local profiles."
              : "Merged local and cloud profiles.";
      set({ status: message });
      get().notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not apply profile sync.";
      set({ status: message });
      get().notify(message, "error");
    }
  },

  async resolveProfileSyncConflict(conflictId, action) {
    try {
      const preview = await resolveCloudProfileSyncConflict(conflictId, action);
      const message = preview?.conflictCount ? `${preview.conflictCount} sync conflicts left.` : "All sync conflicts resolved.";
      set({ status: message });
      get().notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not resolve sync conflict.";
      set({ status: message });
      get().notify(message, "error");
    }
  },

  async enableEncryptedSync(passphrase) {
    try {
      const { enableEncryptedSync } = await import("@/cloudClient");
      await enableEncryptedSync(passphrase);
      const message = get().pendingEncryptedProfileSync
        ? "Private profile sync enabled. Cloud facts updated."
        : "Private profile sync enabled.";
      set({
        status: message,
        pendingEncryptedProfileSync: false
      });
      get().notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not enable private sync.";
      set({ status: message });
      get().notify(message, "error");
      throw error;
    }
  },

  async unlockEncryptedSync(passphrase) {
    try {
      const { unlockEncryptedSync } = await import("@/cloudClient");
      const preview = await unlockEncryptedSync(passphrase);
      if (get().pendingEncryptedProfileSync) {
        const { syncEncryptedProfilesIfUnlocked } = await import("@/cloudClient");
        const synced = await syncEncryptedProfilesIfUnlocked();
        if (synced) {
          const message = "Private sync unlocked. Cloud facts updated.";
          set({ status: message, pendingEncryptedProfileSync: false });
          get().notify(message);
          return;
        }
      }
      const message = preview ? `Sync unlocked. ${preview.conflictCount} conflicts.` : "Private sync unlocked.";
      set({ status: message });
      get().notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Incorrect passphrase.";
      set({ status: message });
      get().notify(message, "error");
      throw error;
    }
  },

  async lockEncryptedSync() {
    try {
      const { lockEncryptedSync } = await import("@/cloudClient");
      await lockEncryptedSync();
      const message = "Private sync locked.";
      set({ status: message });
      get().notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not lock sync.";
      set({ status: message });
      get().notify(message, "error");
    }
  },

}));

useOptionsStore.subscribe((state, previousState) => {
  if (
    state.toast === previousState.toast &&
    state.clearedFactsUndo === previousState.clearedFactsUndo &&
    state.status === previousState.status
  ) {
    return;
  }

  debugLog("[options-toast] store subscription", {
    status: state.status,
    previousStatus: previousState.status,
    toast: state.toast,
    previousToast: previousState.toast,
    hasUndo: Boolean(state.clearedFactsUndo),
    hadUndo: Boolean(previousState.clearedFactsUndo)
  });
});

function scheduleUndoNotificationDismiss(undoId: string, afterDismiss?: () => void): void {
  debugLog("[options-toast] schedule undo dismiss", { undoId });
  globalThis.setTimeout(() => {
    const state = useOptionsStore.getState();
    debugLog("[options-toast] undo dismiss tick", {
      undoId,
      currentUndoId: state.clearedFactsUndoId,
      hasUndo: Boolean(state.clearedFactsUndo)
    });
    if (state.clearedFactsUndoId !== undoId) return;
    state.dismissUndoNotification();
    afterDismiss?.();
  }, 4000);
}

function scheduleToastDismiss(toastId: string): void {
  debugLog("[options-toast] schedule toast dismiss", { toastId });
  globalThis.setTimeout(() => {
    const state = useOptionsStore.getState();
    debugLog("[options-toast] dismiss tick", {
      toastId,
      currentToastId: state.toast?.id,
      currentToastMessage: state.toast?.message
    });
    if (state.toast?.id !== toastId) return;
    state.dismissToast();
  }, 4000);
}

function inferToastTone(message: string): OptionsToastMessage["tone"] {
  return /\b(could not|failed|error|incorrect|nothing to|enter|paste|required|unavailable)\b/i.test(message)
    ? "error"
    : "default";
}

async function deleteCloudProfileAfterLocalChange(profileId: string, sessionToken?: string): Promise<void> {
  if (!sessionToken) return;
  try {
    const { deleteCloudProfile } = await import("@/cloudClient");
    await deleteCloudProfile(profileId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local change saved, but cloud delete failed.";
    useOptionsStore.setState({ status: message });
  }
}

async function syncEncryptedProfilesAfterUndoWindow(): Promise<void> {
  try {
    const { syncEncryptedProfilesIfUnlocked } = await import("@/cloudClient");
    const synced = await syncEncryptedProfilesIfUnlocked();
    if (!synced) {
      const encryptionState = useSyncEncryptionStore.getState().getEncryptionState();
      if (!encryptionState.enabled) return;
      const message = "Removed locally. Enter your private sync passphrase to update cloud facts.";
      useOptionsStore.setState({ status: message, pendingEncryptedProfileSync: true });
      useOptionsStore.getState().notify(message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local change saved, but cloud sync failed.";
    useOptionsStore.setState({ status: message });
    useOptionsStore.getState().notify(message, "error");
  }
}
