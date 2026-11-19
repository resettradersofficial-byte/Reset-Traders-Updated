// Student videos in the Elite section: silent preview loops while on screen, full video with sound on tap.
// Motion is tied to the scroll only: the cards rise at slightly different speeds and straighten as
// the row passes through the screen. Nothing animates on its own.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wall = document.getElementById('voices');
const dlg = document.getElementById('voice-dlg');

if (wall && dlg) {
  const row = wall.querySelector('.voices-row');
  const cards = [...wall.querySelectorAll('.voice')];
  const loops = cards.map((c) => c.querySelector('.voice-loop'));

  // Play the short silent loops only while the row is on screen (and not with reduced motion).
  if (!reduce && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      loops.forEach((v) => {
        if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
      });
    }, { threshold: 0.2 }).observe(row);
  }

  if (!reduce && window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();
    // Wide screens: the four cards sit in a row, each with its own scroll speed and tilt.
    mm.add('(min-width: 900px)', () => {
      const speed = [70, 30, 90, 45];
      const tilt = [-6, 3, -3, 5];
      cards.forEach((c, i) => {
        gsap.fromTo(c, { y: speed[i], rotate: tilt[i] }, {
          y: -speed[i] * 0.6, rotate: 0, ease: 'none',
          scrollTrigger: { trigger: row, start: 'top bottom', end: 'bottom 35%', scrub: 0.6 }
        });
      });
    });
    // Phones: the row is swiped sideways; scrolling down only lifts it slightly.
    mm.add('(max-width: 899px)', () => {
      gsap.fromTo(row, { y: 40 }, {
        y: -10, ease: 'none',
        scrollTrigger: { trigger: row, start: 'top bottom', end: 'bottom 40%', scrub: 0.6 }
      });
    });
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
    loops.forEach((v) => { if (v.preload === 'auto') v.play().catch(() => {}); });
  };
  wall.querySelectorAll('.voice-hit').forEach((b) => b.addEventListener('click', () => open(b)));
  dlg.addEventListener('close', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
}
