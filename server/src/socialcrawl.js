// The discovery data layer. Every SocialCrawl call lives here, with the
// server-held key: the keyword search, the per-post enrichment lookups, and the
// pure ranking step that turns curated candidates into the varied, visible list
// the panel shows. The extension never sees the SocialCrawl key, never calls
// X/Twitter directly, and never receives a raw provider response. This is the
// only place the discovery surface reaches outside our own infrastructure.
//
// Discovery is intentionally narrow: a single read-only X search per request,
// surfaced for the human to act on manually. It is not a monitor, not a stored
// feed, not a campaign. See docs/architecture.md "Boundaries".

const SOCIALCRAWL_BASE = "https://www.socialcrawl.dev";

function apiKey() {
  const key = process.env.SOCIALCRAWL_API_KEY;
  if (!key || !key.startsWith("sc_")) {
    const error = new Error("Post discovery is not configured yet (missing search key).");
    error.code = "discover_unavailable";
    throw error;
  }
  return key;
}

// today - days, as YYYY-MM-DD, for the ai-search from_date window.
function isoDaysAgo(days) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - Math.max(0, Math.floor(days)));
  return now.toISOString().slice(0, 10);
}

// Pulls the @handle out of an X post permalink (x.com/<handle>/status/<id>).
// The ai-search lane returns sources as { url, title } with no handle field, so
// the URL path is the reliable place to recover it.
function handleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "x.com" && host !== "twitter.com" && host !== "mobile.twitter.com") return "";
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/\d+/);
    return match ? `@${match[1]}` : "";
  } catch {
    return "";
  }
}

// Normalizes whatever shape a single ai-search "source" arrives in into a flat
// { url, handle, text }. The Grok-backed lane returns sources as { url, title }
// (title is just a citation number, not post text — the real post content lives
// in the `answer` markdown), so we read common field aliases defensively and
// recover the handle from the URL when no handle field is present.
function normalizeSource(raw) {
  if (typeof raw === "string") {
    return raw.trim() ? { url: raw.trim(), handle: handleFromUrl(raw.trim()), text: "" } : null;
  }
  if (!raw || typeof raw !== "object") return null;

  const url = String(raw.url || raw.link || raw.permalink || raw.tweet_url || "").trim();
  const handleField = String(raw.handle || raw.username || raw.author || raw.screen_name || "").trim();
  // `title` is deliberately excluded: in this lane it is a citation index ("1"),
  // not post text. Only real text/snippet fields count as content.
  const text = String(raw.text || raw.snippet || raw.content || "").trim();
  if (!url && !text) return null;

  const handle = handleField || handleFromUrl(url);
  return { url, handle, text: text.slice(0, 500) };
}

// Runs one X (Twitter) discovery search via SocialCrawl's Grok-backed
// ai-search lane (1 credit). Returns { answer, sources } with sources
// normalized and capped. Network/upstream failures throw with a stable code so
// the caller can refund the user's reserved call.
export async function searchX({ query, lookbackDays = 14, maxSources = 25 }) {
  const key = apiKey();
  const params = new URLSearchParams({ query: String(query || "").slice(0, 480) });
  if (lookbackDays > 0) params.set("from_date", isoDaysAgo(lookbackDays));

  let response;
  try {
    response = await fetch(`${SOCIALCRAWL_BASE}/v1/twitter/ai-search?${params.toString()}`, {
      method: "GET",
      headers: { "x-api-key": key }
    });
  } catch {
    const error = new Error("Could not reach the post-search service. Try again.");
    error.code = "discover_failed";
    error.upstream = true;
    throw error;
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const code = json?.error?.code || json?.code || "";
    // SocialCrawl refunds failed/empty calls on their side; surface a clean,
    // retryable error and let our caller refund the user's daily allowance.
    console.error(`socialcrawl ai-search failed: ${response.status} ${code}`);
    const error = new Error("Post search failed upstream. Try again in a moment.");
    error.code = response.status === 402 ? "discover_unavailable" : "discover_failed";
    error.upstream = true;
    throw error;
  }

  const payload = json?.data && typeof json.data === "object" ? json.data : json || {};
  const answer = String(payload.answer || "").trim();
  const rawSources = Array.isArray(payload.sources) ? payload.sources : [];
  const sources = rawSources
    .map(normalizeSource)
    .filter(Boolean)
    .slice(0, maxSources);

  return { answer, sources };
}

// --- Enrichment (live author + engagement per post) --------------------------
//
// The ai-search lane returns only { url, title } — no idea who posted, how the
// post is landing, or whether it's a buried reply nobody will see. The tweet
// details endpoint (1 credit/post) fills that in, which is what lets Discover
// show real metrics and drop dead/buried posts instead of sending the maker into
// a long thread with 0–2 likes.

function nonNegInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

// Flattens the normalized tweet payload into the fields the panel needs.
function normalizeTweet(data, fallbackUrl) {
  const author = data.author && typeof data.author === "object" ? data.author : {};
  const eng = data.engagement && typeof data.engagement === "object" ? data.engagement : {};
  const flags = data.flags && typeof data.flags === "object" ? data.flags : {};
  const username = String(author.username || "").trim().replace(/^@/, "");
  return {
    url: String(data.url || fallbackUrl || "").trim(),
    handle: username ? `@${username}` : "",
    authorName: String(author.display_name || "").trim().slice(0, 80),
    verified: author.verified === true,
    avatar: String(author.avatar_url || "").trim(),
    deleted: flags.deleted === true,
    text: String(data?.content?.text || "").trim().slice(0, 500),
    postedAt: data.published_at != null ? data.published_at : null,
    likes: nonNegInt(eng.likes),
    replies: nonNegInt(eng.comments),
    reposts: nonNegInt(eng.shares),
    views: nonNegInt(eng.views)
  };
}

