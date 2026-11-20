// Who may play which video. Run: node tests/course-video/access.test.mjs
import assert from 'node:assert/strict';
const { hasAccess } = await import(new URL('../../workers/course-video/src/index.js', import.meta.url));
const profiles = {
  admin: { role: { stringValue: 'admin' } },
  oldStudent: { role: { stringValue: 'student' }, access: { mapValue: { fields: { active: { booleanValue: true } } } } },
  buyer: { role: { stringValue: 'student' }, access: { mapValue: { fields: { active: { booleanValue: false } } } }, reset: { mapValue: { fields: { status: { stringValue: 'founding' } } } } },
  testSeat: { role: { stringValue: 'student' }, reset: { mapValue: { fields: { status: { stringValue: 'test' } } } } },
  nobody: { role: { stringValue: 'student' } }
};
globalThis.fetch = async (url) => { const uid = decodeURIComponent(String(url).split('/users/')[1]); return new Response(JSON.stringify({ fields: profiles[uid] })); };
const BEFORE = Date.parse('2026-12-31T18:29:00Z'), AFTER = Date.parse('2026-12-31T18:30:00Z');
const cases = [
  ['admin', 'reset-0.1.mp4', BEFORE, true], ['admin', 'IFVG.mp4', BEFORE, true],
  ['buyer', 'reset-0.1.mp4', BEFORE, false], ['buyer', 'reset-0.1.mp4', AFTER, true], ['buyer', 'IFVG.mp4', AFTER, false],
  ['oldStudent', 'IFVG.mp4', BEFORE, true], ['oldStudent', 'reset-0.1.mp4', AFTER, false],
  ['testSeat', 'reset-0.1.mp4', AFTER, false], ['nobody', 'reset-0.1.mp4', AFTER, false], ['nobody', 'IFVG.mp4', AFTER, false]
];
for (const [who, key, now, want] of cases) assert.equal(await hasAccess(who, 'tok', key, now), want, `${who} ${key} ${now === AFTER ? 'after' : 'before'}`);
console.log(cases.length + ' access cases passed');
