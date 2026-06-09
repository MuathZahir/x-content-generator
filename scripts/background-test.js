const assert = require("node:assert/strict");

let storedSettings = {};
global.chrome = {
  storage: {
    local: {
      async get(defaults) {
        return { ...defaults, ...storedSettings };
      }
    }
  }
};

let fetchCalls = 0;
global.fetch = async () => {
  fetchCalls += 1;
  return {
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                relevance_gate: {
                  mention_product: true,
                  reason: "Relevant to requirements and verification.",
                  mention_style: "Personal example."
                },
                options: [
                  { label: "Bad", text: "Great point! https://example.com" },
                  { label: "Helpful", text: "The verification loop is the useful part." },
                  { label: "Question", text: "What would you use as the done criteria?" },
                  { label: "Direct", text: "A spec beats another prompt tweak here." }
                ]
              })
            }
          }
        ]
      };
    }
  };
};

const { generateReplies, generatePost, refineDraft } = require("../background.js");

async function main() {
  storedSettings = {
    mockMode: true,
    products: "Spec tool\n- Requirements and verification workflows.",
    forbidden: "No generic praise."
  };
  fetchCalls = 0;
  const mockResult = await generateReplies({
    note: "mention my project if it fits",
    threadText: "AI agents need requirements and verification."
  });
  assert.equal(fetchCalls, 0);
  assert.equal(mockResult.options.length, 3);
  assert.equal(mockResult.relevance_gate.mention_product, true);

  storedSettings = {
    mockMode: false,
    apiKey: ""
  };
  await assert.rejects(
    () => generateReplies({ mode: "Ask a smart question", threadText: "Any thread." }),
    /Add your OpenAI API key/
  );

  storedSettings = {
    mockMode: false,
    apiKey: "sk-test",
    model: "gpt-4.1-mini",
    profile: "Builder.",
    products: "Spec tool\n- Requirements and verification workflows.",
    voice: "Direct.",
    forbidden: "No generic praise.",
    badExamples: "Great point!"
  };
  fetchCalls = 0;
  const liveLikeResult = await generateReplies({
    note: "",
    threadText: "AI agents need requirements and verification."
  });
  assert.equal(fetchCalls, 1);
  assert.equal(liveLikeResult.options.length, 3);
  // Relevance gate is trusted from the model response now.
  assert.equal(liveLikeResult.relevance_gate.mention_product, true);
  assert.ok(liveLikeResult.options.every((option) => !/great point|https?:\/\//i.test(option.text)));

  // Compose + refine work in mock mode without touching the network.
  storedSettings = { mockMode: true };
  fetchCalls = 0;
  const post = await generatePost({ idea: "spent a million on tokens", feed: [], trends: [] });
  assert.equal(fetchCalls, 0);
  assert.ok(post.options.length >= 3 && post.options.length <= 5);

  const refined = await refineDraft({
    kind: "post",
    currentText: "first draft of the post",
    instruction: "make it punchier",
    baseContext: "spent a million on tokens",
    images: [],
    history: []
  });
  assert.equal(fetchCalls, 0);
  assert.equal(typeof refined.text, "string");
  assert.ok(refined.text.length > 0);

  console.log("background test ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
