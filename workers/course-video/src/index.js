// Course videos, private. Videos live in the R2 bucket "course-videos" (not public).
//
// 1. POST /sign  {"key": "<file name>"}  with  Authorization: Bearer <Firebase ID token>
//    The Worker checks the token (signed by Google for this Firebase project), then reads the
//    viewer's own users/{uid} profile from Firestore with that same token (the rules already let
//    a user read their own profile). Admins, and students whose access is active and not expired,
//    get back a link that works for a few hours.
// 2. GET /v/<key>?exp=..&uid=..&sig=..  streams the video (with Range support for seeking).
//
// Secret (set with `npx wrangler secret put VIDEO_SIGNING_KEY`, never committed): VIDEO_SIGNING_KEY.

const PROJECT_ID = "resettraders-ead44";
const LINK_HOURS = 4;
const ALLOWED_ORIGINS = ["https://www.resettraders.com", "https://resettraders.com"];
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/sign" && request.method === "POST") return await sign(request, env, cors);
      if (url.pathname.startsWith("/v/") && (request.method === "GET" || request.method === "HEAD")) return await stream(request, env, url);
      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      return json({ error: "Server error" }, 500, cors);
    }
  }
};

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Vary": "Origin" }
    : { "Vary": "Origin" };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

// ---------- signing ----------
async function sign(request, env, cors) {
  if (env.SIGN_LIMIT) {
    const { success } = await env.SIGN_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
    if (!success) return json({ error: "Too many requests. Wait a minute." }, 429, cors);
  }
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const claims = token ? await verifyIdToken(token) : null;
  if (!claims) return json({ error: "Please log in again." }, 401, cors);

  const body = await request.json().catch(() => ({}));
  const key = cleanKey(body.key);
  if (!key) return json({ error: "Unknown video." }, 400, cors);

  if (!(await hasAccess(claims.user_id, token))) return json({ error: "Course access is not active." }, 403, cors);
  if (!(await env.VIDEOS.head(key))) return json({ error: "Video not found." }, 404, cors);

  const exp = Math.floor(Date.now() / 1000) + LINK_HOURS * 3600;
  const sig = await hmac(env.VIDEO_SIGNING_KEY, `${key}|${exp}|${claims.user_id}`);
  const link = new URL(`/v/${encodeURIComponent(key)}`, request.url);
  link.search = new URLSearchParams({ exp: String(exp), uid: claims.user_id, sig }).toString();
  return json({ url: link.toString(), expires: exp }, 200, cors);
}

function cleanKey(value) {
  const key = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.mp4$/.test(key) ? key : "";
}

async function hasAccess(uid, idToken) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (!res.ok) return false;
  const f = (await res.json()).fields || {};
  const role = f.role?.stringValue;
  if (role === "admin") return true;
  if (role !== "student") return false;
  const access = f.access?.mapValue?.fields || {};
  if (access.active?.booleanValue !== true) return false;
  const expiresAt = access.expiresAt?.timestampValue;
  return !expiresAt || Date.parse(expiresAt) > Date.now();
}

// ---------- streaming ----------
async function stream(request, env, url) {
  const key = cleanKey(decodeURIComponent(url.pathname.slice(3)));
  const exp = Number(url.searchParams.get("exp"));
  const uid = url.searchParams.get("uid") || "";
  const sig = url.searchParams.get("sig") || "";
  if (!key || !exp || !uid || exp < Date.now() / 1000) return new Response("Link expired. Reload the lesson.", { status: 403 });
  const expected = await hmac(env.VIDEO_SIGNING_KEY, `${key}|${exp}|${uid}`);
  if (!safeEqual(sig, expected)) return new Response("Forbidden", { status: 403 });

  const range = parseRange(request.headers.get("Range"));
  const object = await env.VIDEOS.get(key, range ? { range } : {});
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType || "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff"
  });
  if (range && object.range) {
    const start = object.range.offset ?? 0;
    const length = object.range.length ?? (object.size - start);
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  return m[2] === "" ? { offset } : { offset, length: Number(m[2]) - offset + 1 };
}

// ---------- crypto ----------
async function hmac(secret, message) {
  if (!secret) throw new Error("VIDEO_SIGNING_KEY missing");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(mac));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64url(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

let jwksCache = { keys: null, until: 0 };
async function googleKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "")?.[1] || 3600);
  jwksCache = { keys: (await res.json()).keys || [], until: Date.now() + maxAge * 1000 };
  return jwksCache.keys;
}

// Firebase ID token: RS256, issued by securetoken.google.com/<project> for audience <project>.
async function verifyIdToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch (_) { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== PROJECT_ID || claims.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;
  if (!claims.sub || claims.sub !== claims.user_id || claims.exp < now || claims.iat > now + 300) return null;
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  return ok ? claims : null;
}
