import { useEffect, useMemo, useRef } from "react";
import type { ExtensionState } from "@/shared/types";
import { useProfileStore } from "@/background/profile-store";
import { useSyncEncryptionStore } from "@/background/sync-encryption-store";
import { normalizeCloudMessage, useCloudClientStore } from "@/shared/stores/cloud-client-store";
import { useOptionsStore, getInitialView, type ReviewableFact, type SettingsView } from "../options-store";
import { debugLog } from "@/shared/debug-log";
import { useShallow } from "zustand/react/shallow";

export type { ReviewableFact, SettingsView };

type ProfileStateSlice = Pick<
  ReturnType<typeof useProfileStore.getState>,
  "activeProfileId" | "profiles" | "pendingConflicts" | "pendingProfileSync" | "recentLearnedCount" | "recentLearnedUndos"
>;

type SyncEncryptionSlice = {
  enabled: ReturnType<typeof useSyncEncryptionStore.getState>["enabled"];
  salt: ReturnType<typeof useSyncEncryptionStore.getState>["salt"];
  kdfIterations: ReturnType<typeof useSyncEncryptionStore.getState>["kdfIterations"];
  encryptionVersion: ReturnType<typeof useSyncEncryptionStore.getState>["encryptionVersion"];
  hasRemoteProfiles: ReturnType<typeof useSyncEncryptionStore.getState>["hasRemoteProfiles"];
  remoteProfileCount: ReturnType<typeof useSyncEncryptionStore.getState>["remoteProfileCount"];
  unlocked: boolean;
};

declare global {
  interface Window {
    __infillOptionsDebug?: {
      showToast: (message?: string, tone?: "default" | "error") => void;
      setStatus: (message?: string, tone?: "default" | "error") => void;
      snapshot: () => ReturnType<typeof useOptionsStore.getState>;
    };
  }
}

const selectProfileState = (state: ReturnType<typeof useProfileStore.getState>): ProfileStateSlice => ({
  activeProfileId: state.activeProfileId,
  profiles: state.profiles,
  pendingConflicts: state.pendingConflicts,
  pendingProfileSync: state.pendingProfileSync,
  recentLearnedCount: state.recentLearnedCount,
  recentLearnedUndos: state.recentLearnedUndos
});

const selectSyncEncryptionState = (state: ReturnType<typeof useSyncEncryptionStore.getState>): SyncEncryptionSlice => ({
  enabled: state.enabled,
  salt: state.salt,
  kdfIterations: state.kdfIterations,
  encryptionVersion: state.encryptionVersion,
  hasRemoteProfiles: state.hasRemoteProfiles,
  remoteProfileCount: state.remoteProfileCount,
  unlocked: Boolean(state.getDerivedKey())
});

const selectCloudState = (state: ReturnType<typeof useCloudClientStore.getState>) => ({
  cloudState: state.cloudState,
  isSignedIn: state.isSignedIn,
  canUseCloud: state.canUseCloud,
  cloudPlan: state.cloudPlan,
  cloudMessage: state.cloudMessage,
  devices: state.devices
});

const selectOptionsState = (state: ReturnType<typeof useOptionsStore.getState>) => ({
  activeView: state.activeView,
  memoryText: state.memoryText,
  detectedFacts: state.detectedFacts,
  newProfileName: state.newProfileName,
  status: state.status,
  parsingWithLlm: state.parsingWithLlm,
  clearedFactsUndo: state.clearedFactsUndo,
  clearedFactsUndoId: state.clearedFactsUndoId,
  toast: state.toast
});

export function buildOptionsExtensionState(
  profileState: ProfileStateSlice,
  syncEncryptionState: SyncEncryptionSlice
): ExtensionState {
  const activeProfile = profileState.profiles.find((profile) => profile.id === profileState.activeProfileId)
    ?? profileState.profiles[0];

  return {
    activeProfileId: activeProfile?.id ?? profileState.activeProfileId,
    profiles: profileState.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      type: profile.type,
      isDefault: profile.isDefault,
      locked: profile.locked,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      factCount: profile.facts.length
    })),
    facts: activeProfile?.facts ?? [],
    pendingConflicts: profileState.pendingConflicts,
    pendingProfileSync: profileState.pendingProfileSync,
    recentLearnedCount: profileState.recentLearnedCount,
    recentLearnedUndos: profileState.recentLearnedUndos,
    syncEncryption: {
      enabled: syncEncryptionState.enabled,
      salt: syncEncryptionState.salt,
      kdfIterations: syncEncryptionState.kdfIterations,
      encryptionVersion: syncEncryptionState.encryptionVersion,
      unlocked: syncEncryptionState.unlocked,
      hasRemoteProfiles: syncEncryptionState.hasRemoteProfiles,
      remoteProfileCount: syncEncryptionState.remoteProfileCount
    }
  };
}

