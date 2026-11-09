// Firestore rules tests. Run from repo root:
//   npx firebase-tools emulators:exec --only firestore --project demo-resettraders "npm --prefix tests/rules test"
// The test bodies mirror the exact reads/writes made by firebase.js, payment.js, portal.js and admin.js.
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where
} from "firebase/firestore";

const RULES = readFileSync(new URL(process.env.RULES_FILE || "../../firestore.rules", import.meta.url), "utf8");
let env;

const ADMIN = { uid: "admin1", email: "resettradersofficial@gmail.com" };
const ACTIVE = { uid: "stu_active", email: "active@example.com" };
const INACTIVE = { uid: "stu_inactive", email: "inactive@example.com" };
const EXPIRED = { uid: "stu_expired", email: "expired@example.com" };
const NEWBIE = { uid: "stu_new", email: "new@example.com" };

const as = (u) => env.authenticatedContext(u.uid, { email: u.email }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const lead = (over = {}) => ({
  email: "lead@example.com", type: "Rusher", pct: { R: 50, P: 20, C: 20, I: 10 },
  body: "chest", nerve: "fight", stage: "f12",
  rule: "When my chest tightens after a loss, I set a 10-minute timer.", isRetake: false,
  source: "test", createdAt: serverTimestamp(), ...over
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-resettraders",
    firestore: { rules: RULES, host: "127.0.0.1", port: 8085 }
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", ADMIN.uid), { uid: ADMIN.uid, email: ADMIN.email, role: "admin", name: "Admin" });
    await setDoc(doc(db, "users", ACTIVE.uid), { uid: ACTIVE.uid, email: ACTIVE.email, role: "student", plan: "course",
      access: { active: true, source: "razorpay_webhook", grantedAt: Timestamp.now() }, createdAt: Timestamp.now() });
    await setDoc(doc(db, "users", INACTIVE.uid), { uid: INACTIVE.uid, email: INACTIVE.email, role: "student",
      access: { active: false, source: "checkout_started" }, createdAt: Timestamp.now() });
    await setDoc(doc(db, "users", EXPIRED.uid), { uid: EXPIRED.uid, email: EXPIRED.email, role: "student",
      access: { active: true, source: "razorpay_webhook", expiresAt: Timestamp.fromMillis(Date.now() - 86400000) } });
    await setDoc(doc(db, "lessons", "l1"), { title: "Lesson 1", order: 1, active: true });
    await setDoc(doc(db, "orders", "o1"), { uid: ACTIVE.uid, amount: 1699900 });
    await setDoc(doc(db, "payments", "p1"), { uid: ACTIVE.uid, status: "paid" });
    await setDoc(doc(db, "site", "public"), { introVideoUrl: "" });
    await setDoc(doc(db, "site", "private"), { note: "x" });
    await setDoc(doc(db, "doubts", "d1"), { uid: ACTIVE.uid, lessonId: "l1", text: "q?" });
    await setDoc(doc(db, "doubts", "d2"), { uid: "someone_else", lessonId: "l1", text: "other q" });
  });
});

// Same shape as firebase.js createInactiveStudentProfile()
async function checkoutProfileWrite(db, user, existing) {
  const base = { uid: user.uid, email: user.email, name: "Test Buyer",
    role: existing?.role === "admin" ? "admin" : "student", updatedAt: serverTimestamp() };
  if ((!existing || existing.access?.active !== true) && existing?.role !== "admin") {
    base.access = { active: false, source: "checkout_started" };
  }
  return setDoc(doc(db, "users", user.uid),
    existing ? { ...base, createdAt: existing.createdAt || serverTimestamp() } : { ...base, createdAt: serverTimestamp() },
    { merge: true });
}

