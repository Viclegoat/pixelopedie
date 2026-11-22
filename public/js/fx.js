// Effets visuels des combats.
// Chaque attaque a sa propre animation (flammes, vague, éclair, ballon, notes de musique,
// bulles de discours…), choisie d'après son nom et son type. Tout est dessiné sur un calque
// basse résolution agrandi sans lissage : les effets restent en vrai pixel art.
import { TYPES } from '/shared/types.js';
import { shade } from './sprite.js';

const PX = 3; // 1 pixel du calque = 3 pixels à l'écran

// ---------- Outils ----------
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed | 0 || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeIn = t => t * t;
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const phase = (t, a, b) => clamp01((t - a) / (b - a));
const pick = P => (P.glyphs.length ? P.glyphs[Math.floor(P.rand() * P.glyphs.length)] : null);
const alpha = (g, a) => { g.globalAlpha = clamp01(a); };

// ---------- Dessin en pixels ----------
function rect(g, x, y, w, h, c) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}
function frame(g, x, y, w, h, c) { rect(g, x, y, w, 1, c); rect(g, x, y + h - 1, w, 1, c); rect(g, x, y, 1, h, c); rect(g, x + w - 1, y, 1, h, c); }
function disc(g, x, y, r, c) {
  if (r <= 0) return;
  g.fillStyle = c;
  const R = Math.ceil(r), cx = Math.round(x), cy = Math.round(y);
  for (let dy = -R; dy <= R; dy++) {
    const q = r * r - dy * dy;
    if (q < 0) continue;
    const w = Math.floor(Math.sqrt(q));
    g.fillRect(cx - w, cy + dy, 2 * w + 1, 1);
  }
}
function ring(g, x, y, r, c, th = 1, sy = 1) {
  if (r <= 0) return;
  g.fillStyle = c;
  const n = Math.max(12, Math.round(r * 6));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    g.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * sy), th, th);
  }
}
function line(g, x0, y0, x1, y1, c, w = 1) {
  g.fillStyle = c;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const o = Math.floor(w / 2);
  for (let k = 0; k <= n; k++) { const t = k / n; g.fillRect(Math.round(lerp(x0, x1, t)) - o, Math.round(lerp(y0, y1, t)) - o, w, w); }
}
function poly(g, pts, c, w) { for (let i = 1; i < pts.length; i++) line(g, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c, w); }
function star(g, x, y, r, c) {
  line(g, x - r, y, x + r, y, c); line(g, x, y - r, x, y + r, c);
  if (r > 2) { const q = Math.round(r * 0.55); line(g, x - q, y - q, x + q, y + q, c); line(g, x - q, y + q, x + q, y - q, c); }
}
function plus(g, x, y, c, edge) { rect(g, x - 2, y - 4, 4, 8, edge); rect(g, x - 4, y - 2, 8, 4, edge); rect(g, x - 1, y - 3, 2, 6, c); rect(g, x - 3, y - 1, 6, 2, c); }
function arrow(g, x, y, up, c, edge) {
  const draw = (ox, oy, col) => {
    g.fillStyle = col;
    for (let k = 0; k < 4; k++) g.fillRect(Math.round(x + ox - k), Math.round(y + oy + (up ? k : 8 - k)), 2 * k + 1, 1);
    g.fillRect(Math.round(x + ox - 1), Math.round(y + oy + (up ? 4 : 0)), 3, 5);
  };
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) draw(ox, oy, edge);
  draw(0, 0, c);
}
function cloud(g, x, y, w, dark, light) {
  disc(g, x - w * 0.5, y + 2, w * 0.38, dark); disc(g, x + w * 0.5, y + 2, w * 0.36, dark); disc(g, x, y, w * 0.5, dark);
  disc(g, x - w * 0.15, y - 2, w * 0.35, light); disc(g, x + w * 0.3, y, w * 0.25, light);
}
function rock(g, x, y, r) { disc(g, x, y, r + 1, '#3a3028'); disc(g, x, y, r, '#7d6e5d'); disc(g, x - r * 0.3, y - r * 0.3, r * 0.45, '#a39380'); }
function snowflake(g, x, y, r, c) { star(g, x, y, r, c); rect(g, x - r, y - 1, 1, 3, c); rect(g, x + r, y - 1, 1, 3, c); rect(g, x - 1, y - r, 3, 1, c); rect(g, x - 1, y + r, 3, 1, c); }
function sheet(g, x, y, wide) {
  const w = wide ? 6 : 3, h = 7;
  rect(g, x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2, '#231b33');
  rect(g, x - w / 2, y - h / 2, w, h, '#fdf8ec');
  if (wide) for (const dy of [-2, 0, 2]) rect(g, x - w / 2 + 1, y + dy, w - (dy === 2 ? 3 : 2), 1, '#9aa0b8');
}
const STAR5 = ['00100', '00100', '11111', '01110', '01010'];
function bigStar(g, x, y, c, edge) {
  for (const [ox, oy, col] of [[-1, 0, edge], [1, 0, edge], [0, -1, edge], [0, 1, edge], [0, 0, c]]) {
    g.fillStyle = col;
    STAR5.forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') g.fillRect(Math.round(x - 2 + i + ox), Math.round(y - 2 + j + oy), 1, 1); }));
  }
}

// Emojis réduits à quelques pixels (mis en cache).
const glyphCache = new Map();
function glyphCanvas(ch, size) {
  const key = ch + '|' + size;
  let c = glyphCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = size + 4;
    const gg = c.getContext('2d');
    gg.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    gg.textAlign = 'center';
    gg.textBaseline = 'middle';
    gg.fillText(ch, (size + 4) / 2, (size + 4) / 2 + 1);
    glyphCache.set(key, c);
  }
  return c;
}
function glyph(g, ch, x, y, size, { rot = 0, a = 1, flip = false } = {}) {
  if (!ch) return;
  const c = glyphCanvas(ch, size);
  g.save();
  g.globalAlpha *= clamp01(a);
  g.translate(Math.round(x), Math.round(y));
  if (rot) g.rotate(rot);
  if (flip) g.scale(-1, 1);
  g.drawImage(c, -c.width / 2, -c.height / 2);
  g.restore();
}

// Petite police 3×5 pour les bulles, le tampon « CENSURÉ », les 0 et 1, les symboles.
const FONT_RAW = {
  A: '010,101,111,101,101', B: '110,101,110,101,110', C: '011,100,100,100,011', D: '110,101,101,101,110',
  E: '111,100,110,100,111', F: '111,100,110,100,100', G: '011,100,101,101,011', H: '101,101,111,101,101',
  I: '111,010,010,010,111', J: '001,001,001,101,010', K: '101,101,110,101,101', L: '100,100,100,100,111',
  M: '101,111,111,101,101', N: '110,101,101,101,101', O: '010,101,101,101,010', P: '110,101,110,100,100',
  Q: '010,101,101,110,011', R: '110,101,110,101,101', S: '011,100,010,001,110', T: '111,010,010,010,010',
  U: '101,101,101,101,111', V: '101,101,101,101,010', W: '101,101,111,111,101', X: '101,101,010,101,101',
  Y: '101,101,010,010,010', Z: '111,001,010,100,111',
  0: '111,101,101,101,111', 1: '010,110,010,010,111', 2: '110,001,010,100,111', 3: '110,001,010,001,110',
  4: '101,101,111,001,001', 5: '111,100,110,001,110', 6: '011,100,111,101,111', 7: '111,001,010,010,010',
  8: '111,101,111,101,111', 9: '111,101,111,001,110',
  '!': '1,1,1,0,1', '?': '110,001,010,000,010', '#': '01010,11111,01010,11111,01010', '%': '101,001,010,100,101',
  '@': '010,101,111,100,011', '$': '011,110,010,011,110', '&': '010,101,010,101,011', '+': '000,010,111,010,000',
  '-': '000,000,111,000,000', '=': '000,111,000,111,000', '×': '000,101,010,101,000', '.': '0,0,0,0,1',
  "'": '1,1,0,0,0', ' ': '00,00,00,00,00',
  'É': '010,000,111,100,110,100,111', 'π': '11111,01010,01010,01010,01010', '∑': '111,100,010,100,111',
  '√': '0001,0001,0001,1010,0100', 'Δ': '000,010,101,101,111', '♪': '011,010,010,110,110', '♫': '01111,01001,01001,11011,11011',
};
const FONT = Object.fromEntries(Object.entries(FONT_RAW).map(([k, v]) => [k, v.split(',')]));
function pixelText(g, str, cx, cy, color, s = 1, edge = null) {
  // Le caractère tel quel d'abord : « π ».toUpperCase() donne « Π », absent de la police.
  const chars = [...String(str)].map(ch => FONT[ch] || FONT[ch.toUpperCase()] || FONT[norm(ch).toUpperCase()] || FONT['?']);
  const width = chars.reduce((w, f) => w + (f[0].length + 1) * s, -s);
  const draw = (ox, oy, col) => {
    g.fillStyle = col;
    let x = Math.round(cx - width / 2) + ox;
    for (const f of chars) {
      const top = Math.round(cy - 2.5 * s) - (f.length - 5) * s + oy;
      f.forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') g.fillRect(x + i * s, top + j * s, s, s); }));
      x += (f[0].length + 1) * s;
    }
  };
  if (edge) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) draw(ox, oy, edge);
  draw(0, 0, color);
  return width;
}

