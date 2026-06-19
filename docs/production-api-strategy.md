# Production API Strategy

> **Status: implemented as of 1.0.0.** The backend lives in `server/` and is deployed on Railway; the extension authenticates with a device token and no longer accepts an OpenAI key. The implemented contract is in `docs/hosted-api-contract.md`. The text below is the original decision record.

The local MVP lets a user provide their own OpenAI API key because it keeps the first version backend-free. That is acceptable for personal unpacked-extension use, but it is not the right default for a hosted or commercial release.

## Decision

For any hosted/commercial release, Penn AI should proxy model calls through a minimal backend. The Chrome extension should authenticate to Penn AI, not store a long-lived OpenAI API key.

## Recommended architecture

1. Extension authenticates the user with Penn AI.
2. Extension sends the selected mode, visible context preview text, and saved profile fields to the Penn AI backend after the user clicks **Suggest replies**.
3. Backend enforces rate limits, abuse limits, request size limits, and billing/plan limits.
4. Backend calls OpenAI with the server-held API key.
5. Backend validates the JSON shape, applies the same anti-cringe filters, and returns options to the extension.
6. Extension still only copies or inserts text. It never posts.

## Minimal backend requirements

- HTTPS-only endpoint for reply generation.
- User authentication.
- Per-user rate limits.
- Request body size limits.
- Server-side OpenAI key storage.
- No storage of raw X thread text by default.
- Structured logs that avoid profile/thread content.
- Error responses that do not expose provider secrets.
- A kill switch for model calls.

## Migration plan

1. Keep the current local-key path for personal/developer mode.
2. Add a backend URL setting hidden behind a developer flag.
3. Move `buildMessages`, `parseReplyResult`, `enforceReplyPolicy`, and relevance selection into a shared package or duplicate them server-side with parity tests.
4. Add backend generation endpoint.
5. Add extension setting: **Use hosted generation**.
6. Run live QA against hosted generation.
7. Before public release, default to hosted generation and make local-key mode an advanced option.

The proposed hosted endpoint contract is documented in `docs/hosted-api-contract.md`.

## Non-goals

- Do not add auto-posting while adding a backend.
- Do not store full thread text for analytics by default.
- Do not add CRM, lead scoring, or campaign automation as part of the API-key migration.

## Acceptance criteria

- The public release path does not require users to paste an OpenAI key into the extension.
- Server-side logs avoid storing thread/profile content by default.
- The backend preserves the same human-in-the-loop behavior as the extension MVP.
- Local-key mode remains clearly labeled as personal/developer mode if it remains available.
