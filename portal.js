import {
  addDoc,
  auth,
  collection,
  db,
  doc,
  getDoc,
  getDownloadURL,
  getDocs,
  hasActiveAccess,
  onSnapshot,
  orderBy,
  paths,
  query,
  safeText,
  serverTimestamp,
  setDoc,
  storage,
  storageRef,
  where
} from "./firebase.js?v=20260622-icons-chat-fix";

let currentUser = null;
let currentProfile = null;
let lessons = [];
let currentLessonIndex = 0;
let unsubscribeLessons = null;
let unsubscribeDoubts = null;

function $(id) {
  return document.getElementById(id);
}

const EMPTY_LESSON = {
  id: "welcome",
  title: "Welcome to Reset Traders",
  module: "Start Here",
  duration: "8 min",
  notes: "Your course lessons will appear here after the admin publishes them.",
  videoUrl: ""
};

export function unloadPortal() {
  stopPortalMedia();
  if (unsubscribeLessons) unsubscribeLessons();
  if (unsubscribeDoubts) unsubscribeDoubts();
  unsubscribeLessons = null;
  unsubscribeDoubts = null;
  lessons = [];
  currentUser = null;
  currentProfile = null;
}

function stopPortalMedia() {
  const portal = $("course-portal");
  if (!portal) return;
  portal.querySelectorAll("video, audio").forEach((media) => {
    try {
      media.pause();
      media.currentTime = 0;
      media.removeAttribute("src");
      media.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
      media.load();
    } catch (_) {}
  });
  portal.querySelectorAll("iframe").forEach((frame) => {
    frame.src = "about:blank";
  });
  const wrap = $("video-wrap");
  if (wrap) {
    wrap.innerHTML = `
      <div class="video-placeholder">
        <div class="vs">Portal closed</div>
        <div class="vp">Log in again to continue watching.</div>
      </div>`;
  }
}

export function loadPortal(user, profile) {
  unloadPortal();
  currentUser = user;
  currentProfile = profile;

  $("portal-username").textContent = profile?.name || user.displayName || user.email;
  if (!hasActiveAccess(profile)) {
    renderLockedPortal();
    return;
  }

  const lessonQuery = query(collection(db, paths.lessons), orderBy("order", "asc"));
  unsubscribeLessons = onSnapshot(lessonQuery, (snapshot) => {
    lessons = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((lesson) => lesson.active !== false);
    if (!lessons.length) lessons = [EMPTY_LESSON];
    currentLessonIndex = Math.min(currentLessonIndex, lessons.length - 1);
    renderLessonLists();
    selectLessonByIndex(currentLessonIndex);
  }, (error) => {
    renderPortalError(error.message);
  });
}

function renderLockedPortal() {
  $("lesson-list").innerHTML = "";
  $("mob-lesson-list").innerHTML = "";
  $("portal-main").innerHTML = `
    <div class="locked-state">
      <strong style="color:var(--orange);">Access pending.</strong><br>
      Your Firebase account exists, but course access is not active yet. Access is granted only after Razorpay webhook verification.
    </div>`;
}

function renderPortalError(message) {
  $("portal-main").innerHTML = `
    <div class="locked-state">
      <strong style="color:var(--red);">Portal could not load.</strong><br>
      ${safeText(message)}
    </div>`;
}

function renderLessonLists() {
  const total = lessons.length;
  const done = 0;
  $("progress-done").textContent = String(done);
  $("progress-total").textContent = String(total);
  $("progress-pct-label").textContent = total ? "Select a lesson to begin" : "No lessons published yet";
  $("progress-fill").style.width = "0%";

  const listHtml = lessons.map((lesson, index) => `
    <div class="lesson-item ${index === currentLessonIndex ? "active" : ""}" onclick="window.__rtSelectLesson(${index})">
      <div class="lesson-num">${String(index + 1).padStart(2, "0")}</div>
      <div>
        <div class="lesson-name">${safeText(lesson.title)}</div>
        <div class="lesson-dur">${safeText(lesson.module || "Course")} · ${safeText(lesson.duration || "")}</div>
      </div>
    </div>`).join("");

  $("lesson-list").innerHTML = listHtml;
  $("mob-lesson-list").innerHTML = listHtml;
  $("mob-bar-info").textContent = `${total} lessons available`;
}

async function selectLessonByIndex(index) {
  currentLessonIndex = Math.max(0, Math.min(index, lessons.length - 1));
  const lesson = lessons[currentLessonIndex] || EMPTY_LESSON;

  $("lesson-title").textContent = lesson.title || "Untitled Lesson";
  $("lesson-desc").textContent = lesson.module || "Reset Traders Course";
  $("meta-duration").textContent = lesson.duration || "Lesson";
  $("meta-module").textContent = lesson.module || "Course";
  $("lesson-meta").style.display = "flex";
  $("lesson-notes").style.display = "block";
  $("lesson-nav").style.display = "flex";
  $("notes-text").textContent = lesson.notes || "No notes for this lesson.";

  await renderVideo(lesson);
  renderLessonLists();
  renderDoubts(lesson.id);
}