// ---------- Morceaux d'effets réutilisés ----------
function makeParts(P, n) {
  return Array.from({ length: n }, () => ({
    a: P.rand() * Math.PI * 2, v: 0.5 + P.rand() * 0.7, z: P.rand() < 0.3 ? 2 : 1,
    c: [P.c, P.l, '#ffffff'][Math.floor(P.rand() * 3)],
  }));
}
// Éclat à l'impact : flash, anneau et étincelles.
function impact(g, P, dt, parts, x = P.to.x, y = P.to.y, size = 1, life = 320) {
  if (dt < 0 || dt > life) return;
  const k = dt / life, s = P.s * size;
  alpha(g, 1 - k);
  if (dt < 70) disc(g, x, y, (4 + dt / 12) * s, '#ffffff');
  ring(g, x, y, (3 + k * 17) * s, P.l, 1);
  for (const p of parts) {
    const d = p.v * easeOut(k) * 20 * s;
    rect(g, x + Math.cos(p.a) * d, y + Math.sin(p.a) * d + k * k * 6, p.z, p.z, p.c);
  }
  alpha(g, 1);
}
function dust(g, P, dt, parts, x, y) {
  const k = dt / 380;
  if (k < 0 || k >= 1) return;
  alpha(g, 1 - k);
  for (const p of parts) {
    const d = p.v * easeOut(k) * 14 * P.s;
    disc(g, x + Math.cos(p.a) * d, y - Math.abs(Math.sin(p.a)) * d * 0.6, (1 + k * 3) * p.z, '#d9cfc0');
  }
  alpha(g, 1);
}
function zigzag(P, x0, y0, x1, y1) {
  const pts = [], n = 9;
  for (let i = 0; i <= n; i++) { const k = i / n; pts.push([lerp(x0, x1, k) + (i > 0 && i < n ? (P.rand() - 0.5) * 12 : 0), lerp(y0, y1, k)]); }
  return pts;
}
function crack(g, x, y, len, dir) {
  const r = rng(hash(`${Math.round(x)}:${dir}`));
  let cx = x, cy = y;
  for (let d = 0; d < len; d += 4) { const nx = cx + dir * 4, ny = y + (r() - 0.5) * 4; line(g, cx, cy, nx, ny, '#2b2118', 1); cx = nx; cy = ny; }
}
// Flammes qui montent (attaque de feu, brûlure de la Polémique).
function makeFlames(P, A, n, from, span) {
  return Array.from({ length: n }, () => ({ t0: from + P.rand() * span, ox: (P.rand() - 0.5) * A.r * 1.8, life: 260 + P.rand() * 160, z: 1 + Math.floor(P.rand() * 3), sway: P.rand() * 6 }));
}
function drawFlames(g, A, flames, t) {
  for (const f of flames) {
    const k = (t - f.t0) / f.life;
    if (k < 0 || k > 1) continue;
    const x = A.x + f.ox * (1 - k * 0.5) + Math.sin(k * 8 + f.sway) * 1.5, y = A.feet - k * (A.r * 2 + 6);
    const col = k < 0.2 ? '#fff6a0' : k < 0.45 ? '#ffd23f' : k < 0.7 ? '#ff8a1f' : k < 0.88 ? '#e5402a' : '#5a5050';
    const z = Math.max(1, Math.round(f.z * (1 - k * 0.6)));
    rect(g, x, y, z, z + 1, col);
  }
}
function bubble(g, word, x, y) {
  const w = word.length * 4 + 3, h = 9;
  rect(g, x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2, '#231b33');
  rect(g, x - w / 2, y - h / 2, w, h, '#ffffff');
  rect(g, x - 2, y + h / 2, 3, 2, '#231b33'); rect(g, x - 1, y + h / 2, 1, 1, '#ffffff');
  pixelText(g, word, x, y, '#231b33');
}

// Balle de tennis dessinée à la main : selon la police d'emojis, 🎾 peut sortir rose.
function drawBall(g, ball, x, y, rot) {
  if (ball !== '🎾') return glyph(g, ball, x, y, 11, { rot });
  disc(g, x, y, 4.5, '#5d6b0f'); disc(g, x, y, 3.5, '#d7ea3c'); rect(g, x - 2, y - 2, 1, 1, '#f4ffb0');
  for (let a = -1.1; a <= 1.1; a += 0.25) rect(g, x + Math.cos(a + rot) * 2.2 - Math.cos(rot) * 1.5, y + Math.sin(a + rot) * 2.2 - Math.sin(rot) * 1.5, 1, 1, '#ffffff');
}

const FACES_LEFT = new Set(['🏎️', '🐎', '🚴', '🏍️', '🏃', '🚄']);

