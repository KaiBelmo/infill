// Barrel re-export — cloud.ts is split into:
//   cloud-api.ts     — HTTP client, session management, auth helpers
//   cloud-assist.ts  — AI assist + profile parsing endpoints
//   cloud-billing.ts — billing, health, device management endpoints

export {
  getCloudState,
  saveCloudConfig,
  refreshCloudSession,
  logoutCloudSession,
  syncCloudSession,
  normalizeAuth,
  persistAuth,
  listCloudProfiles,
  saveCloudProfileMetadata,
  listEncryptedCloudProfiles,
  saveEncryptedCloudProfiles,
  deleteCloudProfile
} from "./cloud-api";

export {
  runCloudAssist,
  runCloudParseProfile
} from "./cloud-assist";

export {
  checkApiHealth,
  createBillingCheckout,
  listDevices
} from "./cloud-billing";

export {
  checkLocalOllama
} from "./ollama-health";
export type {
  OllamaHealthResult
} from "./ollama-health";
