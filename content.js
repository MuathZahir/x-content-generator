const COMPOSER_SELECTOR = '[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]';
const MAX_POSTS = 4;
const MAX_IMAGES = 4;
const MAX_FEED = 12;
const MAX_TRENDS = 10;

const state = {
  panel: null,
  els: null,
  bubble: null,
  dismissed: false,
  activeComposer: null,
  lastContext: null,
  tab: "assist",
  view: "reply",
  composeMode: "grow",
  draft: null,
  discover: null
};

function findComposer(node) {
  return node.closest(COMPOSER_SELECTOR);
}

function getAllComposers() {
  return Array.from(document.querySelectorAll(COMPOSER_SELECTOR))
    .map((node) => findComposer(node))
    .filter(Boolean);
}

// --- Context extraction -----------------------------------------------------

function nodeContains(node, target) {
  return typeof node.contains === "function" ? node.contains(target) : false;
}

// DOCUMENT_POSITION_PRECEDING === 2. We avoid referencing the global Node
// constant so this also runs under the lightweight DOM test harness.
function isBefore(node, reference) {
  if (typeof reference.compareDocumentPosition === "function") {
    return Boolean(reference.compareDocumentPosition(node) & 2);
  }
  return true;
}

function upgradeImageUrl(url) {
  try {
    const parsed = new URL(url, "https://x.com");
    if (parsed.hostname.includes("pbs.twimg.com") && parsed.searchParams.has("name")) {
      parsed.searchParams.set("name", "large");
    }
    return parsed.toString();
  } catch (error) {
    return url;
  }
}

function getPostImages(article) {
  const nodes = article.querySelectorAll(
    '[data-testid="tweetPhoto"] img, [data-testid="card.layoutLarge.media"] img, [data-testid="card.layoutSmall.media"] img'
  );
  const urls = [];
  for (const img of nodes) {
    const src = img.getAttribute ? img.getAttribute("src") : img.src;
    if (!src || !/^https?:/.test(src)) continue;
    const upgraded = upgradeImageUrl(src);
    if (!urls.includes(upgraded)) urls.push(upgraded);
  }
  return urls;
}

function cleanInnerText(raw) {
  // Fallback when X structured testids are unavailable: drop the obvious
  // chrome (engagement counts, single-word action labels, timestamps).
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(reply|repost|like|view|views|bookmark|share|follow|·|show more|translate post|quote)$/i.test(line))
    .filter((line) => !/^\d+(\.\d+)?[km]?$/i.test(line))
    .join("\n");
}

function parsePost(article) {
  const nameEl = article.querySelector('[data-testid="User-Name"]');
  const nameText = (nameEl && nameEl.innerText ? nameEl.innerText : "").trim();
  const handleMatch = nameText.match(/@\w+/);
  const handle = handleMatch ? handleMatch[0] : "";
  const display = (nameText.split("\n")[0] || "").trim();

  const textNodes = article.querySelectorAll('[data-testid="tweetText"]');
  let text = Array.from(textNodes)
    .map((el) => (el.innerText || "").trim())
    .filter(Boolean)
    .join("\n");

  if (!text) {
    text = cleanInnerText(article.innerText).slice(0, 1200);
  }

  return { display, handle, text: text.slice(0, 1500), images: getPostImages(article) };
}

function getThreadContext(composer) {
  const empty = { posts: [], text: "", images: [], replyingTo: "", surface: "compose" };
  if (!composer) return empty;

  // Scope to the reply dialog when present (timeline "Reply" modal), otherwise
  // the main column.
  const dialog = composer.closest('[role="dialog"]');
  const scope =
    dialog ||
    document.querySelector('[data-testid="primaryColumn"]') ||
    document.querySelector("main") ||
    document;

  const articles = Array.from(scope.querySelectorAll("article"));
  const candidates = articles.filter((article) => !nodeContains(article, composer));
  // Only posts that actually precede the composer count as "being replied to".
  // A top-level compose box (home, the Post modal) has none, so surface=compose.
  const preceding = candidates.filter((article) => isBefore(article, composer));
  const chosen = preceding.slice(-MAX_POSTS);

  const posts = chosen.map(parsePost).filter((post) => post.text || post.images.length);

  const images = [];
  for (const post of posts) {
    for (const url of post.images) {
      if (images.length < MAX_IMAGES && !images.includes(url)) images.push(url);
    }
  }

  const text = posts
    .map((post) => {
      const who = [post.display, post.handle].filter(Boolean).join(" ");
      const head = who ? `${who}:` : "Post:";
      const media = post.images.length ? `\n[${post.images.length} image(s) attached]` : "";
      return `${head}\n${post.text}${media}`.trim();
    })
    .join("\n\n---\n\n")
    .slice(0, 6000);

  const replyingTo = posts.length ? posts[posts.length - 1].handle : "";
  const surface = posts.length ? "reply" : "compose";

  return { posts, text, images, replyingTo, surface };
}

// --- Home feed + trends (compose grounding) ---------------------------------

function getHomeFeed(limit = MAX_FEED) {
  const scope =
    document.querySelector('[data-testid="primaryColumn"]') ||
    document.querySelector("main") ||
    document;
  const active = state.activeComposer;
  const feed = [];
  for (const article of Array.from(scope.querySelectorAll("article"))) {
    if (active && nodeContains(article, active)) continue;
    const post = parsePost(article);
    if (!post.text) continue;
    feed.push({ display: post.display, handle: post.handle, text: post.text.slice(0, 280) });
    if (feed.length >= limit) break;
  }
  return feed;
}

