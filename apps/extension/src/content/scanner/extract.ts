import type { ExtractedField } from "@infill/shared";
import type { SupportedControl } from "./dom-utils";
import {
  buildCssPath,
  getControlValue,
  getDomPathHint,
  getMaxLength,
  hasSensitiveType,
  isDisabled,
  isLikelyTokenField,
  isReadonly,
  isRequired,
  isVisible,
  querySelectorAllDeep,
  trimText
} from "./dom-utils";

const DATA_ATTRIBUTE_HINTS = [
  "data-type",
  "data-field",
  "data-field-type",
  "data-name",
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy"
];

export type ControlGroup = {
  formId: string;
  title?: string;
  controls: SupportedControl[];
};

export function findControls(): SupportedControl[] {
  const selectors = [
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[role='textbox']",
    "[role='combobox']",
    "[role='radio']",
    "[role='checkbox']"
  ];

  const selectorString = selectors.join(",");

  const elements = querySelectorAllDeep(selectorString, document);

  let uid = 0;
  return elements.filter((element) => {
    if (element instanceof HTMLInputElement && element.type === "hidden") {
      return false;
    }

    if (isLikelyTokenField(element)) {
      return false;
    }

    element.setAttribute("data-fm-uid", String(uid++));
    return true;
  });
}

export function groupControlsIntoForms(controls: SupportedControl[]): ControlGroup[] {
  const groups = new Map<HTMLFormElement | Document, SupportedControl[]>();

  for (const control of controls) {
    const key = control.closest("form") ?? document;
    groups.set(key, [...(groups.get(key) ?? []), control]);
  }

  return Array.from(groups.entries()).map(([owner, groupControls], index) => ({
    formId: owner instanceof HTMLFormElement && owner.id ? `form_${owner.id}` : `form_${index + 1}`,
    title: owner instanceof HTMLFormElement ? inferFormTitle(owner) : inferDocumentFormTitle(groupControls),
    controls: groupControls
  }));
}

export function getFillTargetControls(controls: SupportedControl[]): SupportedControl[] {
  const seenRadioGroups = new Set<string>();
  const result: SupportedControl[] = [];

  for (const control of controls) {
    if (control instanceof HTMLInputElement && control.type === "radio" && control.name) {
      if (seenRadioGroups.has(control.name)) {
        continue;
      }

      seenRadioGroups.add(control.name);
    }

    result.push(control);
  }

  return result;
}

export function extractField(
  element: SupportedControl,
  index: number,
  formId: string,
  siblingControls: SupportedControl[]
): ExtractedField {
  const rect = element.getBoundingClientRect();
  const inputType = element instanceof HTMLInputElement ? element.type : undefined;
  const value = getControlValue(element);

  return {
    fieldId: `${formId}_field_${index + 1}`,
    formId,
    tagName: tagNameFor(element),
    inputType,
    role: element.getAttribute("role") ?? undefined,
    name: element.getAttribute("name") ?? undefined,
    id: element.id || undefined,
    className: getClassName(element),
    dataAttributes: getDataAttributes(element),
    autocomplete: element.getAttribute("autocomplete") ?? undefined,
    labelText: getFieldLabelText(element),
    ariaLabel: element.getAttribute("aria-label") ?? undefined,
    ariaDescription: element.getAttribute("aria-description") ?? undefined,
    placeholder: getPlaceholder(element),
    title: element.title || undefined,
    nearbyText: getNearbyText(element),
    sectionHeading: getSectionHeading(element),
    groupLabel: getGroupLabel(element),
    options: getOptions(element, siblingControls),
    required: isRequired(element),
    disabled: isDisabled(element),
    readonly: isReadonly(element),
    visible: isVisible(element),
    currentValue: hasSensitiveType(inputType) ? undefined : value || undefined,
    hasUserValue: Boolean(value),
    maxLength: getMaxLength(element),
    pattern: element instanceof HTMLInputElement ? element.pattern || undefined : undefined,
    min: element instanceof HTMLInputElement ? element.min || undefined : undefined,
    max: element instanceof HTMLInputElement ? element.max || undefined : undefined,
    step: element instanceof HTMLInputElement ? element.step || undefined : undefined,
    domPathHint: getDomPathHint(element),
    cssPath: buildCssPath(element),
    boundingBox: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }
  };
}

export function buildScanWarnings(controls: SupportedControl[]): string[] {
  const skippedInvisibleCount = controls.filter((control) => !isVisible(control)).length;

  return buildScanWarningsFromSkippedInvisibleCount(skippedInvisibleCount);
}

