# Architecture

ContextReply is a Manifest V3 Chrome extension with no backend in the local MVP.

## Runtime Pieces

| File | Responsibility |
| --- | --- |
| `manifest.json` | Extension metadata, host matches, permissions, command registration, background worker registration |
| `content.js` | Runs on X/Twitter pages, detects composers, renders the ContextReply panel, reads visible context, copies/inserts selected replies |
| `content.css` | Styles the injected X composer panel |
| `background.js` | Handles generation messages, loads settings, builds prompts, calls OpenAI or mock generation, validates and filters replies |
| `options.html` / `options.js` | Settings UI for API key, model, mock mode, profile, products, voice, forbidden phrases, bad examples, import/export, reset defaults |
| `popup.html` | Lightweight toolbar popup that links to settings |

## Data Flow

1. User opens an X reply composer.
2. `content.js` detects the composer and injects the panel.
3. User chooses a mode and clicks **Suggest replies**.
4. `content.js` reads nearby visible thread text and shows it in **Context sent**.
5. `content.js` sends `{ mode, threadText }` to `background.js`.
6. `background.js` reads local settings from `chrome.storage.local`.
7. If mock mode is enabled, `background.js` returns local sample replies.
8. Otherwise, `background.js` calls OpenAI with the user profile and visible context.
9. `background.js` parses JSON, applies safety filters, and returns reply options.
10. User clicks **Copy** or **Insert**.
11. The extension never submits the reply.

## Storage

Settings are stored in `chrome.storage.local`:

- API key
- model
- mock mode
- context profile
- products/projects
- voice
- forbidden phrases
- bad examples

Profile export omits the API key.

## Boundaries

- No auto-posting.
- No bulk workflows.
- No X API calls.
- No feed scraping beyond visible nearby DOM text after a user action.
- No backend in the local MVP.

## Test Strategy

| Test | Purpose |
| --- | --- |
| `scripts/validate.js` | Static project, manifest, docs, prompt, parser, and policy checks |
| `scripts/safety-audit.js` | Source scan for forbidden automation patterns |
| `scripts/content-dom-test.js` | Content-script DOM behavior in a minimal harness |
| `scripts/options-dom-test.js` | Settings-page behavior in a minimal harness |
| `scripts/background-test.js` | Background generation behavior with mocked storage and fetch |
| `scripts/package-integrity-test.js` | Packaged runtime/docs integrity |
| `scripts/openai-smoke.js` | Optional live OpenAI smoke test when `OPENAI_API_KEY` is available |

## Future Hosted Architecture

The hosted/commercial plan is documented in `docs/production-api-strategy.md`.
