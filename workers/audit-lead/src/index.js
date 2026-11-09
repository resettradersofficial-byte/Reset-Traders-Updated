// Reset Audit lead Worker.
// POST {email, profile, isRetake, website} from the audit page -> builds the result email ->
// Google Apps Script web app (sends from the Reset Traders Gmail), in the background.
// The email body is built only from the fixed tables below, keyed by validated enum values,
// so nothing the client sends is ever echoed into the HTML except the validated email and integer percentages.

const ALLOWED_ORIGINS = new Set([
  "https://resettraders.com",
  "https://www.resettraders.com"
]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const MAX_BODY_BYTES = 4096;
const EMAIL_RE = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]{2,}$/;

// Content mirrors audit/index.html (TYPES / BODY / NERVE / STAGE / week). Keep them in sync.
const TYPES = {
  Rusher: {
    line: "You trade the clock, not the chart.",
    fear: "Underneath it is fear of falling behind. Every minute without a trade feels like you're losing ground. I know, because I was a Rusher too.",
    breaker: "set a 10-minute timer and cut my next position to half size",
    drill: "Trade only on a closed candle. If it closed one second ago, wait for the next one."
  },
  Performer: {
    line: "You trade to be seen winning.",
    fear: "Underneath it is fear of being seen failing. The trade stops being about price and starts being about how it looks.",
    breaker: "close the P&L view and write one line: did I follow my process?",
    drill: "Log your red trades first, within 10 minutes, before anything else. And no posting results for 7 days."
  },
  Competitor: {
    line: "You keep score. Against the market, and everyone else.",
    fear: "Underneath it is fear of losing, to the market or to anyone. Every red trade feels like being beaten, and you can't leave a fight you lost.",
    breaker: "lock my next trade to the same size or smaller and close every chat and leaderboard",
    drill: "Size-after-loss rule: after any loss, your next trade is the same size or smaller. Write it on your monitor."
  },
  Intellectualizer: {
    line: "You know everything. You execute nothing.",
    fear: "Underneath it is fear of being wrong. As long as you're still analysing, you can't be wrong yet.",
    breaker: "allow myself three checks, then let my written plan decide",
    drill: "Write your entry checklist on one card. Three checks maximum. When all three are yes, you execute."
  }
};
const TYPE_KEYS = { R: "Rusher", P: "Performer", C: "Competitor", I: "Intellectualizer" };
const BODY = {
  jaw: { cue: "my jaw tightens", note: "Jaw tension usually means anger and restraint. You're holding something back, and it comes out in the next trade." },
  chest: { cue: "my chest tightens or my heart speeds up", note: "Chest tightness usually means fear and urgency. It's the first link in the fear, urgency, revenge chain." },
  stomach: { cue: "my stomach drops", note: "A sinking stomach usually means dread, often a feeling that this is unfair after all the work you've put in." },
  neck: { cue: "my shoulders creep up", note: "Neck and shoulder tension usually means pressure you've been carrying for a while, not just this trade." },
  none: { cue: "I notice I feel nothing", note: "Feeling nothing is a signal too. Numbness after a loss means the alarm is on mute, not off." }
};
const NERVE = {
  fight: { name: "Fight", note: "Under threat you move toward it: you widen stops, add size and go after the money.", act: "widen a stop or take the next trade" },
  flight: { name: "Flight", note: "Under threat you escape: you close early, shut the laptop and skip the review.", act: "close the trade in panic or run from the review" },
  freeze: { name: "Freeze", note: "Under threat you lock up: you watch price run through your stop and can't move.", act: "freeze and let price run past my stop" },
  fawn: { name: "Fawn", note: "Under threat you look outward: you ask someone else and follow their call instead of your plan.", act: "hand the decision to someone else" }
};
const STAGE = {
  first: "You haven't started your first challenge yet. Fix this pattern now and you skip the expensive lessons.",
  f12: "One or two failed challenges is normal. The pattern above is usually the reason.",
  f3: "Three or more failed challenges is rarely a strategy problem. It's usually this.",
  funded: "Losing funded accounts is this same pattern with bigger stakes. Same fix.",
  steady: "You're already consistent. This is the hijack most likely to show up when the stakes rise."
};
const week = (drill) => [
  "Set an alarm for your session open that asks one question: is this the setup, or is this urgency?",
  "After every trade, note where you felt it in your body. Just the spot, nothing else.",
  "Before every entry, run the 60-second ego check. Would I take this if my last trade was a win? Is my size the same as always?",
  drill,
  "Practise the pause after a loss: notice the body, one box breath (4 in, hold 4, 4 out, hold 4), name the feeling, run the ego check, then decide.",
  "Count how many times your stop rule fired this week and what happened when you followed it.",
  "Retake this audit and compare. If the numbers moved, keep going. If they didn't, reply to this email and tell me where it broke."
];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(origin ? corsHeaders(origin) : {}) }
  });
}

