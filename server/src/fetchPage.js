// Fetches a user-supplied product URL and distills it into model-ready text.
// This is an SSRF surface (the server fetches an arbitrary URL on the user's
// behalf), so every request is validated: https only, the resolved IP must be
// public, redirects are capped and re-validated per hop, and the body is read
// under a byte cap behind a timeout.
import dns from "node:dns/promises";
import net from "node:net";

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

// --- HTML -> signal text -----------------------------------------------------

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// Reads <meta property|name="key" content="..."> in either attribute order.
function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]).trim();
  }
  return "";
}

// Pulls a name/description out of any JSON-LD blocks the page ships. Sites that
// render their body with JS still server-render this (and the og: tags) for
// social cards and SEO, which is what makes extraction work on SPAs.
function jsonLdSummary(html) {
  const nodes = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      nodes.push(JSON.parse(match[1].trim()));
    } catch {
      // Malformed JSON-LD is common; skip it.
    }
  }

  const flat = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node["@graph"]) visit(node["@graph"]);
    flat.push(node);
  };
  nodes.forEach(visit);

  const wanted = flat.find(
    (node) =>
      typeof node.name === "string" &&
      (typeof node.description === "string" ||
        /Product|Organization|SoftwareApplication|WebSite|WebPage/i.test(String(node["@type"] || "")))
  );
  if (!wanted) return { name: "", description: "" };
  return {
    name: typeof wanted.name === "string" ? wanted.name.trim() : "",
    description: typeof wanted.description === "string" ? wanted.description.trim() : ""
  };
}

function bodyText(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

// Composes the structured source string handed to the model, and reports
// whether the page yielded enough to extract from. The owner-authored summary
// (og:/meta/JSON-LD) is the high-signal anchor; raw body text is supporting
// context only, so we never rely on "the first chunk of the page".
export function buildSourceFromHtml(html) {
  const safe = String(html || "");
  const title = decodeEntities((safe.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  const ogTitle = metaContent(safe, "og:title") || metaContent(safe, "twitter:title");
  const ogDesc = metaContent(safe, "og:description") || metaContent(safe, "twitter:description");
  const metaDesc = metaContent(safe, "description");
  const ld = jsonLdSummary(safe);
  const body = bodyText(safe).slice(0, 8000);

  const name = ld.name || ogTitle || title;
  const summary = ld.description || ogDesc || metaDesc;
  const hasSummary = Boolean(summary) || Boolean(ld.name);

  const lines = [];
  if (name) lines.push(`Title / name: ${name}`);
  if (summary) lines.push(`Summary: ${summary}`);
  if (body) lines.push(`Page text:\n${body}`);

  return {
    source: lines.join("\n\n"),
    // Nothing usable: no owner summary and almost no readable body.
    thin: !hasSummary && body.length < 200,
    // Readable but sparse: warn the user to double-check the draft.
    lowConfidence: !hasSummary && body.length < 600
  };
}

// --- SSRF guard --------------------------------------------------------------

export function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = lower.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // Unrecognizable -> block.
}

function blocked(message) {
  const error = new Error(message);
  error.code = "ssrf_blocked";
  return error;
}

function unreachable(message) {
  const error = new Error(message);
  error.code = "fetch_failed";
  return error;
}

// Validates the URL and confirms every resolved address is public. There is a
// small TOCTOU window between this lookup and the fetch below; for a user
// extracting their own product page the risk is low, and re-validating each
// redirect hop closes the common abuse paths.
async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw blocked("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:") throw blocked("Only https:// URLs are supported.");

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal)$/.test(host)) {
    throw blocked("That host is not allowed.");
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw blocked("That address is not allowed.");
  }

  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw unreachable("Could not resolve that domain.");
  }
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw blocked("That host resolves to a private address.");
  }
  return url;
}

async function readCapped(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return text.slice(0, MAX_BYTES);
  }
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    out += decoder.decode(value, { stream: true });
    if (total >= MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // Already closed.
      }
      break;
    }
  }
  out += decoder.decode();
  return out;
}

export async function fetchPageText(rawUrl) {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "pennAI-extractor/1.0 (+https://heypenn.com)",
          Accept: "text/html,application/xhtml+xml,text/plain"
        }
      });
    } catch {
      throw unreachable("Could not reach that page.");
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw unreachable("That page returned an unusable redirect.");
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw unreachable(`That page returned ${response.status}.`);

    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      throw unreachable("That URL is not a web page.");
    }

    const html = await readCapped(response);
    return buildSourceFromHtml(html);
  }

  throw unreachable("That page redirected too many times.");
}