export function useOptionsState() {
  const profileState = useProfileStore(useShallow(selectProfileState));
  const syncEncryptionState = useSyncEncryptionStore(useShallow(selectSyncEncryptionState));
  const extensionState = useMemo(
    () => buildOptionsExtensionState(profileState, syncEncryptionState),
    [profileState, syncEncryptionState]
  );
  const { cloudState, isSignedIn, canUseCloud, cloudPlan, cloudMessage, devices } = useCloudClientStore(useShallow(selectCloudState));
  const cloudActions = useCloudClientStore.getState();

  const {
    activeView,
    memoryText,
    detectedFacts,
    newProfileName,
    status,
    parsingWithLlm,
    clearedFactsUndo,
    clearedFactsUndoId,
    toast
  } = useOptionsStore(useShallow(selectOptionsState));

  const actions = useOptionsStore.getState();

  useEffect(() => {
    debugLog("[options-toast] selected state", {
      toast,
      hasUndo: Boolean(clearedFactsUndo),
      undoType: clearedFactsUndo?.type,
      activeView
    });
  }, [activeView, clearedFactsUndo, toast]);

  useEffect(() => {
    window.__infillOptionsDebug = {
      showToast(message = "Toast debug probe", tone = "default") {
        actions.notify(message, tone);
      },
      setStatus(message = "Status debug probe", tone = "default") {
        actions.setStatus(message, tone);
      },
      snapshot() {
        return useOptionsStore.getState();
      }
    };
    debugLog("[options-toast] debug hook ready", {
      commands: [
        "__infillOptionsDebug.showToast()",
        "__infillOptionsDebug.setStatus()",
        "__infillOptionsDebug.snapshot()"
      ]
    });
    return () => {
      delete window.__infillOptionsDebug;
    };
  }, []);

  useEffect(() => {
    actions.syncStatusFromProfile();
  }, [extensionState.activeProfileId, extensionState.facts.length]);

  useEffect(() => {
    debugLog("[options] profile state snapshot", {
      activeProfileId: extensionState.activeProfileId,
      profiles: extensionState.profiles.length,
      facts: extensionState.facts.length,
      pendingConflicts: extensionState.pendingConflicts.length,
      pendingProfileSyncConflicts: extensionState.pendingProfileSync?.conflictCount ?? 0,
      recentLearnedCount: extensionState.recentLearnedCount
    });
  }, [
    extensionState.activeProfileId,
    extensionState.profiles.length,
    extensionState.facts.length,
    extensionState.pendingConflicts.length,
    extensionState.pendingProfileSync?.conflictCount,
    extensionState.recentLearnedCount
  ]);

  // Init cloud client store on mount + sync on visibility
  useEffect(() => {
    cloudActions.init();
    cloudActions.syncOnVisible();
  }, []);

  useEffect(() => {
    chrome.storage.session.get("infillAuthError").then((result) => {
      const message = result.infillAuthError;
      if (typeof message !== "string" || !message.trim()) return;
      const normalizedMessage = normalizeCloudMessage(message);
      cloudActions.setCloudMessage(normalizedMessage);
      actions.setStatus(normalizedMessage, "error");
      actions.setActiveView("profile");
      void chrome.storage.session.remove("infillAuthError");
    }).catch(() => undefined);
  }, []);

  const profiles = extensionState.profiles;
  const facts = extensionState.facts;
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === extensionState.activeProfileId),
    [extensionState.activeProfileId, profiles]
  );
  const pendingConflicts = extensionState.pendingConflicts;
  const safeFacts = useMemo(() => facts.filter((fact) => fact.sensitivity !== "secret"), [facts]);
  const restrictedCount = useMemo(
    () => facts.filter((fact) => fact.sensitivity === "restricted" || fact.sensitivity === "secret").length,
    [facts]
  );
  const approvedDetectedFacts = useMemo(() => detectedFacts.filter((fact) => fact.approved).length, [detectedFacts]);
  const reviewCount = useMemo(() => detectedFacts.filter((fact) => !fact.approved).length, [detectedFacts]);
  const billingActionLabel = canUseCloud ? "Manage billing" : "Upgrade to Pro";
  const extensionVersion = chrome.runtime.getManifest().version;
  const cloudConfigLoaded = Boolean(cloudState);
  const localOllamaEnabled = cloudState ? cloudState.config.localOllamaEnabled : false;
  const canParseWithLlm = localOllamaEnabled || canUseCloud;
  const parserNotice = canUseCloud
    ? "Cloud AI parsing is available for this account."
    : localOllamaEnabled
      ? "Profile parsing uses local Ollama for unsubscribed users. Keep Ollama running with a model installed; otherwise Infill falls back to limited local review."
      : "No LLM is connected. Infill can do limited local review, but connect Ollama or enable cloud AI for reliable profile parsing and smart form assist.";
  const shownParserNoticeRef = useRef<string | undefined>(undefined);
  const memoryInputHadTextRef = useRef(false);
  const shownMemoryInputNoticeRef = useRef(false);

  useEffect(() => {
    if (activeView !== "memory" || !cloudConfigLoaded || canParseWithLlm) return;
    if (shownParserNoticeRef.current === parserNotice) return;
    actions.notify(parserNotice);
    shownParserNoticeRef.current = parserNotice;
  }, [activeView, canParseWithLlm, cloudConfigLoaded, parserNotice]);

  useEffect(() => {
    const hasMemoryText = memoryText.trim().length > 0;
    if (activeView !== "memory" || !cloudConfigLoaded || canParseWithLlm) {
      memoryInputHadTextRef.current = hasMemoryText;
      return;
    }

    if (!hasMemoryText) {
      memoryInputHadTextRef.current = false;
      shownMemoryInputNoticeRef.current = false;
      return;
    }

    if (!memoryInputHadTextRef.current && !shownMemoryInputNoticeRef.current) {
      actions.notify(parserNotice);
      shownMemoryInputNoticeRef.current = true;
    }
    memoryInputHadTextRef.current = true;
  }, [activeView, canParseWithLlm, cloudConfigLoaded, memoryText, parserNotice]);

  // Sync tab state when URL hash changes (e.g. browser navigation)
  useEffect(() => {
    const handleHashChange = () => {
      const view = getInitialView();
      if (view !== activeView) {
        actions.setActiveView(view);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [activeView, actions.setActiveView]);

  // Sync URL hash when activeView changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      const targetHash = `#/${activeView}`;
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
    }
  }, [activeView]);

  // Redirect to profile page if user is logged in and has profile data, and no specific hash is set
  useEffect(() => {
    const hash = window.location.hash;
    const hasSpecificHash = hash === "#/profile" || hash === "#/facts" || hash === "#/sync" || hash === "#/memory" ||
                            hash === "#profile" || hash === "#facts" || hash === "#sync" || hash === "#memory";
    if (!hasSpecificHash && isSignedIn && facts.length > 0) {
      actions.setActiveView("profile");
    }
  }, [isSignedIn, facts.length, actions.setActiveView]);

  return {
    activeView, setActiveView: actions.setActiveView,
    extensionState,
    memoryText, setMemoryText: actions.setMemoryText,
    detectedFacts,
    newProfileName, setNewProfileName: actions.setNewProfileName,
    status, setStatus: actions.setStatus,
    clearedFactsUndo,
    clearedFactsUndoId,
    toast,
    cloudState,
    cloudMessage,
    parsingWithLlm,
    profiles, facts, activeProfile, pendingConflicts,
    safeFacts, restrictedCount,
    approvedDetectedFacts, reviewCount,
    isSignedIn, cloudPlan, canUseCloud, canParseWithLlm, parserNotice, billingActionLabel,
    reviewMemory: actions.reviewMemory, reviewMemoryWithLlm: actions.reviewMemoryWithLlm,
    saveApprovedFacts: actions.saveApprovedFacts, updateDetectedFact: actions.updateDetectedFact, removeDetectedFact: actions.removeDetectedFact,
    removeFact: actions.removeFact, editFact: actions.editFact, switchProfile: actions.switchProfile, createProfile: actions.createProfile, removeActiveProfile: actions.removeActiveProfile,
    undoClearFacts: actions.undoClearFacts,
    dismissUndoNotification: actions.dismissUndoNotification,
    dismissToast: actions.dismissToast,
    resolveConflict: actions.resolveConflict,
    refreshProfileSync: actions.refreshProfileSync,
    applyProfileSync: actions.applyProfileSync,
    resolveProfileSyncConflict: actions.resolveProfileSyncConflict,
    enableEncryptedSync: actions.enableEncryptedSync,
    unlockEncryptedSync: actions.unlockEncryptedSync,
    lockEncryptedSync: actions.lockEncryptedSync,
    toggleCloudAssist: cloudActions.toggleCloudAssist,
    saveLocalOllamaConfig: cloudActions.saveLocalOllamaConfig,
    detectLocalOllamaModels: cloudActions.detectLocalOllamaModels,
    refreshSessionState: cloudActions.refreshSession,
    disconnectCloud: cloudActions.disconnectCloud,
    openBillingPage: cloudActions.openBilling,
    startOAuth: cloudActions.startOAuth,
    openCheckout: cloudActions.openCheckout,
    devices, loadDevices: cloudActions.loadDevices,
    extensionVersion
  };
}