// ---------- Les attaques ----------
// Chaque modèle renvoie { dur, hit, draw(g, t) } : durée totale, instant de l'impact (en ms).
const PATTERNS = {
  // Boule d'énergie avec traînée.
  orb(P) {
    const T = 330, parts = makeParts(P, 16), arcH = 8 + P.rand() * 10;
    const pos = k => { const e = easeIn(k); return [lerp(P.from.x, P.to.x, e), lerp(P.from.y, P.to.y, e) - Math.sin(k * Math.PI) * arcH]; };
    return {
      dur: T + 360, hit: T, draw(g, t) {
        if (t < T) {
          const k = t / T;
          for (let j = 6; j >= 1; j--) { const [x, y] = pos(Math.max(0, k - j * 0.045)); alpha(g, 0.14 * (7 - j)); disc(g, x, y, (1 + (7 - j) * 0.45) * P.s, P.c); }
          alpha(g, 1);
          const [x, y] = pos(k), pulse = 1 + Math.sin(t / 30) * 0.25;
          disc(g, x, y, 4.5 * P.s * pulse, P.d); disc(g, x, y, 3.5 * P.s * pulse, P.c); disc(g, x - 1, y - 1, 1.6 * P.s, '#ffffff');
        } else impact(g, P, t - T, parts);
      },
    };
  },

  // Rafale de petits tirs.
  volley(P) {
    const N = P.big ? 7 : 5, gap = 70, fly = 230;
    const ux = P.to.x - P.from.x, uy = P.to.y - P.from.y, L = Math.hypot(ux, uy) || 1;
    const shots = Array.from({ length: N }, (_, i) => ({ t0: i * gap, ox: (P.rand() - 0.5) * P.to.r, oy: (P.rand() - 0.5) * P.to.r, gl: P.rand() < 0.4 ? pick(P) : null, parts: makeParts(P, 6) }));
    return {
      dur: (N - 1) * gap + fly + 260, hit: fly + gap, draw(g, t) {
        for (const s of shots) {
          const k = (t - s.t0) / fly;
          if (k < 0) continue;
          const tx = P.to.x + s.ox, ty = P.to.y + s.oy;
          if (k < 1) {
            const x = lerp(P.from.x, tx, k), y = lerp(P.from.y, ty, k);
            if (s.gl) glyph(g, s.gl, x, y, 9);
            else { line(g, x - (ux / L) * 8, y - (uy / L) * 8, x, y, P.l, 1); rect(g, x - 1, y - 1, 2, 2, '#ffffff'); }
          } else impact(g, P, t - s.t0 - fly, s.parts, tx, ty, 0.5, 200);
        }
      },
    };
  },

  // Rayon continu.
  beam(P) {
    const parts = makeParts(P, 14);
    return {
      dur: 720, hit: 170, draw(g, t) {
        const grow = easeOut(phase(t, 0, 140)), fade = 1 - phase(t, 520, 720);
        if (fade <= 0) return;
        const ex = lerp(P.from.x, P.to.x, grow), ey = lerp(P.from.y, P.to.y, grow);
        const w = Math.max(1, Math.round((t < 140 ? 1.5 : 3.5 + Math.sin(t / 22)) * P.s * fade));
        line(g, P.from.x, P.from.y, ex, ey, P.d, w + 2);
        line(g, P.from.x, P.from.y, ex, ey, P.c, w);
        line(g, P.from.x, P.from.y, ex, ey, '#ffffff', Math.max(1, w - 2));
        disc(g, P.from.x, P.from.y, (w + 2) * 0.8, P.l);
        if (t > 140) {
          disc(g, P.to.x, P.to.y, (4 + Math.sin(t / 18) * 1.5) * P.s * fade, P.l);
          disc(g, P.to.x, P.to.y, 2 * P.s * fade, '#ffffff');
          for (const p of parts) {
            const life = ((t - 140) / 260 + p.v) % 1, d = life * 16 * P.s;
            alpha(g, (1 - life) * fade);
            rect(g, P.to.x + Math.cos(p.a) * d, P.to.y + Math.sin(p.a) * d, p.z, p.z, p.c);
          }
          alpha(g, 1);
        }
      },
    };
  },

  // Éclairs tombant d'un nuage d'orage.
  lightning(P) {
    const bolts = [0, 1, 2].map(() => zigzag(P, P.to.x + (P.rand() - 0.5) * 16, 0, P.to.x + (P.rand() - 0.5) * 4, P.to.y));
    const parts = makeParts(P, 18), on = [[0, 90, 0], [150, 230, 1], [300, 360, 2]];
    const bolt = shade(P.c, 0.6);
    return {
      dur: 700, hit: 90, flash: { at: 0, dur: 140, color: '#ffffff', alpha: 0.3 }, draw(g, t) {
        alpha(g, 1 - phase(t, 520, 700));
        cloud(g, P.to.x, 7, 16 * P.s, '#3b3f55', '#5a5f7a');
        alpha(g, 1);
        for (const [a, b, i] of on) if (t >= a && t < b) {
          poly(g, bolts[i], '#ffe95a', 3); poly(g, bolts[i], bolt, 2); poly(g, bolts[i], '#ffffff', 1);
          disc(g, P.to.x, P.to.y, 5 * P.s, '#ffffff');
        }
        impact(g, P, t - 90, parts, P.to.x, P.to.y, 1.2, 420);
      },
    };
  },

  // Pluie de rochers (ou d'objets) qui s'écrasent sur la cible.
  meteor(P) {
    const N = P.big ? 5 : 3, gap = 120, fall = 300;
    const items = Array.from({ length: N }, (_, i) => ({ t0: i * gap, ox: (P.rand() - 0.5) * P.to.r * 1.4, sx: -P.dir * (18 + P.rand() * 18), gl: pick(P), rot: P.rand() * 6, dust: makeParts(P, 8) }));
    return {
      dur: (N - 1) * gap + fall + 380, hit: fall, shake: true, draw(g, t) {
        for (const it of items) {
          const k = (t - it.t0) / fall;
          if (k < 0) continue;
          const tx = P.to.x + it.ox, ty = P.to.y + P.to.r * 0.4;
          if (k < 1) {
            for (let j = 1; j <= 4; j++) {
              const kk = easeIn(Math.max(0, k - j * 0.06));
              alpha(g, 0.5 - j * 0.1);
              disc(g, lerp(tx + it.sx, tx, kk), lerp(-10, ty, kk), (4 - j * 0.6) * P.s, j < 2 ? '#ffd23f' : '#ff8a1f');
            }
            alpha(g, 1);
            const e = easeIn(k), x = lerp(tx + it.sx, tx, e), y = lerp(-10, ty, e);
            if (it.gl) glyph(g, it.gl, x, y, 11, { rot: it.rot + k * 5 }); else rock(g, x, y, 4 * P.s);
          } else dust(g, P, t - it.t0 - fall, it.dust, tx, ty);
        }
      },
    };
  },

  // Coups de lame croisés.
  slash(P) {
    const N = P.big ? 4 : 3;
    const cuts = Array.from({ length: N }, (_, i) => ({ t0: i * 85, a: (i % 2 ? 0.75 : 2.4) + (P.rand() - 0.5) * 0.4, L: (P.to.r * 2.2 + 6) * P.s, ox: (P.rand() - 0.5) * 8, oy: (P.rand() - 0.5) * 8 }));
    return {
      dur: (N - 1) * 85 + 360, hit: 70, draw(g, t) {
        for (const c of cuts) {
          const k = phase(t, c.t0, c.t0 + 80), f = 1 - phase(t, c.t0 + 110, c.t0 + 300);
          if (k <= 0 || f <= 0) continue;
          const cx = P.to.x + c.ox, cy = P.to.y + c.oy, dx = (Math.cos(c.a) * c.L) / 2, dy = (Math.sin(c.a) * c.L) / 2;
          const x0 = cx - dx, y0 = cy - dy, x1 = lerp(x0, cx + dx, easeOut(k)), y1 = lerp(y0, cy + dy, easeOut(k));
          alpha(g, f);
          line(g, x0, y0, x1, y1, P.c, 4); line(g, x0, y0, x1, y1, '#ffffff', 2);
          if (k < 1) star(g, x1, y1, 3, '#ffffff');
        }
        alpha(g, 1);
      },
    };
  },

  // Onde de choc au sol, fissures et cailloux.
  quake(P) {
    const gy = P.to.feet;
    const rocks = Array.from({ length: P.big ? 10 : 7 }, () => ({ ox: (P.rand() - 0.5) * P.to.r * 2.6, v: 14 + P.rand() * 16, z: 1 + Math.floor(P.rand() * 3), t0: 120 + P.rand() * 160 }));
    return {
      dur: 820, hit: 170, shake: true, draw(g, t) {
        const k0 = phase(t, 0, 200);
        if (k0 < 1) { alpha(g, 1 - k0); ring(g, P.from.x, P.from.feet, 3 + k0 * 14, P.l, 1, 0.35); }
        for (let i = 0; i < 3; i++) {
          const k = phase(t, 120 + i * 90, 520 + i * 90);
          if (k <= 0 || k >= 1) continue;
          alpha(g, 1 - k);
          ring(g, P.to.x, gy, (4 + k * 28) * P.s, i % 2 ? P.c : P.l, 2, 0.32);
        }
        const kc = phase(t, 140, 320), fc = 1 - phase(t, 560, 820);
        if (kc > 0 && fc > 0) { alpha(g, fc); crack(g, P.to.x, gy, P.to.r * 1.4 * kc, 1); crack(g, P.to.x, gy, P.to.r * 1.4 * kc, -1); }
        alpha(g, 1);
        for (const r of rocks) {
          const k = (t - r.t0) / 420;
          if (k < 0 || k > 1) continue;
          rect(g, P.to.x + r.ox, gy - r.v * 4 * k * (1 - k) * P.s, r.z, r.z, k < 0.5 ? '#8a7f72' : '#5d5348');
        }
      },
    };
  },

  // Symboles qui tournoient autour de la cible avant de se refermer sur elle.
  spiral(P) {
    const N = 8, T = 560, parts = makeParts(P, 16);
    const items = Array.from({ length: N }, (_, i) => ({ a0: (i / N) * Math.PI * 2, s: P.sym.length ? P.sym[i % P.sym.length] : null, gl: !P.sym.length && P.glyphs.length ? P.glyphs[i % P.glyphs.length] : null }));
    return {
      dur: T + 360, hit: T, draw(g, t) {
        if (t >= T) return impact(g, P, t - T, parts, P.to.x, P.to.y, 1.3);
        const kIn = easeOut(phase(t, 0, 220)), k = t / T, R = lerp(P.to.r + 12, 2, easeIn(k));
        alpha(g, 0.35 + 0.25 * Math.sin(t / 40)); ring(g, P.to.x, P.to.y, R, P.c, 1, 0.75); alpha(g, 1);
        for (const it of items) {
          const a = it.a0 + k * 7, x = lerp(P.from.x, P.to.x + Math.cos(a) * R, kIn), y = lerp(P.from.y, P.to.y + Math.sin(a) * R * 0.75, kIn);
          if (it.s) pixelText(g, it.s, x, y, P.l, 2, '#231b33');
          else if (it.gl) glyph(g, it.gl, x, y, 8);
          else disc(g, x, y, 2, P.l);
        }
      },
    };
  },

  // Averse sur la cible : gouttes, feuilles, plats…
  rain(P) {
    const N = P.big ? 24 : 16, top = P.to.y - P.to.r - 34;
    const drops = Array.from({ length: N }, () => ({ t0: P.rand() * 420, ox: (P.rand() - 0.5) * (P.to.r * 2.4 + 10), ph: P.rand() * 6, gl: pick(P) }));
    return {
      dur: 920, hit: 260, draw(g, t) {
        if (!P.glyphs.length) { alpha(g, 1 - phase(t, 650, 920)); cloud(g, P.to.x, top - 4, (P.to.r + 10) * P.s, shade(P.c, -0.35), shade(P.c, -0.1)); alpha(g, 1); }
        for (const d of drops) {
          const k = (t - d.t0) / 300;
          if (k < 0 || k > 1) continue;
          const x = P.to.x + d.ox + (d.gl ? Math.sin(k * 6 + d.ph) * 3 : 0), y = lerp(top, P.to.feet, k);
          if (d.gl) glyph(g, d.gl, x, y, 8, { rot: Math.sin(k * 8 + d.ph) * 0.5 });
          else { rect(g, x, y, 1, 3, '#7fd8ff'); rect(g, x, y + 2, 1, 1, '#ffffff'); }
        }
      },
    };
  },

  // Ballon frappé en cloche, qui rebondit sur la cible.
  bounce(P) {
    const T = 380, ball = P.ball || pick(P) || '⚽', dist = Math.hypot(P.to.x - P.from.x, P.to.y - P.from.y), H = 18 + dist * 0.18, parts = makeParts(P, 12);
    const at = k => [lerp(P.from.x, P.to.x, k), lerp(P.from.y, P.to.y, k) - Math.sin(k * Math.PI) * H];
    return {
      dur: T + 400, hit: T, draw(g, t) {
        if (t < T) {
          const k = t / T;
          for (let j = 1; j <= 3; j++) { const [x, y] = at(Math.max(0, k - j * 0.07)); alpha(g, (0.25 * (4 - j)) / 3); disc(g, x, y, 3, '#ffffff'); }
          alpha(g, 1);
          const [x, y] = at(k);
          drawBall(g, ball, x, y, k * 9 * P.dir);
        } else {
          const k = (t - T) / 400;
          alpha(g, 1 - phase(t - T, 260, 400));
          drawBall(g, ball, P.to.x - P.dir * k * 32, P.to.y - Math.sin(Math.min(1, k * 1.2) * Math.PI) * 22 + k * 12, (1 + k) * 9 * P.dir);
          alpha(g, 1);
          impact(g, P, t - T, parts, P.to.x, P.to.y, 1, 260);
        }
      },
    };
  },

  // Objet lancé en tournoyant, qui éclate en miettes.
  toss(P) {
    const T = 400, item = pick(P) || '📦', dist = Math.hypot(P.to.x - P.from.x, P.to.y - P.from.y), H = 22 + dist * 0.2;
    const crumbs = Array.from({ length: 12 }, () => ({ a: -Math.PI * P.rand(), v: 8 + P.rand() * 14, c: [P.c, P.l, P.d, '#ffffff'][Math.floor(P.rand() * 4)] }));
    return {
      dur: T + 450, hit: T, draw(g, t) {
        if (t < T) {
          const k = t / T;
          glyph(g, item, lerp(P.from.x, P.to.x, k), lerp(P.from.y, P.to.y, k) - Math.sin(k * Math.PI) * H, 12, { rot: k * 12 });
          return;
        }
        const dt = t - T, k = clamp01(dt / 450);
        if (dt < 130) glyph(g, item, P.to.x, P.to.y, 12 + Math.round(dt / 20), { a: 1 - dt / 130 });
        alpha(g, 1 - k);
        if (dt < 90) star(g, P.to.x, P.to.y, 6, '#ffffff');
        for (const c of crumbs) { const d = c.v * easeOut(k) * P.s; rect(g, P.to.x + Math.cos(c.a) * d, P.to.y + Math.sin(c.a) * d + k * k * 18, 2, 2, c.c); }
        alpha(g, 1);
      },
    };
  },

  // Lianes qui sortent du sol et enserrent la cible.
  vines(P) {
    const N = P.big ? 5 : 4, base = P.to.feet;
    const vs = Array.from({ length: N }, (_, i) => ({ x: P.to.x + (i - (N - 1) / 2) * (P.to.r * 0.55), h: (P.to.r * 1.7 + 6) * (0.75 + P.rand() * 0.35), ph: P.rand() * 6, t0: i * 50 }));
    const flower = P.glyphs.includes('🌸') ? '🌸' : P.glyphs.find(x => /🌹|🌻|🌷/.test(x)) || null;
    return {
      dur: 950, hit: 280, draw(g, t) {
        const ks = phase(t, 0, 160);
        if (ks < 1) rect(g, lerp(P.from.x, P.to.x, ks), lerp(P.from.y, base, ks) - Math.sin(ks * Math.PI) * 14, 2, 2, '#8bd17c');
        for (const v of vs) {
          const grow = easeOut(phase(t, 160 + v.t0, 420 + v.t0)) * (1 - easeIn(phase(t, 700, 950)));
          const len = v.h * grow;
          let px = v.x, py = base;
          for (let s = 1; s <= len; s++) {
            const x = v.x + Math.sin(s / 4 + v.ph + t / 120) * 2.5, y = base - s;
            rect(g, x, y, 2, 1, s % 7 < 4 ? '#2e7d32' : '#3fae49');
            if (s % 6 === 0) rect(g, x + (s % 12 ? 2 : -2), y, 2, 1, '#8bd17c');
            px = x; py = y;
          }
          if (grow > 0.9 && flower) glyph(g, flower, px, py, 7);
        }
      },
    };
  },

  // Bombe puis explosion avec fumée et débris.
  explosion(P) {
    const T = 260;
    const debris = Array.from({ length: 16 }, () => ({ a: P.rand() * Math.PI * 2, v: 10 + P.rand() * 18, z: 1 + Math.floor(P.rand() * 2) }));
    const smoke = Array.from({ length: 6 }, () => ({ ox: (P.rand() - 0.5) * 16, oy: (P.rand() - 0.5) * 10, r: 3 + P.rand() * 3 }));
    return {
      dur: T + 650, hit: T, shake: true, flash: { at: T, dur: 150, color: '#fff3c4', alpha: 0.45 }, draw(g, t) {
        if (t < T) {
          const k = t / T, x = lerp(P.from.x, P.to.x, k), y = lerp(P.from.y, P.to.y, k) - Math.sin(k * Math.PI) * 16;
          disc(g, x, y, 3 * P.s, '#222222'); rect(g, x + 1, y - 4, 1, 2, '#999999');
          if ((t / 40 | 0) % 2) star(g, x + 1, y - 5, 2, '#ffd23f');
          return;
        }
        const dt = t - T, k = clamp01(dt / 600), R = (6 + easeOut(clamp01(dt / 220)) * 16) * P.s;
        alpha(g, 1 - k);
        for (const s of smoke) disc(g, P.to.x + s.ox * (1 + k), P.to.y + s.oy - k * 14, s.r * (1 + k * 1.5) * P.s, k < 0.3 ? '#6b5f58' : '#8d8580');
        if (dt < 300) {
          const f = 1 - dt / 300;
          alpha(g, 1);
          disc(g, P.to.x, P.to.y, R * (0.7 + 0.3 * f), '#e5402a'); disc(g, P.to.x, P.to.y, R * 0.75 * f + 1, '#ff8a1f');
          disc(g, P.to.x, P.to.y, R * 0.5 * f, '#ffd23f'); disc(g, P.to.x, P.to.y, R * 0.25 * f, '#ffffff');
        }
        alpha(g, 1 - k);
        for (const d of debris) { const dd = d.v * easeOut(k) * P.s; rect(g, P.to.x + Math.cos(d.a) * dd, P.to.y + Math.sin(d.a) * dd + k * k * 20, d.z, d.z, k < 0.4 ? '#ffd23f' : '#5d5348'); }
        alpha(g, 1);
      },
    };
  },

  // Une vague traverse l'arène jusqu'à la cible.
  wave(P) {
    const dist = Math.abs(P.to.x - P.from.x) || 1, over = 30, D = 620, H = (P.to.r * 1.5 + 8) * P.s;
    const hit = (D * dist) / (dist + over);
    const drops = Array.from({ length: 18 }, () => ({ ox: (P.rand() - 0.5) * P.to.r * 2, v: 10 + P.rand() * 18, z: P.rand() < 0.4 ? 2 : 1 }));
    const baseAt = x => lerp(P.from.feet, P.to.feet, clamp01((x - P.from.x) / (P.to.x - P.from.x || 1))) + 2;
    return {
      dur: D + 300, hit, draw(g, t) {
        const k = clamp01(t / D), fade = 1 - phase(t, D - 100, D + 300), grow = 0.55 + 0.45 * k;
        const front = P.from.x + P.dir * k * (dist + over), back = P.from.x + P.dir * Math.max(0, k - 0.5) * (dist + over);
        const span = Math.max(1, Math.abs(front - back));
        alpha(g, fade);
        // Corps de la vague : de plus en plus haut vers l'avant, en bandes de bleu, écume sur le dessus.
        let crestY = 0;
        for (let x = Math.floor(Math.min(front, back)); x <= Math.max(front, back); x++) {
          const rel = Math.abs(x - back) / span, base = baseAt(x);
          const prof = rel < 0.88 ? 0.12 + 0.88 * easeIn(rel / 0.88) : 1 - ((rel - 0.88) / 0.12) * 0.75;
          const hgt = Math.max(1, H * prof * grow + Math.sin(x / 2.5 + t / 50) * 1.2);
          rect(g, x, base - hgt, 1, hgt, '#1f5fbf');
          rect(g, x, base - hgt, 1, hgt * 0.62, '#2f80ed');
          rect(g, x, base - hgt, 1, hgt * 0.3, '#56ccf2');
          rect(g, x, base - hgt, 1, 2, '#e8fbff');
          if ((x + Math.round(t / 40)) % 9 === 0 && hgt > 6) rect(g, x, base - hgt * 0.5, 3, 1, '#9fe3ff');
          if (rel >= 0.86 && rel <= 0.9) crestY = base - hgt;
        }
        // Rouleau d'écume qui retombe vers l'avant.
        if (crestY) {
          const R = H * grow * 0.28, cx = front - P.dir * R * 0.6, cy = crestY + R;
          for (let a = 0; a <= 1; a += 0.04) {
            const an = -Math.PI / 2 + a * Math.PI * 0.95, x = cx + P.dir * Math.cos(an) * R, y = cy + Math.sin(an) * R;
            rect(g, x - 1, y - 1, 3, 3, a < 0.7 ? '#56ccf2' : '#e8fbff');
            rect(g, x, y - 2, 1, 1, '#ffffff');
          }
          for (let i = 0; i < 4; i++) rect(g, cx + P.dir * (R + 1 + ((t / 30 + i * 3) % 5)), cy + R * 0.2 + ((t / 25 + i * 4) % 8), 1, 1, '#ffffff');
        }
        // Éclaboussure en touchant la cible.
        const dt = t - hit;
        if (dt > 0 && dt < 450) {
          const kk = dt / 450;
          alpha(g, fade * (1 - kk));
          for (const d of drops) rect(g, P.to.x + d.ox * (1 + kk), P.to.feet - d.v * 4 * kk * (1 - kk) * 1.5, d.z, d.z + 1, kk < 0.5 ? '#e8fbff' : '#56ccf2');
        }
        alpha(g, 1);
      },
    };
  },

  // Boule de feu puis flammes sous la cible.
  fire(P) {
    const T = 220, flames = makeFlames(P, P.to, P.big ? 70 : 50, T - 40, 420);
    return {
      dur: T + 640, hit: T, draw(g, t) {
        if (t < T) {
          const k = t / T, x = lerp(P.from.x, P.to.x, k), y = lerp(P.from.y, P.to.y, k) - Math.sin(k * Math.PI) * 8;
          for (let j = 1; j <= 5; j++) { const kk = Math.max(0, k - j * 0.05); alpha(g, 0.6 - j * 0.1); rect(g, lerp(P.from.x, P.to.x, kk), lerp(P.from.y, P.to.y, kk) - Math.sin(kk * Math.PI) * 8 + j, 2, 2, j % 2 ? '#ff8a1f' : '#ffd23f'); }
          alpha(g, 1);
          disc(g, x, y, 3.5 * P.s, '#e5402a'); disc(g, x, y, 2.5 * P.s, '#ff8a1f'); disc(g, x, y, 1.2 * P.s, '#fff6a0');
        }
        drawFlames(g, P.to, flames, t);
      },
    };
  },

  // Éclats de glace puis givre autour de la cible.
  ice(P) {
    const N = P.big ? 6 : 4, gap = 60, fly = 240;
    const ux = P.to.x - P.from.x, uy = P.to.y - P.from.y, L = Math.hypot(ux, uy) || 1;
    const shards = Array.from({ length: N }, (_, i) => ({ t0: i * gap, ox: (P.rand() - 0.5) * P.to.r, oy: (P.rand() - 0.5) * P.to.r }));
    const flakes = Array.from({ length: 6 }, () => ({ ox: (P.rand() - 0.5) * P.to.r * 2, oy: (P.rand() - 0.5) * P.to.r * 2, r: 2 + Math.floor(P.rand() * 3), t0: fly + P.rand() * 250 }));
    return {
      dur: (N - 1) * gap + fly + 520, hit: fly, draw(g, t) {
        for (const s of shards) {
          const k = (t - s.t0) / fly;
          if (k < 0 || k >= 1) continue;
          const x = lerp(P.from.x, P.to.x + s.ox, k), y = lerp(P.from.y, P.to.y + s.oy, k);
          line(g, x - (ux / L) * 7, y - (uy / L) * 7, x, y, '#7fd8ff', 2); line(g, x - (ux / L) * 3, y - (uy / L) * 3, x, y, '#ffffff', 1);
        }
        const kb = phase(t, fly, fly + 120), fb = 1 - phase(t, fly + 380, fly + 600);
        if (kb > 0 && fb > 0) {
          const w = P.to.r * 1.3 * kb, hh = P.to.r * 1.6 * kb;
          alpha(g, 0.4 * fb); rect(g, P.to.x - w, P.to.y - hh, w * 2, hh * 2, '#bff4ff');
          alpha(g, fb); frame(g, P.to.x - w, P.to.y - hh, w * 2, hh * 2, '#e8fbff');
          line(g, P.to.x - w + 2, P.to.y - hh + 6, P.to.x - w + 6, P.to.y - hh + 2, '#ffffff');
        }
        for (const f of flakes) { const k = (t - f.t0) / 380; if (k < 0 || k > 1) continue; alpha(g, 1 - k); snowflake(g, P.to.x + f.ox, P.to.y + f.oy - k * 6, f.r, '#ffffff'); }
        alpha(g, 1);
      },
    };
  },

  // Tornade qui fonce sur la cible.
  tornado(P) {
    const T = 300;
    const debris = Array.from({ length: 7 }, (_, i) => ({ a0: P.rand() * 6, hgt: P.rand(), gl: i < 3 ? pick(P) : null }));
    return {
      dur: 950, hit: T, draw(g, t) {
        const km = easeInOut(phase(t, 0, T)), fade = 1 - phase(t, 760, 950);
        const cx = lerp(P.from.x, P.to.x, km), base = lerp(P.from.feet, P.to.feet, km), H = (P.to.r * 2.2 + 10) * P.s;
        // Entonnoir semi-transparent, puis rayures qui tournent dessus.
        alpha(g, 0.45 * fade);
        for (let j = 0; j < H; j++) { const w = 2 + j * 0.45; rect(g, cx + Math.sin(t / 90 + j / 8) * 2 - w, base - j, w * 2, 1, j % 6 < 3 ? '#cfd5de' : '#b7bfcb'); }
        alpha(g, fade);
        rect(g, cx - 6, base - 1, 12, 2, '#8d8580');
        for (let j = 0; j < H; j += 2) {
          const w = 2 + j * 0.45, a = t / 55 + j * 0.35, wob = Math.sin(t / 90 + j / 8) * 2;
          for (let q = 0; q < 3; q++) {
            const aa = a + q * 2.1;
            rect(g, cx + wob + Math.cos(aa) * w, base - j + Math.sin(aa) * w * 0.18, 2, 1, q === 0 ? '#e6e6e6' : q === 1 ? '#a8adb5' : P.l);
          }
        }
        for (const d of debris) {
          const a = d.a0 + t / 70, y = base - d.hgt * H, x = cx + Math.cos(a) * (4 + d.hgt * H * 0.45);
          if (d.gl) glyph(g, d.gl, x, y, 7); else rect(g, x, y, 2, 2, '#6b5f58');
        }
        alpha(g, 1);
      },
    };
  },

  // Flux de 0 et de 1 puis bug visuel sur la cible.
  glitch(P) {
    const T = 220;
    return {
      dur: 760, hit: T, draw(g, t) {
        if (t < T + 100) {
          for (let i = 0; i < 10; i++) {
            const k = t / T - i * 0.08;
            if (k < 0 || k > 1) continue;
            pixelText(g, (i * 7 + ((t / 60) | 0)) % 2 ? '1' : '0', lerp(P.from.x, P.to.x, k), lerp(P.from.y, P.to.y, k) + Math.sin(i * 2.3) * 5, i % 3 ? '#00ffa3' : P.l, 1, '#0b1a12');
          }
        }
        if (t < T) return;
        const r = rng((t / 45) | 0 || 1), box = P.to.r * 1.3;
        alpha(g, 1 - phase(t, 600, 760));
        for (let i = 0; i < 9; i++) {
          const w = 2 + r() * box, hh = 1 + r() * 4;
          rect(g, P.to.x - box + r() * box * 2 - w / 2, P.to.y - box + r() * box * 2, w, hh, ['#00ffd5', '#ff00aa', '#ffffff', '#000000', P.c][Math.floor(r() * 5)]);
        }
        for (let y = -box; y < box; y += 3) if (r() < 0.3) rect(g, P.to.x - box, P.to.y + y, box * 2, 1, 'rgba(0,0,0,0.35)');
        alpha(g, 1);
      },
    };
  },

  // Notes de musique qui ondulent jusqu'à la cible.
  notes(P) {
    const N = P.big ? 8 : 6, gap = 75, fly = 420;
    const items = Array.from({ length: N }, (_, i) => ({ t0: i * gap, s: i % 2 ? '♫' : '♪', amp: 6 + P.rand() * 6, ph: P.rand() * 6, c: ['#ff4d6d', '#ffbe0b', '#3a86ff', '#8338ec', P.l][i % 5], parts: makeParts(P, 5) }));
    return {
      dur: (N - 1) * gap + fly + 260, hit: fly, draw(g, t) {
        for (const it of items) {
          const k = (t - it.t0) / fly;
          if (k < 0) continue;
          if (k < 1) pixelText(g, it.s, lerp(P.from.x, P.to.x, k), lerp(P.from.y, P.to.y, k) + Math.sin(k * 9 + it.ph) * it.amp, it.c, 2, '#231b33');
          else impact(g, P, t - it.t0 - fly, it.parts, P.to.x + Math.sin(it.ph) * 6, P.to.y + Math.cos(it.ph) * 6, 0.6, 220);
        }
      },
    };
  },

  // Taches de peinture qui éclaboussent et coulent.
  paint(P) {
    const COLS = ['#ff4d6d', '#3a86ff', '#ffbe0b', '#8338ec', '#06d6a0'];
    const N = P.big ? 5 : 3, gap = 95, fly = 300, end = (N - 1) * gap + fly;
    const blobs = Array.from({ length: N }, (_, i) => ({
      t0: i * gap, c: COLS[Math.floor(P.rand() * COLS.length)], ox: (P.rand() - 0.5) * P.to.r * 1.4, oy: (P.rand() - 0.5) * P.to.r * 1.2,
      sat: Array.from({ length: 5 }, () => ({ a: P.rand() * 6.28, d: 3 + P.rand() * 5, r: 1 + P.rand() * 1.5 })),
      drips: Array.from({ length: 3 }, () => ({ ox: (P.rand() - 0.5) * 6, len: 4 + P.rand() * 8 })),
    }));
    return {
      dur: end + 600, hit: fly, draw(g, t) {
        const fade = 1 - phase(t, end + 350, end + 600);
        for (const b of blobs) {
          const k = (t - b.t0) / fly;
          if (k < 0) continue;
          const tx = P.to.x + b.ox, ty = P.to.y + b.oy;
          if (k < 1) {
            const x = lerp(P.from.x, tx, k), y = lerp(P.from.y, ty, k) - Math.sin(k * Math.PI) * 16;
            disc(g, x, y, 2.6 * P.s, b.c); rect(g, x - 1, y - 1, 1, 1, '#ffffff');
            continue;
          }
          const dt = t - b.t0 - fly, ks = easeOut(clamp01(dt / 90));
          alpha(g, fade);
          disc(g, tx, ty, 3.5 * ks * P.s, b.c);
          for (const s of b.sat) disc(g, tx + Math.cos(s.a) * s.d * ks, ty + Math.sin(s.a) * s.d * ks, s.r, b.c);
          const kd = clamp01((dt - 80) / 400);
          for (const d of b.drips) rect(g, tx + d.ox, ty, 1, d.len * kd + 1, b.c);
          alpha(g, 1);
        }
      },
    };
  },

  // Colonne de lumière divine.
  holy(P) {
    const sparks = Array.from({ length: 14 }, () => ({ ox: (P.rand() - 0.5) * P.to.r * 1.4, t0: 120 + P.rand() * 400, z: P.rand() < 0.4 ? 2 : 1 }));
    return {
      dur: 820, hit: 200, flash: { at: 160, dur: 160, color: '#fff8d8', alpha: 0.3 }, draw(g, t) {
        const w = (P.to.r * 0.9 + 3) * P.s * easeOut(phase(t, 0, 200)) * (1 - easeIn(phase(t, 520, 820)));
        if (w > 0.5) {
          alpha(g, 0.3); rect(g, P.to.x - w * 1.5, 0, w * 3, P.to.feet, '#fff6c0');
          alpha(g, 0.75); rect(g, P.to.x - w, 0, w * 2, P.to.feet, P.l);
          alpha(g, 1); rect(g, P.to.x - w * 0.45, 0, w * 0.9, P.to.feet, '#ffffff');
        }
        alpha(g, 1 - phase(t, 520, 820)); ring(g, P.to.x, P.to.y - P.to.r - 3, 6 * P.s, '#ffe680', 1, 0.35);
        for (const s of sparks) { const k = (t - s.t0) / 380; if (k < 0 || k > 1) continue; alpha(g, 1 - k); star(g, P.to.x + s.ox, P.to.feet - k * P.to.r * 2.4, s.z + 1, '#ffffff'); }
        alpha(g, 1);
      },
    };
  },

  // Bulles de discours lancées à la figure de l'adversaire.
  speech(P) {
    const words = [P.word || 'BLA', '!!', P.word ? 'BLA' : '?!'];
    const fly = 360, items = words.map((w, i) => ({ w, t0: i * 130, ph: P.rand() * 6 }));
    return {
      dur: 2 * 130 + fly + 320, hit: fly, draw(g, t) {
        for (const it of items) {
          const k = (t - it.t0) / fly;
          if (k < 0) continue;
          if (k < 1) { bubble(g, it.w, lerp(P.from.x, P.to.x, easeIn(k)), lerp(P.from.y - 10, P.to.y - 6, k) + Math.sin(k * 7 + it.ph) * 4); continue; }
          const dt = t - it.t0 - fly;
          if (dt < 220) { alpha(g, 1 - dt / 220); const R = 4 + dt / 16; for (let a = 0; a < 8; a++) { const an = (a / 8) * Math.PI * 2; line(g, P.to.x + Math.cos(an) * R, P.to.y - 4 + Math.sin(an) * R, P.to.x + Math.cos(an) * (R + 3), P.to.y - 4 + Math.sin(an) * (R + 3), '#ffffff'); } alpha(g, 1); }
        }
      },
    };
  },

  // Explosion de confettis.
  confetti(P) {
    const T = 240, COLS = ['#ff4d6d', '#ffbe0b', '#3a86ff', '#06d6a0', '#8338ec', '#ffffff'];
    const bits = Array.from({ length: P.big ? 44 : 30 }, () => ({ a: -Math.PI / 2 + (P.rand() - 0.5) * 2.6, v: 14 + P.rand() * 22, c: COLS[Math.floor(P.rand() * COLS.length)], ph: P.rand() * 6 }));
    const popper = P.glyphs.includes('🏆') ? '🏆' : '🎉';
    return {
      dur: T + 800, hit: T, draw(g, t) {
        if (t < T) { const k = t / T; glyph(g, popper, lerp(P.from.x, P.to.x, k), lerp(P.from.y, P.to.y, k) - Math.sin(k * Math.PI) * 14, 10, { rot: k * 6 }); return; }
        const dt = t - T, k = clamp01(dt / 800);
        alpha(g, 1 - phase(dt, 550, 800));
        if (dt < 80) disc(g, P.to.x, P.to.y, 4 + dt / 10, '#ffffff');
        for (const b of bits) {
          const d = b.v * easeOut(Math.min(1, k * 2)) * P.s, flip = Math.sin(dt / 50 + b.ph) > 0;
          rect(g, P.to.x + Math.cos(b.a) * d + Math.sin(dt / 60 + b.ph) * 2, P.to.y + Math.sin(b.a) * d + k * k * 34, flip ? 2 : 1, flip ? 1 : 2, b.c);
        }
        alpha(g, 1);
      },
    };
  },

  // Véhicule, cheval ou coureur qui charge la cible.
  rush(P) {
    const T = 300, item = P.rushGlyph || '🏃', parts = makeParts(P, 14);
    return {
      dur: T + 360, hit: T, shake: P.big, draw(g, t) {
        if (t >= T) return impact(g, P, t - T, parts, P.to.x, P.to.y, 1.3);
        const k = easeIn(t / T), x = lerp(P.from.x, P.to.x, k), y = lerp(P.from.y, P.to.y, k);
        alpha(g, 0.7);
        for (let i = 0; i < 5; i++) { const oy = (i - 2) * 3; line(g, x - P.dir * (9 + (i % 2) * 3), y + oy, x - P.dir * (20 + i * 4), y + oy, '#ffffff'); }
        alpha(g, 0.5); disc(g, lerp(P.from.x, x, 0.85), lerp(P.from.feet, y + P.to.r * 0.6, 0.85), 3, '#d9cfc0');
        alpha(g, 1);
        glyph(g, item, x, y, 14, { flip: P.dir > 0 && FACES_LEFT.has(item) });
      },
    };
  },

  // Pages qui volent et giflent l'adversaire.
  pages(P) {
    const N = P.big ? 7 : 5, gap = 70, fly = 380;
    const ps = Array.from({ length: N }, (_, i) => ({ t0: i * gap, ph: P.rand() * 6, ox: (P.rand() - 0.5) * P.to.r * 1.4, oy: (P.rand() - 0.5) * P.to.r }));
    return {
      dur: (N - 1) * gap + fly + 260, hit: fly, draw(g, t) {
        for (const p of ps) {
          const k = (t - p.t0) / fly;
          if (k < 0) continue;
          const tx = P.to.x + p.ox, ty = P.to.y + p.oy;
          if (k < 1) sheet(g, lerp(P.from.x, tx, k), lerp(P.from.y, ty, k) + Math.sin(k * 10 + p.ph) * 4, Math.cos(k * 14 + p.ph) > 0);
          else { const dt = t - p.t0 - fly; if (dt < 220) { alpha(g, 1 - dt / 220); sheet(g, tx, ty + dt / 20, true); alpha(g, 1); } }
        }
      },
    };
  },

  // Étoiles filantes.
  stars(P) {
    const N = 3, gap = 110, fly = 380;
    const st = Array.from({ length: N }, (_, i) => ({ t0: i * gap, H: 10 + P.rand() * 24, ox: (P.rand() - 0.5) * P.to.r, oy: (P.rand() - 0.5) * P.to.r, parts: makeParts(P, 8) }));
    return {
      dur: (N - 1) * gap + fly + 300, hit: fly, draw(g, t) {
        for (const s of st) {
          const k = (t - s.t0) / fly;
          if (k < 0) continue;
          const tx = P.to.x + s.ox, ty = P.to.y + s.oy;
          if (k >= 1) { impact(g, P, t - s.t0 - fly, s.parts, tx, ty, 0.8, 260); continue; }
          const pos = kk => [lerp(P.from.x, tx, kk), lerp(P.from.y, ty, kk) - Math.sin(kk * Math.PI) * s.H];
          for (let j = 1; j <= 6; j++) { const [x, y] = pos(Math.max(0, k - j * 0.04)); alpha(g, (7 - j) / 9); rect(g, x, y, 1, 1, j % 2 ? '#ffffff' : P.l); }
          alpha(g, 1);
          const [x, y] = pos(k);
          bigStar(g, x, y, '#ffe680', '#7a5a00');
        }
      },
    };
  },

  // Capacité de soutien : cercle magique et symbole au-dessus du lanceur.
  cast(P) {
    const A = P.from, gl = pick(P);
    const parts = Array.from({ length: 12 }, () => ({ ox: (P.rand() - 0.5) * A.r * 2, t0: P.rand() * 300, z: 1 + Math.floor(P.rand() * 2) }));
    return {
      dur: 700, hit: 280, draw(g, t) {
        const f = 1 - phase(t, 450, 700);
        alpha(g, f);
        ring(g, A.x, A.feet, A.r * 0.9 * easeOut(phase(t, 0, 200)) + Math.sin(t / 40), P.l, 1, 0.3);
        for (let i = 0; i < 6; i++) { const a = t / 120 + i * 1.047; rect(g, A.x + Math.cos(a) * A.r * 0.9, A.feet + Math.sin(a) * A.r * 0.27, 2, 1, '#ffffff'); }
        for (const p of parts) { const k = (t - p.t0) / 350; if (k < 0 || k > 1) continue; rect(g, A.x + p.ox, A.feet - k * A.r * 2.2, p.z, p.z * 2, k < 0.5 ? '#ffffff' : P.l); }
        if (gl) { const k = phase(t, 80, 260); glyph(g, gl, A.x, A.y - A.r - 6 - k * 4, 10, { a: f * k }); }
        alpha(g, 1);
      },
    };
  },
};