function originAllowed(origin) {
  return Boolean(origin) && (ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

export function validate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { error: "Bad request." };
  const allowedTop = new Set(["email", "profile", "isRetake", "website"]);
  if (Object.keys(payload).some((k) => !allowedTop.has(k))) return { error: "Unexpected field." };

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { error: "Invalid email." };

  if (payload.isRetake !== undefined && typeof payload.isRetake !== "boolean") return { error: "Invalid isRetake." };

  const p = payload.profile;
  if (!p || typeof p !== "object" || Array.isArray(p)) return { error: "Invalid profile." };
  const allowedProfile = new Set(["type", "pct", "body", "nerve", "stage", "rule"]);
  if (Object.keys(p).some((k) => !allowedProfile.has(k))) return { error: "Unexpected profile field." };
  if (!Object.hasOwn(TYPES, p.type)) return { error: "Invalid type." };
  if (!Object.hasOwn(BODY, p.body)) return { error: "Invalid body." };
  if (!Object.hasOwn(NERVE, p.nerve)) return { error: "Invalid nerve." };
  if (!Object.hasOwn(STAGE, p.stage)) return { error: "Invalid stage." };
  if (p.rule !== undefined && (typeof p.rule !== "string" || p.rule.length > 400)) return { error: "Invalid rule." };
  const pct = p.pct;
  if (!pct || typeof pct !== "object" || Array.isArray(pct)) return { error: "Invalid pct." };
  const keys = Object.keys(pct);
  if (keys.length !== 4 || !keys.every((k) => Object.hasOwn(TYPE_KEYS, k))) return { error: "Invalid pct." };
  if (!keys.every((k) => Number.isInteger(pct[k]) && pct[k] >= 0 && pct[k] <= 100)) return { error: "Invalid pct." };

  return {
    email,
    isRetake: payload.isRetake === true,
    profile: { type: p.type, body: p.body, nerve: p.nerve, stage: p.stage, pct: { R: pct.R, P: pct.P, C: pct.C, I: pct.I } }
  };
}

export function buildEmail({ email, isRetake, profile }) {
  const T = TYPES[profile.type];
  const B = BODY[profile.body];
  const N = NERVE[profile.nerve];
  // Rebuilt server-side with the same formula as the page, never taken from the client.
  const ruleRaw = `When ${B.cue} after a loss, I ${T.breaker}, before I ${N.act}.`;
  const rule = ruleRaw.charAt(0).toUpperCase() + ruleRaw.slice(1);
  const mix = ["R", "P", "C", "I"].map((k) => `${TYPE_KEYS[k]} ${profile.pct[k]}%`).join(" · ");
  const days = week(T.drill);

  const subject = `Your Reset Audit result: ${profile.type}${isRetake ? " (retake)" : ""}`;

  const P = "margin:0 0 16px;font:16px/1.6 Inter,Arial,sans-serif;color:#1d2347;";
  const H = "margin:28px 0 8px;font:700 13px/1.3 Poppins,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#FA5901;";
  const dayRows = days.map((d, i) => `
            <tr>
              <td valign="top" style="padding:0 12px 10px 0;font:700 14px/1.6 Poppins,Arial,sans-serif;color:#FA5901;white-space:nowrap;">Day ${i + 1}</td>
              <td valign="top" style="padding:0 0 10px;font:15px/1.6 Inter,Arial,sans-serif;color:#1d2347;">${esc(d)}</td>
            </tr>`).join("");

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#efe6d3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe6d3;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td style="background:#0a0c1c;border-radius:12px 12px 0 0;padding:20px 24px;">
          <span style="font:800 15px/1 Poppins,Arial,sans-serif;color:#ffffff;">Reset Traders</span>
          <span style="font:600 13px/1 Inter,Arial,sans-serif;color:#a1a9c8;"> · Reset Audit</span>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:0 0 12px 12px;padding:28px 24px 24px;border-top:4px solid #FA5901;">
          <p style="${P}">Hi,</p>
          <p style="${P}">${isRetake ? "Here's your result from the retake. Put it next to the first one and see what moved." : "Here's your Reset Audit result, so you have it somewhere other than your browser."}</p>
          <p style="margin:0 0 4px;font:600 13px/1.4 Inter,Arial,sans-serif;color:#6b7194;">Your hijack type</p>
          <p style="margin:0 0 4px;font:900 34px/1.1 Poppins,Arial,sans-serif;color:#0a0c1c;">${esc(profile.type)}</p>
          <p style="margin:0 0 6px;font:700 17px/1.4 Poppins,Arial,sans-serif;color:#FA5901;">${esc(T.line)}</p>
          <p style="margin:0 0 16px;font:13px/1.5 Inter,Arial,sans-serif;color:#6b7194;">${esc(mix)}</p>
          <p style="${P}">${esc(T.fear)}</p>

          <p style="${H}">Your stop rule</p>
          <p style="margin:0 0 16px;padding:14px 16px;background:#efe6d3;border-left:4px solid #FA5901;border-radius:0 8px 8px 0;font:700 17px/1.55 Kalam,'Segoe Print',Georgia,serif;color:#1d2347;">${esc(rule)}</p>

          <p style="${H}">Your body's warning sign</p>
          <p style="${P}">${esc(B.note)}</p>

          <p style="${H}">Your nervous system default: ${esc(N.name)}</p>
          <p style="${P}">${esc(N.note)}</p>

          <p style="${H}">Where you are</p>
          <p style="${P}">${esc(STAGE[profile.stage])}</p>

          <p style="${H}">Your 7-day reset</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${dayRows}
          </table>

          <p style="${P}">One thing at a time. You don't need a new strategy this week. You need to catch the moment before the hijack takes the trade.</p>
          <p style="${P}">Reply and tell me where it broke.</p>
          <p style="margin:0 0 24px;font:700 22px/1.3 Kalam,'Segoe Print','Bradley Hand',cursive;color:#1d2347;">Leo<span style="display:block;margin-top:4px;font:14px/1.5 Inter,Arial,sans-serif;color:#6b7194;">with Omkar, Founder<br>Reset Traders</span></p>
          <p style="margin:0;padding-top:16px;border-top:1px solid #e6e1d6;font:12px/1.5 Inter,Arial,sans-serif;color:#8a8fa8;">Educational content · Trading involves risk</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { to: email, subject, html };
}

async function limited(limiter, key) {
  if (!limiter || typeof limiter.limit !== "function") return false;
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch (_) {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = originAllowed(origin);

    if (request.method === "OPTIONS") {
      return allowed ? new Response(null, { status: 204, headers: corsHeaders(origin) }) : new Response(null, { status: 403 });
    }
    if (request.method !== "POST") return json(405, { error: "Method not allowed." }, allowed ? origin : "");
    if (!allowed) return json(403, { error: "Origin not allowed." });

    const type = request.headers.get("Content-Type") || "";
    if (!type.toLowerCase().startsWith("application/json")) return json(415, { error: "JSON only." }, origin);

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Too large." }, origin);
    let payload;
    try { payload = JSON.parse(raw); } catch (_) { return json(400, { error: "Bad JSON." }, origin); }

    // Honeypot: real visitors never fill "website". Pretend success so bots learn nothing.
    if (payload && typeof payload === "object" && payload.website) return json(200, { ok: true }, origin);

    const result = validate(payload);
    if (result.error) return json(400, { error: result.error }, origin);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await limited(env.IP_LIMIT, `ip:${ip}`) || await limited(env.EMAIL_LIMIT, `em:${result.email}`)) {
      return json(429, { error: "Too many requests. Try again in a minute." }, origin);
    }

    if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_TOKEN) return json(500, { error: "Email service not configured." }, origin);

    // Hand the email to Apps Script in the background; the page never waits on Google.
    const message = buildEmail(result);
    const work = sendViaAppsScript(env, message);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
    else await work;
    return json(202, { ok: true, queued: true }, origin);
  }
};

export async function sendViaAppsScript(env, message) {
  try {
    const res = await fetch(env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...message, token: env.APPS_SCRIPT_TOKEN }),
      redirect: "follow"
    });
    const text = await res.text();
    let ok = false;
    try { ok = JSON.parse(text).ok === true; } catch (_) {}
    if (!ok) console.error("apps-script send not ok", res.status, text.slice(0, 200));
    return ok;
  } catch (err) {
    console.error("apps-script unreachable", String(err));
    return false;
  }
}