describe("payment flow (checkout account)", () => {
  test("new buyer can create own inactive profile", async () => {
    await assertSucceeds(checkoutProfileWrite(as(NEWBIE), NEWBIE, null));
  });
  test("existing inactive buyer can re-run checkout", async () => {
    const db = as(INACTIVE);
    const existing = (await getDoc(doc(db, "users", INACTIVE.uid))).data();
    await assertSucceeds(checkoutProfileWrite(db, INACTIVE, existing));
  });
  test("existing active student re-running checkout keeps access", async () => {
    const db = as(ACTIVE);
    const existing = (await getDoc(doc(db, "users", ACTIVE.uid))).data();
    await assertSucceeds(checkoutProfileWrite(db, ACTIVE, existing));
  });
  test("admin re-running checkout keeps admin role", async () => {
    const db = as(ADMIN);
    const existing = (await getDoc(doc(db, "users", ADMIN.uid))).data();
    await assertSucceeds(checkoutProfileWrite(db, ADMIN, existing));
  });
  test("new buyer cannot create profile with access.active = true", async () => {
    await assertFails(setDoc(doc(as(NEWBIE), "users", NEWBIE.uid), { uid: NEWBIE.uid, email: NEWBIE.email, role: "student", access: { active: true } }));
  });
  test("new buyer cannot create profile with role admin", async () => {
    await assertFails(setDoc(doc(as(NEWBIE), "users", NEWBIE.uid), { uid: NEWBIE.uid, email: NEWBIE.email, role: "admin", access: { active: false, source: "checkout_started" } }));
  });
  test("new buyer cannot create profile for another uid", async () => {
    await assertFails(checkoutProfileWrite(as(NEWBIE), { ...NEWBIE, uid: "victim" }, null));
  });
  test("inactive student cannot set own access.active", async () => {
    await assertFails(updateDoc(doc(as(INACTIVE), "users", INACTIVE.uid), { "access.active": true }));
  });
  test("inactive student cannot replace access map", async () => {
    await assertFails(setDoc(doc(as(INACTIVE), "users", INACTIVE.uid), { access: { active: true, source: "razorpay_webhook" } }, { merge: true }));
  });
  test("expired student cannot extend own expiry", async () => {
    await assertFails(updateDoc(doc(as(EXPIRED), "users", EXPIRED.uid), { "access.expiresAt": Timestamp.fromMillis(Date.now() + 1e10) }));
  });
  test("expired student cannot remove own expiry", async () => {
    // updateDoc replaces the whole access map (a merge would keep the old expiresAt)
    await assertFails(updateDoc(doc(as(EXPIRED), "users", EXPIRED.uid), { access: { active: true, source: "razorpay_webhook" } }));
    await assertFails(updateDoc(doc(as(EXPIRED), "users", EXPIRED.uid), { "access.expiresAt": null }));
  });
  test("student cannot make self admin", async () => {
    await assertFails(updateDoc(doc(as(ACTIVE), "users", ACTIVE.uid), { role: "admin" }));
  });
  test("student cannot change own plan", async () => {
    await assertFails(updateDoc(doc(as(INACTIVE), "users", INACTIVE.uid), { plan: "mentorship" }));
  });
  test("student cannot add new fields such as Pro flags (live-rules hole)", async () => {
    await assertFails(updateDoc(doc(as(INACTIVE), "users", INACTIVE.uid), { journalPro: true }));
    await assertFails(setDoc(doc(as(ACTIVE), "users", ACTIVE.uid), { proUntil: Timestamp.fromMillis(Date.now() + 1e10) }, { merge: true }));
  });
  test("new buyer cannot pre-seed extra access fields", async () => {
    await assertFails(setDoc(doc(as(NEWBIE), "users", NEWBIE.uid), { uid: NEWBIE.uid, email: NEWBIE.email, role: "student", access: { active: false, source: "checkout_started", expiresAt: Timestamp.fromMillis(Date.now() + 1e12) } }));
  });
  test("admin-revoked student can restart checkout (access stays inactive)", async () => {
    const REVOKED = { uid: "stu_revoked", email: "revoked@example.com" };
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", REVOKED.uid), { uid: REVOKED.uid, email: REVOKED.email, role: "student", plan: "course",
        access: { active: false, source: "razorpay_webhook", plan: "course", grantedAt: Timestamp.now() }, createdAt: Timestamp.now() });
    });
    const db = as(REVOKED);
    const existing = (await getDoc(doc(db, "users", REVOKED.uid))).data();
    await assertSucceeds(checkoutProfileWrite(db, REVOKED, existing));
    await assertFails(updateDoc(doc(db, "users", REVOKED.uid), { "access.active": true }));
  });
  test("active student cannot downgrade-reset then regain (reset to inactive blocked while live)", async () => {
    await assertFails(setDoc(doc(as(ACTIVE), "users", ACTIVE.uid), { access: { active: false, source: "checkout_started" } }, { merge: true }));
  });
  test("student cannot delete own profile", async () => {
    await assertFails(deleteDoc(doc(as(INACTIVE), "users", INACTIVE.uid)));
  });
  test("student can read own profile", async () => {
    await assertSucceeds(getDoc(doc(as(INACTIVE), "users", INACTIVE.uid)));
  });
  test("student cannot read another user's profile", async () => {
    await assertFails(getDoc(doc(as(INACTIVE), "users", ACTIVE.uid)));
  });
  test("student cannot list users", async () => {
    await assertFails(getDocs(collection(as(ACTIVE), "users")));
  });
  test("anonymous cannot read users", async () => {
    await assertFails(getDoc(doc(anon(), "users", ACTIVE.uid)));
  });
  test("students cannot read or write orders/payments", async () => {
    const db = as(ACTIVE);
    await assertFails(getDoc(doc(db, "orders", "o1")));
    await assertFails(getDoc(doc(db, "payments", "p1")));
    await assertFails(getDocs(collection(db, "orders")));
    await assertFails(setDoc(doc(db, "orders", "o2"), { uid: ACTIVE.uid }));
    await assertFails(setDoc(doc(db, "payments", "p2"), { uid: ACTIVE.uid, status: "paid" }));
  });
  test("anonymous cannot read orders/payments", async () => {
    await assertFails(getDocs(collection(anon(), "payments")));
  });
});

