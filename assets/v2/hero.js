// Reset Traders v2 hero: entrance, Tilt's reaction to the audit button, Leo's first note,
// the four hijacks sliding out on scroll, and the 3D Tilt (loaded after the page shows).
const $ = (s) => document.querySelector(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Leo's note: first visit only (add ?leo=1 to see it again) ---------- */
const note = $('#leo-note');
try {
  const forced = new URLSearchParams(location.search).has('leo');
  if (localStorage.getItem('rt-leo-hero') && !forced) {
    note.hidden = true;
    document.querySelectorAll('[data-leo]').forEach((n) => { n.hidden = true; });
  }
  else localStorage.setItem('rt-leo-hero', '1');
} catch (_) { /* private mode: show it */ }
$('#leo-x')?.addEventListener('click', () => { note.hidden = true; });

/* ---------- Nav line once the page moves ---------- */
const nav = $('#nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- Tilt fears the audit button ---------- */
const bubble = $('#bubble');
const bubbleText = $('#bubble-text');
const LINES = { idle: "Just one more trade. You'll win it back.", fear: "Don't click that. It'll find me." };
let tilt3d = null;
let scared = 0;
function scare(on) {
  scared = Math.max(0, scared + (on ? 1 : -1));
  const isScared = scared > 0;
  bubble.classList.toggle('alarm', isScared);
  bubbleText.textContent = isScared ? LINES.fear : (whisper >= 0 ? WHISPERS[whisper][1] : LINES.idle);
  tilt3d?.flinch(isScared);
}
document.querySelectorAll('[data-scare]').forEach((el) => {
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') scare(true); });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') scare(false); });
  el.addEventListener('focus', () => scare(true));
  el.addEventListener('blur', () => scare(false));
});

/* ---------- Tap Tilt: he whispers each hijack's urge, and that hijack lights up ---------- */
// Works the same with a mouse, a finger or the keyboard, so phones get a reaction too.
const WHISPERS = [
  ['rusher', "Quick, get back in. You're missing it."],
  ['performer', 'Post the win. Let them see it.'],
  ['competitor', 'They made more than you. Size up.'],
  ['intellectualizer', 'Check one more timeframe first.']
];
let whisper = -1;
let callTimer = 0;
const tiltEl = $('#tilt');
function whisperNext() {
  if (scared) return;
  whisper = (whisper + 1) % WHISPERS.length;
  const [kind, line] = WHISPERS[whisper];
  bubbleText.textContent = line;
  document.querySelectorAll('.sil').forEach((s) => s.classList.toggle('called', s.dataset.hijack === kind));
  tilt3d?.hop();
  $('#tap-hint')?.remove();
  clearTimeout(callTimer);
  callTimer = setTimeout(() => document.querySelectorAll('.sil.called').forEach((s) => s.classList.remove('called')), 2200);
}
tiltEl.addEventListener('click', whisperNext);
tiltEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); whisperNext(); }
});

/* ---------- Entrance and scroll (GSAP) ---------- */
function motion() {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  // Phones: ignore the address bar showing and hiding, and follow the finger more closely.
  ScrollTrigger.config({ ignoreMobileResize: true });
  const touch = matchMedia('(pointer: coarse)').matches;
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from('[data-in]', { y: 26, opacity: 0, duration: 0.8, stagger: 0.08 })
      .from('.sil', { y: 40, opacity: 0, duration: 1.1, stagger: 0.09 }, 0.15)
      .from('#tilt', { y: 30, opacity: 0, duration: 0.9 }, 0.25)
      .from('#bubble', { scale: 0.5, opacity: 0, transformOrigin: '0% 100%', duration: 0.55, ease: 'back.out(2.2)' }, 1.15)
      .from('#leo-note', { y: 18, rotation: -9, opacity: 0, duration: 0.6 }, 1.45);

    // As the hero scrolls away, the four hijacks step out from behind Tilt.
    const span = { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: touch ? 0.3 : 0.6 };
    gsap.utils.toArray('.sil').forEach((el) => {
      const side = Number(el.dataset.side);
      const far = el.hasAttribute('data-far');
      gsap.to(el, { xPercent: side * (far ? 55 : 120), yPercent: far ? 6 : 34, scale: 1.12, ease: 'none', scrollTrigger: span });
      gsap.to(el.querySelector('.sil-name'), { opacity: 1, ease: 'none', scrollTrigger: { ...span, end: '45% top' } });
    });
    gsap.to('#tilt', { yPercent: -8, scale: 0.86, ease: 'none', scrollTrigger: span });
    gsap.to('#talk', { y: -24, autoAlpha: 0, ease: 'none', scrollTrigger: { ...span, end: '30% top' } });
  });
}
if (window.gsap) motion();
else addEventListener('load', motion, { once: true });

