// Journal Pro maths. Pure functions, no DOM and no Firebase, so they can be unit-tested
// (tests/journal/calc.test.js) and reused later by a weekly email.
//
// A trade: { id, kind: "trade" | "skip", at: Date, pnl?: number, planned?: boolean, hijack: string, note?: string }
// hijack is "Rusher" | "Performer" | "Competitor" | "Intellectualizer" | "none".

export const HIJACKS = ["Rusher", "Performer", "Competitor", "Intellectualizer"];

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// Monday 00:00 local time of the week that holds `date`.
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const back = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - back);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function dayStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Marks every taken trade that came within `windowMin` minutes after a losing trade.
// Those are the Tilt Tax trades. Returns new objects sorted oldest first.
export function annotate(entries, windowMin) {
  const win = windowMin * MIN;
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  let lastLoss = null;
  return sorted.map((e) => {
    const out = { ...e, afterLoss: false };
    if (e.kind !== "trade") return out;
    if (lastLoss && e.at - lastLoss >= 0 && e.at - lastLoss <= win) out.afterLoss = true;
    if (e.pnl < 0) lastLoss = e.at;
    return out;
  });
}

function sum(list) {
  return list.reduce((t, e) => t + (e.pnl || 0), 0);
}

// Everything the weekly report (and the "today" strip) shows for entries in [from, to).
export function summarize(annotated, from, to) {
  const inRange = annotated.filter((e) => e.at >= from && e.at < to);
  const taken = inRange.filter((e) => e.kind === "trade");
  const hijacked = taken.filter((e) => e.hijack !== "none");
  const clean = taken.filter((e) => e.hijack === "none");
  const tilt = taken.filter((e) => e.afterLoss);
  const unplanned = taken.filter((e) => e.planned === false);
  const planned = taken.filter((e) => e.planned === true);

  const byHijack = HIJACKS.map((name) => {
    const list = taken.filter((e) => e.hijack === name);
    return { name, count: list.length, net: sum(list) };
  }).filter((h) => h.count > 0)
    .sort((a, b) => a.net - b.net || b.count - a.count);

  return {
    trades: taken.length,
    skips: inRange.filter((e) => e.kind === "skip").length,
    wins: taken.filter((e) => e.pnl > 0).length,
    losses: taken.filter((e) => e.pnl < 0).length,
    net: sum(taken),
    hijackedCount: hijacked.length,
    hijackNet: sum(hijacked),        // what the hijacked trades made or lost, together
    cleanNet: sum(clean),            // the week without the hijacked trades
    tiltCount: tilt.length,
    tiltNet: sum(tilt),              // Tilt Tax when negative
    plannedCount: planned.length,
    plannedNet: sum(planned),
    unplannedCount: unplanned.length,
    unplannedNet: sum(unplanned),
    taggedShare: taken.length ? hijacked.length / taken.length : 0,
    byHijack,
    top: byHijack[0] || null         // the hijack that cost the most (or was tagged most)
  };
}

// Minutes since the most recent losing trade at or before `now`, or null.
export function minutesSinceLastLoss(entries, now) {
  let last = null;
  for (const e of entries) {
    if (e.kind === "trade" && e.pnl < 0 && e.at <= now && (!last || e.at > last)) last = e.at;
  }
  return last ? Math.floor((now - last) / MIN) : null;
}

// Money as the trader sees it. 1234.5 -> "₹1,234.50" / "-$12".
export function money(value, currency, { sign = false } = {}) {
  const v = Math.round((value || 0) * 100) / 100;
  const abs = Math.abs(v);
  const locale = currency === "INR" ? "en-IN" : "en-US";
  const str = abs.toLocaleString(locale, {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2
  });
  const sym = currency === "INR" ? "₹" : "$";
  const pre = v < 0 ? "−" : sign && v > 0 ? "+" : "";
  return `${pre}${sym}${str}`;
}

// One plain sentence that leads the weekly report.
export function headline(s, currency) {
  if (!s.trades && !s.skips) return "Nothing logged this week yet.";
  if (!s.trades) return `No trades taken. You let ${s.skips} setup${s.skips === 1 ? "" : "s"} pass.`;
  if (!s.hijackedCount) return `No hijacked trades logged this week. ${s.trades} trade${s.trades === 1 ? "" : "s"}, all clean.`;
  if (s.hijackNet < 0) {
    return `The hijack cost you ${money(-s.hijackNet, currency)} this week.`;
  }
  return `${s.hijackedCount} hijacked trade${s.hijackedCount === 1 ? "" : "s"} this week, and the hijack got paid ${money(s.hijackNet, currency)}. That's how it keeps you coming back.`;
}

// CSV export, newest first. Notes are quoted; formulas are neutralised for spreadsheet apps.
export function toCsv(entries, currency) {
  const esc = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [["date", "time", "kind", `pnl_${currency}`, "in_plan", "hijack", "after_loss_window", "note"]];
  for (const e of [...entries].sort((a, b) => b.at - a.at)) {
    const d = e.at;
    const pad = (n) => String(n).padStart(2, "0");
    rows.push([
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      e.kind,
      e.kind === "trade" ? e.pnl : "",
      e.kind === "trade" ? (e.planned ? "yes" : "no") : "",
      e.hijack,
      e.afterLoss ? "yes" : "no",
      e.note || ""
    ]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

export { DAY, MIN };
