import type { LearnedFactConflict } from "@/shared/types";
import type { ReviewableFact } from "../hooks/useOptionsState";
import { inputClass, panelClass, primaryButtonClass, secondaryButtonClass, sectionHeadingLabelClass, sectionHeadingTitleClass } from "@/shared/ui-styles";

type MemoryViewProps = {
  status: string;
  extensionState: { activeProfileId: string };
  memoryText: string;
  setMemoryText: (value: string) => void;
  detectedFacts: ReviewableFact[];
  pendingConflicts: LearnedFactConflict[];
  profiles: { id: string; name: string }[];
  facts: { sensitivity: string }[];
  activeProfile: { name: string } | undefined;
  safeFacts: unknown[];
  restrictedCount: number;
  approvedDetectedFacts: number;
  reviewCount: number;
  canParseWithLlm: boolean;
  parsingWithLlm: boolean;
  switchProfile: (profileId: string) => Promise<void>;
  setStatus: (value: string) => void;
  reviewMemory: () => void;
  reviewMemoryWithLlm: () => Promise<void>;
  saveApprovedFacts: () => Promise<void>;
  updateDetectedFact: (index: number, patch: Partial<ReviewableFact>) => void;
  removeDetectedFact: (index: number) => void;
  resolveConflict: (conflict: LearnedFactConflict, action: "replace" | "keep_existing") => Promise<void>;
};


