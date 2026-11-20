// Your Personal Reset: the course app at /course/.
// Lessons, modules and the Tilt Profile questions live in Firestore (resetLessons, resetModules),
// readable only by buyers after opening and by admins (see firestore.rules). Nothing from the
// course itself is in this file.
import {
  auth, db, safeText, getUserProfile, isAdminProfile, registerActiveSession, watchSingleSession, clearActiveSession,
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc, deleteDoc, serverTimestamp,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "/firebase.js?v=20261118-video";
import { privateVideoUrl } from "/video.js?v=20261118-video";
import { sketchHtml } from "/course/sketch.js?v=20261120";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const OPENS_MS = Date.parse("2027-01-01T00:00:00+05:30"); // same moment as firestore.rules and the video Worker
const OPENS_LABEL = "1 January 2027";
const HIJACKS = {
  Rusher: "Gets in early. Can't stand waiting.",
  Performer: "Needs to look good. Hides the red days.",
  Competitor: "Has to win it back. Sizes up after a loss.",
  Intellectualizer: "Thinks it through, then explains away the broken rule."
};

const $ = (id) => document.getElementById(id);
const S = { user: null, profile: null, admin: false, modules: [], lessons: [], proofs: new Set(), hijack: "", current: "", unsubs: [] };

// ---------- small helpers ----------
function toast(text) {
  const t = $("toast"); t.textContent = text; t.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}
function show(id) { for (const g of ["gate-login", "gate-wait", "app"]) $(g).hidden = g !== id; }
const showCode = (code) => /^([0-9]+|F).[0-9]+$/.test(code || "");
function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (_) { return null; } }

