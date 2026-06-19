# Penn AI Requirements

## Product goal

Help builders write X replies that are useful, specific, and context-aware without sounding automated or promotional.

## Target user

A technical founder, indie hacker, consultant, or builder who wants to participate in X conversations with sharper replies while occasionally referencing their own products only when genuinely relevant.

## MVP user stories

1. As a user, I can save my background, structured product/project context, opinions, tone, forbidden phrases, and bad examples so generated replies have personal context.
2. As a user, I can open X and request reply suggestions from the composer without leaving the page.
3. As a user, I can choose a reply mode so the generated options match my intent.
4. As a user, I can see whether the assistant thinks a product mention is relevant before I insert a reply.
5. As a user, I can copy or insert a suggestion into the composer and manually edit/post it myself.
6. As a user, I can use the extension without any auto-posting or bulk automation.

## Functional requirements

- Provide an options page for API key, model, profile, products/projects, voice, forbidden phrases, and bad examples in local extension storage.
- Provide profile export/import so users can back up or move their context without exporting API keys.
- Inject a panel into X/Twitter reply composers.
- Read only visible page context near the active composer.
- Show the visible page context that will be sent before generation.
- Generate 3-5 reply options through OpenAI after an explicit click.
- Provide a local mock mode for manual QA without an API key or network request.
- Include a relevance gate in every generation result, with product mentions allowed only when a saved product/project is genuinely relevant.
- Select the most relevant saved product/project blocks for the visible thread before prompting.
- Avoid generic praise, forced promotion, hashtags, links, and forbidden phrases unless the user profile explicitly asks otherwise.
- Filter generated options that violate built-in anti-cringe rules before showing them.
- Copy selected text or insert it into the composer without submitting the reply.

## Non-functional requirements

- Keep the MVP backend-free and simple to install as an unpacked Chrome extension.
- Keep all posting human-controlled.
- Document stored data, OpenAI payloads, extension permissions, and automation boundaries.
- Avoid speculative product features like analytics, CRM, scheduling, or campaign automation.
- Keep changes small enough that the extension can be inspected and modified quickly.

## Acceptance criteria

- Chrome can load the folder as an unpacked extension.
- The options page saves and reloads profile settings.
- On X/Twitter, a Penn AI panel appears in reply composers.
- Clicking **Suggest replies** either returns options or shows a clear setup/API error.
- Clicking **Insert** inserts text into the composer, but does not post.
- Clicking **Copy** copies text without changing the composer.
- Documentation explains installation, scope, assumptions, and non-goals.

## Backlog

### Next

- Add a tiny test harness for prompt JSON parsing and option validation.
- Add manual QA notes with browser/version and tested X flows. Checklist added in `docs/manual-qa.md`; execution is still required after loading the extension.
- Add a safer background-worker API layer so the content script does not own OpenAI request details.

### Later

- Add per-product relevance metadata and retrieval. Partially covered by the dedicated products/projects field and local relevance selector; richer metadata is still later.
- Add local writing sample import.
- Add reply history only if the user explicitly enables it.
- Add export/import for profiles.
- Add support for other social sites after X works reliably.

### Not planned

- Auto-replying.
- Bulk reply campaigns.
- Scraping feeds for leads.
- Posting without a user click in X.
