# Changelog

## 1.0.0 - 2026-06-10

Production release: hosted generation, accounts, and subscriptions. The extension no longer needs (or accepts) an OpenAI API key.

### Added

- Hosted generation API (`server/`, deployed on Railway): Hono + Postgres service that holds the OpenAI key server-side, enforces auth, plan quotas, burst rate limits, request size limits, an image-source allowlist, and the same anti-AI-tell policy filter as the extension. Content of requests is never logged or stored.
- Accounts with Google sign-in (Better Auth). The extension links to an account through a device-pairing flow: the popup opens `/connect`, you sign in with Google, and the extension claims a private token. No cookies, no provider keys in the client.
- Subscriptions via Polar (merchant of record): Free plan with a daily generation allowance, Pro ($9/mo, $79/yr) unlocking original posts, product promotion, web search, model choice, and a 400/day fair-use cap. Checkout and billing portal are hosted server-side.
- Popup account hub: sign in/out, plan badge, live daily-usage meter, upgrade and billing-portal buttons.
- Account card in settings with plan, usage, and upgrade actions.
- Hosted pages: landing, connect, upgrade, checkout success, privacy policy, and terms, all matching the extension's X-native dark editorial design.
- `npm run smoke:api` live smoke test against the hosted API; `npm run server:check` server parity tests.

### Changed

- `background.js` now talks only to the penn AI API; prompts and policy enforcement moved server-side (mirrored in `server/src/prompts.js` and `server/src/policy.js`, with parity tests). The client keeps a defensive sanitize/filter pass and the offline mock mode.
- `host_permissions` narrowed to the penn AI API origin; `api.openai.com` removed.
- Options page Connection card replaced by the Account card; the OpenAI key field is gone for good.
- Mock mode is now also the store-reviewer path: it works fully signed-out and offline.

### Removed

- All client-side API key storage, the key reveal toggle, and the direct OpenAI smoke test (replaced by the hosted API smoke test).

## 0.2.0 - 2026-06-10

Writing-quality, product marketing, and settings overhaul.

### Added

- Structured product manager in settings: create/edit/delete products with name, description, when-to-mention rule, and up to 4 photos (downscaled and stored locally; sent to the model when writing about that product so it describes the real thing). Legacy free-text product profiles migrate automatically.
- Promote mode in the panel's compose view: a Grow/Promote segmented control with a product picker; promoted posts are grounded in the product details and images, written builder-voice instead of ad-voice.
- Character counter in the refine view and an over-280 warning on generated drafts.
- `unlimitedStorage` permission so locally stored product images cannot hit the storage quota.

- Few-shot "what good sounds like" examples, length discipline, and a final self-check pass in the reply and post prompts.
- Structural AI-tell detection (contrast flip templates, setup-payoff openers, forced wrap-ups) that filters generated options mechanically, plus an expanded built-in forbidden-phrase list.
- One silent retry when a generation fails quality checks (bad JSON or too many filtered options); API errors still surface immediately.
- Prompts now ask for exactly 5 options so filtering has headroom.
- Settings playground: paste any post and test-generate replies with the current profile without leaving the options page (saves edits first).
- Profile strength meter with targeted hints in the settings rail.
- API key show/hide toggle, unsaved-changes indicator with `Ctrl+S` save, leave-page warning while dirty, and scroll-spy section navigation.

### Changed

- Options page redesigned: sticky section rail, numbered cards, serif display headlines with monospace instrument labels, dot-grid backdrop, and inline guidance explaining what good input for each field looks like.
- Default voice template now prompts users to paste 5-10 of their real posts (the highest-leverage realism input).

## 0.1.0 - 2026-05-03

Initial local MVP for penn AI.

### Added

- Chrome extension manifest, popup, options page, content script, and background service worker.
- X/Twitter reply composer panel with reply modes.
- Explicit human-in-the-loop flow: suggestions can be copied or inserted, but never posted automatically.
- Local profile settings for background, products/projects, voice, forbidden phrases, and bad examples.
- Relevance gate for product mentions.
- Local product/project relevance selection before prompting.
- Anti-cringe filtering for links, hashtags, generic praise, and forbidden phrases.
- Mock reply mode for local QA without an API key.
- Context preview showing nearby visible thread text before generation.
- Keyboard shortcut: `Alt+Shift+R`.
- Profile export/import with API key omitted from exports.
- Reset defaults while preserving API key.
- Local fixtures and automated regression tests for content, options, background behavior, packaging, and safety.
- Live OpenAI smoke-test command for environments with `OPENAI_API_KEY`.
- Release, privacy, profile, production API, and live QA documentation.

### Fixed

- Panel no longer injects inline into the X composer DOM; renders as a fixed-position floating widget anchored to the viewport. Prevents overlap with the parent post on post-detail and modal composers.
- Panel adapts to dark color scheme.

### Verified

- `npm run validate`
- `npm run package`
- Unpacked-extension load in browser automation.
- Local fixture copy/insert/error behavior.

### Not Yet Verified

- Authenticated X home feed composer.
- Authenticated X post-detail composer.
- Authenticated X modal/drawer composer.
- Copy behavior specifically on X/HTTPS.
- Live OpenAI generation with a valid API key.