function getTrends(limit = MAX_TRENDS) {
  const trends = [];
  for (const node of Array.from(document.querySelectorAll('[data-testid="trend"]'))) {
    const lines = String(node.innerText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const topic = lines.find((line) => !/trending|·|posts$|^\d|promoted/i.test(line)) || lines[0] || "";
    if (topic && !trends.includes(topic)) trends.push(topic);
    if (trends.length >= limit) break;
  }
  return trends;
}

// --- Composer insertion -----------------------------------------------------

function insertReply(composer, text) {
  if (!composer) return;
  composer.focus();

  // Select all existing content so the paste replaces it (rather than appending).
  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Could not select the composer.");
  }
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection.removeAllRanges();
  selection.addRange(range);

  // Insert via a synthetic paste event rather than execCommand("insertText").
  // X's composer is a Draft.js contenteditable: execCommand writes straight to
  // the DOM, but Draft.js also inserts its own model-managed copy in response,
  // leaving two copies where only one is tracked by its EditorState (delete the
  // tracked one and the placeholder reappears behind the orphaned DOM copy).
  // Routing the text through the editor's own paste pipeline keeps model + DOM
  // in sync, and a synthetic (untrusted) ClipboardEvent triggers no browser
  // default paste — so the text lands exactly once.
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", text);
  const pasteEvent = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: dataTransfer,
  });
  composer.dispatchEvent(pasteEvent);
}

async function copyReply(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed.");
    }
  } finally {
    textarea.remove();
  }
}

// --- Background messaging ----------------------------------------------------

async function sendToBackground(payload, fallbackError) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) {
    // Carry the stable error code (e.g. free_limit_reached, upgrade_required,
    // unauthorized) so the panel can offer the right next step, not just text.
    const error = new Error(response?.error || fallbackError);
    error.code = response?.code || "";
    throw error;
  }
  return response.result;
}

function generateReplies({ note, threadText, images }) {
  return sendToBackground(
    { type: "pennai.generate", note, threadText, images },
    "Reply generation failed."
  );
}

function sendCompose({ idea, feed, trends, productId }) {
  return sendToBackground(
    { type: "pennai.compose", idea, feed, trends, productId },
    "Post generation failed."
  );
}

function sendRefine({ kind, currentText, instruction, baseContext, images, history }) {
  return sendToBackground(
    { type: "pennai.refine", kind, currentText, instruction, baseContext, images, history },
    "Refine failed."
  );
}

function sendDiscover({ productId }) {
  return sendToBackground(
    { type: "pennai.discover", productId },
    "Could not find posts right now."
  );
}

// --- Panel rendering --------------------------------------------------------

function showMessage(output, text, className = "pennai-error") {
  const message = document.createElement("div");
  message.className = className;
  message.textContent = text;
  output.appendChild(message);
}

function openExtensionPage(page) {
  chrome.runtime.sendMessage({ type: "pennai.open", page });
}

// Renders an error plus the one action that resolves it, so a free user out of
// generations or on the wrong plan gets an Upgrade button (not a dead red box),
// and a lapsed session gets a Sign in button.
function showGenerationError(output, error) {
  const code = error?.code || "";
  if (code === "free_limit_reached" || code === "upgrade_required") {
    showMessage(output, error.message);
    addCtaButton(output, "Upgrade to Pro", () => openExtensionPage("upgrade"));
    return;
  }
  if (code === "unauthorized") {
    showMessage(output, error.message);
    addCtaButton(output, "Sign in", () => chrome.runtime.sendMessage({ type: "pennai.signin" }));
    return;
  }
  showMessage(output, error.message);
}

function addCtaButton(output, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pennai-cta";
  button.textContent = label;
  button.addEventListener("click", onClick);
  output.appendChild(button);
}

function describeContext(context) {
  if (!context || (!context.posts.length && !context.images.length)) {
    return "No nearby post detected.";
  }
  const postLabel = `${context.posts.length} post${context.posts.length === 1 ? "" : "s"}`;
  const imageLabel = context.images.length
    ? ` · ${context.images.length} image${context.images.length === 1 ? "" : "s"}`
    : "";
  return `${postLabel}${imageLabel}`;
}

// Top-level tabs. "assist" is the existing reply/compose/iterate flow (it still
// auto-switches with the composer context); "discover" is the standalone
// find-posts surface, which is not tied to any composer.
function setTab(tab) {
  if (!state.els) return;
  state.tab = tab;
  const { assistNav, discoverNav, discoverGroup, replyingTo } = state.els;
  assistNav.classList.toggle("pennai-tab-active", tab === "assist");
  discoverNav.classList.toggle("pennai-tab-active", tab === "discover");
  discoverGroup.classList.toggle("pennai-hidden", tab !== "discover");
  replyingTo.classList.toggle("pennai-hidden", tab !== "assist");

  if (tab === "assist") {
    // Restore whichever assist view was active before the user left.
    setView(state.draft ? "iterate" : state.view);
  } else {
    // Hide every assist group; setView is short-circuited while we're away.
    const { replyGroup, composeGroup, iterateGroup, output } = state.els;
    replyGroup.classList.toggle("pennai-hidden", true);
    composeGroup.classList.toggle("pennai-hidden", true);
    iterateGroup.classList.toggle("pennai-hidden", true);
    output.classList.toggle("pennai-hidden", true);
    enterDiscover();
  }
}

function setView(view) {
  if (!state.els) return;
  state.view = view;
  // While the Discover tab is open it owns panel visibility; just remember the
  // intended assist view so switching back restores it.
  if (state.tab !== "assist") return;
  const { replyGroup, composeGroup, iterateGroup, output, replyingTo } = state.els;
  replyGroup.classList.toggle("pennai-hidden", view !== "reply");
  composeGroup.classList.toggle("pennai-hidden", view !== "compose");
  iterateGroup.classList.toggle("pennai-hidden", view !== "iterate");
  output.classList.toggle("pennai-hidden", view === "iterate");

  if (view === "compose") {
    replyingTo.textContent = state.composeMode === "promote" ? "Promote a product" : "New post";
  } else if (view === "iterate") {
    replyingTo.textContent = "Refining draft";
  }
}

