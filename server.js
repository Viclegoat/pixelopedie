// Pixelopédie — serveur du jeu.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import { db, ROOT, DATA_DIR, load, save, flush, createUser, checkPassword, newToken, userByToken, userByName, addCard, publicProfile } from './src/db.js';
import { startPool, openPack, poolStatus, themeCards, searchCards, catalogInfo } from './src/pool.js';
import { attach, openLobbies, queueSizes } from './src/game.js';
import { currentBoss, todayTheme, themeEligible, BOSS } from './src/modes.js';
import { aiEnabled } from './src/ai.js';
import * as market from './src/market.js';
import { UA } from './src/wiki.js';
import { PACK_PRICE, FREE_PACK_HOURS, LANGS } from './public/shared/types.js';

const PORT = process.env.PORT || 3000;
await load();

const app = express();
// Derrière un hébergeur (Render…), l'adresse du joueur arrive dans X-Forwarded-For : sans ça, la limite
// d'essais de connexion s'appliquerait à tout le monde d'un coup.
if (process.env.RENDER || process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

const auth = (req, res, next) => {
  const user = userByToken((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: 'Connecte-toi' });
  req.user = user;
  next();
};
const wrap = fn => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) { res.status(400).json({ error: e.message || 'Erreur' }); }
};

// ---------- Comptes ----------
const attempts = new Map();
function rateLimit(req) {
  const key = req.ip;
  const now = Date.now();
  const list = (attempts.get(key) || []).filter(t => now - t < 60000);
  if (list.length >= 15) throw new Error('Trop de tentatives, attends une minute');
  list.push(now);
  attempts.set(key, list);
}

app.post('/api/register', wrap(async req => {
  rateLimit(req);
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  if (!/^[\p{L}\p{N}_\- ]{3,16}$/u.test(name)) throw new Error('Pseudo : 3 à 16 lettres ou chiffres');
  if (password.length < 6) throw new Error('Mot de passe : 6 caractères minimum');
  if (userByName(name)) throw new Error('Ce pseudo est déjà pris');
  const user = createUser(name, password);
  return { token: newToken(user), profile: publicProfile(user) };
}));

app.post('/api/login', wrap(async req => {
  rateLimit(req);
  const user = userByName(String(req.body.name || '').trim());
  if (!user || !checkPassword(user, String(req.body.password || ''))) throw new Error('Pseudo ou mot de passe incorrect');
  return { token: newToken(user), profile: publicProfile(user) };
}));

app.post('/api/logout', auth, wrap(async req => {
  delete db.tokens[(req.headers.authorization || '').replace(/^Bearer /, '')];
  save();
  return { ok: true };
}));

app.get('/api/me', auth, wrap(async req => publicProfile(req.user)));

// ---------- Collection & packs ----------
app.get('/api/collection', auth, wrap(async req => {
  return Object.entries(req.user.collection)
    .map(([id, e]) => ({ card: db.cards[id], count: e.count, at: e.at }))
    .filter(x => x.card);
}));

app.get('/api/card/:id', wrap(async req => {
  const card = db.cards[req.params.id];
  if (!card) throw new Error('Carte inconnue');
  return card;
}));

// Toutes les cartes du jeu, par rareté, avec recherche (accents et majuscules ignorés).
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const folded = new WeakMap();
const foldCard = c => { let f = folded.get(c); if (!f) folded.set(c, f = { t: fold(c.title), d: fold(c.description) }); return f; };
app.get('/api/catalog', auth, wrap(async req => {
  const rarity = String(req.query.rarity || '');
  const lang = LANGS[req.query.lang] ? String(req.query.lang) : '';
  const q = fold(req.query.q).trim().slice(0, 60);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 48));
  // Les compteurs par rareté portent sur la recherche en cours : on voit dans quelle rareté sont les résultats.
  const found = Object.values(db.cards).filter(c => (!lang || (c.lang || 'fr') === lang) && (!q || foldCard(c).t.includes(q) || foldCard(c).d.includes(q)));
  const counts = {}, owned = {};
  for (const c of found) {
    counts[c.rarity] = (counts[c.rarity] || 0) + 1;
    if (req.user.collection[c.id]) owned[c.rarity] = (owned[c.rarity] || 0) + 1;
  }
  const list = found.filter(c => !rarity || c.rarity === rarity)
    .sort((a, b) => (q ? (foldCard(b).t.startsWith(q) - foldCard(a).t.startsWith(q)) : 0) || (b.views || 0) - (a.views || 0));
  const items = list.slice(offset, offset + limit).map(({ categories, qidChecked, ...card }) => ({ card, count: req.user.collection[card.id]?.count || 0 }));
  return { total: list.length, counts, owned, items, ...catalogInfo() };
}));

