// Output parsing and the anti-AI-tell policy filter. Ported from the
// extension's background.js so hosted generation keeps the exact same quality
// bar. The server is authoritative: the extension no longer needs to filter.

export function stripJsonFence(raw) {
  return raw.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

export function parseReplyResult(raw, { requireGate = true } = {}) {
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

export function parseRefineResult(raw) {
  const parsed = JSON.parse(stripJsonFence(raw));
  if (!parsed || typeof parsed !== "object" || typeof parsed.text !== "string" || !parsed.text.trim()) {
    throw new Error("Model did not return a refined draft.");
  }
  return { text: parsed.text };
}

// Hard guard against the em/en dash tell, plus a few mechanical AI artifacts,
// regardless of what the model returns.
export function sanitizeReplyText(text) {
  return String(text)
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const BUILT_IN_FORBIDDEN = [
  "great point",
  "this is so true",
  "couldn't agree more",
  "love this take",
  "100%",
  "game changer",
  "game-changer",
  "let that sink in",
  "plot twist",
  "at the end of the day",
  "in a world where",
  "deep dive",
  "delve",
  "well said",
  "chef's kiss",
  "living rent free",
  "say it louder"
];

export function getForbiddenTerms(forbidden) {
  const custom = String(forbidden || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);

  return [...BUILT_IN_FORBIDDEN, ...custom].map((term) => term.toLowerCase());
}

// Structural AI tells we can catch mechanically. Each pattern targets a
// sentence template, not a vocabulary choice, to keep false positives rare.
const AI_TELL_PATTERNS = [
  { name: "contrast flip", pattern: /\bisn'?t\s+(?:just\s+|about\s+|only\s+)?[^.,;!?]{2,60}[,.;]\s*it'?s\b/i },
  { name: "contrast flip", pattern: /\b(?:is|are|was|were)\s+not\s+(?:just\s+|about\s+|only\s+)?[^.,;!?]{2,60}[,.;]\s*(?:it|that|this|they)\b/i },
  { name: "contrast flip", pattern: /\byou'?re not\s+[^.,;!?]{2,60}[,.;]\s*you'?re\b/i },
  { name: "contrast flip", pattern: /\bnot (?:just|only|about) [^.,;!?]{2,60}[,.;]\s*(?:it'?s|that'?s|they'?re)\b/i },
  { name: "contrast flip", pattern: /\bmore than just\b/i },
  { name: "contrast flip", pattern: /\bless about [^.,;!?]{2,60}more about\b/i },
  { name: "contrast flip", pattern: /, and then there'?s /i },
  { name: "setup-payoff opener", pattern: /\bhere'?s (?:the thing|what|why|how)\b/i },
  { name: "forced wrap-up", pattern: /\b(?:in conclusion|bottom line|the takeaway)\b/i }
];

export function violatesReplyPolicy(text, { forbidden } = {}) {
  const normalized = text.toLowerCase();
  if (/#\w+/.test(text)) return "hashtags are disabled";
  if (/https?:\/\/|www\./i.test(text)) return "links are disabled";

  const tell = AI_TELL_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (tell) return `AI tell: ${tell.name}`;

  const term = getForbiddenTerms(forbidden).find((banned) => normalized.includes(banned));
  return term ? `forbidden phrase: ${term}` : "";
}

export function enforceReplyPolicy(result, { forbidden } = {}) {
  const options = result.options
    .map((option) => ({ ...option, text: sanitizeReplyText(option.text) }))
    .filter((option) => !violatesReplyPolicy(option.text, { forbidden }));

  if (options.length < 3) {
    throw new Error("Generated replies violated too many safety rules. Try again.");
  }

  return { ...result, options };
}
