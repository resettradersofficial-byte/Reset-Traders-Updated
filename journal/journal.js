// Journal Pro v1: log a trade in 20 seconds, tag the hijack, see what it cost you each week.
// Data: journals/{uid} (settings) and journals/{uid}/trades/{id}. Rules: firestore.rules ("Journal Pro").
// Works offline: Firestore keeps a local copy and syncs when the phone is back online.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  connectAuthEmulator, createUserWithEmailAndPassword, getAuth, onAuthStateChanged,
  sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc, collection, connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, getDocs,
  initializeFirestore, onSnapshot, orderBy, persistentLocalCache, persistentMultipleTabManager,
  query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  HIJACKS, addDays, annotate, dayStart, headline, minutesSinceLastLoss, money, summarize, toCsv, weekStart
} from "./calc.js";

const firebaseConfig = {
  apiKey: "AIzaSyBfZqEU-fJrOm0L9A5sFnexs9VUvbgHnQs",
  authDomain: "resettraders-ead44.firebaseapp.com",
  projectId: "resettraders-ead44",
  storageBucket: "resettraders-ead44.firebasestorage.app",
  messagingSenderId: "981078061043",
  appId: "1:981078061043:web:2dcd1109456477a93d126c"
};

// Local testing against the Firebase emulators: http://localhost:<port>/journal/?emu
const EMU = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has("emu");
const app = initializeApp(EMU ? { ...firebaseConfig, projectId: "demo-resettraders", apiKey: "demo-key" } : firebaseConfig);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (_) {
  db = initializeFirestore(app, {});
}
if (EMU) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
}

// ---------- the four hijacks (same words as the Reset Audit) ----------
const H = {
  Rusher: { line: "You trade the clock, not the chart.",
    rule: "take my hands off the mouse and do one box breath (4 in, hold 4, 4 out, hold 4)" },
  Performer: { line: "You trade to be seen winning.",
    rule: "close the P&L view and write one line: did I follow my process?" },
  Competitor: { line: "You keep score. Against the market, and everyone else.",
    rule: "lock my next trade to the same size or smaller and close every chat and leaderboard" },
  Intellectualizer: { line: "You know everything. You execute nothing.",
    rule: "allow myself three checks, then let my written plan decide" }
};
const PRICE = {
  INR: { was: "₹24,999", now: "₹19,999", region: "in" },
  USD: { was: "$297", now: "$247", region: "intl" }
};
const WEEKS_BACK = 8;

// ---------- state ----------
const S = {
  user: null, profile: null, entries: [], view: "loading", tab: "today", weekOffset: 0,
  unsubProfile: null, unsubTrades: null, timer: null,
  log: { sign: null, plan: null, hijack: null, startedAt: 0 },
  setup: { hijack: null, cur: null, fromAudit: false },
  authMode: "up", editing: null
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tradesCol = () => collection(db, "journals", S.user.uid, "trades");
const profileRef = () => doc(db, "journals", S.user.uid);
const cur = () => S.profile?.currency || "INR";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

function show(view) {
  if (S.view !== view) window.scrollTo(0, 0);
  S.view = view;
  for (const v of ["loading", "out", "setup", "app"]) $(`v-${v}`).hidden = v !== view;
  $("open-settings").hidden = view !== "app";
  $("tabs").hidden = view !== "app";
  if (view !== "app") setSync(null);
}

// "Saved on this device" until Firestore confirms the server has it (same idea as the desktop app's dot).
function setSync(state) {
  const dot = $("sync-dot");
  const text = $("sync-text");
  if (state === "synced") { dot.className = "sync-dot"; text.textContent = "Synced"; }
  else if (state === "pending") { dot.className = "sync-dot off"; text.textContent = "Saved on this device · syncing"; }
  else { dot.className = "sync-dot off"; text.textContent = "Free while in beta"; }
}

// Light / dark: follows the system until the trader picks one.
function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
$("theme-btn").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  lsSet("rt-journal-theme", next);
});

// ---------- toast ----------
let toastTimer = null;
function toast(text, undo) {
  $("toast-text").textContent = text;
  const btn = $("toast-undo");
  btn.hidden = !undo;
  btn.onclick = undo ? () => { hideToast(); undo(); } : null;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 6000 : 3500);
}
function hideToast() { $("toast").classList.remove("show"); }

function writeError(err) {
  return err?.code === "permission-denied"
    ? "Couldn't save: that entry didn't pass the checks."
    : "Couldn't save. Check your connection and try again.";
}

