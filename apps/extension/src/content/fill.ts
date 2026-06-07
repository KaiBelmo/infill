import type { ExtractedForm, FieldMapping } from "@infill/shared";
import { locateField } from "./locator";
import { sleep, querySelectorAllDeep } from "./scanner/dom-utils";

export type SkippedField = {
  fieldId: string;
  reason: string;
};

export type FillResult = {
  filledFieldIds: string[];
  skippedFieldIds: string[];
  skippedFields: SkippedField[];
};

export async function fillApprovedFields(mappings: FieldMapping[], forms: ExtractedForm[]): Promise<FillResult> {
  const fieldById = new Map(forms.flatMap((form) => form.fields.map((field) => [field.fieldId, field])));
  const filledFieldIds: string[] = [];
  const skippedFieldIds: string[] = [];
  const skippedFields: SkippedField[] = [];
  const cursor = createFillCursor();
  console.debug("[infill fill] start", {
    mappings: mappings.length,
    forms: forms.length,
    fields: fieldById.size,
    readyMappings: mappings.filter((mapping) => mapping.preselected && mapping.value !== undefined).length
  });

  for (const mapping of mappings) {
    const field = fieldById.get(mapping.fieldId);

    if (!field) {
      console.debug("[infill fill] skipped missing field", toFillDebugMapping(mapping));
      skippedFieldIds.push(mapping.fieldId);
      skippedFields.push({ fieldId: mapping.fieldId, reason: "Field not found in scan data" });
      continue;
    }

    if (mapping.value === undefined || !mapping.preselected) {
      console.debug("[infill fill] skipped not ready", {
        ...toFillDebugMapping(mapping),
        hasValue: mapping.value !== undefined,
        preselected: mapping.preselected
      });
      skippedFieldIds.push(mapping.fieldId);
      skippedFields.push({ fieldId: mapping.fieldId, reason: "No value assigned or not preselected" });
      continue;
    }

    if (mapping.risk === "secret" || mapping.risk === "restricted") {
      console.debug("[infill fill] skipped restricted", toFillDebugMapping(mapping));
      skippedFieldIds.push(mapping.fieldId);
      skippedFields.push({ fieldId: mapping.fieldId, reason: `Field restricted (${mapping.risk})` });
      continue;
    }

    if (field.disabled || field.readonly || !field.visible) {
      console.debug("[infill fill] skipped unavailable field", {
        ...toFillDebugMapping(mapping),
        disabled: field.disabled,
        readonly: field.readonly,
        visible: field.visible
      });
      skippedFieldIds.push(mapping.fieldId);
      skippedFields.push({ fieldId: mapping.fieldId, reason: `Field is ${field.disabled ? "disabled" : field.readonly ? "readonly" : "hidden"}` });
      continue;
    }

    const locateResult = locateField(field);

    if (!locateResult.element) {
      console.debug("[infill fill] skipped locate failed", {
        ...toFillDebugMapping(mapping),
        reason: locateResult.reason
      });
      skippedFieldIds.push(mapping.fieldId);
      skippedFields.push({ fieldId: mapping.fieldId, reason: locateResult.reason });
      continue;
    }

    const element = locateResult.element;

    await moveCursorToElement(cursor, element);
    focusElement(element);

    try {
      if (await setElementValue(element, mapping.value, mapping.profileKey)) {
        console.log("[infill fill] filled", {
          ...toFillDebugMapping(mapping),
          elementTag: element.tagName,
          elementType: element instanceof HTMLInputElement ? element.type : undefined
        });
        filledFieldIds.push(mapping.fieldId);
        pulseElement(element);
        await sleep(240);
      } else {
        console.log("[infill fill] skipped set value failed", toFillDebugMapping(mapping));
        skippedFieldIds.push(mapping.fieldId);
        skippedFields.push({ fieldId: mapping.fieldId, reason: "Could not set value on element" });
      }
    } catch (err: any) {
      if (err instanceof Error && err.message.startsWith("HALT_FILL:")) {
        const msg = err.message.replace("HALT_FILL: ", "");
        alert(msg);
        console.warn("[infill fill] Halted:", msg);
        skippedFieldIds.push(mapping.fieldId);
        skippedFields.push({ fieldId: mapping.fieldId, reason: `Halted: ${msg}` });
        break;
      }
      throw err;
    }
  }

  await hideCursor(cursor);
  console.debug("[infill fill] done", {
    filledFieldIds,
    skippedFields
  });

  return { filledFieldIds, skippedFieldIds, skippedFields };
}

