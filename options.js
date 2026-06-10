const defaultProductList = [
  {
    id: "spec-writer",
    name: "spec-writer Claude skill",
    description: "Helps turn vague feature requests into specs, non-goals, and verification loops",
    mention: "threads about agent workflows, implementation quality, requirements, or AI coding reliability",
    media: []
  },
  {
    id: "agent-debrief",
    name: "agent debrief VS Code extension",
    description: "Helps developers understand and review what an AI coding agent changed",
    mention: "threads about code review, agent work summaries, or developer workflow visibility",
    media: []
  }
];

const defaults = {
  model: "gpt-5.4",
  mockMode: false,
  feedGrounding: true,
  webSearch: false,
  profile: `Who I am:
- Software engineer
- Building AI/devtool products
- Interested in agent workflows, specs, testing, X growth

Opinions:
- AI agents need workflows, not just prompts
- Specs and verification matter
- Most AI-generated content sounds fake
- Useful replies beat generic engagement bait`,
  products: "",
  productList: defaultProductList,
  voice: `My actual posts (replace with 5-10 of your own, the model mimics them):
- (paste your real posts here, one per line)

Tone:
- direct
- practical
- slightly dry
- not corporate`,
  forbidden: `Avoid:
- "Great point!"
- "This is so true"
- fake enthusiasm
- forced product plugs
- hashtags unless requested
- links unless promoting explicitly`,
  badExamples: `Great point! This is exactly why everyone needs to leverage AI to 10x their workflow.

Absolutely love this. We built a tool that solves this perfectly, check it out.`
};

const fields = ["model", "profile", "voice", "forbidden", "badExamples"];
const checkboxFields = ["mockMode", "feedGrounding", "webSearch"];

const MAX_PRODUCT_IMAGES = 4;

let productList = [];
let editingId = null;
let editorMedia = [];
let productSeq = 0;

function byId(id) {
  return document.getElementById(id);
}

// --- Product model -------------------------------------------------------------

function newProductId() {
  productSeq += 1;
  return `p-${Date.now().toString(36)}-${productSeq}`;
}

function sanitizeProduct(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newProductId(),
    name,
    description: String(raw.description || "").trim(),
    mention: String(raw.mention || "").trim(),
    media: (Array.isArray(raw.media) ? raw.media : [])
      .filter((item) => item && item.type === "image" && typeof item.dataUrl === "string")
      .slice(0, MAX_PRODUCT_IMAGES)
      .map((item) => ({ type: "image", dataUrl: item.dataUrl, name: String(item.name || "") }))
  };
}

// Older profiles stored products as free text, one block per product. The
// first line is the name; "mention..." lines become the mention rule.
function parseLegacyProducts(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const name = lines.shift() || "";
      const mentionLines = [];
      const descLines = [];
      for (const line of lines) {
        const stripped = line.replace(/^[-*]\s*/, "");
        if (/^mention/i.test(stripped)) {
          mentionLines.push(stripped.replace(/^mention\s*(only\s*)?(when\s*)?(the thread is about\s*)?:?\s*/i, ""));
        } else {
          descLines.push(stripped);
        }
      }
      return sanitizeProduct({
        name,
        description: descLines.join("\n"),
        mention: mentionLines.join("; ")
      });
    })
    .filter(Boolean);
}

function migrateProducts(stored) {
  if (Array.isArray(stored.productList) && stored.productList.length) {
    return stored.productList.map(sanitizeProduct).filter(Boolean);
  }
  if (stored.products) {
    return parseLegacyProducts(stored.products);
  }
  return [];
}

// Mirror of background.js formatProductBlock: keeps the legacy text field in
// sync so exports stay readable and old extension versions degrade gracefully.
function formatProductBlock(product) {
  const parts = [product.name];
  if (product.description) parts.push(product.description);
  if (product.mention) parts.push(`Mention only when: ${product.mention}`);
  return parts.filter(Boolean).join("\n");
}

function deriveProductsText(list) {
  return list.map(formatProductBlock).join("\n\n");
}

// --- Settings load/save ----------------------------------------------------------

