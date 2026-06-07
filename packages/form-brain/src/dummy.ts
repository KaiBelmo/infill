import type { ExtractedField } from "@infill/shared";
import { findProfileKey } from "./matcher";

const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Casey", "Morgan", "Riley", "Sam", "Jamie", "Drew", "Avery"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];
const COMPANIES = ["Acme Corp", "Globex", "Soylent Corp", "Initech", "Umbrella Corp", "Stark Industries", "Wayne Enterprises"];
const SOCIAL_HANDLE_PREFIX = "infill";

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
function randomUsPhoneNumber(): string {
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
  return `+1${areaCode}${exchange}${line}`;
}

type LocalePersona = {
  country: string;
  cities: string[];
  regions: string[];
  postalCodes: string[];
  streets: string[];
  phone: () => string;
};

type LocalizedDummyValueGenerator = (field: ExtractedField, persona: LocalePersona) => string;

const localePersonas: Record<string, LocalePersona> = {
  "en-US": locale("United States", ["New York", "Austin", "Seattle"], ["New York", "Texas", "Washington"], ["10001", "78701", "98101"], ["350 Fifth Avenue", "100 Congress Avenue"], randomUsPhoneNumber),
  "en-GB": locale("United Kingdom", ["London", "Manchester", "Edinburgh"], ["England", "England", "Scotland"], ["SW1A 1AA", "M1 1AE", "EH1 1YZ"], ["10 Downing Street", "25 Deansgate"], () => "+447700900123"),
  "fr-FR": locale("France", ["Paris", "Lyon", "Marseille"], ["Île-de-France", "Auvergne-Rhône-Alpes", "Provence-Alpes-Côte d’Azur"], ["75001", "69001", "13001"], ["10 Rue de Rivoli", "25 Rue de la République"], () => `+336${randomNumber(8)}`),
  "fr-CA": locale("Canada", ["Montréal", "Québec", "Ottawa"], ["Québec", "Québec", "Ontario"], ["H2Y 1C6", "G1R 4P5", "K1P 1J1"], ["100 Rue Sainte-Catherine", "50 Rue Saint-Jean"], () => "+14165550123"),
  "de-DE": locale("Germany", ["Berlin", "Munich", "Hamburg"], ["Berlin", "Bavaria", "Hamburg"], ["10115", "80331", "20095"], ["Unter den Linden 10", "Marienplatz 8"], () => `+49151${randomNumber(8)}`),
  "es-ES": locale("Spain", ["Madrid", "Barcelona", "Valencia"], ["Community of Madrid", "Catalonia", "Valencian Community"], ["28001", "08001", "46001"], ["Calle de Alcalá 10", "Carrer de Mallorca 25"], () => `+346${randomNumber(8)}`),
  "it-IT": locale("Italy", ["Rome", "Milan", "Turin"], ["Lazio", "Lombardy", "Piedmont"], ["00184", "20121", "10121"], ["Via Nazionale 10", "Via Roma 25"], () => `+39320${randomNumber(7)}`),
  "pt-PT": locale("Portugal", ["Lisbon", "Porto", "Braga"], ["Lisbon", "Porto", "Braga"], ["1000-001", "4000-001", "4700-001"], ["Avenida da Liberdade 10", "Rua de Santa Catarina 25"], () => `+35191${randomNumber(7)}`),
  "nl-NL": locale("Netherlands", ["Amsterdam", "Rotterdam", "Utrecht"], ["North Holland", "South Holland", "Utrecht"], ["1012 JS", "3011 AA", "3511 CE"], ["Damrak 10", "Coolsingel 25"], () => `+316${randomNumber(8)}`),
  "pl-PL": locale("Poland", ["Warsaw", "Kraków", "Wrocław"], ["Masovian", "Lesser Poland", "Lower Silesian"], ["00-001", "30-001", "50-001"], ["Marszałkowska 10", "Floriańska 25"], () => `+48501${randomNumber(6)}`),
  "ja-JP": locale("Japan", ["Tokyo", "Osaka", "Kyoto"], ["Tokyo", "Osaka", "Kyoto"], ["100-0001", "530-0001", "600-8001"], ["1-1 Chiyoda", "1-1 Umeda"], () => `+8190${randomNumber(8)}`),
  "zh-CN": locale("China", ["Beijing", "Shanghai", "Shenzhen"], ["Beijing", "Shanghai", "Guangdong"], ["100000", "200000", "518000"], ["10 Chang'an Avenue", "25 Nanjing Road"], () => `+8613${randomNumber(9)}`),
  "ko-KR": locale("South Korea", ["Seoul", "Busan", "Incheon"], ["Seoul", "Busan", "Incheon"], ["03000", "48000", "22000"], ["10 Sejong-daero", "25 Haeundae-ro"], () => `+8210${randomNumber(8)}`),
  "pt-BR": locale("Brazil", ["São Paulo", "Rio de Janeiro", "Brasília"], ["São Paulo", "Rio de Janeiro", "Federal District"], ["01001-000", "20010-000", "70040-010"], ["Avenida Paulista 100", "Avenida Rio Branco 25"], () => `+55119${randomNumber(8)}`),
  "en-AU": locale("Australia", ["Sydney", "Melbourne", "Brisbane"], ["New South Wales", "Victoria", "Queensland"], ["2000", "3000", "4000"], ["10 George Street", "25 Collins Street"], () => `+614${randomNumber(8)}`),
  "en-IN": locale("India", ["Mumbai", "Delhi", "Bengaluru"], ["Maharashtra", "Delhi", "Karnataka"], ["400001", "110001", "560001"], ["10 Marine Drive", "25 Connaught Place"], () => `+919${randomNumber(9)}`)
};

