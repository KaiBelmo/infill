import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { usePopupState } from "./hooks/usePopupState";
import { iconButtonClass, primaryButtonClass, secondaryButtonClassMd } from "@/shared/ui-styles";
import { initBridge } from "@/cloudClient";
import { sendMessage } from "webext-bridge/popup";
import "../styles.css";

initBridge(sendMessage);


function Popup() {
  const state = usePopupState();
  const [dismissedOllamaNoticeKey, setDismissedOllamaNoticeKey] = useState<string | null>(null);
  const activeFactCount = state.savedFactCount;
  const isBusy = state.status === "Scanning" || state.status === "Filling";
  const primaryActionLabel = !state.hasActiveProfile
    ? "Open settings"
    : isBusy
      ? state.status === "Scanning" ? "Scanning…" : "Filling…"
      : state.hasScannedFields
        ? "Scan again"
        : "Scan this page";
  const primaryActionDisabled = state.hasActiveProfile ? isBusy : false;
  const accountLabel = state.isSignedIn
    ? state.cloudState?.auth?.user.email ?? "Signed in"
    : "Not signed in";
  const metricsText = `${state.fieldCount} fields found • ${state.readyCount} ready • ${state.blockedCount} blocked`;
  const ollama403Reason = [
    state.error,
    state.debug?.llmKeyMatcher?.reason,
    state.debug?.cloudAssistStatus
  ].filter(Boolean).join(" ");
  const hasOllamaOriginBlockReason = /ollama/i.test(ollama403Reason) && /http\s*403|403/i.test(ollama403Reason);
  const ollamaNoticeKey = state.debug?.generatedAt ?? ollama403Reason;
  const hasOllamaOriginBlock = hasOllamaOriginBlockReason && dismissedOllamaNoticeKey !== ollamaNoticeKey;

  useEffect(() => {
    if (!hasOllamaOriginBlockReason && dismissedOllamaNoticeKey) {
      setDismissedOllamaNoticeKey(null);
    }
  }, [dismissedOllamaNoticeKey, hasOllamaOriginBlockReason]);

  const missingFields = useMemo(() => {
    return (state.debug?.fields ?? []).filter((field) =>
      !field.ready &&
      field.valueSource === "none" &&
      (field.risk === "personal" || field.risk === "safe" || field.risk === "unknown") &&
      !(field.profileKey ?? "").includes("password")
    );
  }, [state.debug]);

  const aiGeneratedFields = useMemo(() => {
    return (state.debug?.fields ?? []).filter((field) =>
      field.valueSource === "generated_answer"
    );
  }, [state.debug]);

  function handlePrimaryAction() {
    if (!state.hasActiveProfile) {
      state.openSettings();
      return;
    }

    state.scanActiveTab();
  }

  function copyDebugJson() {
    if (!state.debug) return;
    void navigator.clipboard?.writeText(JSON.stringify(state.debug, null, 2));
  }

  return (
    <main className="flex min-h-[420px] w-[392px] flex-col gap-3 overflow-hidden bg-[linear-gradient(135deg,_#fbfaf7_0%,_#eef3f0_58%,_#f7f5f0_100%)] p-4 text-[var(--color-ink)]">
      <header className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <span className="text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">AI form filling</span>
          <h1 className="m-0 text-[28px] font-[760] tracking-[-0.05em]">Infill</h1>
          <p className="m-0 text-[13px] leading-5 text-[var(--color-ink-soft)]">
            {state.hasActiveProfile
              ? `${state.activeProfile?.name ?? "Profile"} - ${activeFactCount} saved fact${activeFactCount === 1 ? "" : "s"} - ${accountLabel}.`
              : "Create a profile to start scanning forms."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button className={iconButtonClass} type="button" onClick={state.openSettings} aria-label="Open settings">
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9">
              <path d="M4 7h10" />
              <path d="M18 7h2" />
              <path d="M16 5v4" />
              <path d="M4 17h2" />
              <path d="M10 17h10" />
              <path d="M8 15v4" />
            </svg>
          </button>
        </div>
      </header>

      <section
        aria-live="polite"
        className="grid gap-4 rounded-[28px] border border-[rgba(20,20,20,0.08)] bg-white/88 p-4 shadow-[0_18px_44px_rgba(54,64,58,0.1)] backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[rgba(36,138,61,0.12)] px-3 py-1 text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-success)]">
                {state.hasActiveProfile ? "Profile loaded" : "Profile missing"}
              </span>
              <span className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-[11px] font-[760] uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                {state.aiBadge}
              </span>
            </div>
            <div className="grid gap-1">
              <h2 className="m-0 text-[22px] font-[760] tracking-[-0.045em]">
                {isBusy
                  ? state.status === "Scanning" ? "Scanning page…" : "Filling fields…"
                  : state.hasScannedFields
                    ? "Fields filled — hover to review"
                    : state.hasActiveProfile
                      ? state.aiAssistConfigured ? "Scan this page for form fields" : "Choose an AI model to unlock smart assist"
                      : "Load a profile first"}
              </h2>
              <p className="m-0 text-[13px] leading-5 text-[var(--color-ink-soft)]">
                {isBusy
                  ? state.status === "Scanning" ? "Reading form fields and matching your profile…" : "Writing values into the page…"
                  : state.error
                    ? state.error
                    : state.pendingConflictCount > 0
                    ? `${state.pendingConflictCount} learned update${state.pendingConflictCount === 1 ? "" : "s"} need review before Infill can update this profile.`
                    : state.hasScannedFields
                      ? state.aiAssistConfigured
                        ? "Non-sensitive fields are filled. Hover any field on the page to edit or learn."
                        : "Basic matching ran without AI. Set up local Ollama or use managed cloud AI for smart assist."
                      : state.hasActiveProfile
                        ? state.aiAssistConfigured
                          ? "Infill reads visible fields, matches saved facts, and keeps sensitive fields under your control."
                          : "Infill needs an LLM for smart assist. Local Ollama is recommended; cloud AI is available as a managed upgrade."
                        : "Memory stays local unless you explicitly enable cloud assist."}
              </p>
            </div>
          </div>
        </div>

        {!state.aiAssistConfigured ? (
          <div className="grid gap-3 rounded-2xl border border-[rgba(0,0,0,0.12)] bg-[var(--color-black)] px-3.5 py-3 text-white shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
            <div className="grid gap-1">
              <h3 className="m-0 text-[11px] font-[780] uppercase tracking-[0.12em] text-white">AI assist not configured</h3>
              <p className="m-0 text-[13px] leading-5 text-white/72">
                Set up local Ollama for private AI on this device, or upgrade to managed cloud AI. Until then, Infill uses basic matching only.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-full bg-white px-3 py-2 text-[12px] font-[780] uppercase tracking-[0.12em] text-[var(--color-black)]" type="button" onClick={state.openSettings}>
                Set up Ollama
              </button>
              <button className="rounded-full border border-white/25 px-3 py-2 text-[12px] font-[780] uppercase tracking-[0.12em] text-white" type="button" onClick={state.openBilling}>
                Cloud AI
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-mist)] px-4 py-3">
          <span className="text-[13px] leading-5 text-[var(--color-ink-soft)]">{metricsText}</span>
          <span className="shrink-0 text-[13px] font-semibold text-[var(--color-ink)]">{state.usageText}</span>
        </div>

        {hasOllamaOriginBlock ? (
          <div className="rounded-2xl border border-[rgba(138,66,22,0.24)] bg-[rgba(255,248,240,0.96)] p-3.5 text-[var(--color-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1.5">
                <h3 className="m-0 text-[11px] font-[820] uppercase tracking-[0.16em] text-[rgb(132,69,28)]">Ollama access blocked</h3>
                <p className="m-0 text-[13px] leading-5 text-[var(--color-ink-soft)]">
                  Infill can't reach Ollama from this extension yet. Allow extension origins in Ollama, restart it, then try again.
                </p>
              </div>
              <button
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[rgba(0,0,0,0.08)] bg-white text-[18px] leading-none text-[var(--color-ink-soft)] transition hover:border-[rgba(0,0,0,0.18)] hover:text-[var(--color-ink)]"
                type="button"
                aria-label="Dismiss Ollama notice"
                onClick={() => setDismissedOllamaNoticeKey(ollamaNoticeKey)}
              >
                ×
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a className="rounded-full bg-[rgb(132,69,28)] px-3 py-2 text-[12px] font-[780] text-white transition hover:bg-[rgb(105,52,21)]" href="http://127.0.0.1:8788/common-problems" target="_blank" rel="noreferrer">
                How to fix it
              </a>
              <button className={`${secondaryButtonClassMd} px-3 py-2 text-[12px]`} type="button" onClick={() => setDismissedOllamaNoticeKey(ollamaNoticeKey)}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {state.learnedNoticeCount > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[rgba(0,0,0,0.12)] bg-[rgba(255,255,255,0.82)] px-3.5 py-3 text-[13px] text-[var(--color-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <span className="font-semibold">Profile updated</span>
            <div className="flex items-center gap-2">
              {state.canUndoLearnedNotice ? (
                <button
                  className="rounded-full border border-[rgba(0,0,0,0.12)] bg-white px-2.5 py-1 text-[10px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink)]"
                  type="button"
                  onClick={() => state.undoRecentLearnedFact().catch(() => undefined)}
                >
                  Undo
                </button>
              ) : null}
              <span className="rounded-full bg-[var(--color-black)] px-2.5 py-1 text-[10px] font-[780] uppercase tracking-[0.12em] text-white">
                {state.learnedNoticeCount} approved
              </span>
              <button
                className="flex h-5 w-5 items-center justify-center rounded-full text-[14px] leading-none text-[var(--color-ink-soft)] hover:bg-[rgba(0,0,0,0.06)] hover:text-[var(--color-ink)] transition"
                type="button"
                aria-label="Dismiss notice"
                onClick={state.dismissLearnedNotice}
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

        {aiGeneratedFields.length > 0 ? (
          <div className="grid gap-3 rounded-2xl border border-[rgba(0,0,0,0.12)] bg-[rgba(255,255,255,0.82)] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <h3 className="m-0 text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink)]">Approved by AI</h3>
                <p className="m-0 text-[13px] leading-5 text-[var(--color-ink-soft)]">
                  These fields need AI-generated content based on the page context.
                </p>
              </div>
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-black)]" aria-hidden="true" />
            </div>
            <div className="grid gap-2">
              {aiGeneratedFields.map((field) => (
                <div key={field.fieldId} className="grid gap-1 rounded-xl border border-[rgba(0,0,0,0.08)] bg-[var(--color-mist)] p-3">
                  <div className="grid gap-1 border-l-2 border-[var(--color-black)] pl-3">
                    <strong className="text-[13px] text-[var(--color-ink)]">{field.label}</strong>
                    <span className="text-[12px] text-[var(--color-ink-soft)]">{field.profileKey ? `${field.profileKey} - ` : ""}{field.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {missingFields.length > 0 ? (
          <div className="grid gap-3 rounded-2xl border border-[rgba(0,0,0,0.12)] bg-[var(--color-black)] px-3.5 py-3 text-white shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <h3 className="m-0 text-[11px] font-[780] uppercase tracking-[0.12em] text-white">Missing info</h3>
                <p className="m-0 text-[13px] leading-5 text-white/70">
                  Type the right values in the page fields. Infill will learn them for future fills.
                </p>
              </div>
              <span className="mt-0.5 rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-[780] uppercase tracking-[0.12em] text-white/80">
                {missingFields.length}
              </span>
            </div>
            <div className="grid gap-2">
              {missingFields.map((field) => (
                <div key={field.fieldId} className="grid gap-1 rounded-xl border border-white/12 bg-white/[0.07] p-3">
                  <div className="grid gap-1 border-l-2 border-white pl-3">
                    <strong className="text-[13px] text-white">{field.label}</strong>
                    <span className="text-[12px] text-white/62">{field.profileKey ? `${field.profileKey} - ` : ""}{field.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {state.debug ? (
          <details className="rounded-[18px] border border-[var(--color-line)] bg-white/78 px-3.5 py-3 text-[12px] text-[var(--color-ink-soft)]">
            <summary className="cursor-pointer select-none text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
              Debug scan
            </summary>
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <span>facts: {state.debug.factCount}</span>
                <span>forms: {state.debug.formCount}</span>
                <span>fields: {state.debug.fieldCount}</span>
                <span>mappings: {state.debug.mappingCount}</span>
                <span>ready: {state.debug.readyCount}</span>
                <span>filled: {state.debug.filledCount}</span>
                <span>skipped: {state.debug.skippedFillCount}</span>
                <span>{state.debug.cloudAssistStatus}</span>
              </div>
              <div className="grid gap-1">
                <h3 className="m-0 text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">LLM key matcher</h3>
                <div className="grid gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-mist)] px-3 py-2">
                  {state.debug.llmKeyMatcher ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <span>enabled: {String(state.debug.llmKeyMatcher.enabled)}</span>
                        <span>status: {state.debug.llmKeyMatcher.status}</span>
                        <span>provider: {state.debug.llmKeyMatcher.providerId}</span>
                        <span>model: {state.debug.llmKeyMatcher.model}</span>
                        <span>targets: {state.debug.llmKeyMatcher.request?.targets.length ?? 0}</span>
                        <span>facts sent: {state.debug.llmKeyMatcher.request?.facts.length ?? 0}</span>
                        <span>matches: {state.debug.llmKeyMatcher.response?.matches.length ?? 0}</span>
                        <span>latency: {state.debug.llmKeyMatcher.durationMs ? `${state.debug.llmKeyMatcher.durationMs}ms` : "n/a"}</span>
                      </div>
                      {state.debug.llmKeyMatcher.reason ? (
                        <div className="rounded-lg bg-white/70 px-2 py-1 text-[var(--color-ink)]">
                          {state.debug.llmKeyMatcher.reason}
                        </div>
                      ) : null}
                      <div className="grid gap-1">
                        <strong className="text-[12px] text-[var(--color-ink)]">Input sent to AI</strong>
                        <textarea
                          className="h-28 resize-none rounded-lg border border-[var(--color-line)] bg-white p-2 font-mono text-[10px] text-[var(--color-ink-soft)]"
                          readOnly
                          value={state.debug.llmKeyMatcher.prompt ?? JSON.stringify(state.debug.llmKeyMatcher.request ?? {}, null, 2)}
                        />
                      </div>
                      <div className="grid gap-1">
                        <strong className="text-[12px] text-[var(--color-ink)]">AI result</strong>
                        <textarea
                          className="h-24 resize-none rounded-lg border border-[var(--color-line)] bg-white p-2 font-mono text-[10px] text-[var(--color-ink-soft)]"
                          readOnly
                          value={state.debug.llmKeyMatcher.rawResponseText ?? JSON.stringify(state.debug.llmKeyMatcher.response ?? {}, null, 2)}
                        />
                      </div>
                    </>
                  ) : (
                    <span>No LLM key matcher debug was recorded for this scan.</span>
                  )}
                </div>
              </div>
              <div className="grid gap-1">
                <h3 className="m-0 text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Profile data parsed</h3>
                <div className="max-h-32 overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-mist)]">
                  {state.debug.facts.map((fact) => (
                    <div key={fact.id} className="grid gap-1 border-b border-[var(--color-line)] px-3 py-2 last:border-b-0">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="truncate text-[13px] text-[var(--color-ink)]">{fact.label}</strong>
                        <span className="shrink-0">{fact.sensitivity}</span>
                      </div>
                      <div className="truncate">key: {fact.key} | source: {fact.source} | confidence: {fact.confidence}</div>
                      <div className="truncate">value: {fact.valuePreview || "empty"}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-1">
                <h3 className="m-0 text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Web form metadata</h3>
                <div className="max-h-36 overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-mist)]">
                  {state.debug.forms.map((form) => (
                    <div key={form.formId} className="grid gap-2 border-b border-[var(--color-line)] px-3 py-2 last:border-b-0">
                      <div className="grid gap-1">
                        <strong className="truncate text-[13px] text-[var(--color-ink)]">{form.formTitle || form.pageTitle || form.formId}</strong>
                        <span className="truncate">{form.urlOrigin} | fields: {form.fieldCount}</span>
                      </div>
                      {form.fields.map((field) => (
                        <div key={field.fieldId} className="grid gap-1 rounded-lg bg-white/70 px-2 py-1">
                          <div className="truncate font-semibold text-[var(--color-ink)]">
                            {field.labelText || field.ariaLabel || field.placeholder || field.name || field.id || field.fieldId}
                          </div>
                          <div className="truncate">
                            {field.tagName}{field.inputType ? `:${field.inputType}` : ""} | name: {field.name ?? "none"} | autocomplete: {field.autocomplete ?? "none"}
                          </div>
                          <div className="truncate">placeholder: {field.placeholder ?? "none"} | current: {field.currentValuePreview || "empty"}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-1">
                <h3 className="m-0 text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Fill decisions</h3>
                <div className="max-h-40 overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-mist)]">
                {state.debug.fields.map((field) => (
                  <div key={field.fieldId} className="grid gap-1 border-b border-[var(--color-line)] px-3 py-2 last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="truncate text-[13px] text-[var(--color-ink)]">{field.label}</strong>
                      <span className="shrink-0 font-semibold text-[var(--color-ink)]">
                        {field.fillStatus ?? (field.ready ? "ready" : "not ready")}
                      </span>
                    </div>
                    <div className="truncate">{field.fieldMeta}</div>
                    <div className="truncate">key: {field.profileKey ?? "none"} | source: {field.valueSource} | selected: {String(field.preselected)}</div>
                    <div className="truncate">value: {field.valuePreview || "empty"}</div>
                    <div className="text-[var(--color-ink)]">{field.fillReason ?? field.reason}</div>
                  </div>
                ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="m-0 text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Debug JSON</h3>
                <button className={`${secondaryButtonClassMd} px-3 py-2 text-[12px]`} type="button" onClick={copyDebugJson}>
                  Copy JSON
                </button>
              </div>
              <textarea
                className="h-24 resize-none rounded-xl border border-[var(--color-line)] bg-white p-2 font-mono text-[11px] text-[var(--color-ink-soft)]"
                readOnly
                value={JSON.stringify(state.debug, null, 2)}
              />
            </div>
          </details>
        ) : null}

        <div className="grid gap-3">
          <label className="grid gap-2" htmlFor="popup-profile-select">
            <span className="text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Active profile</span>
            <select
              className="w-full rounded-2xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.9)] px-3.5 py-3 text-sm text-[var(--color-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition focus:border-[rgba(17,17,19,0.14)] focus:ring-4 focus:ring-[rgba(17,17,19,0.08)]"
              id="popup-profile-select"
              value={state.extensionState.activeProfileId}
              onChange={(event) => state.changeActiveProfile(event.target.value)}
              disabled={state.extensionState.profiles.length === 0}
            >
              {state.extensionState.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <button className={primaryButtonClass} type="button" onClick={handlePrimaryAction} disabled={primaryActionDisabled}>
            {primaryActionLabel}
          </button>

          <div className="grid gap-2 text-[12px] font-semibold text-[var(--color-ink-soft)]">
            <button className={secondaryButtonClassMd} type="button" onClick={state.openSettings}>
              Add facts
            </button>
            <div className="flex items-center gap-2">
              {state.pendingConflictCount > 0 ? (
                <button className={`${secondaryButtonClassMd} flex-1`} type="button" onClick={state.openSettings}>
                  Review updates
                </button>
              ) : null}
              {!state.isSignedIn ? (
                <button className={`${secondaryButtonClassMd} flex-1`} type="button" onClick={state.startOAuth}>
                  Sign in
                </button>
              ) : (
                <button className={`${secondaryButtonClassMd} flex-1`} type="button" onClick={state.openBilling}>
                  {state.billingLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>


      <footer className="mt-auto text-center text-[11px] font-[760] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
        {state.status}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);
