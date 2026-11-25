// Générateur de personnages en pixel art.
// La tête = l'image de la page Wikipédia pixelisée ; le corps = dessiné selon le thème.
import { TYPES } from '/shared/types.js';

export const SW = 40, SH = 50;
const HX = 10, HY = 4, HS = 20;
const OUTLINE = '#1b1424';

// ---------- Couleurs ----------
const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export function shade(h, amt) {
  const [r, g, b] = hex2rgb(h);
  return amt >= 0 ? rgb2hex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt) : rgb2hex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
}
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = hash(seed); return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- Tampon de pixels ----------
class PB {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Array(w * h).fill(null); }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (c && x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c; }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.d[y * this.w + x] : null; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.set(x, y, c);
  }
  line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) { this.set(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  }
  outline(c) {
    const copy = this.d.slice();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (copy[y * this.w + x]) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < this.w && yy < this.h && copy[yy * this.w + xx]; });
      if (n) this.d[y * this.w + x] = c;
    }
  }
  toCanvas() {
    const cv = document.createElement('canvas');
    cv.width = this.w; cv.height = this.h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(this.w, this.h);
    this.d.forEach((c, i) => { if (!c) return; const [r, g, b] = hex2rgb(c); img.data.set([r, g, b, 255], i * 4); });
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

// ---------- Tête : image pixelisée ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
    setTimeout(() => reject(new Error('timeout')), 12000);
  });
}

function quantize(pixels, k) {
  const pts = pixels.filter(Boolean);
  if (!pts.length) return pixels;
  const sorted = [...pts].sort((a, b) => lum(a) - lum(b));
  let centers = Array.from({ length: k }, (_, i) => sorted[Math.floor((i + 0.5) * sorted.length / k)].slice());
  for (let it = 0; it < 7; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let best = 0, bd = Infinity;
      centers.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } });
      const a = acc[best]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++;
    }
    centers = centers.map((c, i) => (acc[i][3] ? [acc[i][0] / acc[i][3], acc[i][1] / acc[i][3], acc[i][2] / acc[i][3]] : c));
  }
  return pixels.map(p => {
    if (!p) return null;
    let best = centers[0], bd = Infinity;
    for (const c of centers) { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = c; } }
    return best;
  });
}

function punch([r, g, b]) {
  // Un peu plus de saturation et de contraste : rendu « jeu vidéo ».
  const l = lum([r, g, b]);
  const s = 1.25, c = 1.12;
  return [r, g, b].map(v => ((l + (v - l) * s) - 128) * c + 128);
}

async function imageHead(card) {
  const img = await loadImage('/api/img?u=' + encodeURIComponent(card.image));
  const w = img.naturalWidth, h = img.naturalHeight;
  let sx, sy, side;
  if (card.person) { side = Math.min(w, h) * (h > w * 1.1 ? 0.78 : 0.62); sx = (w - side) / 2; sy = Math.min(h - side, h * (h > w ? 0.04 : 0.02)); }
  else { side = Math.min(w, h) * 0.92; sx = (w - side) / 2; sy = (h - side) / 2; }
  // Réduction en deux étapes pour un meilleur moyennage.
  const mid = document.createElement('canvas'); mid.width = mid.height = 64;
  const mctx = mid.getContext('2d'); mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(img, sx, sy, side, side, 0, 0, 64, 64);
  const small = document.createElement('canvas'); small.width = small.height = HS;
  const sctx = small.getContext('2d', { willReadFrequently: true }); sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(mid, 0, 0, HS, HS);
  const data = sctx.getImageData(0, 0, HS, HS).data;
  const px = [];
  for (let i = 0; i < HS * HS; i++) px.push(data[i * 4 + 3] > 40 ? punch([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]) : null);
  const out = quantize(px, 9).map(p => (p ? rgb2hex(...p) : null));
  out.photo = { img, sx, sy, side };
  return out;
}

