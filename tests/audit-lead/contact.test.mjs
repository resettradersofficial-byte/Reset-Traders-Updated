// Tests for the audit-lead Worker's /contact route, with fake Brevo and Turnstile.
// Run: node tests/audit-lead/contact.test.mjs
import assert from 'node:assert/strict';
const mod = await import(new URL('../../workers/audit-lead/src/index.js', import.meta.url));
const worker = mod.default;
const sent = [];
let turnstilePass = true;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('turnstile')) return new Response(JSON.stringify({ success: turnstilePass }));
  if (u.includes('api.brevo.com')) { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 201 }); }
  return new Response('{}', { status: 404 });
};
const env = { BREVO_API_KEY: 'k', TURNSTILE_SECRET_KEY: 's' };
const good = { name: 'Asha  K', email: 'Asha@Example.com', topic: 'reset', message: 'When does the course open?\n<b>thanks</b>', turnstile: 'tok' };
const call = (body, origin = 'https://www.resettraders.com', path = '/contact') => worker.fetch(new Request('https://audit-lead.example' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }), env, {});
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

await t('valid message is sent to the Reset Traders inbox with reply-to', async () => {
  const r = await call(good); assert.equal(r.status, 200);
  const m = sent.at(-1);
  assert.deepEqual(m.to, [{ email: 'resettradersofficial@gmail.com' }]);
  assert.deepEqual(m.replyTo, { email: 'asha@example.com' });
  assert.match(m.subject, /^\[Contact\] Your Personal Reset \(course\): Asha K$/);
  assert.ok(m.htmlContent.includes('&lt;b&gt;thanks&lt;/b&gt;') && !m.htmlContent.includes('<b>thanks'));
});
await t('wrong origin is refused', async () => { assert.equal((await call(good, 'https://evil.example')).status, 403); });
await t('bad topic, short message, bad email, extra field are refused', async () => {
  for (const b of [{ ...good, topic: 'x' }, { ...good, message: 'hi' }, { ...good, email: 'nope' }, { ...good, to: 'x@y.com' }, { ...good, name: '' }]) assert.equal((await call(b)).status, 400);
});
await t('failed Turnstile is refused and nothing is sent', async () => {
  const before = sent.length; turnstilePass = false; assert.equal((await call(good)).status, 403); turnstilePass = true; assert.equal(sent.length, before);
});
await t('honeypot pretends success without sending', async () => {
  const before = sent.length; assert.equal((await call({ ...good, website: 'x' })).status, 200); assert.equal(sent.length, before);
});
await t('other emails keep the Reset Traders reply-to', async () => {
  await mod.sendViaBrevo(env, { to: 'a@b.co', subject: 's', html: 'h' });
  assert.deepEqual(sent.at(-1).replyTo, { name: 'Reset Traders', email: 'resettradersofficial@gmail.com' });
});
console.log(n, 'tests passed');
