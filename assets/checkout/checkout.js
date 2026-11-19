// Founding-seat checkout for Your Personal Reset (homepage and audit).
// Flow: details -> portal account (Firebase, same login as the student portal) -> Razorpay -> server check.
// The price comes from the payment Worker; the page only shows it.
const CFG = window.RT_CHECKOUT || {};
const FIREBASE = '/firebase.js?v=20261118-video';
const PLAN = { in: 'reset_in', intl: 'reset_intl' };
const fmt = (amount, currency) => currency === 'INR'
  ? '₹' + (amount / 100).toLocaleString('en-IN')
  : '$' + (amount / 100).toLocaleString('en-US');

let dlg, info = null, region = 'in';

function regionNow(el) {
  const r = (el && el.dataset.region) || document.querySelector('[data-checkout-region]')?.dataset.region || document.documentElement.dataset.region;
  return r === 'intl' ? 'intl' : 'in';
}

async function loadInfo() {
  try {
    const r = await fetch(CFG.worker + '/founding');
    info = await r.json();
  } catch (_) { info = null; }
  return info;
}

function css() {
  if (document.getElementById('rtc-css')) return;
  const s = document.createElement('style');
  s.id = 'rtc-css';
  s.textContent = `
  .rtc { width: min(480px, 100% - 24px); max-height: calc(100svh - 24px); padding: 0; border: 1px solid rgba(255,255,255,.12); border-radius: 24px; background: #121117; color: #f4f0ea; font-family: Inter, system-ui, sans-serif; overflow: auto; }
  .rtc::backdrop { background: rgba(5,4,8,.78); backdrop-filter: blur(4px); }
  .rtc-in { padding: 28px 26px 24px; }
  .rtc-x { position: absolute; top: 12px; right: 12px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.14); background: transparent; color: inherit; font-size: 22px; cursor: pointer; }
  .rtc-k { margin: 0 0 6px; color: #ff5544; font: 700 12px Poppins, sans-serif; letter-spacing: .14em; text-transform: uppercase; }
  .rtc h2 { margin: 0; font: 800 26px/1.15 Poppins, sans-serif; letter-spacing: -.02em; }
  .rtc-price { display: flex; align-items: baseline; gap: 10px; margin: 14px 0 4px; }
  .rtc-price b { font: 800 34px Poppins, sans-serif; }
  .rtc-price s { color: #9d97a6; }
  .rtc-sub { margin: 0 0 18px; color: #c4bfca; font-size: 14px; }
  .rtc label { display: block; margin: 0 0 12px; font-size: 13px; color: #c4bfca; }
  .rtc input[type=text], .rtc input[type=email], .rtc input[type=tel], .rtc input[type=password] { display: block; width: 100%; margin-top: 6px; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.16); background: #0b0a0f; color: #f4f0ea; font: 500 16px Inter, sans-serif; }
  .rtc input:focus { outline: 2px solid #9bbcff; outline-offset: 1px; }
  .rtc-agree { display: flex !important; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.5; }
  .rtc-agree input { margin-top: 3px; accent-color: #9bbcff; }
  .rtc-agree a { color: #9bbcff; }
  .rtc-go { width: 100%; margin-top: 6px; min-height: 54px; border: 0; border-radius: 999px; background: #9bbcff; color: #0d0c10; font: 800 16px Poppins, sans-serif; cursor: pointer; }
  .rtc-go:disabled { opacity: .6; cursor: progress; }
  .rtc-msg { min-height: 20px; margin: 10px 0 0; font-size: 13.5px; color: #c4bfca; }
  .rtc-msg[data-state=error] { color: #ff8a7a; }
  .rtc-fine { margin: 12px 0 0; color: #9d97a6; font-size: 12px; line-height: 1.5; }
  .rtc-test { margin: 0 0 12px; padding: 8px 12px; border-radius: 10px; border: 1px dashed #ffb36b; color: #ffb36b; font-size: 12.5px; }
  .rtc-done h2 { color: #7bd88f; }
  .rtc-done p { color: #c4bfca; }
  .rtc-done .rtc-go { display: block; text-align: center; text-decoration: none; line-height: 54px; }
  `;
  document.head.appendChild(s);
}

