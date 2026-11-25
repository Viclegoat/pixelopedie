// Partie en ligne : files d'attente, salons privés, raids de boss, tour infinie.
import crypto from 'node:crypto';
import { Battle, makeFighter } from './battle.js';
import { db, save, addCard, publicProfile, userByToken } from './db.js';
import { drawRandom, drawRarity, rollRareSlot } from './pool.js';
import { currentBoss, currentSlot, bossFighterOptions, BOSS, todayTheme, themeEligible } from './modes.js';
import { TEAM_SIZE, RARITY_IDS, rarityIndex, cardLevel, MODES } from '../public/shared/types.js';

const CHOOSE_MS = 45000, REPLACE_MS = 25000;

let io;
const battles = new Map();     // id -> entrée
const userBattle = new Map();  // userId -> battleId
const queues = { normal: [], master: [], theme: [] };
const duels = new Map();       // code -> { mode, hostId, team }
const lobbies = new Map();     // code -> raid de boss en préparation
const towers = new Map();      // userId -> run en cours

const code4 = () => crypto.randomBytes(3).toString('hex').slice(0, 4).toUpperCase();
const toUser = (userId, ev, data) => io.to('u:' + userId).emit(ev, data);
const sendProfile = user => toUser(user.id, 'profile', publicProfile(user));

// ---------- Équipes ----------
function buildTeam(user, ids, { theme = false } = {}) {
  if (!Array.isArray(ids)) throw new Error('Équipe invalide');
  const unique = [...new Set(ids.map(String))].slice(0, TEAM_SIZE);
  if (!unique.length) throw new Error('Choisis au moins une carte');
  const owned = Object.keys(user.collection).length;
  if (unique.length < Math.min(TEAM_SIZE, owned)) throw new Error(`Choisis ${TEAM_SIZE} cartes`);
  const t = todayTheme();
  return unique.map(id => {
    const entry = user.collection[id];
    const card = db.cards[id];
    if (!entry || !card) throw new Error('Tu ne possèdes pas cette carte');
    if (theme && !themeEligible(card, t)) throw new Error(`${card.title} ne fait pas partie du thème du jour`);
    return makeFighter(card, { level: cardLevel(entry.count) });
  });
}

function averageRarity(fighters) {
  if (!fighters.length) return 'commune';
  const avg = fighters.reduce((s, f) => s + rarityIndex(f.card.rarity), 0) / fighters.length;
  return RARITY_IDS[Math.round(avg)];
}

async function botTeam(rarity, size = TEAM_SIZE, statMult = 1) {
  const out = [];
  for (let i = 0; i < size; i++) {
    const r = RARITY_IDS[Math.max(0, Math.min(RARITY_IDS.length - 1, rarityIndex(rarity) + (Math.random() < 0.3 ? -1 : 0)))];
    const card = await drawRarity(r);
    if (card) out.push(makeFighter(card, { statMult }));
  }
  return out;
}

function busy(userId) {
  return userBattle.has(userId) || Object.values(queues).some(q => q.some(e => e.userId === userId));
}
function leaveQueues(userId) {
  for (const q of Object.values(queues)) { const i = q.findIndex(e => e.userId === userId); if (i >= 0) q.splice(i, 1); }
  for (const [code, d] of duels) if (d.hostId === userId) duels.delete(code);
}

// ---------- Cycle de vie d'un combat ----------
async function startBattle({ mode, sides, rules = {}, onEnd, meta = {} }) {
  const id = crypto.randomUUID();
  const battle = new Battle({ id, mode, sides, rules: { turnLimit: 80, ...rules } });
  const entry = { battle, onEnd, meta, timer: null, deadline: 0, busy: false };
  battles.set(id, entry);
  sides.forEach(s => { if (s.pid) userBattle.set(s.pid, id); });
  const events = await battle.start();
  schedule(entry);
  broadcast(entry, 'battle:start', events);
  return entry;
}

function broadcast(entry, type, events) {
  const { battle } = entry;
  battle.sides.forEach((s, i) => {
    if (!s.pid || s.left) return;
    toUser(s.pid, type, { events, view: battle.view(i), deadline: entry.deadline, meta: entry.meta });
  });
}

function schedule(entry) {
  clearTimeout(entry.timer);
  if (entry.battle.over) return;
  const ms = entry.battle.phase === 'replace' ? REPLACE_MS : CHOOSE_MS;
  entry.deadline = Date.now() + ms;
  entry.timer = setTimeout(() => timeout(entry), ms);
  // Si personne n'a besoin de choisir (que des bots), on avance tout seul.
  if (entry.battle.allReady()) setTimeout(() => step(entry), 400);
}