const COMPOSE_PLACEHOLDERS = {
  grow: "What do you want to post about? A rough idea is enough.",
  promote: "Optional angle: launch, lesson learned, a real result, behind the scenes…"
};

function setComposeMode(mode) {
  state.composeMode = mode;
  if (!state.els) return;
  const { growTab, promoteTab, productSelect, idea, replyingTo } = state.els;
  growTab.classList.toggle("pennai-segment-active", mode === "grow");
  promoteTab.classList.toggle("pennai-segment-active", mode === "promote");
  productSelect.classList.toggle("pennai-hidden", mode !== "promote");
  idea.placeholder = COMPOSE_PLACEHOLDERS[mode] || COMPOSE_PLACEHOLDERS.grow;
  if (state.view === "compose") {
    replyingTo.textContent = mode === "promote" ? "Promote a product" : "New post";
  }
  if (mode === "promote") populateProducts();
}

async function populateProducts(select = state.els?.productSelect) {
  if (!select) return;

  let products = [];
  try {
    const stored = await chrome.storage.local.get({ productList: [] });
    products = Array.isArray(stored.productList) ? stored.productList : [];
  } catch (error) {
    products = [];
  }

  const previous = select.value;
  select.textContent = "";
  if (!products.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No products yet — create one in Settings";
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const product of products) {
    const option = document.createElement("option");
    option.value = product.id;
    option.textContent = product.name;
    select.appendChild(option);
  }
  if (previous && products.some((product) => product.id === previous)) {
    select.value = previous;
  }
}

function updateContextPreview(composer) {
  const context = getThreadContext(composer);
  state.lastContext = context;

  if (state.els?.preview) {
    state.els.preview.textContent = context.text || "No nearby post text detected.";
  }
  if (state.els?.contextSummary) {
    state.els.contextSummary.textContent = `Context · ${describeContext(context)}`;
  }

  // Never yank the user out of an in-progress refine.
  if (state.draft) return context;

  setView(context.surface);
  if (context.surface === "reply" && state.els?.replyingTo) {
    state.els.replyingTo.textContent = context.replyingTo
      ? `Replying to ${context.replyingTo}`
      : "Replying to this post";
  }

  return context;
}

function setActiveComposer(composer) {
  const changed = composer && composer !== state.activeComposer;
  state.activeComposer = composer || null;
  if (!composer) return;
  if (changed && state.els && !state.draft) state.els.output.textContent = "";
  updateContextPreview(composer);
}

function renderOption(output, option, refineContext) {
  const item = document.createElement("div");
  item.className = "pennai-option";

  if (option.label) {
    const label = document.createElement("div");
    label.className = "pennai-option-label";
    label.textContent = option.label;
    item.appendChild(label);
  }

  const text = document.createElement("div");
  text.className = "pennai-option-text";
  text.textContent = option.text;

  let over = null;
  if (String(option.text || "").length > 280) {
    over = document.createElement("div");
    over.className = "pennai-overlimit";
    over.textContent = `${option.text.length} / 280, too long. Refine it shorter.`;
  }

  const actions = document.createElement("div");
  actions.className = "pennai-option-actions";

  const insertButton = document.createElement("button");
  insertButton.type = "button";
  insertButton.textContent = "Insert";
  insertButton.addEventListener("click", () => {
    if (!state.activeComposer) {
      showMessage(output, "Click into the X composer first, then Insert.");
      return;
    }
    insertReply(state.activeComposer, option.text);
  });

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "pennai-ghost";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async () => {
    try {
      await copyReply(option.text);
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1400);
    } catch (error) {
      showMessage(output, "Copy failed. Use Insert or select the text manually.");
    }
  });

  actions.append(insertButton, copyButton);

  if (refineContext) {
    const refineButton = document.createElement("button");
    refineButton.type = "button";
    refineButton.className = "pennai-ghost";
    refineButton.textContent = "Refine";
    refineButton.addEventListener("click", () => enterIterate({ ...refineContext, currentText: option.text }));
    actions.appendChild(refineButton);
  }

  if (over) item.append(text, over, actions);
  else item.append(text, actions);
  output.appendChild(item);
}

async function requestSuggestions({ context }) {
  if (!state.els) return;
  const { note, suggest, output } = state.els;
  suggest.disabled = true;
  suggest.classList.toggle("pennai-loading", true);
  suggest.textContent = "Thinking…";
  output.textContent = "";

  try {
    const result = await generateReplies({
      note: note ? note.value : "",
      threadText: context.text,
      images: context.images
    });

    const gate = document.createElement("div");
    gate.className = "pennai-gate";
    if (result.relevance_gate?.mention_product) {
      gate.classList.toggle("pennai-gate-on", true);
      gate.textContent = `Product mention: yes — ${result.relevance_gate?.reason || ""}`.trim();
    } else {
      gate.textContent = `Product mention: no — ${result.relevance_gate?.reason || "not relevant here."}`.trim();
    }
    output.appendChild(gate);

    const refineContext = { surface: "reply", kind: "reply", baseContext: context.text, images: context.images };
    for (const option of result.options || []) {
      renderOption(output, option, refineContext);
    }
  } catch (error) {
    showGenerationError(output, error);
  } finally {
    suggest.disabled = false;
    suggest.classList.toggle("pennai-loading", false);
    suggest.textContent = "Suggest replies";
  }
}

