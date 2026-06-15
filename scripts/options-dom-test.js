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

  contains(className) {
    return this.element.className.split(/\s+/).includes(className);
  }
}

class Element {
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.eventListeners = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.files = [];
    this.style = {};
    this.classList = new ClassList(this);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute() {}

  addEventListener(type, listener) {
    this.eventListeners[type] = this.eventListeners[type] || [];
    this.eventListeners[type].push(listener);
  }

  click() {
    for (const listener of this.eventListeners.click || []) {
      listener.call(this, { type: "click", target: this });
    }
  }

  dispatchChange() {
    for (const listener of this.eventListeners.change || []) {
      listener.call(this, { type: "change", target: this });
    }
  }
}

class Document {
  constructor() {
    this.elements = new Map();
    this.body = new Element("body");
  }

  createElement(tagName) {
    const element = new Element(tagName);
    if (tagName === "a") {
      element.dispatchEvent = () => {
        global.lastDownload = {
          href: element.href,
          download: element.download
        };
      };
    }
    return element;
  }

  getElementById(id) {
    return this.elements.get(id);
  }

  add(id, tagName = "input") {
    const element = new Element(tagName, id);
    this.elements.set(id, element);
    return element;
  }
}

const document = new Document();
for (const id of ["model", "profile", "voice", "forbidden", "badExamples"]) {
  document.add(id, id === "model" ? "input" : "textarea");
}
document.add("mockMode", "input");
document.add("feedGrounding", "input");
document.add("webSearch", "input");
document.add("mockModeNote", "p").className = "field-note hidden";
document.add("save", "button");
document.add("resetDefaults", "button");
document.add("export", "button");
document.add("importFile", "input");
document.add("status", "span");
document.add("acctSignedOut", "div").className = "acct-line hidden";
document.add("acctSignedIn", "div").className = "acct-line hidden";
document.add("acctWho", "strong");
document.add("acctPlan", "span");
document.add("acctUsage", "p");
document.add("acctSignIn", "button");
document.add("acctSignOut", "button");
document.add("acctUpgrade", "button").className = "secondary hidden";
document.add("strengthFill", "div");
document.add("strengthLabel", "span");
document.add("strengthHint", "p");
document.add("pgPost", "textarea");
document.add("pgNote", "input");
document.add("pgRun", "button");
document.add("pgOutput", "div");
document.add("productItems", "div");
document.add("productEmpty", "p");
document.add("productAdd", "button");
document.add("productEditor", "div").className = "product-editor hidden";
document.add("prodName", "input");
document.add("prodDesc", "textarea");
document.add("prodMention", "input");
document.add("prodMedia", "input");
document.add("prodMediaPreview", "div");
document.add("prodSave", "button");
document.add("prodCancel", "button");
document.add("prodUrl", "input");
document.add("prodAutofill", "button");
document.add("prodExtractStatus", "p");
document.add("prodPasteWrap", "div").className = "hidden";
document.add("prodPaste", "textarea");

let stored = {};
let generateCalls = [];
let accountCalls = 0;
global.chrome = {
  storage: {
    local: {
      async get(defaults) {
        return { ...defaults, ...stored };
      },
      async set(next) {
        stored = { ...next };
      }
    }
  },
  runtime: {
    async sendMessage(message) {
      if (message.type === "pennai.account") {
        accountCalls += 1;
        return {
          ok: true,
          result: {
            signedIn: true,
            plan: "free",
            user: { email: "maya@example.com" },
            limits: { dailyCalls: 5 },
            usedToday: 2
          }
        };
      }
      if (message.type === "pennai.extract") {
        return {
          ok: true,
          result: {
            product: { name: "Penn", description: "Reply copilot for X.", mention: "threads about growing on X" },
            lowConfidence: false
          }
        };
      }
      generateCalls.push(message);
      return {
        ok: true,
        result: {
          relevance_gate: { mention_product: false, reason: "Not relevant.", mention_style: "" },
          options: [
            { label: "dry", text: "first sample reply" },
            { label: "question", text: "second sample reply" },
            { label: "blunt", text: "third sample reply" }
          ]
        }
      };
    }
  }
};
global.document = document;
global.window = { setTimeout: () => {} };
global.MouseEvent = class MouseEvent {
  constructor(type) {
    this.type = type;
  }
};
global.Blob = class Blob {
  constructor(parts) {
    this.text = parts.join("");
  }
};
global.URL = {
  createObjectURL(blob) {
    global.exportedJson = blob.text;
    return "blob:penn-ai-profile";
  },
  revokeObjectURL() {}
};

vm.runInThisContext(fs.readFileSync("options.js", "utf8"));