function toFillDebugMapping(mapping: FieldMapping) {
  return {
    fieldId: mapping.fieldId,
    profileKey: mapping.profileKey,
    valueSource: mapping.valueSource,
    valuePreview: mapping.value === undefined ? undefined : String(mapping.value).slice(0, 30),
    risk: mapping.risk,
    preselected: mapping.preselected,
    reason: mapping.reason
  };
}

async function setElementValue(element: Element, value: FieldMapping["value"], profileKey?: string): Promise<boolean> {
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") {
      element.checked = toBoolean(value);
      dispatchValueEvents(element);
      return true;
    }

    if (element.type === "radio") {
      const radio = findRadioByValue(element.name, String(value));
      if (!radio) {
        return false;
      }

      radio.checked = true;
      dispatchValueEvents(radio);
      return true;
    }

    setNativeValue(element, String(value));
    dispatchValueEvents(element);

    if (isAutocompleteInput(element, profileKey)) {
      const selected = await selectFirstAutocompleteSuggestion(element, String(value));
      if (selected) {
        return true;
      }
    }

    return element.value === String(value);
  }

  if (element instanceof HTMLTextAreaElement) {
    setNativeValue(element, String(value));
    dispatchValueEvents(element);
    return element.value === String(value);
  }

  if (element instanceof HTMLSelectElement) {
    const nextValue = String(value);
    const matchingOption = Array.from(element.options).find((option) =>
      option.value === nextValue || option.label.trim() === nextValue || option.textContent?.trim() === nextValue
    );
    if (!matchingOption) {
      return false;
    }

    element.value = matchingOption.value;
    dispatchValueEvents(element);
    return element.value === matchingOption.value;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    element.textContent = String(value);
    dispatchValueEvents(element);
    return element.textContent === String(value);
  }

  return false;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) {
    setter.call(element, value);
    return;
  }

  element.value = value;
}