// ---------- Effets de résultat (bonus, soins, statuts…) ----------
const EFFECT_FX = {
  // Hausse ou baisse d'une statistique.
  buff(P) {
    const A = P.at, col = { atk: '#ff5a3c', def: '#3a86ff', spd: '#ffd23f' }[P.stat] || P.c;
    const arrows = [-1, 0, 1].map(i => ({ ox: i * A.r * 0.7, t0: (i + 1) * 90 }));
    const aura = Array.from({ length: 24 }, () => ({ a: P.rand() * Math.PI * 2, t0: P.rand() * 400 }));
    return {
      dur: 900, hit: 250, draw(g, t) {
        const f = 1 - phase(t, 650, 900);
        alpha(g, f);
        if (!P.up) {
          for (const p of aura) { const k = (t - p.t0) / 450; if (k < 0 || k > 1) continue; rect(g, A.x + Math.cos(p.a) * A.r, A.y - A.r + k * A.r * 2.2, 1, 2, '#6a5acd'); }
        } else if (P.stat === 'def') {
          const k = easeOut(phase(t, 0, 220)), R = A.r * 1.15 * k;
          alpha(g, 0.25 * f); disc(g, A.x, A.y, R, '#bfe3ff');
          alpha(g, f); ring(g, A.x, A.y, R, '#e8f4ff', 2); ring(g, A.x, A.y, R - 2, col, 1);
          const ga = t / 90; rect(g, A.x + Math.cos(ga) * R, A.y + Math.sin(ga) * R, 2, 2, '#ffffff');
        } else if (P.stat === 'spd') {
          for (let i = 0; i < 8; i++) {
            const y = A.y - A.r + (i / 7) * A.r * 2, len = 6 + ((i * 37) % 11);
            rect(g, A.x + A.r * 1.6 - ((t / 2 + i * 23) % (A.r * 3.2)), y, len, 1, i % 2 ? '#ffffff' : col);
          }
        } else {
          for (const p of aura) {
            const k = (t - p.t0) / 450;
            if (k < 0 || k > 1) continue;
            rect(g, A.x + Math.cos(p.a) * A.r * 0.9, A.feet - k * A.r * 2.2, 1, 2, k < 0.5 ? '#ffd23f' : col);
          }
        }
        for (const a of arrows) {
          const k = (t - a.t0) / 500;
          if (k < 0 || k > 1) continue;
          alpha(g, f * (1 - k * 0.6));
          arrow(g, A.x + a.ox, P.up ? A.y + A.r * 0.4 - k * A.r * 1.6 : A.y - A.r - 4 + k * A.r * 1.6, P.up, P.up ? col : '#8f7cff', '#231b33');
        }
        alpha(g, 1);
      },
    };
  },

  heal(P) {
    const A = P.at, crosses = Array.from({ length: 7 }, () => ({ ox: (P.rand() - 0.5) * A.r * 1.8, t0: P.rand() * 350 }));
    return {
      dur: 900, hit: 200, draw(g, t) {
        const f = 1 - phase(t, 650, 900);
        alpha(g, 0.28 * f * (0.7 + 0.3 * Math.sin(t / 50))); disc(g, A.x, A.y, A.r * 1.1, '#7dffa8');
        for (const c of crosses) { const k = (t - c.t0) / 520; if (k < 0 || k > 1) continue; alpha(g, f * (1 - k)); plus(g, A.x + c.ox, A.feet - k * A.r * 2.3, '#3ddc84', '#eafff0'); }
        alpha(g, 1);
      },
    };
  },

  // Énergie aspirée chez l'adversaire.
  drain(P) {
    const N = 7, fly = 380, orbs = Array.from({ length: N }, (_, i) => ({ t0: i * 50, H: (P.rand() - 0.5) * 30 }));
    return {
      dur: (N - 1) * 50 + fly + 60, hit: fly, draw(g, t) {
        for (const o of orbs) {
          const k = (t - o.t0) / fly;
          if (k < 0 || k > 1) continue;
          const x = lerp(P.from.x, P.to.x, easeInOut(k)), y = lerp(P.from.y, P.to.y, easeInOut(k)) + Math.sin(k * Math.PI) * o.H;
          disc(g, x, y, 2.5, '#2fae5a'); disc(g, x, y, 1.5, '#9dffbd');
        }
      },
    };
  },

  // Polémique : nuage d'orage, symboles de colère et flamme.
  polemique(P) {
    const A = P.at, syms = ['#', '!', '?', '%'];
    return {
      dur: 1000, hit: 300, draw(g, t) {
        const k = easeOut(phase(t, 0, 220)), f = 1 - phase(t, 760, 1000);
        alpha(g, f);
        cloud(g, A.x, A.y - A.r - 8, (A.r + 6) * k, '#2e2b3a', '#4a4560');
        if (t > 200 && ((t / 110) | 0) % 3 === 0) poly(g, [[A.x - 3, A.y - A.r - 6], [A.x + 1, A.y - A.r + 2], [A.x - 2, A.y - A.r + 4], [A.x + 2, A.y - A.r + 12]], '#ff5a3c', 1);
        for (let i = 0; i < 4; i++) { const kk = (t - 200 - i * 120) / 500; if (kk < 0 || kk > 1) continue; pixelText(g, syms[i], A.x + (i - 1.5) * A.r * 0.6, A.y - A.r * 0.2 - kk * 14, '#ff5a3c', 1, '#231b33'); }
        if (t > 250) glyph(g, '🔥', A.x + A.r * 0.8, A.y - A.r * 0.4 + Math.sin(t / 60) * 2, 9, { a: f });
        alpha(g, 1);
      },
    };
  },

  // Censure : bandeaux noirs et tampon rouge.
  censure(P) {
    const A = P.at, short = !!P.short;
    const end = short ? 650 : 1050;
    return {
      dur: end, hit: short ? 150 : 300, draw(g, t) {
        const f = 1 - phase(t, end - 250, end), kb = easeOut(phase(t, 0, 200)), bw = A.r * 2.4 * kb;
        alpha(g, f);
        rect(g, A.x - A.r * 1.2, A.y - A.r * 0.45, bw, 4, '#111111');
        rect(g, A.x + A.r * 1.2 - bw, A.y + A.r * 0.2, bw, 4, '#111111');
        const ks = phase(t, 220, 330);
        if (!short && ks > 0) {
          const s = ks < 1 ? Math.max(1, Math.round(3 - 2 * easeOut(ks))) : 1;
          const w = pixelText(g, 'CENSURÉ', A.x, A.y - A.r * 0.1, '#d32f2f', s, '#ffffff');
          frame(g, A.x - w / 2 - 3 * s, A.y - A.r * 0.1 - 6 * s, w + 6 * s, 11 * s, '#d32f2f');
        }
        alpha(g, 1);
      },
    };
  },

  // Brûlure de la Polémique à chaque tour.
  burn(P) {
    const flames = makeFlames(P, P.at, 34, 0, 260);
    return { dur: 700, hit: 150, draw(g, t) { drawFlames(g, P.at, flames, t); } };
  },

  // Nuage de fumée quand une carte tombe K.O.
  puff(P) {
    const A = P.at, puffs = Array.from({ length: 9 }, () => ({ a: P.rand() * Math.PI * 2, v: 0.5 + P.rand() * 0.5, r: 2 + P.rand() * 3 }));
    return {
      dur: 750, hit: 0, draw(g, t) {
        const k = clamp01(t / 750);
        alpha(g, 1 - k);
        for (const p of puffs) disc(g, A.x + Math.cos(p.a) * p.v * A.r * (0.4 + k), A.feet - 4 - k * 12 + Math.sin(p.a) * 3, p.r * (1 + k), k < 0.4 ? '#e8e2d8' : '#a8a39b');
        alpha(g, 1);
      },
    };
  },

  // Étincelles quand une carte entre en jeu.
  sparkle(P) {
    const A = P.at, pts = Array.from({ length: 8 }, (_, i) => ({ a: (i / 8) * Math.PI * 2 + P.rand() * 0.4, t0: i * 40 }));
    return {
      dur: 650, hit: 0, draw(g, t) {
        for (const p of pts) {
          const k = (t - p.t0) / 360;
          if (k < 0 || k > 1) continue;
          alpha(g, 1 - k);
          star(g, A.x + Math.cos(p.a) * A.r * (0.8 + k * 0.5), A.y + Math.sin(p.a) * A.r * (0.9 + k * 0.5), k < 0.5 ? 3 : 2, k < 0.5 ? '#ffffff' : '#ffe680');
        }
        alpha(g, 1);
      },
    };
  },
};

