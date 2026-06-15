const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class ClassList {
  constructor(element) {
    this.element = element;
  }

  toggle(className, force) {
    const classes = new Set(this.element.className.split(/\s+/).filter(Boolean));
    if (force) {
      classes.add(className);
    } else {
      classes.delete(className);
    }
    this.element.className = Array.from(classes).join(" ");
  }
}

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.dataset = {};
    this.eventListeners = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.type = "";
    this.style = {};
    this.classList = new ClassList(this);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name === "type") this.type = String(value);
    if (name === "data-testid") this.dataset.testid = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }

  addEventListener(type, listener) {
    this.eventListeners[type] = this.eventListeners[type] || [];
    this.eventListeners[type].push(listener);
  }

  click() {
    return this.dispatchEvent({ type: "click", bubbles: true });
  }

  dispatchEvent(event) {
    // Model X's Draft.js composer: a synthetic paste applies the clipboard text
    // to the editor (this is how insertReply now writes drafts, instead of the
    // double-inserting execCommand path).
    if (event.type === "paste" && event.clipboardData) {
      this.textContent = event.clipboardData.getData("text/plain");
    }
    for (const listener of this.eventListeners[event.type] || []) {
      listener.call(this, event);
    }
    return true;
  }

  focus() {
    document.activeElement = this;
  }

  select() {}

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    walk(this, (element) => {
      if (element !== this && matchesSelector(element, selector)) {
        results.push(element);
      }
    });
    return results;
  }

  get innerText() {
    return [this.textContent, ...this.children.map((child) => child.innerText)].filter(Boolean).join("\n");
  }

  set innerHTML(html) {
    this.children = [];
    parsePanelHtml(this, html);
  }
}

class Document extends Element {
  constructor() {
    super("document");
    this.documentElement = this;
    this.body = new Element("body");
    this.appendChild(this.body);
    this.activeElement = null;
  }

  createElement(tagName) {
    return new Element(tagName);
  }

  createRange() {
    return {
      selectNodeContents() {}
    };
  }

  execCommand(command, showUi, value) {
    if (command === "insertText") {
      this.activeElement.textContent = value;
      return true;
    }
    if (command === "copy") return this.copySucceeds;
    return false;
  }
}

function walk(element, callback) {
  for (const child of element.children) {
    callback(child);
    walk(child, callback);
  }
}

function matchesSelector(element, selector) {
  return selector.split(",").some((part) => matchesSingle(element, part.trim()));
}

function matchesSingle(element, selector) {
  if (selector === ".pennai-preview pre") {
    return element.tagName === "PRE" && element.parentElement?.className.includes("pennai-preview");
  }
  if (selector === "article") return element.tagName === "ARTICLE";
  if (selector === '[data-testid="toolBar"]') return element.attributes["data-testid"] === "toolBar";
  if (selector === '[data-testid="tweetTextarea_0"]') return element.attributes["data-testid"] === "tweetTextarea_0";
  if (selector === '[role="textbox"][contenteditable="true"]') {
    return element.attributes.role === "textbox" && element.attributes.contenteditable === "true";
  }
  if (selector.startsWith(".")) return element.className.split(/\s+/).includes(selector.slice(1));
  if (selector === "button") return element.tagName === "BUTTON";
  if (selector === "select") return element.tagName === "SELECT";
  if (selector === "pre") return element.tagName === "PRE";
  return false;
}

function parsePanelHtml(parent) {
  const row = parent.appendChild(new Element("div"));
  row.className = "pennai-row";
  const select = row.appendChild(new Element("select"));
  select.value = "Add technical insight";
  const button = row.appendChild(new Element("button"));
  button.textContent = "Suggest replies";
  const details = parent.appendChild(new Element("details"));
  details.className = "pennai-preview";
  const summary = details.appendChild(new Element("summary"));
  summary.textContent = "Context sent";
  details.appendChild(new Element("pre"));
  const output = parent.appendChild(new Element("div"));
  output.className = "pennai-output";
}

function addComposer(label, text) {
  const article = document.body.appendChild(new Element("article"));
  const paragraph = article.appendChild(new Element("p"));
  paragraph.textContent = text;
  const composer = article.appendChild(new Element("div"));
  composer.setAttribute("data-testid", "tweetTextarea_0");
  composer.setAttribute("role", "textbox");
  composer.setAttribute("contenteditable", "true");
  composer.setAttribute("aria-label", label);
  const toolbar = article.appendChild(new Element("div"));
  toolbar.setAttribute("data-testid", "toolBar");
  return composer;
}

const document = new Document();
document.copySucceeds = true;
global.document = document;
Object.defineProperty(global, "navigator", {
  configurable: true,
  value: {
  clipboard: {
    async writeText(text) {
      global.copiedText = text;
    }
  }
  }
});
global.window = {
  getSelection: () => ({
    removeAllRanges() {},
    addRange() {}
  }),
  setTimeout: () => {}
};
global.InputEvent = class InputEvent {
  constructor(type) {
    this.type = type;
  }
};
global.DataTransfer = class DataTransfer {
  constructor() {
    this._data = {};
  }
  setData(type, value) {
    this._data[type] = String(value);
  }
  getData(type) {
    return this._data[type] || "";
  }
};
global.ClipboardEvent = class ClipboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.clipboardData = init.clipboardData || null;
  }
};
global.MutationObserver = class MutationObserver {
  observe() {}
};

let runtimeListener;
global.chrome = {
  runtime: {
    async sendMessage() {
      return {
        ok: true,
        result: {
          relevance_gate: {
            mention_product: false,
            reason: "No product mention needed."
          },
          options: [
            { label: "Helpful", text: "Make the task concrete first." },
            { label: "Question", text: "What is your done criteria?" },
            { label: "Direct", text: "The loop matters more than the prompt." }
          ]
        }
      };
    },
    onMessage: {
      addListener(listener) {
        runtimeListener = listener;
      }
    }
  }
};

const firstComposer = addComposer("First post text", "AI agents need requirements.");
const secondComposer = addComposer("Second post text", "Generic replies are easy to spot.");

vm.runInThisContext(fs.readFileSync("content.js", "utf8"));

assert.equal(document.querySelectorAll(".pennai-panel").length, 1);
scan();
scan();
assert.equal(document.querySelectorAll(".pennai-panel").length, 1);

const panel = document.querySelectorAll(".pennai-panel")[0];
assert.ok(panel.className.split(/\s+/).includes("pennai-floating"));

secondComposer.focus();
runtimeListener({ type: "pennai.shortcut" });

setImmediate(async () => {
  assert.equal(document.body.querySelectorAll(".pennai-option").length, 3);

  const copyButton = document.body.querySelectorAll(".pennai-option-actions")[1].querySelectorAll("button")[1];
  await copyButton.eventListeners.click[0]();
  assert.equal(global.copiedText, "What is your done criteria?");

  navigator.clipboard.writeText = async () => {
    throw new Error("Forced failure.");
  };
  const failingCopyButton = document.body.querySelectorAll(".pennai-option-actions")[2].querySelectorAll("button")[1];
  await failingCopyButton.eventListeners.click[0]();
  assert.match(document.body.innerText, /Copy failed/);

  const insertButton = document.body.querySelector(".pennai-option-actions").querySelector("button");
  insertButton.click();
  assert.equal(secondComposer.textContent, "Make the task concrete first.");

  console.log("content dom test ok");
});