function timeout(entry) {
  const { battle } = entry;
  if (battle.over) return;
  if (battle.phase === 'replace') {
    battle.sides.forEach((s, i) => { if (s.needReplace) battle.submit(i, { type: 'switch', to: battle.botReplacement(i) }); });
  }
  step(entry);
}

async function step(entry) {
  if (entry.busy || entry.battle.over) return;
  entry.busy = true;
  try {
    const { battle } = entry;
    let events;
    if (battle.phase === 'replace') {
      if (!battle.allReady()) return;
      events = battle.finishReplace();
    } else {
      events = await battle.resolve();
    }
    schedule(entry);
    broadcast(entry, 'battle:update', events);
    if (battle.over) await finish(entry);
  } catch (e) {
    console.error('[combat]', e);
  } finally {
    entry.busy = false;
  }
}

async function finish(entry) {
  clearTimeout(entry.timer);
  const { battle } = entry;
  let rewards = {};
  try { rewards = (await entry.onEnd?.(battle)) || {}; } catch (e) { console.error('[récompenses]', e); }
  battle.sides.forEach((s, i) => {
    if (!s.pid || s.left) return;
    userBattle.delete(s.pid);
    const user = db.users[s.pid];
    toUser(s.pid, 'battle:end', { view: battle.view(i), rewards: rewards[s.pid] || null, meta: entry.meta });
    if (user) sendProfile(user);
  });
  save();
  setTimeout(() => battles.delete(battle.id), 60000);
}

function give(user, { coins = 0, cards = [] }) {
  user.coins += coins;
  for (const c of cards) addCard(user, c);
  return { coins, cards: cards.map(c => ({ id: c.id, title: c.title, rarity: c.rarity })) };
}

// ---------- Récompenses de duel (Normal, Master, Thème) ----------
function duelRewards(mode, vsBot) {
  return battle => {
    const out = {};
    const won = battle.winner;
    const humans = battle.sides.filter(s => s.pid);
    battle.sides.forEach(s => {
      if (!s.pid) return;
      const user = db.users[s.pid];
      const win = won === s.faction;
      let coins = vsBot ? (win ? 30 : 10) : (win ? 60 : 20);
      if (mode === 'theme') coins = Math.round(coins * 1.5);
      const cards = mode === 'master' && win ? s.team.map(f => db.cards[f.card.id]).filter(Boolean) : [];
      if (mode === 'master' && win) coins += 20;
      if (win) user.stats.wins++; else if (won) user.stats.losses++;
      if (!vsBot && humans.length === 2 && won) user.stats.rating = Math.max(0, user.stats.rating + (win ? 20 : -15));
      if (mode === 'theme' && win) {
        const t = todayTheme().id;
        user.theme[t] = user.theme[t] || { claimed: false, wins: 0 };
        user.theme[t].wins++;
      }
      out[s.pid] = { win, draw: !won, ...give(user, { coins, cards }), kept: cards.length ? 'Tu gardes les cartes ouvertes pendant le combat !' : null };
    });
    return out;
  };
}

const masterRules = () => ({
  maxCards: TEAM_SIZE,
  draw: async () => (Math.random() < 0.18 ? drawRarity(rollRareSlot()) : drawRandom()),
});

async function startDuel(mode, a, b) {
  // a, b : { user, fighters } ; b.user peut être null (bot)
  const vsBot = !b.user;
  const sides = [
    { pid: a.user.id, name: a.user.name, faction: 'A', team: a.fighters },
    { pid: b.user?.id || null, name: b.user?.name || b.name, faction: 'B', team: b.fighters, bot: vsBot },
  ];
  return startBattle({ mode, sides, rules: mode === 'master' ? masterRules() : {}, onEnd: duelRewards(mode, vsBot), meta: { kind: 'duel' } });
}

async function botOpponent(mode, fighters) {
  if (mode === 'master') return { user: null, name: 'Bot Encyclopédique', fighters: [] };
  let team;
  if (mode === 'theme') {
    const t = todayTheme();
    const eligible = Object.values(db.cards).filter(c => themeEligible(c, t)).sort(() => Math.random() - 0.5).slice(0, TEAM_SIZE);
    team = eligible.map(c => makeFighter(c));
    if (team.length < TEAM_SIZE) team.push(...await botTeam(averageRarity(fighters), TEAM_SIZE - team.length));
  } else team = await botTeam(averageRarity(fighters));
  return { user: null, name: 'Bot Encyclopédique', fighters: team };
}