// ---------- Quelle animation pour quelle attaque ? ----------
// Animations par défaut de chaque type (une attaque différente pour chaque attaque d'une carte).
const FAMILIES = {
  politique: { patterns: ['speech', 'quake', 'volley', 'beam'], glyphs: ['📢', '🗳️', '📜'] },
  histoire: { patterns: ['meteor', 'slash', 'pages', 'toss'], glyphs: ['📜', '🏺', '⏳', '👑'] },
  science: { patterns: ['beam', 'spiral', 'orb', 'explosion'], glyphs: ['⚗️', '🧪', '🔭'], sym: ['π', '∑', '√', 'Δ', '×', '='] },
  tech: { patterns: ['glitch', 'lightning', 'beam', 'volley'], glyphs: ['💾', '🔌', '🖱️'] },
  nature: { patterns: ['vines', 'rain', 'tornado', 'toss'], glyphs: ['🍃', '🌸', '🍂'] },
  geo: { patterns: ['meteor', 'wave', 'quake', 'tornado'], glyphs: [] },
  guerre: { patterns: ['explosion', 'volley', 'slash', 'meteor'], glyphs: ['💣'] },
  art: { patterns: ['paint', 'notes', 'spiral', 'stars'], glyphs: ['🎨', '🎭', '🎬'] },
  sport: { patterns: ['bounce', 'rush', 'quake', 'volley'], glyphs: ['⚽', '🏆'] },
  mythe: { patterns: ['lightning', 'holy', 'stars', 'spiral'], glyphs: ['✨', '🔱', '🌙'] },
  quotidien: { patterns: ['toss', 'confetti', 'speech', 'rain'], glyphs: ['🍕', '🧀', '🥖', '☕'] },
};