export function buildScanWarningsFromSkippedInvisibleCount(skippedInvisibleCount: number): string[] {
  const warnings = [];

  if (skippedInvisibleCount > 0) {
    warnings.push(`${skippedInvisibleCount} hidden or invisible fields were skipped.`);
  }

  return warnings;
}

function inferFormTitle(form: HTMLFormElement): string | undefined {
  const labelledBy = form.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = document.getElementById(labelledBy);
    if (label?.textContent) {
      return trimText(label.textContent, 120);
    }
  }

  const heading = form.querySelector("h1,h2,h3,legend");
  return heading?.textContent ? trimText(heading.textContent, 120) : undefined;
}

function inferDocumentFormTitle(controls: SupportedControl[]): string | undefined {
  const firstControl = controls[0];
  if (!firstControl) {
    return undefined;
  }

  return getSectionHeading(firstControl);
}

function tagNameFor(element: Element): ExtractedField["tagName"] {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return tagName;
  }

  return "custom";
}

function getLabelText(element: HTMLElement): string | undefined {
  if ("labels" in element) {
    const labels = Array.from((element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).labels ?? [])
      .map((label) => label.textContent)
      .filter((text): text is string => Boolean(text?.trim()))
      .join(" ");
    if (labels) {
      return trimText(labels, 160);
    }
  }

  if (element.id) {
    const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (explicit?.textContent) {
      return trimText(explicit.textContent, 160);
    }
  }

  const parentLabel = element.closest("label");
  if (parentLabel?.textContent) {
    return trimText(parentLabel.textContent, 160);
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent)
      .filter((text): text is string => Boolean(text?.trim()))
      .join(" ");
    if (label) {
      return trimText(label, 160);
    }
  }

  return undefined;
}

function getFieldLabelText(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
    return getRadioGroupLabel(element) ?? getLabelText(element);
  }

  return getLabelText(element);
}

function getRadioGroupLabel(element: HTMLInputElement): string | undefined {
  const fieldset = element.closest("fieldset");
  const legend = fieldset?.querySelector("legend");
  if (legend?.textContent) {
    return trimText(legend.textContent, 160);
  }

  const optionLabel = element.closest("label");
  const choiceContainer = optionLabel?.parentElement;
  const groupLabel = choiceContainer?.previousElementSibling;
  if (groupLabel?.tagName.toLowerCase() === "label" && groupLabel.textContent) {
    return trimText(groupLabel.textContent, 160);
  }

  return undefined;
}

function getClassName(element: HTMLElement): string | undefined {
  const className = typeof element.className === "string" ? element.className : "";
  return className.trim() || undefined;
}

function getDataAttributes(element: HTMLElement): Record<string, string> | undefined {
  const result: Record<string, string> = {};

  for (const name of DATA_ATTRIBUTE_HINTS) {
    const value = element.getAttribute(name)?.trim();
    if (value) {
      result[name] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function getPlaceholder(element: SupportedControl): string | undefined {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.placeholder || undefined
    : undefined;
}

function getNearbyText(element: HTMLElement): string | undefined {
  const previous = element.previousElementSibling;
  if (!previous?.textContent || previous.matches("script,style,input,textarea,select")) {
    return undefined;
  }

  return trimText(previous.textContent, 160);
}

function getSectionHeading(element: HTMLElement): string | undefined {
  let current: HTMLElement | null = element.parentElement;

  while (current && current !== document.body) {
    const heading = current.querySelector(":scope > h1,:scope > h2,:scope > h3,:scope > legend");
    if (heading?.textContent) {
      return trimText(heading.textContent, 120);
    }

    current = current.parentElement;
  }

  return undefined;
}

function getGroupLabel(element: HTMLElement): string | undefined {
  const fieldset = element.closest("fieldset");
  const legend = fieldset?.querySelector("legend");

  return legend?.textContent ? trimText(legend.textContent, 120) : undefined;
}

function getOptions(element: SupportedControl, siblingControls: SupportedControl[]): ExtractedField["options"] {
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options).map((option) => ({
      label: trimText(option.label || option.textContent || "", 120),
      value: option.value,
      selected: option.selected
    }));
  }

  if (element instanceof HTMLInputElement && (element.type === "radio" || element.type === "checkbox") && element.name) {
    return siblingControls
      .filter((control): control is HTMLInputElement => control instanceof HTMLInputElement)
      .filter((control) => control.name === element.name && control.type === element.type)
      .map((control) => ({
        label: getLabelText(control) ?? control.value,
        value: control.value,
        selected: control.checked
      }));
  }

  return [];
}
