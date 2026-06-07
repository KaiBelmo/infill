import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CloudState, DeviceInfo, ExtensionState } from "@/shared/types";
import type { ProfileCategory, ProfileFact, Sensitivity } from "@infill/shared";
import {
  inputClass,
  inputClassSm,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  secondaryButtonClassMd,
  secondaryButtonClassSm,
  sectionHeadingLabelClass,
  sectionHeadingTitleClass
} from "@/shared/ui-styles";
import { OptionsNotice } from "./OptionsNotice";

type ProfileSection = "profile" | "facts" | "sync";
type ConfirmAction = "delete_profile" | "disconnect" | "keep_local" | "import_cloud" | "merge";
type DialogState =
  | { type: "edit_fact"; fact: ProfileFact }
  | { type: "confirm"; action: ConfirmAction; title: string; body: string; confirmLabel: string }
  | undefined;

type ProfileViewProps = {
  activeSection: ProfileSection;
  extensionState: ExtensionState;
  newProfileName: string;
  setNewProfileName: (value: string) => void;
  cloudState: CloudState | null;
  cloudMessage: string;
  isSignedIn: boolean;
  cloudPlan: string;
  canUseCloud: boolean;
  billingActionLabel: string;
  profiles: ExtensionState["profiles"];
  facts: ExtensionState["facts"];
  activeProfile: ExtensionState["profiles"][number] | undefined;
  switchProfile: (profileId: string) => Promise<void>;
  setStatus: (value: string) => void;
  createProfile: () => Promise<void>;
  removeActiveProfile: () => Promise<void>;
  removeFact: (id: string) => Promise<void>;
  editFact: (input: { id: string; label: string; value: string; category: ProfileCategory; sensitivity: Sensitivity }) => Promise<void>;
  refreshProfileSync: () => Promise<void>;
  applyProfileSync: (action: "keep_local" | "import_cloud" | "merge") => Promise<void>;
  resolveProfileSyncConflict: (conflictId: string, action: "keep_local" | "use_cloud" | "keep_both") => Promise<void>;
  enableEncryptedSync: (passphrase: string) => Promise<void>;
  unlockEncryptedSync: (passphrase: string) => Promise<void>;
  lockEncryptedSync: () => Promise<void>;
  toggleCloudAssist: (enabled: boolean) => Promise<string | void>;
  toggleDeveloperMode: (enabled: boolean) => Promise<string | void>;
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
  refreshSessionState: () => Promise<string | void>;
  disconnectCloud: () => Promise<string | void>;
  openBillingPage: () => void;
  startOAuth: () => void;
  setActiveView: (view: "memory" | "profile" | "facts" | "sync") => void;
  openCheckout: () => Promise<string | void>;
  devices: DeviceInfo[];
  loadDevices: () => Promise<string | void>;
  extensionVersion: string;
};

const categories: ProfileCategory[] = [
  "identity", "contact", "address", "work", "education", "finance", "travel", "health",
  "legal", "family", "social", "preferences", "documents", "company", "custom"
];
const sensitivities: Sensitivity[] = ["public", "normal", "sensitive", "restricted", "secret"];

const quietCardClass = "rounded-[16px] border border-[var(--color-line)] bg-white px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";
const dividerClass = "border-t border-[var(--color-line)] pt-3";
const dangerButtonClass = "inline-flex h-10 items-center justify-center rounded-xl border border-[rgba(215,0,21,0.22)] bg-white px-4 text-sm font-semibold text-[var(--color-danger)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45";

