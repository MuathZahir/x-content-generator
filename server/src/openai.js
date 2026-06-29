// OpenAI calls live exclusively here, with the server-held key. The extension
// never sees a provider key or a raw provider response.
import {
  SYSTEM_PROMPT,
  POST_SYSTEM_PROMPT,
  REFINE_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT,
  DISCOVER_SYSTEM_PROMPT,
  STRONG_PROMOTE_DIRECTIVE,
  buildReplyUserText,
  buildPostInput,
  buildRefineUserText,
  buildExtractInput,
  buildDiscoverInput
} from "./prompts.js";
import {
  parseReplyResult,
  parseRefineResult,
  parseExtractResult,
  parseDiscoverResult,
  enforceReplyPolicy,
  extractHosts,
  sanitizeReplyText,
  violatesReplyPolicy
} from "./policy.js";
import { addTokens } from "./db.js";

const OPENAI_BASE = "https://api.openai.com/v1";

// Per-call token accounting. Both Chat Completions ({prompt,completion}_tokens)
// and the Responses API ({input,output}_tokens) report usage; we log it per call
// (route, model, user, in/out/total) for cost visibility and accumulate it
// against the user's daily token ceiling. `meta` carries { userId, route } from
// the request handler; it is best-effort and never blocks generation.
function recordUsage(meta, model, json) {
  const u = json?.usage;
  if (!u) return;
  const input = u.input_tokens ?? u.prompt_tokens ?? 0;
  const output = u.output_tokens ?? u.completion_tokens ?? 0;
  const total = u.total_tokens ?? input + output;
  if (!total) return;
  console.log(JSON.stringify({
    tok: true,
    route: meta?.route || "",
    model,
    user: meta?.userId || null,
    in: input,
    out: output,
    total
  }));
  if (meta?.userId) addTokens(meta.userId, total).catch(() => {});
}

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const error = new Error("Generation is not configured yet (missing provider key).");
    error.code = "model_unavailable";
    throw error;
  }
  return key;
}

function isGpt5(model) {
  return /^gpt-5/i.test(model);
}

