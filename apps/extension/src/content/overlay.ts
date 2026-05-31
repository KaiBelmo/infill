import type { ExtractedField, FieldMapping, ProfileFact } from "@infill/shared";
import { locateField } from "./locator";
import { sendMessage } from "webext-bridge/content-script";
import overlayCss from "./overlay.css?inline";

type OverlayState = {
  mapping: FieldMapping;
  field: ExtractedField;
  element: Element | null;
  host: HTMLElement | null;
  shadow: ShadowRoot | null;
  visible: boolean;
  dropdownOpen: boolean;
};

type LearnFactUndo =
  | { type: "saved_fact"; profileId: string; factId: string }
  | { type: "replaced_fact"; profileId: string; previousFact: ProfileFact }
  | { type: "conflict"; profileId: string; conflictId: string };

type LearnFactResult = {
  saved: boolean;
  status: "saved" | "unchanged" | "conflict";
  undo?: LearnFactUndo;
};

const overlays = new Map<string, OverlayState>();
let activeDropdown: string | null = null;

function createOverlayShadow(host: HTMLElement): ShadowRoot {
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = overlayCss;
  shadow.appendChild(style);
  return shadow;
}

const EDIT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>`;
const CLEAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const LEARN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/></svg>`;
const SAVED_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.8c0-.9.7-1.6 1.6-1.6h6.8c.9 0 1.6.7 1.6 1.6v15.4l-5-3.1-5 3.1V4.8Z"/></svg>`;

function getSourceLabel(mapping: FieldMapping): string {
  switch (mapping.valueSource) {
    case "profile_fact": return "From profile";
    case "generated_answer": return "AI generated";
    case "previous_answer": return "Previous answer";
    case "manual": return "Manual";
    default: return "Auto-filled";
  }
}

function isSensitive(mapping: FieldMapping): boolean {
  return mapping.risk === "secret" || mapping.risk === "restricted";
}

function isMissingLearnable(mapping: FieldMapping): boolean {
  return Boolean(
    mapping.profileKey &&
    mapping.valueSource === "none" &&
    mapping.value === undefined &&
    (mapping.risk === "personal" || mapping.risk === "safe" || mapping.risk === "unknown")
  );
}

export function installOverlays(mappings: FieldMapping[], fields: ExtractedField[]): void {
  removeAllOverlays();

  const fieldById = new Map(fields.map((f) => [f.fieldId, f]));

  for (const mapping of mappings) {
    const field = fieldById.get(mapping.fieldId);
    if (!field) continue;

    const locateResult = locateField(field);
    const element = locateResult.element;
    if (!element) continue;

    if (isSensitive(mapping)) {
      installSensitiveIndicator(mapping, field, element);
    } else if (isMissingLearnable(mapping)) {
      installMissingIndicator(mapping, field, element);
    } else {
      installFilledOverlay(mapping, field, element);
    }
  }

  document.addEventListener("click", onDocumentClick);
  document.addEventListener("focusin", onFocusIn);
}

export function removeAllOverlays(): void {
  for (const [, state] of overlays) {
    state.host?.remove();
  }
  overlays.clear();
  activeDropdown = null;
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("focusin", onFocusIn);
}

function installFilledOverlay(mapping: FieldMapping, field: ExtractedField, element: Element): void {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.className = "infill-overlay-host";
  const shadow = createOverlayShadow(host);

  const sourceLabel = document.createElement("div");
  sourceLabel.className = "pf-source";
  sourceLabel.textContent = getSourceLabel(mapping);
  shadow.appendChild(sourceLabel);

  const icon = document.createElement("div");
  icon.className = "pf-icon";
  icon.innerHTML = EDIT_ICON;
  icon.setAttribute("data-field-id", mapping.fieldId);
  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown(mapping.fieldId);
  });
  shadow.appendChild(icon);

  positionHost(host, element);
  document.documentElement.appendChild(host);

  overlays.set(mapping.fieldId, {
    mapping,
    field,
    element,
    host,
    shadow,
    visible: false,
    dropdownOpen: false,
  });
}

