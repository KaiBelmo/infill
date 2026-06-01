# Contributing

Thanks for contributing to Infill. This project welcomes focused fixes, tests, browser compatibility improvements, documentation, and extension UX improvements.

## Before You Start

- Search existing issues before opening a new one.
- Keep changes focused on the extension and shared packages in this repository.
- Use sample data, placeholders, and public examples in tests and documentation.

## Branches And Commits

Use short branch names that describe the change:

```text
fix/scanner-disabled-fields
feat/options-import-preview
docs/contribution-guide
```

Use conventional commits:

```text
feat: add profile import preview
fix: avoid filling readonly fields
docs: document extension permissions
test: cover field risk matching
```

## Pull Request Checklist

Before opening a PR, run:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Also manually verify extension behavior when the change touches:

- Manifest permissions.
- Content scripts.
- Background service worker messages.
- Popup or options UI.
- Form scanning, overlays, or fill behavior.
- Profile storage, import, sync, or encryption flows.

## Extension Permissions

Permission changes need extra care. A PR that adds or expands permissions should include:

- The feature that requires the permission.
- The smallest scope that works.
- User-visible behavior that depends on it.
- Manual verification steps.
- Updates to `docs/architecture.md`.

## Tests

Put tests beside the logic they cover. Current test coverage uses Vitest and lives near package or extension source files with `.test.ts` naming.

For scanner and fill behavior, add or update fixtures under:

```text
apps/extension/test-forms
```

## Documentation

Update docs when you change:

- Setup commands.
- Local AI configuration.
- Browser permissions.
- Data flow.
- Storage behavior.
- Public package responsibilities.
- Manual verification steps.

## Security Reports

Do not open a public issue for a suspected vulnerability. Report it privately with:

- Affected commit or version.
- Reproduction steps.
- Impact.
- Whether the issue affects local Ollama, profile sync, or sign-in.
- Suggested fix, if known.