async function composeDrafts() {
  if (!state.els) return;
  const { idea, write, output, productSelect } = state.els;
  const ideaText = idea.value.trim();
  const promote = state.composeMode === "promote";
  const productId = promote ? productSelect.value : "";

  output.textContent = "";
  if (promote && !productId) {
    showMessage(output, "Create a product in Settings first, then pick it here.");
    return;
  }
  if (!promote && !ideaText) {
    showMessage(output, "Type what you want to post about first.");
    return;
  }

  write.disabled = true;
  write.classList.toggle("pennai-loading", true);
  write.textContent = "Writing…";

  try {
    let feed = [];
    let trends = [];
    const { feedGrounding } = await chrome.storage.local.get({ feedGrounding: true });
    if (feedGrounding) {
      feed = getHomeFeed();
      trends = getTrends();
    }

    const result = await sendCompose({ idea: ideaText, feed, trends, productId });
    const baseContext = ideaText || (promote ? `Promoting product: ${productSelect.selectedOptions?.[0]?.textContent || productId}` : "");
    const refineContext = { surface: "compose", kind: "post", baseContext, images: [] };
    for (const option of result.options || []) {
      renderOption(output, option, refineContext);
    }
  } catch (error) {
    showGenerationError(output, error);
  } finally {
    write.disabled = false;
    write.classList.toggle("pennai-loading", false);
    write.textContent = "Write post";
  }
}

// --- Discover view ----------------------------------------------------------

// Discover results are persisted so they survive navigation and new tabs: when
// you open a post (which lands you on a fresh page/tab), the list is still there
// when you come back to the Discover tab. State lives in chrome.storage.local
// (not just memory), and expires so the panel never shows a stale list forever.
const DISCOVER_KEY = "discoverState";
const DISCOVER_TTL_MS = 60 * 60 * 1000;

// When the user clicks "Open post", we drop this short-lived signal so the page
// that lands on that tweet (new tab or same-tab navigation) auto-opens Assist
// and starts generating replies. Keyed to the post's status id so only the
// right page consumes it, and it expires fast so a stale signal never fires.
const AUTO_SUGGEST_KEY = "autoSuggest";
const AUTO_SUGGEST_TTL_MS = 2 * 60 * 1000;

function statusIdFromUrl(url) {
  try {
    const match = new URL(url, "https://x.com").pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  } catch (error) {
    return "";
  }
}

async function loadDiscover() {
  try {
    const stored = await chrome.storage.local.get({ [DISCOVER_KEY]: null });
    const saved = stored[DISCOVER_KEY];
    if (!saved || !saved.ts || Date.now() - saved.ts > DISCOVER_TTL_MS) return null;
    return saved;
  } catch (error) {
    return null;
  }
}

async function persistDiscover() {
  if (!state.discover) return;
  const { productId, query, candidates, opened } = state.discover;
  try {
    await chrome.storage.local.set({
      [DISCOVER_KEY]: { productId, query, candidates, opened: [...opened], ts: Date.now() }
    });
  } catch (error) {
    // Persistence is best-effort; an in-memory list still works for this tab.
  }
}

function openPost(url) {
  // Signal the destination page (new tab or same-tab nav) to auto-open Assist
  // and start generating replies for this exact post. Set before navigating so
  // it is already in storage when the target page's content script boots.
  const statusId = statusIdFromUrl(url);
  if (statusId) {
    chrome.storage.local
      .set({ [AUTO_SUGGEST_KEY]: { statusId, ts: Date.now() } })
      .catch(() => {});
  }

  // A user click is a real gesture, so the new tab is not popup-blocked. We
  // never open a composer or submit anything on their behalf; the destination
  // page only drafts reply options the user still edits and posts manually.
  window.open(url, "_blank", "noopener");
  if (state.discover) {
    state.discover.opened.add(url);
    persistDiscover();
  }
}

// Compact engagement counts, X-style: 1.2K, 18.4K, 1.1M. Returns "" for unknown
// (a post we couldn't enrich) so the stat is simply omitted rather than shown 0.
function formatCount(value) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  const n = Number(value);
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

// Relative age for a post timestamp (ISO string or Unix epoch, seconds or ms).
// Short like X: 3h, 2d. Falls back to a month/day label past a week, "" if absent.
function relativeTime(value) {
  if (value == null) return "";
  let ms;
  if (typeof value === "number") ms = value < 1e12 ? value * 1000 : value;
  else ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return `${days}d`;
  }
}

// Inline 16px glyphs for the engagement row. Kept as SVG (not emoji) so they sit
// on the baseline and inherit the muted text color like X's own metric row.
const STAT_ICON_PATHS = {
  like: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  reply: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
  views: "M3 13h2v8H3zM10 8h2v13h-2zM17 4h2v17h-2z"
};

function statIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("pennai-stat-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", STAT_ICON_PATHS[name] || "");
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

function statChip(name, value, label) {
  const text = formatCount(value);
  if (!text) return null;
  const chip = document.createElement("span");
  chip.className = "pennai-stat";
  chip.setAttribute("aria-label", `${value} ${label}`);
  chip.appendChild(statIcon(name));
  const count = document.createElement("span");
  count.textContent = text;
  chip.appendChild(count);
  return chip;
}

// Avatar: the author's photo when we have one, else a colored monogram. The
// <img> swaps itself out for the monogram on load failure so a dead image URL
// never shows a broken-image glyph in the panel.
function renderAvatar(candidate) {
  const wrap = document.createElement("div");
  wrap.className = "pennai-avatar";

  const seed = candidate.authorName || candidate.handle || "?";
  const initial = seed.replace(/^@/, "").trim().charAt(0).toUpperCase() || "?";
  const mono = document.createElement("span");
  mono.className = "pennai-avatar-mono";
  mono.textContent = initial;
  wrap.appendChild(mono);

  if (candidate.avatar) {
    const img = document.createElement("img");
    img.className = "pennai-avatar-img";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.remove());
    img.src = candidate.avatar;
    wrap.appendChild(img);
  }
  return wrap;
}

