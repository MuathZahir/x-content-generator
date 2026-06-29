// Penn AI background service worker.
// All model calls go through the hosted Penn AI API, which holds the
// provider key server-side. The extension never stores or sends an OpenAI
// key. The user's profile lives only in chrome.storage.local and is sent
// per-request, never persisted by the server.

const API_BASE = "https://heypenn.com";

const SETTINGS_DEFAULTS = {
  model: "gpt-5.4",
  mockMode: false,
  feedGrounding: true,
  webSearch: false,
  profile: "",
  products: "",
  productList: [],
  voice: "",
  forbidden: "",
  badExamples: ""
};

const AUTH_DEFAULTS = {
  apiToken: "",
  pendingPairing: null
};

// --- Products ----------------------------------------------------------------

// productList entries: { id, name, description, link, mention, media: [{ type, dataUrl, name }] }
function formatProductBlock(product) {
  if (!product) return "";
  const parts = [String(product.name || "").trim()];
  const description = String(product.description || "").trim();
  if (description) parts.push(description);
  const link = String(product.link || "").trim();
  if (link) parts.push(`Link: ${link}`);
  const mention = String(product.mention || "").trim();
  if (mention) parts.push(`Mention only when: ${mention}`);
  return parts.filter(Boolean).join("\n");
}

// Structured products win; the legacy free-text field is the fallback so old
// profiles keep working untouched.
function getProductsText(settings) {
  const list = Array.isArray(settings.productList) ? settings.productList : [];
  const blocks = list.map(formatProductBlock).filter(Boolean);
  if (blocks.length) return blocks.join("\n\n");
  return String(settings.products || "");
}

function findProduct(settings, productId) {
  if (!productId) return null;
  const list = Array.isArray(settings.productList) ? settings.productList : [];
  return list.find((product) => product && product.id === productId) || null;
}

// The server-bound profile payload. Field names match the hosted API
// contract; the raw thread/profile text is never logged or stored there.
function buildProfilePayload(settings) {
  return {
    context: String(settings.profile || ""),
    products: getProductsText(settings),
    voice: String(settings.voice || ""),
    forbidden: String(settings.forbidden || ""),
    badExamples: String(settings.badExamples || "")
  };
}

// --- Output guards (belt and braces; the server enforces the same policy) ----