function installSensitiveIndicator(mapping: FieldMapping, field: ExtractedField, element: Element): void {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.className = "infill-overlay-host";
  const shadow = createOverlayShadow(host);

  const badge = document.createElement("div");
  badge.className = "pf-sensitive-badge";
  badge.textContent = "!";
  badge.title = "Sensitive field — click to fill";
  badge.setAttribute("data-field-id", mapping.fieldId);
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    fillSensitiveField(mapping.fieldId);
  });
  shadow.appendChild(badge);

  positionHost(host, element);
  document.documentElement.appendChild(host);

  overlays.set(mapping.fieldId, {
    mapping,
    field,
    element,
    host,
    shadow,
    visible: false,
    dropdownOpen: false,
  });
}

function installMissingIndicator(mapping: FieldMapping, field: ExtractedField, element: Element): void {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.className = "infill-overlay-host";
  const shadow = createOverlayShadow(host);

  const badge = document.createElement("div");
  badge.className = "pf-missing-badge";
  badge.setAttribute("aria-label", "Save missing profile info");
  badge.title = "Enter the missing value, then press + to save it.";
  badge.setAttribute("data-field-id", mapping.fieldId);
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    learnMissingFieldValue(mapping.fieldId);
  });
  shadow.appendChild(badge);

  const tip = document.createElement("div");
  tip.className = "pf-missing-tip";
  tip.textContent = mapping.valueSource === "autocomplete_hint"
    ? `Detected as ${mapping.profileKey}. Confirm or edit the value, then press + to save it.`
    : "Enter the missing value in this field, then press + to save it for future fills.";
  shadow.appendChild(tip);

  positionHost(host, element);
  document.documentElement.appendChild(host);

  overlays.set(mapping.fieldId, {
    mapping,
    field,
    element,
    host,
    shadow,
    visible: false,
    dropdownOpen: false,
  });
}

function positionHost(host: HTMLElement, element: Element): void {
  const rect = element.getBoundingClientRect();
  host.style.position = "absolute";
  host.style.left = `${rect.left + window.scrollX}px`;
  host.style.top = `${rect.top + window.scrollY}px`;
  host.style.width = `${rect.width}px`;
  host.style.height = `${rect.height}px`;
}

function toggleDropdown(fieldId: string): void {
  if (activeDropdown && activeDropdown !== fieldId) {
    closeDropdown(activeDropdown);
  }

  const state = overlays.get(fieldId);
  if (!state || !state.shadow) return;

  if (state.dropdownOpen) {
    closeDropdown(fieldId);
    return;
  }

  const dropdown = document.createElement("div");
  dropdown.className = "pf-dropdown";
  dropdown.setAttribute("data-dropdown-for", fieldId);

  const editItem = createDropdownItem("Edit value", EDIT_ICON, () => {
    startInlineEdit(fieldId);
    closeDropdown(fieldId);
  });
  dropdown.appendChild(editItem);

  const clearItem = createDropdownItem("Clear field", CLEAR_ICON, () => {
    clearFieldValue(fieldId);
    closeDropdown(fieldId);
  });
  dropdown.appendChild(clearItem);

  dropdown.appendChild(createSeparator());

  const learnItem = createDropdownItem("Always use this value", LEARN_ICON, () => {
    learnFieldValue(fieldId);
    closeDropdown(fieldId);
  });
  dropdown.appendChild(learnItem);

  state.shadow.appendChild(dropdown);
  state.dropdownOpen = true;
  activeDropdown = fieldId;
}

function closeDropdown(fieldId: string): void {
  const state = overlays.get(fieldId);
  if (!state || !state.shadow) return;

  const dropdown = state.shadow.querySelector("[data-dropdown-for]");
  if (dropdown) dropdown.remove();

  state.dropdownOpen = false;
  if (activeDropdown === fieldId) activeDropdown = null;
}

function createDropdownItem(label: string, iconSvg: string, onClick: () => void): HTMLElement {
  const item = document.createElement("div");
  item.className = "pf-dropdown-item";
  item.innerHTML = `${iconSvg}<span>${label}</span>`;
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return item;
}

function createSeparator(): HTMLElement {
  const sep = document.createElement("div");
  sep.className = "pf-dropdown-sep";
  return sep;
}

