// Private course videos: the files live in Cloudflare R2 behind the "course-video" Worker.
// A lesson's video can be written as "r2:<file name>.mp4". Old GitHub release links to the same
// file name still work: they are looked up in R2 instead of GitHub.
import { auth } from "./firebase.js?v=20261118-video";

export const VIDEO_WORKER = "https://course-video.resettradersofficial.workers.dev";

const RELEASE_LINK = /^https:\/\/github\.com\/resettradersofficial-byte\/Reset-Traders-Updated\/releases\/download\/[^/]+\/([^/?#]+\.mp4)$/i;

export function privateVideoKey(source) {
  const text = String(source || "").trim();
  if (/^r2:/i.test(text)) return text.slice(3).trim();
  const match = RELEASE_LINK.exec(text);
  return match ? decodeURIComponent(match[1]) : "";
}

// Returns a short-lived link the signed-in student or admin can play.
export async function privateVideoUrl(key) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please log in again to watch this lesson.");
  const token = await user.getIdToken();
  const res = await fetch(`${VIDEO_WORKER}/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error || "This video could not be loaded. Reload the page and try again.");
  return data.url;
}