function emojiHead(card) {
  const cv = document.createElement('canvas'); cv.width = cv.height = HS;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '17px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  ctx.fillText(TYPES[card.type]?.emoji || '❔', HS / 2, HS / 2 + 1);
  const data = ctx.getImageData(0, 0, HS, HS).data;
  const px = [];
  for (let i = 0; i < HS * HS; i++) px.push(data[i * 4 + 3] > 110 ? [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]] : null);
  return quantize(px, 6).map(p => (p ? rgb2hex(...p) : null));
}

const SKINS = ['#f6d2b8', '#eec39a', '#d9a066', '#b97a4f', '#8d5a3b', '#5e3b26'];
const HAIRS = ['#2b1d14', '#5a3a22', '#a0522d', '#d8b45a', '#1b1b1b', '#8e8e8e', '#c0392b'];
function faceHead(card) {
  const r = rng(card.title + ':face');
  const skin = SKINS[Math.floor(r() * SKINS.length)], hair = HAIRS[Math.floor(r() * HAIRS.length)];
  const pb = new PB(HS, HS);
  pb.ellipse(9.5, 10.5, 8.5, 9, skin);
  pb.ellipse(9.5, 5, 9, 5, hair);
  pb.rect(1, 5, 2, 6, hair); pb.rect(17, 5, 2, 6, hair);
  pb.rect(6, 10, 2, 2, '#1b1424'); pb.rect(12, 10, 2, 2, '#1b1424');
  pb.rect(7, 15, 6, 1, shade(skin, -0.35));
  pb.set(4, 13, shade(skin, -0.12)); pb.set(15, 13, shade(skin, -0.12));
  return pb.d;
}

// Masques de forme de la tête.
const MASKS = {
  round: (x, y) => ((x - 9.5) / 9.6) ** 2 + ((y - 10) / 10.2) ** 2 <= 1 || (y > 12 && Math.abs(x - 9.5) < 8.5 && y < 19),
  square: (x, y) => !((x < 2 || x > 17) && (y < 2 || y > 17)) && !((x < 1 || x > 18) && (y < 3 || y > 16)),
  circle: (x, y) => ((x - 9.5) / 9.8) ** 2 + ((y - 9.5) / 9.8) ** 2 <= 1,
};