// Cherche dans tout Wikipédia (2,7 millions de pages) : chaque page trouvée devient une carte.
// Une recherche à la fois par joueur : la suivante attend la fin de la précédente (au plus 3 en attente).
const wikiSearches = new Map();
app.post('/api/catalog/wiki', auth, wrap(async req => {
  const q = String(req.body.q || '').trim().slice(0, 80);
  const lang = LANGS[req.body.lang] ? String(req.body.lang) : 'fr';
  if (q.length < 2) throw new Error('Tape au moins 2 lettres');
  const prev = wikiSearches.get(req.user.id) || { n: 0, done: Promise.resolve() };
  if (prev.n >= 3) throw new Error('Doucement : trop de recherches à la fois');
  const job = { n: prev.n + 1 };
  job.done = prev.done.catch(() => {}).then(() => searchCards(q, lang));
  wikiSearches.set(req.user.id, job);
  let result;
  try { result = await job.done; }
  finally { if (wikiSearches.get(req.user.id) === job) wikiSearches.delete(req.user.id); }
  const { cards, added } = result;
  return { added, items: cards.map(({ categories, qidChecked, ...card }) => ({ card, count: req.user.collection[card.id]?.count || 0 })) };
}));

const opening = new Set();
app.post('/api/pack/open', auth, wrap(async req => {
  const user = req.user;
  if (opening.has(user.id)) throw new Error('Un pack est déjà en cours d\'ouverture');
  const kind = req.body.kind;
  if (kind === 'starter') {
    if (user.starterPacks <= 0) throw new Error('Plus de pack de départ');
  } else if (kind === 'free') {
    if (Date.now() < user.freePackAt) throw new Error('Le pack gratuit n\'est pas encore prêt');
  } else if (kind === 'buy') {
    if (user.coins < PACK_PRICE) throw new Error(`Il te faut ${PACK_PRICE} pièces`);
  } else throw new Error('Type de pack inconnu');

  opening.add(user.id);
  try {
    const cards = await openPack();
    if (cards.length < 3) throw new Error('Wikipédia met du temps à répondre, réessaie dans un instant');
    if (kind === 'starter') user.starterPacks--;
    if (kind === 'free') user.freePackAt = Date.now() + FREE_PACK_HOURS * 3600e3;
    if (kind === 'buy') user.coins -= PACK_PRICE;
    const result = cards.map(c => ({ card: c, count: addCard(user, c) }));
    save();
    return { cards: result, profile: publicProfile(user) };
  } finally {
    opening.delete(user.id);
  }
}));

// ---------- Marché, enchères, échanges ----------
const done = req => ({ ok: true, profile: publicProfile(req.user) });
app.get('/api/market', auth, wrap(async req => market.marketView(req.user)));
app.post('/api/market/list', auth, wrap(async req => { market.listCard(req.user, String(req.body.cardId), req.body.price); return done(req); }));
app.post('/api/market/buy', auth, wrap(async req => { market.buyListing(req.user, String(req.body.id)); return done(req); }));
app.post('/api/market/cancel', auth, wrap(async req => { market.cancelListing(req.user, String(req.body.id)); return done(req); }));
app.post('/api/auction/start', auth, wrap(async req => { market.startAuction(req.user, String(req.body.cardId), req.body.start, req.body.hours, req.body.buyout); return done(req); }));
app.post('/api/auction/bid', auth, wrap(async req => ({ ...market.placeBid(req.user, String(req.body.id), req.body.amount), ...done(req) })));
app.post('/api/auction/cancel', auth, wrap(async req => { market.cancelAuction(req.user, String(req.body.id)); return done(req); }));
app.get('/api/player/:name/cards', auth, wrap(async req => market.playerCards(req.params.name)));
app.post('/api/trade/propose', auth, wrap(async req => { market.proposeTrade(req.user, req.body.to, req.body.give, req.body.want, req.body.message); return done(req); }));
app.post('/api/trade/answer', auth, wrap(async req => { market.answerTrade(req.user, String(req.body.id), !!req.body.accept); return done(req); }));

