import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import {
  bootstrap,
  createPairing,
  approvePairing,
  claimPairing,
  resolveToken,
  revokeToken,
  getDiscoverUsage,
  bumpDiscover
} from "./db.js";
import { getEntitlements, authorizeCall, refundCall, QuotaError, PLANS } from "./quota.js";
import { generateReplies, generatePost, refineDraft, extractProduct, curateDiscoveries } from "./openai.js";
import { fetchPageText } from "./fetchPage.js";
import { searchX, enrichTweets, selectDiscoveries } from "./socialcrawl.js";
import { buildDiscoverQuery } from "./prompts.js";
import {
  landingPage,
  connectPage,
  upgradePage,
  successPage,
  privacyPage,
  termsPage
} from "./pages.js";

const app = new Hono();

// --- Hardening ----------------------------------------------------------------

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

// CORS for the browser extension. Requests carry an Authorization: Bearer
// header (not a CORS-safelisted header), so the browser sends a preflight that
// the app must answer — otherwise fetch fails before the real request, even
// though the extension is the only legitimate caller. We reflect any
// chrome-extension:// origin: the API is authenticated by Bearer token, so a
// permissive origin grants no access on its own. Without this, calls work only
// from a domain listed in the extension's host_permissions (heypenn.com) and
// break against any other origin, e.g. the Railway-generated URL.
app.use("/v1/*", cors({
  origin: (origin) => (origin && origin.startsWith("chrome-extension://") ? origin : ""),
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type"],
  maxAge: 86400
}));

// Product photos arrive as data URLs (≤4 × ~150 KB), so 3 MB covers the worst
// legitimate request with headroom.
app.use("/v1/*", bodyLimit({ maxSize: 3 * 1024 * 1024 }));

// Structured request logs with zero user content.
app.use("/v1/*", async (c, next) => {
  const started = Date.now();
  await next();
  console.log(JSON.stringify({
    route: c.req.path,
    status: c.res.status,
    ms: Date.now() - started,
    user: c.get("userId") || null
  }));
});

function apiError(c, status, code, message) {
  return c.json({ error: { code, message } }, status);
}

// Small in-memory burst limiter (single-instance deployment). The durable
// daily quota lives in Postgres; this only smooths spikes and shields the
// unauthenticated pairing endpoint.
const buckets = new Map();
function overBurst(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key) || [];
  const fresh = bucket.filter((t) => now - t < windowMs);
  if (fresh.length >= limit) {
    buckets.set(key, fresh);
    return true;
  }
  fresh.push(now);
  buckets.set(key, fresh);
  if (buckets.size > 10_000) buckets.clear();
  return false;
}

function clientIp(c) {
  return c.req.header("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

// --- Pages ---------------------------------------------------------------------

app.get("/", (c) => c.html(landingPage()));

// The Polar Better-Auth plugin's /checkout and /customer/portal endpoints
// return JSON { url }, not a redirect, so they are not browser-navigable. We
// own thin GET routes here that create the Polar session and issue a real
// redirect, giving the extension and pages one stable, link-able URL each.

const PRODUCT_SLUGS = {
  pro: process.env.POLAR_PRODUCT_PRO_MONTHLY,
  "pro-yearly": process.env.POLAR_PRODUCT_PRO_YEARLY
};

function polarClient() {
  if (!process.env.POLAR_ACCESS_TOKEN) return null;
  // Lazy import keeps boot working before billing is configured.
  return import("@polar-sh/sdk").then(({ Polar }) => new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    server: process.env.POLAR_SERVER === "production" ? "production" : "sandbox"
  }));
}

app.get("/checkout/:slug", async (c) => {
  const slug = c.req.param("slug");
  const productId = PRODUCT_SLUGS[slug];
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) return c.redirect(`/connect?next=${encodeURIComponent(`/checkout/${slug}`)}`);
  if (!productId) return c.redirect("/upgrade");

  const polar = await polarClient();
  if (!polar) return c.redirect("/upgrade");

  try {
    const base = new URL(c.req.url).origin;
    const checkout = await polar.checkouts.create({
      externalCustomerId: session.user.id,
      customerEmail: session.user.email || undefined,
      products: [productId],
      successUrl: `${base}/success?checkout_id={CHECKOUT_ID}`
    });
    const url = new URL(checkout.url);
    url.searchParams.set("theme", "dark");
    return c.redirect(url.toString());
  } catch (error) {
    console.error(`checkout(${slug}): ${error.message}`);
    return c.redirect("/upgrade?error=checkout");
  }
});

