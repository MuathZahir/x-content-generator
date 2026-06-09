# Hosted API Contract

This contract describes the future hosted generation endpoint from `docs/production-api-strategy.md`. It is not implemented in the local MVP.

## Endpoint

```http
POST /api/replies/generate
```

## Authentication

Required. The extension should send a ContextReply user/session token, not an OpenAI API key.

```http
Authorization: Bearer <contextreply-token>
```

## Request

```json
{
  "mode": "Softly mention my project",
  "threadText": "Visible X/Twitter context shown to the user before generation.",
  "profile": {
    "context": "Who I am, opinions, stable background.",
    "products": "Product/project blocks with mention rules.",
    "voice": "Tone and writing examples.",
    "forbidden": "Forbidden phrases or behaviors.",
    "badExamples": "Examples to avoid imitating."
  }
}
```

## Response

```json
{
  "relevance_gate": {
    "mention_product": false,
    "reason": "The thread is adjacent but not directly about the saved product.",
    "mention_style": "Do not mention a product."
  },
  "options": [
    {
      "label": "Helpful",
      "text": "Reply option text."
    }
  ]
}
```

## Server Requirements

- Enforce authentication.
- Enforce request body size limits.
- Enforce per-user rate limits.
- Do not log raw `threadText` or profile fields by default.
- Apply the same JSON parsing and safety-filter contract as `background.js`.
- Return 3-5 options after filtering.
- Never post to X/Twitter.

## Error Shape

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many reply generations. Try again later."
  }
}
```

Recommended error codes:

- `unauthorized`
- `rate_limited`
- `invalid_request`
- `model_unavailable`
- `generation_failed`
- `safety_filter_failed`

## Extension Behavior

The extension should treat hosted errors the same way it treats local background errors today: show a visible error in the panel and never insert or post anything automatically.