// Hard guard against the em/en dash tell, plus a few mechanical AI artifacts,
// regardless of what comes back.
function sanitizeReplyText(text) {
  return String(text)
    .replace(/\s*[—–]\s*/g, ", ") // em / en dash -> comma
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getForbiddenTerms(settings) {
  const builtIn = [
    "great point",
    "this is so true",
    "couldn't agree more",
    "love this take",
    "100%",
    "game changer",
    "game-changer",
    "let that sink in",
    "plot twist",
    "at the end of the day",
    "in a world where",
    "deep dive",
    "delve",
    "well said",
    "chef's kiss",
    "living rent free",
    "say it louder"
  ];
  const custom = String(settings.forbidden || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);

  return [...builtIn, ...custom].map((term) => term.toLowerCase());
}

// Structural AI tells we can catch mechanically. Each pattern targets a
// sentence template, not a vocabulary choice, to keep false positives rare.
const AI_TELL_PATTERNS = [
  { name: "contrast flip", pattern: /\bisn'?t\s+(?:just\s+|about\s+|only\s+)?[^.,;!?]{2,60}[,.;]\s*it'?s\b/i },
  { name: "contrast flip", pattern: /\b(?:is|are|was|were)\s+not\s+(?:just\s+|about\s+|only\s+)?[^.,;!?]{2,60}[,.;]\s*(?:it|that|this|they)\b/i },
  { name: "contrast flip", pattern: /\byou'?re not\s+[^.,;!?]{2,60}[,.;]\s*you'?re\b/i },
  { name: "contrast flip", pattern: /\bnot (?:just|only|about) [^.,;!?]{2,60}[,.;]\s*(?:it'?s|that'?s|they'?re)\b/i },
  { name: "contrast flip", pattern: /\bmore than just\b/i },
  { name: "contrast flip", pattern: /\bless about [^.,;!?]{2,60}more about\b/i },
  { name: "contrast flip", pattern: /, and then there'?s /i },
  { name: "setup-payoff opener", pattern: /\bhere'?s (?:the thing|what|why|how)\b/i },
  { name: "forced wrap-up", pattern: /\b(?:in conclusion|bottom line|the takeaway)\b/i }
];

// Bare host of a URL, lowercased and without a leading "www.". Returns "" for
// anything that does not parse as a URL.
function linkHost(rawUrl) {
  try {
    const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

const LINK_RE = /https?:\/\/[^\s)]+|\bwww\.[^\s)]+/gi;

function extractHosts(text) {
  const hosts = [];
  for (const match of String(text || "").match(LINK_RE) || []) {
    const host = linkHost(match);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

// Hosts the reply path may link to: the user's own products. Mirrors the
// server, which derives the same set from the products text it receives.
function getProductHosts(settings) {
  return extractHosts(getProductsText(settings));
}

function violatesReplyPolicy(text, settings, { allowLinks = false, allowedHosts = [] } = {}) {
  const normalized = text.toLowerCase();
  if (/#\w+/.test(text)) return "hashtags are disabled";
  if (!allowLinks) {
    const offending = (String(text).match(LINK_RE) || []).some((link) => {
      const host = linkHost(link);
      return !host || !allowedHosts.includes(host);
    });
    if (offending) return "links are disabled";
  }

  const tell = AI_TELL_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (tell) return `AI tell: ${tell.name}`;

  const term = getForbiddenTerms(settings).find((forbidden) => normalized.includes(forbidden));
  return term ? `forbidden phrase: ${term}` : "";
}

function enforceReplyPolicy(result, { settings, allowLinks = false, allowedHosts = [] }) {
  const options = result.options
    .map((option) => ({ ...option, text: sanitizeReplyText(option.text) }))
    .filter((option) => !violatesReplyPolicy(option.text, settings, { allowLinks, allowedHosts }));

  if (options.length < 3) {
    throw new Error("Generated replies violated too many safety rules. Try again.");
  }

  return {
    ...result,
    options
  };
}

// --- Mock generators (offline QA, also used by store reviewers) ---------------

function generateMockReplies({ threadText }) {
  const mention = /agent|workflow|spec|requirement|verification|developer|code/i.test(threadText);

  return {
    relevance_gate: {
      mention_product: mention,
      reason: mention
        ? "The visible thread is about agent workflows or implementation quality."
        : "The visible thread does not clearly justify a product mention.",
      mention_style: mention ? "Personal example, not promotion." : "Do not mention a product."
    },
    options: [
      {
        label: "dry",
        text: "the part nobody budgets for is how long you spend deciding what done even means"
      },
      {
        label: "question",
        text: "what are you checking before you trust the output?"
      },
      {
        label: "blunt",
        text: mention
          ? "spec first, then let the agent run. i kept losing hours until i did that"
          : "fast is easy. fast and right is the whole game"
      }
    ]
  };
}

function generateMockPost({ idea, product }) {
  const topic = String(idea || "this").trim().slice(0, 80) || "this";

  if (product) {
    const name = String(product.name || "my project").trim();
    return {
      options: [
        { label: "builder", text: `spent the morning watching people use ${name} wrong and honestly the fix was a better empty state, not more docs` },
        { label: "lesson", text: `${name} taught me that the feature i was proudest of is the one nobody touches` },
        { label: "result", text: `someone used ${name} for a thing i never designed it for and it worked. shipping beats planning again` }
      ]
    };
  }

  return {
    options: [
      { label: "hook", text: `spent the week on ${topic} and the thing nobody tells you is how much of it is just deciding what to ignore` },
      { label: "take", text: `hot take on ${topic}: the tooling is fine, the hard part was always knowing what good looks like` },
      { label: "story", text: `tried ${topic} again after writing it off last year. it is genuinely different now and i feel a little dumb for waiting` }
    ]
  };
}

function mockRefine({ currentText, instruction }) {
  const tweak = String(instruction || "").trim();
  return { text: `${currentText} (${tweak || "refined"})` };
}

// Offline sample candidates for QA and store review. No network, no search key.
function generateMockDiscover({ product }) {
  const name = String(product?.name || "your product").trim() || "your product";
  return {
    query: `Recent X posts where someone could use ${name}`,
    candidates: [
      {
        url: "https://x.com/example/status/1000000000000000001",
        handle: "@builder_dev",
        authorName: "Dana — building in public",
        verified: true,
        avatar: "",
        likes: 142,
        replies: 28,
        reposts: 9,
        views: 18400,
        postedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        snippet: "anyone got a tool that actually keeps an AI agent on spec? mine keeps drifting halfway through",
        why: "Directly asking for a tool in exactly this space.",
        angle: `Answer with your own experience first; ${name} fits as a plain recommendation.`
      },
      {
        url: "https://x.com/example/status/1000000000000000002",
        handle: "@indiehacker",
        authorName: "Marco Reyes",
        verified: false,
        avatar: "",
        likes: 37,
        replies: 6,
        reposts: 1,
        views: 5200,
        postedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
        snippet: "spent the whole day cleaning up agent output instead of shipping. there has to be a better way",
        why: "Venting the exact pain point the product touches.",
        angle: "Share the firsthand fix; mention the product only if it lands naturally."
      }
    ]
  };
}

function generateMockProduct({ url, text }) {
  const seed = String(text || url || "").trim();
  const guess = seed
    ? seed.replace(/^https?:\/\//, "").split(/[\/\s]/)[0] || "Sample Product"
    : "Sample Product";
  return {
    product: {
      name: guess.slice(0, 60),
      description: "A maker tool that helps a specific audience get a job done faster. (Mock extraction; edit before saving.)",
      mention: "threads where someone describes the exact problem this product solves"
    },
    lowConfidence: false
  };
}

// --- Hosted API ----------------------------------------------------------------

async function getAuth() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return { ...AUTH_DEFAULTS };
  return chrome.storage.local.get(AUTH_DEFAULTS);
}

async function setAuth(values) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set(values);
}

class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const SIGN_IN_MESSAGE = "Sign in to Penn AI: click the Penn AI icon in your toolbar.";

async function apiFetch(path, { method = "POST", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError("network", "Could not reach Penn AI. Check your connection and try again.", 0);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const code = data?.error?.code || "request_failed";
    const message = data?.error?.message || `Request failed (${response.status}).`;
    throw new ApiError(code, message, response.status);
  }

  return data;
}

async function requireToken() {
  const auth = await getAuth();
  if (auth.apiToken) return auth.apiToken;

  // A pairing may have been approved in the browser tab while the panel was
  // open; settle it before giving up.
  const claimed = await tryClaimPairing(auth);
  if (claimed) return claimed;

  throw new ApiError("unauthorized", SIGN_IN_MESSAGE, 401);
}

async function authedApi(path, body) {
  const token = await requireToken();
  try {
    return await apiFetch(path, { body, token });
  } catch (error) {
    if (error.status === 401) {
      await setAuth({ apiToken: "" });
      throw new ApiError("unauthorized", SIGN_IN_MESSAGE, 401);
    }
    throw error;
  }
}

// --- Sign-in (device pairing) ----------------------------------------------------

async function tryClaimPairing(auth) {
  const pending = auth?.pendingPairing;
  if (!pending || !pending.code || !pending.secret) return "";
  if (pending.startedAt && Date.now() - pending.startedAt > 15 * 60 * 1000) {
    await setAuth({ pendingPairing: null });
    return "";
  }

  try {
    const data = await apiFetch("/v1/device/claim", {
      body: { code: pending.code, secret: pending.secret }
    });
    if (data?.token) {
      await setAuth({ apiToken: data.token, pendingPairing: null });
      return data.token;
    }
  } catch {
    // Claim is best-effort; the next status check retries.
  }
  return "";
}

async function startSignIn() {
  const pairing = await apiFetch("/v1/device/new", { body: {} });
  await setAuth({
    apiToken: "",
    pendingPairing: { code: pairing.code, secret: pairing.secret, startedAt: Date.now() }
  });

  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    await chrome.tabs.create({ url: `${API_BASE}/connect?code=${encodeURIComponent(pairing.code)}` });
  }

  // Poll while the worker stays alive; the popup and any generation attempt
  // also try to settle the claim, so a sleeping worker is not fatal.
  pollPairing();
  return { ok: true };
}

let pollTimer = null;
function pollPairing(attempt = 0) {
  if (pollTimer) clearTimeout(pollTimer);
  if (attempt > 120) return;
  pollTimer = setTimeout(async () => {
    const auth = await getAuth();
    if (!auth.pendingPairing || auth.apiToken) return;
    const token = await tryClaimPairing(auth);
    if (!token) pollPairing(attempt + 1);
  }, 2500);
}

async function getAccount() {
  const auth = await getAuth();

  let token = auth.apiToken;
  if (!token) token = await tryClaimPairing(auth);
  if (!token) {
    return { signedIn: false, pending: Boolean(auth.pendingPairing) };
  }

  try {
    const me = await apiFetch("/v1/me", { method: "GET", token });
    return { signedIn: true, ...me };
  } catch (error) {
    if (error.status === 401) {
      await setAuth({ apiToken: "" });
      return { signedIn: false, pending: false };
    }
    throw error;
  }
}

async function signOut() {
  const auth = await getAuth();
  if (auth.apiToken) {
    try {
      await apiFetch("/v1/signout", { body: {}, token: auth.apiToken });
    } catch {
      // Token revocation is best-effort; local sign-out always succeeds.
    }
  }
  await setAuth({ apiToken: "", pendingPairing: null });
  return { ok: true };
}

async function openPage({ page }) {
  const paths = {
    upgrade: "/upgrade",
    portal: "/portal",
    privacy: "/privacy",
    connect: "/connect"
  };
  const path = paths[page] || "/";
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    await chrome.tabs.create({ url: `${API_BASE}${path}` });
  }
  return { ok: true };
}

// --- Generation -------------------------------------------------------------------

async function generateReplies({ note, threadText, images }) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  // Replies may carry the user's own product link, never an arbitrary one.
  const allowedHosts = getProductHosts(settings);
  if (settings.mockMode) {
    return enforceReplyPolicy(generateMockReplies({ note, threadText }), { settings, allowedHosts });
  }

  const result = await authedApi("/v1/generate", {
    note,
    threadText,
    images,
    model: settings.model || SETTINGS_DEFAULTS.model,
    profile: buildProfilePayload(settings)
  });

  return enforceReplyPolicy(result, { settings, allowedHosts });
}

async function generatePost({ idea, feed, trends, productId }) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  const product = findProduct(settings, productId);

  if (settings.mockMode) {
    return enforceReplyPolicy(generateMockPost({ idea, product }), { settings, allowLinks: true });
  }

  if (productId && !product) {
    throw new Error("That product no longer exists. Pick another in the panel.");
  }

  const result = await authedApi("/v1/compose", {
    idea,
    feed: settings.feedGrounding ? feed : [],
    trends: settings.feedGrounding ? trends : [],
    feedGrounding: Boolean(settings.feedGrounding),
    webSearch: Boolean(settings.webSearch),
    model: settings.model || SETTINGS_DEFAULTS.model,
    product: product
      ? {
          name: product.name,
          description: product.description,
          link: product.link,
          mention: product.mention,
          media: Array.isArray(product.media) ? product.media.slice(0, 4) : []
        }
      : null,
    profile: buildProfilePayload(settings)
  });

  // Compose/Promote posts may include the user's own product link; mirror the
  // server's allowLinks so the client filter doesn't reject what the server kept.
  return enforceReplyPolicy(result, { settings, allowLinks: true });
}

async function refineDraft({ kind, currentText, instruction, baseContext, images, history }) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);

  let text;
  if (settings.mockMode) {
    text = mockRefine({ currentText, instruction }).text;
  } else {
    const result = await authedApi("/v1/refine", {
      kind,
      currentText,
      instruction,
      baseContext,
      images,
      history,
      model: settings.model || SETTINGS_DEFAULTS.model,
      profile: buildProfilePayload(settings)
    });
    text = result.text;
  }

  const cleaned = sanitizeReplyText(text);
  const violation = violatesReplyPolicy(cleaned, settings, {
    allowLinks: kind === "post",
    allowedHosts: getProductHosts(settings)
  });
  if (violation) {
    throw new Error(`Refined draft broke a rule (${violation}). Try a different instruction.`);
  }

  return { text: cleaned };
}

// Reads a product page (or pasted text) via the hosted API and returns
// { product: { name, description, mention }, lowConfidence } for the options
// page to drop into the product editor for review.
async function extractProduct({ url, text }) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  if (settings.mockMode) {
    return generateMockProduct({ url, text });
  }
  return authedApi("/v1/extract", { url: url || "", text: text || "" });
}

