// Accès à Wikipédia (fr). Les requêtes sont groupées et espacées pour rester
// raisonnable avec les serveurs de Wikimedia.
import { AsyncLocalStorage } from 'node:async_hooks';

const CONTACT = process.env.WIKI_CONTACT || 'jeu open source';
const UA = `Pixelopedie/1.0 (${CONTACT}) Node.js`;
const apiUrl = (lang = 'fr') => `https://${lang}.wikipedia.org/w/api.php`;
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const METRICS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// File d'attente : une requête à la fois, au moins GAP ms entre deux départs.
// Wikimedia limite fortement les robots sans contact : on reste très sobre.
const GAP = Number(process.env.WIKI_GAP_MS || 600);
// Les requêtes lancées pour un joueur qui attend (recherche) passent avant l'exploration en arrière-plan.
const urgentCtx = new AsyncLocalStorage();
export const urgent = fn => urgentCtx.run(true, fn);
// Une pause demandée par un site (en.wikipedia.org…) ne bloque que ce site : les autres langues continuent.
let lastStart = 0, pumping = false;
const cooldown = new Map();                 // hôte -> date de fin de pause
const coolingDown = host => (cooldown.get(host) || 0) > Date.now();
const queues = { high: [], low: [] };
function limited(fn, host) {
  return new Promise((resolve, reject) => {
    queues[urgentCtx.getStore() ? 'high' : 'low'].push({ fn, host, resolve, reject });
    pumpQueue();
  });
}
function nextJob() {
  for (const q of [queues.high, queues.low]) {
    const i = q.findIndex(j => !coolingDown(j.host));
    if (i >= 0) return q.splice(i, 1)[0];
  }
  return null;
}
async function pumpQueue() {
  if (pumping) return;
  pumping = true;
  try {
    while (queues.high.length || queues.low.length) {
      const job = nextJob();
      if (!job) { await sleep(Math.max(200, Math.min(...cooldown.values()) - Date.now())); continue; }
      const wait = lastStart + GAP - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      try { job.resolve(await job.fn()); } catch (e) { job.reject(e); }
    }
  } finally {
    pumping = false;
  }
}
// Vrai quand Wikipédia FR (la plus utilisée) demande une pause.
export const isCoolingDown = () => coolingDown('fr.wikipedia.org');

async function getJSON(url) {
  const host = new URL(url).hostname;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await limited(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: ctrl.signal });
        if (res.status === 404) return { done: null };
        const text = await res.text();
        if (res.status === 429 || /too many requests/i.test(text.slice(0, 200))) {
          const ra = Number(res.headers.get('retry-after')) || 30;
          cooldown.set(host, Date.now() + (ra + 2) * 1000);
          console.warn(`[wiki] ${host} demande une pause de ${ra} s`);
          return { retry: true };
        }
        if (res.status >= 500) { await sleep(1500); return { retry: true }; }
        if (!res.ok) return { done: null };
        return { done: JSON.parse(text) };
      } catch {
        return { retry: true };
      } finally {
        clearTimeout(timer);
      }
    }, host);
    if (!result.retry) return result.done;
  }
  return null;
}

const enc = title => encodeURIComponent(title.replace(/ /g, '_'));
const qs = obj => new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...obj }).toString();

const PAGE_PROPS = {
  prop: 'extracts|pageimages|description|categories|pageprops|info',
  exintro: '1', explaintext: '1', exlimit: 'max', exsentences: '5',
  piprop: 'thumbnail', pithumbsize: '330',
  clshow: '!hidden', cllimit: 'max',
  ppprop: 'disambiguation|wikibase_item',
};

function normalizePage(p, lang = 'fr') {
  return {
    lang,
    qid: p.pageprops?.wikibase_item || null,
    pageid: p.pageid,
    title: p.title,
    description: p.description || '',
    extract: (p.extract || '').trim(),
    image: p.thumbnail?.source || null,
    categories: (p.categories || []).map(c => c.title.replace(/^Catégorie:/, '')),
    disambiguation: !!p.pageprops?.disambiguation || /homonymie/i.test(p.description || '') || /\(homonymie\)$/.test(p.title),
    length: p.length || 0,
    views: 0,
  };
}

