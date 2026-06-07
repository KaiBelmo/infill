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

type AutocompleteSelectionResult = "selected" | "unmatched" | "not-found";

export async function fillApprovedFields(mappings: FieldMapping[], forms: ExtractedForm[]): Promise<FillResult> {
  const fieldById = new Map(forms.flatMap((form) => form.fields.map((field) => [field.fieldId, field])));
  const filledFieldIds: string[] = [];
  const skippedFieldIds: string[] = [];
  const skippedFields: SkippedField[] = [];
  const isQaFill = mappings.length > 0 && mappings.every((mapping) => mapping.profileKey === "qa.dummy");
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

    await moveCursorToElement(cursor, element, !isQaFill);
    focusElement(element, !isQaFill);

    if (await setElementValue(element, mapping.value, mapping.profileKey)) {
      console.log("[infill fill] filled", {
        ...toFillDebugMapping(mapping),
        elementTag: element.tagName,
        elementType: element instanceof HTMLInputElement ? element.type : undefined
      });
      filledFieldIds.push(mapping.fieldId);
      pulseElement(element);
      if (!isQaFill) {
        await sleep(240);
      }
    } else {
      console.log("[infill fill] skipped set value failed", toFillDebugMapping(mapping));
      skippedFieldIds.push(mapping.fieldId);
      skippedFields.push({ fieldId: mapping.fieldId, reason: "Could not set value on element" });
    }
  }

  await hideCursor(cursor, !isQaFill);
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

    const nextValue = String(value);
    const strongAutocompleteSignal = hasStrongAutocompleteSignal(element);
    const autocomplete = strongAutocompleteSignal || isLikelyAutocompleteInput(element, profileKey);
    const visibleElementsBeforeInput = autocomplete ? new Set(findVisibleElements()) : undefined;

    setNativeValue(element, nextValue);
    dispatchTextInputEvents(element, nextValue);
    dispatchCustomInputChange(element, nextValue);

    if (autocomplete) {
      const result = await selectAutocompleteSuggestion(
        element,
        nextValue,
        visibleElementsBeforeInput,
        strongAutocompleteSignal ? 1500 : 250
      );
      if (result === "unmatched") {
        console.debug("[infill fill] autocomplete menu had no matching option", {
          field: element.name || element.id || "unnamed",
          value: nextValue
        });
      }
    }

    finalizeTextInput(element);
    return element.value === nextValue || autocomplete;
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

function dispatchTextInputEvents(element: HTMLInputElement, value: string): void {
  element.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
  element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value }));
  element.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: value }));
  element.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    data: value,
    inputType: "insertReplacementText"
  }));
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    data: value,
    inputType: "insertReplacementText"
  }));
  element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: value }));
}

