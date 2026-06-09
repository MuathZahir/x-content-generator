# Chrome Web Store Listing Draft

## Name

ContextReply

## Short description

Write useful X replies with your own context, without auto-posting.

## Detailed description

ContextReply is a human-in-the-loop reply copilot for X/Twitter.

It helps builders, founders, and technical operators draft sharper replies using their saved context: background, products/projects, opinions, tone, forbidden phrases, and examples of what not to sound like.

The extension adds a small panel beside X reply composers. When you click **Suggest replies**, it reads the nearby visible thread text, shows you the context that will be sent, and generates reply options. You can copy or insert a suggestion, edit it, and post manually.

ContextReply does not post, like, follow, DM, repost, scrape feeds, or run bulk campaigns.

## Key features

- Context-aware X reply suggestions.
- Saved profile, products/projects, tone, forbidden phrases, and bad examples.
- Product mention relevance gate.
- Reply modes: technical insight, smart question, respectful disagreement, relevant example, soft product mention, humor, and concise rewrite.
- Visible **Context sent** preview before generation.
- Copy or insert suggestions manually.
- Mock mode for local QA.
- No auto-posting or bulk automation.

## Permission justification

- `storage`: saves local settings.
- `clipboardWrite`: supports the **Copy** action for generated suggestions.
- `tabs`: sends the keyboard shortcut command to the active tab.
- `https://x.com/*` and `https://twitter.com/*`: injects the reply assistant panel beside composers.
- `https://api.openai.com/*`: calls OpenAI only after the user clicks **Suggest replies**, unless mock mode is enabled.

## Privacy summary

ContextReply stores profile settings locally in Chrome extension storage. It sends visible nearby X/Twitter thread text and saved profile context to OpenAI only after the user clicks **Suggest replies**. Profile exports omit API keys.

See `docs/privacy-security.md` for details.

## Review notes

- The extension is human-in-the-loop.
- The extension never submits X posts.
- The extension does not automate likes, reposts, follows, DMs, or bulk replies.
- The extension does not use the X API.
- Users manually decide whether to copy, insert, edit, or post any generated text.

## Assets Needed

- 128x128 extension icon.
- 440x280 small promotional tile.
- 920x680 screenshots:
  - settings page
  - X composer panel with context preview
  - generated reply options with relevance gate
  - mock mode/local QA state
