// Reset Audit -> lead capture.
// Saves {email + profile summary} to Firestore `auditLeads` and asks the audit-lead Worker to send the result email.
// The quiz answers themselves never leave the device.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  addDoc,
  collection,
  getFirestore,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-lite.js";

// Public web config of the registered "ResetTraders" web app (not a secret; access is controlled by firestore.rules).
const firebaseConfig = {
  apiKey: "AIzaSyBfZqEU-fJrOm0L9A5sFnexs9VUvbgHnQs",
  authDomain: "resettraders-ead44.firebaseapp.com",
  projectId: "resettraders-ead44",
  storageBucket: "resettraders-ead44.firebasestorage.app",
  messagingSenderId: "546098280910",
  appId: "1:546098280910:web:c3aef977ac26198177939f"
};
const WORKER_URL = "https://audit-lead.resettradersofficial.workers.dev/";
const UNLOCK_AFTER_MS = 6000;
const TAKEN_KEY = "rt_audit_taken";

const db = getFirestore(initializeApp(firebaseConfig, "audit"));
const params = new URLSearchParams(location.search);
const source = params.get("test") === "1" ? "test" : "audit";
// Where the visitor came from (?ref=dm etc.). Anything outside this list is ignored.
const ALLOWED_REFS = ["dm", "bio", "story", "reel"];
const refParam = String(params.get("ref") || "").trim().toLowerCase();
const ref = ALLOWED_REFS.includes(refParam) ? refParam : null;

function takenBefore() {
  try { return localStorage.getItem(TAKEN_KEY) === "1"; } catch (_) { return false; }
}
function markTaken() {
  try { localStorage.setItem(TAKEN_KEY, "1"); } catch (_) {}
}

async function saveLead(email, profile, isRetake) {
  await addDoc(collection(db, "auditLeads"), {
    email,
    type: profile.type,
    pct: { R: profile.pct.R, P: profile.pct.P, C: profile.pct.C, I: profile.pct.I },
    body: profile.body,
    nerve: profile.nerve,
    stage: profile.stage,
    rule: String(profile.rule || "").slice(0, 400),
    level: profile.level,
    root: profile.root,
    leads: profile.leads,
    patterns: profile.patterns,
    isRetake,
    source,
    ...(ref ? { ref } : {}),
    createdAt: serverTimestamp()
  });
}

async function sendEmail(email, profile, isRetake) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      isRetake,
      ...(ref ? { ref } : {}),
      website: "",
      profile: { type: profile.type, pct: profile.pct, body: profile.body, nerve: profile.nerve, stage: profile.stage, rule: profile.rule, level: profile.level, root: profile.root, leads: profile.leads, patterns: profile.patterns }
    })
  });
  if (!res.ok) throw new Error(`audit-lead ${res.status}`);
}

window.ResetAudit = window.ResetAudit || {};
window.ResetAudit.onEmail = async (rawEmail, profile) => {
  const honeypot = document.getElementById("website");
  if (honeypot && honeypot.value) return true;

  const email = String(rawEmail || "").trim().toLowerCase();
  const isRetake = takenBefore();
  markTaken();
  const work = Promise.allSettled([
    saveLead(email, profile, isRetake),
    sendEmail(email, profile, isRetake)
  ]).then((results) => {
    results.forEach((r) => { if (r.status === "rejected") console.warn("[audit]", r.reason); });
  });
  // Never keep the visitor waiting: unlock after 6 s even if the network is slow. The requests keep running.
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, UNLOCK_AFTER_MS))]);
  return true;
};
