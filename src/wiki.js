// Accès à Wikipédia (fr). Les requêtes sont groupées et espacées pour rester
// raisonnable avec les serveurs de Wikimedia.

const CONTACT = process.env.WIKI_CONTACT || 'jeu open source';
const UA = `Pixelopedie/1.0 (${CONTACT}) Node.js`;
const API = 'https://fr.wikipedia.org/w/api.php';
const METRICS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// File d'attente : une requête à la fois, au moins GAP ms entre deux départs.
// Wikimedia limite fortement les robots sans contact : on reste très sobre.
const GAP = Number(process.env.WIKI_GAP_MS || 1100);
let chain = Promise.resolve(), lastStart = 0, cooldownUntil = 0;
function limited(fn) {
  const run = chain.then(async () => {
    const wait = Math.max(lastStart + GAP, cooldownUntil) - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}
export const isCoolingDown = () => Date.now() < cooldownUntil;

async function getJSON(url) {
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
          cooldownUntil = Date.now() + (ra + 2) * 1000;
          console.warn(`[wiki] Wikipédia demande une pause de ${ra} s`);
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
    });
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
  ppprop: 'disambiguation',
};

function normalizePage(p) {
  return {
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
async function queryAll(params, maxRounds = 4) {
  const pages = new Map();
  let cont = {};
  for (let i = 0; i < maxRounds; i++) {
    const data = await getJSON(`${API}?${qs({ ...params, ...cont })}`);
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
  for (let i = 0; i < pages.length; i += 20) {
    const chunk = pages.slice(i, i + 20);
    const res = await queryAll({ prop: 'pageviews', pvipdays: '60', titles: chunk.map(p => p.title).join('|') }, 6);
    for (const r of res) {
      const p = chunk.find(c => c.pageid === r.pageid || c.title === r.title);
      if (!p) continue;
      const sum = Object.values(r.pageviews || {}).reduce((s, v) => s + (v || 0), 0);
      p.views = Math.round(sum * 365 / 60);
    }
  }
  return pages;
}

export async function randomPages(n = 10) {
  const raw = await queryAll({ generator: 'random', grnnamespace: '0', grnlimit: String(Math.min(n, 20)), ...PAGE_PROPS }, 3);
  const pages = raw.map(normalizePage);
  return addViews(pages);
}

export async function pagesByTitle(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 20) {
    const raw = await queryAll({ titles: titles.slice(i, i + 20).join('|'), redirects: '1', ...PAGE_PROPS }, 3);
    out.push(...raw.map(normalizePage));
  }
  return addViews(out);
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
  const re = /\[\[(Fichier|File|Image|Média|Media):/gi;
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

export async function introLinksBatch(pageids) {
  const out = new Map();
  for (let i = 0; i < pageids.length; i += 15) {
    const data = await getJSON(`${API}?${qs({ prop: 'revisions', rvprop: 'content', rvslots: 'main', pageids: pageids.slice(i, i + 15).join('|') })}`);
    for (const p of data?.query?.pages || []) {
      out.set(p.pageid, linksFromWikitext(p.revisions?.[0]?.slots?.main?.content || ''));
    }
  }
  return out;
}

export async function categoryMembers(category, limit = 300) {
  const name = category.startsWith('Catégorie:') ? category : `Catégorie:${category}`;
  const data = await getJSON(`${API}?${qs({ list: 'categorymembers', cmnamespace: '0', cmlimit: String(limit), cmtitle: name })}`);
  return (data?.query?.categorymembers || []).map(m => m.title);
}

// Pages les plus vues des derniers mois (réservoir de cartes rares).
export async function topArticles(months = 3) {
  const now = new Date();
  const titles = new Map();
  for (let i = 1; i <= months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const data = await getJSON(`${METRICS}/top/fr.wikipedia/all-access/${y}/${m}/all-days`);
    for (const a of data?.items?.[0]?.articles || []) {
      const t = a.article.replace(/_/g, ' ');
      if (/^[^ ]+:/.test(t) || t === '-' || t === 'Accueil principal') continue;
      titles.set(t, Math.max(titles.get(t) || 0, a.views));
    }
  }
  return [...titles.entries()].map(([title, monthly]) => ({ title, monthly }));
}

export function pageUrl(title) {
  return `https://fr.wikipedia.org/wiki/${enc(title)}`;
}

export { UA };
