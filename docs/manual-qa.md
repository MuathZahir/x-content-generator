# Manual QA Checklist

Use this checklist after loading the project through `chrome://extensions` as an unpacked extension.

## Environment

- Browser:
- Extension version: `0.1.0`
- Date:
- Tester:

## Setup

- [x] Local fixture `tests/mock-options-page.html` saves and reloads settings.
- [ ] Extension loads without manifest errors.
- [ ] Popup opens from the toolbar.
- [ ] **Edit profile** opens the settings page.
- [ ] Settings page saves API key, model, profile, products/projects, voice, forbidden phrases, and bad examples.
- [ ] Mock reply mode can be enabled and disabled.
- [ ] Exported profile JSON does not include the API key.
- [ ] Closing and reopening settings reloads the saved values.
- [ ] Reset defaults restores built-in profile fields without clearing the API key.

## X composer flows

- [x] Local fixture `tests/mock-x-page.html` shows the Penn AI panel.
- [ ] Home feed reply composer shows the Penn AI panel.
- [ ] Post detail page reply composer shows the Penn AI panel.
- [ ] Reply modal/drawer shows the Penn AI panel.
- [x] Local fixture verifies multiple composers do not get duplicate panels.
- [ ] Multiple composers do not get duplicate panels on X.

## Generation behavior

- [x] Local fixture verifies missing API key error is shown clearly.
- [ ] With no API key on installed extension, **Suggest replies** shows a clear setup error.
- [ ] With mock mode enabled, **Suggest replies** returns local options without an API key.
- [ ] With a valid API key, **Suggest replies** returns 3-5 options.
- [x] Local fixture verifies shortcut message triggers suggestions for the active composer.
- [ ] `Alt+Shift+R` triggers suggestions for the active composer on X.
- [ ] Result includes a visible product mention gate.
- [ ] Non-product modes usually avoid product mentions.
- [ ] **Softly mention my project** mentions a product only when the visible thread is relevant.
- [ ] Generated replies avoid forbidden phrases, hashtags, links, and generic praise.

## Insertion behavior

- [ ] Clicking **Insert** inserts text into the composer.
- [ ] Clicking **Copy** copies text without changing composer text.
- [x] Local fixture verifies clipboard failure shows a visible error.
- [ ] If clipboard access fails on X, Copy shows a visible error.
- [ ] Inserted text can be edited manually.
- [ ] The extension never submits/posts the reply.
- [ ] Existing composer text is replaced intentionally.

## Privacy and safety

- [ ] No request is sent before clicking **Suggest replies**.
- [ ] **Context sent** preview reflects nearby visible thread text.
- [ ] Only visible nearby thread text is sent.
- [ ] No auto-like, auto-follow, auto-repost, auto-DM, or bulk reply behavior exists.

## Notes

Record defects, screenshots, and reproduction steps here.
