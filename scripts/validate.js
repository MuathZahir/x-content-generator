const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildMessages,
  buildPostInput,
  enforceReplyPolicy,
  extractResponsesText,
  formatUserContext,
  generateMockPost,
  generateMockReplies,
  parseRefineResult,
  parseReplyResult,
  selectRelevantProducts,
  stripJsonFence
} = require("../background.js");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, packageJson.version);
assert.ok(manifest.permissions.includes("storage"));
assert.ok(manifest.permissions.includes("clipboardWrite"));
assert.ok(manifest.permissions.includes("tabs"));
assert.ok(!manifest.permissions.includes("activeTab"));
assert.equal(manifest.commands["suggest-replies"].suggested_key.default, "Alt+Shift+R");

const referencedFiles = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  ...manifest.content_scripts.flatMap((script) => [...script.js, ...script.css])
];

for (const file of referencedFiles) {
  assert.ok(fs.existsSync(file), `Missing manifest reference: ${file}`);
}

for (const htmlFile of ["popup.html", "options.html", "tests/mock-x-page.html", "tests/mock-options-page.html"]) {
  const html = fs.readFileSync(htmlFile, "utf8");
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(https?:|data:|#)/.test(reference)) continue;
    const resolved = path.resolve(path.dirname(htmlFile), reference);
    assert.ok(fs.existsSync(resolved), `Missing HTML reference from ${htmlFile}: ${reference}`);
  }
}

assert.match(fs.readFileSync("tests/mock-x-page.html", "utf8"), /Add your OpenAI API key in the ContextReply extension settings/);

const optionsSource = fs.readFileSync("options.js", "utf8");
assert.match(optionsSource, /delete exported\.apiKey/);
assert.match(optionsSource, /syncMockModeNote/);
assert.match(optionsSource, /resetDefaults/);
assert.match(fs.readFileSync("options.html", "utf8"), /Profile exports omit the key/);
assert.match(fs.readFileSync("options.html", "utf8"), /Revoke and replace any key/);
assert.match(fs.readFileSync("options.html", "utf8"), /does not call OpenAI/);
assert.match(fs.readFileSync("options.html", "utf8"), /Reset defaults/);
assert.match(fs.readFileSync("popup.html", "utf8"), /X safety guide/);
assert.ok(fs.existsSync("docs/release-checklist.md"));
assert.ok(fs.existsSync("docs/architecture.md"));
assert.ok(fs.existsSync("docs/chrome-store-listing.md"));
assert.ok(fs.existsSync("docs/completion-audit.md"));
assert.ok(fs.existsSync("docs/developer-guide.md"));
assert.ok(fs.existsSync("docs/hosted-api-contract.md"));
assert.ok(fs.existsSync("docs/production-api-strategy.md"));
assert.ok(fs.existsSync("docs/profile-guide.md"));
assert.ok(fs.existsSync("docs/live-qa-playbook.md"));
assert.ok(fs.existsSync("docs/risk-register.md"));
assert.ok(fs.existsSync("docs/x-safety-guide.md"));
assert.ok(fs.existsSync("CHANGELOG.md"));
assert.match(fs.readFileSync("docs/production-api-strategy.md", "utf8"), /proxy model calls through a minimal backend/);
assert.match(fs.readFileSync("docs/architecture.md", "utf8"), /Data Flow/);
assert.match(fs.readFileSync("docs/chrome-store-listing.md", "utf8"), /Permission justification/);
assert.match(fs.readFileSync("docs/completion-audit.md", "utf8"), /Remaining Gaps/);
assert.match(fs.readFileSync("docs/developer-guide.md", "utf8"), /npm run release:check/);
assert.match(fs.readFileSync("docs/hosted-api-contract.md", "utf8"), /POST \/api\/replies\/generate/);
assert.match(fs.readFileSync("docs/profile-guide.md", "utf8"), /Never sound like this/);
assert.match(fs.readFileSync("docs/live-qa-playbook.md", "utf8"), /authenticated X/i);
assert.match(fs.readFileSync("docs/risk-register.md", "utf8"), /X\/Twitter DOM changes/);
assert.match(fs.readFileSync("docs/x-safety-guide.md", "utf8"), /Safe Operating Rules/);
assert.match(fs.readFileSync("CHANGELOG.md", "utf8"), /0\.1\.0 - 2026-05-03/);
assert.match(fs.readFileSync("CHANGELOG.md", "utf8"), new RegExp(`## ${packageJson.version.replaceAll(".", "\\.")} - `));

