const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const distDir = "dist";
const packageDir = path.join(distDir, "contextreply");
const zipPath = path.join(distDir, "contextreply.zip");
const files = [
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
  "docs/implementation-plan.md",
  "docs/live-qa-playbook.md",
  "docs/manual-qa.md",
  "docs/privacy-security.md",
  "docs/production-api-strategy.md",
  "docs/profile-guide.md",
  "docs/qa-results.md",
  "docs/risk-register.md",
  "docs/x-safety-guide.md",
  "docs/release-checklist.md",
  "docs/requirements.md"
];

fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });

for (const file of files) {
  const destination = path.join(packageDir, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}

fs.rmSync(zipPath, { force: true });
execFileSync("powershell", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -Path '${packageDir}\\*' -DestinationPath '${zipPath}' -Force`
], { stdio: "inherit" });

console.log(`Packaged ${zipPath}`);
