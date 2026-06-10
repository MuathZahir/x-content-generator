const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  API_BASE,
  buildProfilePayload,
  enforceReplyPolicy,
  formatProductBlock,
  generateMockPost,
  generateMockReplies,
  getProductsText,
  sanitizeReplyText,
  violatesReplyPolicy
} = require("../background.js");

// --- Manifest -------------------------------------------------------------------

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, packageJson.version);
assert.ok(manifest.permissions.includes("storage"));
assert.ok(manifest.permissions.includes("clipboardWrite"));
assert.ok(manifest.permissions.includes("tabs"));
assert.ok(!manifest.permissions.includes("activeTab"));
assert.equal(manifest.commands["suggest-replies"].suggested_key.default, "Alt+Shift+R");

// The extension talks only to the hosted API; no provider hosts, no provider
// keys, anywhere in the client.
const apiOrigin = new URL(API_BASE).origin;
assert.deepEqual(manifest.host_permissions, [`${apiOrigin}/*`]);

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

// --- No client-side provider keys -------------------------------------------------

const backgroundSource = fs.readFileSync("background.js", "utf8");
assert.doesNotMatch(backgroundSource, /api\.openai\.com/, "client must never call OpenAI directly");
assert.doesNotMatch(backgroundSource, /apiKey/, "client must never handle a provider key");
assert.match(backgroundSource, /Bearer \$\{token\}/, "hosted API uses the account token");

const optionsSource = fs.readFileSync("options.js", "utf8");
assert.doesNotMatch(optionsSource, /apiKey/);
assert.match(optionsSource, /refreshAccount/);
assert.match(optionsSource, /syncMockModeNote/);
assert.match(optionsSource, /resetDefaults/);

const popupSource = fs.readFileSync("popup.js", "utf8");
assert.match(popupSource, /pennai\.signin/);
assert.match(popupSource, /pennai\.account/);

assert.match(fs.readFileSync("options.html", "utf8"), /the model key lives on the server/);
assert.match(fs.readFileSync("options.html", "utf8"), /does not call OpenAI/);
assert.match(fs.readFileSync("options.html", "utf8"), /Reset defaults/);
assert.match(fs.readFileSync("popup.html", "utf8"), /Continue with Google/);
assert.match(fs.readFileSync("popup.html", "utf8"), /X safety guide/);
assert.match(fs.readFileSync("tests/mock-x-page.html", "utf8"), /Sign in to penn AI/);

// --- Server parity: the load-bearing prompt phrases live server-side now ---------

const serverPrompts = fs.readFileSync("server/src/prompts.js", "utf8");
assert.match(serverPrompts, /product\/project field contains a genuinely relevant match/);
assert.match(serverPrompts, /never sound like this/i);
assert.match(serverPrompts, /contrast \/ antithesis flip/i);
assert.match(serverPrompts, /Never sound like these examples/);
assert.ok(fs.existsSync("server/src/index.js"));
assert.ok(fs.existsSync("server/src/auth.js"));
assert.ok(fs.existsSync("server/test/server-test.js"));
const serverIndex = fs.readFileSync("server/src/index.js", "utf8");
assert.match(serverIndex, /OPENAI|openai/, "provider calls live server-side");
assert.match(fs.readFileSync("server/src/openai.js", "utf8"), /process\.env\.OPENAI_API_KEY/);

// --- Docs ------------------------------------------------------------------------

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
assert.match(fs.readFileSync("docs/hosted-api-contract.md", "utf8"), /POST \/v1\/generate/);
assert.match(fs.readFileSync("docs/profile-guide.md", "utf8"), /Never sound like this/);
assert.match(fs.readFileSync("docs/live-qa-playbook.md", "utf8"), /authenticated X/i);
assert.match(fs.readFileSync("docs/risk-register.md", "utf8"), /X\/Twitter DOM changes/);
assert.match(fs.readFileSync("docs/x-safety-guide.md", "utf8"), /Safe Operating Rules/);
assert.match(fs.readFileSync("CHANGELOG.md", "utf8"), /0\.1\.0 - 2026-05-03/);
assert.match(fs.readFileSync("CHANGELOG.md", "utf8"), new RegExp(`## ${packageJson.version.replaceAll(".", "\\.")} - `));

