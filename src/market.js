// Marché de cartes, enchères et centre d'échange entre joueurs.
// Une carte mise en vente ou aux enchères quitte la collection du vendeur (elle est « bloquée ») ;
// elle lui revient si la vente est annulée ou si personne n'enchérit.
// Les pièces d'un enchérisseur sont bloquées tant qu'il est le meilleur, puis rendues s'il est dépassé.
import crypto from 'node:crypto';
import { db, save, addCard, userByName } from './db.js';

export const MARKET_FEE = 0.05;          // 5 % pris sur chaque vente (marché et enchères)
export const AUCTION_HOURS = [1, 6, 24, 72];
const MAX_PRICE = 1e7;
const MAX_LISTINGS = 30;                 // par joueur, marché + enchères
const MAX_TRADES = 20;                   // propositions en attente par joueur

function store() {
  const m = db.meta.market ||= {};
  m.listings ||= {}; m.auctions ||= {}; m.trades ||= {}; m.history ||= [];
  return m;
}
const newId = () => crypto.randomBytes(6).toString('hex');
const price = (v, min = 1) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > MAX_PRICE) throw new Error(`Prix entre ${min} et ${MAX_PRICE} pièces`);
  return n;
};

export function removeCard(user, cardId, n = 1) {
  const e = user.collection[cardId];
  if (!e || e.count < n) throw new Error('Tu n\'as pas cette carte (ou plus assez d\'exemplaires)');
  e.count -= n;
  if (!e.count) delete user.collection[cardId];
}
function giveCard(user, cardId) { const c = db.cards[cardId]; if (c) addCard(user, c); }
function note(user, text) {
  if (!user) return;
  (user.notes ||= []).unshift({ text, at: Date.now() });
  user.notes.length = Math.min(user.notes.length, 30);
}
const fee = n => Math.floor(n * MARKET_FEE);
function record(kind, cardId, amount) {
  const m = store();
  m.history.unshift({ kind, cardId, amount, at: Date.now() });
  m.history.length = Math.min(m.history.length, 200);
}
function countOpen(userId) {
  const m = store();
  return Object.values(m.listings).filter(l => l.seller === userId).length + Object.values(m.auctions).filter(a => a.seller === userId).length;
}
const title = id => db.cards[id]?.title || 'une carte';
const nameOf = id => db.users[id]?.name || '?';

// ---------- Marché (prix fixe) ----------
export function listCard(user, cardId, p) {
  const amount = price(p);
  if (!db.cards[cardId]) throw new Error('Carte inconnue');
  if (countOpen(user.id) >= MAX_LISTINGS) throw new Error(`Maximum ${MAX_LISTINGS} ventes en même temps`);
  removeCard(user, cardId);
  const id = newId();
  store().listings[id] = { id, cardId, seller: user.id, price: amount, at: Date.now() };
  save();
  return id;
}
export function buyListing(user, id) {
  const m = store(), l = m.listings[id];
  if (!l) throw new Error('Cette carte n\'est plus en vente');
  if (l.seller === user.id) throw new Error('C\'est ta propre vente : annule-la plutôt');
  if (user.coins < l.price) throw new Error(`Il te faut ${l.price} pièces`);
  delete m.listings[id];
  user.coins -= l.price;
  giveCard(user, l.cardId);
  const seller = db.users[l.seller];
  if (seller) { seller.coins += l.price - fee(l.price); note(seller, `💰 ${user.name} a acheté ta carte « ${title(l.cardId)} » pour ${l.price} pièces (+${l.price - fee(l.price)} après la commission).`); }
  record('vente', l.cardId, l.price);
  save();
}
export function cancelListing(user, id) {
  const m = store(), l = m.listings[id];
  if (!l || l.seller !== user.id) throw new Error('Vente introuvable');
  delete m.listings[id];
  giveCard(user, l.cardId);
  save();
}

