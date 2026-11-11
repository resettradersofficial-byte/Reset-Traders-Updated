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
const ALLOWED_REFS = ["dm", "bio", "story", "reel"];
const LEVELS = ["steady", "mixed", "strong"];

// Content mirrors audit/index.html (TYPES / BODY / NERVE / STAGE / week). Keep them in sync.
const TYPES = {
  Rusher: {
    line: "You trade the clock, not the chart.",
    fear: "Underneath it is fear of falling behind. Every minute without a trade feels like you're losing ground. I know, because I was a Rusher too.",
    breaker: "take my hands off the mouse and do one box breath (4 in, hold 4, 4 out, hold 4)",
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
// "The problem" — mirrors problemText()/resultHeadline() in audit/index.html. Keep them in sync.
const NAME_KEY = { Rusher: "R", Performer: "P", Competitor: "C", Intellectualizer: "I" };
const PATTERN_KEYS = ["loss", "win", "both", "fomo", "social"];
const PROBLEM = {
  Rusher: "You take trades to end the discomfort of waiting, not because the setup is there.",
  Performer: "You trade for how the result will look: size, posts and red days get managed for an audience.",
  Competitor: "You trade to win: back what you just lost, and against everyone else's results.",
  Intellectualizer: "You analyse instead of executing, and find reasons to move your rules when it counts."
};
const PAIRS = {
  RP: "You hurry in, then need the result to look good.",
  RC: "You get in early, and when it goes wrong you go back in to win it back.",
  RI: "You swing between over-thinking and rushing: one trade you analyse to death, the next you chase.",
  PC: "Every trade is a scoreboard: against the market and against everyone watching.",
  PI: "You need to be right, and to be seen being right.",
  CI: "You argue with the market before you accept a loss, with size or with reasons."
};
const pairKey = (a, b) => ["R", "P", "C", "I"].filter((k) => k === NAME_KEY[a] || k === NAME_KEY[b]).join("");
const FEAR_SHORT = { Rusher: "falling behind", Performer: "being seen failing", Competitor: "losing", Intellectualizer: "being wrong" };
const WHEN_FIRST = {
  loss: "It starts right after a loss.",
  win: "It starts after a win or when a target is close, not after losses.",
  both: "It starts after any strong result, red or green.",
  fomo: "Missing a move sets it off.",
  social: "Seeing someone else win sets it off."
};
const WHEN_MORE = { fomo: "Missing a move sets it off too.", social: "So does seeing someone else win." };
const COST = {
  first: "If you take it into your first challenge, it will cost you the challenge before your strategy gets a fair test.",
  f12: "This is the most likely reason your challenges failed, more than the strategy.",
  f3: "After three or more failed challenges, this is the thing to fix, not the strategy.",
  funded: "On a funded account, this is how accounts get lost: one hijacked session undoes weeks of good trading.",
  steady: "You are consistent now. This is what shows up when your size or the stakes go up."
};
const PATTERN_TEXT = {
  loss: "Losses are your trigger. You trade well until something goes red, then the next decision belongs to the hijack.",
  win: "Losses don't knock you off plan. Winning does: a good result or a near-finish is when you drift.",
  both: "Red or green, your last result decides your next move. A loss and a win both pulled you off plan.",
  fomo: "Missing out is a trigger on its own. A move without you and a shiny new strategy both pulled you in.",
  social: "Other traders' results get into your trading. Someone else's win changed what you did next."
};
export function shapeOf(p) {
  if (p.level === "steady") return "steady";
  const n = (p.leads || []).length;
  return n >= 3 ? "split" : n === 2 ? "blend" : "single";
}
export function headline(p) {
  const shape = shapeOf(p);
  if (shape === "steady") return { big: "Steady", line: `Your hijacks are mostly quiet. Under pressure, the ${p.type} is the one to watch.` };
  if (shape === "blend") { const o = p.leads.find((n) => n !== p.type); return { big: `${p.type} + ${o}`, line: PAIRS[pairKey(p.type, o)] }; }
  if (shape === "split") return { big: "Split", line: "No single hijack runs your session. Each kind of pressure brings out a different one." };
  return { big: p.type, line: TYPES[p.type].line };
}
export function problem(p) {
  if (!p.level) return "";
  const shape = shapeOf(p), s = [];
  const hijackN = Math.round(["R", "P", "C", "I"].reduce((a, k) => a + p.pct[k], 0) / 12.5);
  if (shape === "steady") {
    s.push(`Most of the time you trade your plan. The risk is the day the pressure is higher than usual: that is when the ${p.type} gets in.`);
  } else {
    if (shape === "single") s.push(PROBLEM[p.type]);
    else if (shape === "blend") { const o = p.leads.find((n) => n !== p.type); s.push(`Two hijacks share your session equally. ${PROBLEM[p.type]} And ${PROBLEM[o].charAt(0).toLowerCase()}${PROBLEM[o].slice(1)}`); }
    else s.push("Your mistakes change with the moment: different pressure, different hijack. That makes the problem harder to spot, because no single habit stands out.");
    const subj = shape === "single" ? "It" : "Together they";
    s.push(p.level === "strong"
      ? `${subj} took ${hijackN} of your 8 trading moments, so this is not an occasional slip. It is how you trade under pressure.`
      : `${subj} took ${hijackN} of your 8 trading moments: often enough to cost you, not so often that it is out of reach.`);
    (p.patterns || []).forEach((k, i) => s.push(i === 0 ? WHEN_FIRST[k] : (WHEN_MORE[k] || WHEN_FIRST[k])));
  }
  // (The fear underneath follows as its own paragraph in the email.)
  s.push(p.stage === "steady" && p.level !== "steady"
    ? "You say you are consistent. Your answers say this pattern is still there, waiting for bigger size or higher stakes."
    : COST[p.stage]);
  return s.join(" ");
}

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
  const allowedTop = new Set(["email", "profile", "isRetake", "website", "ref"]);
  if (Object.keys(payload).some((k) => !allowedTop.has(k))) return { error: "Unexpected field." };
  if (payload.ref !== undefined && !ALLOWED_REFS.includes(payload.ref)) return { error: "Invalid ref." };

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { error: "Invalid email." };

  if (payload.isRetake !== undefined && typeof payload.isRetake !== "boolean") return { error: "Invalid isRetake." };

  const p = payload.profile;
  if (!p || typeof p !== "object" || Array.isArray(p)) return { error: "Invalid profile." };
  const allowedProfile = new Set(["type", "pct", "body", "nerve", "stage", "rule", "level", "root", "leads", "patterns"]);
  if (Object.keys(p).some((k) => !allowedProfile.has(k))) return { error: "Unexpected profile field." };
  if (!Object.hasOwn(TYPES, p.type)) return { error: "Invalid type." };
  // level/root are optional so pages still cached with the older script keep working.
  if (p.level !== undefined && !LEVELS.includes(p.level)) return { error: "Invalid level." };
  if (p.root !== undefined && !Object.hasOwn(TYPES, p.root)) return { error: "Invalid root." };
  const uniqueListOf = (v, allowed, max) => Array.isArray(v) && v.length <= max && new Set(v).size === v.length && v.every((x) => allowed.includes(x));
  if (p.leads !== undefined && !uniqueListOf(p.leads, Object.keys(TYPES), 4)) return { error: "Invalid leads." };
  if (p.patterns !== undefined && !uniqueListOf(p.patterns, PATTERN_KEYS, 5)) return { error: "Invalid patterns." };
  if (p.leads && p.leads.length && p.level !== "steady" && !p.leads.includes(p.type)) return { error: "Invalid leads." };
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
    ref: payload.ref || null,
    isRetake: payload.isRetake === true,
    profile: { type: p.type, body: p.body, nerve: p.nerve, stage: p.stage, pct: { R: pct.R, P: pct.P, C: pct.C, I: pct.I }, level: p.level || null, root: p.root || null, leads: p.leads || [], patterns: p.patterns || [] }
  };
}

