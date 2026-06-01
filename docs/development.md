# Development Guide

## Install

```powershell
corepack enable
corepack pnpm install
```

## Common Commands

Run the extension build in watch mode:

```powershell
corepack pnpm dev
```

Build all packages and the extension:

```powershell
corepack pnpm build
```

Run tests:

```powershell
corepack pnpm test
```

Run type checks:

```powershell
corepack pnpm typecheck
```

Run an extension-only command:

```powershell
corepack pnpm --dir apps/extension run build
```

## Manual Verification

1. Build the extension.
2. Load `apps/extension/dist` as an unpacked extension.
3. Open a fixture from `apps/extension/test-forms`.
4. Open the popup and scan the page.
5. Confirm fields are detected.
6. Confirm suggested mappings are visible before filling.
7. Fill only approved fields.
8. Confirm sensitive fields are not filled without explicit approval.
9. Navigate or reload the page and verify stale overlays are cleared.

## Debugging

- If the extension UI is stale, reload it from `chrome://extensions`.
- If the popup cannot reach a tab, make sure the page URL is covered by host permissions.
- If local AI assist fails, verify Ollama is running and the base URL/model are saved in the extension options UI.
- If workspace imports resolve incorrectly, run `corepack pnpm install` and then `corepack pnpm build`.
- If browser behavior differs from unit tests, reproduce with a fixture in `apps/extension/test-forms`.

## Adding Form Logic

Put reusable matching, parsing, and risk logic in packages where possible:

- Cross-extension schemas belong in `packages/shared`.
- Field matching and assist behavior belong in `packages/form-brain`.
- Profile fact and vault behavior belongs in `packages/profile-vault`.
- Browser API, DOM, popup, options, and service worker code belongs in `apps/extension`.

Add tests near the changed logic. Prefer focused unit tests for package behavior and manual fixture coverage for browser-specific behavior.

## Privacy Checklist

Before opening a PR that touches profile data, field extraction, sync, or logging:

- Avoid logging raw personal values.
- Keep sensitive fields opt-in for fill actions.
- Make external requests visible in code and docs.
- Validate imported profile data with shared schemas.
- Keep storage keys stable or provide migration logic.
- Update docs when data flow or permissions change.
