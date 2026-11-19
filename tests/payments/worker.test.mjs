// Tests for workers/payments with fake Razorpay, Firebase Auth, Google OAuth and Firestore.
// Run: node tests/payments/worker.test.mjs
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
const mod = await import(new URL('../../workers/payments/src/index.js', import.meta.url));
const worker = mod.default;

// ---- fake services ----
const db = new Map(); // path -> object
let rzOrders = 0, rzPayments = new Map(), lastOrderKey = '';
const users = { 'tok-buyer': { localId: 'buyer1', email: 'buyer@example.com' }, 'tok-admin': { localId: 'admin1', email: 'admin@example.com' } };
const toF = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'string' ? { stringValue: v } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toF(x)])) } };
const fromF = (f) => 'stringValue' in f ? f.stringValue : 'integerValue' in f ? Number(f.integerValue) : 'booleanValue' in f ? f.booleanValue : 'timestampValue' in f ? f.timestampValue : 'nullValue' in f ? null : 'mapValue' in f ? Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, fromF(x)])) : null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('identitytoolkit')) { const t = JSON.parse(init.body).idToken; return users[t] ? new Response(JSON.stringify({ users: [users[t]] })) : new Response('{}', { status: 400 }); }
  if (u.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'g', expires_in: 3600 }));
  if (u.includes('documents:commit')) { const w = JSON.parse(init.body).writes[0].transform; const p = w.document.split('/documents/')[1]; const d = db.get(p) || {}; const ft = w.fieldTransforms[0]; d[ft.fieldPath] = (d[ft.fieldPath] || 0) + Number(ft.increment.integerValue); db.set(p, d); return new Response(JSON.stringify({ writeResults: [{ transformResults: [{ integerValue: String(d[ft.fieldPath]) }] }] })); }
  if (u.includes('firestore.googleapis.com')) {
    const p = decodeURIComponent(u.split('/documents/')[1].split('?')[0]);
    if (init.method === 'POST' && u.includes('?documentId=')) { const id = decodeURIComponent(u.split('documentId=')[1]); const col = decodeURIComponent(u.split('/documents/')[1].split('?')[0]); const key = col + '/' + id; if (db.has(key)) return new Response('{}', { status: 409 }); db.set(key, Object.fromEntries(Object.entries(JSON.parse(init.body).fields).map(([k, v]) => [k, fromF(v)]))); return new Response('{}'); }
    if (init.method === 'PATCH') { const fields = JSON.parse(init.body).fields; db.set(p, { ...(db.get(p) || {}), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromF(v)])) }); return new Response('{}'); }
    const d = db.get(p); return d ? new Response(JSON.stringify({ fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, toF(v)])) })) : new Response('{}', { status: 404 });
  }
  if (u.includes('api.razorpay.com/v1/orders')) { lastOrderKey = init.headers.Authorization; const b = JSON.parse(init.body); rzOrders++; return new Response(JSON.stringify({ id: 'order_' + rzOrders, amount: b.amount, currency: b.currency })); }
  if (u.includes('api.razorpay.com/v1/payments/')) { const id = u.split('/').pop(); return new Response(JSON.stringify(rzPayments.get(id))); }
  return new Response('{}', { status: 404 });
};
const mails = [];
const env = { INTERNAL_TOKEN: 'tok', MAILER: { fetch: async (url, init) => { mails.push({ url, token: init.headers['x-internal-token'], ...JSON.parse(init.body) }); return new Response('{"ok":true}'); } }, FIREBASE_PROJECT_ID: 'p', FIREBASE_WEB_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'svc@x', FIREBASE_PRIVATE_KEY: 'x', RAZORPAY_KEY_ID: 'rzp_live_X', RAZORPAY_KEY_SECRET: 'livesecret', RAZORPAY_TEST_KEY_ID: 'rzp_test_X', RAZORPAY_TEST_KEY_SECRET: 'testsecret', RAZORPAY_WEBHOOK_SECRET: 'whsec' };
// Signing a JWT needs a real RSA key: give the worker one.
const kp = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pk = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
env.FIREBASE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`;

const hmac = async (secret, msg) => Buffer.from(await webcrypto.subtle.sign('HMAC', await webcrypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(msg))).toString('hex');
const call = (path, { method = 'POST', token, body, origin = 'https://www.resettraders.com', headers = {} } = {}) => worker.fetch(new Request('https://w.dev' + path, { method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
const out = []; const ok = (name, cond, extra = '') => out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' (' + extra + ')' : ''}`);
const buyerBody = { plan: 'reset_in', email: 'buyer@example.com', name: 'Test Buyer', phone: '+919999999999' };