async function loadSettings() {
  const stored = await chrome.storage.local.get(defaults);
  for (const field of fields) {
    byId(field).value = stored[field] || "";
  }

  for (const field of checkboxFields) {
    byId(field).checked = Boolean(stored[field]);
  }

  productList = migrateProducts(stored);
  renderProducts();
  syncMockModeNote();
  updateStrength();
}

async function saveSettings() {
  const next = readForm();
  await chrome.storage.local.set(next);
  clearDirty();
  showStatus("Saved");
  updateStrength();
}

function readForm() {
  const next = {};
  for (const field of fields) {
    next[field] = byId(field).value.trim();
  }
  for (const field of checkboxFields) {
    next[field] = byId(field).checked;
  }
  next.productList = productList;
  next.products = deriveProductsText(productList);

  return next;
}

function writeForm(settings) {
  for (const field of fields) {
    byId(field).value = settings[field] || "";
  }
  for (const field of checkboxFields) {
    byId(field).checked = Boolean(settings[field]);
  }

  productList = migrateProducts(settings);
  renderProducts();
  syncMockModeNote();
  updateStrength();
}

async function resetDefaults() {
  const preserved = {
    model: defaults.model,
    mockMode: byId("mockMode").checked
  };
  const next = JSON.parse(JSON.stringify({ ...defaults, ...preserved }));
  next.products = deriveProductsText(migrateProducts(next));
  writeForm(next);
  await chrome.storage.local.set(readForm());
  clearDirty();
  showStatus("Defaults restored");
}

function syncMockModeNote() {
  const note = byId("mockModeNote");
  note.classList.toggle("hidden", !byId("mockMode").checked);
}

// --- Status + dirty state -----------------------------------------------------

let dirty = false;

function setStatus(text, kind) {
  const status = byId("status");
  if (!status) return;
  status.textContent = text;
  if (status.classList) status.classList.toggle("dirty", kind === "dirty");
}

function showStatus(text) {
  setStatus(text, "ok");
  window.setTimeout(() => {
    const status = byId("status");
    if (status && status.textContent === text) setStatus("", "ok");
  }, 1800);
}

function markDirty() {
  dirty = true;
  setStatus("Unsaved changes", "dirty");
  updateStrength();
}

function clearDirty() {
  dirty = false;
}

// --- Profile strength ----------------------------------------------------------

// Rough heuristic: the fields that most change output quality weigh the most.
// Voice dominates because real post examples are the biggest realism lever.
function scoreProfile(values) {
  const len = (id) => String(values[id] || "").trim().length;
  let score = 0;

  if (len("profile") >= 200) score += 25;
  else if (len("profile") >= 80) score += 15;
  else if (len("profile") > 0) score += 8;

  if (productList.some((product) => product.description.length >= 60 && product.mention)) score += 15;
  else if (productList.length > 0) score += 8;

  const voice = String(values.voice || "");
  const voiceFilled = voice.replace(/\(paste your real posts here[^)]*\)/i, "");
  if (voiceFilled.trim().length >= 300) score += 35;
  else if (voiceFilled.trim().length >= 80) score += 18;
  else if (voiceFilled.trim().length > 0) score += 8;

  if (len("forbidden") > 0) score += 10;
  if (len("badExamples") > 0) score += 15;

  return Math.min(100, score);
}

function strengthHintFor(values, score) {
  const voice = String(values.voice || "");
  if (/paste your real posts here/i.test(voice) || voice.trim().length < 120) {
    return "Biggest jump: paste 5-10 of your real posts into Voice.";
  }
  if (String(values.profile || "").trim().length < 120) {
    return "Add opinions you actually hold to Identity.";
  }
  if (productList.length === 0) {
    return "Create a product so penn AI can promote your work.";
  }
  if (String(values.badExamples || "").trim().length === 0) {
    return "Paste a couple of cringe replies into Never sound like this.";
  }
  if (score >= 85) return "Sharp. Test it in the playground below.";
  return "Solid. More real post examples keep sharpening it.";
}

