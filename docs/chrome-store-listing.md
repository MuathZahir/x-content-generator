# Chrome Web Store Listing

Everything below is ready to paste into the Chrome Web Store developer dashboard.

## Name

Penn AI — X reply copilot in your voice

## Short description (132 chars max)

Drafts X replies and posts that sound like you, not like AI. Human-in-the-loop: you always edit and post by hand. Never auto-posts.

## Category

Social & Communication (alternative: Productivity / Workflow)

## Detailed description

Penn AI is a human-in-the-loop reply copilot for X.

It lives beside the X composer. When you click Suggest replies, it reads the post you are replying to, combines it with your saved profile (who you are, what you build, your actual posts, your forbidden phrases), and drafts 3-5 reply options that read like a sharp human typed them on a phone.

WHY IT DOESN'T SOUND LIKE AI
Every draft runs through a filter that bans the tells people clock instantly: the "not X, it's Y" contrast flip, em dashes, rule-of-three lists, hype words, listicle voice, engagement bait, forced wrap-ups. If a draft sounds like a model wrote it, it never reaches you.

YOUR PRODUCTS, MENTIONED ONLY WHEN IT FITS
Save your products and projects with rules for when to mention them. A relevance gate decides honestly whether a mention belongs in the reply; a forced plug is worse than no mention, so most of the time the answer is no.

GROW WITH PRO
- Free, forever: 5 generations a day, replies in your voice, anti-AI-slop filter, reads images in the post.
- Pro ($9/mo or $79/yr): 400 generations a day on the best model, original posts grounded in your live feed and trends, builder-voice product promotion, web search for current events, draft refinement chat, model choice.

PRIVATE BY DESIGN
Your profile stays in your browser's local extension storage; our server never keeps a copy. Generation requests are processed and discarded — request content is never logged or stored. Sign-in is Google; payments are handled by Polar. No ads, no trackers, no data sales.

HARD SAFETY LINES
Penn AI never auto-posts, never likes, follows, DMs, or reposts, never scrapes, and never acts without your click. You always edit and post by hand.

## Permission justification

- `storage` + `unlimitedStorage`: saves your profile, products, and product photos locally in extension storage. Photos are stored as downscaled images, which is why unlimitedStorage is requested.
- `clipboardWrite`: powers the Copy button on generated drafts.
- `tabs`: opens the sign-in/upgrade pages in a new tab and routes the Alt+Shift+R shortcut to the active X tab.
- Host `https://x.com/*`, `https://twitter.com/*`: injects the reply panel beside the composer. Read-only; the extension never posts.
- Host `https://heypenn.com/*`: the Penn AI API. Called only when you explicitly request a generation or check your account. Holds the model API key server-side so no key ever ships in the extension.

## Privacy

- Privacy policy URL: https://heypenn.com/privacy
- Single purpose: drafting X replies/posts on the user's explicit request.
- Data use disclosures (Chrome dashboard):
  - Personally identifiable information: name, email (Google sign-in) — used for account/auth only.
  - Website content: visible post text and post image URLs from the active X page — sent only on user action, processed for generation, not stored.
  - Not collected: location, web history, keystrokes, financial data (Polar processes payments externally).
  - No sale of data, no use for unrelated purposes, no creditworthiness use.

## Review notes (for the reviewer)

- The extension is human-in-the-loop: every generation requires a click; the user manually copies/inserts/edits/posts.
- It never submits X posts and does not automate likes, reposts, follows, DMs, or bulk replies, and does not use the X API.
- To test WITHOUT an account: open the extension options, enable "Use mock replies for local QA", open any X post, click reply, and press Suggest replies in the Penn AI panel. Mock mode is fully offline.
- To test WITH an account: click the toolbar icon, Continue with Google, then generate on any X post (Free plan, no card required).

## Assets needed (only remaining manual items)

- 128x128 icon (plus 48 and 16). Brand: X-blue (#1d9bf0) dot on deep slate (#0c1218), see ui.css.
- 440x280 small promo tile.
- 1280x800 screenshots: panel with reply options, settings profile, popup account hub, promote mode.
