# Releases

## Version Source

Release versions are controlled by `apps/extension/package.json`. The GitHub release workflow expects tags in the form `vVERSION`, so package version `0.1.0` must be released from tag `v0.1.0`.

The root `package.json` currently matches the extension version, but the extension package version is the release source of truth.

## Local Build Commands

Install dependencies from the lockfile:

```powershell
corepack pnpm install --frozen-lockfile
```

Build the browser packages:

```powershell
corepack pnpm build:chromium
corepack pnpm build:mozilla
```

The generated extension directory is `apps/extension/dist`. Both browser builds place `manifest.json` at the root of that directory.

## Release Assets

The release workflow creates these assets for version `0.1.0`:

- `infill-chromium-v0.1.0.zip`: Chromium extension contents from `apps/extension/dist`, with `manifest.json` at the ZIP root.
- `infill-firefox-unsigned-v0.1.0.zip`: unsigned Firefox extension contents from `apps/extension/dist`, with `manifest.json` at the ZIP root.
- `infill-source-v0.1.0.zip`: source and lockfile needed to reproduce the Mozilla build.

The Firefox ZIP is unsigned. It is intended for AMO submission, testing, or GitHub archival. Normal Firefox users generally need an AMO-signed XPI.

The Chromium ZIP is not a normal one-click Chrome installation package. It is intended for GitHub Releases, manual installation after extraction, and possible future manual Chrome Web Store upload.

## Manual Chromium Installation

1. Extract `infill-chromium-vVERSION.zip`.
2. Open `chrome://extensions` or the equivalent Chromium extensions page.
3. Enable Developer Mode.
4. Select Load unpacked.
5. Choose the extracted extension directory.

Chrome Web Store publishing remains manual.

## GitHub Release Workflow

Create and push a matching tag to publish a GitHub Release:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

The workflow fails if the tag does not exactly match `apps/extension/package.json`.

Manual `workflow_dispatch` runs build and validate artifacts, then upload them as GitHub Actions artifacts by default. They create a GitHub Release only when `create_release=true` is explicitly selected.

## Mozilla Review

The current Firefox version has already been submitted manually and is under AMO review. This workflow does not upload to AMO, run `web-ext sign`, create another Mozilla listing, or require Mozilla API credentials.

Maintainers must upload future Firefox versions manually unless API signing automation is intentionally added later. Mozilla API credentials would only be needed for future `web-ext sign` automation.

## Dependabot

Dependabot runs weekly on Monday. npm/pnpm minor and patch updates are grouped together, npm/pnpm major updates remain separate for review, and GitHub Actions updates are grouped separately.

Dependabot pull requests and activity are visible in the repository's Pull requests tab and the repository Insights dependency graph views.
