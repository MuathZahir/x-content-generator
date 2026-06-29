# Penn AI

Penn AI is a Chrome extension that drafts X replies and posts in your voice. It reads the visible post/thread only when you click **Suggest replies**, combines it with your saved context profile, and returns options you manually edit and post. Generation runs through the hosted Penn AI API (`server/`, deployed on Railway), which holds the model key server-side; the extension never stores a provider key.

Current version: `1.0.0`. Release notes are in [CHANGELOG.md](CHANGELOG.md).

It is intentionally human-in-the-loop. It does not auto-post, auto-like, scrape at scale, or run reply campaigns.

## How it works

- Injects a reply assistant panel into X/Twitter reply composers, plus a compose view for original posts and product promotion.
- Stores your profile, products/projects (with photos), tone, forbidden phrases, and bad examples in local Chrome extension storage. The server never keeps a copy.
- Sign in with Google from the toolbar popup; the extension pairs to your account with a private device token.
- Free plan: 5 generations/day for replies. Pro ($9/mo, $79/yr via Polar): 100/day (1,500/month fair-use), original posts grounded in your live feed, product promotion, web search, model choice, and Discover (find X posts worth replying to about your products, up to 15/day).
- Discover (Pro): a tab that searches recent X posts where one of your products is a genuine answer, ranks them, and explains the opening. You open a post and reply in your own words; it never auto-replies and never stores a list. Search runs server-side through SocialCrawl; the X-only lane is the first step, with other platforms (Reddit, LinkedIn) possible later.
- Prompts and the anti-AI-tell policy filter (no "not X, it's Y" flips, no em dashes, no hype words, no engagement bait) run server-side, with a defensive mirror in the client.
- A relevance gate decides whether mentioning one of your products is genuinely warranted; usually it is not, and that is the point.
- Supports `Alt+Shift+R` to suggest replies for the active composer.
- Mock mode generates local sample replies offline, with no account and no network. Use it for QA and store review.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project folder.
4. Click the Penn AI toolbar icon and **Continue with Google** (or enable mock mode in settings for offline QA).
5. Open X, start a reply, and click **Suggest replies** in the Penn AI panel.

## Validate

Run the full local release check (extension checks, server parity tests, packaging):

```powershell
npm run release:check
```

Extension-only checks: `npm run validate`. Server-only checks: `npm run server:check`.

Optional live smoke test against the hosted API (needs a signed-in device token):

```powershell
$env:PENN_AI_TOKEN="penn_..."
npm run smoke:api
```

Package the extension for upload:

```powershell
npm run package
npm run test:package
```

Manual browser QA is tracked in [docs/manual-qa.md](docs/manual-qa.md), with evidence in [docs/qa-results.md](docs/qa-results.md). Local fixtures live at `tests/mock-x-page.html` and `tests/mock-options-page.html`.

## Server

The hosted API is in the `server/` directory of the source repo (see `server/README.md` there for env vars and operations): Hono + Better Auth (Google) + Polar billing + Postgres on Railway. Endpoints, auth, quotas, and guarantees are documented in [docs/hosted-api-contract.md](docs/hosted-api-contract.md); the original decision record is [docs/production-api-strategy.md](docs/production-api-strategy.md).

## Product assumptions

- The safest useful product is a copilot, not an automation bot.
- The first valuable wedge is quality and relevance, not reply volume.
- People pay for the growth surface (posts, promotion, grounding), so replying stays free and the upgrade is earned.

Architecture is documented in [docs/architecture.md](docs/architecture.md).
Developer workflow is documented in [docs/developer-guide.md](docs/developer-guide.md).
Profile-writing guidance is available in [docs/profile-guide.md](docs/profile-guide.md).

## Privacy and safety

See [docs/privacy-security.md](docs/privacy-security.md) for stored data, request payloads, automation boundaries, and permission rationale. The hosted privacy policy is at https://heypenn.com/privacy.

Release readiness is tracked in [docs/release-checklist.md](docs/release-checklist.md).
The hosted API contract is documented in [docs/hosted-api-contract.md](docs/hosted-api-contract.md).
The remaining live checks are documented in [docs/live-qa-playbook.md](docs/live-qa-playbook.md).
X account-safety guidance is documented in [docs/x-safety-guide.md](docs/x-safety-guide.md).
Known risks are tracked in [docs/risk-register.md](docs/risk-register.md).
Current completion status is audited in [docs/completion-audit.md](docs/completion-audit.md).
Chrome Web Store copy is drafted in [docs/chrome-store-listing.md](docs/chrome-store-listing.md).

## Non-goals

- No auto-posting.
- No bulk reply workflows.
- No lead database.
- No scheduling or analytics.
- No generic growth-bot positioning.
