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

  notifyExtensionAuthRedirect();

  let latestForms: ExtractedForm[] = [];
  let latestFormSignature = "";
  let formChangeObserver: MutationObserver | undefined;
  let formChangeTimer: number | undefined;

  onMessage("ping", async () => {
    return { ok: true };
  });

  onMessage("scan", async () => {
    debugLog("[contentScript] scan message received");
    const response = await scanCurrentPage();
    debugLog("[contentScript] scan result forms=", response.forms.length, "total fields=", response.forms.reduce((s, f) => s + f.fields.length, 0));
    latestForms = response.forms;
    latestFormSignature = formSignature(latestForms);
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
    startFormChangeWatch();

    return result;
  });

  onMessage("remove-overlays", async () => {
    stopOverlayWatch();
    stopFormChangeWatch();
    removeAllOverlays();
    return { ok: true };
  });


  function notifyExtensionAuthRedirect(): void {
    if (window.location.pathname !== __VITE_EXTENSION_REDIRECT_PATH__) return;
    const url = window.location.href;
    const params = new URL(url).searchParams;
    if (!params.has("code") && !params.has("error")) return;

    chrome.runtime.sendMessage({ type: "infill-auth-callback", url }).catch(() => undefined);
  }

  function startFormChangeWatch(): void {
    stopFormChangeWatch();
    formChangeObserver = new MutationObserver(() => {
      if (formChangeTimer !== undefined) {
        window.clearTimeout(formChangeTimer);
      }

      formChangeTimer = window.setTimeout(() => {
        void requestRescanIfFormChanged();
      }, 500);
    });
    formChangeObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopFormChangeWatch(): void {
    formChangeObserver?.disconnect();
    formChangeObserver = undefined;
    if (formChangeTimer !== undefined) {
      window.clearTimeout(formChangeTimer);
      formChangeTimer = undefined;
    }
  }

  async function requestRescanIfFormChanged(): Promise<void> {
    formChangeTimer = undefined;
    const response = await scanCurrentPage();
    const nextSignature = formSignature(response.forms);
    if (!nextSignature || nextSignature === latestFormSignature) {
      return;
    }

    latestForms = response.forms;
    latestFormSignature = nextSignature;
    installProfileLearning(latestForms);
    debugLog("[contentScript] visible form changed; requesting background rescan");
    chrome.runtime.sendMessage({ type: "infill-rescan-current-tab", url: window.location.href }).catch(() => undefined);
  }

  function formSignature(forms: ExtractedForm[]): string {
    return forms
      .flatMap((form) => form.fields)
      .map((field) => [
        field.tagName,
        field.inputType ?? "",
        field.name ?? "",
        field.id ?? "",
        field.labelText ?? "",
        field.ariaLabel ?? "",
        field.placeholder ?? "",
        field.options.map((option) => option.value).join(",")
      ].join("|"))
      .join("\n");
  }

} // End of initialization guard