// Second line of defence: the lesson HTML was cleaned when it was built; clean it again before rendering.
const TAGS = new Set(["P", "B", "STRONG", "I", "EM", "U", "SMALL", "BR", "UL", "OL", "LI", "H4", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "DIV", "SPAN", "CODE", "BLOCKQUOTE", "LABEL", "INPUT", "SELECT", "OPTION", "BUTTON", "SUP", "SUB"]);
const ATTRS = new Set(["class", "id", "type", "value", "min", "max", "step", "name", "placeholder"]);
function cleanHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html || "");
  const walk = (node) => {
    for (const el of [...node.children]) {
      if (!TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) {
        const ok = ATTRS.has(a.name) || (a.name === "style" && /^(width:[0-9.]+%;)?\s*(background|color):#[0-9a-fA-F]{3,6}$/.test(a.value));
        if (!ok) el.removeAttribute(a.name);
      }
      walk(el);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

// ---------- access ----------
function seatStatus(profile) { return profile?.reset?.status || ""; }
function hasSeat(profile) { return ["founding", "standard"].includes(seatStatus(profile)); }

onAuthStateChanged(auth, async (user) => {
  stopListening();
  S.user = user;
  if (!user) { show("gate-login"); return; }
  let profile = null;
  try { profile = await getUserProfile(user.uid); } catch (_) {}
  S.profile = profile;
  S.admin = isAdminProfile(profile);
  if (!S.admin && !hasSeat(profile)) {
    $("wait-title").textContent = "No seat on this account";
    $("wait-text").innerHTML = `We couldn't find a Your Personal Reset seat for <b>${safeText(user.email)}</b>. If you bought one with a different email, sign out and log in with that one. If something looks wrong, <a href="/contact/">write to us</a>.`;
    show("gate-wait"); return;
  }
  if (!S.admin && Date.now() < OPENS_MS) {
    $("wait-title").textContent = "Your seat is confirmed";
    $("wait-text").innerHTML = `Your Personal Reset opens on <b>${OPENS_LABEL}</b>. Log in here that day; we'll email you too. Until then, the free <a href="/journal/">Journal Pro</a> is a good place to start logging your hijack.`;
    show("gate-wait"); return;
  }
  try {
    await registerActiveSession(user);
    S.unsubs.push(watchSingleSession(user, async () => {
      await signOut(auth);
      setLoginMsg("You were signed out because this account logged in on another device.", "error");
    }));
  } catch (_) {}
  await loadCourse();
});

function stopListening() { S.unsubs.splice(0).forEach((u) => { try { u(); } catch (_) {} }); }

// ---------- login ----------
function setLoginMsg(text, state) { const m = $("login-msg"); m.textContent = text; m.dataset.state = state || ""; }
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const email = String(f.get("email") || "").trim().toLowerCase();
  const password = String(f.get("password") || "");
  if (!email || !password) return setLoginMsg("Enter your email and password.", "error");
  $("login-btn").disabled = true; setLoginMsg("Logging in…");
  try { await signInWithEmailAndPassword(auth, email, password); setLoginMsg(""); }
  catch (err) {
    const code = err?.code || "";
    setLoginMsg(code.includes("too-many") ? "Too many attempts. Wait a minute and try again." : "That email and password don't match. Try again, or reset your password.", "error");
  } finally { $("login-btn").disabled = false; }
});
$("forgot").addEventListener("click", async () => {
  const email = String(new FormData($("login-form")).get("email") || "").trim().toLowerCase();
  if (!email) return setLoginMsg("Type your email above first, then press Forgot password.", "error");
  try { await sendPasswordResetEmail(auth, email); setLoginMsg("If that email has an account, a reset link is on its way.", "ok"); }
  catch (_) { setLoginMsg("If that email has an account, a reset link is on its way.", "ok"); }
});
document.querySelectorAll("[data-signout]").forEach((b) => b.addEventListener("click", async () => {
  try { await clearActiveSession(auth.currentUser); } catch (_) {}
  await signOut(auth);
}));

// ---------- load ----------
async function loadCourse() {
  show("app");
  $("admin-badge").hidden = !S.admin;
  $("import-btn").hidden = !S.admin;
  $("lesson").innerHTML = `<p class="locked-note">Loading your course…</p>`;
  try {
    const [mods, lessons] = await Promise.all([
      getDocs(query(collection(db, "resetModules"), orderBy("order", "asc"))),
      getDocs(query(collection(db, "resetLessons"), orderBy("order", "asc")))
    ]);
    S.modules = mods.docs.map((d) => ({ id: d.id, ...d.data() }));
    S.lessons = lessons.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.active !== false);
  } catch (err) {
    $("lesson").innerHTML = `<p class="locked-note">The course couldn't load (${safeText(err.message)}). Reload the page. If it keeps happening, <a href="/contact/">tell us</a>.</p>`;
    return;
  }
  if (!S.lessons.length) { $("lesson").innerHTML = `<p class="locked-note">No lessons are published yet.</p>`; return; }
  try { const p = await getDoc(doc(db, "users", S.user.uid, "resetState", "prefs")); S.hijack = p.exists() ? p.data().hijack || "" : ""; } catch (_) {}
  renderHijackBtn();
  if (S.proofUnsub) S.proofUnsub();
  S.proofUnsub = onSnapshot(collection(db, "users", S.user.uid, "resetProofs"), (snap) => {
    S.proofs = new Set(snap.docs.map((d) => d.id));
    renderSide(); renderProgress(); syncProofBoxes();
  });
  S.unsubs.push(() => { if (S.proofUnsub) S.proofUnsub(); S.proofUnsub = null; });
  const start = (location.hash.slice(1) && S.lessons.find((l) => l.id === location.hash.slice(1))) || S.lessons.find((l) => l.id === store("rt_reset_last")) || S.lessons[0];
  openLesson(start.id, false);
  if (!S.hijack && !S.admin) setTimeout(() => $("hijack-dlg").showModal(), 600);
}

// ---------- locks ----------
function moduleLessons(mid) { return S.lessons.filter((l) => l.module === mid); }
function moduleProofs(mid) { return moduleLessons(mid).flatMap((l) => l.proofs || []); }
function lockMap() {
  const map = {}; let prevDone = true;
  for (const m of S.modules) {
    const unlocked = S.admin || m.gate === "open" || prevDone;
    map[m.id] = unlocked;
    const proofs = moduleProofs(m.id);
    if (proofs.length) prevDone = unlocked && proofs.every((p) => S.proofs.has(p.id));
  }
  return map;
}
function visibleLessons(mid) {
  // Drills: one entry per module, the one for the student's hijack.
  const all = moduleLessons(mid);
  const lessons = all.filter((l) => l.type !== "drill");
  const drills = all.filter((l) => l.type === "drill");
  if (drills.length) lessons.push({ id: `drills-${mid}`, type: "drill-slot", module: mid, code: "Drill", title: S.hijack ? `Your drill: the ${S.hijack}` : "Your hijack drill", drills });
  return lessons;
}
function findItem(id) {
  for (const m of S.modules) { const hit = visibleLessons(m.id).find((l) => l.id === id); if (hit) return hit; }
  const raw = S.lessons.find((l) => l.id === id);
  if (raw && raw.type === "drill") return visibleLessons(raw.module).find((l) => l.type === "drill-slot");
  return null;
}
function itemDone(item) {
  if (item.type === "drill-slot") return false;
  return (item.proofs || []).length > 0 && item.proofs.every((p) => S.proofs.has(p.id));
}