app.get("/portal", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) return c.redirect("/connect");
  const polar = await polarClient();
  if (!polar) return c.redirect("/upgrade");
  try {
    const portalSession = await polar.customerSessions.create({
      externalCustomerId: session.user.id
    });
    const url = portalSession?.customerPortalUrl || portalSession?.customer_portal_url;
    if (url) return c.redirect(url);
  } catch (error) {
    console.error(`portal: ${error.message}`);
  }
  return c.redirect("/upgrade");
});
app.get("/connect", (c) => c.html(connectPage()));
app.get("/upgrade", (c) => c.html(upgradePage()));
app.get("/success", (c) => c.html(successPage()));
app.get("/privacy", (c) => c.html(privacyPage()));
app.get("/terms", (c) => c.html(termsPage()));
// `build` is a manual marker bumped per deploy so a deploy can be confirmed live
// without an authenticated call.
app.get("/healthz", (c) => c.json({ ok: true, build: "cost-caps-discover15-1" }));

// --- Better Auth (Google sign-in, Polar checkout/portal/webhooks) ---------------

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// --- Device pairing (extension <-> account) --------------------------------------

app.post("/v1/device/new", async (c) => {
  if (overBurst(`pair:${clientIp(c)}`, 20, 60 * 60 * 1000)) {
    return apiError(c, 429, "rate_limited", "Too many pairing attempts. Try again later.");
  }
  const pairing = await createPairing();
  return c.json(pairing);
});

app.post("/v1/device/approve", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) {
    return apiError(c, 401, "unauthorized", "Sign in first.");
  }
  const { code } = await c.req.json().catch(() => ({}));
  if (typeof code !== "string" || code.length > 16) {
    return apiError(c, 400, "invalid_request", "Bad pairing code.");
  }
  const ok = await approvePairing(code, session.user.id);
  if (!ok) return apiError(c, 400, "invalid_request", "Pairing code expired or already used.");
  return c.json({ ok: true });
});

app.post("/v1/device/claim", async (c) => {
  if (overBurst(`claim:${clientIp(c)}`, 600, 10 * 60 * 1000)) {
    return apiError(c, 429, "rate_limited", "Slow down.");
  }
  const { code, secret } = await c.req.json().catch(() => ({}));
  if (typeof code !== "string" || typeof secret !== "string") {
    return apiError(c, 400, "invalid_request", "Bad claim.");
  }
  const claimed = await claimPairing(code, secret);
  if (!claimed) return c.json({ pending: true });
  return c.json({ token: claimed.token });
});

// --- Authenticated API -----------------------------------------------------------

async function requireUser(c) {
  const header = c.req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = await resolveToken(token);
  if (!userId) return null;
  c.set("userId", userId);
  c.set("token", token);
  return userId;
}

app.get("/v1/me", async (c) => {
  const userId = await requireUser(c);
  if (!userId) return apiError(c, 401, "unauthorized", "Sign in from the extension popup.");
  const entitlements = await getEntitlements(userId);
  const session = await getUserPublic(userId);
  return c.json({ user: session, ...entitlements, prices: { monthly: 9, yearly: 79 } });
});

import { pool } from "./db.js";
async function getUserPublic(userId) {
  const result = await pool.query(
    'SELECT id, name, email, image FROM "user" WHERE id = $1',
    [userId]
  );
  return result.rows[0] || { id: userId };
}

app.post("/v1/signout", async (c) => {
  const userId = await requireUser(c);
  if (userId) await revokeToken(c.get("token"));
  return c.json({ ok: true });
});

// --- Generation ---------------------------------------------------------------

const LIMITS = {
  threadText: 12_000,
  note: 600,
  instruction: 600,
  currentText: 2_000,
  idea: 2_000,
  profileField: 8_000,
  feedPosts: 40,
  trends: 10,
  history: 12,
  extractUrl: 2_000,
  extractText: 8_000,
  discoverLookbackMax: 90,
  discoverLookbackDefault: 14
};

