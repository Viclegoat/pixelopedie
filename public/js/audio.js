// Sons et musique de Pixelopédie.
// Tout est synthétisé en direct, comme sur une console 8 bits : ondes carrées, triangle et bruit blanc.
// Aucun fichier audio à télécharger, et la bande originale est composée pour le jeu.

// ---------- Réglages (gardés dans le navigateur) ----------
const KEY = 'pxp_audio';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
export const settings = { music: saved.music ?? 0.55, sfx: saved.sfx ?? 0.75, muted: !!saved.muted };
function persist() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* stockage bloqué */ } }

let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
let unlocked = false, wanted = null, cur = null;
const trackListeners = new Set();

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  // Un compresseur en sortie évite la saturation quand beaucoup de sons se superposent.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
  master = ctx.createGain();
  master.connect(comp); comp.connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes(true);
  return ctx;
}

function applyVolumes(instant = false) {
  if (!ctx) return;
  const t = ctx.currentTime, k = instant ? 0.001 : 0.04;
  master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, k);
  musicBus.gain.setTargetAtTime(settings.music ** 2 * 1.2, t, k);
  sfxBus.gain.setTargetAtTime(settings.sfx ** 2 * 1.4, t, k);
}

export function setVolume(kind, v) { settings[kind] = Math.max(0, Math.min(1, v)); persist(); applyVolumes(); }
export function setMuted(m) { settings.muted = !!m; persist(); applyVolumes(); }

// Les navigateurs n'autorisent le son qu'après un premier clic ou une touche.
function unlock() {
  if (!init()) return;
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
  if (!unlocked) { unlocked = true; if (wanted) startTrack(wanted); }
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true, passive: true });
// Onglet caché : on coupe tout (et on reprend au retour).
document.addEventListener('visibilitychange', () => {
  if (!ctx || !unlocked) return;
  if (document.hidden) ctx.suspend(); else ctx.resume();
});
const ready = () => ctx && unlocked && ctx.state === 'running';

// ---------- Instruments ----------
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteMidi(n) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) throw new Error('Note inconnue : ' + n);
  return 12 * (+m[3] + 1) + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

const waveCache = {};
function pulseWave(duty) {
  if (waveCache[duty]) return waveCache[duty];
  const n = 48, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    re[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
    im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI);
  }
  return (waveCache[duty] = ctx.createPeriodicWave(re, im));
}
function makeOsc(type, f, t) {
  const o = ctx.createOscillator();
  if (type === 'pulse25') o.setPeriodicWave(pulseWave(0.25));
  else if (type === 'pulse12') o.setPeriodicWave(pulseWave(0.125));
  else o.type = type;
  o.frequency.setValueAtTime(f, t);
  return o;
}
// Enveloppe attaque / déclin / maintien / relâche. Renvoie l'instant où le son est fini.
function envelope(g, t, { a = 0.004, d = 0.06, s = 0.6, dur = 0.15, r = 0.05, v = 0.2 }) {
  const hold = Math.max(dur, a + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + a);
  g.gain.linearRampToValueAtTime(v * s, t + a + d);
  g.gain.setValueAtTime(v * s, t + hold);
  g.gain.linearRampToValueAtTime(0.0001, t + hold + r);
  return t + hold + r;
}
function tone({ type = 'square', f, t, dur = 0.1, v = 0.15, a, d, s, r, to, lin = false, vib = 0, vibRate = 6, bus }) {
  t ??= ctx.currentTime + 0.005;
  const o = makeOsc(type, f, t), g = ctx.createGain();
  if (to) lin ? o.frequency.linearRampToValueAtTime(to, t + dur) : o.frequency.exponentialRampToValueAtTime(Math.max(5, to), t + dur);
  const end = envelope(g, t, { a, d, s, dur, r, v });
  if (vib) {
    const l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = vibRate; lg.gain.value = f * vib;
    l.connect(lg); lg.connect(o.frequency);
    l.start(t); l.stop(end + 0.02);
  }
  o.connect(g); g.connect(bus || sfxBus);
  o.start(t); o.stop(end + 0.02);
}
function noise({ t, dur = 0.15, v = 0.15, a = 0.003, d = 0.05, s = 0.5, r = 0.05, type = 'bandpass', f = 1200, to, q = 1, rate = 1, bus }) {
  t ??= ctx.currentTime + 0.005;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = rate;
  const fl = ctx.createBiquadFilter();
  fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
  if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  const end = envelope(g, t, { a, d, s, dur, r, v });
  src.connect(fl); fl.connect(g); g.connect(bus || sfxBus);
  src.start(t, Math.random() * 0.5); src.stop(end + 0.02);
}
// Batterie
const kick = (t, v = 0.3, bus) => tone({ type: 'sine', f: 150, to: 42, t, dur: 0.12, v, a: 0.002, d: 0.1, s: 0.3, r: 0.05, bus });
const snare = (t, v = 0.13, bus) => { noise({ t, dur: 0.09, v, type: 'highpass', f: 1500, d: 0.06, s: 0.3, r: 0.05, bus }); tone({ type: 'triangle', f: 210, to: 140, t, dur: 0.05, v: v * 0.8, bus }); };
const hat = (t, v = 0.04, bus) => noise({ t, dur: 0.02, v, type: 'highpass', f: 7500, d: 0.015, s: 0.2, r: 0.02, bus });

