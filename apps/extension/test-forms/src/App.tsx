import { useEffect, useMemo, useState } from "react";
import { categoryLabels, fakeProfiles, fixtures } from "./data";
import { isVisible, readDraft, storageKey, validateFields } from "./form-utils";
import type { FieldDefinition, FixtureDefinition, FormValues } from "./types";
import "./styles.css";

const fixtureBySlug = (slug: string): FixtureDefinition | undefined => fixtures.find((item) => item.slug === slug);

function WarningBanner(): React.JSX.Element {
  return (
    <div className="warning" role="note">
      <strong>Local Test Fixture - Not Affiliated</strong>
      <span>Enter fake data only. Nothing is sent to a server.</span>
    </div>
  );
}

const supportCopy: Record<FixtureDefinition["theme"], { title: string; lead: string; items: string[] }> = {
  foundry: { title: "Test bench", lead: "Original Fixture Foundry presentation.", items: ["Stable semantic controls", "Synthetic profile loader"] },
  enterprise: { title: "Candidate tasks", lead: "Your application saves after each completed section.", items: ["Resume and experience", "Required disclosures"] },
  minimal: { title: "Application notes", lead: "Complete only the information relevant to this request.", items: ["Required fields are marked", "Documents stay local"] },
  civic: { title: "Record checklist", lead: "Review the record number and required evidence.", items: ["Eligibility responses", "Supporting documents"] },
  retail: { title: "Quick tip", lead: "Most people finish this section in a few minutes.", items: ["Have your schedule ready", "Use fake details only"] },
  interview: { title: "Why we ask", lead: "Your answers decide which questions appear next.", items: ["You can go back anytime", "Estimates are acceptable"] },
  workspace: { title: "Workspace checklist", lead: "Gather documents as you move through each task.", items: ["Items needing review", "Files received locally"] },
  claims: { title: "Claim guidance", lead: "Safety comes first. You can add evidence later.", items: ["Incident timeline", "Photos and receipts"] },
  eligibility: { title: "Eligibility notes", lead: "Household circumstances determine later questions.", items: ["People in your home", "Income and expenses"] },
};

function SupportPanel({ fixture }: { fixture: FixtureDefinition }): React.JSX.Element {
  const content = supportCopy[fixture.theme];
  return <aside className="help-panel">
    <span className="support-icon" aria-hidden="true">{fixture.theme === "claims" ? "!" : fixture.theme === "workspace" ? "☷" : fixture.theme === "civic" ? "§" : "i"}</span>
    <h2>{content.title}</h2><p>{content.lead}</p>
    <ul>{content.items.map((item) => <li key={item}>{item}</li>)}</ul>
    <details><summary>Privacy and drafts</summary><p>This fixture uses localStorage only. It never submits information to an organization.</p></details>
  </aside>;
}

function Field({ definition, value, error, onChange }: {
  definition: FieldDefinition;
  value: string | boolean | undefined;
  error?: string;
  onChange: (value: string | boolean) => void;
}): React.JSX.Element {
  const describedBy = [definition.help ? `${definition.id}-help` : "", error ? `${definition.id}-error` : ""].filter(Boolean).join(" ");
  const shared = {
    id: definition.id,
    name: definition.id,
    required: definition.required,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy || undefined,
  };
  let control: React.JSX.Element;
  if (definition.type === "textarea") {
    control = <textarea {...shared} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} rows={5} />;
  } else if (definition.type === "select") {
    control = <select {...shared} value={String(value ?? "")} autoComplete={definition.autocomplete} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select one</option>{definition.options?.filter(Boolean).map((option) => <option key={option}>{option}</option>)}
    </select>;
  } else if (definition.type === "radio") {
    control = <div className="choice-row">{definition.options?.map((option) => <label className="choice" key={option}>
      <input type="radio" name={definition.id} value={option} checked={value === option} onChange={() => onChange(option)} /> {option}
    </label>)}</div>;
  } else if (definition.type === "checkbox") {
    control = <label className="choice checkbox"><input {...shared} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /> {definition.label}</label>;
  } else if (definition.type === "file") {
    control = <input {...shared} type="file" onChange={(event) => onChange(event.target.files?.[0]?.name ?? "")} />;
  } else {
    control = <input {...shared} type={definition.type} value={String(value ?? "")} placeholder={definition.placeholder} autoComplete={definition.autocomplete} onChange={(event) => onChange(event.target.value)} />;
  }
  return <div className={`field ${definition.type === "textarea" ? "wide" : ""}`}>
    {definition.type !== "checkbox" && <label htmlFor={definition.id}>{definition.label}{definition.required && <span aria-hidden="true"> *</span>}</label>}
    {control}
    {definition.help && <small id={`${definition.id}-help`}>{definition.help}</small>}
    {error && <small className="error" id={`${definition.id}-error`}>{error}</small>}
  </div>;
}

