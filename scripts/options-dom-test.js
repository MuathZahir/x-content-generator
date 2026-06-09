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
    this.classList = new ClassList(this);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

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
      element.click = () => {
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
for (const id of ["apiKey", "model", "profile", "products", "voice", "forbidden", "badExamples"]) {
  document.add(id, id === "profile" || id === "products" || id === "voice" || id === "forbidden" || id === "badExamples" ? "textarea" : "input");
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

let stored = {};
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
  }
};
global.document = document;
global.window = { setTimeout: () => {} };
global.Blob = class Blob {
  constructor(parts) {
    this.text = parts.join("");
  }
};
global.URL = {
  createObjectURL(blob) {
    global.exportedJson = blob.text;
    return "blob:contextreply-profile";
  },
  revokeObjectURL() {}
};

vm.runInThisContext(fs.readFileSync("options.js", "utf8"));

setImmediate(async () => {
  assert.equal(document.getElementById("model").value, "gpt-5.4");
  assert.equal(document.getElementById("feedGrounding").checked, true);
  assert.equal(document.getElementById("webSearch").checked, false);
  assert.match(document.getElementById("profile").value, /Software engineer/);

  document.getElementById("apiKey").value = "sk-test";
  document.getElementById("profile").value = "Edited profile";
  document.getElementById("mockMode").checked = true;
  await saveSettings();
  assert.equal(stored.apiKey, "sk-test");
  assert.equal(stored.profile, "Edited profile");
  assert.equal(stored.mockMode, true);

  syncMockModeNote();
  assert.equal(document.getElementById("mockModeNote").classList.contains("hidden"), false);

  exportSettings();
  const exported = JSON.parse(global.exportedJson);
  assert.equal(exported.apiKey, undefined);
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
  assert.equal(stored.apiKey, "");

  document.getElementById("apiKey").value = "sk-reset";
  document.getElementById("profile").value = "Broken profile";
  await resetDefaults();
  assert.equal(stored.apiKey, "sk-reset");
  assert.match(stored.profile, /Software engineer/);
  assert.match(document.getElementById("status").textContent, /Defaults restored/);

  console.log("options dom test ok");
});