// ---------- Bande originale ----------
// Notation : « note:durée » en doubles croches (2 = croche, 4 = noire), « - » pour un silence.
// Une mesure = 16 doubles croches. Les accords donnent la basse et les arpèges.
const TRACKS = {
  menu: {
    title: 'Page au hasard', bpm: 112, lead: 'pulse25', leadV: 0.11, echo: 3, bass: 'walk', arp: 'arp8',
    drums: { k: 'x.......x.......', s: '....x.......x...', h: '..x...x...x...x.' }, snareV: 0.07,
    chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G', 'F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'C'],
    melody: `E5:2 G5:2 C6:4 B5:2 G5:2 E5:4 | D5:2 G5:2 B5:4 A5:2 G5:2 D5:4 | C5:2 E5:2 A5:4 G5:2 E5:2 C5:2 E5:2 | F5:6 E5:2 D5:2 C5:2 A4:4
             E5:2 G5:2 C6:4 D6:2 C6:2 G5:4 | B5:2 A5:2 G5:2 D5:2 G5:4 B5:4 | A5:4 G5:2 F5:2 C5:4 F5:4 | G5:8 -:4 D5:2 F5:2
             A5:4 C6:4 A5:2 G5:2 F5:4 | G5:4 B5:4 D6:4 B5:2 G5:2 | E5:2 G5:2 B5:4 A5:2 G5:2 E5:4 | A5:6 G5:2 E5:4 C5:4
             D5:2 F5:2 A5:4 C6:4 A5:4 | B5:4 D6:4 B5:2 A5:2 G5:4 | C6:8 G5:4 E5:4 | C5:4 -:8 C5:2 D5:2`,
  },
  battle: {
    title: 'Duel encyclopédique', bpm: 150, lead: 'pulse25', leadV: 0.11, echo: 3, bass: 'drive', arp: 'arp16', fill: true,
    drums: { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    chords: ['Am', 'Am', 'F', 'G', 'Am', 'Am', 'Dm', 'E', 'F', 'G', 'Em', 'Am', 'F', 'G', 'E', 'E'],
    melody: `A4:2 A4:1 C5:1 E5:2 A5:2 G5:2 E5:2 C5:2 E5:2 | D5:2 E5:2 C5:2 A4:2 B4:4 C5:2 B4:2 | A4:2 A4:1 C5:1 F5:2 A5:2 G5:2 F5:2 E5:2 F5:2 | G5:4 D5:2 B4:2 G4:4 B4:2 D5:2
             E5:2 A5:2 C6:2 B5:2 A5:2 E5:2 C5:2 E5:2 | A5:6 B5:2 C6:2 B5:2 A5:2 G5:2 | F5:2 A5:2 D6:4 C6:2 A5:2 F5:2 D5:2 | E5:4 G#5:4 B5:4 E5:2 G#5:2
             C6:4 A5:2 F5:2 C5:2 F5:2 A5:2 C6:2 | B5:4 G5:2 D5:2 B4:2 D5:2 G5:2 B5:2 | E5:2 G5:2 B5:2 E6:2 D6:2 B5:2 G5:2 B5:2 | C6:6 B5:2 A5:4 E5:4
             F5:2 A5:2 C6:4 D6:2 C6:2 A5:4 | G5:2 B5:2 D6:4 E6:2 D6:2 B5:4 | G#5:4 B5:4 E6:4 D6:2 B5:2 | B5:8 G#5:4 E5:4`,
  },
  boss: {
    title: 'Page protégée', bpm: 138, lead: 'pulse12', leadV: 0.12, echo: 2, bass: 'pulse', arp: 'arp16', fill: true,
    drums: { k: 'x..x..x.x..x..x.', s: '....x.......x..x', h: 'x.xxx.xxx.xxx.xx' },
    chords: ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Dm', 'Gm', 'A', 'Gm', 'Gm', 'Dm', 'Dm', 'Bb', 'C', 'A', 'A'],
    melody: `D5:4 -:2 D5:1 D5:1 F5:2 E5:2 D5:2 C#5:2 | D5:2 A4:2 F4:2 A4:2 D5:4 E5:4 | F5:4 -:2 F5:1 F5:1 Bb5:2 A5:2 G5:2 F5:2 | E5:4 C#5:4 A4:4 E5:2 C#5:2
             A5:4 -:2 A5:1 A5:1 D6:2 C6:2 A5:2 F5:2 | G5:2 F5:2 E5:2 D5:2 F5:4 A5:4 | Bb5:4 A5:2 G5:2 D5:4 G5:4 | A5:4 G5:2 F5:2 E5:4 C#5:4
             D5:2 G5:2 Bb5:2 D6:2 C6:2 Bb5:2 A5:2 G5:2 | Bb5:6 A5:2 G5:4 D5:4 | F5:2 A5:2 D6:2 F6:2 E6:2 D6:2 C6:2 A5:2 | D6:8 C6:4 A5:4
             Bb5:4 D6:4 F6:4 D6:4 | C6:4 E6:4 G6:4 E6:4 | C#6:4 E6:4 A6:4 G6:2 E6:2 | C#6:8 A5:4 E5:4`,
  },
  tower: {
    title: 'Ascension', bpm: 144, lead: 'pulse25', leadV: 0.11, echo: 3, bass: 'drive', arp: 'arp8', fill: true,
    drums: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    chords: ['Em', 'C', 'D', 'Bm', 'Em', 'C', 'D', 'B', 'C', 'D', 'Em', 'Em', 'C', 'D', 'B7', 'B'],
    melody: `E5:2 G5:2 B5:2 E6:2 D6:2 B5:2 G5:2 B5:2 | C6:4 G5:2 E5:2 C5:4 E5:2 G5:2 | F#5:2 A5:2 D6:4 C6:2 A5:2 F#5:4 | B5:6 A5:2 F#5:4 D5:4
             G5:2 B5:2 E6:4 F#6:2 E6:2 B5:4 | C6:2 E6:2 G6:4 E6:2 C6:2 G5:4 | A5:2 D6:2 F#6:4 E6:2 D6:2 A5:4 | B5:4 D#6:4 F#6:4 D#6:4
             E6:4 D6:2 C6:2 G5:4 C6:4 | F#6:4 E6:2 D6:2 A5:4 D6:4 | G6:4 F#6:2 E6:2 B5:4 E6:4 | E6:8 D6:4 B5:4
             C6:2 E6:2 G6:2 E6:2 C6:2 G5:2 E5:2 G5:2 | D6:2 F#6:2 A6:2 F#6:2 D6:2 A5:2 F#5:2 A5:2 | B5:4 D#6:4 F#6:4 A6:4 | F#6:8 D#6:4 B5:4`,
  },
};