function renderCandidate(container, candidate) {
  const opened = state.discover?.opened?.has(candidate.url);
  const card = document.createElement("div");
  card.className = opened ? "pennai-card pennai-card-visited" : "pennai-card";

  // --- Author header: avatar, name + verified, @handle, post age ---
  const header = document.createElement("div");
  header.className = "pennai-card-head";
  header.appendChild(renderAvatar(candidate));

  const ident = document.createElement("div");
  ident.className = "pennai-card-ident";

  const nameRow = document.createElement("div");
  nameRow.className = "pennai-card-namerow";
  const name = document.createElement("span");
  name.className = "pennai-card-name";
  name.textContent = candidate.authorName || candidate.handle || "Unknown";
  nameRow.appendChild(name);
  if (candidate.verified) {
    const badge = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    badge.setAttribute("viewBox", "0 0 24 24");
    badge.setAttribute("aria-label", "Verified");
    badge.classList.add("pennai-verified");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("fill", "currentColor");
    p.setAttribute("d", "M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.16-.032.322-.032.487 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.164-.012-.326-.032-.485 1.16-.688 1.943-1.99 1.943-3.487zM9.91 16.41l-3.41-3.41 1.41-1.41 2 2 4.59-4.59 1.41 1.41-6 6z");
    badge.appendChild(p);
    nameRow.appendChild(badge);
  }
  ident.appendChild(nameRow);

  const metaRow = document.createElement("div");
  metaRow.className = "pennai-card-meta";
  if (candidate.handle) {
    const handle = document.createElement("span");
    handle.className = "pennai-card-handle";
    handle.textContent = candidate.handle;
    metaRow.appendChild(handle);
  }
  const age = relativeTime(candidate.postedAt);
  if (age) {
    if (candidate.handle) {
      const dot = document.createElement("span");
      dot.className = "pennai-card-dot";
      dot.textContent = "·";
      metaRow.appendChild(dot);
    }
    const when = document.createElement("span");
    when.textContent = age;
    metaRow.appendChild(when);
  }
  if (metaRow.childElementCount) ident.appendChild(metaRow);
  header.appendChild(ident);
  card.appendChild(header);

  // --- The post itself ---
  const snippet = document.createElement("div");
  snippet.className = "pennai-card-snippet";
  snippet.textContent = candidate.snippet || "";
  card.appendChild(snippet);

  // --- Engagement row (omitted entirely when nothing was enriched) ---
  const stats = document.createElement("div");
  stats.className = "pennai-card-stats";
  const chips = [
    statChip("reply", candidate.replies, "replies"),
    statChip("like", candidate.likes, "likes"),
    statChip("views", candidate.views, "views")
  ].filter(Boolean);
  if (chips.length) {
    for (const chip of chips) stats.appendChild(chip);
    card.appendChild(stats);
  }

  // --- Why this post + how to approach it ---
  if (candidate.why) {
    const why = document.createElement("div");
    why.className = "pennai-card-why";
    why.textContent = candidate.why;
    card.appendChild(why);
  }

  if (candidate.angle) {
    const angle = document.createElement("div");
    angle.className = "pennai-card-angle";
    const tag = document.createElement("span");
    tag.className = "pennai-card-angle-tag";
    tag.textContent = "Angle";
    angle.appendChild(tag);
    angle.appendChild(document.createTextNode(candidate.angle));
    card.appendChild(angle);
  }

  const actions = document.createElement("div");
  actions.className = "pennai-card-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "pennai-ghost";
  open.textContent = opened ? "Opened ✓ · open again" : "Open post";
  open.addEventListener("click", () => {
    openPost(candidate.url);
    card.classList.add("pennai-card-visited");
    open.textContent = "Opened ✓ · open again";
  });
  actions.appendChild(open);
  card.appendChild(actions);

  container.appendChild(card);
}

// Renders the current in-memory Discover list (state.discover) into the panel.
function renderDiscoverList() {
  if (!state.els || !state.discover) return;
  const { discoverOutput } = state.els;
  discoverOutput.textContent = "";

  const hint = document.createElement("div");
  hint.className = "pennai-card-hint";
  hint.textContent = "Open a post, then reply in your own words. Penn AI helps once you're there.";
  discoverOutput.appendChild(hint);

  for (const candidate of state.discover.candidates) {
    renderCandidate(discoverOutput, candidate);
  }
}

// Called when the Discover tab is opened. Repopulates the product picker, then
// restores the last saved list (if any, and not expired) so the user can keep
// working through it after opening posts.
async function enterDiscover() {
  if (!state.els) return;
  await populateProducts(state.els.discoverProduct);

  if (!state.discover) {
    const saved = await loadDiscover();
    if (saved) {
      state.discover = {
        productId: saved.productId,
        query: saved.query,
        candidates: Array.isArray(saved.candidates) ? saved.candidates : [],
        opened: new Set(Array.isArray(saved.opened) ? saved.opened : [])
      };
    }
  }

  // Don't clobber a fresh search the user is already looking at in this tab.
  if (state.tab !== "discover") return;
  if (state.discover) {
    if (state.discover.productId) state.els.discoverProduct.value = state.discover.productId;
    if (!state.els.discoverOutput.childElementCount) renderDiscoverList();
  }
}

async function runDiscover() {
  if (!state.els) return;
  const { discoverProduct, discoverFind, discoverOutput } = state.els;
  const productId = discoverProduct.value;

  discoverOutput.textContent = "";
  if (!productId) {
    showMessage(discoverOutput, "Create a product in Settings first, then pick it here.");
    return;
  }

  discoverFind.disabled = true;
  discoverFind.classList.toggle("pennai-loading", true);
  discoverFind.textContent = "Searching…";

  try {
    const result = await sendDiscover({ productId });
    if (!result.candidates?.length) {
      showMessage(discoverOutput, "No posts worth replying to right now. Try again later.");
      return;
    }
    state.discover = {
      productId,
      query: result.query || "",
      candidates: result.candidates,
      opened: new Set()
    };
    persistDiscover();
    renderDiscoverList();
  } catch (error) {
    showGenerationError(discoverOutput, error);
  } finally {
    discoverFind.disabled = false;
    discoverFind.classList.toggle("pennai-loading", false);
    discoverFind.textContent = "Find posts";
  }
}