// ---------- Enchères ----------
export function startAuction(user, cardId, startPrice, hours, buyout) {
  const start = price(startPrice);
  const h = Number(hours);
  if (!AUCTION_HOURS.includes(h)) throw new Error('Durée invalide');
  const bo = buyout ? price(buyout, start + 1) : null;
  if (!db.cards[cardId]) throw new Error('Carte inconnue');
  if (countOpen(user.id) >= MAX_LISTINGS) throw new Error(`Maximum ${MAX_LISTINGS} ventes en même temps`);
  removeCard(user, cardId);
  const id = newId();
  store().auctions[id] = { id, cardId, seller: user.id, start, buyout: bo, bid: 0, bidder: null, bids: 0, endsAt: Date.now() + h * 3600e3, at: Date.now() };
  save();
  return id;
}
export const minBid = a => (a.bidder ? a.bid + Math.max(1, Math.ceil(a.bid * 0.05)) : a.start);

export function placeBid(user, id, amount) {
  settleAuctions();
  const a = store().auctions[id];
  if (!a) throw new Error('Enchère terminée');
  if (a.seller === user.id) throw new Error('Tu ne peux pas enchérir sur ta propre carte');
  if (a.bidder === user.id) throw new Error('Tu es déjà le meilleur enchérisseur');
  let n = price(amount);
  if (a.buyout && n >= a.buyout) n = a.buyout;
  if (n < minBid(a)) throw new Error(`Enchère minimum : ${minBid(a)} pièces`);
  if (user.coins < n) throw new Error(`Il te faut ${n} pièces`);
  user.coins -= n;
  const prev = db.users[a.bidder];
  if (prev) { prev.coins += a.bid; note(prev, `⚠️ ${user.name} a surenchéri sur « ${title(a.cardId)} » (${n} pièces). Tes ${a.bid} pièces te sont rendues.`); }
  a.bid = n; a.bidder = user.id; a.bids++;
  // Une enchère dans les 2 dernières minutes prolonge un peu, pour éviter les « coups de dernière seconde ».
  if (a.endsAt - Date.now() < 120e3) a.endsAt = Date.now() + 120e3;
  if (a.buyout && n >= a.buyout) closeAuction(a);
  save();
  return { won: !store().auctions[id] };
}
export function cancelAuction(user, id) {
  const m = store(), a = m.auctions[id];
  if (!a || a.seller !== user.id) throw new Error('Enchère introuvable');
  if (a.bidder) throw new Error('Impossible d\'annuler : quelqu\'un a déjà enchéri');
  delete m.auctions[id];
  giveCard(user, a.cardId);
  save();
}
function closeAuction(a) {
  const m = store();
  delete m.auctions[a.id];
  const seller = db.users[a.seller];
  if (!a.bidder) {
    if (seller) { giveCard(seller, a.cardId); note(seller, `⌛ Personne n'a enchéri sur « ${title(a.cardId)} » : la carte revient dans ta collection.`); }
    return;
  }
  const winner = db.users[a.bidder];
  if (winner) { giveCard(winner, a.cardId); note(winner, `🏆 Tu as gagné l'enchère « ${title(a.cardId)} » pour ${a.bid} pièces !`); }
  if (seller) { seller.coins += a.bid - fee(a.bid); note(seller, `🔨 « ${title(a.cardId)} » vendue aux enchères à ${nameOf(a.bidder)} pour ${a.bid} pièces (+${a.bid - fee(a.bid)} après la commission).`); }
  record('enchère', a.cardId, a.bid);
}
export function settleAuctions() {
  const now = Date.now();
  let n = 0;
  for (const a of Object.values(store().auctions)) if (a.endsAt <= now) { closeAuction(a); n++; }
  if (n) save();
}