function finalizeTextInput(element: HTMLInputElement): void {
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

function dispatchCustomInputChange(element: HTMLInputElement, value: string): void {
  const inputHost = findShadowHost(element, "spl-input");
  if (!inputHost) return;

  inputHost.dispatchEvent(new CustomEvent("spl-change", {
    bubbles: true,
    cancelable: true,
    composed: true,
    detail: { value }
  }));
}

function focusElement(element: Element, animate = true): void {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.scrollIntoView({ block: "center", inline: "nearest", behavior: animate ? "smooth" : "auto" });
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

async function moveCursorToElement(cursor: HTMLElement, element: Element, animate = true): Promise<void> {
  const rect = element.getBoundingClientRect();
  const x = Math.max(12, rect.left + Math.min(rect.width * 0.18, 36));
  const y = Math.max(12, rect.top + Math.min(rect.height * 0.5, 28));

  cursor.style.opacity = "1";
  cursor.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(-18deg)`;
  if (animate) {
    await sleep(460);
  }
}

async function hideCursor(cursor: HTMLElement, animate = true): Promise<void> {
  cursor.style.opacity = "0";
  if (animate) {
    await sleep(260);
  }
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

function hasStrongAutocompleteSignal(element: HTMLInputElement): boolean {
  if (element.classList.contains("pac-target-input")) return true;
  if (element.getAttribute("aria-autocomplete")) return true;
  if (element.getAttribute("aria-controls") || element.getAttribute("aria-owns")) return true;
  if (element.getAttribute("role") === "combobox") return true;
  if (element.hasAttribute("list")) return true;
  return false;
}

function isLikelyAutocompleteInput(element: HTMLInputElement, profileKey?: string): boolean {
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

const dropdownContainerSelector = [
  "[role='listbox']",
  "[role='menu']",
  "spl-autocomplete",
  "spl-dropdown",
  ".pac-container",
  ".sr-location-autocomplete-dropdown",
  ".autocomplete-results",
  ".autocomplete-suggestions",
  ".suggestions",
  ".dropdown-menu",
  ".select__menu",
  ".choices__list--dropdown",
  "[class*='listbox']",
  "[class*='suggestion']",
  "[class*='popover']"
].join(",");

const optionSelector = [
  "spl-select-option",
  "[role='option']",
  "[role='menuitem']",
  "[data-value]",
  ".sr-location-autocomplete-dropdown-option",
  ".pac-item",
  ".ap-suggestion",
  ".autocomplete-suggestion",
  ".suggestion-item",
  ".react-select__option",
  ".select__option",
  ".choices__item--choice",
  "li"
].join(",");

function findDropdownContainers(input: HTMLInputElement): HTMLElement[] {
  const associated = getAssociatedDropdownContainers(input);
  const discovered = querySelectorAllDeep(dropdownContainerSelector, document) as HTMLElement[];
  const unique = Array.from(new Set([...associated, ...discovered])).filter(isVisibleInteractiveElement);

  return unique.sort((a, b) => {
    const associatedDifference = Number(!associated.includes(a)) - Number(!associated.includes(b));
    return associatedDifference || distanceFromInput(a, input) - distanceFromInput(b, input);
  });
}

function getAssociatedDropdownContainers(input: HTMLInputElement): HTMLElement[] {
  const ids = `${input.getAttribute("aria-controls") ?? ""} ${input.getAttribute("aria-owns") ?? ""}`
    .split(/\s+/)
    .filter(Boolean);

  return ids.flatMap((id) =>
    querySelectorAllDeep(`#${CSS.escape(id)}`, document).filter((element): element is HTMLElement => element instanceof HTMLElement)
  );
}

function findVisibleOptionElements(): HTMLElement[] {
  return (querySelectorAllDeep(optionSelector, document) as HTMLElement[]).filter(isSelectableOption);
}

function findVisibleElements(): HTMLElement[] {
  return (querySelectorAllDeep("*", document) as HTMLElement[]).filter(isVisibleInteractiveElement);
}

function findOptionCandidates(
  input: HTMLInputElement,
  containers: HTMLElement[],
  visibleBeforeInput: Set<HTMLElement> | undefined,
  targetText: string
): HTMLElement[] {
  const associated = new Set(getAssociatedDropdownContainers(input));
  const candidates = new Set<HTMLElement>();

  for (const container of containers) {
    for (const option of querySelectorAllDeep(optionSelector, container) as HTMLElement[]) {
      if (isSelectableOption(option)) {
        candidates.add(option);
      }
    }
  }

  for (const option of findVisibleOptionElements()) {
    const belongsToContainer = containers.some((container) => container.contains(option)) || isInsideAny(option, associated);
    const appearedAfterInput = !visibleBeforeInput?.has(option);
    if (belongsToContainer || (appearedAfterInput && isNearInput(option, input))) {
      candidates.add(option);
    }
  }

  // Some autocomplete widgets render plain div rows without roles or stable classes.
  // Limit this fallback to newly visible, nearby elements that already text-match.
  const target = normalizeOptionText(targetText);
  for (const element of findVisibleElements()) {
    if (
      element === input ||
      visibleBeforeInput?.has(element) ||
      !isSelectableOption(element) ||
      !isNearInput(element, input) ||
      getOptionMatchRank(element, target) === 0
    ) {
      continue;
    }

    candidates.add(getMostSpecificMatchingDescendant(element, target));
  }

  return Array.from(candidates);
}

function getMostSpecificMatchingDescendant(element: HTMLElement, target: string): HTMLElement {
  const descendants = (querySelectorAllDeep("*", element) as HTMLElement[])
    .filter((descendant) => isSelectableOption(descendant) && getOptionMatchRank(descendant, target) > 0)
    .sort((a, b) => elementArea(a) - elementArea(b));

  const customOption = descendants.find(isCustomOptionElement);
  return customOption ?? descendants[0] ?? element;
}

function findBestMatchingOption(
  input: HTMLInputElement,
  candidates: HTMLElement[],
  targetText: string,
  visibleBeforeInput?: Set<HTMLElement>
): HTMLElement | undefined {
  const target = normalizeOptionText(targetText);
  if (!target) return undefined;

  return candidates
    .map((element) => ({
      element,
      matchRank: getOptionMatchRank(element, target),
      wasVisible: visibleBeforeInput?.has(element) ?? false,
      distance: distanceFromInput(element, input)
    }))
    .filter((candidate) => candidate.matchRank > 0)
    .sort((a, b) =>
      b.matchRank - a.matchRank ||
      Number(a.wasVisible) - Number(b.wasVisible) ||
      a.distance - b.distance
    )[0]?.element;
}

function getOptionMatchRank(element: HTMLElement, target: string): number {
  const values = [
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-value")
  ]
    .map((value) => normalizeOptionText(value ?? ""))
    .filter(Boolean);

  if (values.some((value) => value === target)) return 3;
  if (values.some((value) => value.startsWith(target))) return 2;
  if (values.some((value) => hasTokenBoundaryMatch(value, target))) return 1;
  return 0;
}

function normalizeOptionText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function hasTokenBoundaryMatch(value: string, target: string): boolean {
  const index = value.indexOf(target);
  if (index < 0) return false;

  const before = index === 0 ? "" : value[index - 1];
  const afterIndex = index + target.length;
  const after = afterIndex >= value.length ? "" : value[afterIndex];
  return (!before || /\W/.test(before)) && (!after || /\W/.test(after));
}

function isSelectableOption(element: HTMLElement): boolean {
  if (!isVisibleInteractiveElement(element)) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if ("disabled" in element && element.disabled === true) return false;
  return true;
}

function isCustomOptionElement(element: HTMLElement): boolean {
  return element.matches("spl-select-option, .sr-location-autocomplete-dropdown-option");
}

function isVisibleInteractiveElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0";
}