// Jingles joués une seule fois (fin de combat).
const JINGLES = {
  victory: { bpm: 170, voices: [
    { w: 'pulse25', v: 0.13, n: 'G4:2 C5:2 E5:2 G5:4 E5:2 G5:2 C6:12' },
    { w: 'pulse12', v: 0.06, n: 'E4:2 G4:2 C5:2 E5:4 C5:2 E5:2 G5:12' },
    { w: 'triangle', v: 0.24, n: 'C3:2 C3:2 C3:2 C3:4 G2:2 G2:2 C3:12' },
  ] },
  defeat: { bpm: 110, voices: [
    { w: 'pulse25', v: 0.12, n: 'A4:3 E4:3 C4:3 B3:3 A3:12', vib: true },
    { w: 'triangle', v: 0.22, n: 'A2:6 E2:6 A2:12' },
  ] },
  draw: { bpm: 140, voices: [
    { w: 'pulse25', v: 0.12, n: 'C5:2 D5:2 E5:2 D5:2 C5:8' },
    { w: 'triangle', v: 0.22, n: 'C3:8 G2:8' },
  ] },
};

const QUAL = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6], sus4: [0, 5, 7], 5: [0, 7] };
function parseChord(c) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(c);
  const root = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return { root: (root + 12) % 12, iv: QUAL[m[3]] || QUAL[''] };
}
function parseNotes(str) {
  const out = [];
  let pos = 0;
  for (const tok of str.replace(/\|/g, ' ').trim().split(/\s+/)) {
    const [n, l] = tok.split(':');
    const len = +l || 2;
    if (n !== '-') out.push({ pos, m: noteMidi(n), len });
    pos += len;
  }
  return { notes: out, length: pos };
}

