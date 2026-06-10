// Popup account hub: sign-in state, plan, daily usage, upgrade/billing.
// All network work happens in the background worker; the popup only renders.

function byId(id) {
  return document.getElementById(id);
}

function show(id, visible) {
  const node = byId(id);
  if (node) node.classList.toggle("hidden", !visible);
}

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function renderError(message) {
  const node = byId("acctError");
  if (!node) return;
  node.textContent = message || "";
  show("acctError", Boolean(message));
}

function renderSignedOut(pending) {
  show("signedOut", true);
  show("signedIn", false);
  show("signOut", false);
  show("planChip", false);
  show("pendingNote", Boolean(pending));
}

function renderSignedIn(account) {
  show("signedOut", false);
  show("signedIn", true);
  show("signOut", true);

  const user = account.user || {};
  byId("acctName").textContent = user.name || "Signed in";
  byId("acctEmail").textContent = user.email || "";
  const avatar = byId("avatar");
  if (user.image) {
    avatar.src = user.image;
    show("avatar", true);
  }

  const pro = account.plan === "pro";
  const chip = byId("planChip");
  chip.textContent = pro ? "PRO" : "FREE";
  chip.classList.toggle("plan-pro", pro);
  show("planChip", true);

  const limit = account.limits?.dailyCalls || 0;
  const used = account.usedToday || 0;
  byId("usageCount").textContent = `${used} / ${limit}`;
  const fill = byId("usageFill");
  const ratio = limit ? Math.min(1, used / limit) : 0;
  fill.style.width = `${Math.round(ratio * 100)}%`;
  fill.classList.toggle("usage-warn", ratio >= 0.8);

  byId("usageHint").textContent = pro
    ? "Posts, promotion, web search, and gpt-5.4 are unlocked."
    : "Free covers replies. Pro adds posts, promotion, web search, and gpt-5.4.";

  show("upgrade", !pro);
  show("portal", pro);
}

async function refresh() {
  renderError("");
  try {
    const response = await send("pennai.account");
    if (!response?.ok) {
      throw new Error(response?.error || "Could not load your account.");
    }
    const account = response.result;
    if (account.signedIn) {
      renderSignedIn(account);
    } else {
      renderSignedOut(account.pending);
      if (account.pending) window.setTimeout(refresh, 2500);
    }
  } catch (error) {
    renderSignedOut(false);
    renderError(error.message);
  }
}

byId("signIn")?.addEventListener("click", async () => {
  renderError("");
  const response = await send("pennai.signin");
  if (!response?.ok) {
    renderError(response?.error || "Could not start sign-in.");
    return;
  }
  show("pendingNote", true);
  window.setTimeout(refresh, 2500);
});

byId("signOut")?.addEventListener("click", async () => {
  await send("pennai.signout");
  refresh();
});

byId("upgrade")?.addEventListener("click", () => send("pennai.open", { page: "upgrade" }));
byId("portal")?.addEventListener("click", () => send("pennai.open", { page: "portal" }));
byId("privacyLink")?.addEventListener("click", (event) => {
  event.preventDefault();
  send("pennai.open", { page: "privacy" });
});

refresh();