// ---------- Tour infinie ----------
function floorSpec(floor) {
  const size = floor < 3 ? 1 : floor < 7 ? 2 : 3;
  const ri = Math.min(RARITY_IDS.length - 1, Math.floor((floor - 1) / 3));
  const statMult = 1 + Math.max(0, floor - 13) * 0.05;
  return { size, rarity: RARITY_IDS[ri], statMult };
}

async function startTowerFloor(user) {
  const run = towers.get(user.id);
  const spec = floorSpec(run.floor);
  const enemies = await botTeam(spec.rarity, spec.size, spec.statMult);
  for (const f of run.fighters) { f.stages = { atk: 0, def: 0, spd: 0 }; f.status = null; }
  const first = run.fighters.findIndex(f => !f.fainted);
  const sides = [
    { pid: user.id, name: user.name, faction: 'A', team: run.fighters, active: Math.max(0, first) },
    { pid: null, name: `Gardien de l'étage ${run.floor}`, faction: 'B', team: enemies, bot: true },
  ];
  const entry = await startBattle({
    mode: 'tower', sides, meta: { kind: 'tower', floor: run.floor },
    onEnd: battle => {
      const win = battle.winner === 'A';
      const out = { floor: run.floor, win };
      if (win) {
        const coins = 10 * run.floor;
        Object.assign(out, give(user, { coins }));
        user.stats.towerBest = Math.max(user.stats.towerBest, run.floor);
        run.floor++;
        for (const f of run.fighters) if (!f.fainted) f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * 0.3));
        out.next = run.floor;
      } else {
        towers.delete(user.id);
        out.coins = 0;
        out.cards = [];
        out.ended = true;
      }
      out.best = user.stats.towerBest;
      return { [user.id]: out };
    },
  });
  return entry;
}

// ---------- Raids de boss ----------
function lobbyView(code) {
  const l = lobbies.get(code);
  if (!l) return null;
  return { code, hostId: l.hostId, slot: l.slot, members: l.members.map(m => ({ id: m.userId, name: db.users[m.userId]?.name, cards: m.fighters.map(f => f.card.title) })) };
}
const lobbyBroadcast = code => {
  const view = lobbyView(code);
  if (view) for (const m of lobbies.get(code).members) toUser(m.userId, 'boss:lobby', view);
};

export function openLobbies() {
  const slot = currentSlot();
  return [...lobbies.values()].filter(l => l.slot === slot && l.members.length < 4).map(l => lobbyView(l.code));
}

async function startRaid(members) {
  const boss = await currentBoss();
  const n = members.length;
  const opts = bossFighterOptions(boss.rarity, n);
  const bossFighter = makeFighter(boss.card, opts);
  const sides = members.map(m => ({ pid: m.user.id, name: m.user.name, faction: 'A', team: m.fighters }));
  sides.push({ pid: null, name: `Boss ${boss.card.title}`, faction: 'B', team: [bossFighter], bot: true, boss: true, actionsPerTurn: opts.actionsPerTurn });
  return startBattle({
    mode: 'boss', sides, rules: { turnLimit: 120 }, meta: { kind: 'boss', slot: boss.slot, rarity: boss.rarity },
    onEnd: battle => {
      const out = {};
      const win = battle.winner === 'A';
      for (const m of members) {
        const user = m.user;
        const side = battle.sides.find(s => s.pid === user.id);
        if (!win || side?.forfeit) { out[user.id] = { win: false, coins: 0, cards: [] }; continue; }
        const first = !user.boss[boss.slot];
        user.boss[boss.slot] = true;
        user.stats.bossWins++;
        const coins = Math.round(BOSS.coins[boss.rarity] * (first ? 1 : 0.25));
        const drop = first && Math.random() < BOSS.drop[boss.rarity] ? [boss.card] : [];
        out[user.id] = { win: true, first, ...give(user, { coins, cards: drop }), dropped: !!drop.length };
      }
      return out;
    },
  });
}