describe("single-device sessions", () => {
  test("user can register and clear own session", async () => {
    const db = as(ACTIVE);
    await assertSucceeds(setDoc(doc(db, "sessions", ACTIVE.uid), { uid: ACTIVE.uid, sessionId: "abc", email: ACTIVE.email, userAgent: "UA", updatedAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(getDoc(doc(db, "sessions", ACTIVE.uid)));
    await assertSucceeds(updateDoc(doc(db, "sessions", ACTIVE.uid), { signedOutAt: serverTimestamp() }));
  });
  test("user cannot overwrite another user's session", async () => {
    await assertFails(setDoc(doc(as(INACTIVE), "sessions", ACTIVE.uid), { uid: ACTIVE.uid, sessionId: "kick" }));
  });
});

describe("student portal", () => {
  test("active student can list lessons in order", async () => {
    await assertSucceeds(getDocs(query(collection(as(ACTIVE), "lessons"), orderBy("order", "asc"))));
  });
  test("inactive, expired and anonymous users cannot read lessons", async () => {
    await assertFails(getDocs(collection(as(INACTIVE), "lessons")));
    await assertFails(getDocs(collection(as(EXPIRED), "lessons")));
    await assertFails(getDocs(collection(anon(), "lessons")));
  });
  test("student cannot write lessons", async () => {
    await assertFails(setDoc(doc(as(ACTIVE), "lessons", "l2"), { title: "x" }));
  });
  test("active student can save own progress", async () => {
    const db = as(ACTIVE);
    await assertSucceeds(setDoc(doc(db, "users", ACTIVE.uid, "progress", "l1"), { lessonId: "l1", completed: true, completedAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(getDocs(collection(db, "users", ACTIVE.uid, "progress")));
  });
  test("student cannot write another student's progress", async () => {
    await assertFails(setDoc(doc(as(ACTIVE), "users", INACTIVE.uid, "progress", "l1"), { lessonId: "l1", completed: true }));
  });
  test("active student can post a doubt and query own doubts", async () => {
    const db = as(ACTIVE);
    await assertSucceeds(addDoc(collection(db, "doubts"), { uid: ACTIVE.uid, studentEmail: ACTIVE.email, studentName: "A", lessonId: "l1", lessonTitle: "Lesson 1", text: "Why?", createdAt: serverTimestamp() }));
    await assertSucceeds(getDocs(query(collection(db, "doubts"), where("uid", "==", ACTIVE.uid), where("lessonId", "==", "l1"))));
  });
  test("student cannot post a doubt as someone else, or read others' doubts", async () => {
    const db = as(ACTIVE);
    await assertFails(addDoc(collection(db, "doubts"), { uid: "someone_else", studentEmail: "x", studentName: "x", lessonId: "l1", lessonTitle: "", text: "x", createdAt: serverTimestamp() }));
    await assertFails(getDoc(doc(db, "doubts", "d2")));
    await assertFails(getDocs(collection(db, "doubts")));
  });
  test("student cannot write a mentor reply", async () => {
    await assertFails(updateDoc(doc(as(ACTIVE), "doubts", "d1"), { reply: "fake mentor reply" }));
  });
  test("inactive student cannot post doubts", async () => {
    await assertFails(addDoc(collection(as(INACTIVE), "doubts"), { uid: INACTIVE.uid, studentEmail: "", studentName: "", lessonId: "l1", lessonTitle: "", text: "x", createdAt: serverTimestamp() }));
  });
  test("doubts are size-limited and server-timestamped", async () => {
    const db = as(ACTIVE);
    const d = { uid: ACTIVE.uid, studentEmail: ACTIVE.email, studentName: "A", lessonId: "l1", lessonTitle: "L", createdAt: serverTimestamp() };
    await assertFails(addDoc(collection(db, "doubts"), { ...d, text: "x".repeat(2001) }));
    await assertFails(addDoc(collection(db, "doubts"), { ...d, text: "ok", createdAt: Timestamp.fromMillis(0) }));
  });
});

describe("public site", () => {
  test("anyone can read site/public and testimonials", async () => {
    await assertSucceeds(getDoc(doc(anon(), "site", "public")));
    await assertSucceeds(getDocs(collection(anon(), "testimonials")));
  });
  test("anyone cannot read other site docs or write site/testimonials", async () => {
    await assertFails(getDoc(doc(anon(), "site", "private")));
    await assertFails(setDoc(doc(as(ACTIVE), "site", "public"), { introVideoUrl: "https://evil" }));
    await assertFails(addDoc(collection(as(ACTIVE), "testimonials"), { name: "fake", text: "fake" }));
  });
});

describe("admin panel", () => {
  test("admin can do everything the panel does", async () => {
    const db = as(ADMIN);
    await assertSucceeds(getDocs(query(collection(db, "lessons"), orderBy("order", "asc"))));
    await assertSucceeds(addDoc(collection(db, "lessons"), { title: "New", module: "M", order: 2, active: true, createdAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db, "lessons", "l1"), { title: "Edited" }));
    await assertSucceeds(deleteDoc(doc(db, "lessons", "l1")));
    await assertSucceeds(getDocs(query(collection(db, "users"), where("role", "==", "student"))));
    await assertSucceeds(updateDoc(doc(db, "users", INACTIVE.uid), { "access.active": true, updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db, "users", "manual1"), { uid: "manual1", name: "M", email: "m@example.com", role: "student", plan: "course", access: { active: true, source: "admin_manual", grantedAt: serverTimestamp() }, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(addDoc(collection(db, "testimonials"), { name: "T", text: "t", active: true, createdAt: serverTimestamp() }));
    await assertSucceeds(getDocs(query(collection(db, "testimonials"), orderBy("createdAt", "desc"))));
    await assertSucceeds(getDocs(query(collection(db, "doubts"), orderBy("createdAt", "desc"))));
    await assertSucceeds(updateDoc(doc(db, "doubts", "d1"), { reply: "Answer", repliedAt: serverTimestamp(), repliedBy: ADMIN.email }));
    await assertSucceeds(setDoc(doc(db, "site", "public"), { youtubeUrl: "", updatedAt: serverTimestamp() }, { merge: true }));
    // exportData()
    await assertSucceeds(getDocs(collection(db, "users")));
    await assertSucceeds(getDocs(collection(db, "orders")));
    await assertSucceeds(getDocs(collection(db, "payments")));
    await assertSucceeds(getDocs(collection(db, "auditLeads")));
  });
  test("admin login check can read own profile", async () => {
    await assertSucceeds(getDoc(doc(as(ADMIN), "users", ADMIN.uid)));
  });
});

describe("auditLeads", () => {
  test("anonymous visitor can create a valid lead", async () => {
    await assertSucceeds(addDoc(collection(anon(), "auditLeads"), lead()));
    await assertSucceeds(addDoc(collection(anon(), "auditLeads"), lead({ source: "audit", isRetake: true })));
  });
  test("invalid leads are rejected", async () => {
    const db = anon();
    const { rule, ...noRule } = lead();
    for (const bad of [
      noRule,
      lead({ extra: "x" }),
      lead({ email: "not-an-email" }),
      lead({ email: "UPPER@Example.com" }),
      lead({ email: "a".repeat(250) + "@x.com" }),
      lead({ type: "Hacker" }),
      lead({ pct: { R: 50.5, P: 20, C: 20, I: 10 } }),
      lead({ pct: { R: 50, P: 20, C: 20 } }),
      lead({ pct: { R: 500, P: 20, C: 20, I: 10 } }),
      lead({ body: "toe" }),
      lead({ nerve: "panic" }),
      lead({ stage: "rich" }),
      lead({ rule: "x".repeat(401) }),
      lead({ isRetake: "yes" }),
      lead({ source: "spam" }),
      lead({ createdAt: Timestamp.fromMillis(0) })
    ]) {
      await assertFails(addDoc(collection(db, "auditLeads"), bad));
    }
  });
  test("visitors and students cannot read, update or delete leads", async () => {
    let id;
    await env.withSecurityRulesDisabled(async (ctx) => { id = (await addDoc(collection(ctx.firestore(), "auditLeads"), { email: "x@example.com" })).id; });
    await assertFails(getDoc(doc(anon(), "auditLeads", id)));
    await assertFails(getDocs(collection(as(ACTIVE), "auditLeads")));
    await assertFails(updateDoc(doc(anon(), "auditLeads", id), { email: "y@example.com" }));
    await assertFails(deleteDoc(doc(anon(), "auditLeads", id)));
  });
});
