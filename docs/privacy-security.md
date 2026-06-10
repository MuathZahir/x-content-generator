# Privacy and Security

penn AI is a human-in-the-loop assistant, not an automation bot. The user-facing privacy policy is hosted at https://heypenn.com/privacy; this document is the engineering view.

## What is stored locally (chrome.storage.local)

- Context profile, products/projects (including downscaled product photos), writing examples and tone, forbidden phrases, bad examples
- Model preference, mock mode, feed grounding, and web search flags
- The penn AI device token (`apiToken`) minted by the pairing flow

There is no OpenAI API key anywhere in the extension. Profile exports include only profile fields, never the device token.

## What is sent to the penn AI API, and when

Only after the user clicks **Suggest replies** (or composes/refines on request), the extension sends to `https://heypenn.com`:

- The visible nearby X/Twitter thread text shown in **Context sent**
- Image URLs attached to the post being replied to
- The saved profile fields and the optional note
- For post composition with feed grounding on: visible home-feed text and trends

No request is sent while browsing, typing, opening a composer, or expanding the context preview. The server forwards the request to OpenAI with the server-held key, applies the safety filter, returns drafts, and discards the content. Request content is never logged or stored server-side; logs carry user id, route, status, and latency only.

## Server-side security properties

- The OpenAI key exists only as a Railway environment variable; provider error bodies are never forwarded to clients.
- Device tokens are stored as SHA-256 hashes; plaintext exists only in the extension. Pairing mints a token once, guarded by a device secret that never appears in a URL.
- Auth: Better Auth with Google sign-in; sessions are server-side; the extension never sees Google credentials.
- Billing: Polar (merchant of record) processes payments; card data never touches our server.
- Per-user daily quotas (Postgres) + per-user/IP burst limits (in-memory) + 3 MB body limit + per-field length clamps.
- Image inputs are allowlisted to X's media CDN and small data-URL images, capped at 4.
- `DISABLE_GENERATION=1` is the kill switch for model calls.
- Security headers on all responses (nosniff, frame deny, HSTS, no-referrer).

## What is never automated

The extension does not post replies, like, repost, follow, DM, run bulk campaigns, or scrape feeds for lead lists. Users manually copy or insert a suggestion, edit it, and post through X themselves.

## Permission rationale

- `storage` + `unlimitedStorage`: save the local profile and product photos.
- `clipboardWrite`: support the **Copy** action for generated suggestions.
- `tabs`: open sign-in/upgrade pages and send the keyboard shortcut command to the active tab.
- `https://x.com/*`, `https://twitter.com/*`: inject the assistant panel beside composers.
- `https://heypenn.com/*`: the hosted generation API, called only on explicit user action.

## Known limitations

- X/Twitter page structure can change, which may break composer detection.
- Live generation depends on the hosted API and OpenAI availability; mock mode keeps local QA possible offline.
- The shared session/burst limiter is in-memory and single-instance; scale-out would move it to Postgres or Redis.