function dominant(px) {
  const counts = {};
  for (const c of px) if (c) { const [r, g, b] = hex2rgb(c); const l = lum([r, g, b]); const sat = Math.max(r, g, b) - Math.min(r, g, b); if (l > 30 && l < 235) counts[c] = (counts[c] || 0) + 1 + sat / 40; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// ---------- Corps ----------
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function digit(pb, d, x, y, c) { DIGITS[d].split('').forEach((b, i) => { if (b === '1') pb.set(x + (i % 3), y + Math.floor(i / 3), c); }); }

function humanoid(pb, { top, bottom, skin, shoes = '#2a2230', sleeve }) {
  pb.rect(18, 22, 4, 3, skin);
  pb.rect(12, 24, 16, 13, top);
  pb.rect(26, 25, 2, 11, shade(top, -0.18));
  pb.rect(9, 25, 3, 10, sleeve || top); pb.rect(28, 25, 3, 10, shade(sleeve || top, -0.15));
  pb.rect(9, 35, 3, 3, skin); pb.rect(28, 35, 3, 3, skin);
  pb.rect(13, 37, 6, 9, bottom); pb.rect(21, 37, 6, 9, shade(bottom, -0.12));
  pb.rect(12, 46, 7, 3, shoes); pb.rect(21, 46, 7, 3, shoes);
}

const ACC = {
  mallette: pb => { pb.rect(29, 37, 7, 6, '#7b4a26'); pb.rect(29, 37, 7, 1, '#9c6236'); pb.rect(31, 36, 3, 1, '#3b2414'); pb.set(32, 39, '#e8c25a'); },
  micro: pb => { pb.rect(10, 31, 1, 5, '#555'); pb.ellipse(10.5, 30, 1.6, 1.6, '#222'); pb.set(10, 29, '#888'); },
  ballon: pb => { pb.ellipse(33.5, 45.5, 3.2, 3.2, '#f4f4f4'); pb.set(33, 45, '#222'); pb.set(34, 44, '#222'); pb.set(32, 47, '#222'); pb.set(35, 47, '#222'); },
  basket: pb => { pb.ellipse(33.5, 44.5, 3.2, 3.2, '#e6782c'); pb.line(31, 44, 36, 45, '#5a2a10'); pb.line(33, 42, 34, 47, '#5a2a10'); },
  ovale: pb => { pb.ellipse(34, 40, 2.5, 4, '#8b4a2b'); pb.line(34, 38, 34, 42, '#f4f4f4'); },
  raquette: pb => { pb.ellipse(32.5, 27.5, 3.5, 4.5, '#d33'); pb.ellipse(32.5, 27.5, 2.4, 3.4, '#f4f4f4'); pb.rect(30, 32, 1, 4, '#333'); },
  casque: (pb, c) => { pb.ellipse(20, 6, 10.5, 5, c.accent); pb.rect(10, 6, 21, 2, c.accent); pb.rect(13, 3, 3, 1, '#fff'); },
  gants: pb => { pb.ellipse(10, 36, 2.6, 2.6, '#d32f2f'); pb.ellipse(29.5, 36, 2.6, 2.6, '#d32f2f'); },
  medaille: pb => { pb.line(17, 24, 20, 29, '#2f80ed'); pb.line(23, 24, 20, 29, '#2f80ed'); pb.ellipse(20, 31, 2, 2, '#f2c037'); pb.set(20, 31, '#fff2a8'); },
  fiole: pb => { pb.rect(30, 32, 2, 2, '#ddd'); pb.ellipse(31, 36, 2.5, 2.5, '#7cf5a6'); pb.set(30, 35, '#d6ffe6'); },
  livre: pb => { pb.rect(28, 33, 6, 7, '#8e2b2b'); pb.rect(29, 34, 4, 5, '#f1e4c8'); pb.rect(28, 33, 1, 7, '#5c1a1a'); },
  laptop: pb => { pb.rect(14, 30, 12, 7, '#9aa3b2'); pb.rect(15, 31, 10, 5, '#6fe3ff'); pb.rect(13, 37, 14, 2, '#6b7383'); },
  sceptre: pb => { pb.rect(31, 24, 1, 14, '#d4a017'); pb.ellipse(31, 23, 1.8, 1.8, '#e53935'); },
  epee: pb => { pb.rect(31, 22, 1, 14, '#dfe6ee'); pb.rect(32, 22, 1, 13, '#a9b4c2'); pb.rect(29, 35, 5, 1, '#8d6e2a'); pb.rect(31, 36, 1, 3, '#5b3b1a'); },
  fusil: pb => { pb.line(7, 40, 16, 27, '#4a3a2a'); pb.line(8, 40, 17, 27, '#2b2b2b'); pb.rect(6, 39, 3, 3, '#6b4a2a'); },
  guitare: (pb, c) => { pb.ellipse(17, 34, 4.5, 3.8, '#c0392b'); pb.ellipse(17, 34, 1.4, 1.4, '#2a1a10'); pb.line(20, 33, 29, 26, '#7b4a26'); pb.rect(29, 24, 2, 3, '#3b2414'); },
  pinceau: pb => { pb.ellipse(8, 38, 4, 3, '#d9b380'); pb.set(6, 37, '#e53935'); pb.set(8, 36, '#1e88e5'); pb.set(10, 37, '#43a047'); pb.set(9, 39, '#fdd835'); pb.line(31, 36, 34, 29, '#7b4a26'); pb.set(34, 28, '#e53935'); },
  beret: (pb, c) => { pb.ellipse(19, 5, 9, 3.2, c.accent2 || '#2b2b2b'); pb.rect(20, 1, 1, 2, c.accent2 || '#2b2b2b'); },
  clap: pb => { pb.rect(29, 33, 7, 5, '#222'); pb.rect(29, 31, 7, 2, '#eee'); pb.set(30, 31, '#222'); pb.set(32, 32, '#222'); pb.set(34, 31, '#222'); },
  plume: pb => { pb.line(31, 37, 35, 27, '#f4f4f4'); pb.line(32, 37, 36, 28, '#cfd8dc'); pb.set(31, 38, '#222'); },
  note: pb => { pb.rect(33, 27, 1, 8, '#222'); pb.ellipse(32, 35, 1.8, 1.3, '#222'); pb.rect(34, 27, 2, 2, '#222'); },
  aureole: pb => { for (let a = 0; a < Math.PI * 2; a += 0.1) pb.set(20 + Math.cos(a) * 7, 1.5 + Math.sin(a) * 1.5, '#f9d71c'); },
  toque: pb => { pb.rect(13, 0, 14, 5, '#fafafa'); pb.ellipse(15, 1.5, 3, 2, '#fafafa'); pb.ellipse(20, 1, 3.5, 2, '#fafafa'); pb.ellipse(25, 1.5, 3, 2, '#fafafa'); pb.rect(13, 5, 14, 2, '#e0e0e0'); },
  carte: pb => { pb.rect(28, 33, 8, 6, '#f1e4c8'); pb.line(29, 37, 33, 34, '#c0392b'); pb.set(35, 35, '#2e7d32'); },
  couronne: pb => { pb.rect(12, 2, 16, 4, '#f2c037'); [12, 16, 20, 24, 27].forEach(x => pb.rect(x, 0, 1, 2, '#f2c037')); pb.set(16, 3, '#e53935'); pb.set(20, 3, '#1e88e5'); pb.set(24, 3, '#43a047'); },
  helmet: (pb, c) => { pb.ellipse(20, 6, 11, 5.5, c.uniform); pb.rect(9, 7, 22, 2, shade(c.uniform, -0.2)); },
  antenne: pb => { pb.rect(20, 0, 1, 4, '#888'); pb.ellipse(20, 0.5, 1.5, 1.5, '#ff5252'); },
  canon: pb => { pb.rect(29, 28, 9, 4, '#4a4f5a'); pb.rect(37, 27, 2, 6, '#30343c'); },
  atome: (pb) => { pb.ellipse(20, 30, 9, 3, null); for (let a = 0; a < Math.PI * 2; a += 0.15) { pb.set(20 + Math.cos(a) * 9, 30 + Math.sin(a) * 3, '#7cf5ff'); pb.set(20 + Math.cos(a) * 3, 30 + Math.sin(a) * 9, '#7cf5ff'); } pb.ellipse(20, 30, 1.5, 1.5, '#ff5252'); },
};

const JERSEYS = ['#e63946', '#1d4ed8', '#16a34a', '#f59e0b', '#7c3aed', '#0ea5e9', '#111827', '#f4f4f4', '#db2777'];
const SUITS = ['#23283a', '#2d3a55', '#3a2f2f', '#1f3b3a', '#4a4a52'];

function drawBody(pb, card, head, c) {
  const a = card.archetype, acc = card.accessory, skin = c.skin;
  switch (a) {
    case 'costume': {
      humanoid(pb, { top: c.suit, bottom: c.suit, skin });
      for (let y = 24; y < 30; y++) { const w = Math.max(1, 6 - (y - 24)); pb.rect(20 - w / 2, y, w, 1, '#f4f4f4'); }
      pb.rect(19, 25, 2, 7, c.accent); pb.set(19, 32, shade(c.accent, -0.2)); pb.set(20, 32, shade(c.accent, -0.2));
      pb.set(14, 27, shade(c.suit, 0.25)); pb.set(25, 27, shade(c.suit, 0.25));
      (ACC[acc] || ACC.mallette)(pb, c);
      break;
    }
    case 'sportif': {
      humanoid(pb, { top: c.jersey, bottom: '#f4f4f4', skin, shoes: '#111' });
      pb.rect(13, 41, 6, 5, skin); pb.rect(21, 41, 6, 5, shade(skin, -0.1));
      pb.rect(13, 43, 6, 3, c.jersey); pb.rect(21, 43, 6, 3, c.jersey);
      pb.rect(9, 30, 3, 5, skin); pb.rect(28, 30, 3, 5, skin);
      const num = hash(card.title) % 99 + 1;
      const fg = lum(hex2rgb(c.jersey)) > 150 ? '#222' : '#fff';
      if (num >= 10) { digit(pb, Math.floor(num / 10), 16, 27, fg); digit(pb, num % 10, 20, 27, fg); } else digit(pb, num, 18, 27, fg);
      if (acc === 'casque') ACC.casque(pb, c);
      else (ACC[acc] || ACC.medaille)(pb, c);
      break;
    }
    case 'blouse': {
      humanoid(pb, { top: '#f4f6f8', bottom: '#3d4a5c', skin, sleeve: '#e6eaee' });
      pb.rect(12, 37, 16, 4, '#f4f6f8'); pb.rect(18, 24, 4, 6, c.accent); pb.rect(19, 24, 2, 13, '#d0d6dc');
      pb.rect(23, 28, 3, 2, '#5c8ad6');
      (ACC[acc] || ACC.fiole)(pb, c);
      break;
    }
    case 'hoodie': {
      pb.ellipse(20, 16, 12, 11, shade(c.main, -0.15));
      humanoid(pb, { top: c.main, bottom: '#3b4b6b', skin, shoes: '#eee' });
      pb.rect(15, 31, 10, 4, shade(c.main, -0.12)); pb.line(18, 25, 18, 29, '#eee'); pb.line(22, 25, 22, 29, '#eee');
      ACC.laptop(pb, c);
      break;
    }
    case 'royal': {
      pb.rect(7, 24, 26, 24, '#a3172a'); pb.rect(30, 25, 3, 22, '#7d0f1f');
      humanoid(pb, { top: '#5b2a86', bottom: '#5b2a86', skin, shoes: '#3b2414', sleeve: '#a3172a' });
      pb.rect(10, 23, 20, 3, '#f4f4f4'); [12, 16, 20, 24, 28].forEach(x => pb.set(x, 24, '#222'));
      pb.rect(12, 33, 16, 2, '#f2c037');
      ACC.sceptre(pb, c);
      break;
    }
    case 'tenue': {
      humanoid(pb, { top: '#6b4a2b', bottom: '#3e2c1c', skin, shoes: '#222' });
      pb.rect(17, 24, 6, 10, '#c9b07a'); pb.rect(19, 24, 2, 3, '#f4f4f4');
      (ACC[acc] || ACC.livre)(pb, c);
      break;
    }
    case 'soldat': {
      humanoid(pb, { top: c.uniform, bottom: shade(c.uniform, -0.1), skin, shoes: '#222' });
      pb.rect(12, 33, 16, 2, '#5b3b1a'); pb.set(20, 33, '#d4a017');
      pb.rect(14, 26, 3, 2, '#d4a017'); pb.rect(23, 26, 3, 2, '#d4a017');
      (ACC[acc] || ACC.fusil)(pb, c);
      break;
    }
    case 'artiste': {
      humanoid(pb, { top: c.jersey, bottom: '#2b2b38', skin, shoes: '#222' });
      pb.rect(17, 24, 6, 3, shade(c.jersey, 0.35));
      (ACC[acc] || ACC.plume)(pb, c);
      break;
    }
    case 'robe': {
      pb.rect(11, 24, 18, 24, c.robe); pb.rect(9, 46, 22, 2, c.robe); pb.rect(26, 25, 3, 22, shade(c.robe, -0.18));
      pb.rect(8, 25, 4, 10, c.robe); pb.rect(28, 25, 4, 10, shade(c.robe, -0.15));
      pb.rect(8, 35, 3, 3, skin); pb.rect(29, 35, 3, 3, skin);
      pb.rect(18, 22, 4, 2, skin); pb.rect(11, 33, 18, 1, '#f2c037');
      pb.rect(32, 20, 1, 28, '#7b4a26');
      break;
    }
    case 'chef': {
      humanoid(pb, { top: '#fafafa', bottom: '#2b2b38', skin, shoes: '#222', sleeve: '#f0f0f0' });
      [26, 29, 32].forEach(y => { pb.set(17, y, '#999'); pb.set(22, y, '#999'); });
      pb.rect(13, 24, 14, 2, c.accent);
      pb.ellipse(32, 36, 3, 1.5, '#9aa0a6');
      break;
    }
    case 'explorateur': {
      humanoid(pb, { top: '#b59a63', bottom: '#8a7247', skin, shoes: '#5b3b1a' });
      pb.rect(5, 26, 5, 9, '#6b4a2b');
      pb.rect(14, 26, 3, 3, '#8a7247'); pb.rect(23, 26, 3, 3, '#8a7247');
      (ACC[acc] || ACC.carte)(pb, c);
      break;
    }
    case 'animal': {
      const body = c.main;
      pb.ellipse(25, 31, 11, 7.5, body);
      pb.ellipse(28, 34, 8, 4, shade(body, -0.15));
      for (const x of [16, 20, 29, 33]) pb.rect(x, 36, 3, 9, x > 25 ? shade(body, -0.2) : body);
      for (const x of [16, 20, 29, 33]) pb.rect(x, 45, 3, 2, shade(body, -0.4));
      pb.line(36, 28, 39, 22, body); pb.line(37, 28, 39, 23, body);
      break;
    }
    case 'oiseau': {
      const body = c.main, dark = shade(body, -0.25);
      // Queue, corps, ventre clair, aile repliée, pattes fines.
      for (let k = 0; k < 6; k++) pb.rect(30 + k, 30 + Math.floor(k / 2), 2, 5 - Math.floor(k / 2), k % 2 ? dark : body);
      pb.ellipse(21, 33, 10, 8, body);
      pb.ellipse(18, 36, 6, 4, shade(body, 0.3));
      pb.ellipse(25, 32, 6, 5, dark);
      for (let y = 29; y < 37; y += 2) pb.line(21, y, 29, y + 2, shade(dark, -0.2));
      for (const x of [17, 23]) { pb.rect(x, 41, 1, 6, '#e0a030'); pb.rect(x - 1, 47, 3, 1, '#c07a18'); }
      break;
    }
    case 'poisson': {
      const body = c.main, dark = shade(body, -0.25);
      // Nageoires, corps ovale, écailles, bulles.
      for (let k = 0; k < 7; k++) pb.rect(33 + k, 30 - k, 1, 2 * k + 3, k % 2 ? dark : body);
      pb.ellipse(21, 31, 13, 9, body);
      pb.ellipse(22, 36, 10, 4, shade(body, 0.25));
      for (let k = 0; k < 8; k++) pb.rect(16 + k, 22 - Math.floor(k / 3), 1, 2 + Math.floor(k / 3), dark);
      for (let y = 27; y < 35; y += 3) for (let x = 24 + (y % 2) * 2; x < 32; x += 4) pb.set(x, y, dark);
      pb.ellipse(22, 40, 3, 2, dark);
      pb.ellipse(4, 12, 1.5, 1.5, '#bfe8ff'); pb.ellipse(7, 7, 1, 1, '#bfe8ff');
      break;
    }
    case 'plante': {
      pb.rect(19, 22, 2, 18, '#2e7d32');
      pb.ellipse(14, 30, 5, 2.5, '#43a047'); pb.ellipse(26, 27, 5, 2.5, '#388e3c'); pb.ellipse(15, 36, 4, 2, '#66bb6a');
      pb.rect(11, 39, 18, 3, '#b5562f'); pb.rect(12, 42, 16, 7, '#c8693b'); pb.rect(25, 42, 3, 7, '#a24e26');
      break;
    }
    case 'golem': {
      const mat = acc === 'eau' ? '#3a8fd6' : acc === 'neige' ? '#8d939b' : c.stone;
      pb.rect(9, 23, 22, 17, mat); pb.rect(27, 24, 4, 16, shade(mat, -0.2));
      pb.rect(4, 24, 5, 13, mat); pb.rect(31, 24, 5, 13, shade(mat, -0.2));
      pb.rect(3, 37, 7, 5, shade(mat, -0.1)); pb.rect(30, 37, 7, 5, shade(mat, -0.25));
      pb.rect(11, 40, 7, 8, mat); pb.rect(22, 40, 7, 8, shade(mat, -0.15));
      if (acc === 'eau') { for (let y = 26; y < 40; y += 4) pb.line(11, y, 27, y + 1, '#8fd3ff'); }
      else {
        for (let y = 26; y < 40; y += 4) for (let x = 10 + ((y / 4) % 2) * 3; x < 30; x += 6) pb.rect(x, y, 1, 3, shade(mat, -0.3));
        if (acc === 'neige') { pb.rect(4, 23, 5, 2, '#fafafa'); pb.rect(31, 23, 5, 2, '#fafafa'); pb.rect(9, 22, 22, 2, '#fafafa'); }
      }
      break;
    }
    case 'robot': {
      const m = '#9aa3b2';
      pb.rect(10, 23, 20, 15, m); pb.rect(27, 24, 3, 14, shade(m, -0.2));
      pb.rect(14, 26, 12, 7, '#2a3140'); pb.set(16, 28, '#ff5252'); pb.set(19, 28, '#ffd740'); pb.set(22, 28, '#69f0ae');
      pb.rect(16, 30, 8, 1, '#6fe3ff');
      pb.rect(6, 24, 4, 12, shade(m, -0.1)); pb.rect(30, 24, 4, 12, shade(m, -0.25));
      pb.rect(13, 38, 5, 8, shade(m, -0.15)); pb.rect(22, 38, 5, 8, shade(m, -0.3));
      pb.rect(11, 46, 9, 3, '#4a4f5a'); pb.rect(20, 46, 9, 3, '#4a4f5a');
      [11, 28].forEach(x => pb.set(x, 24, '#5d6470'));
      if (acc === 'canon') ACC.canon(pb, c);
      break;
    }
    case 'esprit': {
      const m = c.robe;
      pb.ellipse(20, 32, 10, 10, m);
      for (let x = 10; x <= 30; x++) { const h = 40 + Math.round(Math.sin(x / 1.6) * 2); pb.rect(x, 38, 1, h - 38 + 4, m); }
      pb.rect(26, 26, 3, 14, shade(m, -0.15));
      pb.ellipse(8, 31, 3, 2, m); pb.ellipse(32, 31, 3, 2, shade(m, -0.15));
      if (acc === 'atome') ACC.atome(pb, c);
      break;
    }
    default: { // mascotte
      const m = c.main;
      pb.ellipse(20, 34, 11, 10, m); pb.ellipse(23, 36, 7, 7, shade(m, -0.12)); pb.ellipse(18, 31, 4, 3, shade(m, 0.2));
      pb.ellipse(7, 33, 3, 3, '#fafafa'); pb.ellipse(33, 33, 3, 3, '#e8e8e8');
      pb.rect(13, 43, 5, 4, shade(m, -0.3)); pb.rect(22, 43, 5, 4, shade(m, -0.3));
      pb.rect(11, 47, 8, 2, '#2a2230'); pb.rect(21, 47, 8, 2, '#2a2230');
      if (ACC[acc] && acc !== 'gants') ACC[acc](pb, c);
    }
  }
}

function drawHead(pb, card, head, c) {
  const a = card.archetype;
  const shape = card.person ? 'round' : ['animal', 'plante', 'oiseau', 'poisson'].includes(a) ? 'circle' : 'square';
  const [hx, hy] = { animal: [2, 12], oiseau: [5, 10], poisson: [4, 18] }[a] || [HX, HY];
  if (a === 'oiseau') { // bec et petite huppe
    for (let k = 0; k < 3; k++) pb.rect(hx - 3 + k, hy + 10 - Math.floor(k / 2), 3 - k, 3, '#f0a020');
    pb.rect(hx + 9, hy - 2, 2, 3, shade(c.main, -0.25)); pb.rect(hx + 12, hy - 1, 2, 2, shade(c.main, -0.25));
  }
  if (card.archetype === 'animal') { pb.ellipse(hx + 3, hy + 1, 3, 4, shade(c.main, -0.2)); pb.ellipse(hx + 16, hy + 1, 3, 4, shade(c.main, -0.2)); }
  if (card.archetype === 'golem') pb.rect(hx - 1, hy - 1, HS + 2, HS + 2, shade(c.stone, -0.25));
  if (card.archetype === 'robot') pb.rect(hx - 1, hy - 1, HS + 2, HS + 2, '#6b7383');
  for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) {
    const col = head[y * HS + x];
    if (col && MASKS[shape](x, y)) pb.set(hx + x, hy + y, col);
  }
  return { hx, hy, shape };
}

function headwear(pb, card, c) {
  const acc = card.accessory, a = card.archetype;
  if (a === 'royal') ACC.couronne(pb, c);
  if (a === 'soldat') ACC.helmet(pb, c);
  if (a === 'artiste' && acc === 'pinceau') ACC.beret(pb, c);
  if (a === 'chef') ACC.toque(pb, c);
  if (acc === 'aureole') ACC.aureole(pb, c);
  if (a === 'robot' && acc !== 'canon') ACC.antenne(pb, c);
}

// ---------- API ----------
const cache = new Map();

export function renderSprite(card) {
  if (cache.has(card.id)) return cache.get(card.id);
  const p = (async () => {
    let head;
    try { head = card.image ? await imageHead(card) : null; } catch { head = null; }
    if (!head) head = card.person ? faceHead(card) : emojiHead(card);
    const r = rng(card.title + ':colors');
    const accent = TYPES[card.type]?.color || '#888';
    const dom = dominant(head);
    // Couleur de peau : moyenne du bas du visage sur la photo.
    let skin = SKINS[Math.floor(r() * 3)];
    if (card.person && card.image) {
      const samples = [];
      for (let y = 9; y < 15; y++) for (let x = 7; x < 13; x++) { const p = head[y * HS + x]; if (p) samples.push(hex2rgb(p)); }
      if (samples.length) {
        samples.sort((a, b) => lum(a) - lum(b));
        const m = samples[Math.floor(samples.length / 2)];
        if (lum(m) > 50) skin = rgb2hex(...m);
      }
    }
    const c = {
      accent, skin,
      main: dom || accent,
      suit: SUITS[Math.floor(r() * SUITS.length)],
      jersey: card.archetype === 'artiste' ? shade(accent, -0.1) : JERSEYS[Math.floor(r() * JERSEYS.length)],
      uniform: r() < 0.5 ? '#55663a' : '#2c4a7a',
      robe: card.archetype === 'esprit' ? shade(accent, 0.15) : ['#f4f4f4', '#7e57c2', '#6d4c41', '#1565c0'][Math.floor(r() * 4)],
      stone: ['#9e9283', '#8d8378', '#a89a7d'][Math.floor(r() * 3)],
      accent2: '#2b2b2b',
    };
    const pb = new PB(SW, SH);
    drawBody(pb, card, head, c);
    const pos = drawHead(pb, card, head, c);
    headwear(pb, card, c);
    pb.outline(OUTLINE);
    const cv = pb.toCanvas();
    if (head.photo) cv.photo = { ...head.photo, ...pos };
    return cv;
  })();
  cache.set(card.id, p);
  return p;
}

// Dessine le sprite dans un canvas d'affichage, agrandi sans flou.
export async function paintSprite(target, card, scale = 3, { flip = false } = {}) {
  target.width = SW * scale;
  target.height = SH * scale;
  target.classList.add('sprite');
  const src = await renderSprite(card);
  const ctx = target.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.save();
  if (flip) { ctx.translate(target.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, 0, 0, SW * scale, SH * scale);
  // La photo de la page reste nette, par-dessus la tête pixelisée.
  const ph = src.photo;
  if (ph) {
    const x = ph.hx * scale, y = ph.hy * scale, s = HS * scale;
    ctx.save();
    ctx.beginPath();
    if (ph.shape === 'square') ctx.rect(x, y, s, s);
    else ctx.ellipse(x + s / 2, y + s / 2, s / 2 - scale * 0.5, s / 2 - scale * 0.5, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ph.img, ph.sx, ph.sy, ph.side, ph.side, x, y, s, s);
    ctx.restore();
  }
  ctx.restore();
}

export function spriteCanvas(card, scale = 3, opts) {
  const cv = document.createElement('canvas');
  cv.width = SW * scale; cv.height = SH * scale;
  cv.className = 'sprite';
  paintSprite(cv, card, scale, opts);
  return cv;
}
