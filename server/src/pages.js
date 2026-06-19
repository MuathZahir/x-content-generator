// Hosted pages: landing, device connect (sign-in + pairing), upgrade, checkout
// success, privacy policy. Served as self-contained HTML, no build step, no
// webfonts, no third-party scripts. The visual language mirrors the
// extension's "X-native dark editorial" identity: deep slate, X-blue accent,
// Georgia serif display, monospace labels.

const CSS = `
:root {
  color-scheme: dark;
  --bg: #0c1218;
  --bg-raise: #15202b;
  --line: #233240;
  --ink: #e7edf3;
  --ink-dim: #8b98a5;
  --blue: #1d9bf0;
  --blue-deep: #1a8cd8;
  --good: #00ba7c;
  --warn: #f4b13e;
  --serif: Georgia, "Times New Roman", serif;
  --mono: "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background:
    radial-gradient(1200px 600px at 85% -10%, rgba(29, 155, 240, 0.08), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, rgba(29, 155, 240, 0.05), transparent 55%),
    var(--bg);
  color: var(--ink);
  font: 16px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.35;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.04 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");
}
main { width: min(640px, calc(100% - 48px)); margin: 0 auto; flex: 1; padding: 56px 0 80px; position: relative; }
.wide { width: min(880px, calc(100% - 48px)); }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 22px 0; }
.brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); }
.brand-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--blue); box-shadow: 0 0 14px rgba(29,155,240,0.8); }
.brand-name { font-family: var(--mono); font-size: 14px; letter-spacing: 0.08em; }
.kicker { font-family: var(--mono); font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--blue); margin: 0 0 14px; }
h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(34px, 6vw, 52px); line-height: 1.12; margin: 0 0 18px; letter-spacing: -0.01em; }
h1 em { font-style: italic; color: var(--blue); }
h2 { font-family: var(--serif); font-weight: 400; font-size: 26px; margin: 42px 0 12px; }
p { color: var(--ink-dim); margin: 0 0 14px; }
strong { color: var(--ink); font-weight: 600; }
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }
.card {
  background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)) , var(--bg-raise);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 28px;
  margin: 26px 0;
  box-shadow: 0 18px 50px rgba(0,0,0,0.35);
}
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  background: var(--blue); color: #fff; border: 0; border-radius: 999px;
  font: 600 15px/1 -apple-system, "Segoe UI", sans-serif;
  padding: 14px 26px; cursor: pointer; text-decoration: none;
  transition: background 0.15s ease, transform 0.15s ease;
}
.btn:hover { background: var(--blue-deep); text-decoration: none; transform: translateY(-1px); }
.btn-ghost { background: transparent; border: 1px solid var(--line); color: var(--ink); }
.btn-ghost:hover { background: rgba(255,255,255,0.04); }
.gicon { width: 18px; height: 18px; background: #fff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
.mono { font-family: var(--mono); font-size: 13px; color: var(--ink-dim); }
.code-chip { font-family: var(--mono); background: rgba(29,155,240,0.1); border: 1px solid rgba(29,155,240,0.35); color: var(--blue); border-radius: 8px; padding: 3px 10px; letter-spacing: 0.12em; }
.status { display: flex; align-items: center; gap: 10px; font-family: var(--mono); font-size: 13px; margin-top: 18px; min-height: 22px; }
.status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-dim); }
.status.ok .dot { background: var(--good); box-shadow: 0 0 10px rgba(0,186,124,0.7); }
.status.err .dot { background: #f4212e; }
.status.busy .dot { background: var(--warn); animation: pulse 1.2s ease infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.steps { counter-reset: step; list-style: none; margin: 22px 0 0; padding: 0; }
.steps li { counter-increment: step; display: flex; gap: 16px; padding: 14px 0; border-top: 1px solid var(--line); color: var(--ink-dim); }
.steps li::before {
  content: "0" counter(step);
  font-family: var(--mono); font-size: 12px; color: var(--blue);
  border: 1px solid rgba(29,155,240,0.4); border-radius: 6px;
  min-width: 30px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
}
.tiers { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 26px 0; }
@media (max-width: 640px) { .tiers { grid-template-columns: 1fr; } }
.tier { border: 1px solid var(--line); border-radius: 16px; padding: 24px; background: var(--bg-raise); }
.tier.pro { border-color: rgba(29,155,240,0.55); position: relative; overflow: hidden; }
.tier.pro::after { content: "PRO"; position: absolute; top: 14px; right: 16px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.2em; color: var(--blue); }
.tier h3 { font-family: var(--serif); font-weight: 400; font-size: 22px; margin: 0 0 4px; }
.price { font-family: var(--mono); font-size: 13px; color: var(--ink-dim); margin-bottom: 14px; }
.price b { color: var(--ink); font-size: 22px; font-weight: 600; }
.tier ul { list-style: none; margin: 0; padding: 0; }
.tier li { padding: 7px 0 7px 22px; color: var(--ink-dim); position: relative; font-size: 14.5px; }
.tier li::before { content: "+"; position: absolute; left: 2px; color: var(--blue); font-family: var(--mono); }
footer { border-top: 1px solid var(--line); }
footer .inner { width: min(880px, calc(100% - 48px)); margin: 0 auto; padding: 22px 0; display: flex; gap: 22px; flex-wrap: wrap; font-family: var(--mono); font-size: 12px; color: var(--ink-dim); }
footer a { color: var(--ink-dim); }
.fade-in { animation: rise 0.5s ease both; }
.fade-in.d1 { animation-delay: 0.08s; } .fade-in.d2 { animation-delay: 0.16s; } .fade-in.d3 { animation-delay: 0.24s; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.hidden { display: none !important; }

/* ---- Landing page ---- */
.hero { display: grid; grid-template-columns: 1.02fr 0.98fr; gap: 56px; align-items: center; padding: 18px 0 8px; }
@media (max-width: 900px) { .hero { grid-template-columns: 1fr; gap: 40px; } }
.hero-copy { max-width: 56ch; }
.eyebrow { display: inline-flex; align-items: center; gap: 9px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-dim); border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px; margin: 0 0 22px; background: rgba(255,255,255,0.02); }
.eyebrow .pip { width: 6px; height: 6px; border-radius: 50%; background: var(--good); box-shadow: 0 0 10px rgba(0,186,124,0.8); }
.hero h1 { font-size: clamp(38px, 5.4vw, 60px); margin: 0 0 20px; }
.lede { font-size: 18px; line-height: 1.62; color: var(--ink-dim); max-width: 50ch; }
.cta-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 30px 0 18px; }
.proof { display: flex; align-items: center; gap: 18px; font-family: var(--mono); font-size: 12px; color: var(--ink-dim); flex-wrap: wrap; }
.proof .sep { width: 4px; height: 4px; border-radius: 50%; background: var(--line); }
.avatars { display: inline-flex; }
.avatars span { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--bg); margin-left: -8px; background: linear-gradient(135deg, var(--blue), #7d4bd8); }
.avatars span:first-child { margin-left: 0; }

/* Product mockup */
.mock { position: relative; }
.mock-glow { position: absolute; inset: -40px -20px -20px; background: radial-gradient(420px 300px at 70% 20%, rgba(29,155,240,0.18), transparent 70%); filter: blur(8px); pointer-events: none; }
.shot { position: relative; background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0)), var(--bg-raise); border: 1px solid var(--line); border-radius: 20px; padding: 16px; box-shadow: 0 40px 90px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02) inset; animation: floaty 7s ease-in-out infinite; }
@keyframes floaty { 50% { transform: translateY(-8px); } }
.shot-bar { display: flex; align-items: center; gap: 7px; padding: 2px 4px 14px; }
.shot-bar i { width: 10px; height: 10px; border-radius: 50%; background: var(--line); display: inline-block; }
.shot-bar i:nth-child(1) { background: #f4212e; } .shot-bar i:nth-child(2) { background: var(--warn); } .shot-bar i:nth-child(3) { background: var(--good); }
.shot-bar .url { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--ink-dim); }
.tweet { padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: rgba(0,0,0,0.22); }
.tweet-head { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
.tw-av { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, #1d9bf0, #0f6fb8); flex: none; }
.tw-name { font-weight: 600; color: var(--ink); font-size: 14.5px; line-height: 1.2; }
.tw-handle { font-family: var(--mono); font-size: 12px; color: var(--ink-dim); }
.tweet-body { font-size: 14.5px; color: var(--ink); line-height: 1.5; }
.panel { margin-top: 12px; border: 1px solid rgba(29,155,240,0.35); border-radius: 14px; background: linear-gradient(180deg, rgba(29,155,240,0.06), rgba(29,155,240,0)), var(--bg); overflow: hidden; }
.panel-head { display: flex; align-items: center; gap: 9px; padding: 11px 14px; border-bottom: 1px solid var(--line); }
.panel-head .brand-dot { width: 8px; height: 8px; }
.panel-head .pname { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--ink); }
.panel-head .ctx { margin-left: auto; font-family: var(--mono); font-size: 10.5px; color: var(--ink-dim); }
.panel-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.reply { border: 1px solid var(--line); border-radius: 11px; padding: 11px 12px; background: var(--bg-raise); animation: rise 0.6s ease both; }
.reply:nth-child(1) { animation-delay: 0.5s; } .reply:nth-child(2) { animation-delay: 0.72s; } .reply:nth-child(3) { animation-delay: 0.94s; }
.reply p { margin: 0 0 9px; color: var(--ink); font-size: 13.5px; line-height: 1.5; }
.reply-actions { display: flex; gap: 7px; }
.chip-btn { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.04em; border: 1px solid var(--line); border-radius: 7px; padding: 4px 9px; color: var(--ink-dim); }
.chip-btn.primary { background: var(--blue); border-color: var(--blue); color: #fff; }
.typing { display: inline-flex; gap: 4px; padding: 2px 0; }
.typing i { width: 5px; height: 5px; border-radius: 50%; background: var(--blue); opacity: 0.5; animation: blink 1.2s infinite; }
.typing i:nth-child(2){animation-delay:.2s} .typing i:nth-child(3){animation-delay:.4s}
@keyframes blink { 50% { opacity: 1; transform: translateY(-2px); } }

/* Section scaffolding */
.section { margin: 78px 0; }
.section-head { max-width: 58ch; margin-bottom: 30px; }
.section-head h2 { margin: 8px 0 10px; font-size: clamp(26px, 3.4vw, 36px); }
.feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
@media (max-width: 760px) { .feature-grid { grid-template-columns: 1fr; } }
.feature { border: 1px solid var(--line); border-radius: 16px; padding: 22px; background: linear-gradient(180deg, rgba(255,255,255,0.018), transparent), var(--bg-raise); transition: border-color .2s ease, transform .2s ease; }
.feature:hover { border-color: rgba(29,155,240,0.5); transform: translateY(-3px); }
.feature .ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: rgba(29,155,240,0.12); border: 1px solid rgba(29,155,240,0.3); margin-bottom: 14px; }
.feature h3 { font-family: var(--serif); font-weight: 400; font-size: 19px; margin: 0 0 7px; color: var(--ink); }
.feature p { margin: 0; font-size: 14px; }

/* Anti-slop filter band */
.filter-band { border: 1px solid var(--line); border-radius: 20px; padding: 34px; background: radial-gradient(600px 300px at 90% -20%, rgba(29,155,240,0.1), transparent 70%), var(--bg-raise); }
.bans { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 18px; }
.ban { font-family: var(--mono); font-size: 12.5px; color: var(--ink-dim); border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px; position: relative; text-decoration: line-through; text-decoration-color: rgba(244,33,46,0.7); }
.ban::after { content: "✕"; color: #f4212e; margin-left: 7px; font-size: 10px; text-decoration: none; display: inline-block; }

/* Final CTA */
.final { text-align: center; border: 1px solid var(--line); border-radius: 24px; padding: 60px 30px; background: radial-gradient(700px 360px at 50% 120%, rgba(29,155,240,0.16), transparent 70%), var(--bg-raise); }
.final h2 { font-size: clamp(30px, 4.4vw, 46px); margin: 0 0 14px; }
.final p { max-width: 46ch; margin: 0 auto 26px; }
`;