const languageDefaults: Record<string, string> = {
  en: "en-US",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  it: "it-IT",
  pt: "pt-PT",
  nl: "nl-NL",
  pl: "pl-PL",
  ja: "ja-JP",
  zh: "zh-CN",
  ko: "ko-KR"
};

function locale(
  country: string,
  cities: string[],
  regions: string[],
  postalCodes: string[],
  streets: string[],
  phone: () => string
): LocalePersona {
  return { country, cities, regions, postalCodes, streets, phone };
}

function resolveLocalePersona(language: string | undefined): LocalePersona {
  const normalized = (language || "en-US").replace("_", "-");
  const [languageCode, regionCode] = normalized.split("-");
  const exactKey = regionCode ? `${languageCode?.toLowerCase()}-${regionCode.toUpperCase()}` : undefined;
  const fallbackKey = languageDefaults[languageCode?.toLowerCase() ?? ""] ?? "en-US";
  return localePersonas[exactKey ?? ""] ?? localePersonas[fallbackKey] ?? localePersonas["en-US"]!;
}

const socialProfileGenerators: Record<string, LocalizedDummyValueGenerator> = {
  "contact.linkedin": () => `https://www.linkedin.com/in/${randomHandle("-")}`,
  "contact.github": () => `https://github.com/${randomHandle("-")}`,
  "contact.facebook": () => `https://www.facebook.com/${randomHandle(".")}`,
  "contact.twitter": (field) => generateTwitterValue(field),
  "contact.instagram": () => `https://www.instagram.com/${randomHandle("_")}`,
  "contact.threads": () => `https://www.threads.net/@${randomHandle("_")}`,
  "contact.tiktok": () => `https://www.tiktok.com/@${randomHandle("_")}`,
  "contact.youtube": () => `https://www.youtube.com/@${randomHandle("")}`,
  "contact.snapchat": () => randomHandle("_"),
  "contact.pinterest": () => `https://www.pinterest.com/${randomHandle("_")}`,
  "contact.reddit": () => `https://www.reddit.com/user/${randomHandle("_")}`,
  "contact.discord": () => randomHandle("_"),
  "contact.telegram": () => `https://t.me/${randomHandle("_")}`,
  "contact.whatsapp": (_field, persona) => persona.phone(),
  "contact.medium": () => `https://medium.com/@${randomHandle("-")}`,
  "contact.stackoverflow": () => `https://stackoverflow.com/users/12345678/${randomHandle("-")}`,
  "contact.dribbble": () => `https://dribbble.com/${randomHandle("-")}`,
  "contact.behance": () => `https://www.behance.net/${randomHandle("-")}`,
  "contact.bluesky": () => `${randomHandle("-")}.bsky.social`,
  "contact.mastodon": () => `@${randomHandle("_")}@mastodon.social`,
  "contact.twitch": () => `https://www.twitch.tv/${randomHandle("_")}`,
  "contact.gitlab": () => `https://gitlab.com/${randomHandle("-")}`,
  "contact.bitbucket": () => `https://bitbucket.org/${randomHandle("-")}`,
  "contact.producthunt": () => `https://www.producthunt.com/@${randomHandle("_")}`
};