// ---------- auth ----------
function setAuthMode(mode) {
  S.authMode = mode;
  const up = mode === "up";
  $("auth-title").textContent = up ? "Start your journal" : "Sign in";
  $("auth-submit").textContent = up ? "Start my journal" : "Sign in";
  $("auth-switch").textContent = up ? "I already have an account" : "New here? Start a journal";
  $("auth-forgot").hidden = up;
  $("auth-pass-hint").hidden = !up;
  $("auth-pass").autocomplete = up ? "new-password" : "current-password";
  authMsg("");
}
function authMsg(text, err = false) {
  $("auth-msg").textContent = text;
  $("auth-msg").classList.toggle("err", err);
}
function authError(e) {
  switch (e?.code) {
    case "auth/email-already-in-use": return "That email already has an account. Sign in instead.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Email or password is wrong.";
    case "auth/invalid-email": return "That email doesn't look right.";
    case "auth/weak-password": return "Use 8 characters or more.";
    case "auth/too-many-requests": return "Too many tries. Wait a minute and try again.";
    case "auth/network-request-failed": return "No connection. Try again when you're online.";
    default: return "That didn't work. Try again.";
  }
}

$("auth-switch").addEventListener("click", () => setAuthMode(S.authMode === "up" ? "in" : "up"));
$("auth-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = $("auth-email").value.trim().toLowerCase();
  const pass = $("auth-pass").value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return authMsg("Enter your email.", true);
  if (S.authMode === "up" && pass.length < 8) return authMsg("Use 8 characters or more for the password.", true);
  if (!pass) return authMsg("Enter your password.", true);
  $("auth-submit").disabled = true;
  authMsg(S.authMode === "up" ? "Creating your journal…" : "Signing in…");
  try {
    if (S.authMode === "up") {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      sendEmailVerification(cred.user, { url: location.origin + location.pathname }).catch(() => {});
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (e) {
    if (e?.code === "auth/email-already-in-use") setAuthMode("in");
    authMsg(authError(e), true);
  } finally {
    $("auth-submit").disabled = false;
  }
});
$("auth-forgot").addEventListener("click", async () => {
  const email = $("auth-email").value.trim().toLowerCase();
  if (!email) return authMsg("Enter your email first, then tap Forgot password.", true);
  try { await sendPasswordResetEmail(auth, email); } catch (_) {}
  authMsg("If that email has an account, a reset link is on its way.");
});
$("verify-resend").addEventListener("click", async () => {
  try {
    await sendEmailVerification(S.user, { url: location.origin + location.pathname });
    toast("Sent. Check your inbox.");
  } catch (e) {
    toast(e?.code === "auth/too-many-requests" ? "Already sent. Give it a minute." : "Couldn't send it. Try again later.");
  }
});

function stopListeners() {
  S.unsubProfile?.(); S.unsubProfile = null;
  S.unsubTrades?.(); S.unsubTrades = null;
  clearInterval(S.timer); S.timer = null;
}

onAuthStateChanged(auth, (user) => {
  stopListeners();
  S.user = user;
  S.profile = null;
  S.entries = [];
  if (!user) { show("out"); setPlanPill(null); return; }
  $("verify-banner").hidden = !!user.emailVerified;
  loadAccess();
  S.unsubProfile = onSnapshot(profileRef(), (snap) => {
    if (!snap.exists()) {
      // A cached "missing" while online may just be the cache: wait for the server's answer.
      if (snap.metadata.fromCache && navigator.onLine) return;
      S.profile = null;
      startSetup();
      return;
    }
    S.profile = snap.data();
    if (S.view !== "app") openApp();
    renderAll();
  }, () => {
    show("out");
    authMsg("Couldn't open your journal. Refresh and try again.", true);
  });
});

async function loadAccess() {
  try {
    const snap = await getDoc(doc(db, "journalAccess", S.user.uid));
    setPlanPill(snap.exists() ? snap.data() : null);
  } catch (_) { setPlanPill(null); }
}
function setPlanPill(access) {
  const pill = $("plan-badge");
  const until = access?.until?.toDate?.();
  pill.classList.toggle("pro", access?.plan === "founder" || access?.plan === "pro");
  if (access?.plan === "founder") pill.textContent = until ? `Founder · to ${until.toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "Founder";
  else if (access?.plan === "pro") pill.textContent = "Pro";
  else pill.textContent = "Beta";
}

// ---------- first sign-in: setup ----------
function auditType() {
  const t = new URLSearchParams(location.search).get("type") || "";
  return HIJACKS.find((h) => h.toLowerCase() === t.toLowerCase()) || null;
}
function defaultCurrency() {
  const region = lsGet("rt-region");
  if (region === "in") return "INR";
  if (region === "intl") return "USD";
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  return /Calcutta|Kolkata/.test(tz) ? "INR" : "USD";
}
function startSetup() {
  const fromAudit = auditType();
  S.setup = { hijack: S.setup.hijack || fromAudit, cur: S.setup.cur || defaultCurrency(), fromAudit: !!fromAudit };
  $("setup-sub").textContent = fromAudit
    ? "Filled in from your Reset Audit. Change it if it doesn't fit."
    : "Pick the one that sounds most like you. You can change it later.";
  const pick = $("setup-pick");
  pick.innerHTML = HIJACKS.map((h) => `
    <button type="button" data-h="${h}" aria-pressed="false">
      <b>${h}</b><span>${esc(H[h].line)}</span>
    </button>`).join("") + `
    <button type="button" class="unsure" data-h="unsure" aria-pressed="false">
      <b>Not sure yet</b><span>Start now, and take the <a href="../audit/" target="_blank" rel="noopener">3-minute Reset Audit</a> to find out.</span>
    </button>`;
  syncSetup();
  show("setup");
}
function syncSetup() {
  for (const b of $("setup-pick").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.h === S.setup.hijack));
  for (const b of $("setup-cur").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.cur === S.setup.cur));
}
$("setup-pick").addEventListener("click", (ev) => {
  if (ev.target.closest("a")) return;
  const b = ev.target.closest("button[data-h]");
  if (!b) return;
  S.setup.hijack = b.dataset.h;
  syncSetup();
});
$("setup-cur").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-cur]");
  if (!b) return;
  S.setup.cur = b.dataset.cur;
  syncSetup();
});
$("setup-go").addEventListener("click", async () => {
  if (!S.setup.hijack) { $("setup-msg").textContent = "Pick the hijack that sounds most like you, or Not sure yet."; return; }
  $("setup-go").disabled = true;
  $("setup-msg").textContent = "";
  const h = S.setup.hijack;
  setDoc(profileRef(), {
    uid: S.user.uid,
    email: S.user.email,
    hijack: h,
    currency: S.setup.cur || "INR",
    hidePnl: h === "Performer",
    windowMin: 30,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }).catch((e) => {
    $("setup-msg").textContent = writeError(e);
    show("setup");
  }).finally(() => { $("setup-go").disabled = false; });
});

// ---------- the journal ----------
function openApp() {
  show("app");
  if (!S.unsubTrades) {
    const since = addDays(weekStart(new Date()), -7 * WEEKS_BACK);
    const q = query(tradesCol(), where("at", ">=", Timestamp.fromDate(since)), orderBy("at", "desc"));
    S.unsubTrades = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      S.entries = snap.docs.map(fromDoc);
      setSync(snap.metadata.hasPendingWrites || snap.metadata.fromCache ? "pending" : "synced");
      renderAll();
    }, () => toast("Couldn't load your trades. Refresh to try again."));
  }
  clearInterval(S.timer);
  S.timer = setInterval(() => { if (S.tab === "today") { renderWatch(); renderClock(); } }, 20000);
  resetLog();
}

function fromDoc(d) {
  const x = d.data({ serverTimestamps: "estimate" });
  return {
    id: d.id, kind: x.kind, at: x.at?.toDate?.() || new Date(), pnl: x.pnl, planned: x.planned,
    hijack: x.hijack, note: x.note || "", pending: d.metadata.hasPendingWrites
  };
}

function renderAll() {
  if (S.view !== "app" || !S.profile) return;
  for (const el of document.querySelectorAll(".cur-sym")) el.textContent = cur() === "INR" ? "₹" : "$";
  if (S.tab === "today") renderToday(); else renderWeek();
}

function setTab(tab) {
  S.tab = tab;
  $("tab-today").setAttribute("aria-selected", String(tab === "today"));
  $("tab-week").setAttribute("aria-selected", String(tab === "week"));
  $("p-today").hidden = tab !== "today";
  $("p-week").hidden = tab !== "week";
  renderAll();
}
$("tab-today").addEventListener("click", () => setTab("today"));
$("tab-week").addEventListener("click", () => { S.weekOffset = 0; setTab("week"); });

// P&L as the trader sees it while trading (Performer hides it; the weekly report always shows it).
const live = (v, opts) => (S.profile.hidePnl ? "Hidden" : money(v, cur(), opts));

function ago(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d`;
}

function renderClock() {
  $("log-clock").textContent = $("log-time").value ? "" : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderWatch() {
  const el = $("watch");
  const p = S.profile;
  const h = p.hijack;
  const w = p.windowMin;
  const now = new Date();
  const m = minutesSinceLastLoss(S.entries, now);
  const inWin = m != null && m <= w;
  const tag = `<div class="step-tag">${HIJACKS.includes(h) ? `Your hijack · ${h}` : "Your hijack"}</div>`;
  const windowLine = inWin
    ? `<p style="margin-top:6px"><span class="red-word">Inside your ${w}-minute window after a loss.</span> Trades now count toward Tilt Tax.</p>`
    : "";
  let body;
  if (h === "Rusher" || h === "Competitor") {
    const big = inWin
      ? `<span class="red-word">${w - m} min</span> left in your window after a loss.`
      : m == null || m > 24 * 60 ? "No recent loss. Your window opens after one." : `Last loss ${ago(m)} ago. You're outside the window.`;
    const sub = inWin
      ? `Every trade now counts toward Tilt Tax. Your rule: ${esc(H[h].rule)}.`
      : `For ${w} minutes after a loss, every trade counts toward Tilt Tax.`;
    body = `<h4>${big}</h4><p>${sub}</p>`;
  } else if (h === "Performer") {
    body = `<h4>${p.hidePnl ? "P&amp;L stays hidden while you trade." : "P&amp;L is showing."}</h4>
      <p>Log red trades first, within 10 minutes. Your rule: ${esc(H[h].rule)}</p>
      ${windowLine}
      <div class="row"><button class="btn secondary auto" type="button" data-act="toggle-pnl">${p.hidePnl ? "Show P&amp;L" : "Hide P&amp;L"}</button></div>`;
  } else if (h === "Intellectualizer") {
    const today = dayStart(now);
    const skips = S.entries.filter((e) => e.kind === "skip" && e.at >= today).length;
    body = `<h4>Let a valid setup pass?</h4>
      <p>Count it, don't explain it. Your rule: ${esc(H[h].rule)}.</p>
      ${windowLine}
      <div class="row"><button class="btn secondary auto" type="button" data-act="skip">+1 setup I let pass</button><span class="small faint num">${skips} today</span></div>`;
  } else {
    body = `<h4>Which hijack is this?</h4>
      <p>Take the <a href="../audit/" target="_blank" rel="noopener">3-minute Reset Audit</a>, then set it in Settings. Until then, tag what you notice.</p>
      ${windowLine}`;
  }
  const hot = inWin && (h === "Rusher" || h === "Competitor");
  el.className = `callout ${hot ? "hot" : inWin ? "left-red" : "left-amber"}`;
  el.innerHTML = tag + body;
  el.hidden = false;
}

$("watch").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-act]");
  if (!b) return;
  if (b.dataset.act === "toggle-pnl") {
    updateDoc(profileRef(), { hidePnl: !S.profile.hidePnl, updatedAt: serverTimestamp() }).catch((e) => toast(writeError(e)));
  } else if (b.dataset.act === "skip") {
    const ref = doc(tradesCol());
    setDoc(ref, {
      kind: "skip", at: Timestamp.now(), hijack: HIJACKS.includes(S.profile.hijack) ? S.profile.hijack : "none",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }).catch((e) => toast(writeError(e)));
    touchLastLog();
    toast("Counted. A setup you let pass is not a mistake.", () => deleteDoc(ref).catch(() => {}));
  }
});