async function renderVideo(lesson) {
  const wrap = $("video-wrap");
  const watermark = safeText(currentUser?.email || "RESET TRADERS");
  const source = lesson.storagePath || lesson.videoRef || lesson.videoUrl || "";

  if (!source) {
    wrap.innerHTML = `
      <div class="video-placeholder">
        <div class="vs">Lesson video will appear here</div>
        <div class="vp">The admin has not published a secure video source for this lesson yet.</div>
      </div>`;
    return;
  }

  try {
    let url = source;
    if (source.startsWith("gs://") || source.startsWith("course-videos/")) {
      url = await getDownloadURL(storageRef(storage, source));
    }

    if (/youtu\.?be|youtube-nocookie\.com/.test(url)) {
      const id = extractYouTubeId(url);
      wrap.innerHTML = `
        <iframe src="https://www.youtube-nocookie.com/embed/${safeText(id)}?rel=0&modestbranding=1"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:none;"></iframe>
        <div class="vid-watermark">${watermark}</div>`;
      return;
    }

    wrap.innerHTML = `
      <video controls controlsList="nodownload" oncontextmenu="return false"
        style="position:absolute;inset:0;width:100%;height:100%;background:#000;"
        data-lesson-id="${safeText(lesson.id)}">
        <source src="${safeText(url)}" type="video/mp4">
      </video>
      <div class="vid-watermark">${watermark}</div>`;

    const video = wrap.querySelector("video");
    if (video) {
      video.addEventListener("ended", () => markLessonComplete(lesson.id));
    }
  } catch (error) {
    wrap.innerHTML = `
      <div class="video-placeholder">
        <div class="vs">Secure video unavailable</div>
        <div class="vp">${safeText(error.message)}</div>
      </div>`;
  }
}

function extractYouTubeId(url) {
  const match = String(url).match(/(?:embed\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : "";
}

async function markLessonComplete(lessonId) {
  if (!currentUser || !lessonId) return;
  await setDoc(doc(db, paths.users, currentUser.uid, "progress", String(lessonId)), {
    lessonId: String(lessonId),
    completed: true,
    completedAt: serverTimestamp()
  }, { merge: true });
  await refreshProgress();
}

async function refreshProgress() {
  if (!currentUser) return;
  const snapshot = await getDocs(collection(db, paths.users, currentUser.uid, "progress"));
  const done = snapshot.docs.filter((item) => item.data().completed === true).length;
  const total = lessons.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("progress-done").textContent = String(done);
  $("progress-total").textContent = String(total);
  $("progress-fill").style.width = `${pct}%`;
  $("progress-pct-label").textContent = pct ? `${pct}% complete` : "Start watching to track your progress";
}

function renderDoubts(lessonId) {
  const list = $("doubts-list");
  if (!list || !currentUser) return;
  if (unsubscribeDoubts) unsubscribeDoubts();
  list.innerHTML = "";

  const doubtsQuery = query(
    collection(db, paths.doubts),
    where("uid", "==", currentUser.uid),
    where("lessonId", "==", String(lessonId))
  );
  unsubscribeDoubts = onSnapshot(doubtsQuery, (snapshot) => {
    const items = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    list.innerHTML = items.length ? items.map((item) => `
      <div class="doubt-item">
        <div class="doubt-meta"><span class="doubt-author">${safeText(currentProfile?.name || currentUser.email)}</span></div>
        <div class="doubt-text">${safeText(item.text)}</div>
        ${item.reply ? `<div class="doubt-reply"><strong>Mentor reply:</strong> ${safeText(item.reply)}</div>` : ""}
      </div>`).join("") : `<div style="font-size:12px;color:#555;">No doubts yet for this lesson.</div>`;
  });
}

export async function submitDoubt() {
  const input = $("doubt-input");
  const lesson = lessons[currentLessonIndex];
  const text = input?.value.trim();
  if (!text || !currentUser || !lesson) return;
  await addDoc(collection(db, paths.doubts), {
    uid: currentUser.uid,
    studentEmail: currentUser.email,
    studentName: currentProfile?.name || currentUser.displayName || "",
    lessonId: String(lesson.id),
    lessonTitle: lesson.title || "",
    text,
    createdAt: serverTimestamp()
  });
  input.value = "";
}

export function nextLesson() {
  selectLessonByIndex(currentLessonIndex + 1);
}

export function prevLesson() {
  selectLessonByIndex(currentLessonIndex - 1);
}

export function toggleMobDrawer() {
  $("mob-lesson-drawer")?.classList.toggle("open");
  $("mob-bar-arrow")?.classList.toggle("open");
}

window.__rtSelectLesson = (index) => selectLessonByIndex(index);
