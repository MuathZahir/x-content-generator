// OpenAI calls live exclusively here, with the server-held key. The extension
// never sees a provider key or a raw provider response.
import {
  SYSTEM_PROMPT,
  POST_SYSTEM_PROMPT,
  REFINE_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT,
  buildReplyUserText,
  buildPostInput,
  buildRefineUserText,
  buildExtractInput
} from "./prompts.js";
import {
  parseReplyResult,
  parseRefineResult,
  parseExtractResult,
  enforceReplyPolicy,
  extractHosts,
  sanitizeReplyText,
  violatesReplyPolicy
} from "./policy.js";

const OPENAI_BASE = "https://api.openai.com/v1";

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

async function openaiFetch(path, body) {
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

  return response.json();
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

export async function generateReplies({ note, threadText, images, profile, model }) {
  const safeImages = filterImages(images);
  const userText = buildReplyUserText({ note, threadText, profile, hasImages: safeImages.length > 0 });

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
  if (!isGpt5(model)) body.temperature = 0.9;

  return withQualityRetry(async () => {
    const data = await openaiFetch("/chat/completions", body);
    const result = parseReplyResult(data.choices?.[0]?.message?.content || "");
    // Replies may carry a link, but only to the user's own products (the hosts
    // named in their saved product blocks). Any other URL is still a spam tell.
    return enforceReplyPolicy(result, {
      forbidden: profile.forbidden,
      allowedHosts: extractHosts(profile.products)
    });
  });
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

export async function generatePost({ idea, feed, trends, product, profile, feedGrounding, model, webSearch }) {
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
    const data = await openaiFetch("/responses", body);
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
export async function extractProduct({ source, model }) {
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
    const data = await openaiFetch("/responses", body);
    return parseExtractResult(extractResponsesText(data));
  });
}

export async function refineDraft({ kind, currentText, instruction, baseContext, images, history, profile, model }) {
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
  if (!isGpt5(model)) body.temperature = 0.8;

  const data = await openaiFetch("/chat/completions", body);
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