const GOOGLE_SVG = `<span class="gicon"><svg width="12" height="12" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.7-6c-2.1 1.4-4.8 2.3-7.5 2.3-6.3 0-11.7-3.7-13.6-9l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg></span>`;

// Feature icons — 20px line glyphs, X-blue stroke, no external assets.
const I = (p) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1d9bf0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON_THREAD = I(`<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20l1-3.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/><path d="M8 10h8M8 13.5h5"/>`);
const ICON_VOICE = I(`<path d="M12 3v18M8 7v10M16 7v10M4 10v4M20 10v4"/>`);
const ICON_SHIELD = I(`<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>`);
const ICON_POST = I(`<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h6"/>`);
const ICON_TAG = I(`<path d="M20.6 12.6 12 21l-9-9V3h9z"/><circle cx="7.5" cy="7.5" r="1.3"/>`);
const ICON_LOCK = I(`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`);

function layout({ title, body, wide = false, script = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<main class="${wide ? "wide" : ""}">
  <div class="topbar">
    <a class="brand" href="/"><span class="brand-dot"></span><span class="brand-name">Penn AI</span></a>
    <span class="mono">replies that sound like you</span>
  </div>
  ${body}
</main>
<footer><div class="inner">
  <span>© ${new Date().getFullYear()} Penn AI</span>
  <a href="/privacy">privacy</a>
  <a href="/terms">terms</a>
  <a href="mailto:muathzaher2004@gmail.com">support</a>
</div></footer>
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

// Shared browser-side auth helpers (plain fetch against Better Auth's REST
// surface; no client bundle needed).
const AUTH_JS = `
async function getSession() {
  try {
    const res = await fetch("/api/auth/get-session", { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.session ? data : null;
  } catch { return null; }
}
async function signInWithGoogle(callbackURL) {
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ provider: "google", callbackURL })
  });
  const data = await res.json().catch(() => ({}));
  if (data && data.url) { location.href = data.url; return; }
  throw new Error(data && data.message ? data.message : "Sign-in is not available yet.");
}
function setStatus(kind, text) {
  const el = document.getElementById("status");
  if (!el) return;
  el.className = "status " + kind;
  el.querySelector("span:last-child").textContent = text;
}
`;

export function landingPage() {
  return layout({
    title: "Penn AI — an X reply copilot that sounds like you",
    wide: true,
    body: `
<section class="hero">
  <div class="hero-copy">
    <span class="eyebrow fade-in"><span class="pip"></span>Chrome extension for X</span>
    <h1 class="fade-in d1">Sound like <em>you</em>, not like a model.</h1>
    <p class="lede fade-in d2">Penn AI lives beside the X composer. It reads the post you're replying to, knows your voice, your products, and your guardrails, then drafts replies a real person would actually type. You edit and post by hand — it never auto-posts.</p>
    <div class="cta-row fade-in d3">
      <a class="btn" href="https://chromewebstore.google.com/detail/penn-ai/hjdnmjnpomgkddpmafjkpgfmookfmacp" rel="noopener">Add to Chrome — free</a>
      <a class="btn btn-ghost" href="/upgrade">See Pro</a>
    </div>
    <div class="proof fade-in d3">
      <span>5 free drafts / day</span>
    </div>
  </div>

  <div class="mock fade-in d2">
    <div class="mock-glow"></div>
    <div class="shot">
      <div class="shot-bar"><i></i><i></i><i></i><span class="url">x.com/compose/reply</span></div>
      <div class="tweet">
        <div class="tweet-head">
          <span class="tw-av"></span>
          <span><span class="tw-name">Dana Okafor</span><br><span class="tw-handle">@danabuilds</span></span>
        </div>
        <div class="tweet-body">shipping is easy, the hard part is getting anyone to care. how are you all finding your first 100 users?</div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <span class="brand-dot"></span><span class="pname">Penn AI</span>
          <span class="ctx">reading thread · your voice</span>
        </div>
        <div class="panel-body">
          <div class="reply">
            <p>honestly? i replied to ~30 posts a day from people in the exact spot my tool fixes. no pitch, just useful answers. first 100 came from there before i wrote a single ad.</p>
            <div class="reply-actions"><span class="chip-btn primary">Insert</span><span class="chip-btn">Copy</span><span class="chip-btn">Refine</span></div>
          </div>
          <div class="reply">
            <p>the "getting anyone to care" part never really ends lol. what worked for me was picking one tiny audience and being weirdly present in their replies for a month.</p>
            <div class="reply-actions"><span class="chip-btn primary">Insert</span><span class="chip-btn">Copy</span><span class="chip-btn">Refine</span></div>
          </div>
          <div class="reply">
            <p class="typing"><i></i><i></i><i></i></p>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="section-head">
    <p class="kicker">what it does</p>
    <h2>Context in, you out.</h2>
    <p>It isn't a generic generator bolted onto a prompt box. Penn AI reads the actual conversation and writes from who you actually are.</p>
  </div>
  <div class="feature-grid">
    <div class="feature">
      <div class="ico">${ICON_THREAD}</div>
      <h3>Reads the whole thread</h3>
      <p>Pulls the post you're replying to, the thread above it, and any images in it — so the draft answers what was really said.</p>
    </div>
    <div class="feature">
      <div class="ico">${ICON_VOICE}</div>
      <h3>Trained on your voice</h3>
      <p>Your bio, your products, your forbidden phrases and anti-examples shape every line. Drafts read like your timeline, not a press release.</p>
    </div>
    <div class="feature">
      <div class="ico">${ICON_SHIELD}</div>
      <h3>Anti-slop on every draft</h3>
      <p>A filter strips the giveaways — em dashes, hype words, engagement bait — before a single draft ever reaches you.</p>
    </div>
    <div class="feature">
      <div class="ico">${ICON_POST}</div>
      <h3>Write original posts</h3>
      <p>On Pro, compose posts grounded in your live home feed and the conversations happening right now, not last year.</p>
    </div>
    <div class="feature">
      <div class="ico">${ICON_TAG}</div>
      <h3>Promote without the cringe</h3>
      <p>Mention your product the way a builder would in a real reply — helpful first, never a copy-paste ad.</p>
    </div>
    <div class="feature">
      <div class="ico">${ICON_LOCK}</div>
      <h3>Private by design</h3>
      <p>Human-in-the-loop, no auto-posting, no scraping. Your profile stays in your browser; we never store request content.</p>
    </div>
  </div>
</section>

<section class="section">
  <div class="filter-band">
    <p class="kicker">how it stays human</p>
    <h2 style="margin-top:8px">If it sounds like a model, you never see it.</h2>
    <p style="max-width:60ch">Every draft runs through a filter that bans the tells people clock instantly. These never make it out of the panel:</p>
    <div class="bans">
      <span class="ban">"it's not X, it's Y"</span>
      <span class="ban">em dashes</span>
      <span class="ban">rule-of-three lists</span>
      <span class="ban">"unlock / elevate / supercharge"</span>
      <span class="ban">"in today's fast-paced world"</span>
      <span class="ban">engagement bait</span>
      <span class="ban">"great question!"</span>
      <span class="ban">hashtag spam</span>
    </div>
  </div>
</section>

<section class="section">
  <div class="section-head">
    <p class="kicker">pricing</p>
    <h2>Start free. Grow on Pro.</h2>
    <p>No card to try it. Upgrade when replies turn into reach.</p>
  </div>
  <div class="tiers">
    <div class="tier">
      <h3>Free</h3>
      <p class="price"><b>$0</b> / forever</p>
      <ul>
        <li>5 AI reply generations a day</li>
        <li>Your voice, products, and guardrails</li>
        <li>Anti-AI-slop filter on every draft</li>
        <li>Reads images in the post</li>
      </ul>
      <p style="margin-top:18px"><a class="btn btn-ghost" href="https://chromewebstore.google.com/detail/penn-ai/hjdnmjnpomgkddpmafjkpgfmookfmacp" rel="noopener">Add to Chrome</a></p>
    </div>
    <div class="tier pro">
      <h3>Pro</h3>
      <p class="price"><b>$9</b> / month · <b>$79</b> / year</p>
      <ul>
        <li>400 generations a day, best model (gpt-5.4)</li>
        <li>Write original posts grounded in your live feed</li>
        <li>Promote your products like a builder, never an ad</li>
        <li>Web search for posts about current events</li>
        <li>Draft refinement chat</li>
      </ul>
      <p style="margin-top:18px"><a class="btn" href="/upgrade">Go Pro</a></p>
    </div>
  </div>
</section>

<section class="section">
  <div class="final">
    <p class="kicker" style="justify-content:center">ready when you are</p>
    <h2>Replies are the front door.<br>Walk through as <em>yourself</em>.</h2>
    <p>Add Penn AI, set your voice once, and start drafting replies that sound like you in seconds.</p>
    <a class="btn" href="https://chromewebstore.google.com/detail/penn-ai/hjdnmjnpomgkddpmafjkpgfmookfmacp" rel="noopener">Add to Chrome — it's free</a>
    <p class="mono" style="margin-top:22px">human-in-the-loop · no auto-posting · no scraping</p>
  </div>
</section>`
  });
}

export function connectPage() {
  const body = `
<p class="kicker">connect your extension</p>
<h1>Link this browser<br>to <em>Penn AI</em>.</h1>
<div class="card">
  <p id="explain">Sign in, and the extension on this computer is connected automatically.</p>
  <p class="mono hidden" id="codeline">pairing code&nbsp;&nbsp;<span class="code-chip" id="code"></span></p>
  <p style="margin-top:20px">
    <button class="btn" id="google">${GOOGLE_SVG} Continue with Google</button>
    <a class="btn btn-ghost hidden" id="done" href="https://x.com">Open X →</a>
  </p>
  <div class="status" id="status"><span class="dot"></span><span></span></div>
</div>
<ol class="steps">
  <li>Sign in with Google. We store your email and name, nothing else.</li>
  <li>This page hands the extension a private access token for your account.</li>
  <li>Head back to X. The panel now generates under your account.</li>
</ol>`;

  const script = `${AUTH_JS}
const params = new URLSearchParams(location.search);
const code = params.get("code") || "";
// "next" lets other routes (e.g. /checkout/:slug when signed out) bounce here
// for sign-in and then continue. Only same-origin relative paths are honored.
const rawNext = params.get("next") || "";
const next = /^\\/[^/]/.test(rawNext) ? rawNext : "";
if (code) {
  document.getElementById("codeline").classList.remove("hidden");
  document.getElementById("code").textContent = code;
}
async function approve() {
  if (!code) return false;
  const res = await fetch("/v1/device/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ code })
  });
  return res.ok;
}
(async () => {
  const session = await getSession();
  const googleBtn = document.getElementById("google");
  if (session) {
    googleBtn.classList.add("hidden");
    if (code) {
      setStatus("busy", "linking extension...");
      const ok = await approve();
      if (ok) {
        setStatus("ok", "connected as " + (session.user && session.user.email || "you") + ". you can close this tab.");
        document.getElementById("explain").textContent = "Done. The extension picks this up within a few seconds.";
        document.getElementById("done").classList.remove("hidden");
      } else {
        setStatus("err", "this link expired. reopen sign-in from the extension.");
      }
    } else if (next) {
      setStatus("ok", "signed in. continuing...");
      location.href = next;
    } else {
      setStatus("ok", "signed in as " + (session.user && session.user.email || "you"));
      document.getElementById("done").classList.remove("hidden");
    }
  } else {
    setStatus("", "");
  }
  googleBtn.addEventListener("click", async () => {
    setStatus("busy", "redirecting to google...");
    // For a plain "next" (no device code), send Google's callback straight to
    // the destination so the user lands there signed in. Pairing flows return
    // here to approve the code first.
    const callbackURL = (!code && next) ? next : (location.pathname + location.search);
    try { await signInWithGoogle(callbackURL); }
    catch (e) { setStatus("err", e.message); }
  });
})();`;

  return layout({ title: "Connect — Penn AI", body, script });
}

export function upgradePage() {
  const body = `
<p class="kicker">penn-ai pro</p>
<h1>Reply free.<br><em>Grow</em> on Pro.</h1>
<div class="tiers">
  <div class="tier">
    <h3>Free</h3>
    <p class="price"><b>$0</b> / forever</p>
    <ul>
      <li>5 generations a day</li>
      <li>Replies in your voice</li>
      <li>Anti-AI-slop filter</li>
    </ul>
  </div>
  <div class="tier pro">
    <h3>Pro</h3>
    <p class="price"><b>$9</b> / month · <b>$79</b> / year</p>
    <ul>
      <li>400 generations a day on gpt-5.4</li>
      <li>Original posts grounded in your live feed</li>
      <li>Product promotion drafts</li>
      <li>Web search + model choice + refine chat</li>
    </ul>
    <p style="margin-top:18px">
      <button class="btn" id="monthly">Go Pro monthly</button>
      <button class="btn btn-ghost" id="yearly">Yearly, save 27%</button>
    </p>
  </div>
</div>
<div class="status" id="status"><span class="dot"></span><span></span></div>
<p class="mono">payments and tax handled by polar.sh · cancel anytime at <a href="/portal">your billing portal</a></p>`;

  const script = `${AUTH_JS}
const params = new URLSearchParams(location.search);
if (params.get("error") === "checkout") {
  setStatus("err", "checkout could not start. try again or email support.");
}
// The /checkout/:slug server route handles the sign-in bounce itself, so we
// can just navigate. A quick session check only sharpens the status message.
async function go(slug) {
  setStatus("busy", "opening secure checkout...");
  const session = await getSession();
  if (!session) setStatus("busy", "sign in, then checkout opens...");
  location.href = "/checkout/" + slug;
}
document.getElementById("monthly").addEventListener("click", () => go("pro"));
document.getElementById("yearly").addEventListener("click", () => go("pro-yearly"));`;

  return layout({ title: "Upgrade — Penn AI Pro", body, script });
}

export function successPage() {
  return layout({
    title: "Welcome to Pro — Penn AI",
    body: `
<p class="kicker">payment confirmed</p>
<h1>You're <em>Pro</em>.</h1>
<div class="card">
  <p>Posts, promotion, web-grounded drafts, and gpt-5.4 are live on your account. The extension picks it up on the next generation, no restart needed.</p>
  <p style="margin-top:18px"><a class="btn" href="https://x.com">Back to X →</a>
  <a class="btn btn-ghost" href="/portal">Billing portal</a></p>
</div>
<p class="mono">receipt and invoices arrive by email from polar.sh</p>`
  });
}

export function privacyPage() {
  return layout({
    title: "Privacy — Penn AI",
    wide: true,
    body: `
<p class="kicker">privacy policy · effective 2026-06-10</p>
<h1>Privacy, in plain words.</h1>

<h2>What the extension does</h2>
<p>Penn AI is a human-in-the-loop reply assistant for X (x.com). It only acts when you click <strong>Suggest replies</strong> (or press the shortcut). It never auto-posts, never likes, follows, or messages anyone, and never reads pages other than the X tab you are using.</p>

<h2>What stays on your device</h2>
<p>Your profile (who you are, your products, your writing voice, forbidden phrases, anti-examples, product photos) is stored in Chrome's local extension storage on your computer. We do not keep a copy on our servers.</p>

<h2>What is sent to our server, and when</h2>
<p>Only when you explicitly request a generation, the extension sends to our API (hosted on Railway): the visible text of the post or thread you're replying to, image URLs attached to that post, your profile fields, your optional note, and, when composing a post with feed grounding on, the visible text of posts in your home feed. Our server forwards this to OpenAI to produce drafts and returns them. <strong>We do not store the content of these requests.</strong> Server logs contain your account id, route, status code, and timing only, never thread or profile text.</p>

<h2>Account data we store</h2>
<p>When you sign in with Google we store your name, email address, and avatar URL, plus session records. For billing we store your plan, subscription status, and a daily generation counter. Payments are processed by Polar (polar.sh) as merchant of record; we never see card numbers.</p>

<h2>Third parties</h2>
<p>OpenAI processes generation requests (per their API data policy, API data is not used to train models). Polar processes payments and invoices. Google provides sign-in. Railway hosts the server and database. There are no ads, no analytics trackers, and we never sell or share data.</p>

<h2>Retention and deletion</h2>
<p>Usage counters expire naturally. Delete the extension and your local profile is gone. Email <a href="mailto:muathzaher2004@gmail.com">muathzaher2004@gmail.com</a> from your account email to delete your account and billing records; we complete deletion within 30 days.</p>

<h2>Chrome Web Store disclosures</h2>
<p>The extension requests: <span class="mono">storage</span> (save your profile locally), <span class="mono">clipboardWrite</span> (copy a draft when you click Copy), <span class="mono">tabs</span> (open settings and route the keyboard shortcut to the active X tab), and host access to <span class="mono">x.com</span> / <span class="mono">twitter.com</span> (show the panel beside the composer) and our API domain (generate drafts for your account).</p>

<h2>Contact</h2>
<p>Questions: <a href="mailto:muathzaher2004@gmail.com">muathzaher2004@gmail.com</a></p>`
  });
}

export function termsPage() {
  return layout({
    title: "Terms — Penn AI",
    wide: true,
    body: `
<p class="kicker">terms of service · effective 2026-06-10</p>
<h1>Terms, briefly.</h1>
<h2>The service</h2>
<p>Penn AI drafts X replies and posts on your request. You review, edit, and post everything yourself. You are responsible for what you publish and for complying with X's rules. Don't use Penn AI for spam, harassment, deception, or bulk-automation of any kind.</p>
<h2>Plans</h2>
<p>Free includes a daily generation allowance. Pro is a paid subscription billed by Polar (merchant of record); cancel anytime from the billing portal and Pro runs until the end of the paid period. Daily caps are anti-abuse fair-use limits, not promises of model availability.</p>
<h2>No warranty</h2>
<p>Drafts are AI-generated suggestions provided as-is. We may change or discontinue features. Liability is limited to the amount you paid in the last 12 months.</p>
<h2>Contact</h2>
<p><a href="mailto:muathzaher2004@gmail.com">muathzaher2004@gmail.com</a></p>`
  });
}
