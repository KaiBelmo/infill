import { StrictMode, useCallback, useEffect, useMemo, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import { MemoryView } from "./components/MemoryView";
import { OptionsToast } from "./components/OptionsToast";
import { ProfileView } from "./components/ProfileView";
import { useOptionsState } from "./hooks/useOptionsState";
import { initBridge } from "@/cloudClient";
import { sendMessage } from "webext-bridge/options";
import { debugLog } from "@/shared/debug-log";
import "../styles.css";

initBridge(sendMessage);

const tabButtonBase = "inline-flex min-h-9 flex-1 items-center justify-center whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold tracking-[-0.01em] transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black/10";
const settingsViews = ["memory", "profile", "facts", "sync"] as const;

function Options() {
  const state = useOptionsState();
  const undoNoticeText = useMemo(() => (
    state.clearedFactsUndo
      ? state.clearedFactsUndo.type === "deleted_profile"
        ? `Deleted ${state.clearedFactsUndo.profile.name}`
        : state.clearedFactsUndo.type === "deleted_fact"
          ? `Removed ${state.clearedFactsUndo.fact.label}`
          : `Cleared ${state.clearedFactsUndo.facts.length} fact${state.clearedFactsUndo.facts.length === 1 ? "" : "s"}`
      : ""
  ), [state.clearedFactsUndo]);

  const handleTabKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = settingsViews.indexOf(state.activeView);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      state.setActiveView(settingsViews[(currentIndex + 1) % settingsViews.length]);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      state.setActiveView(settingsViews[(currentIndex - 1 + settingsViews.length) % settingsViews.length]);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      state.setActiveView(settingsViews[0]);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      state.setActiveView(settingsViews[settingsViews.length - 1]);
    }
  }, [state.activeView, state.setActiveView]);

  useEffect(() => {
    debugLog("[options-toast] render decision", {
      hasUndo: Boolean(state.clearedFactsUndo),
      undoText: undoNoticeText,
      toast: state.toast,
      willRender: state.clearedFactsUndo ? "undo" : state.toast ? "toast" : "none"
    });
  }, [state.clearedFactsUndo, state.toast, undoNoticeText]);

  return (
    <main className="min-h-screen bg-[var(--color-page)] bg-[radial-gradient(circle_at_12%_-4%,rgba(0,0,0,0.04)_0,rgba(0,0,0,0)_28%),radial-gradient(circle_at_84%_12%,rgba(0,0,0,0.08)_0,rgba(0,0,0,0)_26%),linear-gradient(180deg,#fefefe_0%,#f5f5f5_42%,#fefefe_100%)] px-4 py-4 text-[var(--color-ink)] sm:px-6 sm:py-6">
      <div className="mx-auto grid max-w-6xl gap-4">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-black/10 bg-white/65 backdrop-blur-2xl backdrop-saturate-150 px-4 py-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)] backdrop-blur-2xl backdrop-saturate-150 sm:px-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-black">Extension settings</span>
            <h1 className="m-0 [font-family:var(--font-display)] text-[28px] font-[800] tracking-[-0.04em] sm:text-[32px]">Infill</h1>
            <p className="m-0 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
              Manage local profile memory, review what Infill can fill, and keep cloud access secondary.
            </p>
          </div>

          <div
            aria-label="Settings sections"
            className="grid w-full grid-cols-2 gap-1 rounded-full border border-black/10 bg-white/68 backdrop-blur-xl backdrop-saturate-150 p-1 shadow-[0_2px_12px_rgba(0,0,0,0.035)] sm:grid-cols-4 lg:w-auto lg:min-w-[430px]"
            role="tablist"
            onKeyDown={handleTabKeyDown}
          >
            <button
              aria-controls="memory-panel"
              aria-selected={state.activeView === "memory"}
              className={`${tabButtonBase} ${state.activeView === "memory" ? "bg-black text-white shadow-[0_8px_18px_rgba(0,0,0,0.14)]" : "text-black/60 hover:bg-black/[0.06] hover:text-black"}`}
              id="memory-tab"
              onClick={() => state.setActiveView("memory")}
              role="tab"
              tabIndex={state.activeView === "memory" ? 0 : -1}
              type="button"
            >
              Memory
            </button>
            <button
              aria-controls="profile-panel"
              aria-selected={state.activeView === "profile"}
              className={`${tabButtonBase} ${state.activeView === "profile" ? "bg-black text-white shadow-[0_8px_18px_rgba(0,0,0,0.14)]" : "text-black/60 hover:bg-black/[0.06] hover:text-black"}`}
              id="profile-tab"
              onClick={() => state.setActiveView("profile")}
              role="tab"
              tabIndex={state.activeView === "profile" ? 0 : -1}
              type="button"
            >
              Profile
            </button>
            <button
              aria-controls="facts-panel"
              aria-selected={state.activeView === "facts"}
              className={`${tabButtonBase} ${state.activeView === "facts" ? "bg-black text-white shadow-[0_8px_18px_rgba(0,0,0,0.14)]" : "text-black/60 hover:bg-black/[0.06] hover:text-black"}`}
              id="facts-tab"
              onClick={() => state.setActiveView("facts")}
              role="tab"
              tabIndex={state.activeView === "facts" ? 0 : -1}
              type="button"
            >
              Facts
            </button>
            <button
              aria-controls="sync-panel"
              aria-selected={state.activeView === "sync"}
              className={`${tabButtonBase} ${state.activeView === "sync" ? "bg-black text-white shadow-[0_8px_18px_rgba(0,0,0,0.14)]" : "text-black/60 hover:bg-black/[0.06] hover:text-black"}`}
              id="sync-tab"
              onClick={() => state.setActiveView("sync")}
              role="tab"
              tabIndex={state.activeView === "sync" ? 0 : -1}
              type="button"
            >
              Sync & Cloud
            </button>
          </div>
        </header>

        {state.activeView === "memory" ? (
          <MemoryView
            status={state.status}
            extensionState={state.extensionState}
            memoryText={state.memoryText}
            setMemoryText={state.setMemoryText}
            detectedFacts={state.detectedFacts}
            pendingConflicts={state.pendingConflicts}
            profiles={state.profiles}
            facts={state.facts}
            activeProfile={state.activeProfile}
            safeFacts={state.safeFacts}
            restrictedCount={state.restrictedCount}
            approvedDetectedFacts={state.approvedDetectedFacts}
            reviewCount={state.reviewCount}
            canParseWithLlm={state.canParseWithLlm}
            parsingWithLlm={state.parsingWithLlm}
            hasStatusOverlay={Boolean(state.clearedFactsUndo || state.toast)}
            switchProfile={state.switchProfile}
            setStatus={state.setStatus}
            reviewMemory={state.reviewMemory}
            reviewMemoryWithLlm={state.reviewMemoryWithLlm}
            saveApprovedFacts={state.saveApprovedFacts}
            updateDetectedFact={state.updateDetectedFact}
            removeDetectedFact={state.removeDetectedFact}
            resolveConflict={state.resolveConflict}
          />
        ) : (
          <ProfileView
            key={state.activeView}
            activeSection={state.activeView}
            extensionState={state.extensionState}
            newProfileName={state.newProfileName}
            setNewProfileName={state.setNewProfileName}
            cloudState={state.cloudState}
            cloudMessage={state.cloudMessage}
            isSignedIn={state.isSignedIn}
            cloudPlan={state.cloudPlan}
            canUseCloud={state.canUseCloud}
            billingActionLabel={state.billingActionLabel}
            profiles={state.profiles}
            facts={state.facts}
            activeProfile={state.activeProfile}
            switchProfile={state.switchProfile}
            setStatus={state.setStatus}
            createProfile={state.createProfile}
            removeActiveProfile={state.removeActiveProfile}
            removeFact={state.removeFact}
            editFact={state.editFact}
            refreshProfileSync={state.refreshProfileSync}
            applyProfileSync={state.applyProfileSync}
            resolveProfileSyncConflict={state.resolveProfileSyncConflict}
            enableEncryptedSync={state.enableEncryptedSync}
            unlockEncryptedSync={state.unlockEncryptedSync}
            lockEncryptedSync={state.lockEncryptedSync}
            toggleCloudAssist={state.toggleCloudAssist}
            saveLocalOllamaConfig={state.saveLocalOllamaConfig}
            detectLocalOllamaModels={state.detectLocalOllamaModels}
            refreshSessionState={state.refreshSessionState}
            disconnectCloud={state.disconnectCloud}
            openBillingPage={state.openBillingPage}
            startOAuth={state.startOAuth}
            setActiveView={state.setActiveView}
            openCheckout={state.openCheckout}
            devices={state.devices}
            loadDevices={state.loadDevices}
            extensionVersion={state.extensionVersion}
          />
        )}
      </div>
      {state.clearedFactsUndo ? (
        <OptionsToast
          action={{ label: "Undo", onClick: state.undoClearFacts }}
        >
          {undoNoticeText}
        </OptionsToast>
      ) : state.toast ? (
        <OptionsToast
          tone={state.toast.tone}
        >
          {state.toast.message}
        </OptionsToast>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Options />
  </StrictMode>
);
