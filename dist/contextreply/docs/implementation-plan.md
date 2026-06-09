# Implementation Plan

## Iteration 1: Installable MVP

Goal: make the product usable as a local Chrome extension.

- Create extension manifest, popup, options page, content script, and styles.
- Store user settings in `chrome.storage.local`.
- Inject a panel into reply composers.
- Generate gated reply suggestions after an explicit user click.
- Insert selected text into the composer.
- Keep product/project context separate from the general profile.

Verification:

- `npm run validate`
- `node --check options.js`
- `node --check content.js`
- Parse `manifest.json` as JSON.
- Manual install and X composer check.

## Iteration 2: Reliability

Goal: reduce fragile behavior in the browser.

- Move OpenAI calls to a background service worker. Done in MVP.
- Add schema validation around generated JSON. Done in MVP.
- Handle malformed model output with a repair attempt or clear error. Clear error is implemented.
- Filter generated options that violate anti-cringe rules. Done in MVP.
- Add manual QA checklist for X home feed, post detail, modal composer, and reply drawer.

Verification:

- Unit test parser/validator.
- Manual QA checklist completed.

## Iteration 3: Better Context

Goal: make product mentions more relevant and less forced.

- Store products/projects as structured entries.
- Add fields for target customer, use cases, proof points, and never-mention rules.
- Retrieve only the most relevant profile entries for the visible thread. Product/project block selection is implemented; broader profile retrieval is still later.

Verification:

- Test product mention gate with relevant, adjacent, and unrelated post examples.

## Iteration 4: Polish

Goal: make day-to-day usage smoother.

- Add keyboard shortcut for generate. Done in MVP.
- Add copy option in addition to insert. Done in MVP.
- Add profile export/import. Done in MVP.
- Add loading and error states that fit X UI.

Verification:

- Manual QA across desktop Chrome viewports.
- Confirm no layout shift or overlapping UI around the composer.
- Complete `docs/release-checklist.md`.

## Iteration 5: Hosted Release

Goal: remove the need for ordinary users to store an OpenAI API key in the extension.

- Implement the strategy in `docs/production-api-strategy.md`.
- Add hosted generation behind an explicit setting.
- Keep local-key mode for personal/developer use only.

Verification:

- Live backend generation QA with a valid account.
- Confirm no raw X thread text is logged by default.
- Confirm the extension still cannot post automatically.