const contentSource = fs.readFileSync("content.js", "utf8");
assert.match(contentSource, /document\.execCommand\("copy"\)/);
assert.match(contentSource, /Copy failed/);

// --- Scripts wiring -----------------------------------------------------------

assert.match(packageJson.scripts.validate, /scripts\/api-smoke\.js/);
assert.match(packageJson.scripts.validate, /scripts\/package-extension\.js/);
assert.match(packageJson.scripts.validate, /scripts\/package-integrity-test\.js/);
assert.match(packageJson.scripts.validate, /scripts\/safety-audit\.js/);
assert.match(packageJson.scripts.validate, /scripts\/content-dom-test\.js/);
assert.match(packageJson.scripts.validate, /scripts\/options-dom-test\.js/);
assert.match(packageJson.scripts.validate, /scripts\/background-test\.js/);
assert.match(packageJson.scripts.validate, /scripts\/docs-link-test\.js/);
assert.equal(packageJson.scripts.package, "node scripts/package-extension.js");
assert.equal(packageJson.scripts["test:package"], "node scripts/package-integrity-test.js");
assert.equal(packageJson.scripts["release:check"], "npm run validate && npm run server:check && npm run package && npm run test:package");
assert.equal(packageJson.scripts["smoke:api"], "node scripts/api-smoke.js");
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /popup\.js/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/profile-guide\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/architecture\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/live-qa-playbook\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/requirements\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/risk-register\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /docs\/x-safety-guide\.md/);
assert.match(fs.readFileSync("scripts/package-extension.js", "utf8"), /CHANGELOG\.md/);

// --- Behavior spot checks (client-side guards) -----------------------------------

const settings = {
  profile: "Builder focused on agent workflows.",
  products: "Spec tool\n- Mention only for requirements and verification threads.",
  voice: "Direct and practical.",
  forbidden: "No generic praise.",
  badExamples: "Great point! Everyone needs to 10x their workflow."
};

const payload = buildProfilePayload(settings);
assert.equal(payload.context, settings.profile);
assert.match(payload.products, /Spec tool/);

assert.equal(
  getProductsText({ productList: [{ name: "Tool", description: "Desc", mention: "tool threads" }] }),
  "Tool\nDesc\nMention only when: tool threads"
);
assert.equal(formatProductBlock(null), "");

const filtered = enforceReplyPolicy({
  relevance_gate: { mention_product: true, reason: "Relevant.", mention_style: "Personal example." },
  options: [
    { label: "Bad", text: "Great point! https://example.com" },
    { label: "Good", text: "The missing piece is usually verification." },
    { label: "Question", text: "What would you use as the done criteria?" },
    { label: "Direct", text: "This needs a spec before another prompt tweak." }
  ]
}, { settings });
assert.equal(filtered.options.length, 3);
assert.equal(filtered.relevance_gate.mention_product, true);

// Em / en dashes are stripped from generated replies regardless of the model.
assert.equal(sanitizeReplyText("this is fine — but the dash should not survive"), "this is fine, but the dash should not survive");
assert.match(violatesReplyPolicy("this isn't magic, it's discipline", settings), /AI tell/);
assert.equal(violatesReplyPolicy("a normal human reply", settings), "");

const mockRelevant = generateMockReplies({ threadText: "AI agents need better specs and verification." });
assert.equal(mockRelevant.relevance_gate.mention_product, true);
assert.equal(mockRelevant.options.length, 3);

const mockUnrelated = generateMockReplies({ threadText: "Best coffee shops for working outside." });
assert.equal(mockUnrelated.relevance_gate.mention_product, false);

const mockPost = generateMockPost({ idea: "tokens" });
assert.ok(mockPost.options.length >= 3 && mockPost.options.length <= 5);

console.log("validation ok");