function onDocumentClick(e: MouseEvent): void {
  if (!activeDropdown) return;
  const target = e.target as HTMLElement;
  if (target.closest?.("[data-field-id]") || target.closest?.("[data-dropdown-for]")) return;
  closeDropdown(activeDropdown);
}

function onFocusIn(e: FocusEvent): void {
  const target = e.target as HTMLElement;
  for (const [, state] of overlays) {
    if (state.element === target) {
      const icon = state.shadow?.querySelector(".pf-icon");
      icon?.classList.add("pf-focused");
    } else {
      const icon = state.shadow?.querySelector(".pf-icon");
      icon?.classList.remove("pf-focused");
    }
  }
}

async function startInlineEdit(fieldId: string): Promise<void> {
  const state = overlays.get(fieldId);
  if (!state?.element) return;

  const el = state.element;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    el.select();
  } else if (el instanceof HTMLElement) {
    el.focus();
  }
}

async function clearFieldValue(fieldId: string): Promise<void> {
  const state = overlays.get(fieldId);
  if (!state?.element) return;

  const el = state.element;
  if (el instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el instanceof HTMLSelectElement) {
    el.selectedIndex = 0;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  state.host?.remove();
  overlays.delete(fieldId);
}

async function learnFieldValue(fieldId: string): Promise<void> {
  const state = overlays.get(fieldId);
  if (!state) return;

  const mapping = state.mapping;
  if (mapping.value == null || !mapping.profileKey) return;

  try {
    const result = await sendMessage("learn-fact", {
      fact: {
        key: mapping.profileKey,
        label: mapping.reason || mapping.profileKey,
        value: String(mapping.value),
        category: "identity",
        sensitivity: "normal",
      },
    }, "background") as LearnFactResult;
    showLearnFeedback(state, result);
  } catch {
    // Learning is best-effort
  }
}

async function learnMissingFieldValue(fieldId: string): Promise<void> {
  const state = overlays.get(fieldId);
  if (!state || !state.element) {
    console.debug("[infill learn] missing overlay state", { fieldId, hasState: Boolean(state) });
    return;
  }

  const mapping = state.mapping;
  if (!mapping.profileKey) {
    console.debug("[infill learn] missing profile key", { fieldId, mapping });
    return;
  }

  let value = "";
  const el = state.element;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    value = el.value.trim();
  } else if (el instanceof HTMLSelectElement) {
    value = el.options[el.selectedIndex]?.value ?? "";
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    value = el.textContent?.trim() ?? "";
  }

  console.debug("[infill learn] captured missing value", {
    fieldId,
    profileKey: mapping.profileKey,
    label: mapping.reason || mapping.profileKey,
    valuePreview: value ? `${value.slice(0, 30)}${value.length > 30 ? "..." : ""}` : "",
    elementTag: el.tagName,
    elementType: el instanceof HTMLInputElement ? el.type : undefined
  });

  if (!value) {
    console.debug("[infill learn] skipped save because value is empty", { fieldId, profileKey: mapping.profileKey });
    return;
  }

  try {
    const result = await sendMessage("learn-fact", {
      fact: {
        key: mapping.profileKey,
        label: mapping.reason || mapping.profileKey,
        value,
        category: "identity",
        sensitivity: "normal",
      },
    }, "background") as LearnFactResult;
    console.debug("[infill learn] background result", {
      fieldId,
      profileKey: mapping.profileKey,
      status: result.status,
      saved: result.saved,
      hasUndo: Boolean(result.undo)
    });

    const badge = state.shadow?.querySelector(".pf-missing-badge");
    if (badge) {
      if (result.status === "conflict") {
        badge.textContent = "!";
        badge.setAttribute("data-state", "conflict");
        (badge as HTMLElement).style.background = "#ffffff";
        (badge as HTMLElement).style.borderColor = "rgba(0,0,0,.18)";
        (badge as HTMLElement).style.color = "#0b0b0d";
        (badge as HTMLElement).title = "Needs review";
      } else {
        badge.innerHTML = SAVED_ICON;
        badge.setAttribute("data-state", "saved");
        (badge as HTMLElement).style.background = "#0b0b0d";
        (badge as HTMLElement).style.borderColor = "#0b0b0d";
        (badge as HTMLElement).style.color = "#ffffff";
        (badge as HTMLElement).title = result.status === "unchanged" ? "Already saved" : "Saved to profile";
      }
    }
    showLearnFeedback(state, result);
  } catch (error) {
    console.debug("[infill learn] save failed", { fieldId, profileKey: mapping.profileKey, error });
    // Learning is best-effort
  }
}

