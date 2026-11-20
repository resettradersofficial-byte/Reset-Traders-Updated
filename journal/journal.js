// Journal Pro v1.1: log a trade in 20 seconds, tag the hijack, see what it cost you each week,
// and a pre-trade check for the moment between the urge and the click.
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
  HIJACKS, addDays, annotate, dayStart, headline, lossStreakToday, minutesSinceLastLoss, money, summarize, toCsv, weekStart, weeklySeries
} from "./calc.js";

// Offline shell + "Add to home screen" (scope: /journal/ only). ?nosw skips it while testing.
if ("serviceWorker" in navigator && !new URLSearchParams(location.search).has("nosw")) {
  // When a new version takes over, an open journal (or the home-screen app) would keep running the old code.
  // Reload into the new one, unless the trader is mid-entry or in a dialog.
  const hadController = !!navigator.serviceWorker.controller; // first visit: no reload needed
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    if (S.log.startedAt || document.querySelector("dialog[open]")) { toast("Journal updated. Reload when you're done to get the new version."); return; }
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

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
// Avatars appear only where the hijack itself speaks: setup, the hijack card and the pre-trade check.
const AV = (h) => (HIJACKS.includes(h) ? `img/avatar-${h.toLowerCase()}.webp` : "img/emblem-128.webp");
const WHO = { Rusher: "Rohan", Performer: "Kabir", Competitor: "Arjun", Intellectualizer: "Meera" };
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
  INR: { was: "₹24,999", now: "₹4,999", region: "in" },
  USD: { was: "$297", now: "$69", region: "intl" }
};
const WEEKS_BACK = 8;

