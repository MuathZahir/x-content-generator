const assert = require("node:assert/strict");

let storedSettings = {};
let storageWrites = [];
global.chrome = {
  storage: {
    local: {
      async get(defaults) {
        return { ...defaults, ...storedSettings };
      },
      async set(next) {
        storageWrites.push(next);
        storedSettings = { ...storedSettings, ...next };
      }
    }
  }
};

let fetchCalls = [];
let fetchResponder = null;
global.fetch = async (url, options) => {
  fetchCalls.push({ url, options });
  return fetchResponder(url, options);
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

const {
  API_BASE,
  buildProfilePayload,
  generateReplies,
  generatePost,
  refineDraft,
  extractProduct,
  getAccount
} = require("../background.js");

async function main() {
  assert.match(API_BASE, /^https:\/\//);

  // 1. Mock mode never touches the network and never needs an account.
  storedSettings = {
    mockMode: true,
    products: "Spec tool\n- Requirements and verification workflows.",
    forbidden: "No generic praise."
  };
  fetchCalls = [];
  const mockResult = await generateReplies({
    note: "mention my project if it fits",
    threadText: "AI agents need requirements and verification."
  });
  assert.equal(fetchCalls.length, 0);
  assert.equal(mockResult.options.length, 3);
  assert.equal(mockResult.relevance_gate.mention_product, true);

  // 2. Signed out + live mode = a clear sign-in error, no API call.
  storedSettings = { mockMode: false, apiToken: "" };
  fetchCalls = [];
  await assert.rejects(
    () => generateReplies({ note: "", threadText: "Any thread." }),
    /Sign in to Penn AI/
  );
  assert.equal(fetchCalls.length, 0);

  // 3. Signed in: one POST to the hosted API with the bearer token, the
  // user's profile payload, and no provider key anywhere.
  storedSettings = {
    mockMode: false,
    apiToken: "penn_testtoken",
    model: "gpt-5.4",
    profile: "Builder.",
    products: "Spec tool\n- Requirements and verification workflows.",
    voice: "Direct.",
    forbidden: "No generic praise.",
    badExamples: "Great point!"
  };
  fetchCalls = [];
  fetchResponder = (url) => {
    assert.equal(url, `${API_BASE}/v1/generate`);
    return jsonResponse({
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
    });
  };
  const liveLikeResult = await generateReplies({
    note: "",
    threadText: "AI agents need requirements and verification."
  });
  assert.equal(fetchCalls.length, 1);
  const sent = JSON.parse(fetchCalls[0].options.body);
  assert.equal(fetchCalls[0].options.headers.Authorization, "Bearer penn_testtoken");
  assert.equal(sent.model, "gpt-5.4");
  assert.equal(sent.profile.context, "Builder.");
  assert.match(sent.profile.products, /Spec tool/);
  assert.equal(liveLikeResult.options.length, 3);
  assert.equal(liveLikeResult.relevance_gate.mention_product, true);
  assert.ok(liveLikeResult.options.every((option) => !/great point|https?:\/\//i.test(option.text)));

  // 4. A 401 clears the stored token and asks the user to sign in again.
  storedSettings = { mockMode: false, apiToken: "penn_expired", profile: "p" };
  fetchCalls = [];
  storageWrites = [];
  fetchResponder = () => jsonResponse({ error: { code: "unauthorized", message: "Sign in." } }, 401);
  await assert.rejects(
    () => generateReplies({ note: "", threadText: "Any thread." }),
    /Sign in to Penn AI/
  );
  assert.ok(storageWrites.some((write) => write.apiToken === ""));

  // 5. Quota / upgrade errors surface the server's message verbatim.
  storedSettings = { mockMode: false, apiToken: "penn_free" };
  fetchResponder = () => jsonResponse({
    error: { code: "upgrade_required", message: "Writing original posts is a Pro feature." }
  }, 402);
  await assert.rejects(
    () => generatePost({ idea: "an idea", feed: [], trends: [] }),
    /Pro feature/
  );

  // 6. Compose + refine work in mock mode without touching the network.
  storedSettings = { mockMode: true };
  fetchCalls = [];
  const post = await generatePost({ idea: "spent a million on tokens", feed: [], trends: [] });
  assert.equal(fetchCalls.length, 0);
  assert.ok(post.options.length >= 3 && post.options.length <= 5);

  const refined = await refineDraft({
    kind: "post",
    currentText: "first draft of the post",
    instruction: "make it punchier",
    baseContext: "spent a million on tokens",
    images: [],
    history: []
  });
  assert.equal(fetchCalls.length, 0);
  assert.equal(typeof refined.text, "string");
  assert.ok(refined.text.length > 0);

  // 7. Account status maps /v1/me onto the popup contract.
  storedSettings = { apiToken: "penn_me" };
  fetchResponder = () => jsonResponse({
    user: { email: "maya@example.com" },
    plan: "free",
    limits: { dailyCalls: 5 },
    usedToday: 2
  });
  const account = await getAccount();
  assert.equal(account.signedIn, true);
  assert.equal(account.plan, "free");
  assert.equal(account.usedToday, 2);

  // 8a. Product extraction in mock mode never touches the network.
  storedSettings = { mockMode: true };
  fetchCalls = [];
  const mockProduct = await extractProduct({ url: "https://heypenn.com", text: "" });
  assert.equal(fetchCalls.length, 0);
  assert.ok(mockProduct.product.name.length > 0);
  assert.equal(typeof mockProduct.lowConfidence, "boolean");

  // 8b. Signed in: one POST to /v1/extract with the bearer token and the URL.
  storedSettings = { mockMode: false, apiToken: "penn_extract" };
  fetchCalls = [];
  fetchResponder = (url) => {
    assert.equal(url, `${API_BASE}/v1/extract`);
    return jsonResponse({
      product: { name: "Penn AI", description: "Reply copilot for X.", mention: "threads about X growth" },
      lowConfidence: false
    });
  };
  const extracted = await extractProduct({ url: "https://heypenn.com", text: "" });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].options.headers.Authorization, "Bearer penn_extract");
  const extractBody = JSON.parse(fetchCalls[0].options.body);
  assert.equal(extractBody.url, "https://heypenn.com");
  assert.equal(extracted.product.name, "Penn AI");

  // 8. The profile payload carries every saved field and nothing secret.
  const payload = buildProfilePayload({
    profile: "ctx",
    productList: [{ id: "a", name: "Tool", description: "Does a thing", mention: "tool threads", media: [] }],
    voice: "v",
    forbidden: "f",
    badExamples: "b"
  });
  assert.deepEqual(Object.keys(payload).sort(), ["badExamples", "context", "forbidden", "products", "voice"]);
  assert.match(payload.products, /Mention only when: tool threads/);

  console.log("background test ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