function isNearInput(element: HTMLElement, input: HTMLInputElement): boolean {
  const inputRect = input.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const horizontalOverlap = rect.left < inputRect.right + 160 && rect.right > inputRect.left - 160;
  const verticalDistance = Math.min(Math.abs(rect.top - inputRect.bottom), Math.abs(inputRect.top - rect.bottom));
  return horizontalOverlap && verticalDistance <= 240;
}

function isInsideAny(element: HTMLElement, containers: Set<HTMLElement>): boolean {
  return Array.from(containers).some((container) => container.contains(element));
}

function distanceFromInput(element: HTMLElement, input: HTMLInputElement): number {
  const inputRect = input.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const inputX = inputRect.left + inputRect.width / 2;
  const inputY = inputRect.bottom;
  const elementX = rect.left + rect.width / 2;
  const elementY = rect.top;
  return Math.hypot(elementX - inputX, elementY - inputY);
}

function elementArea(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height;
}

function dispatchMouseClick(element: HTMLElement): void {
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const commonInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    button: 0,
    detail: 1,
    view: element.ownerDocument.defaultView
  };
  const downInit: MouseEventInit = { ...commonInit, buttons: 1 };
  const upInit: MouseEventInit = { ...commonInit, buttons: 0 };
  const pointerDownInit: PointerEventInit = { ...downInit, pointerType: "mouse", isPrimary: true, pointerId: 1 };
  const pointerUpInit: PointerEventInit = { ...upInit, pointerType: "mouse", isPrimary: true, pointerId: 1 };
  const PointerEventConstructor = element.ownerDocument.defaultView?.PointerEvent;

  if (PointerEventConstructor) {
    element.dispatchEvent(new PointerEventConstructor("pointerover", pointerUpInit));
    element.dispatchEvent(new PointerEventConstructor("pointermove", pointerUpInit));
    element.dispatchEvent(new PointerEventConstructor("pointerdown", pointerDownInit));
  }
  element.dispatchEvent(new MouseEvent("mouseover", upInit));
  element.dispatchEvent(new MouseEvent("mousemove", upInit));
  element.dispatchEvent(new MouseEvent("mousedown", downInit));
  if (PointerEventConstructor) {
    element.dispatchEvent(new PointerEventConstructor("pointerup", pointerUpInit));
  }
  element.dispatchEvent(new MouseEvent("mouseup", upInit));
  element.dispatchEvent(new MouseEvent("click", upInit));
}

