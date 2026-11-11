// Reset Traders v2 hero: entrance, Tilt's reaction to the audit button, Leo's first note,
// the four hijacks sliding out on scroll, and the 3D Tilt (loaded after the page shows).
const $ = (s) => document.querySelector(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Leo's note: first visit only (add ?leo=1 to see it again) ---------- */
const note = $('#leo-note');
try {
  const forced = new URLSearchParams(location.search).has('leo');
  if (localStorage.getItem('rt-leo-hero') && !forced) note.hidden = true;
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
  bubbleText.textContent = isScared ? LINES.fear : LINES.idle;
  tilt3d?.flinch(isScared);
}
document.querySelectorAll('[data-scare]').forEach((el) => {
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') scare(true); });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') scare(false); });
  el.addEventListener('focus', () => scare(true));
  el.addEventListener('blur', () => scare(false));
});

/* ---------- Entrance and scroll (GSAP) ---------- */
function motion() {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from('[data-in]', { y: 26, opacity: 0, duration: 0.8, stagger: 0.08 })
      .from('.sil', { y: 40, opacity: 0, duration: 1.1, stagger: 0.09 }, 0.15)
      .from('#tilt', { y: 30, opacity: 0, duration: 0.9 }, 0.25)
      .from('#bubble', { scale: 0.5, opacity: 0, transformOrigin: '0% 100%', duration: 0.55, ease: 'back.out(2.2)' }, 1.15)
      .from('#leo-note', { y: 18, rotation: -9, opacity: 0, duration: 0.6 }, 1.45);

    // As the hero scrolls away, the four hijacks step out from behind Tilt.
    const span = { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: 0.6 };
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
