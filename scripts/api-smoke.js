// Live smoke test against the hosted penn AI API.
// Usage:
//   $env:PENN_AI_TOKEN = "penn_..."   (copy from a signed-in extension:
//     chrome.storage.local.get("apiToken") in the service-worker console)
//   node scripts/api-smoke.js
// Optionally override the API with $env:PENN_AI_API.

const { API_BASE } = require("../background.js");

const apiBase = process.env.PENN_AI_API || API_BASE;
const token = process.env.PENN_AI_TOKEN;

if (!token) {
  console.error("PENN_AI_TOKEN is required for the live smoke test.");
  process.exit(2);
}

const payload = {
  note: "mention my project only if it genuinely fits",
  threadText: "AI coding agents are impressive, but they fail when the task has no requirements, non-goals, or verification loop.",
  images: [],
  model: process.env.PENN_AI_MODEL || "gpt-5.4",
  profile: {
    context: "Builder focused on AI coding workflows, specs, and practical developer tools.",
    products: `Spec tool
- Helps turn vague feature requests into specs, non-goals, and verification loops
- Mention only when the thread is about AI agents, implementation quality, requirements, or verification`,
    voice: "Direct, practical, specific, and not corporate.",
    forbidden: "Great point!\nThis is so true",
    badExamples: "Great point! This is exactly why everyone needs to leverage AI to 10x their workflow."
  }
};

async function main() {
  console.log(`POST ${apiBase}/v1/generate`);
  const started = Date.now();
  const response = await fetch(`${apiBase}/v1/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    console.error(`Failed (${response.status}):`, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`ok in ${Date.now() - started}ms`);
  console.log(`relevance gate: mention=${data.relevance_gate?.mention_product} (${data.relevance_gate?.reason})`);
  for (const option of data.options) {
    console.log(`- [${option.label}] ${option.text}`);
  }

  const me = await fetch(`${apiBase}/v1/me`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((r) => r.json());
  console.log(`plan=${me.plan} usedToday=${me.usedToday}/${me.limits?.dailyCalls}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
