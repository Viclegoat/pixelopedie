// Moteur de combat au tour par tour (côté serveur : c'est lui qui fait foi).
import { effectiveness, STATUS, TYPES } from '../public/shared/types.js';

const rand = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const stageMult = s => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const STAT_NAMES = { atk: 'Attaque', def: 'Défense', spd: 'Vitesse' };

export function slimCard(card) {
  const { id, title, description, extract, image, url, rarity, type, person, archetype, accessory, stats, moves, views } = card;
  return { id, title, description, extract, image, url, rarity, type, person, archetype, accessory, stats, moves, views };
}

export function makeFighter(card, opts = {}) {
  const level = opts.level || 1;
  const mult = (1 + 0.03 * (level - 1)) * (opts.statMult || 1);
  const maxHp = Math.round((card.stats.hp + 60) * mult * (opts.hpMult || 1));
  return {
    card: slimCard(card), level, maxHp, hp: maxHp,
    atk: Math.round((card.stats.atk + 5) * mult * (opts.atkMult || 1)),
    def: Math.round((card.stats.def + 5) * mult),
    spd: Math.round((card.stats.spd + 5) * mult),
    stages: { atk: 0, def: 0, spd: 0 }, status: null, fainted: false,
  };
}

const fv = f => ({ card: f.card, hp: f.hp, maxHp: f.maxHp, level: f.level, status: f.status, fainted: f.fainted });

export class Battle {
  /**
   * sides : [{ pid, name, faction: 'A'|'B', team: [fighter], bot, boss, actionsPerTurn }]
   * rules : { draw(sideIdx) -> Promise<card>, maxCards, turnLimit }
   */
  constructor({ id, mode, sides, rules = {} }) {
    this.id = id;
    this.mode = mode;
    this.rules = rules;
    this.turn = 1;
    this.phase = 'choose';
    this.over = false;
    this.winner = null;
    this.sides = sides.map(s => ({ actionsPerTurn: 1, drawn: 0, forfeit: false, active: 0, ...s, action: null, needReplace: false }));
  }

  // ---------- Petites aides ----------
  activeOf(i) { const s = this.sides[i]; return s.team[s.active]; }
  isSideAlive(i) {
    const s = this.sides[i];
    if (s.forfeit) return false;
    if (s.team.some(f => !f.fainted)) return true;
    return this.mode === 'master' && s.drawn < (this.rules.maxCards || 3);
  }
  sideCanAct(i) { const f = this.activeOf(i); return !!f && !f.fainted && !this.sides[i].forfeit; }
  opponents(i) { return this.sides.map((s, j) => j).filter(j => this.sides[j].faction !== this.sides[i].faction && this.sideCanAct(j)); }

  pendingSides() {
    if (this.over) return [];
    if (this.phase === 'replace') return this.sides.map((s, i) => i).filter(i => this.sides[i].needReplace && !this.sides[i].bot);
    return this.sides.map((s, i) => i).filter(i => !this.sides[i].bot && this.sideCanAct(i) && !this.sides[i].action);
  }

  // ---------- Début (mode Master : chacun ouvre sa première carte) ----------
  async start() {
    const events = [];
    if (this.mode === 'master') {
      for (let i = 0; i < this.sides.length; i++) await this.drawInto(i, events);
    }
    for (let i = 0; i < this.sides.length; i++) {
      const f = this.activeOf(i);
      if (f) events.push({ t: 'enter', side: i, fighter: fv(f), msg: this.sides[i].boss ? `Le boss ${f.card.title} apparaît !` : `${this.sides[i].name} envoie ${f.card.title} !` });
    }
    return events;
  }

  async drawInto(i, events) {
    const s = this.sides[i];
    const card = await this.rules.draw(i);
    if (!card) return false;
    s.team.push(makeFighter(card));
    s.drawn++;
    s.active = s.team.length - 1;
    events.push({ t: 'pack', side: i, fighter: fv(s.team[s.active]), msg: `${s.name} ouvre une carte : ${card.title} !` });
    return true;
  }

