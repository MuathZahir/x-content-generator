# Changelog

## 0.1.0 - 2026-05-03

Initial local MVP for ContextReply.

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