const FOOD = [
  [/pizza/, '🍕'], [/fromage|camembert|brie|comte|roquefort|raclette|fondue/, '🧀'], [/baguette|pain\b/, '🥖'], [/croissant/, '🥐'],
  [/gateau|patisserie|tarte|eclair au/, '🍰'], [/cafe|expresso/, '☕'], [/vin\b|champagne|bordeaux|bourgogne/, '🍷'], [/biere/, '🍺'],
  [/chocolat/, '🍫'], [/frite/, '🍟'], [/burger/, '🍔'], [/soupe|potage/, '🍲'], [/crepe/, '🥞'], [/\bthe\b/, '🍵'], [/bonbon|confiserie/, '🍬'],
];
const BALLS = [
  [/tennis|open\b|wimbledon|roland|smash|service|\bace\b|raquette|\batp\b|\bwta\b/, '🎾'], [/basket|\bnba\b|dunk|panier|lakers|celtics/, '🏀'],
  [/rugby|essai|ovale|\bxv\b|top 14|melee/, '🏉'], [/volley/, '🏐'], [/baseball/, '⚾'], [/golf/, '⛳'], [/hockey/, '🏒'],
  [/football americain|\bnfl\b|super bowl/, '🏈'], [/bowling/, '🎳'], [/billard/, '🎱'], [/ping|tennis de table/, '🏓'],
];
const VEHICLES = [
  [/voiture|formule|grand prix|rallye|\bf1\b|automobile|karting|nascar|le mans/, '🏎️'], [/train|tgv|locomotive|metro|ferroviaire/, '🚄'],
  [/avion|aviation|aerien|aeroport/, '✈️'], [/fusee|spatial|apollo\b|ariane|nasa/, '🚀'], [/cheval|galop|hippique|jockey|cavalerie/, '🐎'],
  [/velo|cyclis|tour de france|peloton/, '🚴'], [/moto/, '🏍️'], [/bateau|voile|navire|regate|vendee/, '⛵'],
];
const ACC_BALL = { ballon: '⚽', basket: '🏀', raquette: '🎾', ovale: '🏉', gants: '🥊' };

