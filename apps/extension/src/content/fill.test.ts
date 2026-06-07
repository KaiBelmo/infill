// @vitest-environment happy-dom

import type { ExtractedForm, FieldMapping } from "@infill/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fillApprovedFields } from "./fill";

const inputRect = { left: 20, top: 20, right: 220, bottom: 50, width: 200, height: 30 };
const optionRect = { left: 20, top: 55, right: 220, bottom: 85, width: 200, height: 30 };

describe("fillApprovedFields autocomplete selection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn()
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("waits for a portal listbox, prefers an exact match, and clicks it once", async () => {
    const input = createInput("city", { role: "combobox", "aria-controls": "city-options" });
    const exactClick = vi.fn();
    const containedClick = vi.fn();

    input.addEventListener("input", () => {
      window.setTimeout(() => {
        const listbox = createListbox("city-options");
        listbox.append(
          createOption("New York, NY, USA", containedClick),
          createOption("New York", exactClick)
        );
        document.body.append(listbox);
      }, 30);
    });

    const resultPromise = fillApprovedFields([mapping("city-field", "New York", "address.city")], [
      formWithFields(field("city-field", "city"))
    ]);

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(exactClick).toHaveBeenCalledTimes(1);
    expect(containedClick).not.toHaveBeenCalled();
    expect(result.filledFieldIds).toEqual(["city-field"]);
  });

  it("finds options rendered inside an open shadow root", async () => {
    const input = createInput("state", { "aria-autocomplete": "list" });
    const optionClick = vi.fn();

    input.addEventListener("input", () => {
      window.setTimeout(() => {
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const listbox = createListbox("state-options");
        listbox.append(createOption("California", optionClick));
        shadowRoot.append(listbox);
        document.body.append(host);
      }, 20);
    });

    const resultPromise = fillApprovedFields([mapping("state-field", "California", "address.state")], [
      formWithFields(field("state-field", "state"))
    ]);

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(optionClick).toHaveBeenCalledTimes(1);
  });

  it("clicks a newly rendered plain div row without option metadata", async () => {
    const input = createInput("city");
    const rowClick = vi.fn();

    input.addEventListener("input", () => {
      window.setTimeout(() => {
        const popup = document.createElement("div");
        setRect(popup, { left: 20, top: 50, right: 220, bottom: 130, width: 200, height: 80 });

        const row = document.createElement("div");
        row.textContent = "Tokyo, Japan";
        row.addEventListener("click", rowClick);
        setRect(row, optionRect);

        popup.append(row);
        document.body.append(popup);
      }, 20);
    });

    const resultPromise = fillApprovedFields([mapping("city-field", "Tokyo", "address.city")], [
      formWithFields(field("city-field", "city"))
    ]);

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(rowClick).toHaveBeenCalledTimes(1);
  });

  it("uses pressed mouse button state for components that select on mousedown", async () => {
    const input = createInput("city");
    const selected = vi.fn();

    input.addEventListener("input", () => {
      const row = document.createElement("div");
      row.textContent = "Berlin, State of Berlin, Germany";
      row.addEventListener("mousedown", (event) => {
        if (event.buttons === 1) {
          selected();
          row.remove();
        }
      });
      setRect(row, optionRect);
      document.body.append(row);
    });

    const resultPromise = fillApprovedFields([mapping("city-field", "Berlin", "address.city")], [
      formWithFields(field("city-field", "city"))
    ]);

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(selected).toHaveBeenCalledTimes(1);
  });

  it("uses the spl-autocomplete option API instead of clicking an inner text child", async () => {
    const input = createInput("city");
    const selectOptionByIndex = vi.fn();

    input.addEventListener("input", () => {
      const autocomplete = document.createElement("spl-autocomplete") as HTMLElement & {
        selectOptionByIndex: (index: number) => void;
      };
      autocomplete.selectOptionByIndex = selectOptionByIndex;
      setRect(autocomplete, { left: 20, top: 50, right: 220, bottom: 130, width: 200, height: 80 });
      const autocompleteRoot = autocomplete.attachShadow({ mode: "open" });

      const option = document.createElement("spl-select-option");
      setRect(option, optionRect);
      const content = document.createElement("div");
      content.textContent = "Berlin, State of Berlin, Germany";
      setRect(content, optionRect);
      option.append(content);
      autocompleteRoot.append(option);
      document.body.append(autocomplete);
    });

    const resultPromise = fillApprovedFields([mapping("city-field", "Berlin", "address.city")], [
      formWithFields(field("city-field", "city"))
    ]);

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(selectOptionByIndex).toHaveBeenCalledWith(0);
  });

  it("falls back to ArrowDown and Enter when the clicked menu stays open", async () => {
    const input = createInput("city");
    const keyboardCommit = vi.fn();
    let activeIndex = -1;

    input.addEventListener("input", () => {
      const row = document.createElement("div");
      row.textContent = "Berlin, State of Berlin, Germany";
      setRect(row, optionRect);
      document.body.append(row);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") activeIndex += 1;
      if (event.key === "Enter" && activeIndex === 0) keyboardCommit();
    });

    const resultPromise = fillApprovedFields([mapping("city-field", "Berlin", "address.city")], [
      formWithFields(field("city-field", "city"))
    ]);

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(keyboardCommit).toHaveBeenCalledTimes(1);
  });

  it("ignores hidden, disabled, and unrelated pre-existing options", async () => {
    const unrelated = createOption("New York", vi.fn());
    document.body.append(unrelated);

    const input = createInput("city", { role: "combobox", "aria-controls": "city-options" });
    const hiddenClick = vi.fn();
    const disabledClick = vi.fn();
    const matchingClick = vi.fn();

    input.addEventListener("input", () => {
      const listbox = createListbox("city-options");
      const hidden = createOption("New York", hiddenClick);
      hidden.style.display = "none";
      const disabled = createOption("New York", disabledClick);
      disabled.setAttribute("aria-disabled", "true");
      listbox.append(hidden, disabled, createOption("New York, NY", matchingClick));
      document.body.append(listbox);
    });

    const resultPromise = fillApprovedFields([mapping("city-field", "New York", "address.city")], [
      formWithFields(field("city-field", "city"))
    ]);

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(hiddenClick).not.toHaveBeenCalled();
    expect(disabledClick).not.toHaveBeenCalled();
    expect(matchingClick).toHaveBeenCalledTimes(1);
  });

  it("keeps unmatched text and continues filling subsequent fields", async () => {
    const city = createInput("city", { role: "combobox", "aria-controls": "city-options" });
    const company = createInput("company");

    city.addEventListener("input", () => {
      const listbox = createListbox("city-options");
      listbox.append(createOption("Boston", vi.fn()));
      document.body.append(listbox);
    });

    const resultPromise = fillApprovedFields(
      [
        mapping("city-field", "New York", "address.city"),
        mapping("company-field", "Acme", "organization")
      ],
      [formWithFields(field("city-field", "city"), field("company-field", "company"))]
    );

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(city.value).toBe("New York");
    expect(company.value).toBe("Acme");
    expect(result.filledFieldIds).toEqual(["city-field", "company-field"]);
  });

  it("does not run autocomplete polling for a plain text input", async () => {
    const company = createInput("company");
    let settled = false;
    const resultPromise = fillApprovedFields([mapping("company-field", "Acme", "organization")], [
      formWithFields(field("company-field", "company"))
    ]).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(settled).toBe(true);
    expect((await resultPromise).filledFieldIds).toEqual(["company-field"]);
  });

  it("keeps QA fills fast when a heuristic address field has no dropdown", async () => {
    createInput("city");
    let settled = false;
    const resultPromise = fillApprovedFields([mapping("city-field", "Paris", "qa.dummy")], [
      formWithFields(field("city-field", "city"))
    ]).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(400);

    expect(settled).toBe(true);
    expect((await resultPromise).filledFieldIds).toEqual(["city-field"]);
  });

  it("emits spl-change so a phone field can update its selected country", async () => {
    const phoneField = document.createElement("spl-phone-field");
    const phoneRoot = phoneField.attachShadow({ mode: "open" });
    const inputHost = document.createElement("spl-input");
    const inputRoot = inputHost.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    input.id = "phone";
    input.name = "phone";
    input.type = "tel";
    setRect(phoneField, inputRect);
    setRect(inputHost, inputRect);
    setRect(input, inputRect);
    inputRoot.append(input);
    phoneRoot.append(inputHost);
    document.body.append(phoneField);

    const change = vi.fn();
    phoneField.addEventListener("spl-change", change);
    const resultPromise = fillApprovedFields([mapping("phone-field", "+12025550123", "contact.phone")], [
      formWithFields(field("phone-field", "phone"))
    ]);

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(change).toHaveBeenCalledTimes(1);
    expect((change.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ value: "+12025550123" });
  });
});

