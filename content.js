const COMPOSER_SELECTOR = '[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]';
const MAX_POSTS = 4;
const MAX_IMAGES = 4;
const MAX_FEED = 12;
const MAX_TRENDS = 10;

const state = {
  panel: null,
  els: null,
  activeComposer: null,
  lastContext: null,
  view: "reply",
  composeMode: "grow",
  draft: null
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
  const range = document.createRange();
  range.selectNodeContents(composer);
  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Could not select the composer.");
  }

  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand("insertText", false, text);
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
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
    throw new Error(response?.error || fallbackError);
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

// --- Panel rendering --------------------------------------------------------

function showMessage(output, text, className = "pennai-error") {
  const message = document.createElement("div");
  message.className = className;
  message.textContent = text;
  output.appendChild(message);
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

function setView(view) {
  if (!state.els) return;
  state.view = view;
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

async function populateProducts() {
  const select = state.els?.productSelect;
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
  insertButton.addEventListener("click", () => insertReply(state.activeComposer, option.text));

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
    showMessage(output, error.message);
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
    showMessage(output, error.message);
  } finally {
    write.disabled = false;
    write.classList.toggle("pennai-loading", false);
    write.textContent = "Write post";
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
  brandName.textContent = "penn AI";
  brand.append(dot, brandName);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "pennai-dismiss";
  dismiss.setAttribute("aria-label", "Hide");
  dismiss.textContent = "✕";

  header.append(brand, dismiss);
  panel.appendChild(header);

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

  // --- Shared output ---
  const output = document.createElement("div");
  output.className = "pennai-output";
  panel.appendChild(output);

  document.body.appendChild(panel);

  state.panel = panel;
  state.els = {
    panel, replyingTo,
    replyGroup, note, suggest, preview: pre, contextSummary,
    composeGroup, growTab, promoteTab, productSelect, idea, write,
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

  // Compose view
  growTab.addEventListener("click", () => setComposeMode("grow"));
  promoteTab.addEventListener("click", () => setComposeMode("promote"));
  write.addEventListener("click", composeDrafts);

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
  insertDraft.addEventListener("click", () => insertReply(state.activeComposer, draftText.value));
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
    panel.classList.toggle("pennai-hidden", true);
  });

  return state.els;
}

function showPanel() {
  ensurePanel();
  state.panel.classList.toggle("pennai-hidden", false);
}

function hidePanel() {
  if (state.panel) state.panel.classList.toggle("pennai-hidden", true);
}

function scan() {
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
    setActiveComposer(composer);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "pennai.shortcut") return;

  const focused = document.activeElement ? findComposer(document.activeElement) : null;
  const composer = focused || getAllComposers().at(-1);
  if (!composer) return;

  showPanel();
  setActiveComposer(composer);

  // The shortcut is a reply-surface action; if we're on a compose box it just
  // focuses the panel.
  const context = state.lastContext || getThreadContext(composer);
  if (context.surface === "reply" && !state.draft) {
    requestSuggestions({ context });
  }
});