// 1. founding price in INR, live key
let r = await call('/create-order', { token: 'tok-buyer', body: buyerBody }); let j = await r.json();
ok('founding INR order', r.status === 200 && j.amount === 1999900 && j.currency === 'INR' && j.tier === 'founding' && j.keyId === 'rzp_live_X', JSON.stringify(j));
ok('live key used for order', lastOrderKey === 'Basic ' + btoa('rzp_live_X:livesecret'));
const orderId = j.orderId;
// 2. USD price
r = await call('/create-order', { token: 'tok-buyer', body: { ...buyerBody, plan: 'reset_intl' } }); j = await r.json();
ok('founding USD order', j.amount === 24700 && j.currency === 'USD', JSON.stringify(j));
// 3. old plans gone
r = await call('/create-order', { token: 'tok-buyer', body: { ...buyerBody, plan: 'course' } }); ok('old course plan refused', r.status === 400);
r = await call('/create-order', { token: 'tok-buyer', body: { ...buyerBody, plan: 'mentorship' } }); ok('Elite plan refused', r.status === 400);
// 4. email must match login
r = await call('/create-order', { token: 'tok-buyer', body: { ...buyerBody, email: 'other@example.com' } }); ok('email mismatch refused', r.status === 403);
// 5. test mode: non-admin refused, admin allowed with test key
r = await call('/create-order', { token: 'tok-buyer', body: { ...buyerBody, test: true } }); ok('test mode refused for non-admin', r.status === 403);
db.set('users/admin1', { role: 'admin', email: 'admin@example.com' });
r = await call('/create-order', { token: 'tok-admin', body: { ...buyerBody, email: 'admin@example.com', test: true } }); j = await r.json();
ok('test mode for admin uses test key', r.status === 200 && j.keyId === 'rzp_test_X' && j.test === true && lastOrderKey === 'Basic ' + btoa('rzp_test_X:testsecret'));
const testOrderId = j.orderId;
// 6. verify: bad signature refused
r = await call('/verify-payment', { token: 'tok-buyer', body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_A', razorpay_signature: 'bad' } }); ok('bad signature refused', r.status === 401);
// 7. verify: good signature -> seat recorded, counter +1, old access untouched
db.set('users/buyer1', { role: 'student', email: 'buyer@example.com', access: { active: false, source: 'checkout_started' } });
rzPayments.set('pay_A', { id: 'pay_A', order_id: orderId, status: 'captured', amount: 1999900, currency: 'INR', method: 'upi', created_at: 1 });
r = await call('/verify-payment', { token: 'tok-buyer', body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_A', razorpay_signature: await hmac('livesecret', `${orderId}|pay_A`) } }); j = await r.json();
const u1 = db.get('users/buyer1');
ok('payment verified', r.status === 200 && j.paid === true && j.opensAt === '2026-12-02', JSON.stringify(j));
ok('seat recorded as founding', u1.reset?.status === 'founding' && u1.reset?.opensAt === '2026-12-02');
ok('old course access NOT switched on', u1.access?.active === false);
ok('founding counter = 1', db.get('site/founding')?.sold === 1);
// 8. repeat verify / webhook does not double count
await call('/verify-payment', { token: 'tok-buyer', body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_A', razorpay_signature: await hmac('livesecret', `${orderId}|pay_A`) } });
const wh = JSON.stringify({ event: 'payment.captured', created_at: 5, payload: { payment: { entity: rzPayments.get('pay_A') } } });
r = await worker.fetch(new Request('https://w.dev/razorpay-webhook', { method: 'POST', headers: { 'x-razorpay-signature': await hmac('whsec', wh), 'x-razorpay-event-id': 'evt1' }, body: wh }), env);
ok('webhook accepted', r.status === 200);
ok('no double counting', db.get('site/founding')?.sold === 1);
ok('one invoice email for the live payment', mails.filter((m) => !m.subject.startsWith('[TEST]')).length === 1, mails.length + ' mails');
const m1 = mails[0];
ok('invoice numbered RT-YYYY-0001 to the buyer', /Your Reset Traders invoice RT-\d{4}-0001$/.test(m1.subject) && m1.to === 'buyer@example.com' && m1.token === 'tok', m1.subject);
ok('invoice shows amount and GST note', m1.html.includes('₹19,999.00') && m1.html.includes('Not registered under GST') && m1.html.includes('pay_A'));
fs.writeFileSync(new URL('./invoice-preview.html', import.meta.url), m1.html);
// 9. second purchase on the same account refused
r = await call('/create-order', { token: 'tok-buyer', body: buyerBody }); ok('second seat on same account refused', r.status === 409);
// 10. tampered amount refused
const o2 = 'order_tamper'; db.set('orders/' + o2, { uid: 'buyer1', plan: 'reset_in', amount: 100, currency: 'INR', tier: 'founding', status: 'created' });
rzPayments.set('pay_T', { id: 'pay_T', order_id: o2, status: 'captured', amount: 100, currency: 'INR' });
r = await call('/verify-payment', { token: 'tok-buyer', body: { razorpay_order_id: o2, razorpay_payment_id: 'pay_T', razorpay_signature: await hmac('livesecret', `${o2}|pay_T`) } });
ok('wrong amount refused', r.status === 400);
// 11. test payment: signature with test secret, no counter change
rzPayments.set('pay_X', { id: 'pay_X', order_id: testOrderId, status: 'captured', amount: 1999900, currency: 'INR' });
r = await call('/verify-payment', { token: 'tok-admin', body: { razorpay_order_id: testOrderId, razorpay_payment_id: 'pay_X', razorpay_signature: await hmac('testsecret', `${testOrderId}|pay_X`) } }); j = await r.json();
ok('test payment verified with test secret', r.status === 200 && j.paid === true);
ok('test payment marked test, admin kept', db.get('users/admin1').reset?.status === 'test' && db.get('users/admin1').role === 'admin');
const tm = mails.find((m) => m.subject.startsWith('[TEST]'));
ok('test payment gets a TEST invoice', tm && /TEST-\d{4}-0001/.test(tm.subject) && tm.to === 'admin@example.com', tm && tm.subject);
ok('test payment not counted', db.get('site/founding')?.sold === 1);
// 12. after 100 founding seats, standard price
db.set('site/founding', { sold: 100 });
users['tok-new'] = { localId: 'new1', email: 'new@example.com' };
r = await call('/create-order', { token: 'tok-new', body: { ...buyerBody, email: 'new@example.com' } }); j = await r.json();
ok('standard price after 100 seats', j.amount === 2499900 && j.tier === 'standard', JSON.stringify(j));
r = await call('/founding', { method: 'GET' }); j = await r.json();
ok('/founding shows 0 left and standard prices', j.left === 0 && j.prices.reset_intl.amount === 29700, JSON.stringify(j));
// 13. CORS
r = await call('/founding', { method: 'GET', origin: 'https://evil.example' }); ok('no CORS for other sites', !r.headers.get('Access-Control-Allow-Origin'));
r = await call('/founding', { method: 'GET' }); ok('CORS for www.resettraders.com', r.headers.get('Access-Control-Allow-Origin') === 'https://www.resettraders.com');

console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `${failed} FAILED` : `all ${out.length} passed`);
process.exit(failed ? 1 : 0);