// Fusionne les réponses paginées (« continue ») d'une requête query.
async function queryAll(params, maxRounds = 4, lang = 'fr') {
  const pages = new Map();
  let cont = {};
  for (let i = 0; i < maxRounds; i++) {
    const data = await getJSON(`${apiUrl(lang)}?${qs({ ...params, ...cont })}`);
    if (!data?.query?.pages) break;
    for (const p of data.query.pages) {
      if (p.missing || p.invalid) continue;
      const prev = pages.get(p.pageid) || {};
      const merged = { ...prev, ...p };
      if (prev.categories && p.categories) merged.categories = [...prev.categories, ...p.categories];
      if (prev.pageviews && p.pageviews) merged.pageviews = { ...prev.pageviews, ...p.pageviews };
      pages.set(p.pageid, merged);
    }
    if (!data.continue) break;
    // On abandonne la page aléatoire suivante, on veut juste compléter les propriétés.
    const { grncontinue, ...rest } = data.continue;
    if (Object.keys(rest).length <= 1) break;
    cont = rest;
    if (params.generator) cont.grncontinue = grncontinue;
  }
  return [...pages.values()];
}

// Vues des 60 derniers jours, ramenées à une estimation annuelle.
export async function addViews(pages) {
  const lang = pages[0]?.lang || 'fr';
  for (let i = 0; i < pages.length; i += 20) {
    const chunk = pages.slice(i, i + 20);
    const res = await queryAll({ prop: 'pageviews', pvipdays: '60', titles: chunk.map(p => p.title).join('|') }, 6, lang);
    for (const r of res) {
      const p = chunk.find(c => c.pageid === r.pageid || c.title === r.title);
      if (!p) continue;
      const sum = Object.values(r.pageviews || {}).reduce((s, v) => s + (v || 0), 0);
      p.views = Math.round(sum * 365 / 60);
    }
  }
  return pages;
}

// Pour une page étrangère : sa description en français (Wikidata), qui sert au type, au dessin et au filtre.
export async function frenchInfo(pages) {
  const todo = pages.filter(p => p.lang !== 'fr' && p.qid);
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50);
    const data = await getJSON(`${WIKIDATA}?${new URLSearchParams({ action: 'wbgetentities', format: 'json', props: 'descriptions|labels', languages: 'fr', ids: chunk.map(p => p.qid).join('|') })}`);
    for (const p of chunk) {
      const e = data?.entities?.[p.qid];
      p.frDescription = e?.descriptions?.fr?.value || '';
      p.frTitle = e?.labels?.fr?.value || '';
    }
  }
  return pages;
}

async function finish(pages) {
  await addViews(pages);
  return frenchInfo(pages);
}

export async function randomPages(n = 10, lang = 'fr') {
  const raw = await queryAll({ generator: 'random', grnnamespace: '0', grnlimit: String(Math.min(n, 20)), ...PAGE_PROPS }, 3, lang);
  return finish(raw.map(p => normalizePage(p, lang)));
}

export async function pagesByTitle(titles, lang = 'fr') {
  const out = [];
  for (let i = 0; i < titles.length; i += 20) {
    const raw = await queryAll({ titles: titles.slice(i, i + 20).join('|'), redirects: '1', ...PAGE_PROPS }, 3, lang);
    out.push(...raw.map(p => normalizePage(p, lang)));
  }
  return finish(out);
}

// Numéros Wikidata de pages déjà connues (pour ne pas créer deux fois la même carte dans deux langues).
export async function qidsFor(pageids, lang = 'fr') {
  const out = new Map();
  for (let i = 0; i < pageids.length; i += 50) {
    const data = await getJSON(`${apiUrl(lang)}?${qs({ prop: 'pageprops', ppprop: 'wikibase_item', pageids: pageids.slice(i, i + 50).join('|') })}`);
    for (const p of data?.query?.pages || []) out.set(String(p.pageid), p.pageprops?.wikibase_item || '');
  }
  return out;
}

