# Live QA Playbook

Use this playbook to close the remaining release gates that require an authenticated X session and/or a valid OpenAI API key.

## Prerequisites

- Chrome or Chromium.
- ContextReply loaded as an unpacked extension from this project folder.
- An authenticated X account available in the test browser.
- Optional for live generation: `OPENAI_API_KEY`.

## 1. Installed Extension Setup

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project folder.
4. Confirm **ContextReply** appears and is enabled.
5. Open extension details and confirm host permissions include:
   - `https://x.com/*`
   - `https://twitter.com/*`
   - `https://api.openai.com/*`

Evidence to record in `docs/qa-results.md`:

- Browser/version.
- Extension version.
- Screenshot or notes confirming enabled state and permissions.

## 2. Settings QA

1. Open the extension options page.
2. Enable **Use mock replies for local QA**.
3. Fill profile, products/projects, tone, forbidden phrases, and bad examples.
4. Save.
5. Close and reopen options.
6. Confirm values persist.
7. Export profile JSON and confirm it does not include `apiKey`.
8. Click **Reset defaults** and confirm API key remains while profile fields reset.

Evidence:

- Saved values persist.
- Export omits API key.
- Reset behavior result.

## 3. X Home Feed Composer

1. Open `https://x.com/home`.
2. Open a reply composer from a visible feed post.
3. Confirm the ContextReply panel appears once.
4. Expand **Context sent** and confirm it contains only nearby visible thread/post text.
5. With mock mode enabled, click **Suggest replies**.
6. Confirm 3 reply options appear.
7. Confirm product mention gate is visible.
8. Click **Insert** and confirm composer text changes but does not post.
9. Edit inserted text manually.
10. Clear composer text.
11. Click **Copy** and confirm composer text does not change.

Evidence:

- Panel appears once.
- Context preview contents.
- Options count.
- Insert behavior.
- Copy behavior.
- No post submitted.

## 4. X Post Detail Composer

1. Open an individual post detail page.
2. Open the reply composer.
3. Repeat the checks from **X Home Feed Composer**.

Evidence:

- Same as home feed composer.

## 5. X Modal/Drawer Composer

1. Open any X flow that uses a modal or drawer composer.
2. Confirm the ContextReply panel appears once.
3. Repeat the generation, gate, insert, copy, and no-post checks.

Evidence:

- Same as home feed composer.

## 6. Keyboard Shortcut

1. Focus an X reply composer.
2. Press `Alt+Shift+R`.
3. Confirm suggestions are generated for the focused composer.
4. If multiple composers are visible, confirm the focused composer receives the suggestions.

Evidence:

- Focused composer result.

## 7. Missing API Key Error

1. Disable mock mode.
2. Clear the API key.
3. Open an X reply composer.
4. Click **Suggest replies**.
5. Confirm the visible error says: `Add your OpenAI API key in the ContextReply extension settings.`

Evidence:

- Error message.
- No reply inserted.

## 8. Live OpenAI Generation

1. Add a valid OpenAI API key in settings.
2. Disable mock mode.
3. Open an X reply composer.
4. Click **Suggest replies**.
5. Confirm 3-5 options render.
6. Confirm forbidden phrases, hashtags, and links are absent unless explicitly configured.
7. Confirm product mention gate behaves correctly in:
   - relevant thread
   - unrelated thread
   - non-product reply mode

Evidence:

- Model used.
- Options count.
- Relevance gate result for each scenario.
- Any failed safety-filter output.

Optional command-line smoke check:

```powershell
$env:OPENAI_API_KEY="sk-..."
npm run smoke:openai
```

## 9. Final Release Gate

Before marking the release ready, run:

```powershell
npm run validate
npm run package
```

Then update:

- `docs/qa-results.md`
- `docs/release-checklist.md`
