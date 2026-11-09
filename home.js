// Website v2 homepage: region switch, reveal-on-scroll, nav state, tilt cards,
// the phone mock, the mobile sticky CTA, the Elite application, and the lazy 3D scene.
// The portal, admin and checkout keep living in app.js / portal.js / admin.js / payment.js.

const site = document.getElementById('main-site');
const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------- India / international ---------- */
const REGION_KEY = 'rt-region';
function setRegion(region, remember) {
  if (region !== 'in' && region !== 'intl') return;
  root.dataset.region = region;
  document.querySelectorAll('[data-set-region]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.setRegion === region));
  });
  if (remember) {
    try { localStorage.setItem(REGION_KEY, region); } catch (_) { /* private mode */ }
  }
  window.dispatchEvent(new CustomEvent('rt:region', { detail: region }));
}
document.addEventListener('click', (event) => {
  const choice = event.target.closest('[data-set-region]');
  if (choice) { setRegion(choice.dataset.setRegion, true); return; }
  if (event.target.closest('[data-region-toggle]')) setRegion(root.dataset.region === 'intl' ? 'in' : 'intl', true);
});
setRegion(root.dataset.region === 'in' ? 'in' : 'intl', false);

/* ---------- Reveal on scroll ---------- */
const reveals = [...site.querySelectorAll('.rv')];
if (reduceMotion || !('IntersectionObserver' in window)) {
  reveals.forEach((el) => el.classList.add('in'));
} else {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  reveals.forEach((el) => io.observe(el));
}

/* ---------- Nav, sticky CTA, phone ---------- */
const nav = document.getElementById('v2-nav');
const sticky = document.getElementById('v2-sticky');
const hero = document.getElementById('hero');
const finale = document.getElementById('start');
const phone = document.getElementById('v2-phone');
let ticking = false;

function update() {
  ticking = false;
  const onHome = site.classList.contains('active');
  const vh = window.innerHeight;
  nav?.classList.toggle('scrolled', window.scrollY > 12);
  const heroBottom = hero ? hero.getBoundingClientRect().bottom : 0;
  const finaleTop = finale ? finale.getBoundingClientRect().top : Infinity;
  const showSticky = onHome && heroBottom < vh * 0.3 && finaleTop > vh * 0.85;
  sticky?.classList.toggle('on', showSticky);
  document.body.classList.toggle('v2-sticky-on', showSticky);
  if (phone && !reduceMotion) {
    const r = phone.getBoundingClientRect();
    if (r.bottom > 0 && r.top < vh) {
      const c = Math.max(-0.7, Math.min(0.7, (r.top + r.height / 2) / vh - 0.5));
      phone.style.setProperty('--ry', `${(-c * 36).toFixed(2)}deg`);
      phone.style.setProperty('--rx', `${(8 + c * 8).toFixed(2)}deg`);
    }
  }
}
function requestUpdate() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(update);
}
window.addEventListener('scroll', requestUpdate, { passive: true });
window.addEventListener('resize', requestUpdate);
update();

/* ---------- 3D tilt on the hijack cards (mouse only) ---------- */
if (finePointer && !reduceMotion) {
  document.querySelectorAll('[data-tilt]').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const r = card.getBoundingClientRect();
      const x = (event.clientX - r.left) / r.width;
      const y = (event.clientY - r.top) / r.height;
      card.style.setProperty('--ry', `${((x - 0.5) * 16).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${((0.5 - y) * 12).toFixed(2)}deg`);
      card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  });
}

/* ---------- Elite application ---------- */
// To collect applications in a Google Sheet: make a Google Form with these questions,
// then paste its ".../formResponse" URL and each question's "entry.123..." ID below.
// While `action` is empty, submitting opens a pre-filled email instead.
const ELITE_FORM = {
  action: '',
  entries: { name: '', email: '', phone: '', market: '', experience: '', hijack: '', problem: '', why: '' }
};
const CONTACT_EMAIL = 'resettradersofficial@gmail.com';
const eliteModal = document.getElementById('modal-elite');
const eliteForm = document.getElementById('elite-form');
const eliteMsg = document.getElementById('elite-msg');

function say(text, state) {
  if (!eliteMsg) return;
  eliteMsg.textContent = text;
  eliteMsg.dataset.state = state;
}

eliteModal?.addEventListener('click', (event) => {
  if (event.target === eliteModal) eliteModal.classList.remove('active');
});

eliteForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = {};
  for (const [key, value] of new FormData(eliteForm).entries()) data[key] = String(value || '').trim().slice(0, 2000);
  if (!data.name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email || '') || (data.problem || '').length < 10) {
    say('Please add your name, a valid email, and a line or two on what keeps going wrong.', 'error');
    return;
  }
  const button = eliteForm.querySelector('button[type="submit"]');
  button.disabled = true;

  if (ELITE_FORM.action && ELITE_FORM.entries.email) {
    const body = new FormData();
    Object.entries(ELITE_FORM.entries).forEach(([key, id]) => { if (id) body.append(id, data[key] || ''); });
    try {
      await fetch(ELITE_FORM.action, { method: 'POST', mode: 'no-cors', body });
      eliteForm.reset();
      say("Application sent. We read every one. If it's a fit, you'll get a message to book a call.", 'ok');
    } catch (_) {
      say(`That didn't go through. Please email ${CONTACT_EMAIL} instead.`, 'error');
    }
    button.disabled = false;
    return;
  }

  const lines = [
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `WhatsApp / phone: ${data.phone || '-'}`,
    `Where I trade: ${data.market}`,
    `Experience: ${data.experience}`,
    `Audit result: ${data.hijack}`,
    '',
    'What keeps going wrong:',
    data.problem,
    '',
    'Why now:',
    data.why || '-'
  ];
  window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Elite application: ${data.name}`)}&body=${encodeURIComponent(lines.join('\n'))}`;
  say("Your email app should open with the application filled in. Hit send and you're done.", 'ok');
  button.disabled = false;
});

if (window.location.hash === '#apply') eliteModal?.classList.add('active');

/* ---------- 3D backdrop (loaded after first paint) ---------- */
function startScene() {
  const canvas = document.getElementById('v2-gl');
  if (!canvas) return;
  import('./scene3d.js?v=20261110-v2')
    .then((module) => module.initScene({ canvas, site, reduceMotion }))
    .catch((error) => {
      console.warn('[v2] 3D scene unavailable:', error && error.message ? error.message : error);
      site.classList.add('no-gl');
    });
}
const saveData = Boolean(navigator.connection && navigator.connection.saveData);
if (saveData) {
  site.classList.add('no-gl');
} else if ('requestIdleCallback' in window) {
  requestIdleCallback(startScene, { timeout: 1200 });
} else {
  setTimeout(startScene, 300);
}
