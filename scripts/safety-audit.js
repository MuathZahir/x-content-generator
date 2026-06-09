const assert = require("node:assert/strict");
const fs = require("node:fs");

const runtimeFiles = [
  "background.js",
  "content.js",
  "options.js"
];

const forbiddenPatterns = [
  /\bfetch\(["']https:\/\/(x|twitter)\.com/i,
  /data-testid=["']?(tweetButton|like|retweet|unretweet|unlike)/i,
  /\b(click|submit)\(\).*?(tweetButton|like|retweet|follow|dm|message)/is,
  /\bauto[- ]?(post|reply|like|follow|dm|repost)\b/i,
  /\bchrome\.scripting\b/,
  /\bXMLHttpRequest\b/
];

for (const file of runtimeFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(source, pattern, `${file} matched forbidden automation pattern ${pattern}`);
  }
}

console.log("safety audit ok");