// ---------- Connexion des sockets ----------
export function attach(server) {
  io = server;
  io.use((socket, next) => {
    const user = userByToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('non connecté'));
    socket.data.userId = user.id;
    next();
  });

  io.on('connection', socket => {
    const uid = socket.data.userId;
    const me = () => db.users[uid];
    socket.join('u:' + uid);
    const reply = (cb, data) => typeof cb === 'function' && cb(data);
    const guard = fn => async (data, cb) => {
      try { reply(cb, (await fn(data || {})) || { ok: true }); }
      catch (e) { reply(cb, { error: e.message || 'Erreur' }); }
    };

    // Reprendre un combat après un rechargement de page.
    socket.on('battle:resume', guard(async () => {
      const id = userBattle.get(uid);
      const entry = id && battles.get(id);
      if (!entry) return { none: true };
      const i = entry.battle.sides.findIndex(s => s.pid === uid);
      return { view: entry.battle.view(i), deadline: entry.deadline, meta: entry.meta };
    }));

    socket.on('battle:action', guard(async ({ action }) => {
      const entry = battles.get(userBattle.get(uid));
      if (!entry) throw new Error('Aucun combat en cours');
      const i = entry.battle.sides.findIndex(s => s.pid === uid);
      const err = entry.battle.submit(i, action);
      if (err) throw new Error(err);
      broadcastReady(entry);
      if (entry.battle.allReady()) setImmediate(() => step(entry)); // on répond au joueur avant de jouer le tour
    }));

    socket.on('battle:forfeit', guard(async () => {
      const entry = battles.get(userBattle.get(uid));
      if (!entry) return;
      const i = entry.battle.sides.findIndex(s => s.pid === uid);
      entry.battle.forfeit(i);
      entry.battle.checkEnd();
      const events = [{ t: 'text', msg: `${me().name} abandonne.` }];
      if (entry.battle.over) {
        events.push({ t: 'end', winner: entry.battle.winner, msg: entry.battle.endMessage() });
        broadcast(entry, 'battle:update', events);
        await finish(entry);
      } else {
        broadcast(entry, 'battle:update', events);
        // Les autres continuent sans lui : il quitte le combat tout de suite.
        entry.battle.sides[i].left = true;
        userBattle.delete(uid);
        toUser(uid, 'battle:end', { view: entry.battle.view(i), rewards: null, meta: entry.meta });
        if (entry.battle.allReady()) step(entry);
      }
      if (entry.meta.kind === 'tower') towers.delete(uid);
    }));

    // --- Duels (Normal, Master, Thème) ---
    socket.on('duel:queue', guard(async ({ mode, team }) => {
      if (!queues[mode]) throw new Error('Mode inconnu');
      if (busy(uid)) throw new Error('Tu es déjà en combat ou en file');
      const fighters = mode === 'master' ? [] : buildTeam(me(), team, { theme: mode === 'theme' });
      const other = queues[mode].find(e => e.userId !== uid);
      if (other) {
        queues[mode].splice(queues[mode].indexOf(other), 1);
        await startDuel(mode, { user: db.users[other.userId], fighters: other.fighters }, { user: me(), fighters });
        return { started: true };
      }
      queues[mode].push({ userId: uid, fighters, at: Date.now() });
      return { queued: true };
    }));

    socket.on('duel:cancel', guard(async () => { leaveQueues(uid); }));

    socket.on('duel:bot', guard(async ({ mode, team }) => {
      if (!queues[mode]) throw new Error('Mode inconnu');
      if (busy(uid)) throw new Error('Tu es déjà en combat');
      const fighters = mode === 'master' ? [] : buildTeam(me(), team, { theme: mode === 'theme' });
      const bot = await botOpponent(mode, fighters);
      await startDuel(mode, { user: me(), fighters }, bot);
      return { started: true };
    }));

    socket.on('duel:create', guard(async ({ mode, team }) => {
      if (!queues[mode]) throw new Error('Mode inconnu');
      if (busy(uid)) throw new Error('Tu es déjà en combat');
      leaveQueues(uid);
      const fighters = mode === 'master' ? [] : buildTeam(me(), team, { theme: mode === 'theme' });
      let code; do { code = code4(); } while (duels.has(code));
      duels.set(code, { mode, hostId: uid, fighters });
      return { code };
    }));

    socket.on('duel:join', guard(async ({ code, team }) => {
      const d = duels.get(String(code || '').toUpperCase().trim());
      if (!d) throw new Error('Code introuvable');
      if (d.hostId === uid) throw new Error("C'est ton propre salon");
      if (busy(uid) || userBattle.has(d.hostId)) throw new Error('Un des joueurs est déjà en combat');
      const fighters = d.mode === 'master' ? [] : buildTeam(me(), team, { theme: d.mode === 'theme' });
      duels.delete(code.toUpperCase().trim());
      await startDuel(d.mode, { user: db.users[d.hostId], fighters: d.fighters }, { user: me(), fighters });
      return { started: true, mode: d.mode };
    }));

    // --- Boss ---
    socket.on('boss:solo', guard(async ({ team }) => {
      if (busy(uid)) throw new Error('Tu es déjà en combat');
      await startRaid([{ user: me(), fighters: buildTeam(me(), team) }]);
      return { started: true };
    }));

    socket.on('boss:create', guard(async ({ team }) => {
      if (busy(uid)) throw new Error('Tu es déjà en combat');
      for (const [c, l] of lobbies) l.members = l.members.filter(m => m.userId !== uid), l.members.length || lobbies.delete(c);
      let code; do { code = code4(); } while (lobbies.has(code));
      lobbies.set(code, { code, hostId: uid, slot: currentSlot(), members: [{ userId: uid, fighters: buildTeam(me(), team) }] });
      lobbyBroadcast(code);
      return lobbyView(code);
    }));

    socket.on('boss:join', guard(async ({ code, team }) => {
      code = String(code || '').toUpperCase().trim();
      const l = lobbies.get(code);
      if (!l) throw new Error('Groupe introuvable');
      if (l.slot !== currentSlot()) throw new Error('Ce boss est parti, un nouveau est arrivé !');
      if (l.members.length >= 4) throw new Error('Groupe complet (4 max)');
      if (busy(uid)) throw new Error('Tu es déjà en combat');
      for (const [c, o] of lobbies) if (c !== code) { o.members = o.members.filter(m => m.userId !== uid); if (!o.members.length) lobbies.delete(c); }
      l.members = l.members.filter(m => m.userId !== uid);
      l.members.push({ userId: uid, fighters: buildTeam(me(), team) });
      lobbyBroadcast(code);
      return lobbyView(code);
    }));

    socket.on('boss:leave', guard(async () => {
      for (const [c, l] of lobbies) {
        if (!l.members.some(m => m.userId === uid)) continue;
        l.members = l.members.filter(m => m.userId !== uid);
        if (!l.members.length) lobbies.delete(c);
        else { if (l.hostId === uid) l.hostId = l.members[0].userId; lobbyBroadcast(c); }
      }
    }));

    socket.on('boss:start', guard(async () => {
      const l = [...lobbies.values()].find(x => x.hostId === uid);
      if (!l) throw new Error("Tu n'es pas chef d'un groupe");
      if (l.members.some(m => userBattle.has(m.userId))) throw new Error('Un membre est déjà en combat');
      lobbies.delete(l.code);
      await startRaid(l.members.map(m => ({ user: db.users[m.userId], fighters: m.fighters })));
      return { started: true };
    }));

    // --- Tour infinie ---
    socket.on('tower:start', guard(async ({ team }) => {
      if (busy(uid)) throw new Error('Tu es déjà en combat');
      towers.set(uid, { floor: 1, fighters: buildTeam(me(), team) });
      await startTowerFloor(me());
      return { started: true };
    }));

    socket.on('tower:next', guard(async () => {
      const run = towers.get(uid);
      if (!run) throw new Error('Aucune ascension en cours');
      if (busy(uid)) throw new Error('Tu es déjà en combat');
      if (!run.fighters.some(f => !f.fainted)) { towers.delete(uid); throw new Error('Ton équipe est K.O.'); }
      await startTowerFloor(me());
      return { started: true };
    }));

    socket.on('tower:quit', guard(async () => { towers.delete(uid); }));
    socket.on('tower:status', guard(async () => {
      const run = towers.get(uid);
      return run ? { floor: run.floor, team: run.fighters.map(f => ({ title: f.card.title, hp: f.hp, maxHp: f.maxHp, fainted: f.fainted })) } : { none: true };
    }));

    socket.on('disconnect', () => {
      // On retire le joueur des files d'attente ; un combat en cours continue (le temps joue pour lui).
      const still = io.sockets.adapter.rooms.get('u:' + uid);
      if (!still || !still.size) {
        for (const q of Object.values(queues)) { const i = q.findIndex(e => e.userId === uid); if (i >= 0) q.splice(i, 1); }
      }
    });
  });
}

function broadcastReady(entry) {
  entry.battle.sides.forEach((s, i) => {
    if (s.pid) toUser(s.pid, 'battle:ready', { ready: entry.battle.sides.map(x => !!x.action || !!x.bot) });
  });
}

export const queueSizes = () => Object.fromEntries(Object.entries(queues).map(([k, v]) => [k, v.length]));
export { MODES };
