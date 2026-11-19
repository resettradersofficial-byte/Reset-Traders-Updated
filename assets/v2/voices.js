// Student videos in the Elite section: silent preview loops while on screen, full video with sound on tap.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wall = document.getElementById('voices');
const dlg = document.getElementById('voice-dlg');

if (wall && dlg) {
  const cards = [...wall.querySelectorAll('.voice')];
  const loops = cards.map((c) => c.querySelector('.voice-loop'));

  // Play the short silent loops only while the row is on screen (and not with reduced motion).
  if (!reduce && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      loops.forEach((v) => {
        if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
      });
    }, { threshold: 0.2 }).observe(wall.querySelector('.voices-row'));
  }

  // Motion: the cards fan in as the row scrolls into view, then drift slightly with the scroll.
  if (!reduce && window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    gsap.from(cards, {
      y: 120, opacity: 0, rotate: (i) => (i % 2 ? 14 : -14), scale: 0.86,
      duration: 0.9, ease: 'back.out(1.5)', stagger: 0.12,
      scrollTrigger: { trigger: wall, start: 'top 78%', once: true }
    });
    gsap.from(wall.querySelectorAll('.voices-head > *'), {
      y: 24, opacity: 0, duration: 0.7, ease: 'power2.out', stagger: 0.08,
      scrollTrigger: { trigger: wall, start: 'top 85%', once: true }
    });
    cards.forEach((c, i) => gsap.to(c, {
      yPercent: i % 2 ? -6 : 6, ease: 'none',
      scrollTrigger: { trigger: wall, start: 'top bottom', end: 'bottom top', scrub: true }
    }));
  }

  // Full video with sound in a dialog.
  const player = dlg.querySelector('video');
  const open = (btn) => {
    loops.forEach((v) => v.pause());
    player.poster = btn.dataset.poster;
    player.src = btn.dataset.src;
    document.body.classList.add('modal-open');
    dlg.showModal();
    player.play().catch(() => {});
  };
  const close = () => {
    player.pause();
    player.removeAttribute('src');
    player.load();
    document.body.classList.remove('modal-open');
  };
  wall.querySelectorAll('.voice-hit').forEach((b) => b.addEventListener('click', () => open(b)));
  dlg.addEventListener('close', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
}