// Recherche dans tout Wikipédia (titres et texte), dans l'ordre de pertinence.
export async function searchPages(q, n = 12, lang = 'fr') {
  const raw = await queryAll({ generator: 'search', gsrsearch: q, gsrnamespace: '0', gsrlimit: String(n), ...PAGE_PROPS }, 1, lang);
  raw.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  return finish(raw.slice(0, n).map(p => normalizePage(p, lang)));
}

// Retire les blocs imbriqués ({{modèles}}, {| tableaux |}).
function stripNested(text, open, close) {
  let out = '', depth = 0;
  for (let i = 0; i < text.length;) {
    if (text.startsWith(open, i)) { depth++; i += open.length; continue; }
    if (depth && text.startsWith(close, i)) { depth--; i += close.length; continue; }
    if (!depth) out += text[i];
    i++;
  }
  return out;
}

function stripFiles(text) {
  const re = /\[\[(Fichier|File|Image|Média|Media|Datei|Bild|Archivo|Imagen|Ficheiro|Arquivo|Imagem|Immagine):/gi;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0, i = m.index;
    for (; i < text.length; i++) {
      if (text.startsWith('[[', i)) { depth++; i++; }
      else if (text.startsWith(']]', i)) { depth--; i++; if (!depth) break; }
    }
    text = text.slice(0, m.index) + text.slice(i + 1);
    re.lastIndex = m.index;
  }
  return text;
}

// Liens de l'introduction, dans l'ordre du texte (sert à nommer les attaques).
export function linksFromWikitext(wikitext) {
  let intro = (wikitext || '').split(/\n==[^=]/)[0];
  intro = intro.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '');
  intro = stripNested(intro, '{{', '}}');
  intro = stripNested(intro, '{|', '|}');
  intro = stripFiles(intro);
  const links = [], seen = new Set();
  const re = /\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g;
  let m;
  while ((m = re.exec(intro))) {
    let target = m[1].trim().replace(/_/g, ' ');
    if (!target || /^[^ ]+:/.test(target) && !/^[^:]+ : /.test(target)) continue;
    target = target.charAt(0).toUpperCase() + target.slice(1);
    const text = (m[2] || m[1]).replace(/'''?/g, '').trim();
    if (!text || seen.has(target)) continue;
    seen.add(target);
    links.push({ target, text });
  }
  return links;
}

export async function introLinksBatch(pageids, lang = 'fr') {
  const out = new Map();
  for (let i = 0; i < pageids.length; i += 15) {
    const data = await getJSON(`${apiUrl(lang)}?${qs({ prop: 'revisions', rvprop: 'content', rvslots: 'main', pageids: pageids.slice(i, i + 15).join('|') })}`);
    for (const p of data?.query?.pages || []) {
      out.set(p.pageid, linksFromWikitext(p.revisions?.[0]?.slots?.main?.content || ''));
    }
  }
  return out;
}

export async function categoryMembers(category, limit = 300) {
  const name = category.startsWith('Catégorie:') ? category : `Catégorie:${category}`;
  const data = await getJSON(`${apiUrl('fr')}?${qs({ list: 'categorymembers', cmnamespace: '0', cmlimit: String(limit), cmtitle: name })}`);
  return (data?.query?.categorymembers || []).map(m => m.title);
}

// Pages les plus vues des derniers mois (réservoir de cartes rares).
const MAIN_PAGES = new Set(['Accueil principal', 'Main Page', 'Portada', 'Pagina principale', 'Página principal', 'Wikipedia:Hauptseite']);
export async function topArticles(months = 3, lang = 'fr') {
  const now = new Date();
  const titles = new Map();
  for (let i = 1; i <= months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const data = await getJSON(`${METRICS}/top/${lang}.wikipedia/all-access/${y}/${m}/all-days`);
    for (const a of data?.items?.[0]?.articles || []) {
      const t = a.article.replace(/_/g, ' ');
      if (/^[^ ]+:/.test(t) || t === '-' || MAIN_PAGES.has(t)) continue;
      titles.set(t, Math.max(titles.get(t) || 0, a.views));
    }
  }
  return [...titles.entries()].map(([title, monthly]) => ({ title, monthly }));
}

export function pageUrl(title, lang = 'fr') {
  return `https://${lang}.wikipedia.org/wiki/${enc(title)}`;
}

export { UA };