// --- Iterate view -----------------------------------------------------------

function updateDraftCount() {
  if (!state.els) return;
  const { draftText, draftCount } = state.els;
  const length = String(draftText.value || "").length;
  draftCount.textContent = `${length} / 280`;
  draftCount.classList.toggle("pennai-count-over", length > 280);
}

function enterIterate(seed) {
  state.draft = {
    surface: seed.surface,
    kind: seed.kind,
    baseContext: seed.baseContext || "",
    images: seed.images || [],
    currentText: seed.currentText,
    history: []
  };
  if (state.els) {
    state.els.draftText.value = seed.currentText;
    state.els.instruction.value = "";
    state.els.iterateError.textContent = "";
    updateDraftCount();
  }
  setView("iterate");
}

function exitIterate() {
  const surface = state.draft?.surface || "reply";
  state.draft = null;
  setView(surface);
}

async function runRefine() {
  if (!state.els || !state.draft) return;
  const { draftText, instruction, refine, iterateError } = state.els;
  const manual = draftText.value;
  const instr = instruction.value.trim();
  if (!instr) {
    instruction.focus();
    return;
  }

  refine.disabled = true;
  refine.classList.toggle("pennai-loading", true);
  refine.textContent = "Refining…";
  iterateError.textContent = "";

  try {
    const result = await sendRefine({
      kind: state.draft.kind,
      currentText: manual,
      instruction: instr,
      baseContext: state.draft.baseContext,
      images: state.draft.images,
      history: state.draft.history
    });
    state.draft.currentText = result.text;
    state.draft.history.push({ instruction: instr, text: result.text });
    draftText.value = result.text;
    instruction.value = "";
    updateDraftCount();
  } catch (error) {
    // Keep the previous draft untouched; just surface the problem.
    iterateError.textContent = error.message;
  } finally {
    refine.disabled = false;
    refine.classList.toggle("pennai-loading", false);
    refine.textContent = "Refine";
  }
}

