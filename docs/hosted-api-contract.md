# Hosted API Contract

The hosted generation API described in `docs/production-api-strategy.md` is now implemented in `server/` and deployed on Railway. This document is the contract the extension (`background.js`) codes against.

Base URL: `https://heypenn.com`

## Authentication

Every `/v1` endpoint (except device pairing) requires a Penn AI device token, never an OpenAI key:

```http
Authorization: Bearer penn_<token>
```

Tokens are minted through the device-pairing flow and can be revoked server-side. A `401` means the extension should clear its stored token and show the sign-in prompt.

## Device pairing

```http
POST /v1/device/new            -> { "code": "A1B2-C3D4", "secret": "..." }
POST /v1/device/approve        -> { "ok": true }        (browser session cookie + { code })
POST /v1/device/claim          -> { "token": "penn_..." } ({ code, secret }; { "pending": true } until approved)
```

The extension keeps `secret` local and polls `claim`; the signed-in browser tab (`/connect?code=...`) calls `approve`. The token is minted only at claim time and only its hash is stored.

## Account

```http
GET /v1/me
```

```json
{
  "user": { "id": "...", "name": "...", "email": "...", "image": "..." },
  "plan": "free",
  "usedToday": 2,
  "remainingToday": 3,
  "limits": { "dailyCalls": 5, "models": ["gpt-5.4-mini"], "webSearch": false, "compose": false }
}
```

`POST /v1/signout` revokes the presented token.

## Generation

```http
POST /v1/generate   (replies)
POST /v1/compose    (original posts; Pro only)
POST /v1/refine     (draft refinement)
```

All three accept the user's profile per request; the server never stores it:

```json
{
  "note": "optional steering note",
  "threadText": "Visible X/Twitter context shown to the user before generation.",
  "images": ["https://pbs.twimg.com/media/..."],
  "model": "gpt-5.4",
  "profile": {
    "context": "Who I am, opinions, stable background.",
    "products": "Product/project blocks with optional `Link:` lines and mention rules.",
    "voice": "Tone and writing examples.",
    "forbidden": "Forbidden phrases or behaviors.",
    "badExamples": "Examples to avoid imitating."
  }
}
```

`/v1/compose` additionally takes `idea`, `feed`, `trends`, `feedGrounding`, `webSearch`, and an optional `product` object (name, description, link, mention, media). `/v1/refine` takes `kind`, `currentText`, `instruction`, `baseContext`, `history`.

## Product extraction

```http
POST /v1/extract    (draft a product profile from a URL or pasted text)
```

```json
{ "url": "https://yourproduct.com", "text": "optional pasted landing-page text / README" }
```

Provide `url`, `text`, or both (text wins). When given a `url`, the server fetches the page itself (https only; resolved IP must be public; redirects capped and re-validated per hop; 6 s timeout; 512 KB cap) and distills its title, og:/twitter:/meta description, JSON-LD, and visible body into model input. Response:

```json
{
  "product": { "name": "...", "description": "...", "mention": "..." },
  "lowConfidence": false
}
```

Free for all plans, counted against the daily allowance, and always run on the fast model. Distinct error codes: `thin_source` (page had too little to read — prompt the user to paste text) and `fetch_failed` (page unreachable / not HTML); a blocked or malformed URL returns `invalid_request`.

Generate response:

```json
{
  "relevance_gate": {
    "mention_product": false,
    "reason": "The thread is adjacent but not directly about the saved product.",
    "mention_style": "Do not mention a product."
  },
  "options": [
    { "label": "dry", "text": "Reply option text." }
  ]
}
```

## Server guarantees

- Authentication on every generation call.
- Request body limit (3 MB), per-field length clamps, image-source allowlist (X media CDN + small data URLs only).
- Per-user burst limits plus durable daily quotas per plan; `DISABLE_GENERATION=1` is the kill switch.
- The model is resolved server-side from the user's plan; the requested model is only honored when entitled.
- Raw `threadText` and profile fields are never logged or stored; logs carry route, status, latency, and user id only.
- The same JSON parsing and anti-AI-tell safety-filter contract as the original `background.js` (ported to `server/src/policy.js`, parity-tested in `server/test/server-test.js`).
- 3-5 options after filtering.
- Never posts to X/Twitter.

## Errors

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many reply generations. Try again later."
  }
}
```

Codes: `unauthorized` (401), `upgrade_required` and `free_limit_reached` (402), `rate_limited` (429), `invalid_request` (400), `model_unavailable` (503), `generation_failed` / `safety_filter_failed` (502).

## Extension behavior

The extension treats hosted errors the same way it treated local background errors: show a visible error in the panel and never insert or post anything automatically. A 401 clears the stored token; 402 messages carry the upgrade pitch verbatim.
