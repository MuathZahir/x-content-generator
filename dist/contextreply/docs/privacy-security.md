# Privacy and Security

ContextReply is designed as a human-in-the-loop assistant, not an automation bot.

## What is stored locally

The extension stores these settings in `chrome.storage.local`:

- OpenAI API key
- Model name
- Mock mode flag
- Context profile
- Products/projects
- Writing examples and tone
- Forbidden phrases

Exports omit the API key.

## What is sent to OpenAI

Only after the user clicks **Suggest replies**, the extension sends:

- The selected reply mode
- The visible nearby X/Twitter thread text shown in **Context sent**
- The saved user profile fields

No request is sent while browsing, typing, opening a composer, or expanding the context preview.

## What is never automated

The extension does not:

- Post replies
- Like posts
- Repost
- Follow accounts
- Send DMs
- Run bulk reply campaigns
- Scrape feeds for lead lists

Users must manually copy or insert a suggestion, edit it if needed, and post through X themselves.

## Permission rationale

- `storage`: save local settings.
- `clipboardWrite`: support the **Copy** action for generated suggestions.
- `tabs`: send the keyboard shortcut command to the active tab.
- `https://api.openai.com/*`: call OpenAI only after the user clicks **Suggest replies**, unless mock mode is enabled.

## Known limitations

- A local API key in extension storage is convenient for MVP use, but a production hosted version should move API calls server-side or use a safer token flow.
- X/Twitter page structure can change, which may break composer detection.
- Live generation depends on OpenAI API availability and the configured model.

The production API-key migration strategy is documented in `docs/production-api-strategy.md`.