// ---------- log a trade ----------
function chipOrder() {
  const own = S.profile.hijack;
  const rest = HIJACKS.filter((h) => h !== own);
  return HIJACKS.includes(own) ? [own, "none", ...rest] : ["none", ...HIJACKS];
}
function renderChips() {
  $("log-hijack").innerHTML = chipOrder().map((h) => h === "none"
    ? `<button type="button" class="chip" data-h="none" aria-pressed="${S.log.hijack === "none"}">Me, clean</button>`
    : `<button type="button" class="chip hijack" data-h="${h}" aria-pressed="${S.log.hijack === h}">${h}</button>`
  ).join("");
}
function syncLog() {
  for (const b of $("log-sign").querySelectorAll("button")) b.setAttribute("aria-pressed", String(String(S.log.sign) === b.dataset.sign));
  for (const b of $("log-plan").querySelectorAll("button")) b.setAttribute("aria-pressed", String(S.log.plan === b.dataset.plan));
  for (const b of $("log-hijack").querySelectorAll("button")) b.setAttribute("aria-pressed", String(S.log.hijack === b.dataset.h));
}
function resetLog() {
  S.log = { sign: null, plan: null, hijack: null, startedAt: 0 };
  $("log-amt").value = "";
  $("log-note").value = "";
  $("log-time").value = "";
  $("log-more").open = false;
  $("log-msg").textContent = "";
  $("log-msg").classList.remove("err");
  for (const id of ["q-result", "q-plan", "q-hijack"]) $(id).classList.remove("need");
  if (S.profile) renderChips();
  syncLog();
  renderClock();
}
function startClock() { if (!S.log.startedAt) S.log.startedAt = Date.now(); }
$("log-form").addEventListener("pointerdown", startClock);
$("log-form").addEventListener("input", startClock);
$("log-sign").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-sign]");
  if (!b) return;
  S.log.sign = Number(b.dataset.sign);
  $("q-result").classList.remove("need");
  syncLog();
  $("log-amt").focus();
});
$("log-plan").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-plan]");
  if (!b) return;
  S.log.plan = b.dataset.plan;
  $("q-plan").classList.remove("need");
  syncLog();
});
$("log-hijack").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-h]");
  if (!b) return;
  S.log.hijack = b.dataset.h;
  $("q-hijack").classList.remove("need");
  syncLog();
});
$("log-time").addEventListener("input", renderClock);

