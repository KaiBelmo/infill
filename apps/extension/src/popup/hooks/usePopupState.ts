import { useEffect, useMemo } from "react";
import { useProfileStore, toPublicExtensionState } from "@/background/profile-store";
import { useCloudClientStore } from "@/shared/stores/cloud-client-store";
import { usePopupStore } from "../popup-store";
import { debugLog } from "@/shared/debug-log";

export function usePopupState() {
  const profileState = useProfileStore();
  const extensionState = useMemo(() => toPublicExtensionState(profileState), [profileState]);
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
    isSignedIn, canUseCloud,
    localOllamaEnabled, cloudAiEnabled, aiAssistConfigured,
    cloudBadge, aiBadge, billingLabel, usageText,
    changeActiveProfile: actions.changeActiveProfile, scanActiveTab: actions.scanActiveTab,
    openSettings: actions.openSettings, openBilling: actions.openBilling, startOAuth: actions.startOAuth,
  };
}
