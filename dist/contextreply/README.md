# ContextReply

ContextReply is a local-first Chrome extension MVP for composing better replies on X. It reads the visible post/thread only when you click **Suggest replies**, combines it with your saved context profile, and returns reply options you can manually insert and edit.

Current version: `0.1.0`. Release notes are in [CHANGELOG.md](CHANGELOG.md).

It is intentionally human-in-the-loop. It does not auto-post, auto-like, scrape at scale, or run reply campaigns.

## MVP scope

- Injects a reply assistant panel into X/Twitter reply composers.
- Stores your profile, products/projects, tone, forbidden phrases, bad examples, model, and OpenAI API key in local Chrome extension storage.
- Exports and imports your local profile as JSON. API keys are not included in exports.
- Resets profile fields to built-in defaults without clearing the API key.
- Shows a collapsed preview of the visible thread context that will be sent when generating.
- Selects the most relevant saved product/project blocks before prompting, instead of treating every product as equally relevant.
- Generates 3-5 reply options for modes like technical insight, smart question, disagreement, example, humor, concise rewrite, and soft product mention.
- Uses a relevance gate before product mentions so the assistant can say "no" when promotion would be forced.
- Filters generated options that include common generic praise, links, hashtags, or saved forbidden phrases.
- Copies a suggestion or inserts it into the composer for manual editing and posting.
- Supports `Alt+Shift+R` to suggest replies for the active composer.
- Includes a mock reply mode for local QA without an API key or network request.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Open the extension settings and add your OpenAI API key and profile.
6. Open X, start a reply, and click **Suggest replies** in the ContextReply panel.

For local QA without an API key, enable **Use mock replies for local QA** in settings.

## Validate

Run the lightweight checks:

```powershell
npm run validate
Get-Content manifest.json -Raw | ConvertFrom-Json | Out-Null
```

Run the full local release check:

```powershell
npm run release:check
```

Optional live OpenAI smoke test:

```powershell
$env:OPENAI_API_KEY="sk-..."
npm run smoke:openai
```

Package the extension for manual review:

```powershell
npm run package
npm run test:package
```

Equivalent individual checks:

```powershell
node --check options.js
node --check content.js
node --check background.js
node --check scripts/openai-smoke.js
node --check scripts/package-extension.js
node --check scripts/package-integrity-test.js
node --check scripts/safety-audit.js
node --check scripts/content-dom-test.js
node --check scripts/options-dom-test.js
node --check scripts/background-test.js
node --check scripts/docs-link-test.js
node scripts/validate.js
node scripts/safety-audit.js
node scripts/content-dom-test.js
node scripts/options-dom-test.js
node scripts/background-test.js
node scripts/docs-link-test.js
npm run test:package
Get-Content manifest.json -Raw | ConvertFrom-Json | Out-Null
```

Manual browser QA is tracked in [docs/manual-qa.md](docs/manual-qa.md).
Completed QA evidence is tracked in [docs/qa-results.md](docs/qa-results.md).

Local source-tree fixtures are available at `tests/mock-x-page.html` and `tests/mock-options-page.html` for checking behavior without an X login or installed extension.

## Product assumptions

- The safest useful product is a copilot, not an automation bot.
- The first valuable wedge is quality and relevance, not reply volume.
- A local-only extension is enough for the MVP; a backend can come later for team profiles, retrieval, analytics, and billing.

Architecture is documented in [docs/architecture.md](docs/architecture.md).
Developer workflow is documented in [docs/developer-guide.md](docs/developer-guide.md).
Profile-writing guidance is available in [docs/profile-guide.md](docs/profile-guide.md).

## Privacy and safety

See [docs/privacy-security.md](docs/privacy-security.md) for stored data, OpenAI payloads, automation boundaries, and extension permission rationale.

Release readiness is tracked in [docs/release-checklist.md](docs/release-checklist.md).
Hosted/commercial API-key handling is planned in [docs/production-api-strategy.md](docs/production-api-strategy.md).
The future hosted API contract is sketched in [docs/hosted-api-contract.md](docs/hosted-api-contract.md).
The remaining live checks are documented in [docs/live-qa-playbook.md](docs/live-qa-playbook.md).
X account-safety guidance is documented in [docs/x-safety-guide.md](docs/x-safety-guide.md).
Known risks are tracked in [docs/risk-register.md](docs/risk-register.md).
Current completion status is audited in [docs/completion-audit.md](docs/completion-audit.md).
Chrome Web Store copy is drafted in [docs/chrome-store-listing.md](docs/chrome-store-listing.md).

## Non-goals

- No auto-posting.
- No bulk reply workflows.
- No lead database.
- No scheduling or analytics.
- No generic growth-bot positioning.