function clip(value, max) {
  return String(value || "").slice(0, max);
}

function readProfile(body) {
  const raw = body?.profile && typeof body.profile === "object" ? body.profile : {};
  return {
    context: clip(raw.context, LIMITS.profileField),
    products: clip(raw.products, LIMITS.profileField),
    voice: clip(raw.voice, LIMITS.profileField),
    forbidden: clip(raw.forbidden, LIMITS.profileField),
    badExamples: clip(raw.badExamples, LIMITS.profileField)
  };
}

async function handleGeneration(c, kind, run) {
  if (process.env.DISABLE_GENERATION === "1") {
    return apiError(c, 503, "model_unavailable", "Generation is paused for maintenance. Back shortly.");
  }
  const userId = await requireUser(c);
  if (!userId) return apiError(c, 401, "unauthorized", "Sign in from the extension popup.");
  if (overBurst(`gen:${userId}`, 10, 60 * 1000)) {
    return apiError(c, 429, "rate_limited", "Too many requests at once. Give it a few seconds.");
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "invalid_request", "Body must be JSON.");
  }

  let grant;
  try {
    grant = await authorizeCall(userId, {
      kind,
      requestedModel: typeof body.model === "string" ? body.model : "",
      webSearch: Boolean(body.webSearch)
    });
  } catch (error) {
    if (error instanceof QuotaError) {
      const status = error.code === "upgrade_required" || error.code === "free_limit_reached" ? 402 : 429;
      return apiError(c, status, error.code, error.message);
    }
    throw error;
  }

  try {
    const result = await run(body, grant, { userId, route: c.req.path });
    return c.json(result);
  } catch (error) {
    // The reservation in authorizeCall already counted this call. The user got
    // no draft, so give it back before surfacing the error.
    await refundCall(userId).catch((refundError) => {
      console.error(`refund failed for ${userId}: ${refundError.message}`);
    });
    const code = error.code || "generation_failed";
    const status = code === "rate_limited" ? 429 : code === "model_unavailable" ? 503 : 502;
    return apiError(c, status, code, error.message || "Generation failed.");
  }
}

app.post("/v1/generate", (c) =>
  handleGeneration(c, "generate", (body, grant, meta) =>
    generateReplies({
      note: clip(body.note, LIMITS.note),
      threadText: clip(body.threadText, LIMITS.threadText),
      images: body.images,
      profile: readProfile(body),
      model: grant.model,
      meta
    })
  )
);

app.post("/v1/compose", (c) =>
  handleGeneration(c, "compose", (body, grant, meta) => {
    const product = body.product && typeof body.product === "object"
      ? {
          name: clip(body.product.name, 200),
          description: clip(body.product.description, 2000),
          link: clip(body.product.link, 500),
          mention: clip(body.product.mention, 500),
          media: Array.isArray(body.product.media) ? body.product.media.slice(0, 4) : []
        }
      : null;

    return generatePost({
      idea: clip(body.idea, LIMITS.idea),
      feed: (Array.isArray(body.feed) ? body.feed : []).slice(0, LIMITS.feedPosts),
      trends: (Array.isArray(body.trends) ? body.trends : []).slice(0, LIMITS.trends),
      product,
      profile: readProfile(body),
      feedGrounding: body.feedGrounding !== false,
      model: grant.model,
      webSearch: grant.webSearch,
      meta
    });
  })
);

app.post("/v1/refine", (c) =>
  handleGeneration(c, "refine", (body, grant, meta) =>
    refineDraft({
      kind: body.kind === "post" ? "post" : "reply",
      currentText: clip(body.currentText, LIMITS.currentText),
      instruction: clip(body.instruction, LIMITS.instruction),
      baseContext: clip(body.baseContext, LIMITS.threadText),
      images: body.images,
      history: (Array.isArray(body.history) ? body.history : []).slice(-LIMITS.history),
      profile: readProfile(body),
      model: grant.model,
      meta
    })
  )
);