function updateStrength() {
  const fill = byId("strengthFill");
  const label = byId("strengthLabel");
  if (!fill || !label) return;

  const values = {};
  for (const field of fields) values[field] = byId(field).value;

  const score = scoreProfile(values);
  if (fill.style) fill.style.width = `${score}%`;
  if (fill.classList) {
    fill.classList.toggle("mid", score >= 40 && score < 75);
    fill.classList.toggle("high", score >= 75);
  }
  label.textContent = `${score}%`;

  const hint = byId("strengthHint");
  if (hint) hint.textContent = strengthHintFor(values, score);
}

// --- Product manager UI ----------------------------------------------------------

function el(tagName, className, textContent) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (textContent) node.textContent = textContent;
  return node;
}

function renderProducts() {
  const container = byId("productItems");
  if (!container) return;

  const items = productList.map((product) => {
    const item = el("div", "product-item");

    if (product.media.length) {
      const thumbs = el("div", "product-thumbs");
      for (const media of product.media.slice(0, 3)) {
        const img = document.createElement("img");
        img.className = "product-thumb";
        img.src = media.dataUrl;
        img.alt = "";
        thumbs.appendChild(img);
      }
      item.appendChild(thumbs);
    } else {
      item.appendChild(el("div", "product-thumb product-thumb-empty", product.name.slice(0, 1).toUpperCase()));
    }

    const body = el("div", "product-item-body");
    body.appendChild(el("div", "product-item-name", product.name));
    const meta = product.mention
      ? `Mentions: ${product.mention}`
      : product.description.split("\n")[0] || "No description yet";
    body.appendChild(el("div", "product-item-meta", meta));
    item.appendChild(body);

    const actions = el("div", "product-item-actions");
    const edit = el("button", "ghost-btn", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openEditor(product));
    const del = el("button", "ghost-btn ghost-danger", "Delete");
    del.type = "button";
    del.addEventListener("click", () => deleteProduct(product.id));
    actions.append(edit, del);
    item.appendChild(actions);

    return item;
  });

  container.replaceChildren(...items);

  const empty = byId("productEmpty");
  if (empty) empty.classList.toggle("hidden", productList.length > 0);
}

function renderMediaPreview() {
  const preview = byId("prodMediaPreview");
  if (!preview) return;

  const thumbs = editorMedia.map((media, index) => {
    const wrap = el("div", "media-thumb");
    const img = document.createElement("img");
    img.src = media.dataUrl;
    img.alt = media.name || "";
    wrap.appendChild(img);
    const remove = el("button", "media-remove", "✕");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove image");
    remove.addEventListener("click", () => {
      editorMedia.splice(index, 1);
      renderMediaPreview();
    });
    wrap.appendChild(remove);
    return wrap;
  });

  preview.replaceChildren(...thumbs);
}

function openEditor(product) {
  editingId = product ? product.id : null;
  editorMedia = product ? product.media.map((m) => ({ ...m })) : [];
  byId("prodName").value = product ? product.name : "";
  byId("prodDesc").value = product ? product.description : "";
  byId("prodMention").value = product ? product.mention : "";
  renderMediaPreview();
  byId("productEditor").classList.toggle("hidden", false);
  if (byId("prodName").focus) byId("prodName").focus();
}

function closeEditor() {
  editingId = null;
  editorMedia = [];
  byId("productEditor").classList.toggle("hidden", true);
}

async function saveProduct() {
  const product = sanitizeProduct({
    id: editingId,
    name: byId("prodName").value,
    description: byId("prodDesc").value,
    mention: byId("prodMention").value,
    media: editorMedia
  });

  if (!product) {
    if (byId("prodName").focus) byId("prodName").focus();
    setStatus("Product needs a name", "dirty");
    return;
  }

  const index = productList.findIndex((item) => item.id === product.id);
  if (index >= 0) productList[index] = product;
  else productList.push(product);

  closeEditor();
  renderProducts();
  await saveSettings();
}

async function deleteProduct(id) {
  productList = productList.filter((product) => product.id !== id);
  if (editingId === id) closeEditor();
  renderProducts();
  await saveSettings();
  showStatus("Product removed");
}

