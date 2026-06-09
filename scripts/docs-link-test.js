const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const markdownFiles = [
  "README.md",
  "CHANGELOG.md",
  ...fs.readdirSync("docs")
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.join("docs", file))
];

for (const file of markdownFiles) {
  const markdown = fs.readFileSync(file, "utf8");
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const cleanTarget = target.split("#")[0];
    if (!cleanTarget) continue;

    const resolved = path.resolve(path.dirname(file), cleanTarget);
    assert.ok(fs.existsSync(resolved), `${file} links to missing file: ${target}`);
  }
}

console.log("docs link test ok");
