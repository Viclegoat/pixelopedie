// Réserve de cartes prêtes à l'emploi, remplie en arrière-plan.
import { randomPages, pagesByTitle, topArticles, categoryMembers, introLinksBatch, searchPages, isCoolingDown, urgent, qidsFor } from './wiki.js';
import { buildCard, reclassify } from './cardgen.js';
import { isSensitivePage } from './filter.js';
import { db, save, cardChanged } from './db.js';
import { rarityIndex, RARITY_IDS, rarityFromViews, LANGS, LANG_IDS } from '../public/shared/types.js';

const randomBuffer = [];                    // ids de cartes tirées au hasard
const buckets = { rare: [], epique: [], legendaire: [], mythique: [] }; // ids de cartes populaires
let popular = [];                           // [{ key: 'langue|titre', est }]
const linkCandidates = new Set();           // 'langue|titre' probablement « Rares »
let popularLoadedAt = 0;
const RANDOM_TARGET = 40, BUCKET_TARGET = 5;
// Le serveur continue de fabriquer des cartes en arrière-plan jusqu'à ce nombre (réglable).
const CATALOG_TARGET = Number(process.env.CATALOG_TARGET || 20000);
const byRarity = {};                        // rareté -> ids de toutes les cartes connues
const knownTitles = new Set(), triedTitles = new Set(); // 'langue|titre'
const knownQids = new Map();                            // numéro Wikidata -> id de carte
const frByTitle = new Map();                            // titre français -> id de carte
function indexCard(card) {
  (byRarity[card.rarity] ||= []).push(card.id);
  knownTitles.add((card.lang || 'fr') + '|' + card.title);
  if (card.qid) knownQids.set(card.qid, card.id);
  if ((card.lang || 'fr') === 'fr') frByTitle.set(card.title, card.id);
}
const cardKey = p => (p.lang && p.lang !== 'fr' ? p.lang + ':' : '') + p.pageid;
const splitKey = k => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };
// Va chercher des pages données par 'langue|titre', groupées par langue.
async function pagesByKeys(keys) {
  const groups = new Map();
  for (const k of keys) { const [lang, title] = splitKey(k); (groups.get(lang) || groups.set(lang, []).get(lang)).push(title); }
  const out = [];
  for (const [lang, titles] of groups) out.push(...await pagesByTitle(titles, lang));
  return out;
}
function pickLang() {
  let r = Math.random();
  for (const l of LANG_IDS) { r -= LANGS[l].weight; if (r <= 0) return l; }
  return 'fr';
}