// Downscale images before storing: chrome.storage is not built for multi-MB
// originals, and the model does not need them.
async function imageFileToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const maxDim = 900;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function addEditorImages(event) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    if (editorMedia.length >= MAX_PRODUCT_IMAGES) {
      setStatus(`Up to ${MAX_PRODUCT_IMAGES} images per product`, "dirty");
      break;
    }
    try {
      const dataUrl = await imageFileToDataUrl(file);
      editorMedia.push({ type: "image", dataUrl, name: file.name });
    } catch (error) {
      setStatus(`Could not read ${file.name}`, "dirty");
    }
  }
  event.target.value = "";
  renderMediaPreview();
}

// --- Export / import ------------------------------------------------------------

function exportSettings() {
  // Exports carry only the profile; account tokens live outside the form and
  // are never included.
  const exported = readForm();

  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "penn-ai-profile.json";
  link.dispatchEvent(new MouseEvent("click"));
  URL.revokeObjectURL(url);
  showStatus("Exported");
}

async function importSettings(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    const next = {};
    for (const field of fields) {
      next[field] = typeof imported[field] === "string" ? imported[field] : "";
    }
    for (const field of checkboxFields) {
      next[field] = Boolean(imported[field]);
    }
    next.productList = Array.isArray(imported.productList) ? imported.productList : [];
    next.products = typeof imported.products === "string" ? imported.products : "";

    writeForm(next);
    await chrome.storage.local.set(readForm());
    clearDirty();
    showStatus("Imported");
  } catch (error) {
    showStatus("Import failed");
  } finally {
    event.target.value = "";
  }
}

// --- Playground -------------------------------------------------------------------

function renderPlaygroundError(output, text) {
  const error = document.createElement("div");
  error.className = "pg-error";
  error.textContent = text;
  output.appendChild(error);
}

function renderPlaygroundResult(output, result) {
  const gate = document.createElement("div");
  gate.className = "pg-gate";
  if (result.relevance_gate?.mention_product) {
    gate.className = "pg-gate pg-gate-on";
    gate.textContent = `Product mention: yes — ${result.relevance_gate?.reason || ""}`.trim();
  } else {
    gate.textContent = `Product mention: no — ${result.relevance_gate?.reason || "not relevant here."}`.trim();
  }
  output.appendChild(gate);

  for (const option of result.options || []) {
    const item = document.createElement("div");
    item.className = "pg-option";

    if (option.label) {
      const label = document.createElement("span");
      label.className = "pg-option-label";
      label.textContent = option.label;
      item.appendChild(label);
    }

    const text = document.createElement("div");
    text.className = "pg-option-text";
    text.textContent = option.text;
    item.appendChild(text);

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      const actions = document.createElement("div");
      actions.className = "pg-option-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "ghost-btn";
      copy.textContent = "Copy";
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(option.text);
        copy.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy";
        }, 1400);
      });
      actions.appendChild(copy);
      item.appendChild(actions);
    }

    output.appendChild(item);
  }
}

