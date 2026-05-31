import type { ExtractedForm, FieldMapping } from "@infill/shared";
import { onMessage } from "webext-bridge/content-script";
import { fillApprovedFields } from "./fill";
import { installProfileLearning } from "./learn";
import { installOverlays, removeAllOverlays, startOverlayWatch, stopOverlayWatch } from "./overlay";
import { scanCurrentPage } from "./scanner";
import { debugLog } from "@/shared/debug-log";

// Prevent double-initialization in the same frame
declare global {
  var __FORM_MATE_LOADED__: boolean | undefined;
}

if (!globalThis.__FORM_MATE_LOADED__) {
  globalThis.__FORM_MATE_LOADED__ = true;

  let latestForms: ExtractedForm[] = [];

  onMessage("ping", async () => {
    return { ok: true };
  });

  onMessage("scan", async () => {
    debugLog("[contentScript] scan message received");
    const response = await scanCurrentPage();
    debugLog("[contentScript] scan result forms=", response.forms.length, "total fields=", response.forms.reduce((s, f) => s + f.fields.length, 0));
    latestForms = response.forms;
    installProfileLearning(latestForms);
    return response;
  });

  onMessage("fill", async ({ data: { mappings } }) => {
    return await fillApprovedFields(mappings, latestForms);
  });

  onMessage("auto-fill-and-overlay", async ({ data }) => {
    const { mappings } = data as { mappings: FieldMapping[] };
    const nonSensitive = mappings.filter(
      (m: FieldMapping) => m.risk !== "secret" && m.risk !== "restricted" && m.preselected && m.value !== undefined
    );
    const result = await fillApprovedFields(nonSensitive, latestForms);

    const allFields = latestForms.flatMap((form) => form.fields);
    installOverlays(mappings, allFields);
    startOverlayWatch();

    return result;
  });

  onMessage("remove-overlays", async () => {
    stopOverlayWatch();
    removeAllOverlays();
    return { ok: true };
  });

} // End of initialization guard