const BASS = {
  walk: [[0, 0, 4], [4, 7, 4], [8, 12, 4], [12, 7, 4]],
  drive: [[0, 0, 2], [2, 0, 2], [4, 12, 2], [6, 0, 2], [8, 0, 2], [10, 0, 2], [12, 12, 2], [14, 0, 2]],
  pulse: [[0, 0, 3], [3, 0, 3], [6, 12, 2], [8, 0, 3], [11, 0, 3], [14, 12, 2]],
};
const compiled = {};
function compile(name) {
  if (compiled[name]) return compiled[name];
  const def = TRACKS[name];
  const chords = def.chords.map(parseChord);
  const total = chords.length * 16;
  const steps = Array.from({ length: total }, () => []);
  const { notes, length } = parseNotes(def.melody);
  if (length !== total) console.warn(`[musique] ${name} : mélodie de ${length} pas pour ${total} pas d'accords`);
  for (const n of notes) {
    steps[n.pos % total].push({ ch: 'lead', m: n.m, len: n.len });
    if (def.echo) steps[(n.pos + def.echo) % total].push({ ch: 'echo', m: n.m, len: n.len });
  }
  chords.forEach((c, bar) => {
    const s0 = bar * 16;
    let root = 36 + c.root; if (root < 40) root += 12;
    for (const [st, iv, len] of BASS[def.bass]) steps[s0 + st].push({ ch: 'bass', m: root + iv, len });
    const tones = c.iv.slice(0, 3).map(iv => 60 + c.root + iv + (c.root > 7 ? 0 : 12));
    const order = [0, 1, 2, 1];
    if (def.arp === 'arp16') for (let i = 0; i < 16; i++) steps[s0 + i].push({ ch: 'arp', m: tones[order[i % 4]], len: 1 });
    if (def.arp === 'arp8') for (let i = 0; i < 16; i += 2) steps[s0 + i].push({ ch: 'arp', m: tones[order[(i / 2) % 4]], len: 2 });
    // Roulement de caisse claire à la fin de chaque phrase de 8 mesures.
    const fillBar = def.fill && bar % 8 === 7;
    const sn = fillBar ? '....x...x.x.xxxx' : def.drums.s;
    for (let i = 0; i < 16; i++) {
      if (def.drums.k[i] === 'x') steps[s0 + i].push({ ch: 'kick' });
      if (sn[i] === 'x') steps[s0 + i].push({ ch: 'snare' });
      if (def.drums.h[i] === 'x') steps[s0 + i].push({ ch: 'hat' });
    }
  });
  return (compiled[name] = { ...def, name, total, steps, sd: 60 / def.bpm / 4 });
}

function playEvent(tr, e, t) {
  const d = tr.def, bus = tr.g, len = (e.len || 1) * d.sd;
  switch (e.ch) {
    case 'lead': tone({ type: d.lead, f: mtof(e.m), t, dur: len * 0.88, v: d.leadV, a: 0.005, d: 0.08, s: 0.65, r: 0.04, vib: e.len >= 6 ? 0.006 : 0, bus }); break;
    case 'echo': tone({ type: 'pulse12', f: mtof(e.m), t, dur: len * 0.7, v: d.leadV * 0.3, a: 0.005, d: 0.05, s: 0.5, r: 0.03, bus }); break;
    case 'bass': tone({ type: 'triangle', f: mtof(e.m), t, dur: len * 0.82, v: 0.26, a: 0.003, d: 0.05, s: 0.85, r: 0.03, bus }); break;
    case 'arp': tone({ type: 'pulse12', f: mtof(e.m), t, dur: len * 0.6, v: 0.032, a: 0.002, d: 0.03, s: 0.4, r: 0.02, bus }); break;
    case 'kick': kick(t, 0.28, bus); break;
    case 'snare': snare(t, d.snareV ?? 0.11, bus); break;
    case 'hat': hat(t, 0.035, bus); break;
  }
}