// ---------- sidebar ----------
function renderSide() {
  const locks = lockMap();
  const curMod = findItem(S.current)?.module;
  $("side").innerHTML = S.modules.map((m) => {
    const open = locks[m.id];
    const items = visibleLessons(m.id);
    const label = /^[0-9]+$/.test(m.no) ? `Module ${m.no}` : m.no === "F" ? "Final module" : "";
    return `<div class="mod-group ${open ? "" : "locked"}" style="--a:${safeText(m.accent || "#e8b84a")}">
      <button class="mod-head" type="button" data-mod="${safeText(m.id)}" aria-expanded="${m.id === curMod}">
        <span class="mod-no">${safeText(m.no)}</span><span>${label ? `<small style="display:block;color:var(--muted);font:600 11px var(--body);letter-spacing:.08em;text-transform:uppercase">${label}</small>` : ""}${safeText(m.title)}</span>
        ${open ? "" : `<span class="lock" title="Tick the proofs in the module before to open this one">🔒</span>`}
      </button>
      <div class="mod-items" ${m.id === curMod ? "" : "hidden"}>
        ${items.map((l) => `<button class="lesson-link ${l.id === S.current ? "active" : ""}" type="button" data-lesson="${safeText(l.id)}" ${open ? "" : "disabled"}>
          <span class="code">${safeText(showCode(l.code) ? l.code : "")}</span><span>${safeText(l.title)}</span>${itemDone(l) ? `<span class="tick" aria-label="done">✓</span>` : ""}
        </button>`).join("")}
      </div>
    </div>`;
  }).join("");
}
$("side").addEventListener("click", (e) => {
  const head = e.target.closest("[data-mod]");
  if (head) { const items = head.nextElementSibling; items.hidden = !items.hidden; head.setAttribute("aria-expanded", String(!items.hidden)); return; }
  const link = e.target.closest("[data-lesson]");
  if (link && !link.disabled) { openLesson(link.dataset.lesson); closeMenu(); }
});
$("menu-btn").addEventListener("click", () => { const open = $("side").classList.toggle("open"); $("menu-btn").setAttribute("aria-expanded", String(open)); });
function closeMenu() { $("side").classList.remove("open"); $("menu-btn").setAttribute("aria-expanded", "false"); }

function renderProgress() {
  const all = S.lessons.flatMap((l) => l.proofs || []);
  const done = all.filter((p) => S.proofs.has(p.id)).length;
  $("progress-bar").style.width = all.length ? `${Math.round((100 * done) / all.length)}%` : "0";
  $("progress-label").textContent = `${done} of ${all.length} proofs`;
}

// ---------- a lesson ----------
function sequence() { return S.modules.flatMap((m) => visibleLessons(m.id)); }

