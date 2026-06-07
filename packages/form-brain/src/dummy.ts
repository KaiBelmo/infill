import type { ExtractedField } from "@infill/shared";
import { findProfileKey } from "./matcher";

const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Casey", "Morgan", "Riley", "Sam", "Jamie", "Drew", "Avery"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];
const CITIES = ["New York", "London", "Toronto", "Sydney", "Berlin", "Tokyo", "Paris", "Austin", "Seattle", "Denver"];
const COMPANIES = ["Acme Corp", "Globex", "Soylent Corp", "Initech", "Umbrella Corp", "Stark Industries", "Wayne Enterprises"];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomString(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length }, () => randomChoice(chars.split(""))).join("");
}

function randomNumber(length: number): string {
  const chars = "0123456789";
  return Array.from({ length }, () => randomChoice(chars.split(""))).join("");
}

const US_AREA_CODES = [
  "201", "202", "203", "205", "206", "207", "208", "209",
  "210", "212", "213", "214", "215", "216", "217", "218", "219",
  "301", "302", "303", "304", "305", "307", "308", "309",
  "310", "312", "313", "314", "315", "316", "317", "318", "319",
  "401", "402", "404", "405", "406", "407", "408", "409",
  "410", "412", "413", "414", "415", "417", "419",
  "501", "502", "503", "504", "505", "507", "508", "509",
  "510", "512", "513", "515", "516", "517", "518",
  "601", "602", "603", "605", "606", "607", "608", "609",
  "610", "612", "614", "615", "616", "617", "618", "619",
  "701", "702", "703", "704", "706", "707", "708", "712",
  "713", "714", "715", "716", "717", "718", "719",
  "801", "802", "803", "804", "805", "806", "808", "810",
  "812", "813", "814", "815", "816", "817", "818",
  "901", "903", "904", "906", "907", "908", "909", "910",
  "912", "913", "914", "915", "916", "917", "918", "919",
  "920", "925", "928", "931", "936", "937", "940", "941",
  "949", "952", "954", "956", "970", "972", "973", "978", "979"
];

/**
 * Generates a realistic North American Numbering Plan (NANP) phone number.
 * Uses a curated list of active area codes and avoids invalid exchanges (e.g. 555 and N11).
 */
function randomPhoneNumber(): string {
  const areaCode = randomChoice(US_AREA_CODES);
  let exchange = "";
  while (true) {
    const d1 = randomChoice(["2","3","4","5","6","7","8","9"]);
    const d2 = randomChoice(["0","1","2","3","4","5","6","7","8","9"]);
    const d3 = randomChoice(["0","1","2","3","4","5","6","7","8","9"]);
    exchange = `${d1}${d2}${d3}`;
    if (exchange !== "555" && !(d2 === "1" && d3 === "1")) {
      break;
    }
  }
  const line = randomNumber(4);
  return `${areaCode}${exchange}${line}`;
}

/**
 * Generates valid, realistic dummy data for form fields.
 * If a state object is passed, it maintains consistency across related fields
 * (e.g. email and confirm email fields will have identical values).
 *
 * @param field The field schema extracted from the form.
 * @param state A mutable state container shared across the current form fill operation.
 */
export function generateDummyDataForField(field: ExtractedField, state: Record<string, string | boolean> = {}): string | boolean {
  // Checkbox inputs with no options or single option default to true (checked)
  if (field.inputType === "checkbox" && (!field.options || field.options.length <= 1)) {
    return true;
  }

  // Handle select/radio/checkbox options gracefully by selecting a valid option
  if (field.options && field.options.length > 0) {
    // Attempt to pick a non-empty option value first
    const nonEmptyOptions = field.options.filter((opt) => opt.value && opt.value.trim() !== "");
    if (nonEmptyOptions.length > 0) {
      return randomChoice(nonEmptyOptions).value;
    }
    return randomChoice(field.options).value;
  }

  let resultValue: string;
  const profileKey = findProfileKey(field);

  if (profileKey) {
    if (state[profileKey] !== undefined) {
      resultValue = state[profileKey] as string;
    } else {
      if (profileKey === "identity.first_name") resultValue = randomChoice(FIRST_NAMES);
      else if (profileKey === "identity.last_name") resultValue = randomChoice(LAST_NAMES);
      else if (profileKey === "identity.full_name") resultValue = `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`;
      else if (profileKey === "identity.middle_name") resultValue = randomChoice(FIRST_NAMES);
      else if (profileKey === "contact.email") {
        if (state["email"] !== undefined) resultValue = state["email"] as string;
        else resultValue = `${randomString(6)}@example.com`;
      }
      else if (profileKey === "contact.phone") {
        if (state["tel"] !== undefined) resultValue = state["tel"] as string;
        else resultValue = randomPhoneNumber();
      }
      else if (profileKey === "contact.website") resultValue = `https://www.${randomString(8)}.com`;
      else if (profileKey === "address.street_1") resultValue = `${randomNumber(4)} Main St`;
      else if (profileKey === "address.street_2") resultValue = `Apt ${randomNumber(2)}`;
      else if (profileKey === "address.city") resultValue = randomChoice(CITIES);
      else if (profileKey === "address.region") resultValue = "State";
      else if (profileKey === "address.postal_code") resultValue = randomNumber(5);
      else if (profileKey === "address.country") resultValue = "United States";
      else if (profileKey === "company.name") resultValue = randomChoice(COMPANIES);
      else if (profileKey === "work.current_title") resultValue = "Engineer";
      else {
        resultValue = "Test Value " + randomString(4);
      }
      state[profileKey] = resultValue;
      if (profileKey === "contact.email") state["email"] = resultValue;
      if (profileKey === "contact.phone") state["tel"] = resultValue;
    }
  } else {
    // Fallback heuristics based on input types
    if (field.inputType === "email") {
      if (state["email"] !== undefined) resultValue = state["email"] as string;
      else { resultValue = `${randomString(6)}@example.com`; state["email"] = resultValue; }
    } else if (field.inputType === "tel") {
      if (state["tel"] !== undefined) resultValue = state["tel"] as string;
      else { resultValue = randomPhoneNumber(); state["tel"] = resultValue; }
    } else if (field.inputType === "url") {
      resultValue = `https://www.${randomString(8)}.com`;
    } else if (field.inputType === "number" || field.inputType === "range") {
      const minVal = field.min ? Number(field.min) : 1;
      const maxVal = field.max ? Number(field.max) : 100;
      if (!isNaN(minVal) && !isNaN(maxVal)) {
        const randNum = Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal;
        resultValue = String(randNum);
      } else {
        resultValue = randomNumber(3);
      }
    } else if (field.inputType === "date") {
      resultValue = "2026-06-05";
    } else if (field.inputType === "month") {
      resultValue = "2026-06";
    } else if (field.inputType === "time") {
      resultValue = "12:00";
    } else if (field.inputType === "color") {
      resultValue = "#3b82f6";
    } else if (field.tagName === "textarea") {
      resultValue = "This is some dummy text generated for testing purposes.";
    } else {
      resultValue = "Test Value " + randomString(4);
    }
  }

  // Handle maxLength restriction if specified
  if (field.maxLength && resultValue.length > field.maxLength) {
    resultValue = resultValue.slice(0, field.maxLength);
  }

  return resultValue;
}
