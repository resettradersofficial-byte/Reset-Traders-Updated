import {
  addDoc,
  auth,
  collection,
  createStudentAuthAccount,
  db,
  deleteDoc,
  doc,
  getDocs,
  isAdminProfile,
  onSnapshot,
  orderBy,
  paths,
  query,
  safeText,
  sendCurrentUserPasswordReset,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "./firebase.js?v=20260707-checkout-account-fix";

let adminUser = null;
let adminProfile = null;
let lessons = [];
let students = [];
let testimonials = [];
let doubts = [];
let unsubscribeFns = [];
let previewLessonId = null;
let pendingTestimonialMedia = "";

function $(id) {
  return document.getElementById(id);
}

function requireAdmin() {
  if (!adminUser || !isAdminProfile(adminProfile)) {
    throw new Error("Admin Firebase Auth session required.");
  }
}

function resetSubscriptions() {
  unsubscribeFns.forEach((fn) => fn && fn());
  unsubscribeFns = [];
}

export function unloadAdmin() {
  resetSubscriptions();
  adminUser = null;
  adminProfile = null;
}

export function loadAdmin(user, profile) {
  unloadAdmin();
  if (!isAdminProfile(profile)) {
    alert("This Firebase account is not an admin.");
    return;
  }
  adminUser = user;
  adminProfile = profile;

  unsubscribeFns.push(onSnapshot(query(collection(db, paths.lessons), orderBy("order", "asc")), (snapshot) => {
    lessons = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdminLessons();
  }));

  unsubscribeFns.push(onSnapshot(query(collection(db, paths.users), where("role", "==", "student")), (snapshot) => {
    students = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdminStudents();
  }));

  unsubscribeFns.push(onSnapshot(query(collection(db, paths.testimonials), orderBy("createdAt", "desc")), (snapshot) => {
    testimonials = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdminTestimonials();
    renderPublicTestimonials();
  }));

  unsubscribeFns.push(onSnapshot(query(collection(db, paths.doubts), orderBy("createdAt", "desc")), (snapshot) => {
    doubts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdminDoubts();
  }));
}

export function adminTab(tab) {
  document.querySelectorAll(".admin-tab").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".admin-section").forEach((section) => section.classList.remove("active"));
  const tabButton = Array.from(document.querySelectorAll(".admin-tab"))
    .find((button) => button.getAttribute("onclick")?.includes(`'${tab}'`));
  if (tabButton) tabButton.classList.add("active");
  $(`tab-${tab}`)?.classList.add("active");
  if (tab === "doubts") renderAdminDoubts();
}

function videoField(value) {
  if (!value) return {};
  if (value.startsWith("gs://") || value.startsWith("course-videos/")) {
    return { storagePath: value, videoUrl: "" };
  }
  return { videoUrl: value, storagePath: "" };
}