function pumpTrack(tr) {
  if (tr !== cur || ctx.state !== 'running') return;
  if (tr.next < ctx.currentTime - 0.1) tr.next = ctx.currentTime + 0.05; // rattrapage après une pause
  const ahead = ctx.currentTime + 0.15;
  while (tr.next < ahead) {
    for (const e of tr.def.steps[tr.step]) playEvent(tr, e, tr.next);
    tr.next += tr.def.sd;
    tr.step = (tr.step + 1) % tr.def.total;
  }
}
function startTrack(name) {
  if (!ctx || !unlocked) return;
  if (cur?.name === name) return;
  stopTrack(0.6);
  if (!TRACKS[name]) return;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.5);
  g.connect(musicBus);
  const tr = { name, def: compile(name), g, step: 0, next: ctx.currentTime + 0.08 };
  tr.timer = setInterval(() => pumpTrack(tr), 25);
  cur = tr;
  pumpTrack(tr);
  trackListeners.forEach(fn => fn(name));
}
function stopTrack(fade = 0.6) {
  if (!cur) return;
  const tr = cur;
  cur = null;
  clearInterval(tr.timer);
  const t = ctx.currentTime;
  tr.g.gain.cancelScheduledValues(t);
  tr.g.gain.setValueAtTime(tr.g.gain.value, t);
  tr.g.gain.linearRampToValueAtTime(0.0001, t + fade);
  setTimeout(() => tr.g.disconnect(), (fade + 0.5) * 1000);
  trackListeners.forEach(fn => fn(null));
}

export const music = {
  play(name) { wanted = name; if (ready() || unlocked) startTrack(name); },
  stop() { wanted = null; if (ctx) stopTrack(0.6); },
  get current() { return cur?.name || null; },
  title(name) { return TRACKS[name]?.title || ''; },
  onChange(fn) { trackListeners.add(fn); return () => trackListeners.delete(fn); },
};

export function jingle(name) {
  wanted = null;
  if (!ctx) return;
  stopTrack(0.25);
  if (!ready() || !JINGLES[name]) return;
  const j = JINGLES[name], sd = 60 / j.bpm / 4, t0 = ctx.currentTime + 0.3;
  for (const vc of j.voices) {
    for (const n of parseNotes(vc.n).notes) {
      tone({ type: vc.w, f: mtof(n.m), t: t0 + n.pos * sd, dur: n.len * sd * 0.9, v: vc.v, a: 0.004, d: 0.08, s: 0.7, r: 0.12, vib: vc.vib && n.len >= 6 ? 0.012 : 0, bus: musicBus });
    }
  }
}

// ---------- Bruitages ----------
const now = (ms = 0) => ctx.currentTime + 0.005 + ms / 1000;
function arp(midis, gapMs, opts = {}, startMs = 0) {
  midis.forEach((m, i) => tone({ type: 'pulse25', dur: gapMs / 1000 * 1.1, v: 0.1, ...opts, f: mtof(m), t: now(startMs + i * gapMs) }));
}
const R = () => Math.random();

