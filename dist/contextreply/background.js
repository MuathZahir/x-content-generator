const SETTINGS_DEFAULTS = {
  apiKey: "",
  model: "gpt-4.1-mini",
  mockMode: false,
  profile: "",
  products: "",
  voice: "",
  forbidden: "",
  badExamples: ""
};

function stripJsonFence(raw) {
  return raw.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

function parseReplyResult(raw) {
  const parsed = JSON.parse(stripJsonFence(raw));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned an invalid response.");
  }

  const gate = parsed.relevance_gate;
  if (!gate || typeof gate !== "object" || typeof gate.mention_product !== "boolean") {
    throw new Error("Model response is missing the relevance gate.");
  }

  if (!Array.isArray(parsed.options) || parsed.options.length < 3 || parsed.options.length > 5) {
    throw new Error("Model response must include 3 to 5 reply options.");
  }

  for (const option of parsed.options) {
    if (!option || typeof option.label !== "string" || typeof option.text !== "string") {
      throw new Error("Every reply option needs a label and text.");
    }
  }

  return parsed;
}

function getForbiddenTerms(settings) {
  const builtIn = [
    "great point",
    "this is so true",
    "couldn't agree more",
    "love this take",
    "100%"
  ];
  const custom = String(settings.forbidden || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);

  return [...builtIn, ...custom].map((term) => term.toLowerCase());
}

function violatesReplyPolicy(text, settings) {
  const normalized = text.toLowerCase();
  if (/#\w+/.test(text)) return "hashtags are disabled";
  if (/https?:\/\/|www\./i.test(text)) return "links are disabled";

  const term = getForbiddenTerms(settings).find((forbidden) => normalized.includes(forbidden));
  return term ? `forbidden phrase: ${term}` : "";
}

function enforceReplyPolicy(result, { mode, settings }) {
  const options = result.options.filter((option) => !violatesReplyPolicy(option.text, settings));
  if (options.length < 3) {
    throw new Error("Generated replies violated too many safety rules. Try again.");
  }

  const relevanceGate = {
    ...result.relevance_gate,
    mention_product: mode === "Softly mention my project" && result.relevance_gate.mention_product
  };

  return {
    ...result,
    relevance_gate: relevanceGate,
    options
  };
}

const STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "before",
  "better",
  "but",
  "can",
  "for",
  "from",
  "has",
  "have",
  "help",
  "helps",
  "into",
  "less",
  "like",
  "more",
  "only",
  "that",
  "the",
  "their",
  "them",
  "this",
  "use",
  "when",
  "with",
  "without",
  "you",
  "your"
]);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9-]{2,}/g)
    ?.filter((token) => !STOPWORDS.has(token)) || [];
}

function splitProductBlocks(products) {
  return String(products)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function selectRelevantProducts(products, threadText, limit = 3) {
  const threadTokens = new Set(tokenize(threadText));
  const scored = splitProductBlocks(products).map((block, index) => {
    const overlap = tokenize(block).filter((token) => threadTokens.has(token));
    return {
      block,
      index,
      score: new Set(overlap).size
    };
  });

  const relevant = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.block);

  return relevant.length > 0 ? relevant.join("\n\n") : "No saved product/project appears directly relevant to the visible thread.";
}

function generateMockReplies({ mode, threadText }) {
  const mention = mode === "Softly mention my project" && /agent|workflow|spec|requirement|verification|developer|code/i.test(threadText);

  return {
    relevance_gate: {
      mention_product: mention,
      reason: mention
        ? "The visible thread is about agent workflows or implementation quality."
        : "The visible thread does not clearly justify a product mention.",
      mention_style: mention ? "Personal example, not promotion." : "Do not mention a product."
    },
    options: [
      {
        label: "Helpful",
        text: "The useful bit is usually turning the vague idea into a small spec, a non-goal list, and one verification step."
      },
      {
        label: "Question",
        text: "What would you use as the done criteria before letting the agent start changing files?"
      },
      {
        label: "Direct",
        text: mention
          ? "This is why I keep experimenting with spec-first agent workflows. The prompt matters less than the loop around it."
          : "Speed helps, but only after the reply has something specific to add."
      }
    ]
  };
}

function formatUserContext(settings, threadText = "") {
  return `User context profile:
${settings.profile}

Most relevant saved products/projects:
${selectRelevantProducts(settings.products, threadText)}

Writing examples and tone:
${settings.voice}

Forbidden phrases or behaviors:
${settings.forbidden}

Never sound like these examples:
${settings.badExamples}`;
}

function buildMessages({ mode, threadText, settings }) {
  return [
    {
      role: "system",
      content: `You write useful X replies for a technical founder/builder. Be concise, human, specific, and non-corporate.

Return only valid JSON:
{
  "relevance_gate": {
    "mention_product": true,
    "reason": "short reason",
    "mention_style": "short guidance"
  },
  "options": [
    {"label": "Helpful", "text": "reply text"},
    {"label": "Contrarian", "text": "reply text"},
    {"label": "Question", "text": "reply text"}
  ]
}

Rules:
- Always produce 3 to 5 options.
- Do not mention a product unless the mode asks for it, the product/project field contains a genuinely relevant match, and the post context makes the mention natural.
- If product mention is not relevant, set mention_product to false and write useful replies without it.
- If the selected mode is not "Softly mention my project", mention_product should usually be false.
- No hashtags, no links, no fake enthusiasm, no generic praise.
- Avoid the user's forbidden phrases and behaviors.
- Avoid the style and posture of the user's "never sound like this" examples.`
    },
    {
      role: "user",
      content: `Mode: ${mode}

${formatUserContext(settings, threadText)}

Visible X post/thread context:
${threadText}`
    }
  ];
}

async function generateReplies({ mode, threadText }) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  if (settings.mockMode) {
    return enforceReplyPolicy(generateMockReplies({ mode, threadText }), { mode, settings });
  }

  if (!settings.apiKey) {
    throw new Error("Add your OpenAI API key in the ContextReply extension settings.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || SETTINGS_DEFAULTS.model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: buildMessages({ mode, threadText, settings })
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  const result = parseReplyResult(data.choices?.[0]?.message?.content || "");
  return enforceReplyPolicy(result, { mode, settings });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "contextreply.generate") return false;

    generateReplies(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });
}

if (typeof chrome !== "undefined" && chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "suggest-replies") return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, { type: "contextreply.shortcut" });
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    buildMessages,
    enforceReplyPolicy,
    formatUserContext,
    generateMockReplies,
    generateReplies,
    parseReplyResult,
    selectRelevantProducts,
    stripJsonFence,
    tokenize,
    violatesReplyPolicy
  };
}
