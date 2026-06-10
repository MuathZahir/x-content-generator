# penn AI API server

Hono + Better Auth + Polar + Postgres. Deployed on Railway (project `penn-ai`, service `api`), canonical domain `https://heypenn.com` (Railway also keeps the internal `https://api-production-98f2.up.railway.app` URL alive).

## Layout

- `src/index.js` — routes: hosted pages, `/api/auth/*` (Better Auth + Polar), device pairing, `/v1/generate|compose|refine`, hardening middleware.
- `src/auth.js` — Better Auth config: Google sign-in, Polar checkout/portal/webhooks (all optional until env vars exist).
- `src/openai.js` — the only place provider calls happen; key from `OPENAI_API_KEY`.
- `src/prompts.js`, `src/policy.js` — prompt + anti-AI-tell filter, ported 1:1 from the extension (parity-tested).
- `src/quota.js` — plan definitions (free/pro) and daily-quota enforcement.
- `src/db.js` — pg pool, app tables (device pairing/tokens, billing, usage), bootstrap on boot.
- `src/pages.js` — landing, /connect, /upgrade, /success, /privacy, /terms.

## Environment variables (Railway service `api`)

| Var | Status | Notes |
| --- | --- | --- |
| `DATABASE_URL` | set | references `${{Postgres.DATABASE_URL}}` |
| `BETTER_AUTH_URL` | set | the canonical public URL — `https://heypenn.com` |
| `BETTER_AUTH_SECRET` | set | generated |
| `OPENAI_API_KEY` | **you must set** | platform.openai.com key; generation 503s without it |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **you must set** | Google Cloud OAuth web client; redirect URI `https://<domain>/api/auth/callback/google` |
| `POLAR_ACCESS_TOKEN` | **you must set** | Polar org access token (sandbox first) |
| `POLAR_SERVER` | set (`sandbox`) | switch to `production` at launch |
| `POLAR_WEBHOOK_SECRET` | **you must set** | webhook endpoint `https://<domain>/api/auth/polar/webhooks` |
| `POLAR_PRODUCT_PRO_MONTHLY` / `POLAR_PRODUCT_PRO_YEARLY` | **you must set** | product IDs from the Polar dashboard |
| `DISABLE_GENERATION` | unset | set to `1` as a kill switch |

The server boots and serves pages/auth-less routes with any of these missing; features light up as vars land.

## Operations

```powershell
railway up --service api --detach     # deploy (run from server/)
railway logs --service api            # runtime logs (JSON lines, no user content)
railway variable set KEY=value --service api
npm run check                         # syntax + parity tests
npm run migrate                       # Better Auth schema (needs public DATABASE_URL in env)
```

Migrations: Better Auth tables are owned by `npx @better-auth/cli migrate` (already run for 1.0.0). App tables are `CREATE TABLE IF NOT EXISTS` on boot. After upgrading the `better-auth` package, re-run `npm run migrate` locally against the public `DATABASE_PUBLIC_URL` from the Postgres service.

## Plans

Defined in `src/quota.js`: free = 5 calls/day, `gpt-5.4-mini`, replies only; pro = 400 calls/day, all models (default `gpt-5.4`), compose/promote + web search. Billing state syncs from Polar's `onCustomerStateChanged` webhook into the `billing` table; `getBilling` degrades to free when a subscription lapses.