// Mots du nom de l'attaque → animation (du plus précis au plus général).
const RULES = [
  [/feu\b|flamm|incend|brul|enfer|volcan|lave\b|eruption|braise|dragon/, 'fire'],
  [/glace|neige|hiver|froid|givre|\bgel\b|banquise|arctique|antarctique|blizzard|iceberg/, 'ice'],
  [/pluie|averse|grele|mousson/, 'rain', []],
  [/\beau\b|\bmer\b|ocean|riviere|fleuve|\blac\b|vague|tsunami|inond|deluge|maree|\bseine\b|\bloire\b|rhone|danube|\bnil\b|amazone|cascade|\bport\b|plage|surf/, 'wave'],
  [/eclair|foudre|tonnerre|orage|electri|\bzeus\b|\bthor\b|tesla|\bvolt/, 'lightning'],
  [/explos|bomb|canon|obus|missile|nucle|grenade|dynamite|artillerie|mortier|torpille|\bchar\b|tank/, 'explosion'],
  [/pinceau|peintur|toile|couleur|fresque|tableau|graffiti|aquarelle|palette/, 'paint'],
  [/musique|chanson|\bchant|album|single|concert|opera|symphon|disque|\btube\b|\brock\b|jazz|\brap\b|melodie|refrain|orchestre|guitare|piano|violon|festival|eurovision/, 'notes'],
  [new RegExp(FOOD.map(([re]) => re.source).join('|')), 'toss', 'food'],
  [/etoile|astre|galaxie|cosmos|planete|univers|constellation|comete/, 'stars'],
  [/lumiere|soleil|divin|\bdieu|deesse|\bange\b|saint|sacre|paradis|aureole|benedict|\blune\b|\bciel\b|olymp|temple/, 'holy'],
  [/virus|\bbug\b|\bcode\b|hack|algorithm|logiciel|internet|donnee|pixel|binaire|reseau|cyber|ordinateur|programm|serveur|robot|\bia\b|\bweb\b|smartphone|console|jeu video|windows|linux|google|apple/, 'glitch'],
  [/laser|rayon|atome|atomi|radio|photon|plasma|quanti|neutron|proton|particule|\bonde\b|spectre|relativit|energie/, 'beam'],
  [/fleur|arbre|foret|racine|plante|graine|liane|jardin|vigne|feuille|herbe|\brose\b|chene|bambou|\bbois\b/, 'vines'],
  [/\bvent\b|tempete|ouragan|cyclone|tornade|bourrasque|mistral|typhon|souffle/, 'tornado'],
  [/rocher|pierre|roche|meteor|asteroid|montagne|\bmont\b|massif|falaise|avalanche|\bpic\b|sommet|alpes|pyrenees|himalaya|everest/, 'meteor'],
  [/seisme|tremblement|pietin|ecrase|marteau|massue|plaque|\bcharge\b|bulldozer|catch|lutte|sumo/, 'quake'],
  [/discours|debat|\bvote|election|\bloi\b|decret|referendum|parlement|assemblee|senat|motion|sondage|promesse|slogan|meeting|manif|greve|tweet|propagande|\bparti\b|congres|tribune|interview|parole|rassemblement|front national|republi|ministre|presiden|gouvern|depute|syndicat|campagne/, 'speech'],
  [/fete|carnaval|anniversaire|victoire|trophee|champion|\btitre\b|medaille|\bcoupe\b|\bprix\b|parade|ceremonie|oscar|cesar|nobel|\bgala\b|record|\bor\b/, 'confetti'],
  [new RegExp(VEHICLES.map(([re]) => re.source).join('|') + '|sprint|course|marathon|athlet|vitesse|turbo'), 'rush', 'vehicle'],
  [new RegExp(BALLS.map(([re]) => re.source).join('|') + '|ballon|\\bbut\\b|penalty|dribble|frappe|passe|corner|coup franc|tir enroule|tir au but|\\bmatch\\b|football|\\bfoot\\b|ligue|\\bfc\\b|\\bpsg\\b|olympique'), 'bounce'],
  [/livre|roman|ecrit|poeme|poesie|plume|journal|lettre|manuscrit|encyclop|dictionnaire|traite\b|manifeste|chronique|memoire|these|bibliotheque|archive/, 'pages'],
  [/\btir\b|\btirs\b|balle|fusil|pistolet|fleche|\barc\b|mitraill|rafale|sniper|arquebuse|mousquet|\bcanon\b/, 'volley', []],
  [/epee|sabre|lame|tranch|griffe|katana|hache|couteau|glaive|dague|coup de|samoura|chevalier|ninja|escrime/, 'slash'],
];

