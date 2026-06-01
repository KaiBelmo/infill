# Architecture

Infill is a Manifest V3 browser extension with a background service worker, content scripts, popup UI, options UI, and shared TypeScript packages.

## Runtime Pieces

| Area | Path | Purpose |
| --- | --- | --- |
| Manifest | `apps/extension/manifest.config.ts` | Declares extension metadata, permissions, content scripts, popup, options page, and service worker. |
| Background | `apps/extension/src/background/` | Owns browser APIs, storage coordination, auth callbacks, scan orchestration, sync state, and message handlers. |
| Content script | `apps/extension/src/content/` | Runs in the page, extracts forms, installs overlays, learns profile facts, and performs approved fill actions. |
| Popup | `apps/extension/src/popup/` | Toolbar UI for scanning, reviewing mappings, filling fields, and checking extension state. |
| Options | `apps/extension/src/options/` | Settings and profile management UI. |
| Shared packages | `packages/*` | Reusable schemas, matching logic, risk classification, profile facts, and vault helpers. |

## Data Flow

1. The user opens the popup and starts a scan.
2. The popup sends a message to the background service worker.
3. The background service worker targets the active tab and asks the content script to scan the page.
4. The content script extracts forms and fields from the DOM.
5. Shared matching logic produces field mappings from profile facts.
6. The popup shows suggested mappings for review.
7. Approved non-sensitive fields can be filled into the page.
8. Sensitive or restricted fields require explicit user approval.
9. Learned profile facts and extension state are persisted with browser extension storage.

## Storage

The extension stores local profile and scan state with browser extension storage. Profile sync is optional and uses our backend after the user sets a passphrase. When sync is enabled, profile sync data should be encrypted before leaving the browser.

Contributors should treat profile facts as sensitive data. Avoid logging raw field values, credentials, payment data, or full profile records.

## Permissions

Current permissions are declared in `apps/extension/manifest.config.ts`.

| Permission | Why it exists |
| --- | --- |
| `activeTab` | Allows the extension to work with the active tab after user interaction. |
| `scripting` | Supports content script execution and page interaction. |
| `storage` | Persists profile state, scan state, settings, and sync metadata. |
| `tabs` | Reads active tab metadata needed for scan coordination and auth redirects. |
| `webNavigation` | Handles navigation changes and clears stale scan overlays/state. |
| `http://*/*`, `https://*/*`, `file:///*` | Allows scanning supported pages and local test fixtures. |

When adding a permission, document the user-facing reason and keep the scope as narrow as the feature allows.

## Package Responsibilities

- `@infill/shared`: shared schemas and types for forms, mappings, profile records, and cloud-facing shapes.
- `@infill/form-brain`: matching, assist, and field risk logic.
- `@infill/profile-vault`: profile fact normalization, memory import helpers, and vault state.
- `@infill/extension`: browser extension runtime and UI.
