import { useEffect, useMemo, useState } from "react";
import { useProfileStore, toPublicExtensionState } from "@/background/profile-store";
import { useCloudClientStore } from "@/shared/stores/cloud-client-store";
import type { LearnedFactUndo } from "@/shared/types";
import { usePopupStore } from "../popup-store";
import { sendMessage } from "webext-bridge/popup";
import { debugLog } from "@/shared/debug-log";

export function usePopupState() {
  const profileState = useProfileStore();
  const extensionState = useMemo(() => toPublicExtensionState(profileState), [profileState]);
  const [learnedNoticeCount, setLearnedNoticeCount] = useState(0);
  const [learnedNoticeUndo, setLearnedNoticeUndo] = useState<LearnedFactUndo | undefined>();
  const { cloudState, isSignedIn, canUseCloud } = useCloudClientStore();

  const forms = usePopupStore((s) => s.forms);
  const mappings = usePopupStore((s) => s.mappings);
  const error = usePopupStore((s) => s.error);
  const status = usePopupStore((s) => s.status);
  const debug = usePopupStore((s) => s.debug);

  const actions = usePopupStore.getState();

  // Init cloud client store on mount (guarded against double-calls internally)
  // Also sync scan state from background so popup remembers previous scan results
  useEffect(() => {
    const cloudActions = useCloudClientStore.getState();
    cloudActions.init();
    cloudActions.syncOnVisible();
    usePopupStore.getState().syncScanState();
  }, []);

  useEffect(() => {
    if (extensionState.recentLearnedCount <= 0) return;
    debugLog("[popup] recent learned facts notice", {
      recentLearnedCount: extensionState.recentLearnedCount,
      recentLearnedUndos: extensionState.recentLearnedUndos.length,
      activeProfileId: extensionState.activeProfileId,
      factCount: extensionState.facts.length
    });
    setLearnedNoticeCount(extensionState.recentLearnedCount);
    setLearnedNoticeUndo(extensionState.recentLearnedUndos[0]);
    sendMessage("clear-recent-learned-notice", null, "background").catch(() => undefined);
  }, [extensionState.recentLearnedCount]);

  useEffect(() => {
    debugLog("[popup] profile state snapshot", {
      activeProfileId: extensionState.activeProfileId,
      profiles: extensionState.profiles.length,
      facts: extensionState.facts.length,
      pendingConflicts: extensionState.pendingConflicts.length,
      recentLearnedCount: extensionState.recentLearnedCount,
      recentLearnedUndos: extensionState.recentLearnedUndos.length
    });
  }, [
    extensionState.activeProfileId,
    extensionState.profiles.length,
    extensionState.facts.length,
    extensionState.pendingConflicts.length,
    extensionState.recentLearnedCount,
    extensionState.recentLearnedUndos.length
  ]);

  async function undoRecentLearnedFact() {
    if (!learnedNoticeUndo) return;
    await sendMessage("undo-learned-fact", { undo: learnedNoticeUndo }, "background");
    setLearnedNoticeCount(0);
    setLearnedNoticeUndo(undefined);
  }

  const allFields = useMemo(() => forms.flatMap((form) => form.fields), [forms]);
  const activeProfile = useMemo(
    () => extensionState.profiles.find((profile) => profile.id === extensionState.activeProfileId),
    [extensionState.activeProfileId, extensionState.profiles]
  );
  const hasActiveProfile = Boolean(activeProfile);
  const savedFactCount = extensionState.facts.length;
  const fieldCount = allFields.length;
  const readyCount = useMemo(
    () => mappings.filter((mapping) => mapping.preselected && mapping.value !== undefined && mapping.risk !== "restricted" && mapping.risk !== "secret").length,
    [mappings]
  );
  const blockedCount = useMemo(
    () => mappings.filter((mapping) => mapping.risk === "secret" || mapping.risk === "restricted").length,
    [mappings]
  );
  const hasScannedFields = fieldCount > 0;
  const pendingConflictCount = extensionState.pendingConflicts.length;
  const signedInPlan = cloudState?.auth?.account.subscription.plan ?? "free";
  const localOllamaEnabled = Boolean(cloudState?.config.localOllamaEnabled);
  const cloudAiEnabled = Boolean(cloudState?.config.cloudAssistEnabled && canUseCloud);
  const aiAssistConfigured = localOllamaEnabled || cloudAiEnabled;
  const cloudBadge = canUseCloud
    ? `cloud ${signedInPlan}`
    : isSignedIn
      ? "local only"
      : "guest";
  const aiBadge = localOllamaEnabled
    ? "local ollama"
    : cloudAiEnabled
      ? "cloud ai"
      : "ai setup needed";
  const billingLabel = canUseCloud ? "Manage plan" : "Upgrade";
  const usageText = localOllamaEnabled
    ? "Private local AI"
    : cloudAiEnabled && cloudState?.auth?.account.credits
    ? `${cloudState.auth.account.credits.remaining} AI credits left`
    : isSignedIn
      ? "Basic matching only"
      : "AI setup needed";

  return {
    extensionState, forms, mappings, cloudState, debug,
    error, status,
    activeProfile, hasActiveProfile, savedFactCount,
    fieldCount, readyCount, blockedCount,
    hasScannedFields,
    pendingConflictCount, isSignedIn, canUseCloud,
    localOllamaEnabled, cloudAiEnabled, aiAssistConfigured,
    learnedNoticeCount, canUndoLearnedNotice: Boolean(learnedNoticeUndo), undoRecentLearnedFact,
    cloudBadge, aiBadge, billingLabel, usageText,
    changeActiveProfile: actions.changeActiveProfile, scanActiveTab: actions.scanActiveTab,
    openSettings: actions.openSettings, openBilling: actions.openBilling, startOAuth: actions.startOAuth,
  };
}