// Reads a product URL (or pasted text) and drafts {name, description, mention}
// for the extension's product editor. Free, counted against the daily allowance
// like a generation, and always on the cheap model regardless of plan.
app.post("/v1/extract", async (c) => {
  if (process.env.DISABLE_GENERATION === "1") {
    return apiError(c, 503, "model_unavailable", "Extraction is paused for maintenance. Back shortly.");
  }
  const userId = await requireUser(c);
  if (!userId) return apiError(c, 401, "unauthorized", "Sign in from the extension popup.");
  if (overBurst(`extract:${userId}`, 10, 60 * 1000)) {
    return apiError(c, 429, "rate_limited", "Too many requests at once. Give it a few seconds.");
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "invalid_request", "Body must be JSON.");
  }

  const url = clip(body.url, LIMITS.extractUrl).trim();
  const pasted = clip(body.text, LIMITS.extractText).trim();
  if (!url && !pasted) {
    return apiError(c, 400, "invalid_request", "Provide a product URL or pasted details.");
  }

  // Reserve a call up front so the daily cap stays atomic under concurrency;
  // every early return below refunds it, so only a delivered draft is charged.
  try {
    await authorizeCall(userId, { kind: "extract", requestedModel: "", webSearch: false });
  } catch (error) {
    if (error instanceof QuotaError) {
      const status = error.code === "upgrade_required" || error.code === "free_limit_reached" ? 402 : 429;
      return apiError(c, status, error.code, error.message);
    }
    throw error;
  }

  let source = "";
  let lowConfidence = false;

  if (pasted) {
    source = `Notes the maker pasted:\n${pasted}`;
  } else {
    let page;
    try {
      page = await fetchPageText(url);
    } catch (error) {
      await refundCall(userId).catch(() => {});
      const ssrf = error.code === "ssrf_blocked";
      return apiError(c, ssrf ? 400 : 422, ssrf ? "invalid_request" : "fetch_failed", error.message || "Could not read that page.");
    }
    if (page.thin) {
      await refundCall(userId).catch(() => {});
      return apiError(c, 422, "thin_source", "Couldn't read enough from that page. Paste a description instead.");
    }
    source = page.source;
    lowConfidence = page.lowConfidence;
  }

  try {
    const product = await extractProduct({ source, model: "gpt-5.4-mini", meta: { userId, route: c.req.path } });
    return c.json({
      product: {
        name: clip(product.name, 200),
        description: clip(product.description, 2000),
        mention: clip(product.mention, 500)
      },
      lowConfidence
    });
  } catch (error) {
    await refundCall(userId).catch((refundError) => {
      console.error(`refund failed for ${userId}: ${refundError.message}`);
    });
    const code = error.code || "extract_failed";
    const status = code === "rate_limited" ? 429 : code === "model_unavailable" ? 503 : 502;
    return apiError(c, status, code, error.message || "Extraction failed.");
  }
});

