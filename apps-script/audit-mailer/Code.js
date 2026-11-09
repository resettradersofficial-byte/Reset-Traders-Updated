// Reset Audit mailer: a Google Apps Script web app bound to the "Reset Audit Mailer" sheet.
// Deployed as: execute as the owner (resettradersofficial@gmail.com), access: anyone.
// Only the audit-lead Worker knows AUDIT_TOKEN (Script Properties), so only it can send.
//
// POST JSON {to, subject, html, token} -> MailApp.sendEmail from the owner's Gmail.
// Every attempt is logged to the "Sends" tab. Failed sends keep their HTML so
// resendFailed() can retry them from the editor.

const SENDER_NAME = "Leo · Reset Traders";
const SUBJECT_PREFIX = "Your Reset Audit result: ";
const TYPES = ["Rusher", "Performer", "Competitor", "Intellectualizer"];
const EMAIL_RE = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]{2,}$/;
const MAX_HTML = 60000;
const LOG_SHEET = "Sends";
const HEADERS = ["Time", "Email", "Type", "Retake", "Status", "Error", "Subject", "HTML (failed only)"];

function doPost(e) {
  let msg;
  try {
    msg = JSON.parse((e && e.postData && e.postData.contents) || "");
  } catch (_) {
    return reply_({ ok: false, error: "bad json" });
  }
  if (!tokenOk_(msg && msg.token)) return reply_({ ok: false, error: "unauthorized" });

  const check = validate_(msg);
  if (check.error) return reply_({ ok: false, error: check.error });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const result = send_(check);
    log_(check, result);
    return reply_(result.ok ? { ok: true } : { ok: false, error: "send failed" });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return reply_({ ok: false, error: "POST only" });
}

function tokenOk_(given) {
  const expected = PropertiesService.getScriptProperties().getProperty("AUDIT_TOKEN") || "";
  if (!expected || typeof given !== "string" || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

function validate_(msg) {
  const allowed = ["to", "subject", "html", "token"];
  if (Object.keys(msg).some(function (k) { return allowed.indexOf(k) === -1; })) return { error: "unexpected field" };
  const to = typeof msg.to === "string" ? msg.to.trim().toLowerCase() : "";
  if (!to || to.length > 254 || !EMAIL_RE.test(to)) return { error: "bad to" };
  const subject = typeof msg.subject === "string" ? msg.subject : "";
  const m = subject.match(/^Your Reset Audit result: (Rusher|Performer|Competitor|Intellectualizer)( \(retake\))?$/);
  if (!m) return { error: "bad subject" };
  const html = typeof msg.html === "string" ? msg.html : "";
  if (!html || html.length > MAX_HTML) return { error: "bad html" };
  return { to: to, subject: subject, html: html, type: m[1], retake: Boolean(m[2]) };
}

function send_(m) {
  try {
    MailApp.sendEmail({ to: m.to, subject: m.subject, htmlBody: m.html, name: SENDER_NAME, body: plainText_(m.html) });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 300) };
  }
}

function plainText_(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|h\d)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function logSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  }
  return sh;
}

function log_(m, result) {
  logSheet_().appendRow([
    new Date(), m.to, m.type, m.retake ? "yes" : "no",
    result.ok ? "sent" : "failed", result.ok ? "" : result.error, m.subject,
    result.ok ? "" : m.html
  ]);
}

// Run from the editor to retry every "failed" row. Successful rows are marked "resent".
function resendFailed() {
  const sh = logSheet_();
  const rows = sh.getDataRange().getValues();
  let resent = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[4] !== "failed" || !r[7]) continue;
    const res = send_({ to: r[1], subject: r[6], html: r[7] });
    if (res.ok) {
      sh.getRange(i + 1, 5, 1, 4).setValues([["resent " + new Date().toISOString(), "", r[6], ""]]);
      resent++;
    } else {
      sh.getRange(i + 1, 6).setValue(res.error);
    }
  }
  Logger.log("Resent " + resent + " email(s). Daily quota left: " + MailApp.getRemainingDailyQuota());
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