function Landing(): React.JSX.Element {
  return <><WarningBanner /><header className="landing-hero">
    <div><p className="kicker">Fixture Foundry / 20 workflows</p><h1>Real forms. Fake lives. Better autofill tests.</h1>
    <p>Long, local-only application journeys built to stress browser-extension detection, matching, persistence, and review behavior.</p></div>
    <div className="hero-stamp"><strong>100+</strong><span>steps across four service families</span></div>
  </header>
  <main id="main" className="landing-main">
    {(Object.entries(categoryLabels) as Array<[keyof typeof categoryLabels, string]>).map(([category, label]) => <section key={category} className="category">
      <div className="section-heading"><span>0{Object.keys(categoryLabels).indexOf(category) + 1}</span><h2>{label}</h2></div>
      <div className="cards">{fixtures.filter((fixture) => fixture.category === category).map((fixture) => <a className={`fixture-card preview-${fixture.theme}`} href={`#/${fixture.slug}`} style={{ "--accent": fixture.accent, "--secondary": fixture.secondary } as React.CSSProperties} key={fixture.slug}>
        <span className="card-tag">{fixture.organization}</span><span className="design-tag">{fixture.badge}</span><h3>{fixture.name}</h3><p>{fixture.summary}</p>
        <footer><span>{fixture.steps.length} custom steps</span><span>{fixture.steps.reduce((sum, step) => sum + step.fields.length, 0)} fields</span><b>Open fixture →</b></footer>
      </a>)}</div>
    </section>)}
  </main></>;
}