// ---------- Échanges ----------
// Une proposition : ce que je donne (cartes + pièces) contre ce que je veux de l'autre joueur.
// Rien n'est bloqué pendant l'attente : tout est vérifié au moment où l'autre accepte.
function cleanSide(side = {}) {
  const cards = [...new Set((Array.isArray(side.cards) ? side.cards : []).map(String))].slice(0, 10);
  cards.forEach(id => { if (!db.cards[id]) throw new Error('Carte inconnue dans l\'échange'); });
  const coins = side.coins ? price(side.coins, 0) : 0;
  return { cards, coins };
}
function hasAll(user, side) {
  return side.cards.every(id => user.collection[id]?.count > 0) && user.coins >= side.coins;
}
export function proposeTrade(user, toName, give, want, message) {
  const to = userByName(String(toName || '').trim());
  if (!to) throw new Error('Joueur introuvable');
  if (to.id === user.id) throw new Error('Tu ne peux pas échanger avec toi-même');
  const g = cleanSide(give), w = cleanSide(want);
  if (!g.cards.length && !g.coins && !w.cards.length && !w.coins) throw new Error('Propose au moins une carte ou des pièces');
  if (!hasAll(user, g)) throw new Error('Tu n\'as pas tout ce que tu proposes');
  if (!hasAll(to, w)) throw new Error(`${to.name} n'a pas tout ce que tu demandes`);
  const m = store();
  if (Object.values(m.trades).filter(t => t.from === user.id).length >= MAX_TRADES) throw new Error(`Maximum ${MAX_TRADES} propositions en attente`);
  const id = newId();
  m.trades[id] = { id, from: user.id, to: to.id, give: g, want: w, message: String(message || '').slice(0, 140), at: Date.now() };
  note(to, `🤝 ${user.name} te propose un échange : va voir le centre d'échange.`);
  save();
  return id;
}
export function answerTrade(user, id, accept) {
  const m = store(), t = m.trades[id];
  if (!t || (t.to !== user.id && t.from !== user.id)) throw new Error('Échange introuvable');
  const from = db.users[t.from], to = db.users[t.to];
  if (!accept) {
    delete m.trades[id];
    if (t.to === user.id) note(from, `❌ ${user.name} a refusé ton échange.`);
    save();
    return;
  }
  if (t.to !== user.id) throw new Error('Seul le joueur qui reçoit la proposition peut l\'accepter');
  if (!from || !hasAll(from, t.give)) throw new Error(`${from?.name || 'L\'autre joueur'} n'a plus tout ce qu'il proposait`);
  if (!hasAll(to, t.want)) throw new Error('Tu n\'as plus tout ce qui est demandé');
  delete m.trades[id];
  t.give.cards.forEach(c => removeCard(from, c));
  t.want.cards.forEach(c => removeCard(to, c));
  from.coins += t.want.coins - t.give.coins;
  to.coins += t.give.coins - t.want.coins;
  t.give.cards.forEach(c => giveCard(to, c));
  t.want.cards.forEach(c => giveCard(from, c));
  note(from, `✅ ${to.name} a accepté ton échange !`);
  save();
}

// ---------- Lecture ----------
const strip = c => { if (!c) return null; const { categories, qidChecked, ...card } = c; return card; };
export function marketView(user) {
  settleAuctions();
  const m = store();
  const listings = Object.values(m.listings).filter(l => db.cards[l.cardId])
    .map(l => ({ id: l.id, card: strip(db.cards[l.cardId]), price: l.price, seller: nameOf(l.seller), mine: l.seller === user.id, at: l.at }));
  const auctions = Object.values(m.auctions).filter(a => db.cards[a.cardId])
    .map(a => ({ id: a.id, card: strip(db.cards[a.cardId]), start: a.start, buyout: a.buyout, bid: a.bid, bids: a.bids, minBid: minBid(a),
      leader: a.bidder ? nameOf(a.bidder) : null, leading: a.bidder === user.id, seller: nameOf(a.seller), mine: a.seller === user.id, endsAt: a.endsAt }));
  const side = s => ({ coins: s.coins, cards: s.cards.map(id => strip(db.cards[id])).filter(Boolean) });
  const trades = Object.values(m.trades).filter(t => t.from === user.id || t.to === user.id)
    .map(t => ({ id: t.id, incoming: t.to === user.id, other: nameOf(t.to === user.id ? t.from : t.to),
      give: side(t.give), want: side(t.want), message: t.message, at: t.at }));
  return { listings, auctions, trades, notes: (user.notes || []).slice(0, 15), fee: MARKET_FEE, hours: AUCTION_HOURS,
    recent: m.history.slice(0, 12).map(x => ({ ...x, title: title(x.cardId) })) };
}
export function playerCards(name) {
  const u = userByName(String(name || '').trim());
  if (!u) throw new Error('Joueur introuvable');
  return { name: u.name, cards: Object.entries(u.collection).map(([id, e]) => ({ card: strip(db.cards[id]), count: e.count })).filter(x => x.card) };
}

setInterval(settleAuctions, 30e3).unref();
