// Journal Pro maths. Run from repo root: node --test tests/journal/calc.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { annotate, summarize, weekStart, minutesSinceLastLoss, money, headline, toCsv } from "../../journal/calc.js";

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

test("headline", () => {
  const base = { trades: 3, skips: 0, hijackedCount: 1, hijackNet: -4200 };
  assert.equal(headline(base, "INR"), "The hijack cost you ₹4,200 this week.");
  assert.match(headline({ ...base, hijackedCount: 0 }, "INR"), /all clean/);
  assert.match(headline({ ...base, hijackNet: 900 }, "INR"), /got paid ₹900/);
  assert.equal(headline({ trades: 0, skips: 0 }, "INR"), "Nothing logged this week yet.");
});

test("CSV quotes notes and blocks spreadsheet formulas", () => {
  const csv = toCsv(annotate([T(9, 0, -5, "Rusher", false, '=HYPERLINK("x"), "quoted"')], 30), "INR");
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "date,time,kind,pnl_INR,in_plan,hijack,after_loss_window,note");
  assert.equal(lines[1], `2026-11-17,09:00,trade,-5,no,Rusher,no,"'=HYPERLINK(""x""), ""quoted"""`);
});
