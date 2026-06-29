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
  "limits": { "dailyCalls": 5, "monthlyCalls": null, "discoverDaily": 0, "models": ["gpt-5.4-mini"], "webSearch": false, "compose": false, "discover": false }
}
```

`limits.discover` mirrors `limits.compose` (both are the Pro growth surface). `monthlyCalls` is a calendar-month fair-use backstop (`null` = none, Pro 1500); `discoverDaily` is the separate per-day Discover ceiling (Free 0, Pro 15). Pro daily call allowance is 100. A per-user daily model-token ceiling also applies server-side (not surfaced here); exceeding any ceiling returns `rate_limited`.

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

## Post discovery

```http
POST /v1/discover   (find X posts worth replying to about a product; Pro only)
```

```json
{
  "product": { "name": "...", "description": "...", "link": "...", "mention": "..." },
  "lookbackDays": 14,
  "model": "gpt-5.4",
  "profile": { "context": "...", "products": "...", "voice": "...", "forbidden": "...", "badExamples": "..." }
}
```

The server builds a search query from the product (template, no extra model call), runs one X (Twitter) search through SocialCrawl's Grok-backed `ai-search` lane (the `SOCIALCRAWL_API_KEY` lives server-side; the extension never sees it), has the model rank the returned posts for genuine reply-worthiness, and then **enriches the curated shortlist with each post's live author + engagement** via SocialCrawl's `twitter/tweet` lookups (1 credit per post). That enrichment is what lets the panel show real metrics and — critically — filter out dead/buried posts (the "0–2 likes, deep in a thread nobody sees" complaint), diversify by author, and rank by real traction. `lookbackDays` is clamped to 1–90 (default 14). Response:

```json
{
  "query": "the search query used",
  "candidates": [
    {
      "url": "https://x.com/.../status/...",
      "handle": "@someone",
      "authorName": "Some One",
      "verified": true,
      "avatar": "https://pbs.twimg.com/...",
      "likes": 142, "replies": 28, "reposts": 9, "views": 18400,
      "postedAt": "2026-06-29T09:00:00Z",
      "snippet": "what the post says",
      "why": "why it's a real opening",
      "angle": "how you might reply"
    }
  ]
}
```

Enrichment is best-effort: a post that fails to look up is shown without metrics (the `likes`/`views`/etc. come back `null`), never dropped, so an upstream hiccup can't empty an otherwise good run. Posts the lookup reports as deleted are always dropped, and posts that clear no visibility bar are only shown as a last resort (so a run for a niche product still returns something rather than nothing).

Pro only (`upgrade_required` for free plans), counted against the daily allowance like a generation, and refunded whenever no useful result is produced. It is *also* metered on a separate, never-refunded daily ceiling (`discoverDaily`, Pro 15/day): each attempt spends SocialCrawl credits (1 search + up to ~12 enrichment lookups) and a curation call even when it yields nothing, so the daily-call refund does not grant a free retry — once the Discover ceiling is hit the endpoint returns `rate_limited` until midnight UTC. Curation runs on `gpt-5.4-mini` regardless of the requested model (it only ranks the search results). Every candidate carries a real X status URL (the model is told never to invent one, and a server-side parser drops any candidate without a valid `…/status/<id>` link). Results are returned to the panel and never stored. Distinct error codes: `no_results` (search ran but found nothing worth replying to — refunded) and `discover_unavailable` (search not configured / out of search credits); transient upstream failures return `discover_failed` and are refunded.

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
- Per-user burst limits plus durable daily quotas per plan, a calendar-month call backstop, a separate never-refunded Discover ceiling, and a per-user daily model-token circuit breaker; `DISABLE_GENERATION=1` is the global kill switch.
- Model token usage is logged per call (route, model, user, in/out/total) and accumulated per user per day; a structured `high_token_user` warning fires when a user crosses the daily alert threshold.
- The model is resolved server-side from the user's plan; the requested model is only honored when entitled.
- Raw `threadText` and profile fields are never logged or stored; logs carry route, status, latency, and user id only.
- The same JSON parsing and anti-AI-tell safety-filter contract as the original `background.js` (ported to `server/src/policy.js`, parity-tested in `server/test/server-test.js`).
- 3-5 options after filtering.
- Discovery is a read-only search surface: it returns candidate posts for the human to act on, never auto-replies, and never stores the results.
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

Codes: `unauthorized` (401), `upgrade_required` and `free_limit_reached` (402), `rate_limited` (429), `invalid_request` (400), `no_results` (422, discovery), `model_unavailable` / `discover_unavailable` (503), `generation_failed` / `safety_filter_failed` / `discover_failed` (502).

## Extension behavior

The extension treats hosted errors the same way it treated local background errors: show a visible error in the panel and never insert or post anything automatically. A 401 clears the stored token; 402 messages carry the upgrade pitch verbatim.