function FixtureApp({ fixture }: { fixture: FixtureDefinition }): React.JSX.Element {
  const existing = readDraft(fixture.slug, localStorage);
  const [stepIndex, setStepIndex] = useState(existing?.step ?? 0);
  const [values, setValues] = useState<FormValues>(existing?.values ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState(existing ? `Draft restored from ${new Date(existing.savedAt).toLocaleString()}.` : "");
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const step = fixture.steps[stepIndex];
  const visibleFields = useMemo(() => step.fields.filter((item) => isVisible(item, values)), [step, values]);
  const percent = Math.round(((stepIndex + 1) / fixture.steps.length) * 100);

  useEffect(() => {
    document.title = `${fixture.name} | Local fixture`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [fixture.name, stepIndex]);

  const save = (): void => {
    localStorage.setItem(storageKey(fixture.slug), JSON.stringify({ step: stepIndex, values, savedAt: new Date().toISOString() }));
    setNotice("Draft saved locally on this device.");
  };
  const next = (): void => {
    const nextErrors = validateFields(visibleFields, values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setNotice(`Please fix ${Object.keys(nextErrors).length} required field${Object.keys(nextErrors).length === 1 ? "" : "s"}.`);
      document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    save();
    if (stepIndex === fixture.steps.length - 1) {
      setLoading(true);
      window.setTimeout(() => { setLoading(false); setComplete(true); localStorage.removeItem(storageKey(fixture.slug)); }, 650);
    } else setStepIndex((current) => current + 1);
  };
  const restart = (): void => {
    localStorage.removeItem(storageKey(fixture.slug));
    setValues({}); setStepIndex(0); setErrors({}); setComplete(false); setNotice("Fixture reset.");
  };
  const profile = (name: keyof typeof fakeProfiles): void => {
    setValues((current) => ({ ...current, ...fakeProfiles[name] }));
    setNotice(`${name} synthetic profile loaded.`);
  };

  if (complete) return <div className={`theme-${fixture.theme}`} style={{ "--accent": fixture.accent, "--secondary": fixture.secondary } as React.CSSProperties}><WarningBanner /><main className="success"><span className="success-mark">✓</span><p className="kicker">{fixture.badge}</p><h1>{fixture.theme === "claims" ? "Your incident report is ready." : fixture.theme === "civic" ? "Your application record is complete." : fixture.theme === "workspace" ? "Your workspace checklist is complete." : "Test submission captured locally."}</h1><p>No data left this browser. Use this confirmation state to verify extension behavior after a successful {fixture.name.toLowerCase()} journey.</p><button onClick={restart}>Start over</button><a href="#/">Return to all fixtures</a></main></div>;
  return <div className={`app theme-${fixture.theme} nav-${fixture.navigation}`} style={{ "--accent": fixture.accent, "--secondary": fixture.secondary } as React.CSSProperties}>
    <WarningBanner />
    <header className="app-header"><a href="#/" className="brand"><span>{fixture.organization.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span><span className="brand-copy"><b>{fixture.organization}</b><small>{fixture.badge}</small></span></a><nav aria-label="Utility navigation"><a href="#/">All fixtures</a><button type="button" className="text-button" onClick={save}>Save draft</button><button type="button" className="text-button danger" onClick={restart}>Start over</button></nav></header>
    <div className="progress-wrap"><div className="progress-copy"><span>{fixture.organization}</span><strong>{percent}% complete</strong></div><div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div></div>
    <main id="main" className="form-layout">
      <aside className="steps" aria-label="Application steps"><p className="kicker">{fixture.badge}</p><ol>{fixture.steps.map((item, index) => <li key={item.id} className={index === stepIndex ? "active" : index < stepIndex ? "done" : ""}>
        <button type="button" onClick={() => index <= stepIndex && setStepIndex(index)} disabled={index > stepIndex}><span>{index < stepIndex ? "✓" : index + 1}</span>{item.title}</button>
      </li>)}</ol></aside>
      <form className="form-card" onSubmit={(event) => { event.preventDefault(); next(); }} noValidate>
        <div className="form-intro"><p>{step.eyebrow}</p><h1>{step.title}</h1><span>{step.description}</span></div>
        <div className="profile-loader"><label htmlFor="profile">Test data profile</label><select id="profile" defaultValue="" onChange={(event) => event.target.value && profile(event.target.value as keyof typeof fakeProfiles)}>
          <option value="">Choose a synthetic profile</option>{Object.keys(fakeProfiles).map((name) => <option key={name}>{name}</option>)}
        </select></div>
        {notice && <div className={Object.keys(errors).length ? "notice error-summary" : "notice"} role="status">{notice}</div>}
        <section className="field-grid" aria-label={step.title}>{visibleFields.map((definition) => <Field key={definition.id} definition={definition} value={values[definition.id]} error={errors[definition.id]} onChange={(value) => {
          setValues((current) => ({ ...current, [definition.id]: value }));
          setErrors((current) => { const nextErrors = { ...current }; delete nextErrors[definition.id]; return nextErrors; });
        }} />)}</section>
        <div className="form-actions"><button type="button" className="secondary" onClick={() => setStepIndex((current) => Math.max(0, current - 1))} disabled={stepIndex === 0}>Back</button>
          <span>Step {stepIndex + 1} of {fixture.steps.length}</span><button type="submit" disabled={loading}>{loading ? "Saving locally..." : stepIndex === fixture.steps.length - 1 ? "Complete test fixture" : stepIndex === fixture.steps.length - 2 ? "Review" : "Continue"}</button></div>
      </form>
      <SupportPanel fixture={fixture} />
    </main>
  </div>;
}

export default function App(): React.JSX.Element {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const handler = (): void => setHash(window.location.hash); window.addEventListener("hashchange", handler); return () => window.removeEventListener("hashchange", handler); }, []);
  const fixture = fixtureBySlug(hash.replace(/^#\//, ""));
  return fixture ? <FixtureApp key={fixture.slug} fixture={fixture} /> : <Landing />;
}