export function buildEmail({ email, isRetake, profile }) {
  const T = TYPES[profile.type];
  const B = BODY[profile.body];
  const N = NERVE[profile.nerve];
  // Rebuilt server-side with the same formula as the page, never taken from the client.
  const ruleRaw = `When ${B.cue} after a loss, I ${T.breaker}, before I ${N.act}.`;
  const rule = ruleRaw.charAt(0).toUpperCase() + ruleRaw.slice(1);
  const days = week(T.drill);
  if (shapeOf(profile) === "blend") { const o = TYPES[profile.leads.find((n) => n !== profile.type)]; days[5] = `Your second hijack, the ${profile.leads.find((n) => n !== profile.type)}: ${o.drill}`; }
  // New pages send level/root: pct is then the share of the 8 trading moments per hijack.
  const steady = profile.level === "steady";
  const fear = TYPES[profile.root || profile.type].fear;
  let mix;
  if (profile.level) {
    const hijack = ["R", "P", "C", "I"].reduce((a, k) => a + profile.pct[k], 0);
    const reset = Math.max(0, 100 - hijack);
    mix = `Your 8 trading moments: Reset ${reset}% · ` + ["R", "P", "C", "I"].map((k) => `${TYPE_KEYS[k]} ${profile.pct[k]}%`).join(" · ");
  } else {
    mix = ["R", "P", "C", "I"].map((k) => `${TYPE_KEYS[k]} ${profile.pct[k]}%`).join(" · ");
  }
  const shape = shapeOf(profile);
  const label = shape === "single" ? "Your hijack type" : shape === "blend" ? "Your hijacks" : "Your result";
  const { big, line } = headline(profile);
  const problemText = problem(profile);

  const subject = `Your Reset Audit result: ${big}${isRetake ? " (retake)" : ""}`;

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
          <p style="margin:0 0 4px;font:600 13px/1.4 Inter,Arial,sans-serif;color:#6b7194;">${esc(label)}</p>
          <p style="margin:0 0 4px;font:900 34px/1.1 Poppins,Arial,sans-serif;color:#0a0c1c;">${esc(big)}</p>
          <p style="margin:0 0 6px;font:700 17px/1.4 Poppins,Arial,sans-serif;color:#FA5901;">${esc(line)}</p>
          <p style="margin:0 0 16px;font:13px/1.5 Inter,Arial,sans-serif;color:#6b7194;">${esc(mix)}</p>
${problemText
    ? `          <p style="${H}">The problem</p>
          <p style="${P}">${esc(problemText)}</p>
          <p style="${P}">${esc(fear)}</p>`
    : `          <p style="${P}">${esc(fear)}</p>`}
${(profile.patterns || []).length
    ? `          <p style="${H}">Where it shows up</p>
${profile.patterns.map((k) => `          <p style="${P}">${esc(PATTERN_TEXT[k])}</p>`).join("\n")}`
    : ""}

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
          <p style="margin:0;font:700 22px/1.3 Kalam,'Segoe Print','Bradley Hand',cursive;color:#1d2347;">Leo</p>
          <p style="margin:4px 0 24px;font:14px/1.5 Inter,Arial,sans-serif;color:#6b7194;">with Omkar, Founder<br>Reset Traders</p>
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
    const work = sendViaAppsScript(env, result.ref ? { ...message, ref: result.ref } : message);
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
