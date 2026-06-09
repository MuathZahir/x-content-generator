const SETTINGS_DEFAULTS = {
  apiKey: "",
  model: "gpt-5.4",
  mockMode: false,
  feedGrounding: true,
  webSearch: false,
  profile: "",
  products: "",
  voice: "",
  forbidden: "",
  badExamples: ""
};

function stripJsonFence(raw) {
  return raw.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

function parseReplyResult(raw, { requireGate = true } = {}) {
  const parsed = JSON.parse(stripJsonFence(raw));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned an invalid response.");
  }

  if (requireGate) {
    const gate = parsed.relevance_gate;
    if (!gate || typeof gate !== "object" || typeof gate.mention_product !== "boolean") {
      throw new Error("Model response is missing the relevance gate.");
    }
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

function parseRefineResult(raw) {
  const parsed = JSON.parse(stripJsonFence(raw));
  if (!parsed || typeof parsed !== "object" || typeof parsed.text !== "string" || !parsed.text.trim()) {
    throw new Error("Model did not return a refined draft.");
  }
  return { text: parsed.text };
}

// Hard guard against the em/en dash tell, plus a few mechanical AI artifacts,
// regardless of what the model returns.
function sanitizeReplyText(text) {
  return String(text)
    .replace(/\s*[—–]\s*/g, ", ") // em / en dash -> comma
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
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

function enforceReplyPolicy(result, { settings }) {
  const options = result.options
    .map((option) => ({ ...option, text: sanitizeReplyText(option.text) }))
    .filter((option) => !violatesReplyPolicy(option.text, settings));

  if (options.length < 3) {
    throw new Error("Generated replies violated too many safety rules. Try again.");
  }

  return {
    ...result,
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

// --- Mock generators (offline QA) -------------------------------------------

function generateMockReplies({ threadText }) {
  const mention = /agent|workflow|spec|requirement|verification|developer|code/i.test(threadText);

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
        label: "dry",
        text: "the part nobody budgets for is how long you spend deciding what done even means"
      },
      {
        label: "question",
        text: "what are you checking before you trust the output?"
      },
      {
        label: "blunt",
        text: mention
          ? "spec first, then let the agent run. i kept losing hours until i did that"
          : "fast is easy. fast and right is the whole game"
      }
    ]
  };
}

function generateMockPost({ idea }) {
  const topic = String(idea || "this").trim().slice(0, 80) || "this";
  return {
    options: [
      { label: "hook", text: `spent the week on ${topic} and the thing nobody tells you is how much of it is just deciding what to ignore` },
      { label: "take", text: `hot take on ${topic}: the tooling is fine, the hard part was always knowing what good looks like` },
      { label: "story", text: `tried ${topic} again after writing it off last year. it is genuinely different now and i feel a little dumb for waiting` }
    ]
  };
}

function mockRefine({ currentText, instruction }) {
  const tweak = String(instruction || "").trim();
  return { text: `${currentText} (${tweak || "refined"})` };
}

// --- Prompts ----------------------------------------------------------------

const ANTI_TELLS = `WRITE LIKE A REAL PERSON ON X
- One thought. Short. The best lines are usually a single sentence, rarely more than two.
- Have a real take, a real joke, or a genuine question. Pick a side. Do not hedge, do not be balanced, do not write a tiny essay.
- Talk how people type: contractions, casual phrasing, lowercase starts are fine, a missing period is fine, mild slang is fine.
- Dry, deadpan, or skeptical usually lands better than a joke that is trying hard. It is fine to be blunt or a little chaotic when it fits.
- Make the options feel like they came from different people. Vary the opening word and the structure of each one.

NEVER USE THESE AI TELLS. THIS IS THE MOST IMPORTANT PART.
1. The contrast / antithesis flip. BANNED in every form: "it's not X, it's Y", "you're not X, you're Y", "there's X, and then there's Y", "the real X isn't A, it's B", "X? more like Y". This is the single biggest giveaway. Do not use it even as a joke.
2. The rule of three. Do not list three things ("fast, cheap, and reliable"), do not build a sentence on a triad. One or two beats, never a tidy trio.
3. Em dashes or en dashes ( — – ). Never. Use a period or a comma, or split into two sentences.
4. Listicle / setup-payoff voice: "here's the thing", "here's what people miss", "here's what you need to know", "why it matters", "the crazy part is", "plot twist", "let that sink in", "make no mistake", "and that's the point".
5. Canned openers: "in today's world", "in a world where", "let's be honest", "let's dive in", "honestly?", "real talk", "hot take" as a literal label.
6. The "[Problem]? [Solution]." formula and the "it's more than just X, it's Y" formula.
7. Hype and marketing words: crucial, vital, essential, powerful, robust, seamless, leverage, unlock, harness, elevate, supercharge, revolutionize, game changer, deep dive, delve, navigate, landscape, realm, testament, foster, underscore, paramount, transformative.
8. Sentence stacking: a run of short, flat, equal-length declarative sentences with no rhythm ("This is a problem. It costs money. People are upset."). Vary sentence length and let it flow. If it reads like a press release or a LinkedIn post, redo it.
9. Forced wrap-ups: "at the end of the day", "ultimately", "in conclusion", "bottom line", "the takeaway is". Just make the point and stop.
10. Explaining or flagging the joke ("lol", "haha", "/s"). Trust the line.
11. Emoji as punctuation. At most one, only if a real person clearly would, usually zero.
12. Generic praise or engagement bait: "great point", "so true", "this", "underrated", "well said", "couldn't agree more".

ALSO
- No hashtags. No links.
- Match the person's voice and opinions below. Respect their forbidden phrases and the "never sound like this" anti-examples.`;

const SYSTEM_PROMPT = `You write replies on X (Twitter) as a specific person, whose profile is given below. The replies must be indistinguishable from a sharp human who actually uses X. Most AI replies are instantly recognizable and get ignored or mocked. Your only job is to not sound like that.

${ANTI_TELLS}

REPLY SPECIFICS
- React to THIS specific post. Grab an exact detail, number, name, or what an attached image shows. If the reply could sit under a different tweet, it is wrong, rewrite it.
- If the person left a note for this reply, follow it, but never at the cost of sounding human.

PRODUCT MENTIONS
- Only mention one of the user's products when the product/project field contains a genuinely relevant match AND the post makes the mention feel natural and unforced. Otherwise set mention_product to false and just write a good reply. A forced plug is worse than no mention.

Return only valid JSON in exactly this shape:
{
  "relevance_gate": {
    "mention_product": false,
    "reason": "short reason a product mention does or does not fit here",
    "mention_style": "if mentioning, one line on how it should land; else empty"
  },
  "options": [
    {"label": "one or two lowercase words tagging the angle", "text": "the reply"},
    {"label": "...", "text": "the reply"},
    {"label": "...", "text": "the reply"}
  ]
}
Always return 3 to 5 options.`;

const POST_SYSTEM_PROMPT = `You write original posts on X (Twitter) as a specific person, whose profile is given below. The posts must read like a sharp human who actually uses X, and they must feel TIMELY, not generic or evergreen.

${ANTI_TELLS}

POST SPECIFICS
- Start with a strong first line. The opening has to earn the next line.
- One concrete idea per post: an opinion, a sharp observation, a short story, or a real question. Not a summary, not a thread, not a list.
- Use the supplied current context (today's date, the posts currently in my feed, what is trending, and any web results) to anchor the post in what is actually happening right now. Reference real, current developments where it fits.
- Never fabricate facts, fake quotes, invented numbers, or events you are not sure happened. If you are unsure, stay general rather than making something up. Only state specifics you can support from the supplied context or web results.
- Build from the user's idea below. The idea is the seed; sharpen it, do not just restate it.

Return only valid JSON in exactly this shape:
{
  "options": [
    {"label": "one or two lowercase words tagging the angle", "text": "the post"},
    {"label": "...", "text": "the post"},
    {"label": "...", "text": "the post"}
  ]
}
Always return 3 to 5 distinct drafts that take genuinely different angles.`;

const REFINE_SYSTEM_PROMPT = `You refine a single draft of an X (Twitter) ${"post or reply"} as a specific person, whose profile is given below. You are given the current draft and an instruction. Rewrite the draft to satisfy the instruction while keeping it human.

${ANTI_TELLS}

REFINE SPECIFICS
- Apply the new instruction, and keep any earlier instructions still satisfied.
- Change only what the instruction asks for. Keep the core idea unless told otherwise.
- Return the single best version. Do not return options or commentary.

Return only valid JSON in exactly this shape:
{ "text": "the refined draft" }`;

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

// --- Reply generation (Chat Completions) ------------------------------------

function buildUserText({ note, threadText, settings, hasImages }) {
  const trimmedNote = String(note || "").trim();
  const noteBlock = trimmedNote
    ? `\n\nMy note for this reply (follow it, but stay human):
${trimmedNote}`
    : "";

  const imageNote = hasImages
    ? "\n\nImage(s) from the post are attached below. Read them and let them shape the reply."
    : "";

  return `${formatUserContext(settings, threadText)}${noteBlock}

The post I am replying to (last block is the one I am replying to):
${threadText}${imageNote}

Write the reply options now.`;
}

function buildMessages({ note, threadText, settings, images }) {
  const hasImages = Array.isArray(images) && images.length > 0;
  const userText = buildUserText({ note, threadText, settings, hasImages });

  const userContent = hasImages
    ? [
        { type: "text", text: userText },
        ...images.map((url) => ({ type: "image_url", image_url: { url, detail: "auto" } }))
      ]
    : userText;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent }
  ];
}