function dispatchValueEvents(element: HTMLElement): void {
  element.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
  element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertReplacementText" }));
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

function focusElement(element: Element): void {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  element.focus({ preventScroll: true });
}

function toBoolean(value: FieldMapping["value"]): boolean {
  return value === true || value === "true" || value === "yes" || value === "on" || value === "1";
}

function findRadioByValue(name: string, value: string): HTMLInputElement | undefined {
  if (!name) {
    return undefined;
  }

  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`)).find(
    (radio) => radio.value === value
  );
}

function createFillCursor(): HTMLElement {
  const existing = document.getElementById("infill-cursor");
  if (existing) {
    return existing;
  }

  const cursor = document.createElement("div");
  cursor.id = "infill-cursor";
  cursor.setAttribute("aria-hidden", "true");
  cursor.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "z-index:2147483647",
    "width:18px",
    "height:18px",
    "pointer-events:none",
    "opacity:0",
    "transform:translate3d(-30px,-30px,0) rotate(-18deg)",
    "transition:transform 520ms cubic-bezier(.22,1,.36,1), opacity 240ms ease",
    "filter:drop-shadow(0 10px 18px rgba(10,22,20,.22))"
  ].join(";");
  cursor.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 3.5 19.5 12 13 13.8 9.7 20.1 4 3.5Z" fill="#F7F2E8" stroke="#123A35" stroke-width="1.7" stroke-linejoin="round"/><path d="m13 13.8 5.2 5.2" stroke="#123A35" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  document.documentElement.append(cursor);

  return cursor;
}

async function moveCursorToElement(cursor: HTMLElement, element: Element): Promise<void> {
  const rect = element.getBoundingClientRect();
  const x = Math.max(12, rect.left + Math.min(rect.width * 0.18, 36));
  const y = Math.max(12, rect.top + Math.min(rect.height * 0.5, 28));

  cursor.style.opacity = "1";
  cursor.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(-18deg)`;
  await sleep(460);
}

async function hideCursor(cursor: HTMLElement): Promise<void> {
  cursor.style.opacity = "0";
  await sleep(260);
}

function pulseElement(element: Element): void {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const isDark = isDarkElement(element);
  const highlightColor = isDark ? "rgba(255,255,255,.58)" : "rgba(0,0,0,.22)";
  const previousOutline = element.style.outline;
  const previousOutlineOffset = element.style.outlineOffset;
  const previousBoxShadow = element.style.boxShadow;
  const previousTransition = element.style.transition;

  element.style.outline = "0";
  element.style.outlineOffset = "0";
  element.style.transition = [previousTransition, "box-shadow 520ms cubic-bezier(.22,1,.36,1)"].filter(Boolean).join(", ");
  element.style.boxShadow = `${previousBoxShadow ? `${previousBoxShadow}, ` : ""}inset 0 0 0 1.5px ${highlightColor}, 0 0 0 3px ${isDark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.045)"}`;

  window.setTimeout(() => {
    element.style.boxShadow = previousBoxShadow;
  }, 680);

  window.setTimeout(() => {
    element.style.outline = previousOutline;
    element.style.outlineOffset = previousOutlineOffset;
    element.style.transition = previousTransition;
  }, 900);
}

function isDarkElement(element: HTMLElement): boolean {
  const color = getComputedStyle(element).backgroundColor;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    return false;
  }

  const [, r, g, b] = match.map(Number);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function isAutocompleteInput(element: HTMLInputElement, profileKey?: string): boolean {
  if (element.classList.contains("pac-target-input")) return true;

  if (profileKey) {
    const pk = profileKey.toLowerCase();
    if (pk.includes("city") || pk.includes("street") || pk.includes("address") || pk.includes("country") || pk.includes("region") || pk.includes("state")) {
      return true;
    }
  }

  const name = (element.name || "").toLowerCase();
  const id = (element.id || "").toLowerCase();
  const placeholder = (element.placeholder || "").toLowerCase();
  const className = (element.className || "").toLowerCase();
  const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();

  const isSearchOrAddress = name.includes("city") || name.includes("address") || name.includes("location") || name.includes("town") || name.includes("search") || name.includes("country") || name.includes("state") ||
                            id.includes("city") || id.includes("address") || id.includes("location") || id.includes("town") || id.includes("search") || id.includes("country") || id.includes("state") ||
                            placeholder.includes("city") || placeholder.includes("address") || placeholder.includes("location") || placeholder.includes("town") || placeholder.includes("search") || placeholder.includes("country") || placeholder.includes("state") ||
                            className.includes("autocomplete") || className.includes("places") || className.includes("geocoder") || className.includes("search") ||
                            autocomplete.includes("address") || autocomplete.includes("city") || autocomplete.includes("country") || autocomplete.includes("state");

  return isSearchOrAddress;
}

/**
 * Finds all visible candidate dropdown containers positioned near the given input element.
 * Traverses deep shadow roots and sorts candidates by vertical proximity to the input's bottom.
 */
function findDropdownContainersAroundInput(input: HTMLInputElement): HTMLElement[] {
  const inputRect = input.getBoundingClientRect();
  const candidates = querySelectorAllDeep("*", document) as HTMLElement[];
  const possibleContainers: HTMLElement[] = [];

  for (const el of candidates) {
    if (el === document.body || el === document.documentElement || el === input) continue;
    
    const rect = el.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 10) continue;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;

    // Generous bounding check
    const verticalNear = (rect.top >= inputRect.top - 20 && rect.top <= inputRect.bottom + 80) ||
                         (rect.bottom <= inputRect.bottom + 20 && rect.bottom >= inputRect.top - 80);
    const horizontalNear = rect.left < inputRect.right + 150 && rect.right > inputRect.left - 150;

    if (verticalNear && horizontalNear) {
      const isPositioned = style.position === "absolute" || style.position === "fixed" || style.position === "relative";
      const isDropdownRole = el.getAttribute("role") === "listbox" || el.getAttribute("role") === "menu" || el.getAttribute("role") === "combobox";
      const matchesCommonClass = el.className && typeof el.className === "string" && (
        el.className.includes("dropdown") ||
        el.className.includes("suggestion") ||
        el.className.includes("pac-container") ||
        el.className.includes("menu") ||
        el.className.includes("listbox") ||
        el.className.includes("select__menu") ||
        el.className.includes("result") ||
        el.className.includes("list") ||
        el.className.includes("options") ||
        el.className.includes("popover")
      );

      if (isPositioned || isDropdownRole || matchesCommonClass) {
        possibleContainers.push(el);
      }
    }
  }

  // Sort candidates by proximity to input bottom
  possibleContainers.sort((a, b) => {
    const distA = Math.abs(a.getBoundingClientRect().top - inputRect.bottom);
    const distB = Math.abs(b.getBoundingClientRect().top - inputRect.bottom);
    return distA - distB;
  });

  return possibleContainers;
}

