import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBfZqEU-fJrOm0L9A5sFnexs9VUvbgHnQs",
  authDomain: "resettraders-ead44.firebaseapp.com",
  projectId: "resettraders-ead44",
  storageBucket: "resettraders-ead44.firebasestorage.app",
  messagingSenderId: "981078061043",
  appId: "1:981078061043:web:2dcd1109456477a93d126c",
  measurementId: "G-BX4GEP4CWZ"
};

export const RESET_CONFIG = {
  siteUrl: "https://resettraders.com/",
  currency: "INR",
  razorpayKeyId: "rzp_test_T3yQr3ui4cuBmi",
  createOrderEndpoint: "https://shiny-dew-032freset-traders-payments.resettradersofficial.workers.dev/create-order",
  verifyPaymentEndpoint: "https://shiny-dew-032freset-traders-payments.resettradersofficial.workers.dev/verify-payment",
  paymentStatusEndpoint: "https://shiny-dew-032freset-traders-payments.resettradersofficial.workers.dev/payment-status"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

await setPersistence(auth, browserLocalPersistence);

export {
  addDoc,
  collection,
  createUserWithEmailAndPassword,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDownloadURL,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  storageRef,
  onAuthStateChanged,
  updateDoc,
  where
};

export const paths = {
  lessons: "lessons",
  testimonials: "testimonials",
  users: "users",
  sessions: "sessions",
  site: "site",
  doubts: "doubts",
  orders: "orders",
  payments: "payments"
};

export function cleanEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

export function isAdminProfile(profile) {
  return profile && profile.role === "admin";
}

export function hasActiveAccess(profile) {
  if (!profile) return false;
  if (isAdminProfile(profile)) return true;
  const access = profile.access || {};
  if (access.active !== true) return false;
  if (!access.expiresAt) return true;
  const expiryMs = typeof access.expiresAt.toMillis === "function"
    ? access.expiresAt.toMillis()
    : Date.parse(access.expiresAt);
  return Number.isFinite(expiryMs) ? expiryMs > Date.now() : true;
}

export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, paths.users, uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createInactiveStudentProfile(user, name = "") {
  const profileRef = doc(db, paths.users, user.uid);
  const existing = await getDoc(profileRef);
  const current = existing.exists() ? existing.data() : null;
  const base = {
    uid: user.uid,
    email: cleanEmail(user.email),
    name: name || user.displayName || "",
    role: current?.role === "admin" ? "admin" : "student",
    updatedAt: serverTimestamp()
  };
  if ((!current || current.access?.active !== true) && current?.role !== "admin") {
    base.access = {
      active: false,
      source: "checkout_started"
    };
  }
  await setDoc(profileRef, existing.exists()
    ? { ...base, createdAt: existing.data().createdAt || serverTimestamp() }
    : { ...base, createdAt: serverTimestamp() },
    { merge: true });
}

export async function ensureBuyerAccount({ name, email, password }) {
  const normalizedEmail = cleanEmail(email);
  if (!normalizedEmail || !password) {
    throw new Error("Email and password are required.");
  }

  if (auth.currentUser && cleanEmail(auth.currentUser.email) !== normalizedEmail) {
    await signOut(auth);
  }

  let credential;
  if (auth.currentUser && cleanEmail(auth.currentUser.email) === normalizedEmail) {
    credential = { user: auth.currentUser };
  } else {
    try {
      credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    } catch (error) {
      if (error && error.code === "auth/email-already-in-use") {
        try {
          credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
        } catch (signInError) {
          if (
            signInError?.code === "auth/invalid-credential"
            || signInError?.code === "auth/wrong-password"
            || signInError?.code === "auth/user-not-found"
          ) {
            const friendlyError = new Error(
              "This email already has a portal account. Use the same password you used earlier, or contact support to reset the old incomplete account before checkout."
            );
            friendlyError.code = "auth/existing-account-password-mismatch";
            throw friendlyError;
          }
          throw signInError;
        }
      } else {
        throw error;
      }
    }
  }

  if (name && credential.user.displayName !== name) {
    await updateProfile(credential.user, { displayName: name });
  }
  await createInactiveStudentProfile(credential.user, name);
  return credential.user;
}

export function getOrCreateSessionId() {
  const key = "rt_active_session_id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

export async function registerActiveSession(user) {
  const sessionId = getOrCreateSessionId();
  await setDoc(doc(db, paths.sessions, user.uid), {
    uid: user.uid,
    sessionId,
    email: cleanEmail(user.email),
    userAgent: navigator.userAgent.slice(0, 240),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return sessionId;
}

export function watchSingleSession(user, onInvalidated) {
  const localSessionId = getOrCreateSessionId();
  return onSnapshot(doc(db, paths.sessions, user.uid), (snap) => {
    if (!snap.exists()) return;
    const remoteSessionId = snap.data().sessionId;
    if (remoteSessionId && remoteSessionId !== localSessionId) {
      onInvalidated();
    }
  });
}

export async function clearActiveSession(user) {
  if (!user) return;
  try {
    await updateDoc(doc(db, paths.sessions, user.uid), {
      signedOutAt: serverTimestamp()
    });
  } catch (_) {
    // Session cleanup is best effort; auth sign-out is the important action.
  }
}

export async function sendCurrentUserPasswordReset() {
  const email = auth.currentUser && auth.currentUser.email;
  if (!email) throw new Error("No signed-in Firebase Auth user.");
  await sendPasswordResetEmail(auth, email);
}

export async function createStudentAuthAccount({ name, email, password, plan }) {
  const secondary = initializeApp(firebaseConfig, `student-create-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail(email), password);
    await updateProfile(credential.user, { displayName: name });
    await signOut(secondaryAuth);
    await setDoc(doc(db, paths.users, credential.user.uid), {
      uid: credential.user.uid,
      name,
      email: cleanEmail(email),
      role: "student",
      plan,
      access: {
        active: true,
        source: "admin_manual",
        grantedAt: serverTimestamp()
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    await sendPasswordResetEmail(auth, cleanEmail(email));
    return credential.user.uid;
  } finally {
    await deleteApp(secondary);
  }
}