const profileValueGenerators: Record<string, LocalizedDummyValueGenerator> = {
  "identity.first_name": () => randomChoice(FIRST_NAMES),
  "identity.last_name": () => randomChoice(LAST_NAMES),
  "identity.full_name": () => `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`,
  "identity.middle_name": () => randomChoice(FIRST_NAMES),
  "contact.email": () => `${randomString(6)}@example.com`,
  "contact.phone": (_field, persona) => persona.phone(),
  "contact.website": () => `https://www.${randomString(8)}.com`,
  ...socialProfileGenerators,
  "address.street_1": (_field, persona) => randomChoice(persona.streets),
  "address.street_2": () => `Apt ${randomNumber(2)}`,
  "address.city": (_field, persona) => randomChoice(persona.cities),
  "address.region": (_field, persona) => randomChoice(persona.regions),
  "address.postal_code": (_field, persona) => randomChoice(persona.postalCodes),
  "address.country": (_field, persona) => persona.country,
  "company.name": () => randomChoice(COMPANIES),
  "work.current_title": () => "Engineer"
};

function randomHandle(separator: string): string {
  return `${SOCIAL_HANDLE_PREFIX}${separator}${randomString(8)}`;
}

function generateTwitterValue(field: ExtractedField): string {
  const fieldText = [
    field.labelText,
    field.ariaLabel,
    field.placeholder,
    field.name,
    field.id
  ].filter(Boolean).join(" ").toLowerCase();
  const handle = randomHandle("_");

  return /\b(url|link|profile|profil)\b/.test(fieldText)
    ? `https://twitter.com/${handle}`
    : handle;
}

/**
 * Generates valid, realistic dummy data for form fields.
 * If a state object is passed, it maintains consistency across related fields
 * (e.g. email and confirm email fields will have identical values).
 *
 * @param field The field schema extracted from the form.
 * @param state A mutable state container shared across the current form fill operation.
 */
export function generateDummyDataForField(
  field: ExtractedField,
  state: Record<string, string | boolean> = {},
  language = "en-US"
): string | boolean {
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
  const persona = resolveLocalePersona(language);

  if (profileKey) {
    if (state[profileKey] !== undefined) {
      resultValue = state[profileKey] as string;
    } else {
      const sharedStateKey = profileKey === "contact.email"
        ? "email"
        : profileKey === "contact.phone"
          ? "tel"
          : undefined;
      const cachedValue = sharedStateKey ? state[sharedStateKey] : undefined;
      const generator = profileValueGenerators[profileKey];
      resultValue = typeof cachedValue === "string"
        ? cachedValue
        : generator?.(field, persona) ?? `Test Value ${randomString(4)}`;

      state[profileKey] = resultValue;
      if (sharedStateKey) state[sharedStateKey] = resultValue;
    }
  } else {
    // Fallback heuristics based on input types
    if (field.inputType === "email") {
      if (state["email"] !== undefined) resultValue = state["email"] as string;
      else { resultValue = `${randomString(6)}@example.com`; state["email"] = resultValue; }
    } else if (field.inputType === "tel") {
      if (state["tel"] !== undefined) resultValue = state["tel"] as string;
      else { resultValue = persona.phone(); state["tel"] = resultValue; }
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