// Looks up one X post's live author + engagement (1 credit). Best-effort: any
// failure (no key, network, upstream error, bad shape) resolves to null so the
// caller shows the post without metrics rather than dropping it.
export async function getTweet(url) {
  let key;
  try {
    key = apiKey();
  } catch {
    return null;
  }
  const clean = String(url || "").trim();
  if (!clean) return null;

  const params = new URLSearchParams({ url: clean, trim: "true" });
  let response;
  try {
    response = await fetch(`${SOCIALCRAWL_BASE}/v1/twitter/tweet?${params.toString()}`, {
      method: "GET",
      headers: { "x-api-key": key }
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let json = null;
  try {
    json = await response.json();
  } catch {
    return null;
  }
  const data = json?.data && typeof json.data === "object" ? json.data : null;
  return data ? normalizeTweet(data, clean) : null;
}

// Enriches a list of post URLs with live details, in parallel but bounded so one
// Discover run can't fan out into dozens of simultaneous upstream calls. Returns
// a Map keyed by the requested URL; posts that failed to enrich are simply absent.
export async function enrichTweets(urls, { concurrency = 5 } = {}) {
  const list = Array.from(
    new Set((Array.isArray(urls) ? urls : []).map((u) => String(u || "").trim()).filter(Boolean))
  );
  const byUrl = new Map();
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const url = list[next++];
      const info = await getTweet(url);
      if (info) byUrl.set(url, info);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return byUrl;
}

// Merges live metrics into the curated candidates, then filters and orders them
// for the panel. Goals, in order: (1) drop posts nobody will see — the "0–2
// likes, buried in a dead thread" complaint; (2) keep the list varied, so no
// single prolific author dominates; (3) surface posts with real, fresh traction
// first, but on a log scale so a couple of viral posts don't crowd out smaller,
// more on-point ones. Posts we couldn't enrich are kept (shown without metrics),
// never dropped, so an upstream hiccup can't empty the list. If nothing clears
// the visibility bar we relax and show the best of what was found rather than
// returning nothing.
export function selectDiscoveries(candidates, enrichMap, opts = {}) {
  const limit = opts.limit || 6;
  const minLikes = opts.minLikes ?? 3;
  const map = enrichMap instanceof Map ? enrichMap : new Map();

  // null = unknown metrics (neither passes nor fails the bar).
  const visibility = (m) => {
    if (!m) return null;
    const likes = m.likes || 0;
    const replies = m.replies || 0;
    const views = m.views || 0;
    return likes >= minLikes || replies >= 2 || views >= 800;
  };

  const score = (m) => {
    if (!m) return 0;
    const likes = m.likes || 0;
    const replies = m.replies || 0;
    const views = m.views || 0;
    // Active conversation (replies) weighs a touch more than raw likes; views
    // are a weak tiebreak. Log scale keeps viral outliers from dominating.
    return Math.log10(1 + likes) + Math.log10(1 + replies) * 1.3 + Math.log10(1 + views) * 0.4;
  };

  const merged = (Array.isArray(candidates) ? candidates : []).map((c) => {
    const m = map.get(c.url) || null;
    return {
      ...c,
      handle: (m && m.handle) || c.handle || "",
      authorName: (m && m.authorName) || "",
      verified: Boolean(m && m.verified),
      avatar: (m && m.avatar) || "",
      likes: m ? m.likes : null,
      replies: m ? m.replies : null,
      reposts: m ? m.reposts : null,
      views: m ? m.views : null,
      postedAt: m ? m.postedAt : null,
      _m: m
    };
  });

  const live = merged.filter((c) => !(c._m && c._m.deleted));

  const visible = [];
  const unknown = [];
  const dim = [];
  for (const c of live) {
    const v = visibility(c._m);
    if (v === true) visible.push(c);
    else if (v === null) unknown.push(c);
    else dim.push(c);
  }
  const byScore = (a, b) => score(b._m) - score(a._m);
  visible.sort(byScore);
  dim.sort(byScore);

  const taken = [];
  const seenHandles = new Set();
  // First pass: one post per author, for variety.
  const fillVaried = (pool) => {
    for (const c of pool) {
      if (taken.length >= limit) break;
      const h = (c.handle || "").toLowerCase();
      if (h && seenHandles.has(h)) continue;
      if (h) seenHandles.add(h);
      taken.push(c);
    }
  };
  fillVaried(visible);
  if (taken.length < limit) fillVaried(unknown);
  // Second pass: relax the one-per-author rule to fill remaining slots.
  if (taken.length < limit) {
    for (const c of [...visible, ...unknown]) {
      if (taken.length >= limit) break;
      if (!taken.includes(c)) taken.push(c);
    }
  }
  // Last resort: nothing cleared the visibility bar — show the best low-
  // engagement posts rather than an empty list.
  if (taken.length === 0) taken.push(...dim.slice(0, limit));

  return taken.slice(0, limit).map(({ _m, ...rest }) => rest);
}
