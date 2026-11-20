// Contact form -> audit-lead Worker /contact -> Brevo -> the Reset Traders inbox (Reply-To: the visitor).
(() => {
  const WORKER = 'https://audit-lead.resettradersofficial.workers.dev/contact';
  const SITEKEY = '0x4AAAAAAGGh2CBT5c2hECQv';
  const form = document.getElementById('contact-form');
  const msg = document.getElementById('contact-msg');
  const send = document.getElementById('contact-send');
  const box = document.getElementById('contact-check');
  if (!form) return;

  let token = '';
  const waiters = [];
  window.rtContactTurnstile = () => {
    try {
      window.turnstile.render(box, {
        sitekey: SITEKEY,
        action: 'contact',
        appearance: 'interaction-only',
        callback: (t) => { token = t; waiters.splice(0).forEach((done) => done(t)); },
        'expired-callback': () => { token = ''; },
        'error-callback': () => { token = ''; }
      });
    } catch (_) {}
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=rtContactTurnstile';
  s.async = true;
  document.head.appendChild(s);
  const getToken = (ms) => token ? Promise.resolve(token) : new Promise((r) => { waiters.push(r); setTimeout(() => r(token), ms); });

  const say = (text, state) => { msg.textContent = text; msg.dataset.state = state || ''; };
  const EMAIL_RE = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]{2,}$/;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = {
      name: String(f.get('name') || '').trim(),
      email: String(f.get('email') || '').trim(),
      topic: String(f.get('topic') || 'general'),
      message: String(f.get('message') || '').trim()
    };
    if (f.get('website')) body.website = String(f.get('website'));
    if (!body.name) return say('Please add your name.', 'error');
    if (!EMAIL_RE.test(body.email.toLowerCase())) return say('Please check your email address.', 'error');
    if (body.message.length < 10) return say('Please write a little more (at least 10 characters).', 'error');

    send.disabled = true;
    say('Sending…');
    try {
      body.turnstile = await getToken(6000);
      const res = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn\'t send right now.');
      form.reset();
      say('Sent. We\'ll reply to ' + body.email + ', usually within a day.', 'ok');
    } catch (err) {
      say((err && err.message) || 'Couldn\'t send right now. Email resettradersofficial@gmail.com instead.', 'error');
    } finally {
      token = '';
      try { if (window.turnstile) window.turnstile.reset(box); } catch (_) {}
      send.disabled = false;
    }
  });
})();
