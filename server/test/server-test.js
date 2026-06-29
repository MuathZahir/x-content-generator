// Parity tests: the server-side policy/prompt port must behave exactly like
// the extension's original background.js implementation.
import assert from "node:assert/strict";
import {
  stripJsonFence,
  parseReplyResult,
  parseRefineResult,
  parseExtractResult,
  parseDiscoverResult,
  sanitizeReplyText,
  enforceReplyPolicy,
  violatesReplyPolicy
} from "../src/policy.js";
import {
  SYSTEM_PROMPT,
  POST_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT,
  DISCOVER_SYSTEM_PROMPT,
  formatUserContext,
  selectRelevantProducts,
  buildReplyUserText,
  buildPostInput,
  buildExtractInput,
  buildDiscoverQuery,
  buildDiscoverInput
} from "../src/prompts.js";
import { filterImages, productNamesFromText, countProductMentions } from "../src/openai.js";
import { selectDiscoveries } from "../src/socialcrawl.js";
import { STRONG_PROMOTE_DIRECTIVE } from "../src/prompts.js";
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
// The product cap scales with fit (one for a loose opening, more when squarely
// on-topic) instead of a hard "exactly one" rule, but always keeps some options
// clean and never leans on the "this is why I built X" opener.
assert.match(SYSTEM_PROMPT, /Scale how many of the options mention the product/);
assert.match(SYSTEM_PROMPT, /this is why I built/i);

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

// --- Product-mention enforcement -------------------------------------------------

// The hard count rule lives in the prompt, and the server can count mentions to
// decide whether to force a stronger second pass.
assert.match(SYSTEM_PROMPT, /HARD RULE ON PRODUCT COUNT/);
assert.match(SYSTEM_PROMPT, /at least three/i);
assert.match(STRONG_PROMOTE_DIRECTIVE, /at least THREE/);

// Product names come from the first line of each saved block; tiny names dropped.
assert.deepEqual(
  productNamesFromText("Wasfa\nRecipe keeper.\n\nPenn\nReply copilot."),
  ["Wasfa", "Penn"]
);
assert.deepEqual(productNamesFromText("ai\nToo short to match."), []);

// Counting catches mentions by name (case-insensitive) and by own-link host.
assert.equal(
  countProductMentions(
    [
      { text: "wasfa ended up being nice for that" },
      { text: "just a clean human reply" },
      { text: "been using it, see heypenn.com" },
      { text: "another clean one" }
    ],
    ["Wasfa"],
    ["heypenn.com"]
  ),
  2
);

// The promote directive threads into the reply prompt only when supplied.
assert.match(
  buildReplyUserText({ note: "", threadText: "t", profile, hasImages: false, promoteDirective: STRONG_PROMOTE_DIRECTIVE }),
  /at least THREE/
);
assert.doesNotMatch(
  buildReplyUserText({ note: "", threadText: "t", profile, hasImages: false }),
  /at least THREE/
);

// --- Discovery (find X posts to reply to about a product) ------------------------

// The query is seeded from the product's "mention" rule (the strongest signal),
// falling back to description, then name.
const discoverProduct = { name: "Spec tool", description: "Keeps agents on spec.", mention: "someone whose AI agent keeps drifting off spec" };
const discoverQuery = buildDiscoverQuery(discoverProduct);
assert.match(discoverQuery, /Spec tool/);
assert.match(discoverQuery, /drifting off spec/);
assert.ok(discoverQuery.length <= 480);
assert.equal(buildDiscoverQuery(null), "");

// The curation prompt is told never to invent a URL and not to draft the reply.
assert.match(DISCOVER_SYSTEM_PROMPT, /Never (invent|fabricate)/i);
assert.match(DISCOVER_SYSTEM_PROMPT, /NOT a written reply|Do not draft the reply/i);

// The input carries the product, the user's profile, and only the returned posts.
const discoverInput = buildDiscoverInput({
  product: discoverProduct,
  profile,
  answer: "People keep complaining about agent drift.",
  sources: [{ url: "https://x.com/a/status/1", handle: "@a", text: "my agent keeps ignoring the spec" }]
});
assert.match(discoverInput, /Spec tool/);
assert.match(discoverInput, /status\/1/);
assert.match(discoverInput, /Never sound like these examples/);