async function openLesson(id, scroll = true) {
  const item = findItem(id);
  if (!item) return;
  const locks = lockMap();
  if (!locks[item.module]) { toast("Tick the proofs in the module before to open this one."); return; }
  S.current = item.id;
  store("rt_reset_last", item.id);
  history.replaceState(null, "", `#${item.id}`);
  const mod = S.modules.find((m) => m.id === item.module) || {};
  document.documentElement.style.setProperty("--a", mod.accent || "#e8b84a");
  const firstOfModule = visibleLessons(item.module)[0]?.id === item.id;
  const lesson = item.type === "drill-slot" ? item.drills.find((d) => d.hijack === S.hijack) : item;
  const crumb = /^[0-9]+$/.test(mod.no) ? `Module ${mod.no} · ${mod.title}` : mod.title;

  let body = "";
  if (item.type === "drill-slot" && !lesson) {
    body = `<p class="locked-note">Pick your hijack and you'll see the drill made for it. Not sure? Take the Tilt Profile in the Pre-course, or use your Reset Audit result.</p>
      <p><button class="btn" type="button" data-pick-hijack>Pick my hijack</button></p>`;
  } else {
    body = `${lesson.video ? `<div class="video" id="video"><div class="video-empty"><div><b>Loading the video…</b></div></div></div>` : ""}
      ${lesson.audio ? `<div class="audio" id="audio"><p class="audio-k">Guided practice · press play and follow along</p><p class="audio-msg">Loading the audio…</p></div>` : ""}
      ${firstOfModule && mod.problem ? `<div class="problem"><b>The trader problem this module fixes</b>${cleanHtml(mod.problem)}</div>` : ""}
      ${firstOfModule && mod.intro ? `<div class="content">${cleanHtml(mod.intro)}</div>` : ""}
      ${item.type === "drill-slot" && lesson.steps?.length ? sketchHtml(lesson.steps, lesson.id.length + (lesson.module || "").length) : ""}
      <div class="content" id="content">${cleanHtml(lesson.html)}</div>
      ${item.type === "drill-slot" ? `<p><button class="link" type="button" data-pick-hijack>Not your hijack? Change it</button></p>` : ""}`;
  }
  const seq = sequence(); const i = seq.findIndex((l) => l.id === item.id);
  const prev = seq[i - 1], next = seq[i + 1];
  const nextOpen = next && locks[next.module];
  $("lesson").innerHTML = `
    <p class="crumb">${safeText(crumb)}</p>
    <h1 class="lesson-title">${safeText(lesson && item.type !== "drill-slot" && showCode(lesson.code) ? lesson.code + " " : "")}${safeText(item.type === "drill-slot" ? item.title : lesson.title)}</h1>
    ${body}
    <div class="pager">
      ${prev ? `<button class="btn secondary" type="button" data-go="${safeText(prev.id)}">← Previous</button>` : "<span></span>"}
      ${next ? (nextOpen ? `<button class="btn" type="button" data-go="${safeText(next.id)}">Next →</button>` : `<span class="locked-note" style="padding:10px 14px">Tick every proof in this module to open the next one.</span>`) : "<span></span>"}
    </div>`;
  if (lesson && item.type !== "drill-slot") { attachProofs(lesson); initTools(lesson); }
  if (lesson?.video) loadVideo(lesson.video);
  if (lesson?.audio) loadAudio(lesson.audio);
  renderSide();
  if (scroll) { window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" }); $("lesson").focus({ preventScroll: true }); }
}
$("lesson").addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]"); if (go) return openLesson(go.dataset.go);
  if (e.target.closest("[data-pick-hijack]")) $("hijack-dlg").showModal();
});

async function loadVideo(key) {
  const box = $("video"); if (!box) return;
  try {
    const url = await privateVideoUrl(key);
    if ($("video") !== box) return;
    box.innerHTML = `<video controls playsinline preload="metadata" controlsList="nodownload" oncontextmenu="return false" src="${safeText(url)}"></video><div class="wm">${safeText(S.user?.email || "")}</div>`;
  } catch (err) {
    const missing = /not found/i.test(err.message);
    box.innerHTML = `<div class="video-empty"><div><b>${missing ? "The video for this lesson is on its way" : "The video couldn't load"}</b>${missing ? "The written lesson below is complete. Start there; the video will appear here when it's ready." : safeText(err.message)}</div></div>`;
  }
}

async function loadAudio(key) {
  const box = $("audio"); if (!box) return;
  try {
    const url = await privateVideoUrl(key);
    if ($("audio") !== box) return;
    box.innerHTML = `<p class="audio-k">Guided practice · press play and follow along</p><audio controls preload="metadata" controlsList="nodownload" src="${safeText(url)}"></audio>`;
  } catch (err) {
    const missing = /not found/i.test(err.message);
    box.innerHTML = `<p class="audio-k">Guided practice</p><p class="audio-msg">${missing ? "The guided audio for this practice is on its way. The steps are written below." : safeText(err.message)}</p>`;
  }
}