  // ---------- Actions des joueurs ----------
  submit(i, action) {
    if (this.over) return 'Combat terminé';
    const s = this.sides[i];
    if (!s) return 'Joueur inconnu';
    if (this.phase === 'replace') {
      if (!s.needReplace || action?.type !== 'switch') return 'Choisis une carte pour remplacer';
      const f = s.team[action.to];
      if (!f || f.fainted) return 'Carte indisponible';
      s.active = action.to;
      s.needReplace = false;
      s.replacedEvent = { t: 'enter', side: i, fighter: fv(f), msg: `${s.name} envoie ${f.card.title} !` };
      return null;
    }
    if (!this.sideCanAct(i)) return 'Tu ne peux pas agir';
    if (action?.type === 'move') {
      if (!this.activeOf(i).card.moves[action.index]) return 'Attaque inconnue';
    } else if (action?.type === 'switch') {
      if (this.mode === 'master') return 'Pas de changement en mode Master';
      const f = s.team[action.to];
      if (!f || f.fainted || action.to === s.active) return 'Changement impossible';
    } else return 'Action invalide';
    s.action = action;
    return null;
  }

  forfeit(i) {
    const s = this.sides[i];
    s.forfeit = true;
    s.action = null;
    s.needReplace = false;
    for (const f of s.team) { f.fainted = true; f.hp = 0; }
  }

  allReady() { return this.pendingSides().length === 0; }

  // Après la phase de remplacement : on repasse au choix des actions.
  finishReplace() {
    const events = [];
    for (const s of this.sides) if (s.replacedEvent) { events.push(s.replacedEvent); s.replacedEvent = null; }
    this.phase = 'choose';
    return events;
  }

  // ---------- Intelligence artificielle ----------
  botAction(i) {
    const me = this.activeOf(i);
    const targets = this.opponents(i);
    if (!me || !targets.length) return { type: 'move', index: 0 };
    const foe = this.activeOf(targets[Math.floor(rand() * targets.length)]);
    let best = 0, bestScore = -1;
    me.card.moves.forEach((m, idx) => {
      let score;
      if (m.power > 0) {
        score = m.power * (m.acc / 100) * effectiveness(m.type, foe.card.type) * (m.type === me.card.type ? 1.3 : 1);
      } else if (m.effect === 'heal') score = me.hp / me.maxHp < 0.4 ? 140 : 5;
      else if (['polemique', 'censure'].includes(m.effect)) score = foe.status ? 0 : 55;
      else if (m.effect?.endsWith('+')) score = me.stages[m.effect.slice(0, 3)] < 2 && me.hp / me.maxHp > 0.5 ? 50 : 5;
      else score = 30;
      score *= 0.8 + rand() * 0.4;
      if (score > bestScore) { bestScore = score; best = idx; }
    });
    return { type: 'move', index: best };
  }

  botReplacement(i) {
    const s = this.sides[i];
    const foeIdx = this.opponents(i)[0];
    const foeType = foeIdx !== undefined ? this.activeOf(foeIdx)?.card.type : null;
    let best = -1, bestScore = -Infinity;
    s.team.forEach((f, idx) => {
      if (f.fainted) return;
      const score = foeType ? effectiveness(f.card.type, foeType) - effectiveness(foeType, f.card.type) + f.hp / f.maxHp : f.hp;
      if (score > bestScore) { bestScore = score; best = idx; }
    });
    return best;
  }

