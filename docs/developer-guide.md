# Developer Guide

## Setup

No install step is required for the current local MVP. The project uses plain JavaScript, HTML, CSS, and Node scripts.

Recommended local checks:

```powershell
npm run release:check
```

This runs:

1. Static validation and regression tests.
2. Safety audit.
3. Package build.
4. Package integrity check.

## Project Structure

| Path | Purpose |
| --- | --- |
| `manifest.json` | Chrome extension manifest |
| `content.js` / `content.css` | X/Twitter composer integration |
| `background.js` | Reply generation, prompt construction, parsing, filtering |
| `options.html` / `options.js` | Settings UI |
| `popup.html` | Toolbar popup |
| `scripts/` | Validation, regression, packaging, and smoke-test scripts |
| `tests/` | Local browser fixtures |
| `docs/` | Product, QA, release, architecture, and safety documentation |

## Development Rules

- Keep the extension human-in-the-loop.
- Do not add auto-posting, auto-like, auto-follow, auto-DM, or bulk-reply behavior.
- Do not add X API calls for posting or engagement.
- Keep new permissions out of `manifest.json` unless they are strictly required and documented in `docs/privacy-security.md`.
- If a change affects packaged files, update `scripts/package-extension.js` and `scripts/package-integrity-test.js`.
- If a change affects release readiness, update `docs/release-checklist.md` and `docs/completion-audit.md`.
- If a change affects user data or network behavior, update `docs/privacy-security.md`.

## Testing

Run the full local gate:

```powershell
npm run release:check
```

Run live OpenAI smoke test only when a key is available:

```powershell
$env:OPENAI_API_KEY="sk-..."
npm run smoke:openai
```

Manual/live X QA steps are in `docs/live-qa-playbook.md`.

## Packaging

Build the distributable:

```powershell
npm run package
```

Verify package integrity:

```powershell
npm run test:package
```

The output is `dist/penn-ai.zip`.

## Release Handoff

Before considering a release ready:

1. Run `npm run release:check`.
2. Complete all unchecked items in `docs/release-checklist.md`.
3. Record evidence in `docs/qa-results.md`.
4. Update `CHANGELOG.md` if behavior changed.
5. Rebuild `dist/penn-ai.zip`.