const SFX = {
  click: () => tone({ type: 'pulse25', f: 660, to: 990, dur: 0.03, v: 0.09, d: 0.02, s: 0.5, r: 0.02 }),
  select: () => arp([72, 79], 45, { v: 0.1 }),
  error: () => { tone({ type: 'square', f: 190, dur: 0.08, v: 0.09 }); tone({ type: 'square', f: 140, t: now(100), dur: 0.14, v: 0.09 }); },
  notify: () => arp([76, 79, 84], 50, { v: 0.08 }),
  coin: () => arp([81, 88, 93], 55, { type: 'pulse25', v: 0.1, d: 0.12, s: 0.3 }),

  // Packs
  packAppear: () => { for (let i = 0; i < 10; i++) noise({ t: now(i * 45), dur: 0.02, v: 0.05 + i * 0.006, type: 'highpass', f: 2500, r: 0.02 }); },
  packOpen: () => {
    noise({ dur: 0.25, v: 0.2, type: 'bandpass', f: 1500, to: 6000, q: 0.8, d: 0.1, s: 0.6 });
    arp([60, 64, 67, 72, 76, 79, 84], 45, { type: 'pulse25', v: 0.09 }, 120);
  },
  flip: () => noise({ dur: 0.06, v: 0.12, type: 'bandpass', f: 2500, to: 5000, q: 1.5, r: 0.03 }),
  reveal: ({ rarity = 0 }) => {
    const sets = [[72], [72, 76], [72, 76, 79], [72, 76, 79, 84], [67, 72, 76, 79, 84, 88, 91, 96]];
    arp(sets[rarity] || sets[0], rarity >= 4 ? 60 : 55, { type: rarity >= 3 ? 'pulse25' : 'triangle', v: rarity >= 3 ? 0.1 : 0.15 }, 40);
    if (rarity >= 3) for (let i = 0; i < 8; i++) tone({ type: 'sine', f: 2000 + R() * 2500, t: now(250 + i * 50), dur: 0.05, v: 0.04 });
    if (rarity >= 4) {
      for (const m of [72, 76, 79, 84]) tone({ type: 'pulse12', f: mtof(m), t: now(520), dur: 0.9, v: 0.06, d: 0.2, s: 0.7, r: 0.4, vib: 0.008 });
      noise({ t: now(500), dur: 0.8, v: 0.04, type: 'highpass', f: 6000, s: 0.4, r: 0.4 });
    }
  },

  // Combat
  enter: () => { tone({ type: 'pulse25', f: 220, to: 880, dur: 0.16, v: 0.08 }); tone({ type: 'sine', f: 1760, t: now(150), dur: 0.08, v: 0.06 }); },
  hit: () => { noise({ dur: 0.1, v: 0.28, type: 'lowpass', f: 2200, to: 300, d: 0.06, s: 0.4 }); tone({ type: 'square', f: 320, to: 60, dur: 0.1, v: 0.12 }); },
  hitSuper: () => {
    noise({ dur: 0.18, v: 0.38, type: 'lowpass', f: 3500, to: 200, d: 0.1, s: 0.5 });
    tone({ type: 'square', f: 520, to: 45, dur: 0.18, v: 0.16 });
    noise({ t: now(40), dur: 0.08, v: 0.15, type: 'highpass', f: 3000 });
  },
  hitWeak: () => noise({ dur: 0.07, v: 0.16, type: 'lowpass', f: 700, to: 200 }),
  crit: () => { tone({ type: 'triangle', f: 1760, dur: 0.05, v: 0.12 }); tone({ type: 'triangle', f: 2637, t: now(50), dur: 0.12, v: 0.1 }); },
  miss: () => noise({ dur: 0.22, v: 0.14, type: 'bandpass', f: 3500, to: 500, q: 2 }),
  heal: () => { arp([72, 76, 79, 84, 88], 60, { type: 'triangle', v: 0.13 }); noise({ t: now(100), dur: 0.4, v: 0.03, type: 'highpass', f: 7000 }); },
  drain: () => tone({ type: 'sine', f: 900, to: 260, dur: 0.38, v: 0.12, vib: 0.05, vibRate: 18 }),
  buffUp: () => arp([67, 71, 74, 79], 50, { type: 'pulse25', v: 0.09 }),
  buffDown: () => arp([79, 74, 71, 67], 55, { type: 'pulse25', v: 0.09 }),
  polemique: () => {
    tone({ type: 'sawtooth', f: 70, dur: 0.6, v: 0.1, vib: 0.2, vibRate: 11 });
    for (let i = 0; i < 4; i++) tone({ type: 'square', f: 300 + R() * 300, to: 150, t: now(150 + i * 110), dur: 0.07, v: 0.06 });
  },
  censure: ({ short } = {}) => {
    if (!short) { kick(now(0), 0.35); noise({ dur: 0.08, v: 0.2, type: 'lowpass', f: 1200 }); }
    tone({ type: 'sine', f: 1000, t: now(short ? 0 : 220), dur: 0.28, v: 0.09, a: 0.002, d: 0.01, s: 1, r: 0.01 });
  },
  burn: () => { noise({ dur: 0.35, v: 0.06, type: 'lowpass', f: 900 }); for (let i = 0; i < 7; i++) noise({ t: now(R() * 380), dur: 0.012, v: 0.12, type: 'highpass', f: 3000 + R() * 3000, r: 0.01 }); },
  cure: () => arp([84, 88], 70, { type: 'triangle', v: 0.12 }),
  faint: () => { tone({ type: 'pulse25', f: 620, to: 70, dur: 0.6, v: 0.11 }); noise({ t: now(350), dur: 0.35, v: 0.08, type: 'lowpass', f: 900, to: 200 }); },
};

export function sfx(name, opts) {
  if (!ready() || !SFX[name]) return;
  try { SFX[name](opts || {}); } catch (e) { console.error('[son]', e); }
}