function ensurePanel() {
  if (state.panel) return state.els;

  const panel = document.createElement("div");
  panel.className = "pennai-panel pennai-floating";

  // Header: brand + dismiss
  const header = document.createElement("div");
  header.className = "pennai-header";

  const brand = document.createElement("div");
  brand.className = "pennai-brand";
  const dot = document.createElement("span");
  dot.className = "pennai-dot";
  const brandName = document.createElement("span");
  brandName.textContent = "Penn AI";
  brand.append(dot, brandName);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "pennai-dismiss";
  dismiss.setAttribute("aria-label", "Hide");
  dismiss.textContent = "✕";

  header.append(brand, dismiss);
  panel.appendChild(header);

  // Top-level tabs: Assist (reply/compose) and Discover (find posts).
  const nav = document.createElement("div");
  nav.className = "pennai-nav";
  nav.setAttribute("role", "tablist");
  const assistNav = document.createElement("button");
  assistNav.type = "button";
  assistNav.className = "pennai-tab pennai-tab-active";
  assistNav.textContent = "Assist";
  const discoverNav = document.createElement("button");
  discoverNav.type = "button";
  discoverNav.className = "pennai-tab";
  discoverNav.textContent = "Discover";
  nav.append(assistNav, discoverNav);
  panel.appendChild(nav);

  const replyingTo = document.createElement("div");
  replyingTo.className = "pennai-replyingto";
  replyingTo.textContent = "No post selected yet";
  panel.appendChild(replyingTo);

  // --- Reply group (note + suggest + context preview) ---
  const replyGroup = document.createElement("div");
  replyGroup.className = "pennai-group";

  const row = document.createElement("div");
  row.className = "pennai-row";

  const note = document.createElement("input");
  note.type = "text";
  note.className = "pennai-note";
  note.setAttribute("aria-label", "Optional note to steer the reply");
  note.placeholder = "Optional: steer it (e.g. make it sarcastic)";
  row.appendChild(note);

  const suggest = document.createElement("button");
  suggest.type = "button";
  suggest.className = "pennai-suggest";
  suggest.textContent = "Suggest replies";
  row.appendChild(suggest);

  replyGroup.appendChild(row);

  const details = document.createElement("details");
  details.className = "pennai-preview";
  const summary = document.createElement("summary");
  const contextSummary = document.createElement("span");
  contextSummary.className = "pennai-context-summary";
  contextSummary.textContent = "Context · No nearby post detected.";
  summary.appendChild(contextSummary);
  details.appendChild(summary);
  const pre = document.createElement("pre");
  details.appendChild(pre);
  replyGroup.appendChild(details);

  panel.appendChild(replyGroup);

  // --- Compose group (mode + product + idea + write) ---
  const composeGroup = document.createElement("div");
  composeGroup.className = "pennai-compose pennai-hidden";

  const segment = document.createElement("div");
  segment.className = "pennai-segment";
  segment.setAttribute("role", "tablist");

  const growTab = document.createElement("button");
  growTab.type = "button";
  growTab.className = "pennai-segment-btn pennai-segment-active";
  growTab.textContent = "Grow";
  growTab.title = "Post to grow your account";

  const promoteTab = document.createElement("button");
  promoteTab.type = "button";
  promoteTab.className = "pennai-segment-btn";
  promoteTab.textContent = "Promote";
  promoteTab.title = "Post about one of your products";

  segment.append(growTab, promoteTab);
  composeGroup.appendChild(segment);

  const productSelect = document.createElement("select");
  productSelect.className = "pennai-product pennai-hidden";
  productSelect.setAttribute("aria-label", "Product to promote");
  composeGroup.appendChild(productSelect);

  const idea = document.createElement("textarea");
  idea.className = "pennai-idea";
  idea.setAttribute("aria-label", "What do you want to post about");
  idea.placeholder = COMPOSE_PLACEHOLDERS.grow;
  composeGroup.appendChild(idea);

  const write = document.createElement("button");
  write.type = "button";
  write.className = "pennai-suggest";
  write.textContent = "Write post";
  composeGroup.appendChild(write);

  panel.appendChild(composeGroup);

  // --- Iterate group (editable draft + instruction) ---
  const iterateGroup = document.createElement("div");
  iterateGroup.className = "pennai-iterate pennai-hidden";

  const draftText = document.createElement("textarea");
  draftText.className = "pennai-draft";
  draftText.setAttribute("aria-label", "Draft");
  iterateGroup.appendChild(draftText);

  const draftCount = document.createElement("div");
  draftCount.className = "pennai-count";
  iterateGroup.appendChild(draftCount);

  const iterateError = document.createElement("div");
  iterateError.className = "pennai-error pennai-iterate-error";
  iterateGroup.appendChild(iterateError);

  const iterateRow = document.createElement("div");
  iterateRow.className = "pennai-row";
  const instruction = document.createElement("input");
  instruction.type = "text";
  instruction.className = "pennai-note";
  instruction.setAttribute("aria-label", "How should I change it");
  instruction.placeholder = "make it funnier, shorter, add a stat…";
  iterateRow.appendChild(instruction);
  const refine = document.createElement("button");
  refine.type = "button";
  refine.className = "pennai-suggest";
  refine.textContent = "Refine";
  iterateRow.appendChild(refine);
  iterateGroup.appendChild(iterateRow);

  const iterateActions = document.createElement("div");
  iterateActions.className = "pennai-iterate-actions";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "pennai-back pennai-ghost";
  back.textContent = "← Back";
  const insertDraft = document.createElement("button");
  insertDraft.type = "button";
  insertDraft.textContent = "Insert";
  const copyDraft = document.createElement("button");
  copyDraft.type = "button";
  copyDraft.className = "pennai-ghost";
  copyDraft.textContent = "Copy";
  iterateActions.append(back, insertDraft, copyDraft);
  iterateGroup.appendChild(iterateActions);

  panel.appendChild(iterateGroup);

  // --- Discover group (find X posts to reply to about a product) ---
  const discoverGroup = document.createElement("div");
  discoverGroup.className = "pennai-discover pennai-hidden";

  const discoverIntro = document.createElement("div");
  discoverIntro.className = "pennai-discover-intro";
  discoverIntro.textContent = "Find recent X posts where one of your products is a genuine, helpful answer.";
  discoverGroup.appendChild(discoverIntro);

  const discoverProduct = document.createElement("select");
  discoverProduct.className = "pennai-product";
  discoverProduct.setAttribute("aria-label", "Product to find posts for");
  discoverGroup.appendChild(discoverProduct);

  const discoverFind = document.createElement("button");
  discoverFind.type = "button";
  discoverFind.className = "pennai-suggest";
  discoverFind.textContent = "Find posts";
  discoverGroup.appendChild(discoverFind);

  const discoverOutput = document.createElement("div");
  discoverOutput.className = "pennai-output";
  discoverGroup.appendChild(discoverOutput);

  panel.appendChild(discoverGroup);

  // --- Shared output ---
  const output = document.createElement("div");
  output.className = "pennai-output";
  panel.appendChild(output);

  document.body.appendChild(panel);

  state.panel = panel;
  state.els = {
    panel, replyingTo,
    assistNav, discoverNav,
    replyGroup, note, suggest, preview: pre, contextSummary,
    composeGroup, growTab, promoteTab, productSelect, idea, write,
    discoverGroup, discoverProduct, discoverFind, discoverOutput,
    iterateGroup, draftText, draftCount, instruction, refine, insertDraft, copyDraft, back, iterateError,
    output
  };

  // Reply view
  const runSuggest = () => {
    const composer = state.activeComposer;
    if (!composer) {
      output.textContent = "";
      showMessage(output, "Open an X reply composer first.");
      return;
    }
    const context = updateContextPreview(composer);
    requestSuggestions({ context });
  };
  suggest.addEventListener("click", runSuggest);
  note.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSuggest();
    }
  });

  // Top-level tab switching
  assistNav.addEventListener("click", () => setTab("assist"));
  discoverNav.addEventListener("click", () => setTab("discover"));

  // Compose view
  growTab.addEventListener("click", () => setComposeMode("grow"));
  promoteTab.addEventListener("click", () => setComposeMode("promote"));
  write.addEventListener("click", composeDrafts);

  // Discover view
  discoverFind.addEventListener("click", runDiscover);

  // Iterate view
  draftText.addEventListener("input", updateDraftCount);
  refine.addEventListener("click", runRefine);
  instruction.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runRefine();
    }
  });
  back.addEventListener("click", exitIterate);
  insertDraft.addEventListener("click", () => {
    if (!state.activeComposer) {
      state.els.iterateError.textContent = "Click into the X composer first, then Insert.";
      return;
    }
    insertReply(state.activeComposer, draftText.value);
  });
  copyDraft.addEventListener("click", async () => {
    try {
      await copyReply(draftText.value);
      copyDraft.textContent = "Copied";
      window.setTimeout(() => {
        copyDraft.textContent = "Copy";
      }, 1400);
    } catch (error) {
      state.els.iterateError.textContent = "Copy failed. Select the text manually.";
    }
  });

  dismiss.addEventListener("click", () => {
    // Keep the panel closed until the user explicitly reopens it via the
    // bubble. Without this flag the MutationObserver/focusin handlers would
    // re-show the panel on the next DOM mutation.
    state.dismissed = true;
    panel.classList.toggle("pennai-hidden", true);
    showBubble();
  });

  return state.els;
}