function isGpt5(model) {
  return /^gpt-5/i.test(model);
}

async function generateReplies({ note, threadText, images }) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  if (settings.mockMode) {
    return enforceReplyPolicy(generateMockReplies({ note, threadText }), { settings });
  }

  if (!settings.apiKey) {
    throw new Error("Add your OpenAI API key in the ContextReply extension settings.");
  }

  const model = settings.model || SETTINGS_DEFAULTS.model;
  const body = {
    model,
    response_format: { type: "json_object" },
    messages: buildMessages({ note, threadText, settings, images })
  };

  // GPT-5 family rejects a custom temperature; older models accept it and a
  // higher value buys us more variety between options.
  if (!isGpt5(model)) {
    body.temperature = 0.9;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  const result = parseReplyResult(data.choices?.[0]?.message?.content || "");
  return enforceReplyPolicy(result, { settings });
}

// --- Post composition (Responses API, optional web search) ------------------

function formatFeed(feed) {
  return (Array.isArray(feed) ? feed : [])
    .filter((post) => post && post.text)
    .map((post) => {
      const who = [post.display, post.handle].filter(Boolean).join(" ");
      return `${who ? who + ": " : ""}${String(post.text).slice(0, 280)}`;
    })
    .join("\n");
}

function buildPostInput({ idea, feed, trends, today, settings }) {
  const blocks = [formatUserContext(settings)];

  if (today) {
    blocks.push(`Today's date: ${today}`);
  }

  if (settings.feedGrounding) {
    const feedText = formatFeed(feed);
    if (feedText) {
      blocks.push(`Posts currently in my X feed (what my circle is talking about right now):\n${feedText}`);
    }
    const trendList = (Array.isArray(trends) ? trends : []).filter(Boolean);
    if (trendList.length) {
      blocks.push(`Trending now:\n${trendList.map((t) => `- ${t}`).join("\n")}`);
    }
  }

  blocks.push(`My idea for the post:\n${String(idea || "").trim()}`);
  blocks.push("Write 3-5 distinct, timely post drafts now.");

  return blocks.join("\n\n");
}

