// Parity tests: the server-side policy/prompt port must behave exactly like
// the extension's original background.js implementation.
import assert from "node:assert/strict";
import {
  stripJsonFence,
  parseReplyResult,
  parseRefineResult,
  sanitizeReplyText,
  enforceReplyPolicy,
  violatesReplyPolicy
} from "../src/policy.js";
import {
  SYSTEM_PROMPT,
  POST_SYSTEM_PROMPT,
  formatUserContext,
  selectRelevantProducts,
  buildReplyUserText,
  buildPostInput
} from "../src/prompts.js";
import { filterImages } from "../src/openai.js";
import { PLANS } from "../src/quota.js";

assert.equal(stripJsonFence("```json\n{\"ok\":true}\n```"), '{"ok":true}');

const valid = parseReplyResult(JSON.stringify({
  relevance_gate: { mention_product: false, reason: "r", mention_style: "" },
  options: [
    { label: "a", text: "The missing piece is usually the verification loop." },
    { label: "b", text: "How are you deciding what counts as done?" },
    { label: "c", text: "Specs matter more than prompt cleverness here." }
  ]
}));
assert.equal(valid.options.length, 3);
assert.throws(() => parseReplyResult("{}"), /relevance gate/);

// Load-bearing prompt phrases (mirrored by repo-root scripts/validate.js).
assert.match(SYSTEM_PROMPT, /product\/project field contains a genuinely relevant match/);
assert.match(SYSTEM_PROMPT, /contrast \/ antithesis flip/i);
assert.match(POST_SYSTEM_PROMPT, /Never fabricate facts/);

const profile = {
  context: "Builder focused on agent workflows.",
  products: "Spec tool\n- Requirements and verification workflows.",
  voice: "Direct.",
  forbidden: "No generic praise.",
  badExamples: "Great point!"
};

assert.match(formatUserContext(profile), /Never sound like these examples/);
assert.match(
  selectRelevantProducts(
    "Spec tool\n- Requirements and verification workflows.\n\nRecipe app\n- Meal planning.",
    "AI agents need requirements and verification before coding."
  ),
  /Spec tool/
);

const replyText = buildReplyUserText({
  note: "be a bit sarcastic",
  threadText: "AI coding agents fail when tasks are vague.",
  profile,
  hasImages: false
});
assert.match(replyText, /be a bit sarcastic/);
assert.match(replyText, /AI coding agents fail/);

const postInput = buildPostInput({
  idea: "shipped a thing",
  feed: [{ display: "Dev", handle: "@dev", text: "gpt-5.4 just dropped" }],
  trends: ["AI agents"],
  today: "2026-06-10",
  profile,
  feedGrounding: true
});
assert.match(postInput, /gpt-5\.4 just dropped/);
const postInputOff = buildPostInput({ idea: "x", feed: [{ text: "secret" }], trends: ["t"], today: "", profile, feedGrounding: false });
assert.doesNotMatch(postInputOff, /secret/);

// Policy filter parity.
const filtered = enforceReplyPolicy({
  relevance_gate: { mention_product: true, reason: "r", mention_style: "s" },
  options: [
    { label: "bad", text: "Great point! https://example.com" },
    { label: "good", text: "The missing piece is usually verification." },
    { label: "q", text: "What would you use as the done criteria?" },
    { label: "d", text: "This needs a spec before another prompt tweak." }
  ]
}, { forbidden: "No generic praise." });
assert.equal(filtered.options.length, 3);

assert.equal(sanitizeReplyText("fine — but no dash"), "fine, but no dash");
assert.match(violatesReplyPolicy("this isn't magic, it's discipline"), /AI tell/);
assert.match(violatesReplyPolicy("here's the thing about agents"), /AI tell/);
assert.match(violatesReplyPolicy("#winning all day"), /hashtags/);
assert.equal(violatesReplyPolicy("a normal human reply"), "");
assert.equal(parseRefineResult('{"text":"refined"}').text, "refined");

// Image allowlist: X CDN and small data URLs only.
assert.deepEqual(
  filterImages([
    "https://pbs.twimg.com/media/abc?format=jpg&name=large",
    "https://evil.example.com/x.png",
    "data:image/jpeg;base64,aGk=",
    "data:text/html;base64,aGk=",
    "javascript:alert(1)"
  ]),
  ["https://pbs.twimg.com/media/abc?format=jpg&name=large", "data:image/jpeg;base64,aGk="]
);

// Plan shape sanity.
assert.equal(PLANS.free.compose, false);
assert.equal(PLANS.pro.compose, true);
assert.ok(PLANS.pro.dailyCalls > PLANS.free.dailyCalls);
assert.ok(PLANS.free.models.every((m) => PLANS.pro.models.includes(m)));

console.log("server tests ok");