/* ---------- Hijack profile: opens from a silhouette or a card ---------- */
// Same words as the audit, so the site and the result agree. Process only, no trade calls.
const PROFILES = {
  rusher: {
    kicker: 'Hijack 01 · Rohan', name: 'The Rusher', line: 'You trade the clock, not the chart.',
    desc: 'You enter before the candle closes, then tell yourself it was a read. After a loss, your next trade comes faster than your first one did. Sitting flat feels like money leaving.',
    fear: 'Underneath it is fear of falling behind. Rohan knows this one: his story starts in Two Traders, Episode 1.',
    img: 'assets/characters/rohan.webp', alt: 'Rohan, the Rusher', model: 'assets/3d/rohan.glb'
  },
  performer: {
    kicker: 'Hijack 02 · Kabir', name: 'The Performer', line: 'You trade to be seen winning.',
    desc: 'You size up when someone is watching, even if it\'s just your group chat. A red day feels like a public failure, even when nobody knows. Wins get screenshotted. Losses get deleted.',
    fear: 'Underneath it is fear of being seen failing. Kabir knows this one: the payout screenshot everyone saw, in Two Traders, Episode 8.',
    img: 'assets/characters/kabir.webp', alt: 'Kabir, the Performer', model: 'assets/3d/kabir.glb'
  },
  competitor: {
    kicker: 'Hijack 03 · Arjun', name: 'The Competitor', line: 'You keep score. Against the market, and everyone else.',
    desc: 'After a loss you have to win it back, and it has to be now. You add size, switch instruments or open another account to prove a point. Someone else\'s payout can ruin your whole day.',
    fear: 'Underneath it is fear of losing. Arjun walks into Two Traders soon.',
    img: 'assets/characters/competitor.webp', alt: 'Arjun, the Competitor', model: 'assets/3d/competitor.glb'
  },
  intellectualizer: {
    kicker: 'Hijack 04 · Meera', name: 'The Intellectualizer', line: 'You know everything. You execute nothing.',
    desc: 'You check one more timeframe and miss the entry, then chase it. After every loss you re-backtest the whole strategy. You can explain your rules better than you follow them.',
    fear: 'Underneath it is fear of being wrong. Meera joins Two Traders soon.',
    img: 'assets/characters/intellectualizer.webp', alt: 'Meera, the Intellectualizer', model: 'assets/3d/intellectualizer.glb'
  }
};
const dlg = $('#profile');
const visual = $('#pf-visual');
const pfImg = $('#pf-img');
let avatar = null;
let opener = null;
function openProfile(kind, from) {
  const p = PROFILES[kind];
  if (!p || !dlg) return;
  opener = from || null;
  $('#pf-kicker').textContent = p.kicker;
  $('#pf-title').textContent = p.name;
  $('#pf-line').textContent = p.line;
  $('#pf-desc').textContent = p.desc;
  $('#pf-fear').textContent = p.fear;
  pfImg.src = p.img;
  pfImg.alt = p.soon ? '' : p.alt;
  visual.classList.toggle('soon', Boolean(p.soon));
  visual.classList.remove('gl-on');
  $('#pf-badge').hidden = !p.soon;
  $('#pf-drag').hidden = true;
  document.body.classList.add('modal-open');
  dlg.showModal();
  if (p.model) {
    import('./avatar3d.js')
      .then((m) => m.mountAvatar({ canvas: $('#pf-gl'), url: p.model, reduce, onReady: () => { visual.classList.add('gl-on'); $('#pf-drag').hidden = false; } }))
      .then((a) => { if (dlg.open) avatar = a; else a.dispose(); })
      .catch((error) => console.warn('[hero] 3D avatar unavailable, keeping the picture:', error && error.message ? error.message : error));
  }
}
function closeProfile() { if (dlg?.open) dlg.close(); }
dlg?.addEventListener('close', () => {
  avatar?.dispose();
  avatar = null;
  visual.classList.remove('gl-on');
  document.body.classList.remove('modal-open');
  opener?.focus();
});
dlg?.addEventListener('click', (e) => {
  if (e.target === dlg || e.target.closest('[data-close]')) closeProfile();
});
document.querySelectorAll('[data-hijack]').forEach((el) => {
  el.addEventListener('click', () => openProfile(el.dataset.hijack, el));
});
// Shareable link, e.g. resettraders.com/#meet-rusher (useful from an Instagram bio or story).
const meet = location.hash.match(/^#meet-([a-z]+)$/);
if (meet && PROFILES[meet[1]]) openProfile(meet[1]);

/* ---------- Intro film: poster first, plays only on tap, captions on ---------- */
// When the film exists: src = 'assets/video/intro.mp4', captions = 'assets/video/intro.vtt',
// length = '1:30', shape = 'wide' (16:9) or 'tall' (a 9:16 reel).
const INTRO = { src: '', captions: '', length: '1:30', shape: 'wide' };
const film = $('#film');
if (film) {
  if (INTRO.shape === 'tall') film.dataset.shape = 'tall';
  if (INTRO.src) {
    film.dataset.state = 'ready';
    $('#film-soon').hidden = true;
    $('#film-play').hidden = false;
    $('#film-time').textContent = INTRO.length;
    $('#film-play').addEventListener('click', () => {
      const video = document.createElement('video');
      video.src = INTRO.src;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('controlslist', 'nodownload');
      if (INTRO.captions) {
        const track = document.createElement('track');
        Object.assign(track, { kind: 'captions', srclang: 'en', label: 'English', src: INTRO.captions, default: true });
        video.appendChild(track);
      }
      film.appendChild(video);
      film.dataset.state = 'playing';
      video.play().catch(() => { /* the visitor can press play on the controls */ });
      video.focus();
    }, { once: true });
  }
}

/* ---------- India / international prices ---------- */
function setRegion(region) {
  if (region !== 'in' && region !== 'intl') return;
  document.documentElement.dataset.region = region;
  try { localStorage.setItem('rt-region', region); } catch (_) { /* private mode */ }
}
document.querySelectorAll('[data-region-toggle]').forEach((b) => b.addEventListener('click', () => {
  setRegion(document.documentElement.dataset.region === 'intl' ? 'in' : 'intl');
}));

/* ---------- Elite application ---------- */
// To collect applications in a Google Sheet: make a Google Form with these questions, then paste
// its ".../formResponse" URL and each question's "entry.123..." ID here. Until then it opens an email.
const ELITE_FORM = {
  action: '',
  entries: { name: '', email: '', phone: '', market: '', experience: '', hijack: '', problem: '', why: '' }
};
const CONTACT_EMAIL = 'resettradersofficial@gmail.com';
const applyDlg = $('#apply');
const applyForm = $('#apply-form');
const applyMsg = $('#apply-msg');
function say(text, state) { applyMsg.textContent = text; applyMsg.dataset.state = state; }
function openApply(e) {
  if (e) e.preventDefault();
  if (!applyDlg) return;
  document.body.classList.add('modal-open');
  applyDlg.showModal();
}
applyDlg?.addEventListener('close', () => document.body.classList.remove('modal-open'));
applyDlg?.addEventListener('click', (e) => { if (e.target === applyDlg || e.target.closest('[data-close]')) applyDlg.close(); });
document.querySelectorAll('[data-apply]').forEach((el) => el.addEventListener('click', openApply));
if (location.hash === '#apply') openApply();
applyForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {};
  for (const [k, v] of new FormData(applyForm).entries()) data[k] = String(v || '').trim().slice(0, 2000);
  if (!data.name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email || '') || (data.problem || '').length < 10) {
    say('Add your name, a valid email, and a line or two on what keeps going wrong.', 'error');
    return;
  }
  const button = applyForm.querySelector('button[type="submit"]');
  button.disabled = true;
  if (ELITE_FORM.action && ELITE_FORM.entries.email) {
    const body = new FormData();
    Object.entries(ELITE_FORM.entries).forEach(([k, id]) => { if (id) body.append(id, data[k] || ''); });
    try {
      await fetch(ELITE_FORM.action, { method: 'POST', mode: 'no-cors', body });
      applyForm.reset();
      say("Application sent. We read every one. If it's a fit, you'll get a message to book a call.", 'ok');
    } catch (_) {
      say('That didn\'t go through. Email ' + CONTACT_EMAIL + ' instead.', 'error');
    }
    button.disabled = false;
    return;
  }
  const lines = ['Name: ' + data.name, 'Email: ' + data.email, 'WhatsApp / phone: ' + (data.phone || '-'), 'Where I trade: ' + data.market, 'Experience: ' + data.experience, 'Audit result: ' + data.hijack, '', 'What keeps going wrong:', data.problem, '', 'Why now:', data.why || '-'];
  window.location.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent('Elite application: ' + data.name) + '&body=' + encodeURIComponent(lines.join('\n'));
  say("Your email app should open with the application filled in. Send it and you're done.", 'ok');
  button.disabled = false;
});

/* ---------- 3D Tilt: only where it will run well ---------- */
const conn = navigator.connection;
const saveData = Boolean(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));
const lowMemory = Boolean(navigator.deviceMemory && navigator.deviceMemory < 3);
function start3d() {
  import('./tilt3d.js')
    .then((m) => m.mountTilt({ canvas: $('#tilt-gl'), box: $('#tilt'), reduce }))
    .then((api) => { tilt3d = api; if (scared) api.flinch(true); })
    .catch((error) => console.warn('[hero] 3D Tilt unavailable, keeping the picture:', error && error.message ? error.message : error));
}
if (!saveData && !lowMemory) {
  if ('requestIdleCallback' in window) requestIdleCallback(start3d, { timeout: 1500 });
  else setTimeout(start3d, 600);
}