function extractResponsesText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      const part = item.content.find((c) => c?.type === "output_text" && typeof c.text === "string");
      if (part) return part.text;
    }
  }
  return "";
}

async function callResponses({ instructions, userText, model, webSearch, apiKey }) {
  const body = {
    model,
    instructions,
    input: [
      { role: "user", content: [{ type: "input_text", text: userText }] }
    ],
    text: { format: { type: "json_object" } }
  };

  if (webSearch) {
    body.tools = [{ type: "web_search" }];
    body.tool_choice = "auto";
  }

  if (isGpt5(model)) {
    body.reasoning = { effort: "low" };
  } else {
    body.temperature = 0.9;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  return response.json();
}

async function generatePost({ idea, feed, trends }) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  if (settings.mockMode) {
    return enforceReplyPolicy(generateMockPost({ idea }), { settings });
  }

  if (!settings.apiKey) {
    throw new Error("Add your OpenAI API key in the ContextReply extension settings.");
  }

  const model = settings.model || SETTINGS_DEFAULTS.model;
  const today = new Date().toISOString().slice(0, 10);
  const userText = buildPostInput({ idea, feed, trends, today, settings });

  const data = await callResponses({
    instructions: POST_SYSTEM_PROMPT,
    userText,
    model,
    webSearch: Boolean(settings.webSearch),
    apiKey: settings.apiKey
  });

  const result = parseReplyResult(extractResponsesText(data), { requireGate: false });
  return enforceReplyPolicy(result, { settings });
}

