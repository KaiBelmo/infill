import type { ExtractedForm } from "@infill/shared";
import { buildScanWarningsFromSkippedInvisibleCount, extractField, findControls, getFillTargetControls, groupControlsIntoForms } from "./scanner/extract";
import { hashText, isDisabled, isVisible, sleep, trimText } from "./scanner/dom-utils";
import { debugLog } from "@/shared/debug-log";

const MAX_SCAN_RETRIES = 2;
const RETRY_DELAY_MS = 800;

export async function scanCurrentPage(): Promise<{ forms: ExtractedForm[] }> {
  let result = await scanOnce();

  const hasVisibleFields = result.forms.some((form) => form.fields.length > 0);

  if (!hasVisibleFields) {
    for (let attempt = 0; attempt < MAX_SCAN_RETRIES; attempt++) {
      debugLog(`Infill Scanner: No fields found, retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_SCAN_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
      result = await scanOnce();
      if (result.forms.some((form) => form.fields.length > 0)) {
        break;
      }
    }
  }

  return result;
}

async function scanOnce(): Promise<{ forms: ExtractedForm[] }> {
  const controls = findControls();
  debugLog("Infill Scanner: Found controls:", controls.length);
  const groups = groupControlsIntoForms(controls);
  debugLog("Infill Scanner: Form groups:", groups.length);
  const createdAt = new Date().toISOString();
  const urlPathHash = await hashText(window.location.pathname);

  const forms = groups.map((group) => {
    const controlStates = group.controls
      .map((control, index) => ({ control, index, visible: isVisible(control), disabled: isDisabled(control) }));
    const visibleControls = getFillTargetControls(
      controlStates.filter(({ visible, disabled }) => visible && !disabled).map(({ control }) => control)
    );
    const skippedInvisibleCount = controlStates.filter(({ visible }) => !visible).length;
    debugLog(`Infill Scanner: Group ${group.formId} has ${group.controls.length} total fields`);
    debugLog(`Infill Scanner: Group ${group.formId} has ${visibleControls.length} visible/enabled fields`);
    return {
      formId: group.formId,
      urlOrigin: window.location.origin,
      urlPathHash,
      pageTitle: trimText(document.title, 120),
      formTitle: group.title,
      fields: visibleControls.map((control, index) => extractField(control, index, group.formId, group.controls)),
      scanWarnings: buildScanWarningsFromSkippedInvisibleCount(skippedInvisibleCount),
      createdAt
    };
  });

  debugLog("Infill Scanner: Final forms with visible fields:", forms.filter(f => f.fields.length > 0).length);
  return { forms };
}