// A small draggable launcher shown after the user closes the panel, so they
// can reopen Penn AI without losing their place.
function ensureBubble() {
  if (state.bubble) return state.bubble;

  const bubble = document.createElement("button");
  bubble.type = "button";
  bubble.className = "pennai-bubble pennai-hidden";
  bubble.setAttribute("aria-label", "Open Penn AI");
  bubble.title = "Open Penn AI";
  const dot = document.createElement("span");
  dot.className = "pennai-dot";
  bubble.appendChild(dot);

  // Drag-to-move. A click that doesn't move beyond a small threshold counts as
  // a tap and reopens the panel.
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const onPointerMove = (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    const left = Math.min(Math.max(originLeft + dx, 8), window.innerWidth - bubble.offsetWidth - 8);
    const top = Math.min(Math.max(originTop + dy, 8), window.innerHeight - bubble.offsetHeight - 8);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.right = "auto";
    bubble.style.bottom = "auto";
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  };

  bubble.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    const rect = bubble.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  });

  bubble.addEventListener("click", () => {
    if (moved) return; // it was a drag, not a tap
    state.dismissed = false;
    hideBubble();
    showPanel();
  });

  document.body.appendChild(bubble);
  state.bubble = bubble;
  return bubble;
}

function showBubble() {
  ensureBubble().classList.toggle("pennai-hidden", false);
}

function hideBubble() {
  if (state.bubble) state.bubble.classList.toggle("pennai-hidden", true);
}

function showPanel() {
  // Respect an explicit dismissal — surface the bubble instead so the user
  // can reopen on their own terms.
  if (state.dismissed) {
    showBubble();
    return;
  }
  ensurePanel();
  hideBubble();
  state.panel.classList.toggle("pennai-hidden", false);
}

function hidePanel() {
  if (state.panel) state.panel.classList.toggle("pennai-hidden", true);
  hideBubble();
}

// "Open post" auto-suggest. The signal is mirrored in memory (seeded once at
// load, then kept current via storage.onChanged) so the scan loop can check it
// every mutation without hitting storage. It fires once per signal, so repeated
// opens in the same tab each trigger a fresh run.
let autoSuggestSignal = null;
let autoSuggestLastHandled = "";

if (chrome.storage?.local?.get) {
  chrome.storage.local
    .get({ [AUTO_SUGGEST_KEY]: null })
    .then((stored) => { autoSuggestSignal = stored[AUTO_SUGGEST_KEY] || null; })
    .catch(() => {});
}
if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && AUTO_SUGGEST_KEY in changes) {
      autoSuggestSignal = changes[AUTO_SUGGEST_KEY].newValue || null;
    }
  });
}

function consumeAutoSuggest(key) {
  autoSuggestLastHandled = key;
  autoSuggestSignal = null;
  chrome.storage.local.set({ [AUTO_SUGGEST_KEY]: null }).catch(() => {});
}

function checkAutoSuggest() {
  const signal = autoSuggestSignal;
  if (!signal || !signal.statusId || !signal.ts) return;

  const key = `${signal.statusId}:${signal.ts}`;
  if (key === autoSuggestLastHandled) return; // already handled this signal
  if (Date.now() - signal.ts > AUTO_SUGGEST_TTL_MS) {
    consumeAutoSuggest(key);
    return;
  }

  // Only the page actually on that post consumes the signal.
  if (statusIdFromUrl(location.href) !== signal.statusId) return;

  const composer =
    (document.activeElement ? findComposer(document.activeElement) : null) ||
    getAllComposers().at(-1);
  if (!composer) return; // reply box not in the DOM yet; retry on next scan

  const context = getThreadContext(composer);
  if (!context.posts.length) return; // thread still loading; retry on next scan

  // Ready. Consume so it fires exactly once, then run the Assist reply flow.
  consumeAutoSuggest(key);
  state.dismissed = false;
  showPanel();
  setTab("assist");
  setActiveComposer(composer);
  requestSuggestions({ context });
}

function scan() {
  checkAutoSuggest();

  const composers = getAllComposers();
  if (composers.length === 0) {
    hidePanel();
    return;
  }

  showPanel();

  if (!state.activeComposer || !composers.includes(state.activeComposer)) {
    setActiveComposer(composers.at(-1));
  }
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();

document.addEventListener("focusin", (event) => {
  const target = event.target;
  if (!target?.closest) return;
  const composer = findComposer(target);
  if (composer) {
    showPanel();
    // Don't yank the user off the Discover tab just because a composer (e.g. the
    // reply box X auto-focuses on a post page) gained focus. They switch tabs
    // themselves; the explicit Alt+Shift+R shortcut still forces Assist.
    setActiveComposer(composer);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "pennai.shortcut") return;

  const focused = document.activeElement ? findComposer(document.activeElement) : null;
  const composer = focused || getAllComposers().at(-1);
  if (!composer) return;

  // An explicit shortcut press means "bring Penn AI back", overriding a prior
  // dismissal.
  state.dismissed = false;
  showPanel();
  // The shortcut is a reply action, so make sure we're on the Assist tab.
  if (state.tab !== "assist") setTab("assist");
  setActiveComposer(composer);

  // The shortcut is a reply-surface action; if we're on a compose box it just
  // focuses the panel.
  const context = state.lastContext || getThreadContext(composer);
  if (context.surface === "reply" && !state.draft) {
    requestSuggestions({ context });
  }
});