async function openaiFetch(path, body, meta) {
  const response = await fetch(`${OPENAI_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    // Never forward provider error bodies to the client; they can include
    // request echoes and key hints. Log status only.
    const detail = await response.text().catch(() => "");
    console.error(`openai ${path} failed: ${response.status} ${detail.slice(0, 200)}`);
    const error = new Error(
      response.status === 429
        ? "The model is busy right now. Try again in a few seconds."
        : "Generation failed upstream. Try again."
    );
    error.code = response.status === 429 ? "rate_limited" : "generation_failed";
    error.upstream = true;
    throw error;
  }

  const json = await response.json();
  recordUsage(meta, body.model, json);
  return json;
}

// Quality failures (bad JSON, too many filtered options) get one silent
// retry. Upstream/provider errors surface immediately.
async function withQualityRetry(attempt) {
  let lastError;
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (error.upstream || error.code === "model_unavailable") throw error;
      lastError = error;
    }
  }
  throw lastError;
}

// Only allow image refs the extension legitimately produces: X media CDN URLs
// (post photos) and small data-URL JPEG/PNG/WebP (product shots).
const MAX_IMAGES = 4;
const MAX_DATA_URL_LENGTH = 400_000;

export function filterImages(images) {
  return (Array.isArray(images) ? images : [])
    .filter((url) => typeof url === "string")
    .filter((url) =>
      /^https:\/\/(pbs|ton)\.twimg\.com\//.test(url) ||
      (/^data:image\/(jpeg|png|webp);base64,/.test(url) && url.length <= MAX_DATA_URL_LENGTH)
    )
    .slice(0, MAX_IMAGES);
}

// Product names to look for in generated replies: the first line of each saved
// product block (formatProductBlock writes the name first). Short tokens are
// dropped so a 2-letter name can't false-match common words.
export function productNamesFromText(productsText) {
  return String(productsText || "")
    .split(/\n\s*\n/)
    .map((block) => block.trim().split(/\r?\n/)[0].trim())
    .filter((name) => name.length >= 3);
}

// How many of the options actually surface the product, by name or own link.
export function countProductMentions(options, names, hosts) {
  return (options || []).filter((option) => {
    const text = String(option.text || "").toLowerCase();
    return (
      names.some((name) => text.includes(name.toLowerCase())) ||
      hosts.some((host) => text.includes(host))
    );
  }).length;
}

// On a direct fit, aim for at least this many of the five options to mention the
// product. The first pass usually under-promotes (the model leans toward sounding
// un-salesy), so when the model itself says the product fits but barely works it
// in, we re-run once with a forceful directive and keep whichever set promotes
// more. Never hard-fails: an under-promoting set still beats no replies.
const PROMOTE_TARGET = 3;

export async function generateReplies({ note, threadText, images, profile, model, meta }) {
  const safeImages = filterImages(images);
  const allowedHosts = extractHosts(profile.products);
  const productNames = productNamesFromText(profile.products);

  async function run(promoteDirective) {
    const userText = buildReplyUserText({
      note,
      threadText,
      profile,
      hasImages: safeImages.length > 0,
      promoteDirective
    });
    const userContent = safeImages.length
      ? [
          { type: "text", text: userText },
          ...safeImages.map((url) => ({ type: "image_url", image_url: { url, detail: "auto" } }))
        ]
      : userText;

    const body = {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
    };
    // Replies are short; low reasoning effort keeps output tokens (billed at the
    // expensive rate) down on the highest-volume path. Matches the effort the
    // Responses-API endpoints already set, instead of defaulting to medium.
    if (isGpt5(model)) body.reasoning_effort = "low";
    else body.temperature = 0.9;

    return withQualityRetry(async () => {
      const data = await openaiFetch("/chat/completions", body, meta);
      const result = parseReplyResult(data.choices?.[0]?.message?.content || "");
      // Replies may carry a link, but only to the user's own products (the hosts
      // named in their saved product blocks). Any other URL is still a spam tell.
      return enforceReplyPolicy(result, { forbidden: profile.forbidden, allowedHosts });
    });
  }

  const result = await run("");

  // The model claimed the product fits but barely promoted it: push once more.
  const wantsPromotion = result.relevance_gate?.mention_product && productNames.length;
  if (wantsPromotion && countProductMentions(result.options, productNames, allowedHosts) < PROMOTE_TARGET) {
    const retry = await run(STRONG_PROMOTE_DIRECTIVE).catch(() => null);
    if (
      retry &&
      countProductMentions(retry.options, productNames, allowedHosts) >
        countProductMentions(result.options, productNames, allowedHosts)
    ) {
      return retry;
    }
  }

  return result;
}

// json_schema structured output, unlike json_object JSON mode, is compatible
// with the web_search tool, and it is OpenAI's preferred structured mode.
const POST_OUTPUT_FORMAT = {
  type: "json_schema",
  name: "post_options",
  strict: true,
  schema: {
    type: "object",
    properties: {
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            text: { type: "string" }
          },
          required: ["label", "text"],
          additionalProperties: false
        }
      }
    },
    required: ["options"],
    additionalProperties: false
  }
};

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

export async function generatePost({ idea, feed, trends, product, profile, feedGrounding, model, webSearch, meta }) {
  const today = new Date().toISOString().slice(0, 10);
  const userText = buildPostInput({ idea, feed, trends, today, profile, product, feedGrounding });

  const productImages = filterImages(
    (product && Array.isArray(product.media) ? product.media : [])
      .filter((item) => item && item.type === "image")
      .map((item) => item.dataUrl)
  );

  const content = [{ type: "input_text", text: userText }];
  for (const url of productImages) {
    content.push({ type: "input_image", image_url: url, detail: "auto" });
  }

  const body = {
    model,
    instructions: POST_SYSTEM_PROMPT,
    input: [{ role: "user", content }],
    text: { format: POST_OUTPUT_FORMAT }
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

  return withQualityRetry(async () => {
    const data = await openaiFetch("/responses", body, meta);
    const result = parseReplyResult(extractResponsesText(data), { requireGate: false });
    // Promote/compose is the product-promotion surface: links to the user's
    // own product are the point, not a spam tell (unlike replies).
    return enforceReplyPolicy(result, { forbidden: profile.forbidden, allowLinks: true });
  });
}

const EXTRACT_OUTPUT_FORMAT = {
  type: "json_schema",
  name: "product_details",
  strict: true,
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      mention: { type: "string" }
    },
    required: ["name", "description", "mention"],
    additionalProperties: false
  }
};

// Distills already-fetched page text (or pasted notes) into a product profile.
// Always runs on the cheap model; the caller fixes it regardless of plan.
export async function extractProduct({ source, model, meta }) {
  const body = {
    model,
    instructions: EXTRACT_SYSTEM_PROMPT,
    input: [{ role: "user", content: [{ type: "input_text", text: buildExtractInput({ source }) }] }],
    text: { format: EXTRACT_OUTPUT_FORMAT }
  };

  if (isGpt5(model)) {
    body.reasoning = { effort: "low" };
  } else {
    body.temperature = 0.3;
  }

  return withQualityRetry(async () => {
    const data = await openaiFetch("/responses", body, meta);
    return parseExtractResult(extractResponsesText(data));
  });
}

const DISCOVER_OUTPUT_FORMAT = {
  type: "json_schema",
  name: "discovery_candidates",
  strict: true,
  schema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            handle: { type: "string" },
            snippet: { type: "string" },
            why: { type: "string" },
            angle: { type: "string" }
          },
          required: ["url", "handle", "snippet", "why", "angle"],
          additionalProperties: false
        }
      }
    },
    required: ["candidates"],
    additionalProperties: false
  }
};

// Curates raw SocialCrawl X search results into reply-worthy candidates for one
// of the maker's products. This only ranks/filters/explains what the search
// already returned; it never writes a reply and never invents a URL (the parser
// drops any candidate without a real post link as a second guard).
export async function curateDiscoveries({ product, profile, answer, sources, model, meta }) {
  const userText = buildDiscoverInput({ product, profile, answer, sources });

  const body = {
    model,
    instructions: DISCOVER_SYSTEM_PROMPT,
    input: [{ role: "user", content: [{ type: "input_text", text: userText }] }],
    text: { format: DISCOVER_OUTPUT_FORMAT }
  };

  if (isGpt5(model)) {
    body.reasoning = { effort: "low" };
  } else {
    body.temperature = 0.3;
  }

  return withQualityRetry(async () => {
    const data = await openaiFetch("/responses", body, meta);
    return parseDiscoverResult(extractResponsesText(data));
  });
}

export async function refineDraft({ kind, currentText, instruction, baseContext, images, history, profile, model, meta }) {
  const safeImages = kind === "reply" ? filterImages(images) : [];
  const userText = buildRefineUserText({
    kind,
    currentText,
    instruction,
    baseContext,
    history,
    profile,
    hasImages: safeImages.length > 0
  });

  const userContent = safeImages.length
    ? [
        { type: "text", text: userText },
        ...safeImages.map((url) => ({ type: "image_url", image_url: { url, detail: "auto" } }))
      ]
    : userText;

  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: REFINE_SYSTEM_PROMPT },
      { role: "user", content: userContent }
    ]
  };
  if (isGpt5(model)) body.reasoning_effort = "low";
  else body.temperature = 0.8;

  const data = await openaiFetch("/chat/completions", body, meta);
  const { text } = parseRefineResult(data.choices?.[0]?.message?.content || "");

  const cleaned = sanitizeReplyText(text);
  // Refining a post keeps the full link allowance; refining a reply keeps the
  // narrower one (the user's own product links only), matching generateReplies.
  const violation = violatesReplyPolicy(cleaned, {
    forbidden: profile.forbidden,
    allowLinks: kind === "post",
    allowedHosts: extractHosts(profile.products)
  });
  if (violation) {
    const error = new Error(`Refined draft broke a rule (${violation}). Try a different instruction.`);
    error.code = "safety_filter_failed";
    throw error;
  }

  return { text: cleaned };
}
