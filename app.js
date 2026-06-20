import {
  auth,
  clearActiveSession,
  db,
  doc,
  getDoc,
  getUserProfile,
  hasActiveAccess,
  isAdminProfile,
  onSnapshot,
  onAuthStateChanged,
  paths,
  registerActiveSession,
  safeText,
  signInWithEmailAndPassword,
  signOut,
  watchSingleSession
} from "./firebase.js?v=20260621-domain-worker-fix";
import { proceedToRazorpay, startPayment } from "./payment.js?v=20260621-domain-worker-fix";
import {
  loadPortal,
  nextLesson,
  prevLesson,
  submitDoubt,
  toggleMobDrawer,
  unloadPortal
} from "./portal.js?v=20260621-domain-worker-fix";
import {
  addLesson,
  addStudent,
  addTestimonial,
  adminTab,
  changeAdminPass,
  deleteLesson,
  deleteTestimonial,
  editLesson,
  exportData,
  handleTestiFile,
  loadAdmin,
  previewAdminVideo,
  previewFounderPhoto,
  renderPublicTestimonials,
  saveReply,
  saveSocial,
  toggleStudent,
  toggleTestiMedia,
  unloadAdmin
} from "./admin.js?v=20260621-domain-worker-fix";

let loginMode = "student";
let sessionUnsubscribe = null;
let currentProfile = null;
let publicSettings = {};
let publicSettingsLoaded = false;
let publicSettingsUnsubscribe = null;

function $(id) {
  return document.getElementById(id);
}

function setLoginError(message) {
  const err = $("login-err");
  if (!err) return;
  err.textContent = message || "Invalid credentials. Please try again.";
  err.style.display = message ? "block" : "none";
}

function stopAllPageMedia() {
  document.querySelectorAll("video, audio").forEach((media) => {
    try {
      media.pause();
      media.currentTime = 0;
      media.removeAttribute("src");
      media.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
      media.load();
    } catch (_) {}
  });

  document.querySelectorAll("#course-portal iframe, #admin-panel iframe").forEach((frame) => {
    frame.src = "about:blank";
  });
}

export function showPage(page) {
  if (page !== "portal") {
    stopAllPageMedia();
    unloadPortal();
  }
  $("main-site")?.classList.toggle("active", page === "main");
  $("course-portal")?.classList.toggle("active", page === "portal");
  $("admin-panel")?.classList.toggle("active", page === "admin");
  if (page === "main") {
    document.body.style.overflow = "";
  }
}

export function openLogin(mode = "student") {
  loginMode = mode;
  $("login-sub").textContent = mode === "admin"
    ? "Admin Panel - Sign in with Firebase Auth"
    : "Student Portal - Sign in with Firebase Auth";
  $("login-email").value = auth.currentUser?.email || "";
  $("login-pass").value = "";
  setLoginError("");
  $("login-overlay").classList.add("active");
  setTimeout(() => $("login-email")?.focus(), 50);
}

export function closeLogin() {
  $("login-overlay").classList.remove("active");
}

export async function doLogin() {
  const email = $("login-email").value.trim().toLowerCase();
  const password = $("login-pass").value;
  try {
    setLoginError("");
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getUserProfile(credential.user.uid);
    if (loginMode === "admin" && !isAdminProfile(profile)) {
      await signOut(auth);
      setLoginError("This Firebase account is not an admin.");
      return;
    }
    if (loginMode === "student" && !hasActiveAccess(profile)) {
      await signOut(auth);
      setLoginError("Course access is not active yet. Access unlocks only after verified payment.");
      return;
    }
    await activateSession(credential.user, profile);
    closeLogin();
    if (loginMode === "admin") {
      showPage("admin");
      loadAdmin(credential.user, profile);
    } else {
      showPage("portal");
      loadPortal(credential.user, profile);
    }
  } catch (error) {
    setLoginError(authErrorMessage(error));
  }
}

function authErrorMessage(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid Firebase Auth credentials.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait and try again.";
    default:
      return error?.message || "Login failed. Please try again.";
  }
}

async function activateSession(user, profile) {
  currentProfile = profile;
  if (sessionUnsubscribe) sessionUnsubscribe();
  await registerActiveSession(user);
  sessionUnsubscribe = watchSingleSession(user, async () => {
    if (sessionUnsubscribe) sessionUnsubscribe();
    sessionUnsubscribe = null;
    unloadPortal();
    unloadAdmin();
    await signOut(auth);
    showPage("main");
    alert("You were signed out because this account was opened in another browser or device.");
  });
}

export async function logout() {
  const user = auth.currentUser;
  stopAllPageMedia();
  if (sessionUnsubscribe) sessionUnsubscribe();
  sessionUnsubscribe = null;
  unloadPortal();
  unloadAdmin();
  await clearActiveSession(user);
  await signOut(auth);
  showPage("main");
}

export function openModal(name) {
  $(`modal-${name}`)?.classList.add("active");
}

export function closeModal(name) {
  $(`modal-${name}`)?.classList.remove("active");
}

export function togglePassVis(inputId, buttonId) {
  const input = $(inputId);
  const button = $(buttonId);
  if (!input) return;
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  if (button) button.textContent = visible ? "👁" : "🙈";
}

export function toggleFaq(element) {
  const item = element.closest(".faq-item");
  item?.classList.toggle("open");
}

export function toggleMobileNav() {
  const overlay = $("mobile-nav-overlay");
  const button = $("hamburger-btn");
  const isOpen = overlay?.classList.toggle("open");
  button?.classList.toggle("open", Boolean(isOpen));
  document.body.style.overflow = isOpen ? "hidden" : "";
}