function showLearnFeedback(state: OverlayState, result: LearnFactResult): void {
  if (!state.shadow) return;

  state.shadow.querySelector(".pf-learn-feedback")?.remove();
  const tip = state.shadow.querySelector(".pf-missing-tip") as HTMLElement | null;
  if (tip) {
    tip.style.opacity = "0";
    tip.style.visibility = "hidden";
  }

  const feedback = document.createElement("div");
  feedback.className = `pf-learn-feedback ${result.status === "conflict" ? "pf-learn-feedback-warning" : "pf-learn-feedback-success"}`;

  const label = document.createElement("span");
  label.textContent = result.status === "conflict"
    ? "Needs review"
    : result.status === "unchanged"
      ? "Already saved"
      : "Saved to profile";
  feedback.appendChild(label);

  if (result.undo) {
    const undoButton = document.createElement("button");
    undoButton.type = "button";
    undoButton.textContent = "Undo";
    undoButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void undoLearnedFact(result.undo!, feedback, state);
    });
    feedback.appendChild(undoButton);
  }

  state.shadow.appendChild(feedback);
  window.setTimeout(() => {
    if (feedback.isConnected) {
      feedback.remove();
      if (tip) {
        tip.style.visibility = "";
        tip.style.opacity = "";
      }
    }
  }, 5000);
}

async function undoLearnedFact(undo: LearnFactUndo, feedback: HTMLElement, state: OverlayState): Promise<void> {
  try {
    await sendMessage("undo-learned-fact", { undo }, "background");
    feedback.className = "pf-learn-feedback pf-learn-feedback-muted";
    feedback.textContent = "Undone";

    const badge = state.shadow?.querySelector(".pf-missing-badge") as HTMLElement | null;
    if (badge) {
      badge.textContent = "";
      badge.removeAttribute("data-state");
      badge.style.background = "";
      badge.style.borderColor = "";
      badge.style.color = "";
      badge.title = "Enter the missing value, then press + to save it.";
    }

    window.setTimeout(() => {
      if (feedback.isConnected) {
        feedback.remove();
        const tip = state.shadow?.querySelector(".pf-missing-tip") as HTMLElement | null;
        if (tip) {
          tip.style.visibility = "";
          tip.style.opacity = "";
        }
      }
    }, 1600);
  } catch {
    feedback.className = "pf-learn-feedback pf-learn-feedback-warning";
    feedback.textContent = "Could not undo";
  }
}

async function fillSensitiveField(fieldId: string): Promise<void> {
  const state = overlays.get(fieldId);
  if (!state?.element) return;

  const mapping = state.mapping;
  if (mapping.value === undefined) return;

  const el = state.element;
  if (el instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, String(mapping.value));
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, String(mapping.value));
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Replace sensitive indicator with regular overlay
  state.host?.remove();
  overlays.delete(fieldId);
  installFilledOverlay(mapping, state.field, el);
}

export function repositionOverlays(): void {
  for (const [, state] of overlays) {
    if (state.element && state.host) {
      positionHost(state.host, state.element);
    }
  }
}

let resizeObserver: ResizeObserver | undefined;

export function startOverlayWatch(): void {
  stopOverlayWatch();
  resizeObserver = new ResizeObserver(() => repositionOverlays());
  resizeObserver.observe(document.body);

  window.addEventListener("scroll", repositionOverlays, true);
  window.addEventListener("resize", repositionOverlays);
}

export function stopOverlayWatch(): void {
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  window.removeEventListener("scroll", repositionOverlays, true);
  window.removeEventListener("resize", repositionOverlays);
}