/**
 * Searches inside a dropdown container (including shadow roots) for a suggestion
 * option whose text content contains the target text case-insensitively.
 */
function findMatchingOption(container: HTMLElement, targetText: string): HTMLElement | undefined {
  const normTarget = targetText.toLowerCase().trim();
  if (!normTarget) return undefined;

  const itemSelectors = [
    "[role='option']",
    ".pac-item",
    ".ap-suggestion",
    ".autocomplete-suggestion",
    ".suggestion-item",
    ".react-select__option",
    ".choices__item--choice",
    "li",
    "div"
  ];

  for (const selector of itemSelectors) {
    const items = querySelectorAllDeep(selector, container) as HTMLElement[];
    const matching = items.find((item) => {
      const rect = item.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(item);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;

      const text = (item.textContent || "").toLowerCase().trim();
      return text.includes(normTarget);
    });

    if (matching) {
      return matching;
    }
  }

  const allChildren = querySelectorAllDeep("*", container) as HTMLElement[];
  const matchingChild = allChildren.find((child) => {
    if (child.children.length > 0) return false;
    
    const rect = child.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    const style = window.getComputedStyle(child);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;

    const text = (child.textContent || "").toLowerCase().trim();
    return text.includes(normTarget);
  });

  return matchingChild;
}

/**
 * Polls and waits for a suggestion dropdown container to appear near the input element.
 */
async function waitForDropdownContainer(input: HTMLInputElement, timeoutMs = 1200): Promise<HTMLElement | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const containers = findDropdownContainersAroundInput(input);
    if (containers.length > 0) {
      return containers[0];
    }
    await sleep(100);
  }
  return null;
}

/**
 * Simulates a robust click sequence (pointerdown, mousedown, focus, pointerup, mouseup, click)
 * to bypass framework limitations and ensure custom dropdown option selection registers.
 */
function dispatchMouseClick(element: HTMLElement): void {
  element.scrollIntoView({ block: "nearest" });
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse" }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  element.click();
}

/**
 * Intercepts autocomplete inputs and waits for their dropdown menu,
 * clicking the matched suggestion or halting the fill process if unmatched.
 */
async function selectFirstAutocompleteSuggestion(element: HTMLInputElement, targetValue: string): Promise<boolean> {
  const container = await waitForDropdownContainer(element, 1200);

  if (container) {
    const suggestion = findMatchingOption(container, targetValue);
    if (suggestion) {
      console.debug("[infill fill] Clicking matched autocomplete suggestion:", suggestion);
      dispatchMouseClick(suggestion);
      await sleep(800);
      return true;
    } else {
      const fieldName = element.name || element.id || "Autocomplete field";
      throw new Error(`HALT_FILL: QA Dummy Fill halted! Autocomplete dropdown detected for field '${fieldName}', but no matching option was found for value '${targetValue}'. Please select the correct option manually.`);
    }
  }

  return false;
}