// Un son de lancement pour chaque animation d'attaque (voir fx.js). Les délais suivent les animations.
const ATTACKS = {
  orb: ({ at }) => tone({ type: 'triangle', f: 250, to: 900, t: at(0), dur: 0.33, v: 0.14, vib: 0.03, vibRate: 20 }),
  volley: ({ at, big }) => { for (let i = 0; i < (big ? 7 : 5); i++) tone({ type: 'square', f: 1500, to: 280, t: at(i * 70), dur: 0.08, v: 0.07 }); },
  beam: ({ at }) => {
    tone({ type: 'sawtooth', f: 180, to: 760, t: at(0), dur: 0.16, v: 0.08 });
    tone({ type: 'sawtooth', f: 760, t: at(160), dur: 0.36, v: 0.07, vib: 0.02, vibRate: 25, r: 0.15 });
    noise({ t: at(150), dur: 0.4, v: 0.05, type: 'bandpass', f: 4000, q: 2 });
  },
  lightning: ({ at }) => {
    for (const [ms, v] of [[0, 0.3], [150, 0.18], [300, 0.14]]) noise({ t: at(ms), dur: 0.1, v, type: 'highpass', f: 1800, d: 0.05, s: 0.3 });
    tone({ type: 'triangle', f: 70, to: 40, t: at(60), dur: 0.6, v: 0.2, s: 0.5, r: 0.2 });
  },
  meteor: ({ at, big }) => {
    for (let i = 0; i < (big ? 5 : 3); i++) {
      tone({ type: 'sine', f: 1500, to: 300, t: at(i * 120), dur: 0.29, v: 0.05 });
      kick(at(i * 120 + 300), 0.3);
      noise({ t: at(i * 120 + 300), dur: 0.18, v: 0.16, type: 'lowpass', f: 800, to: 150 });
    }
  },
  slash: ({ at, big }) => { for (let i = 0; i < (big ? 4 : 3); i++) noise({ t: at(i * 85), dur: 0.07, v: 0.18, type: 'bandpass', f: 2000, to: 7000, q: 1.2, r: 0.03 }); },
  quake: ({ at }) => {
    noise({ t: at(100), dur: 0.7, v: 0.3, type: 'lowpass', f: 180, d: 0.2, s: 0.7, r: 0.2 });
    tone({ type: 'sine', f: 55, t: at(120), dur: 0.6, v: 0.25, vib: 0.15, vibRate: 9 });
  },
  spiral: ({ at }) => { [72, 76, 79, 83, 86, 88, 91, 95].forEach((m, i) => tone({ type: 'triangle', f: mtof(m), t: at(i * 60), dur: 0.08, v: 0.1 })); },
  rain: ({ at }) => { for (let i = 0; i < 26; i++) noise({ t: at(R() * 750), dur: 0.015, v: 0.05 + R() * 0.05, type: 'bandpass', f: 2500 + R() * 4000, q: 3, r: 0.02 }); },
  bounce: ({ at }) => {
    tone({ type: 'sine', f: 180, to: 520, t: at(0), dur: 0.12, v: 0.16 });
    tone({ type: 'sine', f: 520, to: 160, t: at(380), dur: 0.22, v: 0.16, vib: 0.15, vibRate: 22 });
  },
  toss: ({ at }) => { noise({ t: at(0), dur: 0.38, v: 0.08, type: 'bandpass', f: 600, to: 2500, q: 1.5 }); noise({ t: at(400), dur: 0.12, v: 0.2, type: 'lowpass', f: 1200, to: 200 }); },
  vines: ({ at }) => {
    for (let i = 0; i < 6; i++) noise({ t: at(150 + i * 55), dur: 0.05, v: 0.09, type: 'bandpass', f: 1800 + R() * 1500, q: 2 });
    tone({ type: 'triangle', f: 110, to: 330, t: at(160), dur: 0.35, v: 0.1 });
  },
  explosion: ({ at }) => {
    noise({ t: at(0), dur: 0.25, v: 0.05, type: 'highpass', f: 5000 });
    kick(at(260), 0.45);
    noise({ t: at(260), dur: 0.6, v: 0.4, type: 'lowpass', f: 1500, to: 120, d: 0.2, s: 0.6, r: 0.25 });
  },
  wave: ({ at }) => noise({ t: at(0), dur: 0.75, v: 0.22, type: 'lowpass', f: 300, to: 2500, a: 0.3, d: 0.2, s: 0.8, r: 0.3 }),
  fire: ({ at }) => {
    noise({ t: at(0), dur: 0.22, v: 0.12, type: 'bandpass', f: 800, to: 2500 });
    noise({ t: at(200), dur: 0.55, v: 0.1, type: 'lowpass', f: 1400, s: 0.7, r: 0.2 });
    for (let i = 0; i < 10; i++) noise({ t: at(200 + R() * 550), dur: 0.01, v: 0.14, type: 'highpass', f: 3500, r: 0.01 });
  },
  ice: ({ at, big }) => {
    for (let i = 0; i < (big ? 6 : 4); i++) tone({ type: 'triangle', f: 2200 + R() * 1400, t: at(i * 60), dur: 0.05, v: 0.08 });
    noise({ t: at(240), dur: 0.15, v: 0.16, type: 'highpass', f: 4000, d: 0.04, s: 0.4 });
    for (let i = 0; i < 5; i++) tone({ type: 'sine', f: 3000 + R() * 2000, t: at(260 + i * 50), dur: 0.04, v: 0.05 });
  },
  tornado: ({ at }) => {
    noise({ t: at(0), dur: 0.9, v: 0.4, type: 'bandpass', f: 400, to: 1800, q: 3, a: 0.15, s: 0.8, r: 0.2 });
    noise({ t: at(300), dur: 0.5, v: 0.25, type: 'bandpass', f: 1800, to: 500, q: 3 });
  },
  glitch: ({ at }) => {
    for (let i = 0; i < 14; i++) tone({ type: 'square', f: [110, 220, 440, 880, 1760, 3520][Math.floor(R() * 6)], t: at(i * 40), dur: 0.03, v: 0.06, a: 0.001, d: 0.005, s: 1, r: 0.005 });
    noise({ t: at(220), dur: 0.2, v: 0.08, type: 'highpass', f: 1000, rate: 0.25 });
  },
  notes: ({ at, big }) => { [76, 79, 81, 84, 81, 88, 84, 91].slice(0, big ? 8 : 6).forEach((m, i) => tone({ type: 'pulse25', f: mtof(m), t: at(i * 75), dur: 0.09, v: 0.09 })); },
  paint: ({ at, big }) => {
    for (let i = 0; i < (big ? 5 : 3); i++) {
      tone({ type: 'sine', f: 700, to: 300, t: at(i * 95), dur: 0.12, v: 0.06 });
      noise({ t: at(i * 95 + 300), dur: 0.07, v: 0.18, type: 'lowpass', f: 900, to: 250 });
    }
  },
  holy: ({ at }) => {
    for (const m of [72, 76, 79, 84]) tone({ type: 'triangle', f: mtof(m), t: at(0), dur: 0.6, v: 0.07, a: 0.12, s: 0.8, r: 0.25, vib: 0.01 });
    for (let i = 0; i < 6; i++) tone({ type: 'sine', f: 2500 + R() * 2000, t: at(200 + i * 70), dur: 0.05, v: 0.05 });
  },
  speech: ({ at }) => {
    for (let i = 0; i < 3; i++) {
      tone({ type: 'pulse25', f: 170 + R() * 90, to: 140 + R() * 60, t: at(i * 130), dur: 0.11, v: 0.1, lin: true });
      tone({ type: 'pulse25', f: 230 + R() * 90, t: at(i * 130 + 60), dur: 0.06, v: 0.08 });
    }
  },
  confetti: ({ at }) => {
    noise({ t: at(240), dur: 0.05, v: 0.3, type: 'lowpass', f: 3000 });
    for (let i = 0; i < 10; i++) tone({ type: 'sine', f: 1800 + R() * 3000, t: at(260 + i * 40), dur: 0.04, v: 0.05 });
  },
  rush: ({ at }) => { tone({ type: 'sawtooth', f: 70, to: 220, t: at(0), dur: 0.3, v: 0.08 }); noise({ t: at(0), dur: 0.3, v: 0.18, type: 'bandpass', f: 500, to: 3000, q: 1 }); },
  pages: ({ at, big }) => { for (let i = 0; i < (big ? 7 : 5); i++) noise({ t: at(i * 70), dur: 0.05, v: 0.22, type: 'bandpass', f: 3000 + R() * 2000, q: 1.5 }); },
  stars: ({ at }) => { [84, 88, 91, 96].forEach((m, i) => { tone({ type: 'sine', f: mtof(m), t: at(i * 110), dur: 0.12, v: 0.08 }); tone({ type: 'sine', f: mtof(m + 12), t: at(i * 110 + 60), dur: 0.08, v: 0.03 }); }); },
  cast: ({ at }) => { [67, 71, 74, 79, 83].forEach((m, i) => tone({ type: 'triangle', f: mtof(m), t: at(i * 50), dur: 0.08, v: 0.1 })); noise({ t: at(150), dur: 0.35, v: 0.03, type: 'highpass', f: 6000 }); },
};

export function attackSound(pattern, { big = false, fast = false } = {}) {
  if (!ready()) return;
  const sp = fast ? 0.5 : 1, t0 = ctx.currentTime + 0.01;
  const at = ms => t0 + (ms * sp) / 1000;
  try { (ATTACKS[pattern] || ATTACKS.orb)({ at, big }); } catch (e) { console.error('[son]', e); }
}

// Pour vérifier les morceaux (nombre de pas de mélodie = nombre de pas d'accords).
export function checkTracks() {
  const tracks = Object.entries(TRACKS).map(([name, d]) => ({ name, melody: parseNotes(d.melody).length, chords: d.chords.length * 16, chordOk: d.chords.every(c => /^[A-G][#b]?(m|7|m7|maj7|dim|sus4|5)?$/.test(c)) }));
  const jingles = Object.entries(JINGLES).map(([name, j]) => ({ name, voices: j.voices.map(v => parseNotes(v.n).length) }));
  return { tracks, jingles };
}