function parseAmount(raw) {
  const s = String(raw).trim().replace(/[,\s₹$]/g, "").replace(/^[−–]/, "-");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s) && !/^-?\.\d{1,2}$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) && Math.abs(v) < 1e9 ? v : null;
}
function readTime(input) {
  if (!input.value) return new Date();
  const d = new Date(input.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

$("log-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const amt = parseAmount($("log-amt").value);
  const missing = [];
  if (amt == null || amt < 0 || (S.log.sign == null && amt !== 0)) missing.push("q-result");
  if (!S.log.plan) missing.push("q-plan");
  if (!S.log.hijack) missing.push("q-hijack");
  for (const id of ["q-result", "q-plan", "q-hijack"]) $(id).classList.toggle("need", missing.includes(id));
  const at = readTime($("log-time"));
  const msg = $("log-msg");
  if (missing.length) {
    msg.textContent = "Fill in the marked part" + (missing.length > 1 ? "s" : "") + ".";
    msg.classList.add("err");
    return;
  }
  if (!at || at > new Date(Date.now() + 5 * 60000)) {
    msg.textContent = "That time is in the future.";
    msg.classList.add("err");
    return;
  }
  const pnl = (S.log.sign || 1) * amt;
  const m = minutesSinceLastLoss(S.entries, at);
  const inWin = m != null && m <= S.profile.windowMin;
  const data = {
    kind: "trade", at: Timestamp.fromDate(at), pnl: pnl === 0 ? 0 : pnl, planned: S.log.plan === "yes", hijack: S.log.hijack,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  const note = $("log-note").value.trim().slice(0, 280);
  if (note) data.note = note;
  const ref = doc(tradesCol());
  setDoc(ref, data).catch((e) => toast(writeError(e)));
  touchLastLog();
  const secs = S.log.startedAt ? Math.max(1, Math.round((Date.now() - S.log.startedAt) / 1000)) : null;
  const extra = inWin ? " It's inside your window after a loss, so it counts toward Tilt Tax." : "";
  toast(`${secs && secs < 600 ? `Logged in ${secs} s.` : "Logged."}${extra}`, () => deleteDoc(ref).catch(() => {}));
  resetLog();
});

let lastTouch = 0;
function touchLastLog() {
  if (Date.now() - lastTouch < 5 * 60000) return; // one profile write per 5 minutes is enough
  lastTouch = Date.now();
  updateDoc(profileRef(), { lastLogAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(() => {});
}

// ---------- today ----------
function entryRow(e, showPnl) {
  const time = e.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const tags = [];
  if (e.kind === "skip") tags.push(`<span class="badge">Setup let pass</span>`);
  else {
    tags.push(e.hijack === "none" ? `<span class="badge">Clean</span>` : `<span class="badge red">${esc(e.hijack)}</span>`);
    if (e.planned === false) tags.push(`<span class="badge">Not in plan</span>`);
    if (e.afterLoss) tags.push(`<span class="badge red">After a loss</span>`);
  }
  if (e.pending) tags.push(`<span class="badge dashed">Saving…</span>`);
  const pnl = e.kind === "trade" ? (showPnl ? money(e.pnl, cur(), { sign: true }) : "•••") : "";
  return `<li><button type="button" class="entry" data-id="${esc(e.id)}">
    <time class="num">${time}</time><span class="what">${tags.join("")}</span><span class="pnl num">${pnl}</span>
    ${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}
  </button></li>`;
}

const stat = (label, value, { sub = "", red = false } = {}) =>
  `<div class="stat-box${red ? " red" : ""}"><p class="label">${label}</p><p class="value num">${value}</p>${sub ? `<p class="sub">${sub}</p>` : ""}</div>`;

function renderToday() {
  renderWatch();
  renderClock();
  if (!$("log-hijack").children.length) renderChips();
  const ann = annotate(S.entries, S.profile.windowMin);
  const today = dayStart(new Date());
  const s = summarize(ann, today, addDays(today, 1));
  $("today-strip").innerHTML =
    stat("Trades", s.trades) +
    stat("Net", s.trades ? live(s.net, { sign: true }) : "–") +
    stat("Tilt Tax", s.tiltCount ? live(s.tiltNet, { sign: true }) : "–", { red: s.tiltNet < 0 && !S.profile.hidePnl });
  const list = ann.filter((e) => e.at >= today).reverse();
  $("today-list").innerHTML = list.length
    ? list.map((e) => entryRow(e, !S.profile.hidePnl)).join("")
    : `<li class="empty-state">Nothing logged today. Your first trade takes about 20 seconds.</li>`;
}

// ---------- week ----------
function weekLabel(start) {
  if (S.weekOffset === 0) return "This week";
  if (S.weekOffset === -1) return "Last week";
  const end = addDays(start, 6);
  const f = (d, withMonth) => d.toLocaleDateString(undefined, withMonth ? { day: "numeric", month: "short" } : { day: "numeric" });
  return `${f(start, start.getMonth() !== end.getMonth())} – ${f(end, true)}`;
}
function delta(now, before, c, worseWord, betterWord) {
  const d = now - before;
  if (Math.abs(d) < 0.005) return "same as the week before";
  return `${money(Math.abs(d), c)} ${d < 0 ? worseWord : betterWord} than the week before`;
}

function renderWeek() {
  const p = S.profile;
  const c = cur();
  const start = addDays(weekStart(new Date()), 7 * S.weekOffset);
  const end = addDays(start, 7);
  $("wk-label").textContent = weekLabel(start);
  $("wk-prev").disabled = S.weekOffset <= -(WEEKS_BACK - 1);
  $("wk-next").disabled = S.weekOffset >= 0;
  const ann = annotate(S.entries, p.windowMin);
  const s = summarize(ann, start, end);
  const prev = summarize(ann, addDays(start, -7), start);
  const h = HIJACKS.includes(p.hijack) ? p.hijack : null;
  const parts = [];

  const report = [`<div class="step-tag">01 / Weekly report</div>
    <p class="lead ${s.hijackNet < 0 ? "red" : ""}">${esc(headline(s, c))}</p>`];
  if (s.trades) {
    report.push(`<p class="section-sub">Net ${money(s.net, c, { sign: true })} from ${s.trades} trade${s.trades === 1 ? "" : "s"}: ${s.wins} won, ${s.losses} lost.${p.hidePnl ? " P&amp;L shows here even with Hide P&amp;L on." : ""}</p>`);
    report.push(`<div class="stat-grid">
      ${stat("Tilt Tax", money(s.tiltNet, c, { sign: true }), { red: s.tiltNet < 0, sub: `${s.tiltCount} trade${s.tiltCount === 1 ? "" : "s"} within ${p.windowMin} min of a loss` })}
      ${stat("Hijacked trades", money(s.hijackNet, c, { sign: true }), { red: s.hijackNet < 0, sub: `${s.hijackedCount} of ${s.trades} trades` })}
      ${stat("Without the hijack", money(s.cleanNet, c, { sign: true }), { sub: "your week minus the hijacked trades" })}
      ${stat("Hijack share", `${Math.round(s.taggedShare * 100)}%`, { sub: "of trades taken by a hijack" })}
    </div>`);
    if (prev.trades) {
      report.push(`<p class="small soft" style="margin-top:14px">Tilt Tax: ${delta(s.tiltNet, prev.tiltNet, c, "worse", "better")}. Hijacked trades: ${delta(s.hijackNet, prev.hijackNet, c, "worse", "better")}.</p>`);
    }
  }
  parts.push(`<div class="card">${report.join("")}</div>`);

  if (s.trades) {
    const rows = [];
    if (s.byHijack.length) {
      const max = Math.max(...s.byHijack.map((b) => b.count));
      rows.push(`<div class="bars" style="margin-bottom:20px">${s.byHijack.map((b) => `
        <div class="bar"><div class="top-line"><b>${b.name}</b><span class="num soft">${b.count} · ${money(b.net, c, { sign: true })}</span></div>
          <div class="track"><div class="fill" style="width:${Math.round((b.count / max) * 100)}%"></div></div></div>`).join("")}
      </div>`);
    }
    rows.push(`<div class="stat-grid">
      ${stat("In your plan", money(s.plannedNet, c, { sign: true }), { sub: `${s.plannedCount} trade${s.plannedCount === 1 ? "" : "s"}` })}
      ${stat("Not in your plan", money(s.unplannedNet, c, { sign: true }), { sub: `${s.unplannedCount} trade${s.unplannedCount === 1 ? "" : "s"}` })}
    </div>`);
    parts.push(`<div class="card"><div class="step-tag">02 / Who took the trades</div>${rows.join("")}</div>`);
  }
  if (s.skips) {
    parts.push(`<div class="callout left-green"><h4>You let ${s.skips} valid setup${s.skips === 1 ? "" : "s"} pass.</h4><p>Three checks, then the plan decides.</p></div>`);
  }
  if (h) {
    parts.push(`<div class="callout left-amber"><div class="step-tag">Your stop rule</div>
      <p class="rule">When the ${h} shows up, I ${esc(H[h].rule)}.</p></div>`);
  }
  if (h && S.weekOffset === 0 && (s.hijackNet < 0 || s.tiltNet < 0)) parts.push(offerCard(h, c));
  const list = ann.filter((e) => e.at >= start && e.at < end).reverse();
  parts.push(list.length
    ? `<div class="card"><details><summary style="cursor:pointer;font-weight:700;font-size:13.5px">All ${list.length} entr${list.length === 1 ? "y" : "ies"} ${S.weekOffset === 0 ? "this week" : "that week"}</summary>
        <ul class="entries" style="margin-top:8px">${list.map((e) => entryRow(e, true)).join("")}</ul></details></div>`
    : `<p class="empty-state">No trades logged ${S.weekOffset === 0 ? "this week yet" : "that week"}.</p>`);
  $("week-body").innerHTML = parts.join("");
}

function offerCard(h, c) {
  if (lsGet("rt-reserved-reset") === "1") {
    return `<div class="callout left-green"><p>You're on the founding list for Your Personal Reset. We'll email you when seats open.</p></div>`;
  }
  const pr = PRICE[c] || PRICE.INR;
  return `<div class="card">
    <div class="step-tag">Your Personal Reset</div>
    <h3>The journal shows you what the ${h} costs. The course trains it out.</h3>
    <p class="small soft">12 video modules with drills made for the ${h}. Founding seats include Journal Pro free for 6 months.</p>
    <p class="price"><s>${pr.was}</s><b>${pr.now}</b><span class="small faint">founding price</span></p>
    <button class="btn" type="button" data-act="reserve">Reserve my founding seat</button>
    <p class="small faint" style="margin-top:10px">No payment today. Checkout opens soon and reserved seats get first access.</p>
  </div>`;
}

$("week-body").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button[data-act='reserve']");
  if (b) {
    b.disabled = true;
    b.textContent = "Reserving…";
    try {
      await addDoc(collection(db, "reservations"), {
        email: S.user.email.toLowerCase(), product: "reset", type: S.profile.hijack,
        region: (PRICE[cur()] || PRICE.INR).region, source: "journal", createdAt: serverTimestamp()
      });
      lsSet("rt-reserved-reset", "1");
      toast("Seat reserved. We'll email you when checkout opens.");
      renderWeek();
    } catch (_) {
      b.disabled = false;
      b.textContent = "Reserve my founding seat";
      toast("Couldn't reserve. Check your connection and try again.");
    }
    return;
  }
  openEditFromClick(ev);
});
$("today-list").addEventListener("click", openEditFromClick);
$("wk-prev").addEventListener("click", () => { S.weekOffset -= 1; renderWeek(); });
$("wk-next").addEventListener("click", () => { S.weekOffset = Math.min(0, S.weekOffset + 1); renderWeek(); });

// ---------- edit / delete an entry ----------
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function openEditFromClick(ev) {
  const row = ev.target.closest("button.entry");
  if (!row) return;
  const e = S.entries.find((x) => x.id === row.dataset.id);
  if (!e) return;
  S.editing = e;
  const trade = e.kind === "trade";
  $("edit-title").textContent = trade ? "Edit trade" : "Setup let pass";
  $("edit-pnl-f").hidden = !trade;
  $("edit-plan-f").hidden = !trade;
  $("edit-pnl").value = trade ? String(e.pnl) : "";
  $("edit-plan").value = e.planned ? "yes" : "no";
  $("edit-hijack").value = e.hijack;
  $("edit-note").value = e.note || "";
  $("edit-time").value = toLocalInput(e.at);
  $("edit-msg").textContent = "";
  $("d-edit").showModal();
}
$("edit-save").addEventListener("click", () => {
  const e = S.editing;
  if (!e) return;
  const at = readTime($("edit-time"));
  if (!at || at > new Date(Date.now() + 5 * 60000)) { $("edit-msg").textContent = "Check the time."; return; }
  const patch = { at: Timestamp.fromDate(at), hijack: $("edit-hijack").value, updatedAt: serverTimestamp() };
  if (e.kind === "trade") {
    const pnl = parseAmount($("edit-pnl").value);
    if (pnl == null) { $("edit-msg").textContent = "Enter the P&L as a number, with − for a loss."; return; }
    patch.pnl = pnl;
    patch.planned = $("edit-plan").value === "yes";
  }
  const note = $("edit-note").value.trim().slice(0, 280);
  patch.note = note ? note : deleteField();
  updateDoc(doc(tradesCol(), e.id), patch).catch((err) => toast(writeError(err)));
  $("d-edit").close();
  toast("Saved.");
});
$("edit-delete").addEventListener("click", async () => {
  const e = S.editing;
  if (!e) return;
  const ref = doc(tradesCol(), e.id);
  const snap = await getDoc(ref).catch(() => null);
  const old = snap?.exists() ? snap.data() : null;
  deleteDoc(ref).catch((err) => toast(writeError(err)));
  $("d-edit").close();
  toast("Deleted.", old ? () => setDoc(ref, { ...old, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(() => {}) : null);
});

// ---------- settings ----------
$("open-settings").addEventListener("click", () => {
  const p = S.profile;
  if (!p) return;
  $("set-hijack").value = p.hijack;
  $("set-cur").value = p.currency;
  $("set-window").value = String(p.windowMin);
  if (!$("set-window").value) $("set-window").value = "30";
  $("set-hide").checked = !!p.hidePnl;
  $("set-msg").textContent = "";
  $("set-email").textContent = `Signed in as ${S.user.email}${S.user.emailVerified ? "" : " (email not confirmed yet)"}.`;
  $("d-settings").showModal();
});
$("set-save").addEventListener("click", () => {
  updateDoc(profileRef(), {
    hijack: $("set-hijack").value,
    currency: $("set-cur").value,
    windowMin: Number($("set-window").value),
    hidePnl: $("set-hide").checked,
    updatedAt: serverTimestamp()
  }).catch((e) => toast(writeError(e)));
  $("log-hijack").innerHTML = "";
  $("d-settings").close();
  toast("Saved.");
});
$("set-signout").addEventListener("click", async () => {
  $("d-settings").close();
  await signOut(auth);
});
$("set-export").addEventListener("click", async () => {
  try {
    const snap = await getDocs(query(tradesCol(), orderBy("at", "desc")));
    const csv = toCsv(annotate(snap.docs.map(fromDoc), S.profile.windowMin), cur());
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `reset-journal-${toLocalInput(new Date()).slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (_) {
    toast("Couldn't export. Try again when you're online.");
  }
});
$("set-delete").addEventListener("click", async () => {
  if (!confirm("Delete every trade and your settings? This can't be undone. Export a CSV first if you want a copy.")) return;
  $("set-delete").disabled = true;
  try {
    const snap = await getDocs(tradesCol());
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
    await deleteDoc(profileRef());
    $("d-settings").close();
    toast("Your journal is deleted.");
  } catch (_) {
    toast("Couldn't delete everything. Try again when you're online.");
  } finally {
    $("set-delete").disabled = false;
  }
});

// Tab keyboard support: arrow keys move between Today and Week.
document.querySelector(".tabs").addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
  const next = S.tab === "today" ? "week" : "today";
  setTab(next);
  $(`tab-${next}`).focus();
});

setAuthMode("up");
