const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const packageDir = path.join("dist", "contextreply");
const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "options.html",
  "options.js",
  "popup.html",
  "ui.css",
  "README.md",
  "CHANGELOG.md",
  "docs/architecture.md",
  "docs/chrome-store-listing.md",
  "docs/completion-audit.md",
  "docs/developer-guide.md",
  "docs/hosted-api-contract.md",
  "docs/requirements.md",
  "docs/implementation-plan.md",
  "docs/privacy-security.md",
  "docs/profile-guide.md",
  "docs/production-api-strategy.md",
  "docs/live-qa-playbook.md",
  "docs/risk-register.md",
  "docs/x-safety-guide.md",
  "docs/release-checklist.md",
  "docs/manual-qa.md",
  "docs/qa-results.md"
];

assert.ok(fs.existsSync(packageDir), "Run npm run package before package integrity check.");
assert.ok(fs.existsSync(path.join("dist", "contextreply.zip")), "Missing dist/contextreply.zip.");

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(packageDir, file)), `Missing packaged file: ${file}`);
}

const forbiddenDirs = ["tests", "scripts", "dist"];
for (const dir of forbiddenDirs) {
  assert.ok(!fs.existsSync(path.join(packageDir, dir)), `Package should not include ${dir}/`);
}

const readme = fs.readFileSync(path.join(packageDir, "README.md"), "utf8");
for (const match of readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (/^(https?:|mailto:|#)/.test(target)) continue;
  assert.ok(
    fs.existsSync(path.join(packageDir, target)),
    `Packaged README link target is missing: ${target}`
  );
}

const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const changelog = fs.readFileSync(path.join(packageDir, "CHANGELOG.md"), "utf8");
assert.equal(manifest.version, packageJson.version);
assert.match(changelog, new RegExp(`## ${packageJson.version.replaceAll(".", "\\.")} - `));
assert.ok(!manifest.permissions.includes("activeTab"));

console.log("package integrity ok");