export async function addLesson() {
  try {
    requireAdmin();
    const title = $("new-title").value.trim();
    const module = $("new-module").value.trim();
    const video = $("new-video").value.trim();
    const duration = $("new-duration").value.trim();
    const notes = $("new-notes").value.trim();
    if (!title || !module) {
      alert("Please enter lesson title and module.");
      return;
    }
    await addDoc(collection(db, paths.lessons), {
      title,
      module,
      duration,
      notes,
      active: true,
      order: lessons.length + 1,
      ...videoField(video),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    ["new-title", "new-module", "new-video", "new-duration", "new-notes"].forEach((id) => { $(id).value = ""; });
  } catch (error) {
    alert(error.message);
  }
}

export async function editLesson(id) {
  try {
    requireAdmin();
    const lesson = lessons.find((item) => item.id === id);
    if (!lesson) return;
    const title = prompt("Lesson title:", lesson.title || "");
    if (title === null) return;
    const module = prompt("Module:", lesson.module || "");
    if (module === null) return;
    const video = prompt("GitHub Release MP4, YouTube, Firebase Storage path, or secure video URL:", lesson.storagePath || lesson.videoUrl || "");
    if (video === null) return;
    const duration = prompt("Duration / time label:", lesson.duration || "");
    if (duration === null) return;
    const notes = prompt("Lesson notes:", lesson.notes || "");
    if (notes === null) return;
    const orderRaw = prompt("Lesson order number:", String(lesson.order || lessons.indexOf(lesson) + 1));
    if (orderRaw === null) return;
    const activeRaw = prompt("Visible to students? Type yes or no:", lesson.active === false ? "no" : "yes");
    if (activeRaw === null) return;
    const order = Number.parseInt(orderRaw, 10);
    await updateDoc(doc(db, paths.lessons, id), {
      title: title.trim(),
      module: module.trim(),
      ...videoField(video.trim()),
      duration: duration.trim(),
      notes: notes.trim(),
      order: Number.isFinite(order) ? order : lesson.order || lessons.indexOf(lesson) + 1,
      active: !/^no|false|0$/i.test(activeRaw.trim()),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    alert(error.message);
  }
}

export async function deleteLesson(id) {
  try {
    requireAdmin();
    if (!confirm("Delete this lesson?")) return;
    await deleteDoc(doc(db, paths.lessons, id));
  } catch (error) {
    alert(error.message);
  }
}

export function previewAdminVideo(id) {
  previewLessonId = previewLessonId === id ? null : id;
  renderAdminLessons();
}

export function renderAdminLessons() {
  const list = $("lesson-manage-list");
  const count = $("lesson-count");
  if (!list) return;
  count.textContent = String(lessons.length);
  list.innerHTML = lessons.map((lesson, index) => {
    const source = lesson.storagePath || lesson.videoUrl || "";
    const preview = previewLessonId === lesson.id && source ? `
      <div style="background:#000;border-radius:6px;overflow:hidden;aspect-ratio:16/9;margin:8px 0 16px;position:relative;">
        ${source.includes("youtube") || source.includes("youtu.be")
          ? `<iframe src="${safeText(source)}" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:none;"></iframe>`
          : `<video controls style="position:absolute;inset:0;width:100%;height:100%;background:#000;" controlsList="nodownload"><source src="${safeText(source)}" type="video/mp4"></video>`}
      </div>` : "";
    return `
      <div class="student-row">
        <div>
          <strong>${String(index + 1).padStart(2, "0")}. ${safeText(lesson.title)}</strong>
          <span class="email">${safeText(lesson.module || "")} · ${safeText(lesson.duration || "")}</span>
          ${lesson.active === false ? `<div class="admin-pill" style="color:var(--red);background:rgba(239,68,68,0.1);">Hidden from students</div>` : ""}
          ${lesson.storagePath ? `<div class="admin-pill">Firebase Storage Protected</div>` : ""}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${source ? `<button class="admin-btn secondary" style="padding:6px 12px;font-size:11px;" onclick="previewAdminVideo('${lesson.id}')">Preview</button>` : ""}
          <button class="admin-btn secondary" style="padding:6px 12px;font-size:11px;" onclick="editLesson('${lesson.id}')">Edit</button>
          <button class="admin-btn del" style="padding:6px 12px;font-size:11px;" onclick="deleteLesson('${lesson.id}')">Delete</button>
        </div>
      </div>${preview}`;
  }).join("");
}

function generateTempPassword() {
  return `RT-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}-${Date.now().toString(36)}`;
}

export async function addStudent() {
  try {
    requireAdmin();
    const name = $("s-name").value.trim();
    const email = $("s-email").value.trim().toLowerCase();
    const passInput = $("s-pass").value.trim();
    const password = passInput || generateTempPassword();
    const plan = $("s-plan").value;
    if (!name || !email || password.length < 8) {
      alert("Enter name, email, and a temporary password of at least 8 characters.");
      return;
    }
    await createStudentAuthAccount({ name, email, password, plan });
    ["s-name", "s-email", "s-pass"].forEach((id) => { $(id).value = ""; });
    alert("Student Firebase Auth account created. A Firebase password reset email has been sent.");
  } catch (error) {
    alert(error.message);
  }
}

export async function toggleStudent(uid) {
  try {
    requireAdmin();
    const student = students.find((item) => item.id === uid);
    if (!student) return;
    await updateDoc(doc(db, paths.users, uid), {
      "access.active": !(student.access?.active === true),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    alert(error.message);
  }
}

export function renderAdminStudents() {
  const list = $("student-list");
  const count = $("student-count");
  if (!list) return;
  count.textContent = String(students.length);
  list.innerHTML = students.map((student) => {
    const active = student.access?.active === true;
    return `
      <div class="student-row">
        <div>
          <strong>${safeText(student.name || "Student")}</strong>
          <span class="email">${safeText(student.email)} · ${safeText(student.plan || "No plan")}</span>
        </div>
        <button class="admin-btn" style="padding:5px 10px;font-size:11px;background:${active ? "var(--maroon)" : "var(--green)"};" onclick="toggleStudent('${student.id}')">
          ${active ? "Revoke" : "Grant"}
        </button>
      </div>`;
  }).join("");
}

export async function addTestimonial() {
  try {
    requireAdmin();
    const name = $("t-name").value.trim();
    const meta = $("t-meta").value.trim();
    const text = $("t-text").value.trim();
    const stars = Number($("t-stars").value || 5);
    const initials = $("t-initials").value.trim();
    const mediaType = $("t-type").value;
    const mediaUrl = $("t-media-url").value.trim() || pendingTestimonialMedia;
    if (!name || !text) {
      alert("Please add testimonial name and text.");
      return;
    }
    await addDoc(collection(db, paths.testimonials), {
      name,
      meta,
      text,
      stars,
      initials,
      mediaType,
      mediaUrl,
      active: true,
      createdAt: serverTimestamp()
    });
    ["t-name", "t-meta", "t-text", "t-initials", "t-media-url"].forEach((id) => { $(id).value = ""; });
    pendingTestimonialMedia = "";
    const preview = $("t-preview-wrap");
    if (preview) preview.style.display = "none";
  } catch (error) {
    alert(error.message);
  }
}

export async function deleteTestimonial(id) {
  try {
    requireAdmin();
    if (!confirm("Delete this testimonial?")) return;
    await deleteDoc(doc(db, paths.testimonials, id));
  } catch (error) {
    alert(error.message);
  }
}

export function renderAdminTestimonials() {
  const list = $("testi-manage-list");
  const count = $("testi-count");
  if (!list) return;
  count.textContent = String(testimonials.length);
  list.innerHTML = testimonials.map((testimonial) => `
    <div class="student-row">
      <div>
        <strong>${safeText(testimonial.name)}</strong>
        <span class="email">${safeText(testimonial.meta || "")}</span>
      </div>
      <button class="admin-btn del" style="padding:6px 12px;font-size:11px;" onclick="deleteTestimonial('${testimonial.id}')">Delete</button>
    </div>`).join("");
}

export function renderPublicTestimonials() {
  const grid = $("testi-grid");
  const placeholder = $("testi-placeholder");
  if (!grid) return;
  const active = testimonials.filter((item) => item.active !== false);
  if (placeholder) placeholder.style.display = active.length ? "none" : "block";
  grid.innerHTML = active.map((testimonial) => `
    <div class="testi-card reveal">
      <div class="stars">${"★".repeat(Math.max(1, Math.min(5, testimonial.stars || 5)))}</div>
      <p>${safeText(testimonial.text)}</p>
      <div class="testi-author">
        <div class="testi-avatar">${safeText(testimonial.initials || testimonial.name?.slice(0, 2) || "RT")}</div>
        <div><strong>${safeText(testimonial.name)}</strong><span>${safeText(testimonial.meta || "")}</span></div>
      </div>
    </div>`).join("");
}

export async function saveSocial() {
  try {
    requireAdmin();
    await setDoc(doc(db, paths.site, "public"), {
      youtubeUrl: $("yt-url").value.trim(),
      introVideoUrl: $("intro-video-id").value.trim(),
      omkarPhotoUrl: $("omkar-photo-url").value.trim(),
      instagramUrl: $("ig-url").value.trim(),
      telegramUrl: $("tg-url").value.trim(),
      whatsappNumber: $("wa-num").value.trim(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    $("social-msg").textContent = "Saved";
    setTimeout(() => { $("social-msg").textContent = ""; }, 2200);
  } catch (error) {
    alert(error.message);
  }
}

export async function changeAdminPass() {
  const msg = $("pass-msg");
  try {
    requireAdmin();
    await sendCurrentUserPasswordReset();
    msg.textContent = "Reset email sent";
    msg.style.color = "var(--green)";
  } catch (error) {
    msg.textContent = error.message;
    msg.style.color = "var(--red)";
  }
}

export function renderAdminDoubts() {
  const list = $("admin-doubts-list");
  if (!list) return;
  list.innerHTML = doubts.length ? doubts.map((item) => `
    <div style="background:var(--black3);border:1px solid #222;border-radius:8px;padding:16px;">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:800;color:var(--orange);">${safeText(item.studentName || item.studentEmail)}</span>
        <span style="font-size:11px;color:#555;">${safeText(item.lessonTitle || item.lessonId)}</span>
      </div>
      <div style="font-size:13px;color:var(--gray-light);line-height:1.7;">${safeText(item.text)}</div>
      ${item.reply ? `<div style="margin-top:10px;padding:10px 14px;background:rgba(255,107,26,0.06);border-left:3px solid var(--orange);border-radius:0 6px 6px 0;"><div style="font-size:11px;color:var(--orange);font-weight:800;margin-bottom:4px;">Your Reply</div><div style="font-size:13px;color:var(--gray-light);">${safeText(item.reply)}</div></div>`
        : `<div style="margin-top:10px;display:flex;gap:8px;"><input id="reply-${item.id}" placeholder="Type your reply..." style="flex:1;background:var(--black2);border:1px solid #333;border-radius:6px;padding:8px 12px;color:var(--white);font-family:inherit;font-size:13px;outline:none;"><button onclick="saveReply('${item.id}')" style="background:var(--orange);color:#000;border:none;border-radius:6px;padding:8px 16px;font-weight:800;cursor:pointer;font-size:12px;font-family:inherit;">Reply</button></div>`}
    </div>`).join("") : `<div style="font-size:13px;color:var(--gray-light);">No student doubts yet.</div>`;
}

export async function saveReply(id) {
  try {
    requireAdmin();
    const input = $(`reply-${id}`);
    const reply = input?.value.trim();
    if (!reply) return;
    await updateDoc(doc(db, paths.doubts, id), {
      reply,
      repliedAt: serverTimestamp(),
      repliedBy: auth.currentUser.email
    });
  } catch (error) {
    alert(error.message);
  }
}

export async function exportData() {
  try {
    requireAdmin();
    const [lessonSnap, userSnap, testiSnap, doubtSnap] = await Promise.all([
      getDocs(collection(db, paths.lessons)),
      getDocs(collection(db, paths.users)),
      getDocs(collection(db, paths.testimonials)),
      getDocs(collection(db, paths.doubts))
    ]);
    const data = {
      exportedAt: new Date().toISOString(),
      lessons: lessonSnap.docs.map((item) => ({ id: item.id, ...item.data() })),
      users: userSnap.docs.map((item) => ({ id: item.id, ...item.data() })),
      testimonials: testiSnap.docs.map((item) => ({ id: item.id, ...item.data() })),
      doubts: doubtSnap.docs.map((item) => ({ id: item.id, ...item.data() }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reset-traders-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

export function toggleTestiMedia(type) {
  const area = $("t-media-area");
  if (area) area.style.display = type === "text" ? "none" : "block";
}

export function handleTestiFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    pendingTestimonialMedia = event.target.result;
    const wrap = $("t-preview-wrap");
    if (!wrap) return;
    wrap.style.display = "block";
    wrap.innerHTML = file.type.startsWith("video/")
      ? `<video src="${pendingTestimonialMedia}" controls style="width:100%;max-height:200px;border-radius:8px;"></video>`
      : `<img src="${pendingTestimonialMedia}" style="width:100%;max-height:200px;object-fit:contain;border-radius:8px;">`;
  };
  reader.readAsDataURL(file);
}

export function previewFounderPhoto(input, who) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const url = event.target.result;
    const el = $(`founder-photo-${who}`);
    if (el) {
      el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    }
    const urlInput = $(`${who}-photo-url`);
    if (urlInput) urlInput.value = "";
    alert("Preview loaded. For production, upload the image to Firebase Storage and paste its protected URL/path before saving.");
  };
  reader.readAsDataURL(file);
}
