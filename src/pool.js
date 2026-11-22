// Réserve de cartes prêtes à l'emploi, remplie en arrière-plan.
import { randomPages, pagesByTitle, topArticles, categoryMembers, introLinksBatch } from './wiki.js';
import { buildCard } from './cardgen.js';
import { isSensitivePage } from './filter.js';
import { db, save } from './db.js';
import { rarityIndex, RARITY_IDS, rarityFromViews } from '../public/shared/types.js';

const randomBuffer = [];                    // ids de cartes tirées au hasard
const buckets = { rare: [], epique: [], legendaire: [] }; // ids de cartes populaires
let popular = [];                           // [{ title, est }]
const linkCandidates = new Set();           // titres probablement « Rares »
let popularLoadedAt = 0;
const RANDOM_TARGET = 40, BUCKET_TARGET = 5;

function acceptable(page) {
  if (!page || !page.extract || page.extract.length < 40) return false;
  if (page.disambiguation || isSensitivePage(page)) return false;
  if (/^(Liste|Chronologie|Index|Glossaire|Portail|Années?) /i.test(page.title)) return false;
  if (/^\d+( av\. J\.-C\.)?$/.test(page.title)) return false;
  return true;
}

// Transforme des pages en cartes (une seule requête groupée pour les liens).
export async function cardsFromPages(pages) {
  const fresh = pages.filter(p => !db.cards[p.pageid] && acceptable(p));
  const links = fresh.length ? await introLinksBatch(fresh.map(p => p.pageid)) : new Map();
  const out = [];
  for (const p of pages) {
    if (db.cards[p.pageid]) { out.push(db.cards[p.pageid]); continue; }
    if (!fresh.includes(p)) continue;
    const pageLinks = links.get(p.pageid) || [];
    const card = await buildCard(p, pageLinks).catch(() => null);
    if (!card) continue;
    // Les pages citées par une page connue sont souvent « Rares » : on les garde en réserve.
    if (rarityIndex(card.rarity) >= 2) for (const l of pageLinks.slice(0, 30)) if (/^[A-ZÀ-Ö]/.test(l.text) && !/^\d/.test(l.target)) linkCandidates.add(l.target);
    db.cards[card.id] = card;
    out.push(card);
  }
  save();
  return out;
}

async function refillRandom() {
  const pages = (await randomPages(15)).filter(p => p.image || Math.random() < 0.5); // on préfère les pages illustrées
  for (const card of await cardsFromPages(pages)) {
    if (rarityIndex(card.rarity) >= 2 && buckets[card.rarity].length < BUCKET_TARGET * 2) buckets[card.rarity].push(card.id);
    else randomBuffer.push(card.id);
  }
}

async function loadPopular() {
  const list = await topArticles(3);
  if (list.length) {
    popular = list.map(x => ({ title: x.title, est: x.monthly * 12 }));
    popularLoadedAt = Date.now();
  }
}

async function refillBucket(rarity) {
  if (!popular.length) return;
  const ri = rarityIndex(rarity);
  let titles;
  if (rarity === 'rare' && linkCandidates.size >= 8) {
    titles = shuffle([...linkCandidates]).slice(0, 10);
    titles.forEach(t => linkCandidates.delete(t));
  } else {
    const cands = popular.filter(p => rarityIndex(rarityFromViews(p.est)) === ri);
    titles = shuffle(cands.length ? cands : popular).slice(0, 8).map(p => p.title);
  }
  const pages = await pagesByTitle(titles);
  for (const card of await cardsFromPages(pages)) {
    if (buckets[card.rarity] && !buckets[card.rarity].includes(card.id)) buckets[card.rarity].push(card.id);
    else if (!buckets[card.rarity]) randomBuffer.push(card.id);
  }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    if (Date.now() - popularLoadedAt > 12 * 3600e3) await loadPopular();
    if (randomBuffer.length < RANDOM_TARGET) await refillRandom();
    for (const r of ['rare', 'epique', 'legendaire']) if (buckets[r].length < BUCKET_TARGET) { await refillBucket(r); break; }
  } catch (e) {
    console.warn('[pool]', e.message);
  } finally {
    running = false;
  }
}

export function startPool() {
  // Au démarrage, on recycle les cartes déjà générées lors des parties précédentes.
  for (const c of Object.values(db.cards)) {
    if (rarityIndex(c.rarity) >= 2) { if (buckets[c.rarity].length < BUCKET_TARGET * 3) buckets[c.rarity].push(c.id); }
    else if (randomBuffer.length < RANDOM_TARGET) randomBuffer.push(c.id);
  }
  shuffle(randomBuffer);
  tick();
  setInterval(tick, 4000);
}

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function waitFor(check, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = check();
    if (v) return v;
    tick();
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

// Une carte au hasard (surtout communes, comme une vraie page aléatoire).
export async function drawRandom() {
  const id = await waitFor(() => randomBuffer.shift());
  if (id) return db.cards[id];
  const any = Object.values(db.cards);
  return any[Math.floor(Math.random() * any.length)] || null;
}

// Une carte d'une rareté précise (pour les packs, la tour et les boss).
export async function drawRarity(rarity) {
  const ri = rarityIndex(rarity);
  if (ri < 2) {
    const idx = randomBuffer.findIndex(id => db.cards[id]?.rarity === rarity);
    if (idx >= 0) return db.cards[randomBuffer.splice(idx, 1)[0]];
    if (ri === 1) {
      const cached = Object.values(db.cards).filter(c => c.rarity === 'peu');
      if (cached.length > 5) return cached[Math.floor(Math.random() * cached.length)];
    }
    return drawRandom();
  }
  const id = await waitFor(() => buckets[rarity].shift(), 15000);
  if (id) {
    // On garde la carte en circulation : elle pourra ressortir plus tard.
    if (Math.random() < 0.5) buckets[rarity].push(id);
    return db.cards[id];
  }
  const cached = Object.values(db.cards).filter(c => c.rarity === rarity);
  if (cached.length) return cached[Math.floor(Math.random() * cached.length)];
  return drawRarity(RARITY_IDS[ri - 1]);
}

export function rollRareSlot() {
  const r = Math.random();
  return r < 0.06 ? 'legendaire' : r < 0.30 ? 'epique' : 'rare';
}

export async function openPack() {
  const cards = [];
  for (let i = 0; i < 4; i++) cards.push(await drawRandom());
  cards.push(await drawRarity(rollRareSlot()));
  return cards.filter(Boolean);
}

// Cartes d'une catégorie Wikipédia (thème du jour).
const themeCache = new Map();
export async function themeCards(category, n = 3) {
  let titles = themeCache.get(category);
  if (!titles) {
    titles = await categoryMembers(category, 300);
    themeCache.set(category, titles);
  }
  const sample = shuffle([...titles]).slice(0, Math.min(titles.length, n * 4));
  const pages = shuffle(await pagesByTitle(sample)).filter(acceptable).slice(0, n + 2);
  return (await cardsFromPages(pages)).slice(0, n);
}

export const poolStatus = () => ({ random: randomBuffer.length, rare: buckets.rare.length, epique: buckets.epique.length, legendaire: buckets.legendaire.length, popular: popular.length });