export function MemoryView({
  status,
  extensionState,
  memoryText,
  setMemoryText,
  detectedFacts,
  pendingConflicts,
  profiles,
  facts,
  activeProfile,
  safeFacts,
  restrictedCount,
  approvedDetectedFacts,
  reviewCount,
  canParseWithLlm,
  parsingWithLlm,
  switchProfile,
  setStatus,
  reviewMemory,
  reviewMemoryWithLlm,
  saveApprovedFacts,
  updateDetectedFact,
  removeDetectedFact,
  resolveConflict
}: MemoryViewProps) {
  return (
    <section
      aria-labelledby="memory-title"
      className="tab-panel-enter grid gap-4"
      id="memory-panel"
      role="tabpanel"
      tabIndex={0}
    >
      <section className={`${panelClass} grid gap-4 p-4 sm:p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid gap-2">
            <span aria-live="polite" className={sectionHeadingLabelClass}>{status}</span>
            <div className="grid gap-2">
              <h2 className="m-0 text-[28px] font-[760] tracking-[-0.035em] text-[var(--color-ink)] sm:text-[32px]" id="memory-title">
                Import memory
              </h2>
              <p className="m-0 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
                Paste raw notes, review parsed facts, and save only the details you want in the active profile.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <section className="grid gap-4 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-mist)] p-4">
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_repeat(3,140px)] lg:items-end">
              <label className="grid gap-2">
                <span className={sectionHeadingLabelClass}>Active profile</span>
                <select
                  className={inputClass}
                  id="memory-profile-select"
                  value={extensionState.activeProfileId}
                  onChange={(event) => switchProfile(event.target.value).catch(() => setStatus("Could not switch profiles."))}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <MemoryStat label="Saved" value={facts.length} />
              <MemoryStat label="Ready" value={safeFacts.length} />
              <MemoryStat label="Restricted" value={restrictedCount} />
            </div>

            <label className="grid gap-2" htmlFor="memory-input">
              <span className={sectionHeadingLabelClass}>Paste profile facts</span>
              <textarea
                className={`${inputClass} min-h-[180px] resize-y text-[15px] leading-6`}
                id="memory-input"
                value={memoryText}
                aria-describedby="memory-help"
                onChange={(event) => {
                  setMemoryText(event.target.value);
                }}
                placeholder={
                  "Full name: Sam Rivera\nEmail: sam@example.com\nJob title: Product Designer\nCompany: Acme Studio\nLocation: Austin, TX"
                }
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  className={primaryButtonClass}
                  type="button"
                  disabled={parsingWithLlm}
                  onClick={detectedFacts.length > 0 ? saveApprovedFacts : canParseWithLlm ? reviewMemoryWithLlm : reviewMemory}
                >
                  {detectedFacts.length > 0 ? "Save approved facts" : canParseWithLlm ? parsingWithLlm ? "Parsing with AI..." : "Parse with AI" : "Review facts"}
                </button>
                {canParseWithLlm && detectedFacts.length === 0 ? (
                  <button className={secondaryButtonClass} type="button" disabled={parsingWithLlm} onClick={reviewMemory}>
                    Review locally
                  </button>
                ) : null}
              </div>
              <p className="m-0 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]" id="memory-help">
                Use one fact per line. Keep passwords, payment details, and private keys out of memory import.
              </p>
            </div>
          </section>
        </div>
      </section>

      {pendingConflicts.length > 0 ? (
        <section className={`${panelClass} grid gap-4 p-4 sm:p-5`} aria-label="Learned fact conflicts">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div className="grid gap-1">
              <span className={sectionHeadingLabelClass}>Incoming changes</span>
              <h3 className={`${sectionHeadingTitleClass} m-0`}>Resolve learned updates</h3>
            </div>
            <span className="rounded-full bg-[rgba(178,117,0,0.12)] px-3 py-1 text-[11px] font-[780] uppercase tracking-[0.12em] text-[var(--color-warning)]">
              {pendingConflicts.length} pending
            </span>
          </div>

          <div className="grid gap-3">
            {pendingConflicts.map((conflict) => (
              <article className="grid gap-3 rounded-[16px] border border-[rgba(178,117,0,0.14)] bg-[rgba(255,248,230,0.82)] p-4" key={conflict.id}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white/85 p-3">
                    <span className={sectionHeadingLabelClass}>Current</span>
                    <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{String(conflict.existingFact.value)}</p>
                  </div>
                  <div className="rounded-xl bg-white/85 p-3">
                    <span className={sectionHeadingLabelClass}>Proposed</span>
                    <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{conflict.proposedFact.value}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={secondaryButtonClass} type="button" onClick={() => resolveConflict(conflict, "keep_existing").catch(() => setStatus("Could not resolve the learned update."))}>
                    Keep current
                  </button>
                  <button className={primaryButtonClass} type="button" onClick={() => resolveConflict(conflict, "replace").catch(() => setStatus("Could not resolve the learned update."))}>
                    Replace
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className={`${panelClass} grid gap-4 p-4 sm:p-5`} aria-live="polite" aria-label="Detected facts">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1">
            <span className={sectionHeadingLabelClass}>Fact review</span>
            <h3 className={`${sectionHeadingTitleClass} m-0`}>Detected facts</h3>
          </div>
          <span className="text-sm text-[var(--color-ink-soft)]">
            {approvedDetectedFacts} approved / {reviewCount} waiting
          </span>
        </div>

        {detectedFacts.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-[var(--color-line)] bg-[var(--color-mist)] px-4 py-6 text-sm leading-6 text-[var(--color-ink-soft)]">
            Paste notes and run review to extract facts here.
          </div>
        ) : (
          <div className="grid gap-3">
            {detectedFacts.map((fact, index) => (
              <article className="grid gap-3 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-mist)] p-4" key={`${fact.key}-${index}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <label className="flex items-center gap-3 text-sm font-semibold text-[var(--color-ink)]">
                    <input
                      checked={fact.approved}
                      className="h-[18px] w-[18px] accent-[var(--color-black-soft)]"
                      onChange={(event) => updateDetectedFact(index, { approved: event.target.checked })}
                      type="checkbox"
                    />
                    <span>{fact.approved ? "Approved" : "Needs review"}</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-[11px] font-[780] uppercase tracking-[0.12em] ${fact.sensitivity === "normal" ? "bg-[rgba(36,138,61,0.12)] text-[var(--color-success)]" : fact.sensitivity === "restricted" ? "bg-[rgba(178,117,0,0.12)] text-[var(--color-warning)]" : "bg-[rgba(215,0,21,0.1)] text-[var(--color-danger)]"}`}>
                      {fact.sensitivity}
                    </span>
                    <button className={secondaryButtonClass} type="button" onClick={() => removeDetectedFact(index)}>
                      Delete
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.9fr)_minmax(0,1.1fr)]">
                  <input
                    aria-label={`Fact label ${index + 1}`}
                    className={inputClass}
                    value={fact.label}
                    onChange={(event) => updateDetectedFact(index, { label: event.target.value })}
                  />
                  <input
                    aria-label={`Fact value ${index + 1}`}
                    className={inputClass}
                    value={fact.value}
                    onChange={(event) => updateDetectedFact(index, { value: event.target.value })}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function MemoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-2.5">
      <span className={sectionHeadingLabelClass}>{label}</span>
      <strong className="mt-1 block text-sm text-[var(--color-ink)]">{value}</strong>
    </div>
  );
}