// ---------- Boss, thème, classements ----------
app.get('/api/boss', auth, wrap(async req => {
  const b = await currentBoss();
  return {
    slot: b.slot, endsAt: b.endsAt, rarity: b.rarity, card: b.card,
    reward: { coins: BOSS.coins[b.rarity], drop: BOSS.drop[b.rarity] },
    alreadyWon: !!req.user.boss[b.slot],
    lobbies: openLobbies(),
  };
}));

app.get('/api/theme', auth, wrap(async req => {
  const t = todayTheme();
  const mine = req.user.theme[t.id] || { claimed: false, wins: 0 };
  const eligible = Object.keys(req.user.collection).filter(id => db.cards[id] && themeEligible(db.cards[id], t));
  return { theme: t, claimed: mine.claimed, wins: mine.wins, eligible };
}));

const claiming = new Set();
app.post('/api/theme/claim', auth, wrap(async req => {
  const user = req.user;
  const t = todayTheme();
  user.theme[t.id] = user.theme[t.id] || { claimed: false, wins: 0 };
  if (user.theme[t.id].claimed) throw new Error('Pack du thème déjà récupéré aujourd\'hui');
  if (claiming.has(user.id)) throw new Error('Ouverture en cours');
  claiming.add(user.id);
  try {
    const cards = await themeCards(t.category, 3);
    if (!cards.length) throw new Error('Impossible de charger le thème, réessaie');
    user.theme[t.id].claimed = true;
    const result = cards.map(c => ({ card: c, count: addCard(user, c) }));
    save();
    return { cards: result, profile: publicProfile(user) };
  } finally {
    claiming.delete(user.id);
  }
}));

app.get('/api/leaderboard', auth, wrap(async () => {
  const users = Object.values(db.users);
  const top = (fn, n = 15) => users.map(u => ({ name: u.name, value: fn(u) })).filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, n);
  const t = todayTheme().id;
  return {
    rating: top(u => u.stats.rating),
    tower: top(u => u.stats.towerBest),
    towerDuo: top(u => u.stats.towerDuoBest || 0),
    boss: top(u => u.stats.bossWins),
    theme: top(u => u.theme[t]?.wins || 0),
    cards: top(u => Object.keys(u.collection).length),
  };
}));

app.get('/api/status', wrap(async () => ({ pool: poolStatus(), queues: queueSizes(), ai: aiEnabled(), players: Object.keys(db.users).length })));

// ---------- Proxy d'images (pour pixeliser les photos dans le navigateur) ----------
const IMG_DIR = path.join(DATA_DIR, 'img');
fs.mkdirSync(IMG_DIR, { recursive: true });
app.get('/api/img', async (req, res) => {
  try {
    const u = new URL(String(req.query.u || ''));
    if (u.protocol !== 'https:' || !/(^|\.)wikimedia\.org$/.test(u.hostname)) return res.status(400).end();
    const key = crypto.createHash('sha1').update(u.href).digest('hex');
    const file = path.join(IMG_DIR, key);
    if (fs.existsSync(file)) {
      const meta = JSON.parse(fs.readFileSync(file + '.json', 'utf8'));
      res.set('Content-Type', meta.type).set('Cache-Control', 'public, max-age=604800');
      return res.sendFile(path.resolve(file));
    }
    const r = await fetch(u.href, { headers: { 'User-Agent': UA } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3e6) return res.status(413).end();
    fs.writeFileSync(file, buf);
    fs.writeFileSync(file + '.json', JSON.stringify({ type }));
    res.set('Content-Type', type).set('Cache-Control', 'public, max-age=604800').send(buf);
  } catch {
    res.status(404).end();
  }
});

// ---------- Démarrage ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
attach(io);
startPool();

server.listen(PORT, () => {
  console.log(`Pixelopédie en ligne sur http://localhost:${PORT}`);
  console.log(aiEnabled() ? 'Attaques générées par Claude (ANTHROPIC_API_KEY détectée).' : 'Attaques générées depuis les liens Wikipédia (pas de clé API).');
});

// Arrêt (Ctrl+C, redémarrage de l'hébergeur) : on enregistre tout avant de quitter.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  setTimeout(() => process.exit(0), 8000).unref();
  Promise.resolve(flush()).catch(e => console.error(e)).finally(() => process.exit(0));
});