function ProfileViewComponent(props: ProfileViewProps) {
  const {
    activeSection,
    extensionState,
    newProfileName,
    setNewProfileName,
    cloudState,
    cloudMessage,
    isSignedIn,
    cloudPlan,
    canUseCloud,
    billingActionLabel,
    profiles,
    facts,
    activeProfile,
    switchProfile,
    setStatus,
    createProfile,
    removeActiveProfile,
    removeFact,
    editFact,
    refreshProfileSync,
    applyProfileSync,
    resolveProfileSyncConflict,
    enableEncryptedSync,
    unlockEncryptedSync,
    lockEncryptedSync,
    toggleCloudAssist,
    toggleDeveloperMode,
    saveLocalOllamaConfig,
    detectLocalOllamaModels,
    refreshSessionState,
    disconnectCloud,
    openBillingPage,
    startOAuth,
    setActiveView,
    openCheckout,
    devices,
    loadDevices,
    extensionVersion
  } = props;

  const [localOllamaEnabled, setLocalOllamaEnabled] = useState(false);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://localhost:11434/v1");
  const [ollamaModel, setOllamaModel] = useState("llama3.1");
  const [detectedOllamaModels, setDetectedOllamaModels] = useState<string[]>([]);
  const [detectingOllamaModels, setDetectingOllamaModels] = useState(false);
  const [localOllamaFallbackToCloud] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState("");
  const [showEnableSyncPrompt, setShowEnableSyncPrompt] = useState(false);
  const [showUnlockSyncPrompt, setShowUnlockSyncPrompt] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [categoryFilter, setCategoryFilter] = useState<"all" | ProfileCategory>("all");
  const [openMenuFactId, setOpenMenuFactId] = useState<string>();
  const [expandedFactId, setExpandedFactId] = useState<string>();
  const [dialog, setDialog] = useState<DialogState>();
  const [syncReviewOpen, setSyncReviewOpen] = useState(false);
  const lastDialogTriggerRef = useRef<HTMLElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const cloudConfig = cloudState?.config;

  useEffect(() => {
    if (!cloudConfig) return;

    setLocalOllamaEnabled((current) => (
      current === cloudConfig.localOllamaEnabled ? current : cloudConfig.localOllamaEnabled
    ));
    setOllamaBaseUrl((current) => (
      current === cloudConfig.ollamaBaseUrl ? current : cloudConfig.ollamaBaseUrl
    ));
    setOllamaModel((current) => (
      current === cloudConfig.ollamaModel ? current : cloudConfig.ollamaModel
    ));
    setDetectedOllamaModels((current) => {
      const next = cloudConfig.ollamaModelOptions ?? [];
      return current.length === next.length && current.every((item, index) => item === next[index]) ? current : next;
    });
  }, [cloudConfig?.localOllamaEnabled, cloudConfig?.ollamaBaseUrl, cloudConfig?.ollamaModel, cloudConfig?.ollamaModelOptions]);

  useEffect(() => {
    if (!dialog) return;
    const id = window.setTimeout(() => cancelButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [dialog]);

  const filteredFacts = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    return facts.filter((fact) => {
      const matchesCategory = categoryFilter === "all" || fact.category === categoryFilter;
      if (!matchesCategory) return false;
      if (!normalized) return true;
      return [fact.label, String(fact.value), fact.category].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [categoryFilter, deferredQuery, facts]);

  const cloudAssistEnabled = cloudConfig?.cloudAssistEnabled !== false;
  const showOllamaSettings = !canUseCloud || localOllamaEnabled;
  const destructiveProfileActionLabel = activeProfile?.isDefault ? "Clean all facts" : "Delete profile";
  const sectionTitle = activeSection === "profile" ? "Profile" : activeSection === "facts" ? "Facts" : "Sync & Cloud";
  const sectionSubtitle = activeSection === "profile"
    ? "Manage local profile variants and profile-level actions."
    : activeSection === "facts"
      ? "Search, edit, categorize, and remove saved profile facts."
      : "Manage account access, cloud assist, private sync, devices, and session state.";
  const syncPreview = extensionState.pendingProfileSync;
  const syncUnlocked = Boolean(extensionState.syncEncryption?.enabled && extensionState.syncEncryption?.unlocked);
  const panelId = activeSection === "profile" ? "profile-panel" : activeSection === "facts" ? "facts-panel" : "sync-panel";
  const panelLabelledBy = activeSection === "profile" ? "profile-tab" : activeSection === "facts" ? "facts-tab" : "sync-tab";

  const openDialog = useCallback((nextDialog: DialogState, trigger?: HTMLElement | null) => {
    lastDialogTriggerRef.current = trigger ?? document.activeElement as HTMLElement | null;
    setDialog(nextDialog);
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(undefined);
    window.setTimeout(() => lastDialogTriggerRef.current?.focus(), 0);
  }, []);

  const saveOllamaSettings = useCallback(async () => {
    const message = await saveLocalOllamaConfig({
      localOllamaEnabled,
      ollamaBaseUrl,
      ollamaModel,
      localOllamaFallbackToCloud
    });
    setStatus(message);
  }, [
    localOllamaEnabled,
    localOllamaFallbackToCloud,
    ollamaBaseUrl,
    ollamaModel,
    saveLocalOllamaConfig,
    setStatus
  ]);

  const detectOllamaModels = useCallback(async () => {
    setDetectingOllamaModels(true);
    setStatus("Checking local Ollama models...");
    try {
      const result = await detectLocalOllamaModels({
        baseUrl: ollamaBaseUrl,
        model: ollamaModel
      });
      if (result.models.length > 0 || result.clearModels) {
        setDetectedOllamaModels(result.models);
      }
      if (result.selectedModel) {
        setOllamaModel(result.selectedModel);
      }
      setStatus(result.message);
    } finally {
      setDetectingOllamaModels(false);
    }
  }, [detectLocalOllamaModels, ollamaBaseUrl, ollamaModel, setStatus]);

  const toggleCloudAssistAndReport = useCallback(async () => {
    const message = await toggleCloudAssist(!cloudAssistEnabled);
    if (message) setStatus(message);
  }, [cloudAssistEnabled, setStatus, toggleCloudAssist]);

  const toggleDeveloperModeAndReport = useCallback(async () => {
    const isCurrentlyEnabled = cloudConfig?.developerModeEnabled ?? false;
    const message = await toggleDeveloperMode(!isCurrentlyEnabled);
    if (message) setStatus(message);
  }, [cloudConfig?.developerModeEnabled, setStatus, toggleDeveloperMode]);

  const openCheckoutAndReport = useCallback(async () => {
    const message = await openCheckout();
    if (message) setStatus(message);
  }, [openCheckout, setStatus]);

  const refreshSessionAndReport = useCallback(async () => {
    const message = await refreshSessionState();
    if (message) setStatus(message);
  }, [refreshSessionState, setStatus]);

  const disconnectCloudAndReport = useCallback(async () => {
    const message = await disconnectCloud();
    if (message) setStatus(message);
  }, [disconnectCloud, setStatus]);

  const loadDevicesAndReport = useCallback(async () => {
    const message = await loadDevices();
    setStatus(message || "Loaded linked devices.");
  }, [loadDevices, setStatus]);

  const reviewSyncChanges = useCallback(async () => {
    setSyncReviewOpen(true);
    await refreshProfileSync();
  }, [refreshProfileSync]);

  const runConfirmed = useCallback(async (action: ConfirmAction) => {
    closeDialog();
    if (action === "delete_profile") return removeActiveProfile();
    if (action === "disconnect") return disconnectCloudAndReport();
    return applyProfileSync(action);
  }, [applyProfileSync, closeDialog, disconnectCloudAndReport, removeActiveProfile]);

  const confirmFor = useCallback((action: ConfirmAction, trigger: HTMLElement) => {
    const previewText = syncPreview
      ? `${syncPreview.localProfileCount} local profiles, ${syncPreview.cloudProfileCount} cloud profiles, ${syncPreview.conflictCount} conflicts.`
      : "Local profiles stay unchanged until this is confirmed.";
    const labels: Record<ConfirmAction, [string, string, string]> = {
      delete_profile: [destructiveProfileActionLabel + "?", activeProfile?.isDefault ? "This clears saved facts from the default profile." : `This removes ${activeProfile?.name ?? "this profile"} from local profiles.`, destructiveProfileActionLabel],
      disconnect: ["Disconnect cloud account?", "This ends the current cloud session on this extension.", "Disconnect"],
      keep_local: ["Keep local only?", `${previewText} Cloud changes will not be imported.`, "Keep local only"],
      import_cloud: ["Import cloud profiles?", `${previewText} Cloud profiles will be added locally after confirmation.`, "Import cloud profiles"],
      merge: ["Merge local and cloud profiles?", `${previewText} Local facts win when duplicates exist.`, "Merge profiles"]
    };
    const [title, body, confirmLabel] = labels[action];
    openDialog({ type: "confirm", action, title, body, confirmLabel }, trigger);
  }, [activeProfile?.isDefault, activeProfile?.name, destructiveProfileActionLabel, openDialog, syncPreview]);

  const toggleExpandedFact = useCallback((factId: string) => {
    setExpandedFactId((current) => current === factId ? undefined : factId);
  }, []);

  const toggleFactMenu = useCallback((factId: string) => {
    setOpenMenuFactId((current) => current === factId ? undefined : factId);
  }, []);

  const closeFactMenu = useCallback(() => {
    setOpenMenuFactId(undefined);
  }, []);

  const openFactEditor = useCallback((fact: ProfileFact, trigger: HTMLElement) => {
    setOpenMenuFactId(undefined);
    openDialog({ type: "edit_fact", fact }, trigger);
  }, [openDialog]);

  const removeFactFromMenu = useCallback((factId: string) => {
    setOpenMenuFactId(undefined);
    void removeFact(factId);
  }, [removeFact]);

  const saveEditedFact = useCallback(async (input: {
    id: string;
    label: string;
    value: string;
    category: ProfileCategory;
    sensitivity: Sensitivity;
  }) => {
    await editFact(input);
    closeDialog();
  }, [closeDialog, editFact]);

  return (
    <section aria-labelledby={panelLabelledBy} className="tab-panel-enter grid gap-4" id={panelId} role="tabpanel" tabIndex={0}>
      <section className={`${panelClass} grid gap-4 p-4 sm:p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-2">
            <span className={sectionHeadingLabelClass}>Gemini</span>
            <h2 className="m-0 text-[28px] font-[760] tracking-[-0.035em] text-[var(--color-ink)] sm:text-[32px]" id="profile-title">
              {sectionTitle}
            </h2>
            <p className="m-0 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
              {sectionSubtitle}
            </p>
          </div>
          {activeSection === "facts" ? null : (
            <div className="grid grid-cols-3 gap-2 text-sm sm:min-w-[300px]">
              <SummaryStat label="Facts" value={facts.length} />
              <SummaryStat label="Profiles" value={profiles.length} />
              <SummaryStat label="Cloud" value={isSignedIn ? cloudPlan : "Off"} />
            </div>
          )}
        </div>
      </section>

      {activeSection === "profile" ? (
        <section className={`${panelClass} grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_300px]`}>
          <div className="grid gap-4">
            <section className={quietCardClass}>
              <div className="mb-4 grid gap-1">
                <span className={sectionHeadingLabelClass}>Active profile</span>
                <h3 className={`${sectionHeadingTitleClass} m-0`}>{activeProfile?.name ?? "Saved profile"}</h3>
              </div>
              <div className="grid gap-2" role="radiogroup" aria-label="Active profile">
                {profiles.map((profile) => {
                  const selected = profile.id === extensionState.activeProfileId;
                  return (
                    <button
                      aria-checked={selected}
                      className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(17,17,19,0.08)] ${selected ? "border-[rgba(17,17,19,0.2)] bg-[var(--color-black-soft)] text-white" : "border-[var(--color-line)] bg-[var(--color-mist)] text-[var(--color-ink)] hover:bg-white"}`}
                      key={profile.id}
                      role="radio"
                      type="button"
                      onClick={() => switchProfile(profile.id).catch(() => setStatus("Could not switch profiles."))}
                    >
                      <span className="font-semibold">{profile.name}</span>
                      <span className={selected ? "text-xs text-white/72" : "text-xs text-[var(--color-ink-muted)]"}>
                        {profile.factCount} facts
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={quietCardClass}>
              <div className="mb-4 grid gap-1">
                <span className={sectionHeadingLabelClass}>Create new profile</span>
                <h3 className="m-0 text-base font-semibold text-[var(--color-ink)]">Local variant</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-[var(--color-ink)]">Name</span>
                  <input className={inputClass} id="new-profile-name" value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="Work" />
                </label>
                <button className={primaryButtonClass} type="button" onClick={createProfile}>Create profile</button>
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-4">
            <section className={quietCardClass}>
              <div className="grid gap-3">
                <h3 className="m-0 text-base font-semibold text-[var(--color-ink)]">Profile actions</h3>
                <button className={secondaryButtonClass} type="button" onClick={() => setActiveView("memory")}>Add facts</button>
              </div>
            </section>
            <section className={`${quietCardClass} border-[rgba(215,0,21,0.22)]`}>
              <div className="grid gap-3">
                <h3 className="m-0 text-base font-semibold text-[var(--color-danger)]">Danger zone</h3>
                <p className="m-0 text-sm leading-6 text-[var(--color-ink-soft)]">{activeProfile?.isDefault ? "Default profiles stay available; their facts can be cleared." : "Deleting a profile removes its local facts."}</p>
                <button className={dangerButtonClass} type="button" disabled={Boolean(activeProfile?.isDefault && facts.length === 0)} onClick={(event) => confirmFor("delete_profile", event.currentTarget)}>
                  {destructiveProfileActionLabel}
                </button>
              </div>
            </section>
          </aside>
        </section>
      ) : null}

      {activeSection === "facts" ? (
        <section className={`${panelClass} grid gap-4 p-4 sm:p-5`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="grid gap-1">
              <span className={sectionHeadingLabelClass}>{facts.length} total</span>
              <h3 className={`${sectionHeadingTitleClass} m-0`}>Profile facts</h3>
            </div>
            <button className={secondaryButtonClassMd} type="button" onClick={() => setActiveView("memory")}>Add fact</button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">Search facts</span>
              <input className={inputClassSm} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search labels or values" />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">Category</span>
              <select className={inputClassSm} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as "all" | ProfileCategory)}>
                <option value="all">All categories</option>
                {categories.map((category) => <option key={category} value={category}>{titleCase(category)}</option>)}
              </select>
            </label>
          </div>

          {facts.length === 0 ? (
            <EmptyState title="No facts saved" body="Add approved memory items to start filling from this profile." />
          ) : filteredFacts.length === 0 ? (
            <EmptyState title="No matching facts" body="Change the search or category filter to see more saved facts." />
          ) : (
            <div className="overflow-x-auto rounded-[14px] border border-[var(--color-line)] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
              <table className="min-w-[820px] w-full border-collapse bg-white text-left text-sm">
                <thead className="sticky top-0 z-[1] bg-[var(--color-mist)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-3.5 py-2.5">Name</th>
                    <th className="px-3.5 py-2.5">Value</th>
                    <th className="px-3.5 py-2.5">Category</th>
                    <th className="px-3.5 py-2.5">Sensitivity</th>
                    <th className="w-[88px] px-3.5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFacts.map((fact) => (
                    <FactRow
                      key={fact.id}
                      fact={fact}
                      expanded={expandedFactId === fact.id}
                      menuOpen={openMenuFactId === fact.id}
                      onToggleExpanded={toggleExpandedFact}
                      onToggleMenu={toggleFactMenu}
                      onCloseMenu={closeFactMenu}
                      onEdit={openFactEditor}
                      onRemove={removeFactFromMenu}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeSection === "sync" ? (
        <section className={`${panelClass} grid gap-4 p-4 sm:p-5 xl:grid-cols-2`}>
          {!isSignedIn ? (
            <section className={quietCardClass}>
              <div className="grid max-w-xl gap-4">
                <h3 className={`${sectionHeadingTitleClass} m-0`}>Account</h3>
                <p className="m-0 text-sm leading-6 text-[var(--color-ink-soft)]">{cloudMessage}</p>
                <button className={primaryButtonClass} type="button" onClick={startOAuth}>Sign in with web app</button>
              </div>
            </section>
          ) : (
            <>
              <section className={quietCardClass}>
                <div className="grid gap-4">
                  <div>
                    <span className={sectionHeadingLabelClass}>Account</span>
                    <h3 className={`${sectionHeadingTitleClass} m-0 mt-1`}>{cloudState?.auth?.user.email ?? "Connected"}</h3>
                    <p className="m-0 mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">Plan: {cloudPlan}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button className={secondaryButtonClassMd} type="button" onClick={openCheckoutAndReport}>{billingActionLabel}</button>
                    <button className={secondaryButtonClassMd} type="button" onClick={openBillingPage}>Open web app</button>
                  </div>
                </div>
              </section>
            </>
          )}

          <section className={quietCardClass}>
            <div className="grid gap-4">
              <div>
                <span className={sectionHeadingLabelClass}>AI assist</span>
                <h3 className={`${sectionHeadingTitleClass} m-0 mt-1`}>Cloud assist: {cloudAssistEnabled && canUseCloud ? "Available" : "Off"}</h3>
                <p className="m-0 mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">Local Ollama: {localOllamaEnabled ? "Enabled" : "Disabled"}</p>
              </div>
              <label className="flex items-start gap-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                <input className="mt-1" type="checkbox" checked={localOllamaEnabled} onChange={(event) => setLocalOllamaEnabled(event.target.checked)} />
                <span>{canUseCloud ? "Use local Ollama instead of cloud AI" : "Enable local Ollama on this device"}</span>
              </label>
              {!canUseCloud ? <OptionsNotice>Use local Ollama without signing in. Cloud assist stays off until a qualifying plan is active.</OptionsNotice> : null}
              {showOllamaSettings ? (
                <div className="grid gap-3">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-[var(--color-ink)]">Ollama base URL</span>
                    <input className={inputClassSm} value={ollamaBaseUrl} onChange={(event) => {
                      setOllamaBaseUrl(event.target.value);
                      setDetectedOllamaModels([]);
                    }} />
                  </label>
                  <button className={secondaryButtonClassMd} type="button" disabled={detectingOllamaModels} onClick={detectOllamaModels}>
                    {detectingOllamaModels ? "Detecting models..." : "Detect Ollama models"}
                  </button>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-[var(--color-ink)]">Ollama model</span>
                    {detectedOllamaModels.length > 0 ? (
                      <select className={inputClassSm} value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)}>
                        {detectedOllamaModels.map((model) => <option key={model} value={model}>{model}</option>)}
                      </select>
                    ) : (
                      <input className={inputClassSm} value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)} />
                    )}
                  </label>
                  <button className={primaryButtonClass} type="button" onClick={saveOllamaSettings}>Save AI settings</button>
                </div>
              ) : null}
              {canUseCloud ? (
                <div className={dividerClass}>
                  <button className={secondaryButtonClassMd} type="button" onClick={toggleCloudAssistAndReport}>
                    {cloudAssistEnabled ? "Disable cloud assist" : "Enable cloud assist"}
                  </button>
                  <p className="m-0 mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                    {cloudAssistEnabled ? "Cloud assist can answer when local mode is not preferred." : "Cloud assist is disabled. Local mode still works."}
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          {isSignedIn ? (
            <>

              <section className={`${quietCardClass} xl:col-span-2`}>
                <div className="grid gap-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <span className={sectionHeadingLabelClass}>Profile sync</span>
                      <h3 className={`${sectionHeadingTitleClass} m-0 mt-1`}>
                        {syncPreview ? `${syncPreview.localProfileCount} local, ${syncPreview.cloudProfileCount} cloud, ${syncPreview.conflictCount} conflicts` : "Local facts win by default"}
                      </h3>
                    </div>
                    {syncUnlocked ? (
                      <button className={primaryButtonClass} type="button" onClick={reviewSyncChanges}>Review sync changes</button>
                    ) : null}
                  </div>

                  <SyncUnlockControls
                    extensionState={extensionState}
                    passphraseInput={passphraseInput}
                    setPassphraseInput={setPassphraseInput}
                    showEnableSyncPrompt={showEnableSyncPrompt}
                    setShowEnableSyncPrompt={setShowEnableSyncPrompt}
                    showUnlockSyncPrompt={showUnlockSyncPrompt}
                    setShowUnlockSyncPrompt={setShowUnlockSyncPrompt}
                    enableEncryptedSync={enableEncryptedSync}
                    unlockEncryptedSync={unlockEncryptedSync}
                    lockEncryptedSync={lockEncryptedSync}
                  />

                  {syncReviewOpen && syncPreview && syncUnlocked ? (
                    <div className={`${dividerClass} grid gap-4`}>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <SyncMetric label="Local profiles" value={syncPreview.localProfileCount} />
                        <SyncMetric label="Cloud profiles" value={syncPreview.cloudProfileCount} />
                        <SyncMetric label="Conflicts" value={syncPreview.conflictCount} />
                        <SyncMetric label="Facts unchanged" value={Math.max(0, facts.length - syncPreview.conflictCount)} />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button className={secondaryButtonClassMd} type="button" onClick={(event) => confirmFor("keep_local", event.currentTarget)}>Keep local only</button>
                        <button className={secondaryButtonClassMd} type="button" onClick={(event) => confirmFor("import_cloud", event.currentTarget)}>Import cloud profiles</button>
                        <button className={primaryButtonClass} type="button" onClick={(event) => confirmFor("merge", event.currentTarget)}>Merge local + cloud</button>
                      </div>
                      {syncPreview.conflicts.length > 0 ? (
                        <div className="grid gap-3">
                          {syncPreview.conflicts.map((conflict) => (
                            <article className="grid gap-3 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-mist)] px-4 py-3" key={conflict.id}>
                              <strong className="text-sm text-[var(--color-ink)]">{conflict.factLabel}</strong>
                              <span className="text-xs leading-5 text-[var(--color-ink-soft)]">{conflict.profileName} / {conflict.factKey}</span>
                              <p className="m-0 text-sm leading-6 text-[var(--color-ink-soft)]">Local: {String(conflict.localFact.value)} / Cloud: {String(conflict.cloudFact.value)}</p>
                              <div className="flex flex-wrap gap-2">
                                <button className={secondaryButtonClassSm} type="button" onClick={() => resolveProfileSyncConflict(conflict.id, "keep_local")}>Keep local</button>
                                <button className={secondaryButtonClassSm} type="button" onClick={() => resolveProfileSyncConflict(conflict.id, "use_cloud")}>Use cloud</button>
                                <button className={secondaryButtonClassSm} type="button" onClick={() => resolveProfileSyncConflict(conflict.id, "keep_both")}>Keep both</button>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : !syncUnlocked ? (
                    <p className="m-0 text-sm leading-6 text-[var(--color-ink-soft)]">Unlock private profile sync before reviewing import or merge actions.</p>
                  ) : null}
                </div>
              </section>

              <section className={quietCardClass}>
                <div className="grid gap-4">
                  <div>
                    <span className={sectionHeadingLabelClass}>Linked devices</span>
                    <h3 className={`${sectionHeadingTitleClass} m-0 mt-1`}>{devices.length > 0 ? `${devices.length} devices linked` : "No linked devices shown"}</h3>
                  </div>
                  <button className={secondaryButtonClassMd} type="button" onClick={loadDevicesAndReport}>Manage devices</button>
                  {devices.length > 0 ? (
                    <ul className="m-0 grid max-h-60 gap-2 overflow-y-auto p-0">
                      {devices.map((device) => (
                        <li className="list-none rounded-xl bg-[var(--color-mist)] px-3 py-2 text-sm" key={device.id}>
                          {device.name}
                          <span className="block pt-1 text-xs text-[var(--color-ink-soft)]">{device.browser ?? device.platform ?? ""}</span>
                          <span className="block pt-1 text-xs text-[var(--color-ink-soft)]">Last seen {new Date(device.lastSeenAt).toLocaleDateString()}</span>
                          {device.revokedAt ? <span className="mt-2 inline-flex rounded-full bg-[rgba(215,0,21,0.1)] px-2 py-1 text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-danger)]">Revoked</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}

          <section className={quietCardClass}>
            <div className="grid gap-4">
              <div>
                <span className={sectionHeadingLabelClass}>Advanced</span>
                <h3 className={`${sectionHeadingTitleClass} m-0 mt-1`}>Settings</h3>
              </div>
              <label className="flex items-start gap-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                <input className="mt-1" type="checkbox" checked={cloudConfig?.developerModeEnabled ?? false} onChange={toggleDeveloperModeAndReport} />
                <span>Developer Mode (Enables QA Dummy Fill)</span>
              </label>
              {isSignedIn ? (
                <>
                  <div className={dividerClass}>
                    <h4 className="m-0 mb-3 text-sm font-semibold text-[var(--color-ink)]">Session</h4>
                    <button className={secondaryButtonClassMd} type="button" onClick={refreshSessionAndReport} disabled={!cloudState?.auth?.refreshToken}>Refresh session</button>
                  </div>
                  <div className={dividerClass}>
                    <h4 className="m-0 mb-3 text-sm font-semibold text-[var(--color-danger)]">Danger zone</h4>
                    <button className={dangerButtonClass} type="button" onClick={(event) => confirmFor("disconnect", event.currentTarget)}>Disconnect</button>
                  </div>
                </>
              ) : null}
              <p className="m-0 text-[11px] font-[760] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Extension v{extensionVersion}</p>
            </div>
          </section>
        </section>
      ) : null}

      {dialog?.type === "edit_fact" ? <FactEditorModal fact={dialog.fact} onCancel={closeDialog} onSave={saveEditedFact} /> : null}
      {dialog?.type === "confirm" ? (
        <ConfirmModal
          dialog={dialog}
          cancelRef={cancelButtonRef}
          onCancel={closeDialog}
          onConfirm={() => void runConfirmed(dialog.action)}
        />
      ) : null}
    </section>
  );
}

export const ProfileView = memo(ProfileViewComponent);

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-mist)] px-3.5 py-2.5"><span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">{label}</span><strong className="mt-1 block text-base text-[var(--color-ink)]">{value}</strong></div>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="rounded-[16px] border border-dashed border-[var(--color-line)] bg-[var(--color-mist)] px-4 py-8"><strong className="text-sm text-[var(--color-ink)]">{title}</strong><p className="m-0 mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">{body}</p></div>;
}

const FactRow = memo(function FactRow(props: {
  fact: ProfileFact;
  expanded: boolean;
  menuOpen: boolean;
  onToggleExpanded: (factId: string) => void;
  onToggleMenu: (factId: string) => void;
  onCloseMenu: () => void;
  onEdit: (fact: ProfileFact, trigger: HTMLElement) => void;
  onRemove: (factId: string) => void;
}) {
  const { fact, expanded, menuOpen, onToggleExpanded, onToggleMenu, onCloseMenu, onEdit, onRemove } = props;
  const menuRef = useRef<HTMLDivElement | null>(null);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseMenu();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? index + 1 : index - 1;
      items[(next + items.length) % items.length]?.focus();
    }
  }

  return (
    <>
      <tr className="border-t border-[var(--color-line)] align-top">
        <td className="px-3.5 py-2.5 font-semibold text-[var(--color-ink)]">{fact.label}</td>
        <td className="max-w-[440px] px-3.5 py-2.5 text-[var(--color-ink-soft)]"><span className="line-clamp-2 break-words leading-5">{String(fact.value)}</span></td>
        <td className="px-3.5 py-2.5 text-[var(--color-ink-soft)]"><span className="inline-flex rounded-full bg-[var(--color-mist)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-soft)]">{titleCase(fact.category)}</span></td>
        <td className="px-3.5 py-2.5 text-[var(--color-ink-soft)]"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${sensitivityChipClass(fact.sensitivity)}`}>{titleCase(fact.sensitivity)}</span></td>
        <td className="relative px-3.5 py-2.5 text-right">
          <button className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] bg-white text-base font-bold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]" type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Actions for ${fact.label}`} onClick={() => onToggleMenu(fact.id)}>...</button>
          {menuOpen ? (
            <div ref={menuRef} className="absolute right-3 z-10 mt-1.5 grid min-w-36 gap-1 rounded-xl border border-[var(--color-line)] bg-white p-1.5 text-left shadow-[0_14px_34px_rgba(15,23,42,0.13)]" role="menu" onKeyDown={onMenuKeyDown}>
              <button className="rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-mist)]" role="menuitem" type="button" onClick={(event) => onEdit(fact, event.currentTarget)}>Edit</button>
              <button className="rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-mist)]" role="menuitem" type="button" onClick={() => onToggleExpanded(fact.id)}>{expanded ? "Hide key" : "View key"}</button>
              <button className="rounded-lg px-3 py-2 text-left text-sm text-[var(--color-danger)] hover:bg-[rgba(215,0,21,0.08)]" role="menuitem" type="button" onClick={() => onRemove(fact.id)}>Remove</button>
            </div>
          ) : null}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-[var(--color-line)] bg-[var(--color-mist)]">
          <td className="px-3.5 py-2.5 text-xs leading-5 text-[var(--color-ink-soft)]" colSpan={5}>
            Key: {fact.key} / Created: {formatDate(fact.createdAt)} / Updated: {formatDate(fact.updatedAt)} / Source: {fact.source}
          </td>
        </tr>
      ) : null}
    </>
  );
});

function FactEditorModal({ fact, onCancel, onSave }: { fact: ProfileFact; onCancel: () => void; onSave: (input: { id: string; label: string; value: string; category: ProfileCategory; sensitivity: Sensitivity }) => Promise<void> }) {
  const [label, setLabel] = useState(fact.label);
  const [value, setValue] = useState(String(fact.value));
  const [category, setCategory] = useState<ProfileCategory>(fact.category);
  const [sensitivity, setSensitivity] = useState<Sensitivity>(fact.sensitivity);
  const isValid = label.trim().length > 0 && value.trim().length > 0;

  return (
    <ModalShell title="Edit fact" description={`Internal key is preserved: ${fact.key}`} onCancel={onCancel}>
      <div className="grid gap-3">
        <label className="grid gap-2"><span className="text-sm font-semibold">Label</span><input className={inputClassSm} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <label className="grid gap-2"><span className="text-sm font-semibold">Value</span><textarea className={`${inputClassSm} min-h-28 resize-y`} value={value} onChange={(event) => setValue(event.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2"><span className="text-sm font-semibold">Category</span><select className={inputClassSm} value={category} onChange={(event) => setCategory(event.target.value as ProfileCategory)}>{categories.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label>
          <label className="grid gap-2"><span className="text-sm font-semibold">Sensitivity</span><select className={inputClassSm} value={sensitivity} onChange={(event) => setSensitivity(event.target.value as Sensitivity)}>{sensitivities.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className={secondaryButtonClassMd} type="button" onClick={onCancel}>Cancel</button>
        <button className={primaryButtonClass} type="button" disabled={!isValid} onClick={() => onSave({ id: fact.id, label, value, category, sensitivity })}>Save fact</button>
      </div>
    </ModalShell>
  );
}

function ConfirmModal({ dialog, cancelRef, onCancel, onConfirm }: { dialog: Extract<DialogState, { type: "confirm" }>; cancelRef: React.RefObject<HTMLButtonElement | null>; onCancel: () => void; onConfirm: () => void }) {
  const isDanger = dialog.action === "delete_profile" || dialog.action === "disconnect";
  return (
    <ModalShell title={dialog.title} description={dialog.body} onCancel={onCancel}>
      <div className="mt-4 flex justify-end gap-2">
        <button ref={cancelRef} className={secondaryButtonClassMd} type="button" onClick={onCancel}>Cancel</button>
        <button className={isDanger ? dangerButtonClass : primaryButtonClass} type="button" onClick={onConfirm}>{dialog.confirmLabel}</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, description, children, onCancel }: { title: string; description: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid overflow-y-auto bg-black/24 px-4 py-6 sm:place-items-center sm:px-6" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <section className="my-auto w-full max-w-xl rounded-[18px] border border-[var(--color-line)] bg-white p-4 shadow-[0_20px_56px_rgba(0,0,0,0.18)] sm:p-5" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title" aria-describedby="settings-modal-description">
        <h3 className={`${sectionHeadingTitleClass} m-0`} id="settings-modal-title">{title}</h3>
        <p className="m-0 mt-2 text-sm leading-6 text-[var(--color-ink-soft)]" id="settings-modal-description">{description}</p>
        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}

function SyncMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-mist)] px-3 py-3"><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">{label}</span><strong className="mt-1 block text-base text-[var(--color-ink)]">{value}</strong></div>;
}

function SyncUnlockControls(props: {
  extensionState: ExtensionState;
  passphraseInput: string;
  setPassphraseInput: (value: string) => void;
  showEnableSyncPrompt: boolean;
  setShowEnableSyncPrompt: (value: boolean) => void;
  showUnlockSyncPrompt: boolean;
  setShowUnlockSyncPrompt: (value: boolean) => void;
  enableEncryptedSync: (passphrase: string) => Promise<void>;
  unlockEncryptedSync: (passphrase: string) => Promise<void>;
  lockEncryptedSync: () => Promise<void>;
}) {
  const { extensionState, passphraseInput, setPassphraseInput, showEnableSyncPrompt, setShowEnableSyncPrompt, showUnlockSyncPrompt, setShowUnlockSyncPrompt, enableEncryptedSync, unlockEncryptedSync, lockEncryptedSync } = props;
  if (!extensionState.syncEncryption?.enabled && !extensionState.syncEncryption?.hasRemoteProfiles) {
    if (!showEnableSyncPrompt) {
      return <button className={primaryButtonClass} type="button" onClick={() => setShowEnableSyncPrompt(true)}>Enable private profile sync</button>;
    }
    return <PassphrasePanel title="Setup private sync" value={passphraseInput} setValue={setPassphraseInput} primaryLabel="Enable private sync" disabled={passphraseInput.length < 8} onCancel={() => setShowEnableSyncPrompt(false)} onSubmit={async () => { await enableEncryptedSync(passphraseInput); setPassphraseInput(""); setShowEnableSyncPrompt(false); }} />;
  }
  if (!extensionState.syncEncryption?.unlocked) {
    if (!showUnlockSyncPrompt) {
      return <button className={primaryButtonClass} type="button" onClick={() => setShowUnlockSyncPrompt(true)}>Unlock private profile sync</button>;
    }
    return <PassphrasePanel title="Unlock private sync" value={passphraseInput} setValue={setPassphraseInput} primaryLabel="Unlock sync" onCancel={() => setShowUnlockSyncPrompt(false)} onSubmit={async () => { await unlockEncryptedSync(passphraseInput); setPassphraseInput(""); setShowUnlockSyncPrompt(false); }} />;
  }
  return <button className={secondaryButtonClassMd} type="button" onClick={lockEncryptedSync}>Lock private sync</button>;
}

function PassphrasePanel({ title, value, setValue, primaryLabel, disabled, onCancel, onSubmit }: { title: string; value: string; setValue: (value: string) => void; primaryLabel: string; disabled?: boolean; onCancel: () => void; onSubmit: () => Promise<void> }) {
  return <div className="grid gap-3 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-mist)] px-4 py-4"><strong className="text-sm text-[var(--color-ink)]">{title}</strong><input className={inputClassSm} type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Sync passphrase" /><div className="flex flex-wrap gap-2"><button className={primaryButtonClass} type="button" disabled={disabled} onClick={onSubmit}>{primaryLabel}</button><button className={secondaryButtonClassMd} type="button" onClick={onCancel}>Cancel</button></div></div>;
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sensitivityChipClass(sensitivity: Sensitivity): string {
  if (sensitivity === "public" || sensitivity === "normal") {
    return "bg-[rgba(36,138,61,0.12)] text-[var(--color-success)]";
  }
  if (sensitivity === "restricted" || sensitivity === "sensitive") {
    return "bg-[rgba(178,117,0,0.12)] text-[var(--color-warning)]";
  }
  return "bg-[rgba(215,0,21,0.1)] text-[var(--color-danger)]";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}
