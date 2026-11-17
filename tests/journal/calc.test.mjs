// Journal Pro maths. Run from repo root: node --test tests/journal/calc.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { annotate, summarize, weekStart, minutesSinceLastLoss, money, headline, toCsv, weeklySeries } from "../../journal/calc.js";

const at = (h, m = 0, day = 17) => new Date(2026, 10, day, h, m); // Tue 17 Nov 2026
const T = (h, m, pnl, hijack = "none", planned = true, note) => ({ kind: "trade", at: at(h, m), pnl, hijack, planned, note });

test("week starts on Monday 00:00 local", () => {
  assert.equal(weekStart(at(15)).getTime(), new Date(2026, 10, 16).getTime());
  assert.equal(weekStart(new Date(2026, 10, 22, 23)).getTime(), new Date(2026, 10, 16).getTime()); // Sunday
  assert.equal(weekStart(new Date(2026, 10, 16, 0, 0)).getTime(), new Date(2026, 10, 16).getTime());
});

test("Tilt Tax: trades inside the window after a loss", () => {
  const list = annotate([
    T(9, 30, -1000, "none"),
    T(9, 45, -500, "Rusher", false),   // 15 min after a loss: tilt
    T(10, 10, 300, "Rusher", false),   // 25 min after the 9:45 loss: tilt
    T(11, 0, 200),                     // 50 min after the 10:10 win, 75 after last loss: clean
    { kind: "skip", at: at(11, 5), hijack: "Intellectualizer" }
  ], 30);
  assert.deepEqual(list.map((e) => e.afterLoss), [false, true, true, false, false]);
  const s = summarize(list, weekStart(at(9)), new Date(2026, 10, 23));
  assert.equal(s.trades, 4);
  assert.equal(s.skips, 1);
  assert.equal(s.net, -1000);
  assert.equal(s.tiltCount, 2);
  assert.equal(s.tiltNet, -200);
  assert.equal(s.hijackedCount, 2);
  assert.equal(s.hijackNet, -200);
  assert.equal(s.cleanNet, -800);
  assert.equal(s.unplannedCount, 2);
  assert.equal(s.plannedNet, -800);
  assert.equal(s.top.name, "Rusher");
  assert.equal(s.taggedShare, 0.5);
});

test("window edge: exactly windowMin after counts, one minute later does not", () => {
  const a = annotate([T(9, 0, -1), T(9, 30, 5)], 30);
  assert.equal(a[1].afterLoss, true);
  const b = annotate([T(9, 0, -1), T(9, 31, 5)], 30);
  assert.equal(b[1].afterLoss, false);
});

test("entries arrive in any order", () => {
  const a = annotate([T(9, 10, 5), T(9, 0, -1)], 30);
  assert.equal(a[0].at.getHours(), 9);
  assert.equal(a[1].afterLoss, true);
});

test("summaries only count the asked range", () => {
  const list = annotate([T(9, 0, -100, "Competitor", false, "", 16), { ...T(9, 0, 50), at: new Date(2026, 10, 9, 9) }], 30);
  const s = summarize(list, weekStart(at(9)), new Date(2026, 10, 23));
  assert.equal(s.trades, 1);
  assert.equal(s.net, -100);
});

test("minutes since last loss", () => {
  const list = [T(9, 0, -1), T(9, 20, 5), T(9, 40, -2)];
  assert.equal(minutesSinceLastLoss(list, at(10, 0)), 20);
  assert.equal(minutesSinceLastLoss([T(9, 0, 5)], at(10)), null);
});

test("money formats rupees and dollars", () => {
  assert.equal(money(123456, "INR"), "₹1,23,456");
  assert.equal(money(-1250.5, "INR"), "−₹1,250.50");
  assert.equal(money(15, "USD", { sign: true }), "+$15");
  assert.equal(money(0, "USD"), "$0");
});

test("headline leads with behaviour, compared with last week", () => {
  const s = { trades: 5, skips: 0, checks: 0, hijackedCount: 2, urgesCaught: 0 };
  assert.equal(headline(s, { trades: 6, checks: 0, hijackedCount: 4 }), "2 hijacked trades this week, down from 4 last week.");
  assert.equal(headline(s, { trades: 6, checks: 0, hijackedCount: 1 }), "2 hijacked trades this week, up from 1 last week.");
  assert.equal(headline(s, { trades: 3, checks: 0, hijackedCount: 2 }), "2 hijacked trades this week, same as last week.");
  assert.equal(headline({ ...s, hijackedCount: 0 }, { trades: 0, checks: 0 }), "No hijacked trades this week.");
  assert.equal(headline({ trades: 0, skips: 0, checks: 2, urgesCaught: 2 }, null), "No trades taken this week. You caught 2 urges.");
  assert.equal(headline({ trades: 0, skips: 0, checks: 0 }, null), "Nothing logged this week yet.");
});

test("pre-trade checks, stop-rule use and bigger size after a loss", () => {
  const list = annotate([
    T(9, 0, -500),
    { ...T(9, 10, -300, "Competitor", false), size: "bigger", ruleUsed: false },
    { ...T(9, 20, 200, "Competitor", false), size: "same", ruleUsed: true },
    { kind: "check", at: at(9, 25), hijack: "Competitor", outcome: "skip" },
    { kind: "check", at: at(9, 40), hijack: "Competitor", outcome: "take" }
  ], 30);
  const s = summarize(list, weekStart(at(9)), new Date(2026, 10, 23));
  assert.equal(s.trades, 3);
  assert.equal(s.checks, 2);
  assert.equal(s.urgesCaught, 1);
  assert.equal(s.ruleYesCount, 1);
  assert.equal(s.ruleYesNet, 200);
  assert.equal(s.ruleNoCount, 1);
  assert.equal(s.ruleNoNet, -300);
  assert.equal(s.biggerAfterLoss, 1);
});

test("weekly series counts hijacked trades per week, oldest first", () => {
  const list = annotate([
    { ...T(9, 0, -1, "Rusher", false), at: new Date(2026, 10, 10, 9) },
    { ...T(9, 5, -1, "Rusher", false), at: new Date(2026, 10, 10, 9, 5) },
    T(9, 0, -1, "Rusher", false),
    { kind: "check", at: at(10), hijack: "Rusher", outcome: "skip" }
  ], 30);
  const series = weeklySeries(list, weekStart(at(9)), 3);
  assert.deepEqual(series.map((w) => w.hijacked), [0, 2, 1]);
  assert.deepEqual(series.map((w) => w.caught), [0, 0, 1]);
  assert.equal(series[2].from.getTime(), new Date(2026, 10, 16).getTime());
});

test("CSV quotes notes and blocks spreadsheet formulas", () => {
  const csv = toCsv(annotate([T(9, 0, -5, "Rusher", false, '=HYPERLINK("x"), "quoted"')], 30), "INR");
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "date,time,kind,pnl_INR,in_plan,hijack,after_loss_window,size,rule_used,check_outcome,note");
  assert.equal(lines[1], `2026-11-17,09:00,trade,-5,no,Rusher,no,,,,"'=HYPERLINK(""x""), ""quoted"""`);
});