function createInput(id: string, attributes: Record<string, string> = {}): HTMLInputElement {
  const input = document.createElement("input");
  input.id = id;
  input.name = id;
  for (const [name, value] of Object.entries(attributes)) {
    input.setAttribute(name, value);
  }
  setRect(input, inputRect);
  document.body.append(input);
  return input;
}

function createListbox(id: string): HTMLElement {
  const listbox = document.createElement("div");
  listbox.id = id;
  listbox.setAttribute("role", "listbox");
  setRect(listbox, { left: 20, top: 50, right: 220, bottom: 120, width: 200, height: 70 });
  return listbox;
}

function createOption(text: string, onClick: () => void): HTMLElement {
  const option = document.createElement("div");
  option.setAttribute("role", "option");
  option.textContent = text;
  option.addEventListener("click", onClick);
  setRect(option, optionRect);
  return option;
}

function setRect(element: Element, rect: Record<string, number>): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...rect, x: rect.left, y: rect.top, toJSON: () => rect }) as DOMRect
  });
}

function field(fieldId: string, id: string): ExtractedForm["fields"][number] {
  return {
    fieldId,
    formId: "test-form",
    tagName: "input",
    inputType: "text",
    name: id,
    id,
    options: [],
    required: false,
    disabled: false,
    readonly: false,
    visible: true,
    hasUserValue: false,
    domPathHint: `input#${id}`
  };
}

function formWithFields(...fields: ExtractedForm["fields"]): ExtractedForm {
  return {
    formId: "test-form",
    urlOrigin: "https://example.test",
    urlPathHash: "test",
    fields,
    scanWarnings: [],
    createdAt: new Date().toISOString()
  };
}

function mapping(fieldId: string, value: string, profileKey: string): FieldMapping {
  return {
    fieldId,
    profileKey,
    value,
    valueSource: "manual",
    confidence: 1,
    risk: "safe",
    preselected: true,
    requiresExplicitApproval: false,
    reason: "test",
    warnings: [],
    usedFactIds: []
  };
}
