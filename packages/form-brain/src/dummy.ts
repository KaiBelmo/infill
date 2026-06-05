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

export function generateDummyDataForField(field: ExtractedField): string | boolean {
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
    if (profileKey === "identity.first_name") resultValue = randomChoice(FIRST_NAMES);
    else if (profileKey === "identity.last_name") resultValue = randomChoice(LAST_NAMES);
    else if (profileKey === "identity.full_name") resultValue = `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`;
    else if (profileKey === "identity.middle_name") resultValue = randomChoice(FIRST_NAMES);
    else if (profileKey === "contact.email") resultValue = `${randomString(6)}@example.com`;
    else if (profileKey === "contact.phone") resultValue = `+1555${randomNumber(7)}`;
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
  } else {
    // Fallback heuristics based on input types
    if (field.inputType === "email") {
      resultValue = `${randomString(6)}@example.com`;
    } else if (field.inputType === "tel") {
      resultValue = `+1555${randomNumber(7)}`;
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