function selectThroughAutocompleteApi(suggestion: HTMLElement, candidates: HTMLElement[]): boolean {
  const optionHost = suggestion.matches("spl-select-option")
    ? suggestion
    : suggestion.closest<HTMLElement>("spl-select-option");
  const autocomplete = findShadowHost(optionHost ?? suggestion, "spl-autocomplete") as SmartRecruitersAutocomplete | null;

  if (!autocomplete || typeof autocomplete.selectOptionByIndex !== "function" || !optionHost) {
    return false;
  }

  const optionHosts = candidates
    .map((candidate) => candidate.matches("spl-select-option")
      ? candidate
      : candidate.closest<HTMLElement>("spl-select-option"))
    .filter((candidate): candidate is HTMLElement => candidate !== null);
  const uniqueOptionHosts = Array.from(new Set(optionHosts));
  const index = uniqueOptionHosts.indexOf(optionHost);
  if (index < 0) return false;

  autocomplete.selectOptionByIndex(index);
  return true;
}

function findShadowHost(element: Element, selector: string): Element | null {
  let current: Node | null = element;

  while (current) {
    if (current instanceof Element && current.matches(selector)) {
      return current;
    }

    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : current.parentNode;
  }

  return null;
}

type SmartRecruitersAutocomplete = HTMLElement & {
  selectOptionByIndex?: (index: number) => void;
};

function dispatchKeyboardSelection(
  input: HTMLInputElement,
  suggestion: HTMLElement,
  candidates: HTMLElement[]
): void {
  const orderedCandidates = candidates
    .filter(isSelectableOption)
    .sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectA.top - rectB.top || rectA.left - rectB.left;
    });
  const suggestionIndex = Math.max(0, orderedCandidates.indexOf(suggestion));

  input.focus({ preventScroll: true });
  for (let index = 0; index <= suggestionIndex; index += 1) {
    dispatchKeyboardKey(input, "ArrowDown");
  }
  dispatchKeyboardKey(input, "Enter");
}

function dispatchKeyboardKey(element: HTMLElement, key: string): void {
  const code = key === "ArrowDown" ? "ArrowDown" : "Enter";
  const keyCode = key === "ArrowDown" ? 40 : 13;
  const init: KeyboardEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    key,
    code,
    keyCode,
    which: keyCode
  };

  element.dispatchEvent(new KeyboardEvent("keydown", init));
  element.dispatchEvent(new KeyboardEvent("keyup", init));
}

function selectionAppearsCommitted(
  input: HTMLInputElement,
  suggestion: HTMLElement,
  containers: HTMLElement[]
): boolean {
  if (suggestion.getAttribute("aria-selected") === "true") return true;
  if (input.getAttribute("aria-expanded") === "false") return true;
  if (!suggestion.isConnected || !isVisibleInteractiveElement(suggestion)) return true;
  return containers.length > 0 && containers.every((container) =>
    !container.isConnected || !isVisibleInteractiveElement(container)
  );
}

async function selectAutocompleteSuggestion(
  input: HTMLInputElement,
  targetValue: string,
  visibleBeforeInput?: Set<HTMLElement>,
  timeoutMs = 1500
): Promise<AutocompleteSelectionResult> {
  const startedAt = Date.now();
  let menuFound = false;

  while (Date.now() - startedAt < timeoutMs) {
    const containers = findDropdownContainers(input);
    const candidates = findOptionCandidates(input, containers, visibleBeforeInput, targetValue);
    menuFound ||= containers.length > 0 || candidates.length > 0;

    const suggestion = findBestMatchingOption(input, candidates, targetValue, visibleBeforeInput);
    if (suggestion) {
      console.debug("[infill fill] clicking matched autocomplete suggestion", {
        tagName: suggestion.tagName,
        role: suggestion.getAttribute("role"),
        className: suggestion.className,
        text: suggestion.textContent?.trim().slice(0, 120)
      });
      const selectedThroughApi = selectThroughAutocompleteApi(suggestion, candidates);
      if (!selectedThroughApi) {
        dispatchMouseClick(suggestion);
      }
      await sleep(180);

      if (!selectionAppearsCommitted(input, suggestion, containers)) {
        console.debug("[infill fill] click did not close autocomplete; trying keyboard selection");
        dispatchKeyboardSelection(input, suggestion, candidates);
        await sleep(180);
      }

      return "selected";
    }

    await sleep(75);
  }

  return menuFound ? "unmatched" : "not-found";
}