// Finds X posts worth replying to about one of the maker's products. Pro-only,
// counts against the daily allowance like a generation, and refunded whenever
// no draft of value is produced (search down, no results, curation failed). The
// SocialCrawl key lives server-side; the extension never touches it. Results are
// returned to the panel and never stored — this is a discovery surface, not a
// monitor or a lead list.
app.post("/v1/discover", async (c) => {
  if (process.env.DISABLE_GENERATION === "1") {
    return apiError(c, 503, "model_unavailable", "Discovery is paused for maintenance. Back shortly.");
  }
  const userId = await requireUser(c);
  if (!userId) return apiError(c, 401, "unauthorized", "Sign in from the extension popup.");
  if (overBurst(`discover:${userId}`, 6, 60 * 1000)) {
    return apiError(c, 429, "rate_limited", "Too many searches at once. Give it a few seconds.");
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "invalid_request", "Body must be JSON.");
  }

  const product = body.product && typeof body.product === "object"
    ? {
        name: clip(body.product.name, 200),
        description: clip(body.product.description, 2000),
        link: clip(body.product.link, 500),
        mention: clip(body.product.mention, 500)
      }
    : null;

  if (!product || !product.name.trim()) {
    return apiError(c, 400, "invalid_request", "Pick a product to find posts for.");
  }

  let grant;
  try {
    grant = await authorizeCall(userId, {
      kind: "discover",
      requestedModel: typeof body.model === "string" ? body.model : "",
      webSearch: false
    });
  } catch (error) {
    if (error instanceof QuotaError) {
      const status = error.code === "upgrade_required" || error.code === "free_limit_reached" ? 402 : 429;
      return apiError(c, status, error.code, error.message);
    }
    throw error;
  }

  // Discover has its own daily ceiling, separate from the call allowance and
  // NEVER refunded. Each attempt below spends a SocialCrawl credit and a curation
  // call even when curation returns nothing; the daily-call refund on no-results
  // (good UX) must not also grant a free retry, or a no-match product could loop
  // and drain search credits and the shared token pool. This counter is the cap.
  const plan = PLANS[grant.plan] || PLANS.free;
  const discoversToday = await getDiscoverUsage(userId);
  if (discoversToday >= plan.discoverDaily) {
    await refundCall(userId).catch(() => {});
    return apiError(c, 429, "rate_limited", "Daily discovery limit reached. It resets at midnight UTC.");
  }
  await bumpDiscover(userId);

  const lookbackRaw = Number(body.lookbackDays);
  const lookbackDays = Number.isFinite(lookbackRaw)
    ? Math.min(LIMITS.discoverLookbackMax, Math.max(1, Math.floor(lookbackRaw)))
    : LIMITS.discoverLookbackDefault;

  const query = buildDiscoverQuery(product);

  try {
    const { answer, sources } = await searchX({ query, lookbackDays });
    if (!sources.length) {
      await refundCall(userId).catch(() => {});
      return apiError(c, 422, "no_results", "No recent posts matched this product. Try a broader product description or check back later.");
    }

    // Curation only ranks/explains posts the search already returned, so it runs
    // on the cheap model regardless of plan: ~3x cheaper than the flagship and it
    // draws from the larger (10M/day) mini token pool instead of the scarce
    // (1M/day) one the reply/compose paths need.
    const { candidates } = await curateDiscoveries({
      product,
      profile: readProfile(body),
      answer,
      sources,
      model: "gpt-5.4-mini",
      meta: { userId, route: c.req.path }
    });

    if (!candidates.length) {
      await refundCall(userId).catch(() => {});
      return apiError(c, 422, "no_results", "Found posts, but none were a genuine opening worth replying to. Try again later.");
    }

    // Enrich the curated pool with live author + engagement (1 credit each,
    // bounded concurrency), then filter out dead/buried posts, diversify by
    // author, and rank by real traction down to the handful we show. Enrichment
    // is best-effort: a post that fails to look up is shown without metrics, not
    // dropped, so an upstream hiccup can't empty an otherwise good run.
    const enriched = await enrichTweets(candidates.map((candidate) => candidate.url));
    const selected = selectDiscoveries(candidates, enriched, { limit: 6 });

    if (!selected.length) {
      await refundCall(userId).catch(() => {});
      return apiError(c, 422, "no_results", "Found posts, but none were a genuine opening worth replying to. Try again later.");
    }

    return c.json({ query, candidates: selected });
  } catch (error) {
    await refundCall(userId).catch((refundError) => {
      console.error(`refund failed for ${userId}: ${refundError.message}`);
    });
    const code = error.code || "discover_failed";
    const status = code === "rate_limited" ? 429
      : code === "discover_unavailable" || code === "model_unavailable" ? 503
      : 502;
    return apiError(c, status, code, error.message || "Discovery failed.");
  }
});

app.notFound((c) => apiError(c, 404, "invalid_request", "No such endpoint."));
app.onError((error, c) => {
  console.error(`unhandled: ${error.message}`);
  return apiError(c, 500, "generation_failed", "Something broke on our side.");
});

// --- Boot -----------------------------------------------------------------------

const port = Number(process.env.PORT || 8080);
await bootstrap();
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(JSON.stringify({
  boot: true,
  port,
  google: Boolean(process.env.GOOGLE_CLIENT_ID),
  polar: Boolean(process.env.POLAR_ACCESS_TOKEN),
  openai: Boolean(process.env.OPENAI_API_KEY),
  socialcrawl: Boolean(process.env.SOCIALCRAWL_API_KEY),
  plans: Object.keys(PLANS)
}));