// ---------- proofs ----------
function attachProofs(lesson) {
  const boxes = [...document.querySelectorAll("#content .box.assign")];
  (lesson.proofs || []).forEach((p, i) => {
    const box = boxes[i]; if (!box) return;
    const label = document.createElement("label");
    label.className = "proof"; label.dataset.proof = p.id;
    label.innerHTML = `<input type="checkbox"> <span>I did this and have the proof</span>`;
    const input = label.querySelector("input");
    input.addEventListener("change", () => setProof(lesson, p.id, input.checked, label));
    box.appendChild(label);
  });
  syncProofBoxes();
}
function syncProofBoxes() {
  document.querySelectorAll("#content [data-proof]").forEach((label) => {
    const done = S.proofs.has(label.dataset.proof);
    label.classList.toggle("done", done);
    label.querySelector("input").checked = done;
  });
}
async function setProof(lesson, proofId, done, label) {
  const ref = doc(db, "users", S.user.uid, "resetProofs", proofId);
  label.querySelector("input").disabled = true;
  try {
    if (done) await setDoc(ref, { proofId, lessonId: lesson.id, doneAt: serverTimestamp() });
    else await deleteDoc(ref);
    if (done) {
      const before = lockMap();
      S.proofs.add(proofId);
      const after = lockMap();
      const opened = S.modules.find((m) => !before[m.id] && after[m.id]);
      toast(opened ? `${/^[0-9]+$/.test(opened.no) ? "Module " + opened.no : opened.title} is open.` : "Proof saved.");
    }
  } catch (err) {
    toast("Couldn't save that. Check your connection and try again.");
    label.querySelector("input").checked = !done;
  } finally { label.querySelector("input").disabled = false; }
}

// ---------- workbook (private PDF, same signed links as the videos) ----------
$("workbook-btn").addEventListener("click", async () => {
  const btn = $("workbook-btn"); btn.disabled = true; btn.textContent = "Preparing…";
  try {
    const url = await privateVideoUrl("reset-workbook.pdf");
    const a = document.createElement("a"); a.href = url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
    toast("Your workbook is downloading. Print it once, then photocopy the logs.");
  } catch (err) {
    toast(/not found/i.test(err.message) ? "The workbook isn't uploaded yet." : "Couldn't get the workbook. Try again in a minute.");
  } finally { btn.disabled = false; btn.textContent = "Workbook ↓"; }
});

