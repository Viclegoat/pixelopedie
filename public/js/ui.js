// Petits composants d'interface partagés.
import { TYPES, rarityById, rarityIndex, EFFECTS, cardLevel } from '/shared/types.js';
import { spriteCanvas } from './sprite.js';
import { sfx } from './audio.js';

export const $ = (sel, el = document) => el.querySelector(sel);

// Construit un élément : h('div', { class: 'x', onclick }, enfant1, [enfants], 'texte')
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export const fmt = n => Math.round(n).toLocaleString('fr-FR');

export function countdown(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}h${String(mm).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

export function typeBadge(type) {
  const t = TYPES[type] || { name: '?', emoji: '❔', color: '#666' };
  return h('span', { class: 'type', style: { background: t.color } }, t.emoji, ' ', t.name);
}

export function rarityStars(r) {
  const ri = rarityIndex(r);
  return h('span', { class: 'rar' }, '★'.repeat(ri + 1) + ' ' + rarityById(r).name);
}

export function cardEl(card, { count, onClick, selected, disabled, isNew, scale = 2, levelUp } = {}) {
  const el = h('div', { class: `card r-${card.rarity}${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`, title: card.title },
    h('div', { class: 'card-top' }, typeBadge(card.type), rarityStars(card.rarity)),
    h('div', { class: 'art' }, spriteCanvas(card, scale)),
    h('div', { class: 'name' }, card.title),
    h('div', { class: 'desc' }, card.description || ' '),
    h('div', { class: 'stats' },
      h('span', { title: 'Points de vie' }, '❤', card.stats.hp), h('span', { title: 'Attaque' }, '⚔', card.stats.atk),
      h('span', { title: 'Défense' }, '🛡', card.stats.def), h('span', { title: 'Vitesse' }, '💨', card.stats.spd)),
  );
  if (card.lang && card.lang !== 'fr') el.append(h('div', { class: 'lang-badge', title: 'Page de Wikipédia ' + card.lang.toUpperCase() }, card.lang.toUpperCase()));
  if (count) el.append(h('div', { class: 'lvl' }, `Niv.${cardLevel(count)}`));
  if (count > 1) el.append(h('div', { class: 'count' }, `x${count}`));
  if (isNew) el.append(h('div', { class: 'new' }, 'NOUVEAU'));
  if (levelUp) el.append(h('div', { class: 'new', style: { background: 'var(--cyan)' } }, `NIV.${levelUp}`));
  if (onClick && !disabled) el.addEventListener('click', () => onClick(card));
  return el;
}

export function toast(msg, err = false) {
  const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
  document.getElementById('toasts').append(t);
  sfx(err ? 'error' : 'notify');
  setTimeout(() => t.remove(), err ? 5000 : 3500);
}

export function modal(content, { onClose, closable = true } = {}) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: 'panel modal' }, content);
  const bg = h('div', { class: 'modal-bg' }, box);
  const close = () => { bg.remove(); onClose?.(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && closable) close(); };
  if (closable) {
    box.prepend(h('button', { class: 'btn small ghost close', onclick: close, 'aria-label': 'Fermer' }, '✕'));
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    document.addEventListener('keydown', onKey);
  }
  root.append(bg);
  return close;
}

export function moveLine(m) {
  const t = TYPES[m.type];
  return h('div', { class: 'move-line', style: { borderLeft: `6px solid ${t?.color}` } },
    h('span', { class: 'mname' }, m.name),
    typeBadge(m.type),
    h('span', { class: 'muted' }, m.power ? `Puissance ${m.power} · Précision ${m.acc}%` : 'Soutien'),
    m.effect ? h('span', { title: EFFECTS[m.effect] }, (m.power ? `${m.chance ?? 30}% : ` : '') + EFFECTS[m.effect]) : null,
  );
}

export function cardDetail(card, count) {
  const max = 170;
  const bar = (label, v, color) => h('div', { class: 'statbar' }, h('span', {}, label), h('b', {}, v),
    h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, v / max * 100) + '%', background: color } })));
  modal(h('div', {},
    h('div', { class: 'detail' },
      h('div', { class: 'art' }, spriteCanvas(card, 4)),
      h('div', {},
        h('h2', { style: { marginRight: '40px' } }, card.title),
        h('div', { class: 'row', style: { marginBottom: '8px' } }, typeBadge(card.type), h('span', { class: `r-${card.rarity}` }, rarityStars(card.rarity)),
          count ? h('span', { class: 'chip' }, `Niv. ${cardLevel(count)} · x${count}`) : null),
        h('div', { class: 'muted' }, card.description),
        h('div', { class: 'muted', style: { fontSize: '18px', margin: '4px 0 10px' } }, `≈ ${fmt(card.views)} vues par an sur Wikipédia`),
        bar('PV', card.stats.hp, '#3ddc84'), bar('Attaque', card.stats.atk, '#ff6b6b'),
        bar('Défense', card.stats.def, '#4fa3f7'), bar('Vitesse', card.stats.spd, '#ffd23f'),
      )),
    h('h3', { style: { marginTop: '16px' } }, 'Attaques'),
    h('div', { class: 'moves' }, card.moves.map(moveLine)),
    h('div', { class: 'extract' }, card.extract || ''),
    h('a', { href: card.url, target: '_blank', rel: 'noopener' }, 'Lire la page sur Wikipédia ↗'),
    count ? h('p', { class: 'muted', style: { fontSize: '18px' } }, 'Chaque doublon fait monter la carte de niveau (+3 % de stats par niveau, max 10).') : null,
  ));
}