// Parser keeps only candidates with a real X status URL and dedupes (it now caps
// at a wider 12 — the route enriches and trims that pool down to the few shown).
const discovered = parseDiscoverResult(JSON.stringify({
  candidates: [
    { url: "https://x.com/a/status/123", handle: "@a", snippet: "needs a spec tool", why: "asking", angle: "answer plainly" },
    { url: "https://twitter.com/b/status/456", handle: "@b", snippet: "agent drift pain", why: "venting", angle: "share experience" },
    { url: "https://x.com/a/status/123", handle: "@a", snippet: "dup", why: "dup", angle: "dup" },
    { url: "https://example.com/not-a-post", handle: "@c", snippet: "nope", why: "x", angle: "x" },
    { url: "https://x.com/d", handle: "@d", snippet: "profile link only", why: "x", angle: "x" }
  ]
}));
assert.equal(discovered.candidates.length, 2);
assert.equal(discovered.candidates[0].url, "https://x.com/a/status/123");
assert.equal(discovered.candidates[1].url, "https://twitter.com/b/status/456");
assert.throws(() => parseDiscoverResult("{}"), /invalid discovery/);
// Empty list is valid (no genuine openings found).
assert.equal(parseDiscoverResult(JSON.stringify({ candidates: [] })).candidates.length, 0);

// --- selectDiscoveries: enrich-merge, filter dead/buried, diversify, rank ---
const dcU = (n) => `https://x.com/x/status/${n}`;
const dcCandidates = [
  { url: dcU(1), handle: "@a", snippet: "s1", why: "w", angle: "g" },
  { url: dcU(2), handle: "@b", snippet: "s2", why: "w", angle: "g" },
  { url: dcU(3), handle: "@a", snippet: "s3", why: "w", angle: "g" }, // same author as #1
  { url: dcU(4), handle: "@c", snippet: "s4", why: "w", angle: "g" }, // buried/dead
  { url: dcU(5), handle: "@d", snippet: "s5", why: "w", angle: "g" }  // unknown metrics
];
const dcEnrich = new Map([
  [dcU(1), { handle: "@a", authorName: "Alice", verified: true, avatar: "", deleted: false, likes: 12, replies: 4, reposts: 1, views: 9000, postedAt: null }],
  [dcU(2), { handle: "@b", authorName: "Bob", verified: false, avatar: "", deleted: false, likes: 200, replies: 30, reposts: 5, views: 50000, postedAt: null }],
  [dcU(3), { handle: "@a", authorName: "Alice", verified: true, avatar: "", deleted: false, likes: 8, replies: 2, reposts: 0, views: 3000, postedAt: null }],
  [dcU(4), { handle: "@c", authorName: "Cara", verified: false, avatar: "", deleted: false, likes: 1, replies: 0, reposts: 0, views: 40, postedAt: null }]
  // dcU(5) intentionally absent: enrichment failed -> metrics unknown.
]);
const selected = selectDiscoveries(dcCandidates, dcEnrich, { limit: 3 });
// Live metrics merged onto candidates.
assert.equal(selected[0].url, dcU(2)); // highest traction ranks first
assert.equal(selected[0].likes, 200);
assert.equal(selected[0].authorName, "Bob");
// Variety: the two @a posts don't both appear before other authors are exhausted.
const handles = selected.map((c) => c.handle);
assert.equal(new Set(handles).size, handles.length, "no author repeats within the shown set");
// The dead/buried post (@c, 1 like / 0 replies / 40 views) is filtered out.
assert.ok(!selected.some((c) => c.url === dcU(4)), "buried 1-like post dropped");
// Unknown-metrics post is still eligible (shown without metrics, not dropped).
assert.equal(selectDiscoveries([dcCandidates[4]], new Map(), { limit: 3 })[0].likes, null);

// Deleted posts are always dropped.
const delMap = new Map([[dcU(1), { handle: "@a", deleted: true, likes: 99, replies: 9, views: 9000 }]]);
assert.equal(selectDiscoveries([dcCandidates[0]], delMap, { limit: 3 }).length, 0);

// Relax-on-empty: if nothing clears the visibility bar, show the best dim post
// rather than returning nothing.
const dimOnly = selectDiscoveries(
  [dcCandidates[3]],
  new Map([[dcU(4), { handle: "@c", deleted: false, likes: 1, replies: 0, views: 40 }]]),
  { limit: 3 }
);
assert.equal(dimOnly.length, 1, "low-engagement post shown as a last resort");

// Plan shape sanity.
assert.equal(PLANS.free.compose, false);
assert.equal(PLANS.pro.compose, true);
assert.ok(PLANS.pro.dailyCalls > PLANS.free.dailyCalls);
assert.ok(PLANS.free.models.every((m) => PLANS.pro.models.includes(m)));

// Layered abuse caps: Discover is gated off for free and bounded well under the
// daily call cap for pro; the monthly backstop is at least a day's allowance;
// every plan has a per-user daily token circuit breaker.
assert.equal(PLANS.free.discoverDaily, 0);
assert.ok(PLANS.pro.discoverDaily > 0 && PLANS.pro.discoverDaily < PLANS.pro.dailyCalls);
assert.ok(PLANS.pro.monthlyCalls >= PLANS.pro.dailyCalls);
assert.ok(PLANS.free.dailyTokenCeiling > 0 && PLANS.pro.dailyTokenCeiling > 0);

console.log("server tests ok");