// ---------- state ----------
const S = {
  user: null, profile: null, entries: [], view: "loading", tab: "today", weekOffset: 0,
  unsubProfile: null, unsubTrades: null, timer: null,
  log: { sign: null, plan: null, hijack: null, size: null, rule: null, startedAt: 0 },
  check: { answers: {}, timer: null, left: 16 }, installEvent: null,
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
const HAS_ACCOUNT = "rt-journal-account"; // this browser has signed in before: open on "Sign in"

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
      sendVerify(cred.user).catch(() => {});
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
// The confirm-email link must come back to a domain Firebase allows. The site lives on www.resettraders.com,
// but the project allows resettraders.com (which redirects to www), so use that; fall back to a plain email.
function verifySettings() {
  const h = location.hostname;
  return { url: (h === "www.resettraders.com" || h === "resettraders.com") ? "https://resettraders.com/journal/" : location.origin + location.pathname };
}
async function sendVerify(user) {
  try {
    await sendEmailVerification(user, verifySettings());
  } catch (e) {
    if (/continue-uri|unauthorized-domain|invalid-dynamic-link/.test(e?.code || "")) { await sendEmailVerification(user); return; }
    throw e;
  }
}
$("verify-resend").addEventListener("click", async () => {
  try {
    await auth.currentUser?.reload();
    if (auth.currentUser?.emailVerified) { $("verify-banner").hidden = true; toast("Your email is confirmed."); return; }
    await sendVerify(auth.currentUser);
    toast("Sent. Check your inbox and spam folder.");
  } catch (e) {
    toast(e?.code === "auth/too-many-requests"
      ? "Already sent. Check your inbox and spam, or try again in a few minutes."
      : e?.code === "auth/network-request-failed" ? "No connection. Try again when you're online." : "Couldn't send it. Try again in a few minutes.");
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
  if (!user) {
    // Signed out (or never signed in): returning traders land on "Sign in", not "Start your journal".
    $("auth-pass").value = "";
    setAuthMode(lsGet(HAS_ACCOUNT) ? "in" : "up");
    show("out");
    setPlanPill(null);
    return;
  }
  lsSet(HAS_ACCOUNT, "1");
  authMsg("");
  $("verify-banner").hidden = !!user.emailVerified;
  if (!user.emailVerified) user.reload().then(() => { $("verify-banner").hidden = !!auth.currentUser?.emailVerified; }).catch(() => {});
  loadAccess();
  // includeMetadataChanges: a cached "no settings yet" is only trusted once the server confirms it.
  // Without it, the server's confirmation never arrives here and sign-in could hang on "Signing in…".
  S.unsubProfile = onSnapshot(profileRef(), { includeMetadataChanges: true }, (snap) => {
    if (!snap.exists()) {
      if (snap.metadata.fromCache && navigator.onLine) return;
      S.profile = null;
      if (S.view !== "setup") startSetup();
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
      <img class="avatar" src="${AV(h)}" alt="" width="48" height="48" loading="lazy">
      <b>${h}</b><span>${esc(H[h].line)} Like ${WHO[h]}.</span>
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
    cooldownMin: 10,
    lossStop: 2,
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
    hijack: x.hijack, note: x.note || "", size: x.size, ruleUsed: x.ruleUsed, outcome: x.outcome,
    pending: d.metadata.hasPendingWrites
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

// The course's Contract: minutes off-screen after any loss (its example: 10) and done after N losses in a row (2).
const cooldown = () => S.profile?.cooldownMin || 10;
const lossStop = () => S.profile?.lossStop || 2;

function renderWatch() {
  const el = $("watch");
  const p = S.profile;
  const h = p.hijack;
  const w = p.windowMin;
  const c = cooldown();
  const now = new Date();
  const m = minutesSinceLastLoss(S.entries, now);
  const inCool = m != null && m < c;           // the Contract cooldown: off-screen
  const inWin = m != null && m <= w;           // the Tilt Tax measuring window (wider)
  const streak = lossStreakToday(S.entries, now);
  const done = streak >= lossStop();
  const known = HIJACKS.includes(h);
  const tag = `<div class="step-tag">${known ? `Your hijack · ${h}` : "Your hijack"}</div>`;
  const today = dayStart(now);
  const caught = S.entries.filter((e) => e.kind === "check" && e.outcome === "skip" && e.at >= today).length;
  const coolLine = inCool
    ? `<p style="margin-top:6px"><span class="red-word">Cooldown: ${c - m} min left.</span> Your Contract says ${c} minutes off-screen after any loss.</p>`
    : inWin ? `<p style="margin-top:6px">After a loss: the 60-Second Ego Check before the next trade.</p>` : "";
  // The Ego Check is offered to everyone; after a loss it becomes the main button.
  const strong = inCool || inWin;
  const check = `<button class="btn ${strong ? "" : "secondary "}auto" type="button" data-act="check">60-Second Ego Check</button>`;
  const extras = [];
  let head, sub;
  if (done) {
    head = `<span class="red-word">${streak} losses in a row.</span> Done for today.`;
    sub = `Your Contract says stop after ${lossStop()} in a row. Close the platform, log what's left, and finish compliant, not even.`;
  } else if (h === "Rusher" || h === "Competitor") {
    if (inCool) {
      head = `<span class="red-word">${c - m} min</span> left in your cooldown.`;
      sub = `Your Contract: ${c} minutes off-screen after any loss. Your rule: ${esc(H[h].rule)}.`;
    } else if (inWin) {
      head = "Cooldown done. Ego Check before the next trade.";
      sub = `Trades in the next ${w - m} min still count toward Tilt Tax.`;
    } else {
      head = m == null || m > 24 * 60 ? "No recent loss." : `Last loss ${ago(m)} ago.`;
      sub = `After any loss: ${c} minutes off-screen, then the 60-Second Ego Check.`;
    }
  } else if (h === "Performer") {
    head = p.hidePnl ? "P&amp;L stays hidden while you trade." : "P&amp;L is showing.";
    sub = `Log red trades first, within 10 minutes. Your rule: ${esc(H[h].rule)}${coolLine}`;
    extras.push(`<button class="btn secondary auto" type="button" data-act="toggle-pnl">${p.hidePnl ? "Show P&amp;L" : "Hide P&amp;L"}</button>`);
  } else if (h === "Intellectualizer") {
    const skips = S.entries.filter((e) => e.kind === "skip" && e.at >= today).length;
    head = "Let a valid setup pass?";
    sub = `Count it, don't explain it. Your rule: ${esc(H[h].rule)}.${coolLine}`;
    extras.push(`<button class="btn secondary auto" type="button" data-act="skip">+1 setup I let pass</button><span class="small faint num">${skips} today</span>`);
  } else {
    head = "Which hijack is this?";
    sub = `Take the <a href="../audit/" target="_blank" rel="noopener">3-minute Reset Audit</a>, then set it in Settings. Until then, tag what you notice.${coolLine}`;
  }
  const caughtLine = caught ? `<span class="small faint num">${caught} urge${caught === 1 ? "" : "s"} caught today</span>` : "";
  const hot = done || (inCool && (h === "Rusher" || h === "Competitor"));
  el.className = `callout ${hot ? "hot" : strong ? "left-red" : "left-amber"}`;
  el.innerHTML = `<div class="watch-row">
    <img class="avatar" src="${AV(h)}" alt="${known ? `${WHO[h]}, the ${h}` : ""}" width="56" height="56">
    <div>${tag}<h4>${head}</h4><p>${sub}</p>
      <div class="row">${check}${extras.join("")}${caughtLine}</div></div></div>`;
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
  } else if (b.dataset.act === "check") {
    openCheck();
  }
});

// ---------- pre-trade check ----------
// Ten-odd seconds between the urge and the click: three honest questions, the stop rule and one box breath.
// It records only how it ended (kind "check", outcome "skip" | "take"), so the weekly report can count urges caught.
const BREATH = ["Breathe in", "Hold", "Breathe out", "Hold"];
function openCheck() {
  const h = S.profile.hijack;
  const known = HIJACKS.includes(h);
  $("chk-av").src = AV(h);
  $("chk-av").alt = known ? `${WHO[h]}, the ${h}` : "";
  $("chk-title").textContent = known ? `The ${h} wants this trade.` : "Who wants this trade?";
  $("chk-rule").textContent = known ? `When the ${h} shows up, I ${H[h].rule}.` : "Stop, breathe once, then let the written plan decide.";
  S.check.answers = {};
  for (const b of $("check-form").querySelectorAll("[data-a]")) b.setAttribute("aria-pressed", "false");
  $("chk-verdict").textContent = "";
  $("chk-verdict").classList.remove("warn");
  $("chk-take").disabled = true;
  $("chk-take").textContent = "Take it";
  startBreath();
  $("d-check").showModal();
}
function startBreath() {
  clearInterval(S.check.timer);
  S.check.left = 16;
  const box = $("chk-box");
  box.classList.remove("run");
  void box.offsetWidth; // restart the trace animation
  box.classList.add("run");
  const tick = () => {
    const done = 16 - S.check.left;
    $("chk-count").textContent = String(Math.max(0, S.check.left));
    $("chk-breath").textContent = S.check.left > 0 ? `${BREATH[Math.floor(done / 4) % 4]} · ${4 - (done % 4)}` : "Breath done. Now decide.";
    if (S.check.left <= 0) {
      clearInterval(S.check.timer);
      box.classList.remove("run");
      updateVerdict();
    }
    S.check.left--;
  };
  tick();
  S.check.timer = setInterval(tick, 1000);
}
function updateVerdict() {
  const a = S.check.answers;
  const answered = ["setup", "size", "aim"].filter((k) => a[k]).length;
  const anyNo = ["setup", "size", "aim"].some((k) => a[k] === "no");
  const v = $("chk-verdict");
  v.classList.toggle("warn", anyNo);
  if (anyNo) v.textContent = "No trade. Go to the Pause: body, breath, name it, then decide.";
  else if (answered === 3) v.textContent = S.check.left > 0 ? "All three yes. Finish the breath, then it's your call." : "All three yes. It's your call.";
  else v.textContent = "";
  $("chk-take").disabled = S.check.left > 0;
  $("chk-take").textContent = anyNo ? "Take it anyway" : "Take it";
}
$("check-form").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-a]");
  if (!b) return;
  const q = b.closest("[data-q]").dataset.q;
  S.check.answers[q] = b.dataset.a;
  for (const x of b.parentElement.querySelectorAll("[data-a]")) x.setAttribute("aria-pressed", String(x === b));
  updateVerdict();
});
function endCheck(outcome) {
  clearInterval(S.check.timer);
  const ref = doc(tradesCol());
  setDoc(ref, {
    kind: "check", at: Timestamp.now(), hijack: HIJACKS.includes(S.profile.hijack) ? S.profile.hijack : "none",
    outcome, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }).catch((e) => toast(writeError(e)));
  touchLastLog();
  $("d-check").close();
  toast(outcome === "skip" ? "Urge caught. That's one the hijack didn't get." : "Noted. Log the trade when it's done.",
    () => deleteDoc(ref).catch(() => {}));
}
$("chk-skip").addEventListener("click", () => endCheck("skip"));
$("chk-take").addEventListener("click", () => endCheck("take"));
$("d-check").addEventListener("close", () => { clearInterval(S.check.timer); $("chk-box").classList.remove("run"); });

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
  for (const b of $("log-size").querySelectorAll("button")) b.setAttribute("aria-pressed", String(S.log.size === b.dataset.size));
  for (const b of $("log-rule").querySelectorAll("button")) b.setAttribute("aria-pressed", String(S.log.rule === b.dataset.rule));
  $("q-rule").hidden = !ruleAsked();
}
// The stop-rule question only matters on a hijacked trade or one taken inside the window after a loss.
function inWindowNow() {
  const m = minutesSinceLastLoss(S.entries, readTime($("log-time")) || new Date());
  return m != null && m <= (S.profile?.windowMin || 30);
}
function ruleAsked() {
  return !!S.profile && ((S.log.hijack && S.log.hijack !== "none") || inWindowNow());
}
// Size sits in the main form for Competitors (sizing up is their pattern); for everyone else it is under "More".
function placeSize() {
  const comp = S.profile?.hijack === "Competitor";
  if (comp) $("q-rule").before($("q-size"));
  else $("more-slot").append($("q-size"));
  $("more-label").textContent = comp ? "Add a note or change the time" : "Add size, a note or the time";
}
function resetLog() {
  S.log = { sign: null, plan: null, hijack: null, size: null, rule: null, startedAt: 0 };
  placeSize();
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
$("log-time").addEventListener("input", () => { renderClock(); syncLog(); });
$("log-size").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-size]");
  if (!b) return;
  S.log.size = S.log.size === b.dataset.size ? null : b.dataset.size; // tap again to clear
  syncLog();
});
$("log-rule").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-rule]");
  if (!b) return;
  S.log.rule = S.log.rule === b.dataset.rule ? null : b.dataset.rule;
  syncLog();
});

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
  const inCool = m != null && m < cooldown();
  const data = {
    kind: "trade", at: Timestamp.fromDate(at), pnl: pnl === 0 ? 0 : pnl, planned: S.log.plan === "yes", hijack: S.log.hijack,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  const note = $("log-note").value.trim().slice(0, 280);
  if (note) data.note = note;
  if (S.log.size) data.size = S.log.size;
  if (S.log.rule && ruleAsked()) data.ruleUsed = S.log.rule === "yes";
  const ref = doc(tradesCol());
  setDoc(ref, data).catch((e) => toast(writeError(e)));
  touchLastLog();
  const secs = S.log.startedAt ? Math.max(1, Math.round((Date.now() - S.log.startedAt) / 1000)) : null;
  const extra = inCool ? ` That was inside your ${cooldown()}-minute cooldown.` : inWin ? " It counts toward Tilt Tax." : "";
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
  else if (e.kind === "check") tags.push(e.outcome === "skip" ? `<span class="badge">Urge caught</span>` : `<span class="badge">Checked, took it</span>`);
  else {
    tags.push(e.hijack === "none" ? `<span class="badge">Clean</span>` : `<span class="badge red">${esc(e.hijack)}</span>`);
    if (e.planned === false) tags.push(`<span class="badge">Not in plan</span>`);
    if (e.afterLoss) tags.push(`<span class="badge red">After a loss</span>`);
    if (e.size === "bigger") tags.push(`<span class="badge red">Bigger size</span>`);
    if (e.ruleUsed === true) tags.push(`<span class="badge">Rule used</span>`);
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
  placeSize();
  renderHabit();
  renderWatch();
  renderClock();
  if (!$("log-hijack").children.length) renderChips();
  const ann = annotate(S.entries, S.profile.windowMin);
  const today = dayStart(new Date());
  const s = summarize(ann, today, addDays(today, 1), { cooldownMin: cooldown() });
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
  const s = summarize(ann, start, end, { cooldownMin: cooldown() });
  const prev = summarize(ann, addDays(start, -7), start, { cooldownMin: cooldown() });
  // 8 weeks ending with the week on screen (only weeks the journal has loaded).
  const firstLoaded = addDays(weekStart(new Date()), -7 * (WEEKS_BACK - 1));
  const series = weeklySeries(ann, start, WEEKS_BACK).filter((w) => w.from >= firstLoaded);
  const spanFrom = series.length ? series[0].from : start;
  const span = summarize(ann, spanFrom, end, { cooldownMin: cooldown() });
  const spanWeeks = series.length || 1;
  const h = HIJACKS.includes(p.hijack) ? p.hijack : null;
  const parts = [];

  // 01: behaviour first. Counts don't depend on luck; one week of money mostly does.
  const k = s.hijackedCount;
  const better = prev.trades && k < prev.hijackedCount;
  const max = Math.max(1, ...series.map((w) => w.hijacked));
  const trend = series.map((w, i) => {
    const now = i === series.length - 1;
    return `<div class="${now ? "now" : ""}${now && !w.hijacked ? " zero" : ""}" title="${w.hijacked} hijacked of ${w.trades}">
      <span>${w.trades ? w.hijacked : "–"}</span><i style="height:${Math.round((w.hijacked / max) * 56) + 3}px"></i></div>`;
  }).join("");
  const report = [`<div class="step-tag">01 / Hijacked trades</div>
    <p class="lead ${k ? (better ? "green" : "red") : s.trades ? "green" : ""}">${esc(headline(s, prev))}</p>`];
  if (s.trades || s.checks) {
    report.push(`<p class="section-sub">${s.trades} trade${s.trades === 1 ? "" : "s"} logged, ${s.trades - k} clean.${s.trades ? ` A hijack took ${Math.round(s.taggedShare * 100)}% of them.` : ""}</p>`);
  }
  if (series.length > 1) {
    report.push(`<div class="trend" style="grid-template-columns:repeat(${series.length},1fr)" aria-label="Hijacked trades per week, last ${series.length} weeks">${trend}</div>
      <div class="trend-axis"><span>${series.length} weeks ago</span><span>${S.weekOffset === 0 ? "this week" : "that week"}</span></div>`);
  }
  const extra = [];
  extra.push(stat("Urges caught", s.urgesCaught, { sub: s.checks ? `${s.checks} Ego Check${s.checks === 1 ? "" : "s"}` : "use the 60-Second Ego Check" }));
  extra.push(stat("Cooldown broken", s.cooldownBroken, { red: s.cooldownBroken > 0, sub: `trade${s.cooldownBroken === 1 ? "" : "s"} inside your ${cooldown()}-min cooldown` }));
  extra.push(stat("After a loss", s.tiltCount, { red: s.tiltCount > 0, sub: `trade${s.tiltCount === 1 ? "" : "s"} within ${p.windowMin} min of a loss` }));
  if (s.biggerAfterLoss || h === "Competitor") extra.push(stat("Bigger after a loss", s.biggerAfterLoss, { red: s.biggerAfterLoss > 0, sub: "sized up to win it back" }));
  if (s.skips || h === "Intellectualizer") extra.push(stat("Setups let pass", s.skips, { sub: "valid setups you let go" }));
  report.push(`<div class="stat-grid" style="margin-top:16px">${extra.join("")}</div>`);
  parts.push(`<div class="card">${report.join("")}</div>`);

  // 02: money over 8 weeks (the number to trust), this week underneath.
  if (span.trades) {
    parts.push(`<div class="card"><div class="step-tag">02 / What the hijack cost · last ${spanWeeks} week${spanWeeks === 1 ? "" : "s"}</div>
      <div class="stat-grid">
        ${stat("Hijacked trades", money(span.hijackNet, c, { sign: true }), { red: span.hijackNet < 0, sub: `${span.hijackedCount} trade${span.hijackedCount === 1 ? "" : "s"} · this week ${money(s.hijackNet, c, { sign: true })}` })}
        ${stat("Tilt Tax", money(span.tiltNet, c, { sign: true }), { red: span.tiltNet < 0, sub: `${span.tiltCount} after a loss · this week ${money(s.tiltNet, c, { sign: true })}` })}
        ${stat("Without the hijack", money(span.cleanNet, c, { sign: true }), { sub: `your ${span.trades - span.hijackedCount} clean trade${span.trades - span.hijackedCount === 1 ? "" : "s"}` })}
        ${stat("Not in your plan", money(span.unplannedNet, c, { sign: true }), { sub: `${span.unplannedCount} trade${span.unplannedCount === 1 ? "" : "s"}` })}
      </div>
      <p class="small faint" style="margin-top:12px">One week of P&amp;L is mostly luck. The longer total is the one to trust.${p.hidePnl ? " P&amp;L shows here even with Hide P&amp;L on." : ""}</p></div>`);
  }

  // 03: who took the trades this week + does the stop rule work for you?
  if (s.trades) {
    const rows = [];
    if (s.byHijack.length) {
      const top = Math.max(...s.byHijack.map((b) => b.count));
      rows.push(`<div class="bars" style="margin-bottom:18px">${s.byHijack.map((b) => `
        <div class="bar"><div class="top-line"><b>${b.name}</b><span class="num soft">${b.count} · ${money(b.net, c, { sign: true })}</span></div>
          <div class="track"><div class="fill" style="width:${Math.round((b.count / top) * 100)}%"></div></div></div>`).join("")}
      </div>`);
    }
    if (span.ruleYesCount + span.ruleNoCount > 0) {
      rows.push(`<div class="stat-grid">
        ${stat("Rule used first", money(span.ruleYesNet, c, { sign: true }), { sub: `${span.ruleYesCount} hijacked trade${span.ruleYesCount === 1 ? "" : "s"}, ${spanWeeks} wk` })}
        ${stat("Rule skipped", money(span.ruleNoNet, c, { sign: true }), { red: span.ruleNoNet < 0, sub: `${span.ruleNoCount} hijacked trade${span.ruleNoCount === 1 ? "" : "s"}, ${spanWeeks} wk` })}
      </div>`);
    }
    if (rows.length) parts.push(`<div class="card"><div class="step-tag">03 / Who took the trades</div>${rows.join("")}</div>`);
  }
  if (h) {
    parts.push(`<div class="callout left-amber"><div class="step-tag">Your stop rule</div>
      <p class="rule">When the ${h} shows up, I ${esc(H[h].rule)}.</p></div>`);
  }
  if (h && S.weekOffset === 0 && (span.hijackNet < 0 || span.tiltNet < 0)) parts.push(offerCard(h, c));
  if (s.trades || s.checks) {
    parts.push(`<div class="callout left-green"><div class="step-tag">A witness</div>
      <h4>Share your week with one person.</h4><p>Tracking works better when someone else sees it. This shares counts only, never money.</p>
      <div class="row"><button class="btn secondary auto" type="button" data-act="share">Share my week</button></div></div>`);
  }
  const list = ann.filter((e) => e.at >= start && e.at < end).reverse();
  parts.push(list.length
    ? `<div class="card"><details><summary style="cursor:pointer;font-weight:700;font-size:13.5px">All ${list.length} entr${list.length === 1 ? "y" : "ies"} ${S.weekOffset === 0 ? "this week" : "that week"}</summary>
        <ul class="entries" style="margin-top:8px">${list.map((e) => entryRow(e, true)).join("")}</ul></details></div>`
    : `<p class="empty-state">No trades logged ${S.weekOffset === 0 ? "this week yet" : "that week"}.</p>`);
  $("week-body").innerHTML = parts.join("");
  S.lastWeek = { s, prev, start };
}

// Counts only: hijacked trades, urges caught, rule use. No money, no notes.
function shareText() {
  const { s, prev, start } = S.lastWeek || {};
  if (!s) return "";
  const lines = [`Reset Journal · week of ${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`];
  lines.push(`Hijacked trades: ${s.hijackedCount} of ${s.trades}${prev?.trades ? ` (last week ${prev.hijackedCount})` : ""}`);
  if (s.checks) lines.push(`Urges caught before the click: ${s.urgesCaught} of ${s.checks}`);
  if (s.ruleYesCount + s.ruleNoCount) lines.push(`Stop rule used first: ${s.ruleYesCount} of ${s.ruleYesCount + s.ruleNoCount} hijacked trades`);
  if (s.tiltCount) lines.push(`Trades within ${S.profile.windowMin} min of a loss: ${s.tiltCount}`);
  return lines.join("\n");
}
async function shareWeek() {
  const text = shareText();
  try {
    if (navigator.share) { await navigator.share({ title: "My Reset Journal week", text }); return; }
  } catch (e) { if (e?.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it to your witness."); }
  catch (_) { toast("Couldn't copy. Take a screenshot instead."); }
}

function offerCard(h, c) {
  const pr = PRICE[c] || PRICE.INR;
  // Founding seats are on sale: the button opens checkout on the homepage (no personal data in the link).
  const reserved = lsGet("rt-reserved-reset") === "1";
  return `<div class="card">
    <div class="step-tag">Your Personal Reset</div>
    <h3>The journal shows you what the ${h} costs. The course trains it out.</h3>
    ${reserved ? `<p class="small">You reserved a founding seat. Seats are open now.</p>` : ""}
    <p class="small soft">12 video modules with drills made for the ${h}. Seats include 3 months of Journal Pro free when paid plans start (it stays free during the beta).</p>
    <p class="price"><s>${pr.was}</s><b>${pr.now}</b><span class="small faint">founding price</span></p>
    <a class="btn" href="/?buy=1&amp;region=${pr.region}#reset" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none">Buy my founding seat →</a>
    <p class="small faint" style="margin-top:10px">Pay now, start on 1 January 2027. Full refund if it doesn't open by then.</p>
  </div>`;
}

$("week-body").addEventListener("click", async (ev) => {
  if (ev.target.closest("button[data-act='share']")) { shareWeek(); return; }
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
  $("edit-title").textContent = trade ? "Edit trade" : e.kind === "check" ? "Pre-trade check" : "Setup let pass";
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
  $("set-cooldown").value = String(p.cooldownMin || 10);
  $("set-lossstop").value = String(p.lossStop || 2);
  if (!$("set-window").value) $("set-window").value = "30";
  $("set-hide").checked = !!p.hidePnl;
  $("set-remind").value = defaultRemindTime();
  $("set-install").hidden = !S.installEvent;
  $("set-msg").textContent = "";
  $("set-email").textContent = `Signed in as ${S.user.email}${S.user.emailVerified ? "" : " (email not confirmed yet)"}.`;
  $("d-settings").showModal();
});
$("set-save").addEventListener("click", () => {
  updateDoc(profileRef(), {
    hijack: $("set-hijack").value,
    currency: $("set-cur").value,
    windowMin: Number($("set-window").value),
    cooldownMin: Number($("set-cooldown").value),
    lossStop: Number($("set-lossstop").value),
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
    downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `reset-journal-${toLocalInput(new Date()).slice(0, 10)}.csv`);
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

// ---------- habit: home-screen install + daily reminder ----------
// The simulation's biggest single lever after the pre-trade check was people staying past week four.
// No push server yet, so the reminder is a repeating calendar event (works on every phone, no account needed).
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  S.installEvent = e;
  if (S.view === "app") renderHabit();
});
window.addEventListener("appinstalled", () => { S.installEvent = null; lsSet("rt-journal-habit", "done"); renderHabit(); });

function renderHabit() {
  const card = $("habit");
  const hasTrades = S.entries.some((e) => e.kind === "trade");
  card.hidden = !hasTrades || lsGet("rt-journal-habit") === "done" || standalone();
  card.querySelector("[data-act='install']").hidden = !S.installEvent;
  $("ios-hint").hidden = !(isIos() && !standalone());
}
async function installApp() {
  if (!S.installEvent) {
    toast(isIos() ? "On iPhone: tap Share, then Add to Home Screen." : "Use your browser menu: Add to Home screen.");
    return;
  }
  S.installEvent.prompt();
  try { await S.installEvent.userChoice; } catch (_) {}
  S.installEvent = null;
  renderHabit();
}
function defaultRemindTime() {
  return lsGet("rt-journal-remind") || (cur() === "INR" ? "15:35" : "16:05");
}
function reminderIcs(hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date();
  const start = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(hh)}${pad(mm)}00`; // floating = phone's own time
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const url = "https://www.resettraders.com/journal/";
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reset Traders//Reset Journal//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:reset-journal-${Date.now()}@resettraders.com`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, "DURATION:PT5M",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "SUMMARY:Log today's trades · Reset Journal",
    `DESCRIPTION:20 seconds a trade. Tag the hijack. ${url}`, `URL:${url}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Log today's trades", "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", ""
  ].join("\r\n");
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Google Calendar's "add event" page with the repeat already set: no file download, and the calendar app
// sends the notification. (No push server yet, so the journal itself can't notify.)
function googleCalUrl(hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  const start = new Date(); start.setHours(hh, mm, 0, 0);
  const end = new Date(start.getTime() + 5 * 60000);
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Log today's trades · Reset Journal",
    details: "20 seconds a trade. Tag the hijack. https://www.resettraders.com/journal/",
    dates: `${fmt(start)}/${fmt(end)}`,
    ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
    recur: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
// The trader chooses: Google Calendar (an add-event page, never a download) or an Apple Calendar file.
// Guessing by device sent iPhone/iPad users a file download they didn't expect.
function addReminder(hhmm, kind) {
  const time = /^\d{2}:\d{2}$/.test(hhmm || "") ? hhmm : defaultRemindTime();
  lsSet("rt-journal-remind", time);
  if (kind === "apple") {
    downloadBlob(new Blob([reminderIcs(time)], { type: "text/calendar;charset=utf-8" }), "reset-journal-reminder.ics");
    toast(`Open the downloaded file and tap Add to Calendar. Reminder at ${time}, Monday to Friday.`);
    return;
  }
  const url = googleCalUrl(time);
  const win = window.open(url, "_blank", "noopener");
  if (!win && !standalone()) location.href = url; // pop-up blocked: open it here instead
  toast(`Tap Save in Google Calendar. It will remind you at ${time}, Monday to Friday.`);
}
$("habit").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  if (b.dataset.act === "install") installApp();
  else if (b.dataset.act === "remind-google") addReminder(defaultRemindTime(), "google");
  else if (b.dataset.act === "remind-apple") addReminder(defaultRemindTime(), "apple");
  else if (b.dataset.act === "dismiss-habit") { lsSet("rt-journal-habit", "done"); renderHabit(); }
});
$("set-remind-google").addEventListener("click", () => addReminder($("set-remind").value, "google"));
$("set-remind-apple").addEventListener("click", () => addReminder($("set-remind").value, "apple"));
$("set-install").addEventListener("click", installApp);

setAuthMode(lsGet(HAS_ACCOUNT) ? "in" : "up");