setImmediate(async () => {
  assert.equal(document.getElementById("model").value, "gpt-5.4");
  assert.equal(document.getElementById("feedGrounding").checked, true);
  assert.equal(document.getElementById("webSearch").checked, false);
  assert.match(document.getElementById("profile").value, /Software engineer/);

  document.getElementById("profile").value = "Edited profile";
  document.getElementById("mockMode").checked = true;
  await saveSettings();
  assert.equal(stored.apiKey, undefined, "no API key field exists anymore");
  assert.equal(stored.profile, "Edited profile");
  assert.equal(stored.mockMode, true);

  syncMockModeNote();
  assert.equal(document.getElementById("mockModeNote").classList.contains("hidden"), false);

  exportSettings();
  const exported = JSON.parse(global.exportedJson);
  assert.equal(exported.apiKey, undefined);
  assert.equal(exported.apiToken, undefined, "exports never include account tokens");
  assert.equal(exported.profile, "Edited profile");

  const importFile = document.getElementById("importFile");
  importFile.files = [{
    async text() {
      return JSON.stringify({
        profile: "Imported profile",
        products: "Imported product",
        voice: "Imported voice",
        forbidden: "Imported forbidden",
        badExamples: "Imported bad example",
        model: "gpt-4.1-mini",
        mockMode: true
      });
    }
  }];
  await importSettings({ target: importFile });
  assert.equal(stored.profile, "Imported profile");
  assert.equal(stored.badExamples, "Imported bad example");

  document.getElementById("profile").value = "Broken profile";
  await resetDefaults();
  assert.match(stored.profile, /Software engineer/);
  assert.match(document.getElementById("status").textContent, /Defaults restored/);

  // Profile strength meter reflects the current form.
  assert.match(document.getElementById("strengthLabel").textContent, /^\d+%$/);
  assert.match(document.getElementById("strengthFill").style.width, /^\d+%$/);
  assert.ok(document.getElementById("strengthHint").textContent.length > 0);

  // Account line renders from the background account message.
  assert.ok(accountCalls >= 1, "options asks the background for account state");
  assert.equal(document.getElementById("acctSignedIn").classList.contains("hidden"), false);
  assert.equal(document.getElementById("acctSignedOut").classList.contains("hidden"), true);
  assert.equal(document.getElementById("acctWho").textContent, "maya@example.com");
  assert.equal(document.getElementById("acctPlan").textContent, "FREE");
  assert.match(document.getElementById("acctUsage").textContent, /2 of 5 generations/);
  assert.equal(document.getElementById("acctUpgrade").classList.contains("hidden"), false);

  // Playground saves the form, then asks the background for replies.
  document.getElementById("pgPost").value = "Someone: agents need specs";
  document.getElementById("pgNote").value = "be dry";
  document.getElementById("pgRun").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0].type, "pennai.generate");
  assert.equal(generateCalls[0].note, "be dry");
  assert.match(generateCalls[0].threadText, /agents need specs/);
  const pgOutput = document.getElementById("pgOutput");
  assert.ok(pgOutput.children.length >= 4, "playground renders gate + options");
  assert.match(pgOutput.children[0].textContent, /Product mention: no/);
  assert.equal(pgOutput.children[1].children[1].textContent, "first sample reply");

  // Product manager: defaults render, create persists, delete removes.
  const productItems = document.getElementById("productItems");
  assert.equal(productItems.children.length, 2, "default products render");

  document.getElementById("productAdd").click();
  assert.equal(document.getElementById("productEditor").classList.contains("hidden"), false);
  document.getElementById("prodName").value = "LaunchKit";
  document.getElementById("prodDesc").value = "Ship checklists for indie launches";
  document.getElementById("prodMention").value = "threads about launching";
  document.getElementById("prodSave").click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(document.getElementById("productEditor").classList.contains("hidden"), true);
  assert.equal(productItems.children.length, 3);
  assert.ok(stored.productList.some((product) => product.name === "LaunchKit"));
  assert.match(stored.products, /LaunchKit/);
  assert.match(stored.products, /Mention only when: threads about launching/);

  // Delete the product we just added (item structure: thumb, body, actions).
  const launchItem = productItems.children[2];
  const deleteButton = launchItem.children[2].children[1];
  assert.equal(deleteButton.textContent, "Delete");
  deleteButton.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(productItems.children.length, 2);
  assert.ok(!stored.productList.some((product) => product.name === "LaunchKit"));

  // Auto-fill: a URL + Auto-fill click asks the background to extract and
  // pre-fills the editor (without saving).
  document.getElementById("productAdd").click();
  document.getElementById("prodUrl").value = "https://heypenn.com";
  document.getElementById("prodAutofill").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.getElementById("prodName").value, "Penn");
  assert.match(document.getElementById("prodDesc").value, /Reply copilot/);
  assert.match(document.getElementById("prodMention").value, /growing on X/);
  assert.match(document.getElementById("prodExtractStatus").textContent, /Review the fields/);
  // Pre-fill does not commit: the product list is unchanged until Save.
  assert.equal(productItems.children.length, 2);
  document.getElementById("prodCancel").click();

  console.log("options dom test ok");
});
