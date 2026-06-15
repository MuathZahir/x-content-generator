// Parity tests: the server-side policy/prompt port must behave exactly like
// the extension's original background.js implementation.
import assert from "node:assert/strict";
import {
  stripJsonFence,
  parseReplyResult,
  parseRefineResult,
  parseExtractResult,
  sanitizeReplyText,
  enforceReplyPolicy,
  violatesReplyPolicy
} from "../src/policy.js";
import {
  SYSTEM_PROMPT,
  POST_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT,
  formatUserContext,
  selectRelevantProducts,
  buildReplyUserText,
  buildPostInput,
  buildExtractInput
} from "../src/prompts.js";
import { filterImages } from "../src/openai.js";
import { buildSourceFromHtml, isPrivateIp } from "../src/fetchPage.js";
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

const twoProducts = "Spec tool\n- Requirements and verification workflows.\n\nRecipe app\n- Meal planning.";
// Default (hard gate): only the lexically overlapping product is surfaced.
assert.match(
  selectRelevantProducts(twoProducts, "AI agents need requirements and verification before coding."),
  /Spec tool/
);
// alwaysList (the reply path): every product is surfaced even with zero keyword
// overlap, so the model can judge semantic fit and promote when it genuinely
// applies. This is the fix for "I have to say promote my product".
const listedNoOverlap = selectRelevantProducts(twoProducts, "what are people using to plan dinners", { alwaysList: true });
assert.match(listedNoOverlap, /Spec tool/);
assert.match(listedNoOverlap, /Recipe app/);
assert.doesNotMatch(listedNoOverlap, /appears directly relevant/);
// alwaysList ranks the topically-closest product first.
const ranked = selectRelevantProducts(twoProducts, "meal planning recipe ideas", { alwaysList: true });
assert.ok(ranked.indexOf("Recipe app") < ranked.indexOf("Spec tool"));
// With no saved products there is nothing to surface.
assert.match(selectRelevantProducts("", "anything", { alwaysList: true }), /No saved products/);

// The reply prompt surfaces the product even when the thread shares no keywords,
// and tells the model to actively take a genuine opening (capped at one option).
const replyWithProduct = buildReplyUserText({
  note: "",
  threadText: "how do you all keep agent output from going off the rails",
  profile: { ...profile, products: "Spec tool\n- Requirements and verification workflows." },
  hasImages: false
});
assert.match(replyWithProduct, /Spec tool/);
assert.match(SYSTEM_PROMPT, /EXACTLY ONE/);

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

// --- Product extraction ----------------------------------------------------------

const product = parseExtractResult(JSON.stringify({
  name: "Penn",
  description: "Reply copilot for X.",
  mention: "threads about growing on X"
}));
assert.equal(product.name, "Penn");
assert.equal(product.mention, "threads about growing on X");
assert.throws(() => parseExtractResult(JSON.stringify({ name: "" })), /Could not determine/);
// Missing optional fields default to empty strings, not undefined.
assert.equal(parseExtractResult(JSON.stringify({ name: "X" })).description, "");

assert.match(EXTRACT_SYSTEM_PROMPT, /Never invent/);
assert.match(buildExtractInput({ source: "ACME ships invoices" }), /ACME ships invoices/);

// HTML signal extraction prefers owner-authored meta/JSON-LD over body text, so
// it works even when the visible body is sparse (SPA landing pages).
const rich = buildSourceFromHtml(
  '<html><head><title>Acme</title>' +
  '<meta property="og:description" content="Acme ships invoices fast.">' +
  '<script type="application/ld+json">{"@type":"Product","name":"Acme","description":"Invoicing for freelancers."}</script>' +
  '</head><body><nav>Home Pricing</nav><p>Acme is invoicing software for freelancers who hate admin.</p></body></html>'
);
assert.match(rich.source, /Acme/);
assert.match(rich.source, /Invoicing for freelancers/);
assert.equal(rich.thin, false);

// A JS-only shell with no meta and no body copy is reported as thin.
const thin = buildSourceFromHtml('<html><head><title>App</title></head><body><div id="root"></div></body></html>');
assert.equal(thin.thin, true);

// SSRF guard: loopback, private, link-local, and IPv6 local ranges are blocked;
// public addresses pass.
assert.equal(isPrivateIp("127.0.0.1"), true);
assert.equal(isPrivateIp("10.1.2.3"), true);
assert.equal(isPrivateIp("172.16.5.5"), true);
assert.equal(isPrivateIp("192.168.0.5"), true);
assert.equal(isPrivateIp("169.254.1.1"), true);
assert.equal(isPrivateIp("::1"), true);
assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
assert.equal(isPrivateIp("8.8.8.8"), false);

// Plan shape sanity.
assert.equal(PLANS.free.compose, false);
assert.equal(PLANS.pro.compose, true);
assert.ok(PLANS.pro.dailyCalls > PLANS.free.dailyCalls);
assert.ok(PLANS.free.models.every((m) => PLANS.pro.models.includes(m)));

console.log("server tests ok");
