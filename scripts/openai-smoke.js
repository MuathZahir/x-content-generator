const {
  buildMessages,
  enforceReplyPolicy,
  parseReplyResult
} = require("../background.js");

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-5.4";

if (!apiKey) {
  console.error("OPENAI_API_KEY is required for the live smoke test.");
  process.exit(2);
}

const note = "mention my project only if it genuinely fits";
const threadText = "AI coding agents are impressive, but they fail when the task has no requirements, non-goals, or verification loop.";
const settings = {
  apiKey,
  model,
  profile: "Builder focused on AI coding workflows, specs, and practical developer tools.",
  products: `Spec tool
- Helps turn vague feature requests into specs, non-goals, and verification loops
- Mention only when the thread is about AI agents, implementation quality, requirements, or verification`,
  voice: "Direct, practical, specific, and not corporate.",
  forbidden: `Great point!
This is so true
hashtags
links`,
  badExamples: "Great point! This is exactly why everyone needs to leverage AI to 10x their workflow."
};

async function main() {
  const body = {
    model,
    response_format: { type: "json_object" },
    messages: buildMessages({ note, threadText, settings })
  };
  // GPT-5 family rejects a custom temperature; only older models accept it.
  if (!/^gpt-5/i.test(model)) {
    body.temperature = 0.7;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = await response.json();
  const parsed = parseReplyResult(data.choices?.[0]?.message?.content || "");
  const result = enforceReplyPolicy(parsed, { settings });

  console.log(JSON.stringify({
    model,
    mention_product: result.relevance_gate.mention_product,
    option_count: result.options.length,
    labels: result.options.map((option) => option.label)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