const firstMatch = (list, n) => list.find(([re]) => re.test(n))?.[1] || null;

// Mot affiché dans les bulles : sigle du nom (« Rassemblement national » → « RN! »).
function speechWord(name) {
  const words = name.split(/[\s'’-]+/).filter(w => w.length > 2);
  if (words.length >= 2) return words.slice(0, 3).map(w => w[0]).join('').toUpperCase() + '!';
  const w = norm(words[0] || name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return w.length && w.length <= 5 ? w : 'BLA';
}

function styleFor(card, move, used) {
  const n = norm(move.name);
  const fam = FAMILIES[move.type] || FAMILIES.quotidien;
  const rule = RULES.find(([re]) => re.test(n));
  let pattern = rule?.[1] || null, glyphs = fam.glyphs;
  if (rule && Array.isArray(rule[2])) glyphs = rule[2];
  if (rule?.[2] === 'food') glyphs = [firstMatch(FOOD, n) || '🍕'];
  // Deux attaques d'une même carte n'ont jamais la même animation de base.
  if (!pattern || used.has(pattern)) {
    const start = hash(move.name) % fam.patterns.length;
    for (let k = 0; k < fam.patterns.length; k++) {
      const p = fam.patterns[(start + k) % fam.patterns.length];
      if (!used.has(p)) { pattern = p; break; }
    }
    pattern ||= fam.patterns[start];
  }
  used.add(pattern);
  const ball = firstMatch(BALLS, n) || ACC_BALL[card?.accessory] || null;
  const rushGlyph = firstMatch(VEHICLES, n) || (/sprint|course|marathon|athlet/.test(n) ? '🏃' : move.type === 'sport' ? '🏃' : '💨');
  return { pattern, glyphs, sym: fam.sym || [], ball, rushGlyph, word: speechWord(move.name) };
}

const styleCache = new Map();
export function moveStyle(card, move) {
  const key = card?.id || move.name;
  let map = styleCache.get(key);
  if (!map) {
    map = new Map();
    const used = new Set();
    for (const m of card?.moves || [move]) map.set(m.name, m.power > 0 ? styleFor(card, m, used) : { pattern: 'cast', glyphs: (FAMILIES[m.type] || FAMILIES.quotidien).glyphs, sym: [] });
    styleCache.set(key, map);
  }
  return map.get(move.name) || (move.power > 0 ? styleFor(card, move, new Set()) : { pattern: 'cast', glyphs: [], sym: [] });
}

// ---------- Moteur ----------
// Positions reçues en pixels écran : { x, y } = centre du sprite, w / h = sa taille.
function pt(o) { return { x: o.x / PX, y: o.y / PX, r: Math.max(8, o.w / 2 / PX), feet: (o.y + o.h * 0.42) / PX }; }

export function createFx(arena) {
  const cv = document.createElement('canvas');
  cv.className = 'fx-layer';
  arena.append(cv);
  const g = cv.getContext('2d');
  const live = new Set();
  let raf = 0;

  function fit() {
    const w = Math.max(1, Math.ceil(arena.clientWidth / PX)), hh = Math.max(1, Math.ceil(arena.clientHeight / PX));
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    g.imageSmoothingEnabled = false;
  }
  function tick(now) {
    raf = 0;
    fit();
    g.clearRect(0, 0, cv.width, cv.height);
    for (const fx of live) {
      const t = (now - fx.start) * fx.speed;
      if (t >= fx.dur) { live.delete(fx); continue; }
      if (fx.flash && t >= fx.flash.at && t < fx.flash.at + fx.flash.dur) {
        g.globalAlpha = fx.flash.alpha * (1 - (t - fx.flash.at) / fx.flash.dur);
        g.fillStyle = fx.flash.color;
        g.fillRect(0, 0, cv.width, cv.height);
        g.globalAlpha = 1;
      }
      g.save();
      try { fx.draw(g, Math.max(0, t)); } catch (e) { console.error('[effets]', e); live.delete(fx); }
      g.restore();
    }
    if (live.size) raf = requestAnimationFrame(tick);
  }
  function shake() {
    arena.classList.remove('shake');
    void arena.offsetWidth;
    arena.classList.add('shake');
    setTimeout(() => arena.classList.remove('shake'), 380);
  }
  // Lance un effet ; la promesse se résout à l'impact (pour enchaîner dégâts et messages).
  function run(fx, fast) {
    fx.speed = fast ? 2 : 1;
    fx.start = performance.now();
    live.add(fx);
    if (!raf) raf = requestAnimationFrame(tick);
    const hitMs = (fx.hit || 0) / fx.speed;
    if (fx.shake) setTimeout(shake, hitMs);
    return new Promise(r => setTimeout(r, hitMs));
  }

  return {
    // Animation d'une attaque. miss : l'attaque passe à côté ; strong : coup critique ou super efficace.
    attack({ from, to, card, move, miss = false, strong = false, fast = false }) {
      const st = moveStyle(card, move);
      const type = move.type || card?.type;
      const c = TYPES[type]?.color || '#ffffff';
      const A = pt(from), B = pt(to);
      if (miss) { const d = B.x >= A.x ? 1 : -1; B.x += d * (B.r + 14); B.y -= B.r * 0.8; B.feet -= B.r * 0.8; }
      const big = move === card?.moves?.[0] || (move.power || 0) >= 90;
      const P = {
        from: A, to: B, dir: B.x >= A.x ? 1 : -1, c, l: shade(c, 0.45), d: shade(c, -0.4),
        glyphs: st.glyphs || [], sym: st.sym || [], ball: st.ball, rushGlyph: st.rushGlyph, word: st.word,
        big, s: big ? 1.3 : 1, rand: rng((Math.random() * 1e9) | 0),
      };
      const fx = (PATTERNS[st.pattern] || PATTERNS.orb)(P);
      if (strong && !miss) { fx.shake = true; fx.flash ||= { at: fx.hit, dur: 120, color: '#ffffff', alpha: 0.25 }; }
      return run(fx, fast);
    },
    // Effets de résultat : buff, heal, drain, polemique, censure, burn, puff, sparkle.
    effect(kind, { at, from, to, type, stat, up, short, fast = false }) {
      const make = EFFECT_FX[kind];
      if (!make) return Promise.resolve();
      const c = TYPES[type]?.color || '#ffffff';
      const P = { at: at && pt(at), from: from && pt(from), to: to && pt(to), c, l: shade(c, 0.45), d: shade(c, -0.4), stat, up, short, rand: rng((Math.random() * 1e9) | 0) };
      return run(make(P), fast);
    },
    destroy() { if (raf) cancelAnimationFrame(raf); live.clear(); cv.remove(); },
  };
}

// Pour la page de test : liste des animations disponibles.
export const PATTERN_NAMES = Object.keys(PATTERNS).filter(n => n !== 'cast');
export const EFFECT_NAMES = Object.keys(EFFECT_FX);