const contentSource = fs.readFileSync("content.js", "utf8");
assert.match(contentSource, /document\.execCommand\("copy"\)/);
assert.match(contentSource, /Copy failed/);

assert.match(packageJson.scripts.validate, /scripts\/openai-smoke\.js/);
assert.match(packageJson.scripts.validate, /scripts\/package-extension\.js/);
assert.match(packageJson.scripts.validate, /scripts\/package-integrity-test\.js/);
assert.match(packageJson.scripts.validate, /scripts\/safety-audit\.js/);
assert.match(packageJson.scripts.validate, /scripts\/content-dom-test\.js/);
assert.match(packageJson.scripts.validate, /scripts\/options-dom-test\.js/);
assert.match(packageJson.scripts.validate, /scripts\/background-test\.js/);
assert.match(packageJson.scripts.validate, /scripts\/docs-link-test\.js/);
assert.equal(packageJson.scripts.package, "node scripts/package-extension.js");
assert.equal(packageJson.scripts["test:package"], "node scripts/package-integrity-test.js");
assert.equal(packageJson.scripts["release:check"], "npm run validate && npm run package && npm run test:package");
assert.equal(packageJson.scripts["smoke:openai"], "node scripts/openai-smoke.js");
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/profile-guide\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/architecture\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/live-qa-playbook\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/requirements\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/risk-register\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/x-safety-guide\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /CHANGELOG\.md/);

assert.equal(stripJsonFence("```json\n{\"ok\":true}\n```"), "{\"ok\":true}");

const valid = parseReplyResult(JSON.stringify({
  relevance_gate: {
    mention_product: false,
    reason: "Unrelated to the user's products.",
    mention_style: "Do not mention a product."
  },
  options: [
    { label: "Helpful", text: "The missing piece is usually the verification loop." },
    { label: "Question", text: "How are you deciding what counts as done?" },
    { label: "Concise", text: "Specs matter more than prompt cleverness here." }
  ]
}));

assert.equal(valid.options.length, 3);
assert.throws(() => parseReplyResult("{}"), /relevance gate/);
assert.throws(() => parseReplyResult(JSON.stringify({
  relevance_gate: { mention_product: false },
  options: [{ label: "Only", text: "Too few." }]
})), /3 to 5/);

const settings = {
  profile: "Builder focused on agent workflows.",
  products: "Spec tool\n- Mention only for requirements and verification threads.",
  voice: "Direct and practical.",
  forbidden: "No generic praise.",
  badExamples: "Great point! Everyone needs to 10x their workflow."
};

const context = formatUserContext(settings);
assert.match(context, /Most relevant saved products\/projects/);
assert.match(context, /No saved product\/project/);

const relevantProducts = selectRelevantProducts(
  "Spec tool\n- Requirements and verification workflows.\n\nRecipe app\n- Meal planning and grocery lists.",
  "AI agents need requirements and verification before coding."
);
assert.match(relevantProducts, /Spec tool/);
assert.doesNotMatch(relevantProducts, /Recipe app/);

const messages = buildMessages({
  note: "be a bit sarcastic",
  threadText: "AI coding agents fail when tasks are vague.",
  settings
});