function build() {
  css();
  dlg = document.createElement('dialog');
  dlg.className = 'rtc';
  dlg.setAttribute('aria-labelledby', 'rtc-title');
  dlg.innerHTML = `
    <div class="rtc-in" id="rtc-form-view">
      <button type="button" class="rtc-x" data-rtc-close aria-label="Close">×</button>
      ${CFG.test ? '<p class="rtc-test">Test mode: Razorpay test keys, no real money. Admin accounts only.</p>' : ''}
      <p class="rtc-k">Founding seat · <span id="rtc-left">first 100</span></p>
      <h2 id="rtc-title">Your Personal Reset</h2>
      <p class="rtc-price"><b id="rtc-now">…</b><s id="rtc-was"></s></p>
      <p class="rtc-sub">Pay now, start on ${CFG.opensLabel}. 12 video modules, drills for your hijack, Journal Pro and the 1% Strategy.</p>
      <form id="rtc-form" novalidate>
        <label>Full name<input type="text" name="name" autocomplete="name" required maxlength="120"></label>
        <label>Email<input type="email" name="email" autocomplete="email" required maxlength="200"></label>
        <label>Phone (WhatsApp)<input type="tel" name="phone" autocomplete="tel" required maxlength="20" placeholder="+91 98765 43210"></label>
        <label>Create a password for the student portal<input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="128"></label>
        <label class="rtc-agree"><input type="checkbox" name="agree" required><span>I agree to the <a href="/legal.html#terms" target="_blank" rel="noopener">Terms</a>. The course opens on ${CFG.opensLabel}; if it doesn't, I get a full refund.</span></label>
        <button class="rtc-go" type="submit" id="rtc-go">Pay securely</button>
        <p class="rtc-msg" id="rtc-msg" role="status"></p>
        <p class="rtc-fine">Payments by Razorpay: UPI, cards and net banking in India, cards worldwide. Educational content only. Trading involves risk.</p>
      </form>
    </div>
    <div class="rtc-in rtc-done" id="rtc-done-view" hidden>
      <button type="button" class="rtc-x" data-rtc-close aria-label="Close">×</button>
      <p class="rtc-k">Payment received</p>
      <h2>Your seat is confirmed.</h2>
      <p>The course opens on <b>${CFG.opensLabel}</b>. Log in to the student portal with <b id="rtc-done-email"></b> and the password you just created. Razorpay emails you the receipt.</p>
      <a class="rtc-go" href="/portal.html">Go to the student portal</a>
    </div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-rtc-close]')) dlg.close(); });
  dlg.querySelector('#rtc-form').addEventListener('submit', submit);
}

function say(text, state) {
  const m = dlg.querySelector('#rtc-msg');
  m.textContent = text || '';
  m.dataset.state = state || '';
}

function paintPrice() {
  const p = info && info.prices && info.prices[PLAN[region]];
  const now = dlg.querySelector('#rtc-now'), was = dlg.querySelector('#rtc-was'), left = dlg.querySelector('#rtc-left');
  if (!p) { now.textContent = region === 'in' ? '₹19,999' : '$247'; was.textContent = region === 'in' ? '₹24,999' : '$297'; return; }
  now.textContent = fmt(p.amount, p.currency);
  was.textContent = p.tier === 'founding' ? (region === 'in' ? '₹24,999' : '$297') : '';
  left.textContent = p.tier === 'founding' ? `${info.left} of ${info.total} left` : 'standard price';
}

export async function openCheckout(opts = {}) {
  if (!dlg) build();
  region = opts.region === 'intl' ? 'intl' : opts.region === 'in' ? 'in' : regionNow();
  const f = dlg.querySelector('#rtc-form');
  if (opts.email && !f.email.value) f.email.value = opts.email;
  dlg.querySelector('#rtc-form-view').hidden = false;
  dlg.querySelector('#rtc-done-view').hidden = true;
  say('');
  paintPrice();
  dlg.showModal();
  await loadInfo();
  paintPrice();
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = ok; s.onerror = () => no(new Error('Razorpay could not load. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}

function friendly(err) {
  const code = err && err.code;
  if (code === 'auth/existing-account-password-mismatch' || code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'This email already has a Reset Traders login (portal or journal). Use that same password.';
  if (code === 'auth/weak-password') return 'Use a password with at least 8 characters.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
  if (code === 'auth/invalid-email') return 'That email doesn’t look right.';
  return (err && err.message) || 'Something went wrong. Please try again.';
}

async function submit(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const data = { name: f.name.value.trim(), email: f.email.value.trim().toLowerCase(), phone: f.phone.value.trim(), password: f.password.value };
  if (data.name.length < 2) return say('Add your full name.', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return say('Add a valid email.', 'error');
  if (data.phone.replace(/\D/g, '').length < 7) return say('Add a phone number we can reach you on.', 'error');
  if (data.password.length < 8) return say('Create a password with at least 8 characters.', 'error');
  if (!f.agree.checked) return say('Please tick the box to agree to the Terms.', 'error');
  const go = dlg.querySelector('#rtc-go');
  go.disabled = true;
  try {
    say('Creating your portal login…');
    const fb = await import(FIREBASE);
    const user = await fb.ensureBuyerAccount(data);
    say('Opening secure checkout…');
    await loadRazorpay();
    const token = await user.getIdToken(true);
    const res = await fetch(CFG.worker + '/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ plan: PLAN[region], name: data.name, email: data.email, phone: data.phone, test: CFG.test === true })
    });
    const order = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(order.error || 'Checkout could not start.');
    say('');
    const rzp = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: 'Reset Traders',
      description: 'Your Personal Reset · founding seat',
      prefill: { name: data.name, email: data.email, contact: data.phone },
      readonly: { email: true },
      theme: { color: '#1f4fd1' },
      handler: (r) => confirmPayment(user, order, r, data.email),
      modal: { ondismiss: () => { go.disabled = false; say('Payment window closed. You can try again.'); } }
    });
    rzp.on('payment.failed', (r) => { go.disabled = false; say((r && r.error && r.error.description) || 'Payment failed. Please try again.', 'error'); });
    rzp.open();
  } catch (err) {
    go.disabled = false;
    say(friendly(err), 'error');
    return;
  }
}

async function confirmPayment(user, order, r, email) {
  say('Payment received. Confirming…');
  const token = await user.getIdToken();
  let paid = false;
  try {
    const res = await fetch(CFG.worker + '/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(r)
    });
    const j = await res.json().catch(() => ({}));
    paid = res.ok && j.paid === true;
  } catch (_) {}
  for (let i = 0; !paid && i < 8; i++) {
    await new Promise((ok) => setTimeout(ok, i ? 3000 : 1200));
    try {
      const u = new URL(CFG.worker + '/payment-status');
      u.searchParams.set('orderId', order.orderId);
      u.searchParams.set('paymentId', r.razorpay_payment_id);
      const j = await (await fetch(u, { headers: { Authorization: 'Bearer ' + token } })).json();
      paid = j.paid === true;
    } catch (_) {}
  }
  if (paid) {
    dlg.querySelector('#rtc-done-email').textContent = email;
    dlg.querySelector('#rtc-form-view').hidden = true;
    dlg.querySelector('#rtc-done-view').hidden = false;
    try { localStorage.setItem('rt-reserved-reset', '1'); } catch (_) {}
  } else {
    say('We received your payment and are still confirming it. You’ll get an email shortly; you don’t need to pay again.', 'error');
  }
}

// Buttons: <button data-checkout> (optional data-region="in|intl").
if (CFG.active) {
  document.querySelectorAll('[data-checkout-hide]').forEach((el) => { el.hidden = true; });
  document.querySelectorAll('[data-checkout-show]').forEach((el) => { el.hidden = false; });
  document.querySelectorAll('[data-checkout]').forEach((b) => {
    b.hidden = false;
    b.addEventListener('click', (e) => { e.preventDefault(); openCheckout({ region: regionNow(b) }); });
  });
}
window.RTCheckout = { open: openCheckout };
