// Hand-drawn step sketches for the drill cards (Leo's notebook look).
// Input: [{ icon, text }]. Output: safe HTML (text is escaped, icons come from the fixed set below).

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

// 24x24 line icons, drawn with round strokes.
const ICONS = {
  candle: "M12 3v4M12 17v4M9 7h6v10H9z",
  clock: "M12 3a9 9 0 1 0 .01 0M12 7v5l3.5 2",
  pen: "M4 20l4.5-1L19 8.5 15.5 5 5 15.5zM13.5 7l3.5 3.5",
  stop: "M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2zM8 12h8",
  breath: "M3 9h10.5a2.8 2.8 0 1 0-2.8-2.8M3 15h14a2.8 2.8 0 1 1-2.8 2.8M3 12h7",
  stand: "M12 3.2a1.9 1.9 0 1 0 .01 0M12 7.5v7M7.5 10.5h9M9.8 21l2.2-6.5 2.2 6.5",
  eye: "M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 .01 0",
  phone: "M8 2.5h8v19H8zM11 18.5h2",
  walk: "M13.5 3.2a1.8 1.8 0 1 0 .01 0M12 8l-2.8 4.5 2.6 2-1.8 6M12 8l3.6 3 2.9-1M12.2 14.6l3 6.4",
  chart: "M4 20V4M4 20h16M7.5 15l3.8-4.2 3 3 4.7-5.8",
  scale: "M12 4v16M8 20h8M5 8h14M5 8l-3 6h6zM19 8l-3 6h6z",
  body: "M12 3.2a2 2 0 1 0 .01 0M7 9h10M12 9v6M9.5 21l2.5-6 2.5 6M8.5 9l-2 5M15.5 9l2 5",
  heart: "M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z",
  lock: "M6 11h12v9.5H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5",
  note: "M6 3h9l3 3v15H6zM15 3v3h3M9 10h6M9 13.5h6M9 17h4",
  mute: "M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 9.5l5 5M21 9.5l-5 5",
  talk: "M4 5h16v10.5H9.5L5 19.5v-4H4z",
  check: "M4.5 12.5l4.5 4.5L19.5 6.5",
  water: "M12 3s6 6.8 6 11a6 6 0 0 1-12 0c0-4.2 6-11 6-11z"
};

// Small seeded jitter so each circle wobbles like pencil, but the same way every time.
function rng(seed) { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
function roughCircle(cx, cy, r, seed) {
  const rand = rng(seed); const n = 14; const pts = [];
  const start = rand() * Math.PI * 2;
  for (let i = 0; i <= n + 1; i++) {
    const a = start + (i / n) * Math.PI * 2;
    const rr = r + (rand() - 0.5) * 2.6 + (i > n ? 2.2 : 0); // overshoot the end, like a hand-closed loop
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  return d;
}
function roughArrow(seed) {
  const rand = rng(seed); const y = 12 + (rand() - 0.5) * 3, bend = 4 + rand() * 4;
  return `M4 ${y.toFixed(1)} Q24 ${(y - bend).toFixed(1)} 42 ${(12 + (rand() - 0.5) * 2).toFixed(1)}M35 6.5L42.5 12 35 17.5`;
}

export function sketchHtml(steps, seedBase = 1) {
  const list = (Array.isArray(steps) ? steps : []).filter((s) => s && s.text).slice(0, 6);
  if (!list.length) return "";
  const label = list.map((s, i) => `${i + 1}. ${s.text}`).join(" ");
  const parts = [];
  list.forEach((s, i) => {
    const icon = ICONS[s.icon] || ICONS.check;
    parts.push(`<div class="sk-step">
      <svg class="sk-ring" viewBox="0 0 72 72" aria-hidden="true">
        <path class="sk-circle" d="${roughCircle(36, 36, 27, seedBase * 31 + i * 7)}"/>
        <g transform="translate(22 22) scale(1.17)"><path class="sk-icon" d="${icon}"/></g>
      </svg>
      <span class="sk-n">${i + 1}</span>
      <span class="sk-t">${esc(s.text)}</span>
    </div>`);
    if (i < list.length - 1) parts.push(`<svg class="sk-arrow" viewBox="0 0 48 24" aria-hidden="true"><path d="${roughArrow(seedBase * 13 + i)}"/></svg>`);
  });
  return `<figure class="sketch" role="img" aria-label="The drill, step by step: ${esc(label)}">
    <figcaption class="sk-k">The drill, step by step</figcaption>
    <div class="sk-steps">${parts.join("")}</div>
  </figure>`;
}