async function runPlayground() {
  const post = byId("pgPost");
  const note = byId("pgNote");
  const run = byId("pgRun");
  const output = byId("pgOutput");
  if (!post || !run || !output) return;

  const threadText = post.value.trim();
  output.textContent = "";
  if (typeof output.replaceChildren === "function") output.replaceChildren();
  if (!threadText) {
    renderPlaygroundError(output, "Paste a post to reply to first.");
    return;
  }

  run.disabled = true;
  run.textContent = "Thinking…";

  try {
    // The generator reads saved settings, so persist the current edits first.
    await saveSettings();
    const response = await chrome.runtime.sendMessage({
      type: "pennai.generate",
      note: note ? note.value : "",
      threadText,
      images: []
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Reply generation failed.");
    }
    renderPlaygroundResult(output, response.result);
  } catch (error) {
    renderPlaygroundError(output, error.message);
  } finally {
    run.disabled = false;
    run.textContent = "Generate replies";
  }
}

// --- Wiring -----------------------------------------------------------------------

function wire(id, type, handler) {
  const target = byId(id);
  if (target) target.addEventListener(type, handler);
}

wire("save", "click", saveSettings);
wire("resetDefaults", "click", resetDefaults);
wire("export", "click", exportSettings);
wire("importFile", "change", importSettings);
wire("mockMode", "change", syncMockModeNote);

for (const field of [...fields, ...checkboxFields]) {
  wire(field, "input", markDirty);
  wire(field, "change", markDirty);
}

wire("productAdd", "click", () => openEditor(null));
wire("prodSave", "click", saveProduct);
wire("prodCancel", "click", closeEditor);
wire("prodMedia", "change", addEditorImages);

// --- Account (hosted API) -----------------------------------------------------

// Free plans always run gpt-5.4-mini on the server, so the picker must not let
// a free user select a Pro-only model and think it will be used.
function gateModelSelect(pro) {
  const select = byId("model");
  if (!select || !select.options) return;
  for (const option of Array.from(select.options)) {
    const proOnly = option.value !== "gpt-5.4-mini";
    option.disabled = proOnly && !pro;
  }
  if (!pro && select.value !== "gpt-5.4-mini") {
    select.value = "gpt-5.4-mini";
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ model: "gpt-5.4-mini" });
    }
  }
}

function setAccountLine(signedIn, account) {
  const out = byId("acctSignedOut");
  const inn = byId("acctSignedIn");
  if (!out || !inn) return;
  out.classList.toggle("hidden", signedIn);
  inn.classList.toggle("hidden", !signedIn);

  const pro = Boolean(signedIn) && account?.plan === "pro";
  gateModelSelect(pro);

  const usage = byId("acctUsage");
  if (!signedIn) {
    if (usage) usage.textContent = "Sign in with Google to generate replies. Free plan included.";
    return;
  }

  const who = byId("acctWho");
  if (who) who.textContent = account.user?.email || account.user?.name || "you";

  const plan = byId("acctPlan");
  if (plan) {
    plan.textContent = pro ? "PRO" : "FREE";
    if (plan.classList) plan.classList.toggle("plan-pro", pro);
  }

  const upgrade = byId("acctUpgrade");
  if (upgrade) upgrade.classList.toggle("hidden", pro);

  if (usage) {
    const limit = account.limits?.dailyCalls || 0;
    usage.textContent = `${account.usedToday || 0} of ${limit} generations used today.` +
      (pro ? "" : " Pro unlocks posts, promotion, web search, and gpt-5.4.");
  }
}

async function refreshAccount() {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "pennai.account" });
    if (!response?.ok) throw new Error(response?.error || "account unavailable");
    const account = response.result;
    setAccountLine(Boolean(account.signedIn), account);
    if (!account.signedIn && account.pending) window.setTimeout(refreshAccount, 3000);
  } catch (error) {
    setAccountLine(false, null);
  }
}

wire("acctSignIn", "click", async () => {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  await chrome.runtime.sendMessage({ type: "pennai.signin" });
  window.setTimeout(refreshAccount, 3000);
});

wire("acctSignOut", "click", async () => {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  await chrome.runtime.sendMessage({ type: "pennai.signout" });
  refreshAccount();
});

wire("acctUpgrade", "click", () => {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage({ type: "pennai.open", page: "upgrade" });
});

if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
  refreshAccount();
}

const pgRunButton = byId("pgRun");
if (pgRunButton && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
  pgRunButton.addEventListener("click", runPlayground);
} else if (pgRunButton) {
  pgRunButton.disabled = true;
}

if (typeof document.addEventListener === "function") {
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      saveSettings();
    }
  });
}

if (typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

// Scroll-spy for the rail nav.
if (typeof IntersectionObserver !== "undefined" && typeof document.querySelectorAll === "function") {
  const links = Array.from(document.querySelectorAll(".rail-nav a"));
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  if (sections.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const link of links) {
            link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
          }
        }
      },
      { rootMargin: "-20% 0px -65% 0px" }
    );
    for (const section of sections) spy.observe(section);
  }
}

loadSettings();