assert.equal(messages.length, 2);
assert.match(messages[0].content, /product\/project field contains a genuinely relevant match/);
assert.match(messages[0].content, /never sound like this/);
assert.match(messages[0].content, /contrast \/ antithesis flip/i);
assert.match(messages[1].content, /be a bit sarcastic/);
assert.match(messages[1].content, /AI coding agents fail/);
assert.match(messages[1].content, /Never sound like these examples/);

const filtered = enforceReplyPolicy({
  relevance_gate: {
    mention_product: true,
    reason: "Relevant.",
    mention_style: "Personal example."
  },
  options: [
    { label: "Bad", text: "Great point! https://example.com" },
    { label: "Good", text: "The missing piece is usually verification." },
    { label: "Question", text: "What would you use as the done criteria?" },
    { label: "Direct", text: "This needs a spec before another prompt tweak." }
  ]
}, {
  settings
});

assert.equal(filtered.options.length, 3);
// The model's relevance gate is now trusted as-is (no mode coupling).
assert.equal(filtered.relevance_gate.mention_product, true);

// Em / en dashes are stripped from generated replies regardless of the model.
const sanitized = enforceReplyPolicy({
  relevance_gate: { mention_product: false, reason: "n/a", mention_style: "" },
  options: [
    { label: "a", text: "this is fine — but the dash should not survive" },
    { label: "b", text: "second clean reply here" },
    { label: "c", text: "third clean reply here" }
  ]
}, {
  settings
});

assert.doesNotMatch(sanitized.options[0].text, /[—–]/);
assert.match(sanitized.options[0].text, /this is fine, but the dash should not survive/);

const mockRelevant = generateMockReplies({
  threadText: "AI agents need better specs and verification."
});
assert.equal(mockRelevant.relevance_gate.mention_product, true);
assert.equal(mockRelevant.options.length, 3);

const mockUnrelated = generateMockReplies({
  threadText: "Best coffee shops for working outside."
});
assert.equal(mockUnrelated.relevance_gate.mention_product, false);

// Compose grounding input includes the idea, feed, trends, and date.
const postInput = buildPostInput({
  idea: "shipped a thing today",
  feed: [{ display: "Dev", handle: "@dev", text: "gpt-5.4 just dropped and it is fast" }],
  trends: ["AI agents"],
  today: "2026-05-30",
  settings: { ...settings, feedGrounding: true }
});
assert.match(postInput, /2026-05-30/);
assert.match(postInput, /gpt-5\.4 just dropped/);
assert.match(postInput, /AI agents/);
assert.match(postInput, /shipped a thing today/);

// With feed grounding off, feed text is not included.
const postInputOff = buildPostInput({
  idea: "an idea",
  feed: [{ display: "Dev", handle: "@dev", text: "secret feed content" }],
  trends: ["secret trend"],
  today: "2026-05-30",
  settings: { ...settings, feedGrounding: false }
});
assert.doesNotMatch(postInputOff, /secret feed content/);
assert.doesNotMatch(postInputOff, /secret trend/);

// Responses API text extraction handles both shapes, skipping reasoning items.
assert.equal(extractResponsesText({ output_text: "direct text" }), "direct text");
assert.equal(
  extractResponsesText({
    output: [
      { type: "reasoning" },
      { type: "message", content: [{ type: "output_text", text: "walked text" }] }
    ]
  }),
  "walked text"
);

// Refine result parsing.
assert.equal(parseRefineResult('{"text":"refined draft"}').text, "refined draft");
assert.throws(() => parseRefineResult('{"nope":1}'), /refined draft/);

// Mock post returns 3 to 5 options and parses without a relevance gate.
const mockPost = generateMockPost({ idea: "tokens" });
assert.ok(mockPost.options.length >= 3 && mockPost.options.length <= 5);
const noGate = parseReplyResult(
  JSON.stringify({ options: [{ label: "a", text: "one" }, { label: "b", text: "two" }, { label: "c", text: "three" }] }),
  { requireGate: false }
);
assert.equal(noGate.options.length, 3);

console.log("validation ok");