export function closeMobileNav() {
  $("mobile-nav-overlay")?.classList.remove("open");
  $("hamburger-btn")?.classList.remove("open");
  document.body.style.overflow = "";
}

export async function playHeroVideo() {
  const thumb = $("hero-thumb");
  const player = $("hero-yt-player");
  if (!thumb || !player) return;
  if (!publicSettingsLoaded) {
    await loadPublicSettingsOnce();
  }
  const videoUrl = publicSettings.introVideoUrl || "";
  thumb.style.display = "none";
  player.style.display = "block";

  if (isYouTubeUrl(videoUrl)) {
    player.innerHTML = `
      <iframe id="hero-iframe" src="${safeText(toYouTubeEmbedUrl(videoUrl))}"
        allow="autoplay; encrypted-media" allowfullscreen
        style="width:100%;height:100%;border:none;border-radius:8px;"></iframe>`;
    return;
  }

  if (videoUrl) {
    player.innerHTML = `
      <video controls autoplay playsinline controlsList="nodownload"
        oncontextmenu="return false"
        style="width:100%;height:100%;border:none;border-radius:8px;background:#000;object-fit:contain;">
        <source src="${safeText(videoUrl)}" type="video/mp4">
      </video>`;
    return;
  }

  player.innerHTML = `
    <div class="video-placeholder">
      <div class="vs">Intro video not set</div>
      <div class="vp">Add a GitHub Release video URL in Admin - Site Settings.</div>
    </div>`;
}

function isYouTubeUrl(url) {
  return /youtu\.?be|youtube-nocookie\.com/.test(String(url || ""));
}

function toYouTubeEmbedUrl(url) {
  const match = String(url).match(/(?:embed\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  const id = match ? match[1] : "";
  return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` : "";
}

async function loadPublicSettingsOnce() {
  try {
    const snapshot = await getDoc(doc(db, paths.site, "public"));
    publicSettings = snapshot.exists() ? snapshot.data() : {};
    publicSettingsLoaded = true;
  } catch (_) {
    publicSettings = {};
    publicSettingsLoaded = true;
  }
}

function watchPublicSettings() {
  if (publicSettingsUnsubscribe) publicSettingsUnsubscribe();
  publicSettingsUnsubscribe = onSnapshot(doc(db, paths.site, "public"), (snapshot) => {
    publicSettings = snapshot.exists() ? snapshot.data() : {};
    publicSettingsLoaded = true;
  }, () => {
    publicSettings = {};
    publicSettingsLoaded = true;
  });
}

export function toggleChat() {
  $("chat-widget")?.classList.toggle("open");
}

export function sendQuick(text) {
  const input = $("chat-input");
  if (!input) return;
  input.value = text;
  sendChatMessage();
}

export function sendChatMessage() {
  const input = $("chat-input");
  const body = $("chat-body");
  const text = input?.value.trim();
  if (!input || !body || !text) return;
  appendChat("user", text);
  input.value = "";
  appendChat("bot", answerChat(text));
  body.scrollTop = body.scrollHeight;
}

function appendChat(type, text) {
  const body = $("chat-body");
  const row = document.createElement("div");
  row.className = `chat-msg ${type}`;
  row.textContent = text;
  body.appendChild(row);
}

function answerChat(text) {
  const lower = text.toLowerCase();
  if (lower.includes("price") || lower.includes("pricing")) {
    return "The Trader Reset is ₹16,999 and Elite Mentorship is ₹50,000. Payments are verified before portal access unlocks.";
  }
  if (lower.includes("join") || lower.includes("enroll") || lower.includes("buy")) {
    return "Choose a plan, create your Firebase portal password, complete Razorpay checkout, and access unlocks after secure payment verification.";
  }
  if (lower.includes("market")) {
    return "Reset Traders covers Forex, metals, crypto, futures, US indices, and Indian markets through price-action frameworks.";
  }
  if (lower.includes("mentor")) {
    return "Omkar Pardeshi leads the Reset Traders program and mentorship experience.";
  }
  return "For a specific question, message Reset Traders on Instagram or Telegram. We usually reply quickly.";
}

function initRevealAnimations() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("active"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("active");
    });
  }, { threshold: 0.12 });
  items.forEach((item) => observer.observe(item));
}

function initKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMobileNav();
      document.querySelectorAll(".rt-modal-overlay.active").forEach((modal) => modal.classList.remove("active"));
      closeLogin();
    }
    if (event.key === "Enter" && document.activeElement?.id === "login-pass") {
      doLogin();
    }
  });
  $("chat-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentProfile = null;
    return;
  }
  currentProfile = await getUserProfile(user.uid);
});

document.addEventListener("DOMContentLoaded", () => {
  initRevealAnimations();
  initKeyboard();
  watchPublicSettings();
  renderPublicTestimonials();
});

Object.assign(window, {
  addLesson,
  addStudent,
  addTestimonial,
  adminTab,
  changeAdminPass,
  closeLogin,
  closeMobileNav,
  closeModal,
  deleteLesson,
  deleteTestimonial,
  doLogin,
  editLesson,
  exportData,
  handleTestiFile,
  logout,
  nextLesson,
  openLogin,
  openModal,
  playHeroVideo,
  previewAdminVideo,
  previewFounderPhoto,
  prevLesson,
  proceedToRazorpay,
  saveReply,
  saveSocial,
  sendChatMessage,
  sendQuick,
  showPage,
  startPayment,
  submitDoubt,
  toggleChat,
  toggleFaq,
  toggleMobDrawer,
  toggleMobileNav,
  togglePassVis,
  toggleStudent,
  toggleTestiMedia
});
