// Your Personal Reset access rules, tested before and after the opening moment.
// "After" uses the same rules with the opening time moved to 1970, in a second emulator project.
// Run from repo root:
//   npx firebase-tools emulators:exec --only firestore --project demo-resettraders "npm --prefix tests/rules test"
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";

const RULES = readFileSync(new URL(process.env.RULES_FILE || "../../firestore.rules", import.meta.url), "utf8");
assert.ok(RULES.includes("timestamp.value(1798741800000)"), "opening moment is 1 January 2027 00:00 IST");
const OPENED = RULES.replace("timestamp.value(1798741800000)", "timestamp.value(0)");

const ADMIN = { uid: "admin1", email: "resettradersofficial@gmail.com" };
const BUYER = { uid: "buyer1", email: "buyer@example.com" };
const STANDARD = { uid: "buyer2", email: "buyer2@example.com" };
const TESTSEAT = { uid: "tester", email: "tester@example.com" };
const OLDSTUDENT = { uid: "old1", email: "old@example.com" };
const NOBODY = { uid: "nobody", email: "nobody@example.com" };

async function seed(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", ADMIN.uid), { uid: ADMIN.uid, email: ADMIN.email, role: "admin" });
    await setDoc(doc(db, "users", BUYER.uid), { uid: BUYER.uid, email: BUYER.email, role: "student", access: { active: false, source: "checkout_started" }, reset: { status: "founding", opensAt: "2027-01-01" } });
    await setDoc(doc(db, "users", STANDARD.uid), { uid: STANDARD.uid, email: STANDARD.email, role: "student", access: { active: false, source: "checkout_started" }, reset: { status: "standard" } });
    await setDoc(doc(db, "users", TESTSEAT.uid), { uid: TESTSEAT.uid, email: TESTSEAT.email, role: "student", reset: { status: "test" } });
    await setDoc(doc(db, "users", OLDSTUDENT.uid), { uid: OLDSTUDENT.uid, email: OLDSTUDENT.email, role: "student", access: { active: true, source: "razorpay_webhook", grantedAt: Timestamp.now() } });
    await setDoc(doc(db, "users", NOBODY.uid), { uid: NOBODY.uid, email: NOBODY.email, role: "student", access: { active: false, source: "checkout_started" } });
    await setDoc(doc(db, "resetLessons", "c0-1"), { title: "Lesson", order: 1, module: "m0" });
    await setDoc(doc(db, "resetModules", "m0"), { title: "Orientation", order: 1 });
  });
}
const proof = (id = "c0-1-1") => ({ proofId: id, lessonId: "c0-1", doneAt: serverTimestamp() });

let closed, opened;
before(async () => {
  closed = await initializeTestEnvironment({ projectId: "demo-reset-closed", firestore: { rules: RULES, host: "127.0.0.1", port: 8085 } });
  opened = await initializeTestEnvironment({ projectId: "demo-reset-opened", firestore: { rules: OPENED, host: "127.0.0.1", port: 8085 } });
  await seed(closed); await seed(opened);
});
after(async () => { await closed?.cleanup(); await opened?.cleanup(); });
const as = (env, u) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

describe("before 1 January 2027", () => {
  test("a founding buyer cannot read lessons yet", async () => {
    await assertFails(getDoc(doc(as(closed, BUYER), "resetLessons", "c0-1")));
    await assertFails(getDocs(collection(as(closed, BUYER), "resetModules")));
  });
  test("a buyer cannot tick proofs yet", async () => {
    await assertFails(setDoc(doc(as(closed, BUYER), "users", BUYER.uid, "resetProofs", "c0-1-1"), proof()));
  });
  test("admins can preview everything", async () => {
    await assertSucceeds(getDocs(collection(as(closed, ADMIN), "resetLessons")));
    await assertSucceeds(setDoc(doc(as(closed, ADMIN), "resetLessons", "new"), { title: "x", order: 2 }));
    await assertSucceeds(setDoc(doc(as(closed, ADMIN), "users", ADMIN.uid, "resetProofs", "c0-1-1"), proof()));
  });
});

describe("after opening", () => {
  test("founding and standard buyers can read lessons and modules", async () => {
    await assertSucceeds(getDoc(doc(as(opened, BUYER), "resetLessons", "c0-1")));
    await assertSucceeds(getDocs(collection(as(opened, STANDARD), "resetModules")));
  });
  test("test seats, old technical students and strangers cannot", async () => {
    for (const u of [TESTSEAT, OLDSTUDENT, NOBODY]) await assertFails(getDoc(doc(as(opened, u), "resetLessons", "c0-1")));
    await assertFails(getDoc(doc(opened.unauthenticatedContext().firestore(), "resetLessons", "c0-1")));
  });
  test("buyers cannot write lessons", async () => {
    await assertFails(setDoc(doc(as(opened, BUYER), "resetLessons", "c0-1"), { title: "hacked" }));
  });
  test("a buyer ticks, reads and unticks their own proof", async () => {
    const db = as(opened, BUYER);
    await assertSucceeds(setDoc(doc(db, "users", BUYER.uid, "resetProofs", "c0-1-1"), proof()));
    await assertSucceeds(getDocs(collection(db, "users", BUYER.uid, "resetProofs")));
    await assertSucceeds(deleteDoc(doc(db, "users", BUYER.uid, "resetProofs", "c0-1-1")));
  });
  test("proof docs must be exactly shaped", async () => {
    const db = as(opened, BUYER);
    await assertFails(setDoc(doc(db, "users", BUYER.uid, "resetProofs", "c0-1-2"), { ...proof("c0-1-2"), extra: 1 }));
    await assertFails(setDoc(doc(db, "users", BUYER.uid, "resetProofs", "c0-1-3"), proof("other-id")));
    await assertFails(setDoc(doc(db, "users", BUYER.uid, "resetProofs", "c0-1-4"), { proofId: "c0-1-4", lessonId: "c0-1", doneAt: Timestamp.fromMillis(0) }));
  });
  test("nobody touches someone else's proofs", async () => {
    await assertFails(setDoc(doc(as(opened, STANDARD), "users", BUYER.uid, "resetProofs", "c0-1-1"), proof()));
    await assertFails(getDocs(collection(as(opened, STANDARD), "users", BUYER.uid, "resetProofs")));
  });
  test("hijack preference: only the four hijacks, only the prefs doc", async () => {
    const db = as(opened, BUYER);
    await assertSucceeds(setDoc(doc(db, "users", BUYER.uid, "resetState", "prefs"), { hijack: "Rusher", updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "users", BUYER.uid, "resetState", "prefs"), { hijack: "Gambler", updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "users", BUYER.uid, "resetState", "other"), { hijack: "Rusher", updatedAt: serverTimestamp() }));
  });
  test("a buyer still cannot give themselves a seat or technical access", async () => {
    await assertFails(setDoc(doc(as(opened, NOBODY), "users", NOBODY.uid), { reset: { status: "founding" } }, { merge: true }));
    await assertFails(setDoc(doc(as(opened, BUYER), "users", BUYER.uid), { access: { active: true, source: "checkout_started" } }, { merge: true }));
  });
});
