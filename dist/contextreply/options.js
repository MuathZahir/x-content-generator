const defaults = {
  apiKey: "",
  model: "gpt-4.1-mini",
  mockMode: false,
  profile: `Who I am:
- Software engineer
- Building AI/devtool products
- Interested in agent workflows, specs, testing, X growth

Products/projects:
- spec-writer Claude skill
- agent debrief VS Code extension

Opinions:
- AI agents need workflows, not just prompts
- Specs and verification matter
- Most AI-generated content sounds fake
- Useful replies beat generic engagement bait`,
  products: `spec-writer Claude skill
- Helps turn vague feature requests into specs, non-goals, and verification loops
- Mention only when the thread is about agent workflows, implementation quality, requirements, or AI coding reliability

agent debrief VS Code extension
- Helps developers understand and review what an AI coding agent changed
- Mention only when the thread is about code review, agent work summaries, or developer workflow visibility`,
  voice: `Tone:
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

const fields = ["apiKey", "model", "profile", "products", "voice", "forbidden", "badExamples"];
const checkboxFields = ["mockMode"];

async function loadSettings() {
  const stored = await chrome.storage.local.get(defaults);
  for (const field of fields) {
    document.getElementById(field).value = stored[field] || "";
  }

  for (const field of checkboxFields) {
    document.getElementById(field).checked = Boolean(stored[field]);
  }

  syncMockModeNote();
}

async function saveSettings() {
  const next = readForm();
  await chrome.storage.local.set(next);
  showStatus("Saved");
}

function readForm() {
  const next = {};
  for (const field of fields) {
    next[field] = document.getElementById(field).value.trim();
  }
  for (const field of checkboxFields) {
    next[field] = document.getElementById(field).checked;
  }

  return next;
}

function writeForm(settings) {
  for (const field of fields) {
    document.getElementById(field).value = settings[field] || "";
  }
  for (const field of checkboxFields) {
    document.getElementById(field).checked = Boolean(settings[field]);
  }

  syncMockModeNote();
}

async function resetDefaults() {
  const preserved = {
    apiKey: document.getElementById("apiKey").value.trim(),
    model: defaults.model,
    mockMode: document.getElementById("mockMode").checked
  };
  const next = { ...defaults, ...preserved };
  writeForm(next);
  await chrome.storage.local.set(next);
  showStatus("Defaults restored");
}

function syncMockModeNote() {
  const note = document.getElementById("mockModeNote");
  note.classList.toggle("hidden", !document.getElementById("mockMode").checked);
}

function showStatus(text) {
  const status = document.getElementById("status");
  status.textContent = text;
  window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

function exportSettings() {
  const exported = readForm();
  delete exported.apiKey;

  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "contextreply-profile.json";
  link.click();
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

    writeForm(next);
    await chrome.storage.local.set(next);
    showStatus("Imported");
  } catch (error) {
    showStatus("Import failed");
  } finally {
    event.target.value = "";
  }
}

document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("resetDefaults").addEventListener("click", resetDefaults);
document.getElementById("export").addEventListener("click", exportSettings);
document.getElementById("importFile").addEventListener("change", importSettings);
document.getElementById("mockMode").addEventListener("change", syncMockModeNote);
loadSettings();