// Finds X posts worth replying to about one of the user's products. The hosted
// API holds the search key and does the search + ranking; this just resolves
// the chosen product from local storage and passes it through. Results are
// returned to the panel and never persisted (no lead list, no monitor).
async function discoverPosts({ productId }) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  const product = findProduct(settings, productId);

  if (settings.mockMode) {
    return generateMockDiscover({ product });
  }

  if (!product) {
    throw new Error("That product no longer exists. Pick another in the panel.");
  }

  return authedApi("/v1/discover", {
    product: {
      name: product.name,
      description: product.description,
      link: product.link,
      mention: product.mention
    },
    model: settings.model || SETTINGS_DEFAULTS.model,
    profile: buildProfilePayload(settings)
  });
}

// --- Messaging --------------------------------------------------------------

const HANDLERS = {
  "pennai.generate": generateReplies,
  "pennai.compose": generatePost,
  "pennai.refine": refineDraft,
  "pennai.extract": extractProduct,
  "pennai.discover": discoverPosts,
  "pennai.account": getAccount,
  "pennai.signin": startSignIn,
  "pennai.signout": signOut,
  "pennai.open": openPage
};

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = HANDLERS[message?.type];
    if (!handler) return false;

    handler(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code || "" }));

    return true;
  });
}

if (typeof chrome !== "undefined" && chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "suggest-replies") return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, { type: "pennai.shortcut" });
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    API_BASE,
    buildProfilePayload,
    discoverPosts,
    enforceReplyPolicy,
    extractProduct,
    findProduct,
    formatProductBlock,
    generateMockDiscover,
    generateMockPost,
    generateMockProduct,
    generateMockReplies,
    generatePost,
    generateReplies,
    getAccount,
    getProductsText,
    mockRefine,
    refineDraft,
    sanitizeReplyText,
    signOut,
    startSignIn,
    violatesReplyPolicy
  };
}
