# Architecture

Penn AI is a Manifest V3 Chrome extension with no backend in the local MVP.

## Runtime Pieces

| File | Responsibility |
| --- | --- |
| `manifest.json` | Extension metadata, host matches, permissions, command registration, background worker registration |
| `content.js` | Runs on X/Twitter pages, detects composers, renders the Penn AI panel (Assist + Discover tabs), reads visible context, copies/inserts selected replies, lists discovered posts |
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

## Post discovery (Discover tab)

A Pro-only surface for finding X posts worth replying to about one of your products.

1. User opens the **Discover** tab, picks a product, and clicks **Find posts**.
2. `content.js` sends `{ productId }` to `background.js`, which resolves the product from local storage and calls the hosted `POST /v1/discover` with the product and profile.
3. The server builds a search query from the product, runs one X search through SocialCrawl (key held server-side, never in the extension), and has the model rank the results into reply-worthy candidates with a "why" and an "angle".
4. The server then enriches that shortlist with each post's live author and engagement (SocialCrawl `twitter/tweet` lookups), and uses those metrics to drop dead/buried posts, diversify by author, and rank by real traction — so the panel shows visible, varied posts, not deep threads nobody will see.
5. The panel lists the candidates, each with author, verified badge, and likes/replies/views. Clicking **Open post** opens that tweet in a new tab, where the normal Assist flow drafts a reply.
6. Candidates are shown and discarded; nothing is stored, queued, or replied to automatically.

## Boundaries

- No auto-posting.
- No bulk workflows.
- No X API calls from the extension; the only X data fetch is a server-side, read-only SocialCrawl search (plus per-post detail lookups to show engagement) for the Discover tab.
- No feed scraping beyond visible nearby DOM text after a user action.
- Discovery is a read-only search surface: it surfaces posts for the human to act on, never auto-replies, and never stores results (no lead list, no monitor).
- Generation and discovery run through the hosted API (`server/`); the extension holds no provider or search keys.

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