  // ---------- Résolution d'un tour ----------
  async resolve() {
    const ev = [];
    for (let i = 0; i < this.sides.length; i++) {
      const s = this.sides[i];
      if (s.bot && this.sideCanAct(i)) s.action = this.botAction(i);
      if (this.sideCanAct(i) && !s.action) s.action = this.botAction(i); // temps écoulé
    }

    // 1. Changements de carte
    this.sides.forEach((s, i) => {
      if (s.action?.type === 'switch') {
        const old = this.activeOf(i);
        s.active = s.action.to;
        ev.push({ t: 'switch', side: i, fighter: fv(this.activeOf(i)), msg: `${s.name} rappelle ${old.card.title} et envoie ${this.activeOf(i).card.title} !` });
      }
    });

    // 2. Attaques, par ordre de vitesse
    const queue = [];
    this.sides.forEach((s, i) => {
      if (s.action?.type !== 'move') return;
      for (let k = 0; k < (s.actionsPerTurn || 1); k++) {
        const idx = k === 0 ? s.action.index : this.botAction(i).index;
        const f = this.activeOf(i);
        queue.push({ side: i, index: idx, speed: f.spd * stageMult(f.stages.spd) * (f.status?.id === 'censure' ? 0.75 : 1), tie: rand() });
      }
    });
    queue.sort((a, b) => b.speed - a.speed || a.tie - b.tie);
    for (const q of queue) {
      if (this.checkEnd()) break;
      this.useMove(q.side, q.index, ev);
    }

    // 3. Fin de tour : effets de statut
    if (!this.over) {
      this.sides.forEach((s, i) => {
        const f = this.activeOf(i);
        if (!f || f.fainted || !f.status) return;
        if (f.status.id === 'polemique') {
          const dmg = Math.max(1, Math.floor(f.maxHp / 10));
          f.hp = Math.max(0, f.hp - dmg);
          ev.push({ t: 'statusDmg', side: i, amount: dmg, hp: f.hp, msg: `${f.card.title} subit la Polémique !` });
          if (f.hp <= 0) this.faint(i, ev);
        }
        if (f.status && --f.status.turns <= 0) {
          ev.push({ t: 'cure', side: i, msg: `${f.card.title} n'est plus ${f.status.id === 'polemique' ? 'dans la polémique' : 'censuré'}.` });
          f.status = null;
        }
      });
    }

    this.sides.forEach(s => { s.action = null; });
    this.turn++;

    // 4. Remplacements
    if (!this.checkEnd()) {
      for (let i = 0; i < this.sides.length; i++) {
        const s = this.sides[i];
        const f = this.activeOf(i);
        if (s.forfeit || (f && !f.fainted)) continue;
        if (this.mode === 'master') {
          if (s.drawn < (this.rules.maxCards || 3)) await this.drawInto(i, ev);
          continue;
        }
        if (!s.team.some(x => !x.fainted)) continue;
        if (s.bot) {
          s.active = this.botReplacement(i);
          ev.push({ t: 'enter', side: i, fighter: fv(this.activeOf(i)), msg: `${s.name} envoie ${this.activeOf(i).card.title} !` });
        } else s.needReplace = true;
      }
      this.phase = this.sides.some(s => s.needReplace) ? 'replace' : 'choose';
    }
    if (!this.over && this.rules.turnLimit && this.turn > this.rules.turnLimit) this.endByHp(ev);
    if (this.over) ev.push({ t: 'end', winner: this.winner, msg: this.endMessage() });
    return ev;
  }

  useMove(i, index, ev) {
    const s = this.sides[i];
    const me = this.activeOf(i);
    if (!me || me.fainted) return;
    const targets = this.opponents(i);
    if (!targets.length) return;
    const ti = targets[Math.floor(rand() * targets.length)];
    const foe = this.activeOf(ti);
    const move = me.card.moves[index] || me.card.moves[0];

    if (me.status?.id === 'censure' && rand() < 0.5) {
      ev.push({ t: 'skip', side: i, msg: `${me.card.title} est censuré et ne peut pas agir !` });
      return;
    }
    ev.push({ t: 'move', side: i, target: ti, move: move.name, moveType: move.type, power: move.power, msg: `${me.card.title} utilise ${move.name} !` });

    if (move.power > 0 && rand() * 100 >= move.acc) {
      ev.push({ t: 'miss', side: i, target: ti, msg: `${foe.card.title} esquive l'attaque !` });
      return;
    }

    let dealt = 0;
    if (move.power > 0) {
      const A = me.atk * stageMult(me.stages.atk);
      const D = foe.def * stageMult(foe.stages.def);
      const stab = move.type === me.card.type ? 1.3 : 1;
      const eff = effectiveness(move.type, foe.card.type);
      const crit = rand() < 0.0625 ? 1.5 : 1;
      const roll = 0.85 + rand() * 0.15;
      dealt = Math.max(1, Math.floor(((22 * move.power * A / D) / 50 + 2) * stab * eff * crit * roll * (this.rules.damageMult || 1)));
      dealt = Math.min(dealt, foe.hp);
      foe.hp -= dealt;
      let msg = '';
      if (crit > 1) msg += 'Coup critique ! ';
      if (eff > 1) msg += "C'est super efficace !";
      else if (eff < 1) msg += "Ce n'est pas très efficace…";
      ev.push({ t: 'damage', side: ti, from: i, amount: dealt, hp: foe.hp, eff, crit: crit > 1, moveType: move.type, msg: msg.trim() || null });
    }

    if (move.effect) {
      const chance = move.power > 0 ? (move.chance ?? 30) : 100;
      if (move.effect === 'drain' && dealt > 0) this.heal(i, Math.ceil(dealt / 2), ev, `${me.card.title} récupère de l'énergie !`);
      else if (rand() * 100 < chance) this.applyEffect(i, ti, move, ev);
    }
    if (foe.hp <= 0) this.faint(ti, ev);
  }

