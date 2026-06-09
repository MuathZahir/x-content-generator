const MODES = [
  "Add technical insight",
  "Ask a smart question",
  "Respectfully disagree",
  "Share a relevant example",
  "Softly mention my project",
  "Make it funnier",
  "Make it more concise"
];

const COMPOSER_SELECTOR = '[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]';

const state = {
  panel: null,
  els: null,
  activeComposer: null
};

function findComposer(node) {
  return node.closest(COMPOSER_SELECTOR);
}

function getAllComposers() {
  return Array.from(document.querySelectorAll(COMPOSER_SELECTOR))
    .map((node) => findComposer(node))
    .filter(Boolean);
}

function getVisibleThreadText(composer) {
  if (!composer) return "";
  const article = composer.closest("article");
  const scope = article?.parentElement || document;
  const posts = Array.from(scope.querySelectorAll("article"))
    .slice(-6)
    .map((post) => post.innerText.trim())
    .filter(Boolean);

  return posts.join("\n\n---\n\n").slice(0, 6000);
}

function getPreviewText(threadText) {
  return threadText || "No nearby thread text detected.";
}

function insertReply(composer, text) {
  if (!composer) return;
  composer.focus();
  const range = document.createRange();
  range.selectNodeContents(composer);
  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Could not select the reply composer.");
  }

  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand("insertText", false, text);
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

async function generateReplies({ mode, threadText }) {
  const response = await chrome.runtime.sendMessage({
    type: "contextreply.generate",
    mode,
    threadText
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Reply generation failed.");
  }

  return response.result;
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

function showMessage(output, text, className = "contextreply-error") {
  const message = document.createElement("div");
  message.className = className;
  message.textContent = text;
  output.appendChild(message);
}

function updateContextPreview(composer) {
  const threadText = getVisibleThreadText(composer);
  if (state.els?.preview) {
    state.els.preview.textContent = getPreviewText(threadText);
  }
  return threadText;
}

function setActiveComposer(composer) {
  state.activeComposer = composer || null;
  if (composer) updateContextPreview(composer);
}

async function requestSuggestions({ composer, threadText }) {
  if (!state.els) return;
  const { select, suggest, output } = state.els;
  suggest.disabled = true;
  suggest.textContent = "Thinking...";
  output.textContent = "";

  try {
    const result = await generateReplies({
      mode: select.value,
      threadText
    });

    const gate = document.createElement("div");
    gate.className = "contextreply-gate";
    gate.textContent = `Product mention: ${result.relevance_gate?.mention_product ? "yes" : "no"} - ${result.relevance_gate?.reason || "No reason returned."}`;
    output.appendChild(gate);

    for (const option of result.options || []) {
      const item = document.createElement("div");
      item.className = "contextreply-option";

      const text = document.createElement("div");
      text.className = "contextreply-option-text";
      text.textContent = `${option.label}: ${option.text}`;

      const actions = document.createElement("div");
      actions.className = "contextreply-option-actions";

      const insertButton = document.createElement("button");
      insertButton.type = "button";
      insertButton.textContent = "Insert";
      insertButton.addEventListener("click", () => insertReply(state.activeComposer || composer, option.text));

      const copyButton = document.createElement("button");
      copyButton.type = "button";
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
      item.append(text, actions);
      output.appendChild(item);
    }
  } catch (error) {
    showMessage(output, error.message);
  } finally {
    suggest.disabled = false;
    suggest.textContent = "Suggest replies";
  }
}

function ensurePanel() {
  if (state.panel) return state.els;

  const panel = document.createElement("div");
  panel.className = "contextreply-panel contextreply-floating";

  const row = document.createElement("div");
  row.className = "contextreply-row";

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Reply mode");
  for (const mode of MODES) {
    const opt = document.createElement("option");
    opt.textContent = mode;
    select.appendChild(opt);
  }
  row.appendChild(select);

  const suggest = document.createElement("button");
  suggest.type = "button";
  suggest.className = "contextreply-suggest";
  suggest.textContent = "Suggest replies";
  row.appendChild(suggest);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "contextreply-dismiss";
  dismiss.setAttribute("aria-label", "Hide");
  dismiss.textContent = "x";
  row.appendChild(dismiss);

  panel.appendChild(row);

  const details = document.createElement("details");
  details.className = "contextreply-preview";
  const summary = document.createElement("summary");
  summary.textContent = "Context sent";
  details.appendChild(summary);
  const pre = document.createElement("pre");
  details.appendChild(pre);
  panel.appendChild(details);

  const output = document.createElement("div");
  output.className = "contextreply-output";
  panel.appendChild(output);

  document.body.appendChild(panel);

  state.panel = panel;
  state.els = { panel, select, suggest, dismiss, preview: pre, output };

  suggest.addEventListener("click", () => {
    const composer = state.activeComposer;
    if (!composer) {
      output.textContent = "";
      showMessage(output, "Open an X reply composer first.");
      return;
    }
    const threadText = updateContextPreview(composer);
    requestSuggestions({ composer, threadText });
  });

  dismiss.addEventListener("click", () => {
    panel.classList.toggle("contextreply-hidden", true);
  });

  return state.els;
}

function showPanel() {
  ensurePanel();
  state.panel.classList.toggle("contextreply-hidden", false);
}

function hidePanel() {
  if (state.panel) state.panel.classList.toggle("contextreply-hidden", true);
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
  if (message?.type !== "contextreply.shortcut") return;

  const focused = document.activeElement ? findComposer(document.activeElement) : null;
  const composer = focused || getAllComposers().at(-1);
  if (!composer) return;

  showPanel();
  setActiveComposer(composer);

  const threadText = updateContextPreview(composer);
  requestSuggestions({ composer, threadText });
});
