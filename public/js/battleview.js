// Écran de combat : arène pixel art, animations des événements, choix des attaques.
import { TYPES, STATUS, EFFECTS, effectiveness, MODES } from '/shared/types.js';
import { h, typeBadge, rarityStars, toast, cardEl, modal } from './ui.js';
import { paintSprite, SW, SH } from './sprite.js';
import { createFx, moveStyle } from './fx.js';
import { music, jingle, sfx, attackSound } from './audio.js';

const SCENES = {
  politique: ['#6d7fd8', '#b8c3f2', '#9aa0b8', '#767c96'], histoire: ['#d9a95a', '#f3dcae', '#a07a45', '#7d5c32'],
  science: ['#1d3557', '#3f6e9a', '#2bb5a8', '#1f8c82'], tech: ['#0f1630', '#2b3768', '#4a5578', '#353e5c'],
  nature: ['#69b7e8', '#bfe6ff', '#5cb85c', '#3f8f3f'], geo: ['#7ec8f0', '#d6f0ff', '#c9a36b', '#a8834c'],
  guerre: ['#6b3a2e', '#c27a5a', '#5a4a3a', '#3e3226'], art: ['#c45fb0', '#f2b6e6', '#6a3d7a', '#4e2b5c'],
  sport: ['#4fa3f7', '#bfe0ff', '#3fae49', '#2e8a37'], mythe: ['#2b1b4a', '#6a4fa3', '#8a7bd1', '#6656a8'],
  quotidien: ['#f7b267', '#ffe1a8', '#d98c5f', '#b96f45'],
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function mountBattle(root, init, ctx) {
  let view = init.view;
  let deadline = init.deadline;
  const me = view.you;
  const myFaction = view.sides[me].faction;
  const isBossFight = view.mode === 'boss';
  let busy = false, fast = false, ended = false, waitingSent = false;
  const queue = [];

  // ---------- Squelette ----------
  const arena = h('div', { class: 'arena' });
  const msg = h('span', {}, '');
  const msgbox = h('div', { class: 'msgbox', onclick: () => { fast = true; } }, msg, h('span', { class: 'pixel', style: { fontSize: '10px', opacity: .5 } }, '▼'));
  const timerFill = h('i', { style: { width: '100%' } });
  const timer = h('div', { class: 'timer' }, timerFill);
  const controls = h('div', { class: 'controls' });
  const header = h('div', { class: 'row' },
    h('span', { class: 'pixel', style: { fontSize: '11px' } }, `${MODES[view.mode]?.emoji || '⚔️'} ${titleFor(view, init.meta)}`),
    h('span', { class: 'spacer' }),
    h('span', { class: 'chip turn' }, `Tour ${view.turn}`),
    h('button', { class: 'btn small ghost', onclick: forfeit }, 'Abandonner'));
  root.replaceChildren(h('div', { class: 'battle' }, header, arena, msgbox, timer, controls));
  const fx = createFx(arena);
  music.play(isBossFight ? 'boss' : init.meta?.kind === 'tower' ? 'tower' : 'battle');

  // ---------- Emplacements des combattants ----------
  const slots = view.sides.map((s, i) => ({ side: i, fighter: null, el: null, canvas: null, info: null }));
  const allies = view.sides.map((s, i) => i).filter(i => view.sides[i].faction === myFaction);
  allies.sort((a, b) => (a === me ? -1 : b === me ? 1 : a - b));
  const enemies = view.sides.map((s, i) => i).filter(i => view.sides[i].faction !== myFaction);
  const compact = allies.length > 1 || enemies.length > 1;

  function layout() {
    const W = arena.clientWidth || 900, H = arena.clientHeight || 420;
    enemies.forEach((i, k) => {
      const boss = view.sides[i].boss;
      const scale = boss ? (W < 600 ? 3 : 4) : (W < 600 ? 2 : 3);
      const w = SW * scale;
      const n = enemies.length;
      const cx = n === 1 ? W * 0.7 : W * (0.55 + 0.3 * (k + 0.5) / n);
      place(i, cx - w / 2, boss ? 12 : 28, scale, false);
    });
    allies.forEach((i, k) => {
      const n = allies.length;
      const scale = n > 1 ? 2 : (W < 600 ? 2 : 3);
      const w = SW * scale, hh = SH * scale;
      const cx = n === 1 ? W * 0.25 : W * (0.06 + 0.5 * (k + 0.5) / n);
      place(i, cx - w / 2, H - hh - 22, scale, n > 1);
    });
  }

  function place(i, x, y, scale, small) {
    const s = slots[i];
    if (!s.el) {
      s.canvas = document.createElement('canvas');
      s.el = h('div', { class: 'slot' + (small ? ' small' : '') }, s.canvas, h('div', { class: 'platform' }));
      arena.append(s.el);
      const big = !compact || (view.sides[i].boss) || (i === me && allies.length === 1);
      s.info = h('div', { class: 'info' });
      s.big = big;
      arena.append(s.info);
    }
    s.scale = scale;
    s.el.style.left = x + 'px';
    s.el.style.top = y + 'px';
    const enemy = view.sides[i].faction !== myFaction;
    if (s.big) {
      if (enemy) Object.assign(s.info.style, { left: '12px', top: '12px', right: 'auto', bottom: 'auto' });
      else Object.assign(s.info.style, { right: '12px', bottom: '14px', left: 'auto', top: 'auto' });
    } else {
      Object.assign(s.info.style, { left: Math.max(4, x - 20) + 'px', top: Math.max(4, y - 58) + 'px', width: '150px', right: 'auto', bottom: 'auto' });
    }
    if (s.fighter) paintSprite(s.canvas, s.fighter.card, scale);
  }

  function setFighter(i, f, anim) {
    const s = slots[i];
    const changed = !s.fighter || s.fighter.card.id !== f.card.id;
    s.fighter = { ...f };
    if (changed) paintSprite(s.canvas, f.card, s.scale || 3);
    s.el.classList.toggle('ko', !!f.fainted);
    if (anim) replay(s.el, 'enter', 500);
    renderInfo(i);
    if (enemies.includes(i) && i === enemies[0]) setScene(f.card.type);
  }

  function renderInfo(i) {
    const s = slots[i], f = s.fighter;
    s.info.style.visibility = f ? '' : 'hidden';
    if (!f) { s.info.replaceChildren(); return; }
    const side = view.sides[i];
    const pct = Math.max(0, f.hp / f.maxHp * 100);
    const cls = pct < 25 ? 'low' : pct < 55 ? 'mid' : '';
    const st = f.status ? STATUS[f.status.id] : null;
    s.info.replaceChildren(...[
      h('div', { class: 'iname' }, h('span', {}, (side.boss ? '👹 ' : '') + f.card.title), h('span', {}, `N.${f.level || 1}`)),
      s.big ? h('div', { class: 'irow' }, typeBadge(f.card.type), rarityStars(f.card.rarity)) : null,
      h('div', { class: 'irow' },
        st ? h('span', { class: 'status-tag', style: { background: st.color } }, st.name) : null,
        h('div', { class: 'hpbar' }, h('i', { class: cls, style: { width: pct + '%' } }))),
      s.big && side.faction === myFaction ? h('div', { class: 'hptxt' }, `${f.hp} / ${f.maxHp}`) :
        (!s.big ? h('div', { class: 'hptxt', style: { fontSize: '15px' } }, side.name) : null),
    ].filter(Boolean));
  }

  function setScene(type) {
    const [a, b, c, d] = SCENES[type] || SCENES.nature;
    arena.style.setProperty('--sky1', a); arena.style.setProperty('--sky2', b);
    arena.style.setProperty('--ground1', c); arena.style.setProperty('--ground2', d);
  }

  function replay(el, cls, ms) {
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  function center(i) {
    const s = slots[i];
    const r = s.canvas.getBoundingClientRect(), a = arena.getBoundingClientRect();
    return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 };
  }

  function floatText(i, text, cls) {
    const c = center(i);
    const el = h('div', { class: 'fx dmg ' + cls, style: { left: c.x - 20 + 'px', top: c.y - 40 + 'px' } }, text);
    arena.append(el);
    setTimeout(() => el.remove(), 1000);
  }

  // Position et taille du sprite, sans tenir compte des animations CSS en cours (élan, entrée, K.O.).
  function spot(i) {
    const s = slots[i];
    if (!s?.canvas) return null;
    const w = s.canvas.offsetWidth, hh = s.canvas.offsetHeight;
    return { x: s.el.offsetLeft + s.canvas.offsetLeft + w / 2, y: s.el.offsetTop + s.canvas.offsetTop + hh / 2, w, h: hh };
  }
  const effect = (kind, opts) => fx.effect(kind, { ...opts, fast });

  async function say(text) {
    if (!text) return;
    msg.textContent = '';
    if (fast) { msg.textContent = text; await sleep(250); return; }
    // Basé sur le temps écoulé : reste fluide même si le navigateur ralentit les minuteurs.
    const start = performance.now(), total = Math.min(450, text.length * 9);
    for (;;) {
      const k = Math.ceil((performance.now() - start) / total * text.length);
      msg.textContent = text.slice(0, k);
      if (k >= text.length || fast) break;
      await sleep(16);
    }
    msg.textContent = text;
    await sleep(fast ? 200 : 650);
  }

  // ---------- Lecture des événements ----------
  async function play(events) {
    for (let idx = 0; idx < events.length; idx++) {
      const e = events[idx], prev = events[idx - 1], next = events[idx + 1];
      const s = slots[e.side];
      switch (e.t) {
        case 'pack': {
          const pop = h('div', { class: 'packpop' }, cardEl(e.fighter.card, { scale: 2 }));
          arena.append(pop);
          sfx('packOpen');
          await say(e.msg);
          await sleep(fast ? 200 : 700);
          pop.remove();
          setFighter(e.side, e.fighter, true);
          effect('sparkle', { at: spot(e.side) });
          sfx('enter');
          continue;
        }
        case 'enter': case 'switch':
          setFighter(e.side, e.fighter, true);
          effect('sparkle', { at: spot(e.side) });
          sfx('enter');
          await say(e.msg); continue;
        case 'move': {
          await say(e.msg);
          const card = s.fighter?.card;
          const move = card?.moves.find(m => m.name === e.move) || { name: e.move, type: e.moveType, power: e.power };
          const from = spot(e.side), to = slots[e.target]?.fighter ? spot(e.target) : null;
          const right = view.sides[e.side].faction === myFaction;
          replay(s.el, right ? 'lunge-r' : 'lunge-l', 400);
          if (e.power > 0 && !to) { await sleep(250); continue; }
          // Chaque attaque a sa propre animation et son propre son ; on regarde l'événement suivant pour savoir si elle rate ou fait mal.
          attackSound(e.power > 0 ? moveStyle(card, move).pattern : 'cast', { big: move === card?.moves?.[0] || e.power >= 90, fast });
          await fx.attack({
            from, to: to || from, card, move, fast,
            miss: next?.t === 'miss',
            strong: next?.t === 'damage' && (next.eff > 1 || next.crit),
          });
          continue;
        }
        case 'damage': case 'statusDmg': {
          if (e.t === 'statusDmg') { effect('burn', { at: spot(e.side) }); sfx('burn'); }
          else { sfx(e.eff > 1 ? 'hitSuper' : e.eff < 1 ? 'hitWeak' : 'hit'); if (e.crit) sfx('crit'); }
          replay(s.el, 'hit', 450);
          s.fighter.hp = e.hp;
          renderInfo(e.side);
          floatText(e.side, '-' + e.amount, e.eff > 1 ? 'super' : e.eff < 1 ? 'weak' : '');
          await sleep(fast ? 150 : 450);
          await say(e.msg); continue;
        }
        case 'heal':
          // Drain : l'énergie part de la cible qui vient d'être frappée vers le lanceur.
          if (prev?.t === 'damage' && prev.from === e.side) { sfx('drain'); await effect('drain', { from: spot(prev.side), to: spot(e.side) }); }
          effect('heal', { at: spot(e.side) });
          sfx('heal');
          s.fighter.hp = e.hp; renderInfo(e.side); floatText(e.side, '+' + e.amount, 'heal');
          await say(e.msg); continue;
        case 'stat':
          effect('buff', { at: spot(e.side), stat: e.stat, up: e.delta > 0 });
          sfx(e.delta > 0 ? 'buffUp' : 'buffDown');
          floatText(e.side, `${{ atk: 'ATQ', def: 'DEF', spd: 'VIT' }[e.stat]} ${e.delta > 0 ? '↑' : '↓'}`, e.delta > 0 ? 'heal' : 'weak');
          await say(e.msg); continue;
        case 'status':
          effect(e.status, { at: spot(e.side) });
          sfx(e.status);
          s.fighter.status = { id: e.status }; renderInfo(e.side);
          await say(e.msg); continue;
        case 'skip':
          effect('censure', { at: spot(e.side), short: true });
          sfx('censure', { short: true });
          await say(e.msg); continue;
        case 'cure':
          sfx('cure');
          s.fighter.status = null; renderInfo(e.side);
          await say(e.msg); continue;
        case 'faint':
          effect('puff', { at: spot(e.side) });
          sfx('faint');
          s.fighter.hp = 0; s.fighter.fainted = true; renderInfo(e.side);
          replay(s.el, 'faint', 700);
          await sleep(650);
          s.el.classList.add('ko');
          await say(e.msg); continue;
        case 'miss':
          sfx('miss');
          floatText(e.target, 'Raté', 'weak');
          await say(e.msg); continue;
        default:
          await say(e.msg);
      }
    }
  }

  function sync() {
    view.sides.forEach((side, i) => {
      const f = side.team[side.active];
      if (f) setFighter(i, f, false);
    });
    header.querySelector('.turn').textContent = `Tour ${view.turn}`;
  }

  // ---------- Commandes ----------
  const wikiTab = { which: 'foe' };
  function renderControls() {
    const side = view.sides[me];
    const mine = side.team[side.active];
    const left = h('div', {});
    const right = h('div', { class: 'side-actions' });

    if (view.over) { controls.replaceChildren(); return; }
    const alive = side.team.some(f => !f.fainted);

    if (view.phase === 'replace' && side.needReplace) {
      left.append(h('h3', {}, 'Choisis ta prochaine carte'), bench(true));
    } else if (!alive || side.forfeit) {
      left.append(h('p', { class: 'muted' }, isBossFight ? 'Toutes tes cartes sont K.O. Tes alliés continuent le combat !' : 'En attente…'));
    } else if (view.phase === 'choose' && !side.ready && mine && !mine.fainted) {
      const foe = enemies.map(i => view.sides[i]).map(s => s.team[s.active]).find(f => f && !f.fainted);
      const grid = h('div', { class: 'movegrid' });
      mine.card.moves.forEach((m, idx) => {
        const t = TYPES[m.type];
        const eff = foe && m.power ? effectiveness(m.type, foe.card.type) : 1;
        grid.append(h('button', {
          class: 'btn movebtn', style: { '--mc': shadeBg(t.color) }, title: m.effect ? EFFECTS[m.effect] : '',
          onclick: () => act({ type: 'move', index: idx }),
        },
        h('span', { class: 'mn' }, m.name),
        h('span', { class: 'mi' }, h('span', {}, `${t.emoji} ${t.name}`),
          h('span', {}, m.power ? `${m.power}${eff > 1 ? ' ×2' : eff < 1 ? ' ×½' : ''}` : (EFFECTS[m.effect] || 'Soutien').split(' ')[0] + '…'))));
      });
      left.append(grid);
      if (view.mode !== 'master' && side.team.length > 1) right.append(h('h3', {}, 'Changer de carte'), bench(false));
    } else {
      left.append(h('p', { class: 'muted dots' }, 'En attente des autres joueurs'));
    }

    // Panneau Wikipédia : la vraie page derrière chaque carte.
    const foeF = enemies.map(i => view.sides[i]).map(s => s.team[s.active]).find(Boolean);
    const shown = wikiTab.which === 'foe' ? foeF : mine;
    right.append(h('div', { class: 'panel wikipanel' },
      h('div', { class: 'tabs' },
        h('button', { class: 'btn small' + (wikiTab.which === 'foe' ? ' cyan' : ''), onclick: () => { wikiTab.which = 'foe'; renderControls(); } }, 'Adversaire'),
        h('button', { class: 'btn small' + (wikiTab.which === 'me' ? ' cyan' : ''), onclick: () => { wikiTab.which = 'me'; renderControls(); } }, 'Ma carte')),
      shown ? [h('b', {}, '📖 ', shown.card.title), h('div', { class: 'extract' }, shown.card.extract),
        h('a', { href: shown.card.url, target: '_blank', rel: 'noopener' }, 'Ouvrir sur Wikipédia ↗')] : null));
    controls.replaceChildren(left, right);
  }

  function bench(forced) {
    const side = view.sides[me];
    const b = h('div', { class: 'bench' });
    side.team.forEach((f, idx) => {
      const cv = document.createElement('canvas');
      paintSprite(cv, f.card, 1);
      cv.style.width = '100%'; cv.style.height = 'auto';
      const on = idx === side.active;
      b.append(h('div', {
        class: 'mini' + (on ? ' on' : '') + (f.fainted ? ' dead' : ''), title: `${f.card.title} — ${f.hp}/${f.maxHp} PV`,
        onclick: () => { if (f.fainted || (on && !forced)) return; act({ type: 'switch', to: idx }); },
      }, cv, h('i', { style: { width: Math.max(0, f.hp / f.maxHp * 100) + '%' } })));
    });
    return b;
  }

  async function act(action) {
    const res = await ctx.emit('battle:action', { action });
    if (res?.error) return toast(res.error, true);
    // Le tour suivant a peut-être déjà commencé (la réponse arrive après la mise à jour).
    if (busy || queue.length) return;
    view.sides[me].ready = true;
    if (view.phase === 'replace') view.sides[me].needReplace = false;
    renderControls();
  }

  async function forfeit() {
    if (ended) return ctx.onExit();
    const close = modal(h('div', { style: { textAlign: 'center' } },
      h('h3', { class: 'pixel', style: { fontSize: '13px', margin: '6px 0 16px' } }, 'Abandonner le combat ?'),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Continuer'),
        h('button', { class: 'btn primary', onclick: async () => {
          close();
          const res = await ctx.emit('battle:forfeit', {});
          if (res?.error) toast(res.error, true);
        } }, 'Abandonner'))));
  }

  function tickTimer() {
    if (ended) return;
    const total = view.phase === 'replace' ? 25000 : 45000;
    timerFill.style.width = Math.max(0, Math.min(100, (deadline - Date.now()) / total * 100)) + '%';
  }
  const timerInt = setInterval(tickTimer, 500);

  // ---------- File de mises à jour ----------
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const job = queue.shift();
      fast = false;
      if (job.type === 'update') {
        controls.replaceChildren();
        await play(job.events || []);
        view = job.view; deadline = job.deadline;
        sync();
        renderControls();
      } else if (job.type === 'end') {
        view = job.view;
        sync();
        showEnd(job);
      }
    }
    busy = false;
  }

  function showEnd({ rewards, meta }) {
    ended = true;
    clearInterval(timerInt);
    controls.replaceChildren();
    timer.classList.add('hidden');
    const left = !!view.sides[me].forfeit && !view.over;
    const win = !left && view.winner === myFaction, draw = !left && !view.winner;
    const box = h('div', { class: 'end-banner' },
      h('div', { class: 'big ' + (win ? 'win' : 'lose') }, draw ? 'MATCH NUL' : win ? 'VICTOIRE !' : 'DÉFAITE…'));
    jingle(draw ? 'draw' : win ? 'victory' : 'defeat');
    if (rewards) {
      if (rewards.coins) { box.append(h('div', { class: 'pixel coin', style: { fontSize: '12px' } }, `+${rewards.coins} pièces`)); setTimeout(() => sfx('coin'), 1500); }
      if (rewards.cards?.length) box.append(h('div', {}, `Cartes gagnées : ${rewards.cards.map(c => c.title).join(', ')}`));
      if (rewards.kept) box.append(h('div', { class: 'muted' }, rewards.kept));
      if (meta?.kind === 'boss' && win) box.append(h('div', { class: 'muted' }, rewards.first ? (rewards.dropped ? 'Le boss rejoint ta collection !' : 'Pas de carte cette fois, retente ta chance au prochain boss.') : 'Récompense réduite : tu as déjà battu ce boss.'));
      if (meta?.kind === 'tower') box.append(h('div', {}, win ? `Étage ${rewards.floor} franchi ! Record${meta.duo ? ' à deux' : ''} : ${rewards.best}` : `Ascension terminée à l'étage ${rewards.floor}. Record${meta.duo ? ' à deux' : ''} : ${rewards.best}`));
    }
    const btns = h('div', { class: 'row', style: { justifyContent: 'center' } });
    if (meta?.kind === 'tower' && win) btns.append(h('button', { class: 'btn gold', onclick: () => ctx.onNextFloor(meta) }, 'Étage suivant ▶'));
    btns.append(h('button', { class: 'btn primary', onclick: () => ctx.onExit(meta) }, meta?.kind === 'tower' && win ? 'Arrêter là' : 'Continuer'));
    box.append(btns);
    arena.append(box);
    header.querySelector('.btn.ghost').textContent = 'Quitter';
  }

  // ---------- Démarrage ----------
  setScene(view.sides[enemies[0]]?.team[view.sides[enemies[0]].active]?.card.type || 'nature');
  // On démarre tout de suite, sans attendre une image d'animation : si l'onglet est en arrière-plan,
  // requestAnimationFrame n'arrive jamais, et les tours suivants seraient joués avant l'entrée des cartes.
  layout();
  queue.push({ type: 'update', events: init.events || [], view: init.view, deadline: init.deadline });
  pump();
  requestAnimationFrame(layout); // recalcule une fois la page affichée
  const onResize = () => layout();
  window.addEventListener('resize', onResize);

  return {
    update(data) { queue.push({ type: 'update', ...data }); pump(); },
    end(data) { queue.push({ type: 'end', ...data }); pump(); },
    ready() { /* indicateur facultatif */ },
    destroy() { clearInterval(timerInt); window.removeEventListener('resize', onResize); fx.destroy(); },
  };
}

function titleFor(view, meta) {
  if (meta?.kind === 'tower') return `Tour infinie${meta.duo ? ' à deux' : ''} — étage ${meta.floor}`;
  if (meta?.kind === 'boss') return 'Raid de boss';
  return `Mode ${MODES[view.mode]?.name || view.mode}${meta?.duo ? ' — à deux' : ''}`;
}

function shadeBg(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${Math.round(r * 0.55)}, ${Math.round(g * 0.55)}, ${Math.round(b * 0.55)})`;
}