// --- Draft refinement (Chat Completions) ------------------------------------

function buildRefineMessages({ kind, currentText, instruction, baseContext, images, history, settings }) {
  const hasImages = kind === "reply" && Array.isArray(images) && images.length > 0;

  const baseBlock = kind === "post"
    ? `My original idea:\n${baseContext || "(none given)"}`
    : `The post I am replying to:\n${baseContext || "(none captured)"}`;

  const earlier = (Array.isArray(history) ? history : [])
    .map((turn) => `- ${turn.instruction}`)
    .filter(Boolean)
    .join("\n");
  const earlierBlock = earlier ? `\n\nEarlier instructions to keep satisfied:\n${earlier}` : "";

  const imageNote = hasImages
    ? "\n\nImage(s) from the original post are attached below; keep the refined draft consistent with them."
    : "";

  const userText = `${formatUserContext(settings, baseContext || "")}

${baseBlock}

Current draft:
${currentText}${earlierBlock}

New instruction:
${instruction}${imageNote}

Return the refined draft as JSON now.`;

  const userContent = hasImages
    ? [
        { type: "text", text: userText },
        ...images.map((url) => ({ type: "image_url", image_url: { url, detail: "auto" } }))
      ]
    : userText;

  return [
    { role: "system", content: REFINE_SYSTEM_PROMPT },
    { role: "user", content: userContent }
  ];
}

async function refineDraft({ kind, currentText, instruction, baseContext, images, history }) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);

  let text;
  if (settings.mockMode) {
    text = mockRefine({ currentText, instruction }).text;
  } else {
    if (!settings.apiKey) {
      throw new Error("Add your OpenAI API key in the ContextReply extension settings.");
    }

    const model = settings.model || SETTINGS_DEFAULTS.model;
    const body = {
      model,
      response_format: { type: "json_object" },
      messages: buildRefineMessages({ kind, currentText, instruction, baseContext, images, history, settings })
    };
    if (!isGpt5(model)) {
      body.temperature = 0.8;
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 240)}`);
    }

    const data = await response.json();
    text = parseRefineResult(data.choices?.[0]?.message?.content || "").text;
  }

  const cleaned = sanitizeReplyText(text);
  const violation = violatesReplyPolicy(cleaned, settings);
  if (violation) {
    throw new Error(`Refined draft broke a rule (${violation}). Try a different instruction.`);
  }

  return { text: cleaned };
}

// --- Messaging --------------------------------------------------------------

const HANDLERS = {
  "contextreply.generate": generateReplies,
  "contextreply.compose": generatePost,
  "contextreply.refine": refineDraft
};

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = HANDLERS[message?.type];
    if (!handler) return false;

    handler(message)
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
    buildPostInput,
    buildRefineMessages,
    callResponses,
    enforceReplyPolicy,
    extractResponsesText,
    formatUserContext,
    generateMockPost,
    generateMockReplies,
    generatePost,
    generateReplies,
    mockRefine,
    parseRefineResult,
    parseReplyResult,
    refineDraft,
    sanitizeReplyText,
    selectRelevantProducts,
    stripJsonFence,
    tokenize,
    violatesReplyPolicy
  };
}