  heal(i, amount, ev, msg) {
    const f = this.activeOf(i);
    const real = Math.min(amount, f.maxHp - f.hp);
    if (real <= 0) { ev.push({ t: 'text', msg: `Les PV de ${f.card.title} sont déjà au maximum.` }); return; }
    f.hp += real;
    ev.push({ t: 'heal', side: i, amount: real, hp: f.hp, msg });
  }

  applyEffect(i, ti, move, ev) {
    const me = this.activeOf(i), foe = this.activeOf(ti);
    const e = move.effect;
    if (e === 'heal') return this.heal(i, Math.round(me.maxHp * (move.power > 0 ? 0.2 : 0.4)), ev, `${me.card.title} récupère des PV !`);
    if (e.endsWith('+') || e.endsWith('-')) {
      const stat = e.slice(0, 3), self = e.endsWith('+');
      const f = self ? me : foe, side = self ? i : ti;
      if (foe.fainted && !self) return;
      const before = f.stages[stat];
      f.stages[stat] = clamp(before + (self ? 1 : -1), -4, 4);
      const the = stat === 'atk' ? "L'" : 'La '; // « L'Attaque », « La Défense », « La Vitesse »
      if (f.stages[stat] === before) { ev.push({ t: 'text', msg: `${the}${STAT_NAMES[stat]} de ${f.card.title} ne peut plus bouger !` }); return; }
      ev.push({ t: 'stat', side, stat, delta: self ? 1 : -1, msg: `${the}${STAT_NAMES[stat]} de ${f.card.title} ${self ? 'augmente' : 'baisse'} !` });
      return;
    }
    if ((e === 'polemique' || e === 'censure') && !foe.fainted) {
      if (foe.status) { if (move.power === 0) ev.push({ t: 'text', msg: `${foe.card.title} a déjà un statut.` }); return; }
      foe.status = { id: e, turns: e === 'polemique' ? 4 : 2 };
      ev.push({ t: 'status', side: ti, status: e, msg: e === 'polemique' ? `${foe.card.title} est pris dans une Polémique !` : `${foe.card.title} est censuré !` });
    }
  }

  faint(i, ev) {
    const f = this.activeOf(i);
    if (f.fainted) return;
    f.fainted = true;
    f.hp = 0;
    f.status = null;
    ev.push({ t: 'faint', side: i, msg: `${f.card.title} est K.O. !` });
    this.checkEnd();
  }

  checkEnd() {
    if (this.over) return true;
    const alive = { A: false, B: false };
    this.sides.forEach((s, i) => { if (this.isSideAlive(i)) alive[s.faction] = true; });
    if (alive.A && alive.B) return false;
    this.over = true;
    this.phase = 'over';
    this.winner = alive.A ? 'A' : alive.B ? 'B' : null;
    return true;
  }

  endByHp(ev) {
    const score = { A: 0, B: 0 };
    this.sides.forEach(s => s.team.forEach(f => { score[s.faction] += f.hp / f.maxHp; }));
    this.over = true;
    this.phase = 'over';
    this.winner = score.A === score.B ? null : score.A > score.B ? 'A' : 'B';
    ev.push({ t: 'text', msg: 'Limite de tours atteinte : victoire aux PV restants.' });
  }

  endMessage() {
    if (!this.winner) return 'Match nul !';
    const winners = this.sides.filter(s => s.faction === this.winner);
    if (winners.some(s => s.boss)) return `Le boss ${winners[0].team[0].card.title} l'emporte…`;
    if (this.sides.some(s => s.boss)) return `Le boss est vaincu ! Bravo ${winners.map(s => s.name).join(' & ')} !`;
    return `Victoire de ${winners.map(s => s.name).join(' & ')} !`;
  }

  view(forSide) {
    return {
      id: this.id, mode: this.mode, turn: this.turn, phase: this.phase, over: this.over, winner: this.winner,
      you: forSide,
      sides: this.sides.map((s, i) => ({
        name: s.name, faction: s.faction, boss: !!s.boss, bot: !!s.bot, active: s.active, drawn: s.drawn,
        needReplace: s.needReplace, ready: !!s.action, forfeit: s.forfeit,
        team: s.team.map(f => ({ card: f.card, hp: f.hp, maxHp: f.maxHp, level: f.level, status: f.status, stages: f.stages, fainted: f.fainted,
          atk: f.atk, def: f.def, spd: f.spd })),
      })),
    };
  }
}

export { TYPES, STATUS };