// ---------- hijack ----------
function renderHijackBtn() { $("hijack-btn").textContent = S.hijack ? `Hijack: ${S.hijack}` : "Hijack: not set"; }
$("hijack-btn").addEventListener("click", () => $("hijack-dlg").showModal());
$("hijack-grid").innerHTML = Object.entries(HIJACKS).map(([name, line]) => `<button type="button" data-hijack="${name}">The ${name}<small>${line}</small></button>`).join("");
$("hijack-grid").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-hijack]"); if (!b) return;
  await saveHijack(b.dataset.hijack);
  $("hijack-dlg").close();
});
async function saveHijack(name) {
  try {
    await setDoc(doc(db, "users", S.user.uid, "resetState", "prefs"), { hijack: name, updatedAt: serverTimestamp() });
    S.hijack = name; renderHijackBtn(); toast(`Drills set for the ${name}.`);
    if (S.current) openLesson(S.current, false);
  } catch (_) { toast("Couldn't save that. Try again."); }
}
new MutationObserver(() => document.querySelectorAll("[data-hijack]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hijack === S.hijack)))).observe($("hijack-dlg"), { attributes: true });

// ---------- the course tools ----------
function initTools(lesson) {
  const tools = lesson.tools || [];
  if (tools.includes("streak")) streakTool();
  if (tools.includes("size")) sizeTool();
  if (tools.includes("contract")) contractTool();
  if (tools.includes("tilt")) tiltTool(lesson.toolData?.tilt || []);
}
const q = (sel) => document.querySelector(`#content ${sel}`);

function streakOdds(lossRate, trades, k) {
  let dp = new Array(k).fill(0); dp[0] = 1; let hit = 0;
  for (let i = 0; i < trades; i++) {
    const nw = new Array(k).fill(0);
    for (let r = 0; r < k; r++) { const p = dp[r]; if (!p) continue; nw[0] += p * (1 - lossRate); if (r + 1 >= k) hit += p * lossRate; else nw[r + 1] += p * lossRate; }
    dp = nw;
  }
  return hit;
}
function streakTool() {
  const btn = q("#stgo"); if (!btn) return;
  btn.addEventListener("click", () => {
    const w = parseFloat(q("#stw").value) / 100, n = parseInt(q("#stn").value, 10), out = q("#stout");
    if (!(w > 0 && w < 1 && n > 0 && n <= 5000)) { out.textContent = "Enter a win rate between 1 and 99 and a number of trades."; return; }
    out.innerHTML = `<table><tr><th>Losing streak of at least</th><th>Chance it happens at least once in ${n} trades</th></tr>${[3, 4, 5, 6, 7, 8, 10].map((k) => `<tr><td>${k} in a row</td><td><b>${Math.round(1000 * streakOdds(1 - w, n, k)) / 10}%</b></td></tr>`).join("")}</table><small>Assumes each trade is independent with a fixed win rate. Real markets are messier, but the shape holds.</small>`;
  });
}
function sizeTool() {
  const btn = q("#szgo"); if (!btn) return;
  btn.addEventListener("click", () => {
    const l = parseFloat(q("#szl").value), p = parseFloat(q("#szp").value), r = q("#szr").value, out = q("#szout");
    if (!(l > 0 && p > 0)) { out.textContent = "Enter both sizes."; return; }
    const d = Math.round((100 * (p - l)) / l);
    if (r === "loss" && p > l) out.innerHTML = `<b style="color:var(--red)">Stop. Size is up ${d}% right after a loss.</b> No trade at this size. Go to the Pause.`;
    else if (r === "loss") out.innerHTML = `<b style="color:var(--grn)">Size is the same or smaller after a loss (${d}%).</b> Fine. Now answer the other two Ego Check questions.`;
    else if (p > l * 1.5) out.innerHTML = `<b style="color:var(--gold)">Size is up ${d}% after a win.</b> House-money risk. Is this size in your written plan, or is it mood?`;
    else out.innerHTML = `<b style="color:var(--grn)">Size change ${d}%.</b> Within a normal range. Check it matches your written plan.`;
  });
}
function contractTool() {
  const btn = q("#ctgo"); if (!btn) return;
  const saved = store("rt_reset_contract");
  if (saved && q("#ctout")) q("#ctout").innerHTML = `<b>Your last saved contract:</b><br>${cleanHtml(saved)}`;
  btn.addEventListener("click", () => {
    const v = (id) => safeText((q("#" + id)?.value || "___").trim() || "___");
    const html = `<b>MY RESET CONTRACT</b><br>I, ${v("ctn")}, agree with myself, written while calm on ${new Date().toLocaleDateString("en-IN")}:<ol>
      <li>My <b>daily stop</b> is ${v("ctd")}. When it is hit, I close the platform. No exceptions, no "one more".</li>
      <li>I take at most <b>${v("ctm")} trades</b> a day.</li>
      <li>After any loss I <b>leave the screen for ${v("ctc")} minutes</b>, and my next size is the <b>same or smaller</b>.</li>
      <li>After ${v("ctl")} losses in a row I am <b>done for the day</b>.</li>
      <li>If I break a rule, I log it within 10 minutes and follow the Lapse Protocol. The stake: <b>${v("cts")}</b>.</li></ol>
      Witness who will see my weekly log: <b>${v("ctw")}</b><br>Signed: ____________`;
    q("#ctout").innerHTML = html; store("rt_reset_contract", html);
  });
}
function tiltTool(questions) {
  const box = q("#tiltq"), btn = q("#tiltgo"), out = q("#tiltout"); if (!box || !btn || !questions.length) return;
  const labels = ["Never", "Sometimes", "Often", "Almost always"];
  box.innerHTML = questions.map((x, i) => `<div class="q"><div>${i + 1}. ${safeText(x.q)}</div><div class="opts">${labels.map((l, v) => `<label><input type="radio" name="tq${i}" value="${v}"> ${l}</label>`).join("")}</div></div>`).join("");
  const names = { R: "Rusher", P: "Performer", C: "Competitor", I: "Intellectualizer" };
  const saved = store("rt_reset_tilt");
  if (saved) { try { const s = JSON.parse(saved); out.innerHTML = `<b>Your last saved result (${safeText(s.d)}):</b> ${Object.keys(names).map((k) => `${names[k]} ${Number(s.s[k])}`).join(" · ")}`; } catch (_) {} }
  btn.addEventListener("click", () => {
    const s = { R: 0, P: 0, C: 0, I: 0 }; let n = 0;
    questions.forEach((x, i) => { const r = document.querySelector(`#content input[name=tq${i}]:checked`); if (r && s[x.k] !== undefined) { s[x.k] += Number(r.value); n++; } });
    if (n < questions.length) { out.textContent = `Answer all ${questions.length} first (${n} done).`; return; }
    const ks = Object.keys(s).sort((a, b) => s[b] - s[a]);
    const tot = s.R + s.P + s.C + s.I;
    let prev = null; try { prev = JSON.parse(store("rt_reset_tilt") || "null"); } catch (_) {}
    out.innerHTML = `<b>Your scores (each out of ${questions.length / 4 * 3}):</b><br>${ks.map((k) => `The ${names[k]}: <b>${s[k]}</b>`).join(" · ")}<br><br>
      <b>Strongest pull: the ${names[ks[0]]}</b>${s[ks[0]] === s[ks[1]] ? ` (tied with the ${names[ks[1]]})` : ""}.<br>
      <b>Total ${tot}/${questions.length * 3}.</b> ${tot >= 24 ? "High. Start with the Emergency track in Start Here, then go in order." : tot >= 14 ? "Moderate. Use the Full track." : "Lower. You may already have some brakes. Use the Full track and focus on the structural rules."}
      <br><small>This is a self-reflection tool, not a diagnosis. Write the four scores in your journal as your Day 1 baseline. You retake it in the Final Module.</small>
      ${prev && prev.s ? `<br><br><b>Previous result (${safeText(prev.d)}):</b> ${ks.map((k) => `${names[k]} ${Number(prev.s[k])} → ${s[k]}`).join(" · ")}` : ""}
      <p><button class="btn" type="button" id="tilt-set">Use the ${names[ks[0]]} for my drills</button></p>`;
    store("rt_reset_tilt", JSON.stringify({ s, d: new Date().toLocaleDateString("en-IN") }));
    q("#tilt-set").addEventListener("click", () => saveHijack(names[ks[0]]));
  });
}

// ---------- admin: import reset-lessons.json (built privately by course-production/build-lessons.mjs) ----------
$("import-btn").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0]; e.target.value = "";
  if (!file || !S.admin) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { return toast("That file isn't valid JSON."); }
  if (!Array.isArray(data.modules) || !Array.isArray(data.lessons)) return toast("That isn't a reset-lessons.json file.");
  if (!confirm(`Import ${data.modules.length} modules and ${data.lessons.length} lessons? This replaces the published course content.`)) return;
  try {
    const ids = { m: new Set(data.modules.map((m) => m.id)), l: new Set(data.lessons.map((l) => l.id)) };
    const old = await Promise.all([getDocs(collection(db, "resetModules")), getDocs(collection(db, "resetLessons"))]);
    const writes = [
      ...data.modules.map((m) => ["set", doc(db, "resetModules", m.id), m]),
      ...data.lessons.map((l) => ["set", doc(db, "resetLessons", l.id), l]),
      ...old[0].docs.filter((d) => !ids.m.has(d.id)).map((d) => ["del", d.ref]),
      ...old[1].docs.filter((d) => !ids.l.has(d.id)).map((d) => ["del", d.ref])
    ];
    for (let i = 0; i < writes.length; i += 400) {
      const batch = writeBatch(db);
      for (const [op, ref, value] of writes.slice(i, i + 400)) op === "set" ? batch.set(ref, value) : batch.delete(ref);
      await batch.commit();
    }
    toast(`Imported ${data.lessons.length} lessons.`);
    await loadCourse();
  } catch (err) { toast("Import failed: " + (err.message || err)); }
});