function acceptable(page) {
  if (!page || !page.extract || page.extract.length < 40) return false;
  // Une page étrangère a besoin d'une description française (pour le type, le dessin et le filtre).
  if (page.lang && page.lang !== 'fr' && !page.frDescription) return false;
  if (page.disambiguation || isSensitivePage(page)) return false;
  if (/^(Liste|Chronologie|Index|Glossaire|Portail|Années?|List|Lists|Timeline|Glossary|Outline|Index|Lista|Listas|Liste der|Anexo|Cronología|Cronologia|Elenco) /i.test(page.title)) return false;
  if (/\b(liste|page d[’']homonymie|page de liste|projet wikimedia|article de liste)\b/i.test(page.frDescription || '')) return false;
  if (/^\d+( av\. J\.-C\.)?$/.test(page.title)) return false;
  return true;
}

// Transforme des pages en cartes (une seule requête groupée pour les liens).
export async function cardsFromPages(pages) {
  // La même page dans une autre langue existe déjà : on garde la carte existante.
  const existing = p => db.cards[cardKey(p)] || (p.qid && db.cards[knownQids.get(p.qid)]) ||
    (p.lang !== 'fr' && p.frTitle && db.cards[frByTitle.get(p.frTitle)]);
  const fresh = pages.filter(p => !existing(p) && acceptable(p));
  const links = new Map();
  for (const lang of new Set(fresh.map(p => p.lang || 'fr'))) {
    for (const [id, l] of await introLinksBatch(fresh.filter(p => (p.lang || 'fr') === lang).map(p => p.pageid), lang)) links.set(lang + ':' + id, l);
  }
  const out = [];
  for (const p of pages) {
    if (existing(p)) { out.push(existing(p)); continue; }
    if (!fresh.includes(p)) continue;
    const pageLinks = links.get((p.lang || 'fr') + ':' + p.pageid) || [];
    const card = await buildCard(p, pageLinks).catch(() => null);
    if (!card) continue;
    // Les pages citées par une page connue sont souvent « Rares » : on les garde en réserve.
    if (rarityIndex(card.rarity) >= 2 && linkCandidates.size < 5000) for (const l of pageLinks.slice(0, 30)) if (/^[A-ZÀ-Ö]/.test(l.text) && !/^\d/.test(l.target) && !knownTitles.has(card.lang + '|' + l.target)) linkCandidates.add(card.lang + '|' + l.target);
    db.cards[card.id] = card;
    indexCard(card);
    out.push(card);
  }
  save();
  return out;
}

async function refillRandom() {
  const pages = (await randomPages(15, pickLang())).filter(p => p.image || Math.random() < 0.5); // on préfère les pages illustrées
  for (const card of await cardsFromPages(pages)) {
    if (rarityIndex(card.rarity) >= 2 && buckets[card.rarity].length < BUCKET_TARGET * 2) buckets[card.rarity].push(card.id);
    else randomBuffer.push(card.id);
  }
}

async function loadPopular() {
  // Les plus lues de l'année dans chaque langue (des milliers de légendaires), mélangées langue par langue.
  const lists = [];
  for (const lang of LANG_IDS) {
    const list = await topArticles(lang === 'fr' ? 12 : 6, lang);
    lists.push(list.map(x => ({ key: lang + '|' + x.title, est: x.monthly * 12 / LANGS[lang].size })));
  }
  const mixed = [];
  for (let i = 0; lists.some(l => i < l.length); i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
  if (mixed.length) { popular = mixed; popularLoadedAt = Date.now(); }
}

async function refillBucket(rarity) {
  if (!popular.length) return;
  const ri = rarityIndex(rarity);
  let titles;
  // Rares et épiques : les pages citées par des pages connues. Légendaires et mythiques : les plus lues du mois.
  if ((rarity === 'rare' || rarity === 'epique') && linkCandidates.size >= 8) {
    titles = shuffle([...linkCandidates]).slice(0, 10);
    titles.forEach(t => linkCandidates.delete(t));
  } else {
    const cands = popular.filter(p => rarityIndex(rarityFromViews(p.est)) === ri);
    titles = shuffle(cands.length ? cands : popular).slice(0, 8).map(p => p.key);
  }
  const pages = await pagesByKeys(titles);
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
    // Tant qu'il y a peu de cartes d'une rareté, on en cherche exprès pour les packs.
    const low = ['rare', 'epique', 'legendaire', 'mythique'].find(r => buckets[r].length < BUCKET_TARGET && (byRarity[r]?.length || 0) < 30);
    if (low) await refillBucket(low);
    else if (!isCoolingDown()) await explore();
  } catch (e) {
    console.warn('[pool]', e.message);
  } finally {
    running = false;
  }
}

export function startPool() {
  // Si les seuils de rareté ont changé, on reclasse les cartes déjà créées.
  let moved = 0;
  for (const c of Object.values(db.cards)) if (reclassify(c)) { cardChanged(c.id); moved++; }
  if (db.meta?.boss && db.cards[db.meta.boss.cardId]) db.meta.boss.rarity = db.cards[db.meta.boss.cardId].rarity;
  if (moved) { console.log(`[pool] ${moved} cartes changent de rareté.`); save(); }
  for (const c of Object.values(db.cards)) indexCard(c);
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
  // Assez de cartes connues de cette rareté : on en tire une au hasard parmi toutes.
  const known = byRarity[rarity] || [];
  if (known.length >= 30 && !buckets[rarity].length) return db.cards[known[Math.floor(Math.random() * known.length)]];
  const id = await waitFor(() => buckets[rarity].shift(), 15000);
  if (id) return db.cards[id];
  const cached = Object.values(db.cards).filter(c => c.rarity === rarity);
  if (cached.length) return cached[Math.floor(Math.random() * cached.length)];
  return drawRarity(RARITY_IDS[ri - 1]);
}

export function rollRareSlot() {
  const r = Math.random();
  return r < 0.03 ? 'mythique' : r < 0.15 ? 'legendaire' : r < 0.40 ? 'epique' : 'rare';
}

export async function openPack() {
  const cards = [];
  for (let i = 0; i < 4; i++) cards.push(await drawRandom());
  cards.push(await drawRarity(rollRareSlot()));
  return cards.filter(Boolean);
}

// Exploration : fabrique des cartes en avance, pour que la liste « Toutes les cartes » soit bien remplie.
// Une étape = environ 5 requêtes groupées vers Wikipédia, faites seulement quand les packs ont ce qu'il leur faut.
let exploreTurn = 0;
async function explore() {
  if (Object.keys(db.cards).length >= CATALOG_TARGET) return;
  const take = list => {
    const out = [];
    for (const t of list) {
      if (out.length >= 20) break;
      if (knownTitles.has(t) || triedTitles.has(t)) continue;
      triedTitles.add(t);
      out.push(t);
    }
    return out;
  };
  // D'abord, retrouver le numéro Wikidata des anciennes cartes, pour ne pas les recréer dans une autre langue.
  const noQid = Object.values(db.cards).filter(c => !c.qid && (c.lang || 'fr') === 'fr' && !c.qidChecked).slice(0, 50);
  if (noQid.length) {
    const found = await qidsFor(noQid.map(c => c.id), 'fr');
    for (const c of noQid) { c.qidChecked = true; const q = found.get(c.id); if (q) { c.qid = q; knownQids.set(q, c.id); } cardChanged(c.id); }
    save();
    return;
  }
  const turn = exploreTurn++ % 3;
  let titles = [];
  if (turn === 0) titles = take(popular.map(p => p.key));              // les plus lues de l'année
  else if (turn === 1) { titles = take(linkCandidates); titles.forEach(t => linkCandidates.delete(t)); } // les pages qu'elles citent
  if (titles.length) {
    await cardsFromPages(await pagesByKeys(titles));
  } else {
    for (const card of await cardsFromPages(await randomPages(20, pickLang()))) if (randomBuffer.length < RANDOM_TARGET * 2) randomBuffer.push(card.id);
  }
}

// Recherche d'une page précise dans tout Wikipédia : les pages trouvées deviennent des cartes tout de suite.
export async function searchCards(q, lang = 'fr') {
  const pages = await urgent(() => searchPages(q, 10, lang));
  const isNew = new Set(pages.filter(p => !db.cards[cardKey(p)] && !(p.qid && knownQids.has(p.qid)) && !(p.frTitle && frByTitle.has(p.frTitle))).map(cardKey));
  const cards = await urgent(() => cardsFromPages(pages));
  // cardsFromPages rend les cartes dans l'ordre des pages : celui de la pertinence.
  return { cards, added: cards.filter(c => isNew.has(c.id)).length };
}

export const catalogInfo = () => ({ known: Object.keys(db.cards).length, target: CATALOG_TARGET });

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

export const poolStatus = () => ({ random: randomBuffer.length, rare: buckets.rare.length, epique: buckets.epique.length, legendaire: buckets.legendaire.length, mythique: buckets.mythique.length, popular: popular.length });
