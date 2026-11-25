// Pixelopédie — application du navigateur.
import { TYPES, TYPE_IDS, RARITIES, rarityIndex, MODES, PACK_PRICE, TEAM_SIZE, cardLevel, STRONG, LANGS, LANG_IDS } from '/shared/types.js';
import { h, $, toast, modal, cardEl, cardDetail, typeBadge, rarityStars, countdown, fmt } from './ui.js';
import { spriteCanvas } from './sprite.js';
import { mountBattle } from './battleview.js';
import { music, sfx, settings, setVolume, setMuted } from './audio.js';

const app = document.getElementById('app');
// Le stockage du navigateur peut être bloqué (navigation privée) : on ne plante jamais.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
  json(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
};
const state = {
  token: store.get('pxp_token'),
  profile: null,
  collection: [],
  socket: null,
  battle: null,
  lobby: null,
  screen: 'home',
};

// ---------- Réseau ----------
async function api(path, body) {
  const res = await fetch('/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(); throw new Error('Session expirée'); }
  if (!res.ok || data.error) throw new Error(data.error || 'Erreur réseau');
  return data;
}

function emit(ev, data) {
  return new Promise(resolve => {
    if (!state.socket?.connected) return resolve({ error: 'Connexion au serveur perdue, patiente…' });
    state.socket.timeout(30000).emit(ev, data, (err, res) => resolve(err ? { error: 'Le serveur ne répond pas' } : res));
  });
}

function connectSocket() {
  state.socket?.disconnect();
  const s = io({ auth: { token: state.token } });
  state.socket = s;
  s.on('connect', async () => {
    const r = await emit('battle:resume', {});
    if (r?.view && !state.battle) openBattle({ view: r.view, deadline: r.deadline, meta: r.meta, events: [] });
  });
  s.on('connect_error', err => { if (/non connecté/.test(err.message)) logout(); });
  s.on('profile', p => { state.profile = p; renderTop(); });
  s.on('battle:start', data => { closeWaiting(); openBattle(data); });
  s.on('battle:update', data => state.battle?.update(data));
  s.on('battle:end', data => { state.battle ? state.battle.end(data) : null; refreshCollection(); });
  s.on('boss:lobby', lobby => { state.lobby = lobby; if (state.screen === 'boss') render(); });
}

async function refreshCollection() {
  try { state.collection = await api('/collection'); } catch { /* ignore */ }
}

function logout() {
  store.del('pxp_token');
  if (state.token) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token } }).catch(() => {});
  state.token = null; state.profile = null;
  state.socket?.disconnect();
  go('login');
}

// ---------- Navigation ----------
let screenParams = {};
function go(screen, params = {}) {
  if (state.battle && screen !== 'battle') { state.battle.destroy(); state.battle = null; }
  state.screen = screen;
  screenParams = params;
  // L'écran de combat choisit lui-même sa musique (duel, boss, tour).
  if (screen !== 'battle') music.play('menu');
  window.scrollTo(0, 0);
  render();
}

// ---------- Son ----------
// Petit bruit sur chaque bouton ; les cartes et les attaques ont leurs propres sons.
document.addEventListener('click', e => {
  const el = e.target.closest('button, .tile, .mini');
  if (!el || el.closest('.flip')) return;
  if (el.classList.contains('disabled')) return sfx('error');
  sfx(el.classList.contains('movebtn') || el.classList.contains('mini') ? 'select' : 'click');
}, true);

function audioWidget() {
  const btn = h('button', { class: 'audio-btn', title: 'Son et musique', 'aria-label': 'Son et musique' });
  const nowPlaying = h('div', { class: 'audio-now' });
  const mute = h('button', { class: 'btn small' });
  const refresh = () => {
    btn.textContent = settings.muted ? '🔇' : '🔊';
    mute.textContent = settings.muted ? 'Remettre le son' : 'Couper le son';
    nowPlaying.textContent = music.current ? `♪ ${music.title(music.current)}` : '♪ —';
  };
  const slider = (label, kind) => {
    const input = h('input', { type: 'range', min: 0, max: 100, value: Math.round(settings[kind] * 100), 'aria-label': label });
    input.oninput = () => setVolume(kind, input.value / 100);
    if (kind === 'sfx') input.onchange = () => sfx('coin');
    return h('label', { class: 'audio-row' }, h('span', {}, label), input);
  };
  const panel = h('div', { class: 'panel audio-panel hidden' },
    h('div', { class: 'pixel', style: { fontSize: '10px', marginBottom: '8px' } }, 'Son'),
    slider('Musique', 'music'), slider('Effets', 'sfx'), mute, nowPlaying);
  btn.onclick = () => { panel.classList.toggle('hidden'); refresh(); };
  mute.onclick = () => { setMuted(!settings.muted); refresh(); };
  document.addEventListener('pointerdown', e => { if (!panel.contains(e.target) && e.target !== btn) panel.classList.add('hidden'); });
  music.onChange(refresh);
  refresh();
  document.body.append(btn, panel);
}
audioWidget();

function render() {
  if (!state.profile && state.screen !== 'login') state.screen = 'login';
  const fn = SCREENS[state.screen] || SCREENS.home;
  const body = h('div', {});
  app.replaceChildren(...(state.screen === 'login' ? [body] : [topbar(), body]));
  fn(body, screenParams);
}

function topbar() {
  const p = state.profile;
  const bar = h('div', { class: 'topbar', id: 'topbar' });
  bar.append(
    h('span', { class: 'logo', onclick: () => go('home') }, 'PIXELOPÉDIE'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'chip coin', title: 'Pièces' }, '🪙 ', fmt(p.coins)),
    h('span', { class: 'chip', title: 'Cartes différentes' }, '🃏 ', p.cardCount),
    h('button', { class: 'btn small', onclick: () => go('collection') }, 'Collection'),
    h('button', { class: 'btn small gold', onclick: () => go('packs') }, 'Packs' + (p.starterPacks > 0 || Date.now() > p.freePackAt ? ' !' : '')),
    h('span', { class: 'who' }, p.name),
    h('button', { class: 'btn small ghost', onclick: logout, title: 'Se déconnecter' }, '⏻'),
  );
  return bar;
}
function renderTop() {
  const old = document.getElementById('topbar');
  if (old && state.profile) old.replaceWith(topbar());
}

// ---------- Écrans ----------
const SCREENS = {};

SCREENS.login = body => {
  let mode = 'login';
  const name = h('input', { class: 'field', placeholder: 'Pseudo', autocomplete: 'username', maxlength: 16 });
  const pass = h('input', { class: 'field', placeholder: 'Mot de passe', type: 'password', autocomplete: 'current-password' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Se connecter');
  const switcher = h('button', { class: 'btn ghost small', type: 'button' }, 'Pas de compte ? En créer un');
  switcher.onclick = () => {
    mode = mode === 'login' ? 'register' : 'login';
    submit.textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
    switcher.textContent = mode === 'login' ? 'Pas de compte ? En créer un' : "J'ai déjà un compte";
    pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  };
  const form = h('form', {}, name, pass, submit, switcher);
  form.onsubmit = async e => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const r = await api(mode === 'login' ? '/login' : '/register', { name: name.value, password: pass.value });
      state.token = r.token; store.set('pxp_token', r.token);
      state.profile = r.profile;
      await refreshCollection();
      connectSocket();
      go(r.profile.starterPacks > 0 ? 'packs' : 'home');
    } catch (err) { toast(err.message, true); }
    submit.disabled = false;
  };
  body.append(h('div', { class: 'wrap' }, h('div', { class: 'panel login' },
    h('div', { class: 'title' }, 'PIXELOPÉDIE'),
    h('div', { class: 'muted' }, 'Chaque page Wikipédia est un combattant.'),
    form,
    h('p', { class: 'muted', style: { fontSize: '18px' } }, 'Ouvre des packs de pages au hasard, collectionne-les et affronte les autres joueurs en ligne.'),
  )));
};

SCREENS.home = async body => {
  const p = state.profile;
  const wrap = h('div', { class: 'wrap' });
  body.append(wrap);
  if (p.starterPacks > 0) {
    wrap.append(h('div', { class: 'panel row', style: { background: 'linear-gradient(90deg,#4a1d3a,var(--panel))' } },
      h('span', { style: { fontSize: '34px' } }, '🎁'),
      h('div', {}, h('h3', { style: { margin: 0 } }, 'Bienvenue !'), h('div', { class: 'muted' }, `Tu as ${p.starterPacks} pack(s) de départ à ouvrir.`)),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn gold', onclick: () => go('packs') }, 'Ouvrir mes packs')));
  }
  const bossInfo = h('p', {}, 'Chargement du boss…');
  const themeInfo = h('p', {}, 'Chargement du thème…');
  const tile = (cls, emoji, title, desc, onclick, extra) => h('div', { class: `panel tile ${cls}`, onclick },
    h('div', { class: 'emoji' }, emoji), h('h3', {}, title), desc instanceof Node ? desc : h('p', {}, desc), extra || null);
  wrap.append(h('div', { class: 'hub' },
    tile('', MODES.normal.emoji, 'Mode Normal', MODES.normal.desc, () => go('duel', { mode: 'normal' })),
    tile('master', MODES.master.emoji, 'Mode Master', MODES.master.desc, () => go('duel', { mode: 'master' })),
    tile('boss', MODES.boss.emoji, 'Mode Boss', bossInfo, () => go('boss')),
    tile('tower', MODES.tower.emoji, 'Tour infinie', `${MODES.tower.desc} Ton record : étage ${p.stats.towerBest}.`, () => go('tower')),
    tile('theme', MODES.theme.emoji, 'Thème du jour', themeInfo, () => go('duel', { mode: 'theme' })),
    tile('', '🏆', 'Classements', `Classement : ${p.stats.rating} pts · ${p.stats.wins} victoires`, () => go('leaderboard')),
  ));
  const homeSearch = h('input', { class: 'search-input', placeholder: 'Rechercher une carte…', 'aria-label': 'Rechercher une carte' });
  homeSearch.onkeydown = e => { if (e.key === 'Enter') go('catalog', { q: homeSearch.value.trim() }); };
  wrap.append(h('div', { class: 'section-title' }, h('h2', { style: { margin: 0 } }, 'Toutes les cartes')),
    h('p', { class: 'muted' }, 'Clique sur une rareté pour voir toutes les cartes du jeu, ou cherche une page précise.'),
    h('div', { class: 'rarity-strip' },
      RARITIES.map(r => h('button', { class: 'btn small rarity-btn', style: { '--rc': r.color }, onclick: () => go('catalog', { rarity: r.id }) },
        '★'.repeat(rarityIndex(r.id) + 1), ' ', r.name)),
      h('button', { class: 'btn small', onclick: () => go('catalog', {}) }, 'Toutes')),
    h('div', { class: 'row', style: { marginTop: '10px' } }, homeSearch,
      h('button', { class: 'btn small primary', onclick: () => go('catalog', { q: homeSearch.value.trim() }) }, 'Chercher')));
  wrap.append(h('div', { class: 'section-title' }, h('h2', { style: { margin: 0 } }, 'Les types')),
    h('p', { class: 'muted' }, 'Chaque carte a un type selon le sujet de sa page. Un type est super efficace (×2) contre deux autres :'),
    h('div', { class: 'legend-types' }, TYPE_IDS.map(t => h('span', { class: 'chip', style: { fontSize: '17px' } }, typeBadge(t), ' bat ', STRONG[t].map(x => TYPES[x].emoji).join(' ')))));
  api('/boss').then(b => {
    bossInfo.replaceChildren(`Boss actuel : ${b.card.title} (${RARITIES[rarityIndex(b.rarity)].name}). Change dans ${countdown(b.endsAt - Date.now())}.`);
  }).catch(() => bossInfo.replaceChildren('Le boss arrive…'));
  api('/theme').then(t => {
    themeInfo.replaceChildren(`Aujourd'hui : ${t.theme.label} (${TYPES[t.theme.type].emoji} ${TYPES[t.theme.type].name}).${t.claimed ? '' : ' Pack du jour gratuit !'}`);
  }).catch(() => {});
};

// --- Packs ---
SCREENS.packs = body => {
  const p = state.profile;
  const wrap = h('div', { class: 'wrap' });
  const freeReady = Date.now() >= p.freePackAt;
  const opts = [];
  if (p.starterPacks > 0) opts.push(['starter', '🎁', `Pack de départ (${p.starterPacks})`, 'Gratuit', true]);
  opts.push(['free', '⏰', 'Pack gratuit', freeReady ? 'Prêt !' : `Dans ${countdown(p.freePackAt - Date.now())}`, freeReady]);
  opts.push(['buy', '🪙', 'Pack classique', `${PACK_PRICE} pièces`, p.coins >= PACK_PRICE]);
  wrap.append(h('h2', {}, 'Packs'),
    h('p', { class: 'muted' }, "Chaque pack contient 5 pages Wikipédia : 4 tirées au hasard (souvent communes, comme un vrai clic sur « Page au hasard ») et 1 garantie Rare ou mieux, tirée parmi les pages les plus lues. Plus une page est vue, plus elle est rare."),
    h('div', { class: 'hub' }, opts.map(([kind, emoji, title, sub, ok]) => h('div', { class: 'panel tile' + (ok ? '' : ' disabled'), style: ok ? {} : { opacity: .5 }, onclick: () => ok && openPack(kind) },
      h('div', { class: 'emoji' }, emoji), h('h3', {}, title), h('p', {}, sub)))),
    h('h3', { style: { marginTop: '24px' } }, 'Raretés'),
    h('p', { class: 'muted' }, 'Clique sur une rareté pour voir toutes ses cartes.'),
    h('div', { class: 'list' }, RARITIES.map(r => h('button', { class: 'li li-link', onclick: () => go('catalog', { rarity: r.id }) },
      h('span', { style: { color: r.color } }, '★'.repeat(rarityIndex(r.id) + 1), ' ', r.name),
      h('span', { class: 'muted' }, r.minViews ? `≥ ${fmt(r.minViews)} vues / an` : 'moins de 5 000 vues / an', ' ›')))),
  );
  body.append(wrap);
};

async function openPack(kind) {
  const stage = h('div', { class: 'pack-stage' });
  const pack = h('div', { class: 'pack' }, h('div', { style: { fontSize: '50px' } }, '📚'), h('div', { class: 'pixel' }, 'PIXELO-', h('br'), 'PÉDIE'));
  const hint = h('div', { class: 'pixel dots', style: { fontSize: '10px' } }, 'Wikipédia tire tes pages');
  stage.append(pack, hint);
  document.body.append(stage);
  sfx('packAppear');
  let data;
  try { data = await api('/pack/open', { kind }); }
  catch (e) { stage.remove(); return toast(e.message, true); }
  state.profile = data.profile;
  await revealCards(stage, pack, hint, data.cards);
  refreshCollection();
}

async function revealCards(stage, pack, hint, cards) {
  // Pré-calcule les sprites pendant l'animation.
  cards.forEach(({ card }) => spriteCanvas(card, 2));
  hint.textContent = 'Clique sur le pack !';
  hint.classList.remove('dots');
  await new Promise(r => { pack.onclick = r; setTimeout(r, 4000); });
  sfx('packOpen');
  pack.classList.add('open');
  await new Promise(r => setTimeout(r, 450));
  pack.remove();
  hint.textContent = 'Clique sur les cartes pour les retourner';
  const sorted = [...cards].sort((a, b) => rarityIndex(a.card.rarity) - rarityIndex(b.card.rarity));
  const row = h('div', { class: 'reveal' });
  let flipped = 0;
  const done = h('button', { class: 'btn primary', onclick: () => { stage.remove(); go(state.screen === 'packs' ? 'packs' : state.screen, screenParams); } }, 'Super !');
  // Une carte après l'autre, pour que chaque son de rareté s'entende.
  const all = h('button', { class: 'btn', onclick: () => [...row.querySelectorAll('.flip:not(.on)')].forEach((f, i) => setTimeout(() => f.click(), i * 180)) }, 'Tout retourner');
  sorted.forEach(({ card, count }) => {
    const f = h('div', { class: `flip glow-${card.rarity}` },
      h('div', { class: 'inner' },
        h('div', { class: 'back' }, '❔'),
        h('div', { class: 'front' }, cardEl(card, { isNew: count === 1, levelUp: count > 1 ? cardLevel(count) : null, onClick: () => cardDetail(card, count) }))));
    f.addEventListener('click', () => {
      if (f.classList.contains('on')) return;
      f.classList.add('on');
      flipped++;
      sfx('flip');
      sfx('reveal', { rarity: rarityIndex(card.rarity) });
      if (card.rarity === 'legendaire' || card.rarity === 'mythique') {
        const fl = h('div', { class: 'flash' + (card.rarity === 'mythique' ? ' mythic' : '') }); document.body.append(fl); setTimeout(() => fl.remove(), 900);
        toast(`${card.rarity === 'mythique' ? 'MYTHIQUE' : 'LÉGENDAIRE'} : ${card.title} !`);
      }
      if (flipped === sorted.length) { all.remove(); }
    });
    row.append(f);
  });
  stage.append(row, h('div', { class: 'row' }, all, done));
}

// --- Toutes les cartes (par rareté, avec recherche) ---
SCREENS.catalog = (body, params = {}) => {
  let rarity = params.rarity || '', offset = 0, seq = 0, timer = null, wikiTimer = null, wikiSeq = 0, shown = new Set();
  const wrap = h('div', { class: 'wrap' });
  const search = h('input', { class: 'search-input', placeholder: 'Rechercher une page Wikipédia…', 'aria-label': 'Rechercher une carte' });
  search.value = params.q || '';
  const tabs = h('div', { class: 'rarity-strip' });
  const langSel = h('select', { 'aria-label': 'Langue' }, h('option', { value: '' }, '🌍 Toutes les langues'),
    LANG_IDS.map(l => h('option', { value: l }, `${LANGS[l].code} · ${LANGS[l].name}`)));
  langSel.value = params.lang || '';
  langSel.onchange = () => { load(); if (search.value.trim().length >= 3) wikiSearch(); };
  const info = h('p', { class: 'muted' });
  const grid = h('div', { class: 'cards' });
  const more = h('button', { class: 'btn hidden', onclick: () => load(true) }, 'Voir plus');
  const wikiBox = h('div', { class: 'wiki-box hidden' });
  // Les pages pas encore transformées en cartes : on les cherche directement sur Wikipédia.
  async function wikiSearch() {
    const q = search.value.trim(), my = ++wikiSeq;
    if (q.length < 3) return wikiBox.classList.add('hidden');
    wikiBox.classList.remove('hidden');
    const where = `Wikipédia ${LANGS[langSel.value || 'fr'].code}`;
    wikiBox.replaceChildren(h('h3', {}, `🔎 Dans tout ${where}`), h('div', { class: 'empty dots' }, `Recherche de « ${q} » sur ${where}`));
    let data;
    try { data = await api('/catalog/wiki', { q, lang: langSel.value || 'fr' }); }
    catch (e) { if (my === wikiSeq) wikiBox.replaceChildren(h('h3', {}, `🔎 Dans tout ${where}`), h('div', { class: 'empty' }, e.message)); return; }
    if (my !== wikiSeq) return;
    if (data.added) await load(); // de nouvelles cartes existent : les onglets et la liste se mettent à jour
    const rest = data.items.filter(x => !shown.has(x.card.id) && !shown.has('w:' + x.card.id) && shown.add('w:' + x.card.id));
    wikiBox.replaceChildren(h('h3', {}, `🔎 Dans tout ${where}`),
      h('p', { class: 'muted' }, data.added ? `${data.added} nouvelle${data.added > 1 ? 's' : ''} carte${data.added > 1 ? 's' : ''} ajoutée${data.added > 1 ? 's' : ''} au jeu grâce à ta recherche.` : 'Les pages qui correspondent sur Wikipédia :'),
      rest.length ? h('div', { class: 'cards' }, rest.map(({ card, count }) => {
        const el = cardEl(card, { count, onClick: () => cardDetail(card, count) });
        if (!count) { el.classList.add('unowned'); el.append(h('div', { class: 'not-mine' }, 'PAS À TOI')); }
        return el;
      })) : h('div', { class: 'empty' }, data.items.length ? 'Toutes les pages trouvées sont déjà affichées au-dessus.' : 'Aucune page jouable trouvée (les pages sensibles sont exclues).'));
  }
  const tab = (id, label, color, n, mine) => h('button', { class: 'btn small rarity-btn' + (rarity === id ? ' active' : ''), style: color ? { '--rc': color } : {},
    onclick: () => { rarity = id; load(); } }, label, h('span', { class: 'tab-count' }, ` ${mine}/${n}`));
  async function load(append = false) {
    const my = ++seq;
    if (!append) { offset = 0; grid.replaceChildren(h('div', { class: 'empty dots' }, 'Chargement')); }
    let data;
    try { data = await api(`/catalog?rarity=${encodeURIComponent(rarity)}&lang=${langSel.value}&q=${encodeURIComponent(search.value.trim())}&offset=${offset}`); }
    catch (e) { if (my === seq) grid.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
    if (my !== seq) return; // une recherche plus récente est partie entre-temps
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    tabs.replaceChildren(tab('', 'Toutes', null, sum(data.counts), sum(data.owned)),
      ...RARITIES.map(r => tab(r.id, `${'★'.repeat(rarityIndex(r.id) + 1)} ${r.name}`, r.color, data.counts[r.id] || 0, data.owned[r.id] || 0)));
    if (!append) { grid.replaceChildren(); shown = new Set(); }
    data.items.forEach(x => shown.add(x.card.id));
    grid.append(...data.items.map(({ card, count }) => {
      const el = cardEl(card, { count, onClick: () => cardDetail(card, count) });
      if (!count) { el.classList.add('unowned'); el.append(h('div', { class: 'not-mine' }, 'PAS À TOI')); }
      return el;
    }));
    offset += data.items.length;
    const r = RARITIES.find(x => x.id === rarity);
    const q = search.value.trim();
    info.textContent = `${data.total} carte${data.total > 1 ? 's' : ''}${r ? ` « ${r.name} »` : ''}${q ? ` pour « ${q} »` : ''}, des plus lues aux moins lues, parmi ${fmt(data.known)} cartes déjà créées. Toute page de Wikipédia (en 6 langues) peut devenir une carte : cherche-la ! Les cartes grisées ne sont pas encore à toi.`;
    if (!data.total) grid.replaceChildren(h('div', { class: 'empty' }, q ? `Aucune carte ne correspond à « ${q} »${r && sum(data.counts) ? ' dans cette rareté : regarde les autres onglets' : ''}.` : 'Aucune carte de cette rareté pour l’instant : le serveur en génère au fil des packs.'));
    more.classList.toggle('hidden', offset >= data.total);
  }
  search.oninput = () => {
    clearTimeout(timer); timer = setTimeout(() => load(), 250);
    clearTimeout(wikiTimer); wikiTimer = setTimeout(wikiSearch, 900);
  };
  search.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(wikiTimer); wikiSearch(); } };
  wrap.append(h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, 'Toutes les cartes'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => go('collection') }, 'Ma collection')),
    h('div', { class: 'filters' }, search, langSel), tabs, info, grid, h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '16px' } }, more), wikiBox);
  body.append(wrap);
  load().then(() => { if (search.value.trim().length >= 3) wikiSearch(); });
  if (params.q != null) search.focus();
};

// --- Collection ---
SCREENS.collection = async body => {
  const wrap = h('div', { class: 'wrap' });
  body.append(wrap);
  await refreshCollection();
  const f = store.json('pxp_filters', {});
  const type = h('select', {}, h('option', { value: '' }, 'Tous les types'), TYPE_IDS.map(t => h('option', { value: t }, `${TYPES[t].emoji} ${TYPES[t].name}`)));
  const rar = h('select', {}, h('option', { value: '' }, 'Toutes les raretés'), RARITIES.map(r => h('option', { value: r.id }, r.name)));
  const sort = h('select', {}, h('option', { value: 'rarity' }, 'Tri : rareté'), h('option', { value: 'recent' }, 'Tri : récentes'), h('option', { value: 'name' }, 'Tri : nom'), h('option', { value: 'power' }, 'Tri : puissance'));
  const search = h('input', { placeholder: 'Rechercher…' });
  type.value = f.type || ''; rar.value = f.rar || ''; sort.value = f.sort || 'rarity';
  const grid = h('div', { class: 'cards' });
  const draw = () => {
    store.set('pxp_filters', JSON.stringify({ type: type.value, rar: rar.value, sort: sort.value }));
    grid.replaceChildren(...filterSort(state.collection, { type: type.value, rarity: rar.value, sort: sort.value, q: search.value })
      .map(({ card, count }) => cardEl(card, { count, onClick: () => cardDetail(card, count) })));
    if (!grid.children.length) grid.append(h('div', { class: 'empty' }, state.collection.length ? 'Aucune carte avec ces filtres.' : 'Ta collection est vide : ouvre un pack !'));
  };
  [type, rar, sort].forEach(el => el.onchange = draw);
  search.oninput = draw;
  wrap.append(h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, `Collection (${state.collection.length})`)),
    h('div', { class: 'filters' }, type, rar, sort, search), grid);
  draw();
};

function filterSort(list, { type, rarity, sort, q, only }) {
  let out = list.filter(x => (!type || x.card.type === type) && (!rarity || x.card.rarity === rarity) && (!only || only(x.card)) &&
    (!q || x.card.title.toLowerCase().includes(q.toLowerCase())));
  const power = c => c.stats.hp + c.stats.atk + c.stats.def + c.stats.spd;
  out.sort(sort === 'name' ? (a, b) => a.card.title.localeCompare(b.card.title) :
    sort === 'recent' ? (a, b) => b.at - a.at :
    sort === 'power' ? (a, b) => power(b.card) * (1 + 0.03 * (cardLevel(b.count) - 1)) - power(a.card) * (1 + 0.03 * (cardLevel(a.count) - 1)) :
    (a, b) => rarityIndex(b.card.rarity) - rarityIndex(a.card.rarity) || b.count - a.count);
  return out;
}

// --- Choix d'équipe (réutilisé par plusieurs modes) ---
function teamPicker(key, { only, title = `Ton équipe (${TEAM_SIZE} cartes)` } = {}) {
  const pool = state.collection.filter(x => !only || only(x.card));
  const best = () => filterSort(pool, { sort: 'power' }).slice(0, TEAM_SIZE).map(x => x.card.id);
  const saved = store.json('pxp_team_' + key, []);
  let picked = (Array.isArray(saved) ? saved : []).filter(id => pool.some(x => x.card.id === id));
  if (!picked.length) picked = best(); // première visite : on propose directement la meilleure équipe
  const slots = h('div', { class: 'row' });
  const grid = h('div', { class: 'cards' });
  const type = h('select', {}, h('option', { value: '' }, 'Tous les types'), TYPE_IDS.map(t => h('option', { value: t }, `${TYPES[t].emoji} ${TYPES[t].name}`)));
  const auto = h('button', { class: 'btn small', onclick: () => { picked = best(); draw(); } }, 'Meilleure équipe');
  const draw = () => {
    store.set('pxp_team_' + key, JSON.stringify(picked));
    slots.replaceChildren(...Array.from({ length: TEAM_SIZE }, (_, k) => {
      const x = pool.find(c => c.card.id === picked[k]);
      return h('div', { class: 'panel', style: { padding: '6px', width: '96px', minHeight: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: x ? 'pointer' : 'default' }, onclick: () => { if (x) { picked.splice(k, 1); draw(); } } },
        x ? [spriteCanvas(x.card, 2), h('span', { style: { fontSize: '16px', textAlign: 'center', overflow: 'hidden', maxHeight: '36px' } }, x.card.title)] : h('span', { class: 'muted', style: { margin: 'auto' } }, `#${k + 1}`));
    }));
    grid.replaceChildren(...filterSort(pool, { type: type.value, sort: 'power' }).map(({ card, count }) => cardEl(card, {
      count, selected: picked.includes(card.id),
      onClick: () => {
        if (picked.includes(card.id)) picked = picked.filter(id => id !== card.id);
        else if (picked.length < TEAM_SIZE) picked.push(card.id);
        else toast(`${TEAM_SIZE} cartes maximum : retire-en une d'abord.`);
        draw();
      },
    })));
    if (!pool.length) grid.append(h('div', { class: 'empty' }, 'Aucune carte disponible ici. Ouvre des packs !'));
  };
  type.onchange = draw;
  draw();
  const el = h('div', { class: 'panel', style: { marginTop: '16px' } },
    h('div', { class: 'row' }, h('h3', { style: { margin: 0 } }, title), h('span', { class: 'spacer' }), type, auto),
    h('p', { class: 'muted', style: { fontSize: '18px' } }, 'Clique sur une carte pour l\'ajouter, sur un emplacement pour la retirer.'),
    slots, h('div', { style: { marginTop: '14px', maxHeight: '520px', overflow: 'auto', padding: '4px' } }, grid));
  return { el, get: () => picked.slice(), ok: () => picked.length >= Math.min(TEAM_SIZE, pool.length) && picked.length > 0 };
}

// --- Duels : Normal, Master, Thème du jour ---
SCREENS.duel = async (body, { mode }) => {
  const wrap = h('div', { class: 'wrap' });
  body.append(wrap);
  const m = MODES[mode];
  wrap.append(h('h2', {}, `${m.emoji} Mode ${m.name}`), h('p', { class: 'muted' }, m.desc));
  await refreshCollection();
  let picker = null, theme = null;

  if (mode === 'master') {
    wrap.append(h('div', { class: 'panel' }, h('p', {}, 'Pas besoin de deck : au début du combat et à chaque K.O., tu ouvres une nouvelle carte au hasard. Le premier à perdre 3 cartes perd.'),
      h('p', { class: 'muted' }, 'Si tu gagnes, tu gardes toutes les cartes ouvertes pendant le combat !')));
  } else if (mode === 'theme') {
    theme = await api('/theme');
    const t = theme.theme;
    const claim = h('button', { class: 'btn gold', disabled: theme.claimed }, theme.claimed ? 'Pack du jour récupéré ✓' : 'Récupérer le pack du jour (3 cartes)');
    claim.onclick = async () => {
      claim.disabled = true;
      const stage = h('div', { class: 'pack-stage' });
      const pack = h('div', { class: 'pack' }, h('div', { style: { fontSize: '50px' } }, '📅'), h('div', { class: 'pixel' }, t.label));
      const hint = h('div', { class: 'pixel dots', style: { fontSize: '10px' } }, 'Recherche dans la catégorie');
      stage.append(pack, hint); document.body.append(stage);
      try {
        const r = await api('/theme/claim', {});
        state.profile = r.profile;
        await refreshCollection();
        await revealCards(stage, pack, hint, r.cards);
      } catch (e) { stage.remove(); toast(e.message, true); claim.disabled = false; }
    };
    wrap.append(h('div', { class: 'panel' },
      h('h3', {}, `Aujourd'hui : ${t.label}`),
      h('p', {}, 'Cartes autorisées : celles de type ', typeBadge(t.type), ` ou de la catégorie Wikipédia « ${t.category} ».`),
      h('p', { class: 'muted' }, `Récompenses ×1,5 · Tes victoires du jour : ${theme.wins} · Nouveau thème dans ${countdown(t.endsAt - Date.now())}`),
      claim));
    const eligible = new Set(theme.eligible);
    picker = teamPicker('theme', { only: c => eligible.has(c.id) || c.type === t.type || (c.categories || []).includes(t.category) });
    wrap.append(picker.el);
  } else {
    picker = teamPicker('normal');
    wrap.append(picker.el);
  }

  const team = () => {
    if (!picker) return [];
    if (!picker.ok()) { toast(`Choisis ${TEAM_SIZE} cartes pour ton équipe.`, true); return null; }
    return picker.get();
  };
  const codeInput = h('input', { class: 'field', placeholder: 'CODE', maxlength: 4, style: { width: '120px', textTransform: 'uppercase' } });
  const actions = h('div', { class: 'panel', style: { marginTop: '16px' } },
    h('h3', {}, 'Trouver un adversaire'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: async () => { const t = team(); if (!t) return; const r = await emit('duel:queue', { mode, team: t }); if (r.error) return toast(r.error, true); if (r.queued) showWaiting('Recherche d\'un adversaire', () => emit('duel:cancel', {})); } }, '🌐 Joueur en ligne'),
      h('button', { class: 'btn cyan', onclick: async () => { const t = team(); if (!t) return; showWaiting('Préparation du bot'); const r = await emit('duel:bot', { mode, team: t }); if (r.error) { closeWaiting(); toast(r.error, true); } } }, '🤖 Contre l\'ordinateur'),
      h('button', { class: 'btn', onclick: async () => { const t = team(); if (!t) return; const r = await emit('duel:create', { mode, team: t }); if (r.error) return toast(r.error, true); showWaiting(h('span', {}, 'Donne ce code à ton ami : ', h('div', { class: 'code', style: { margin: '10px auto', display: 'inline-block' } }, r.code)), () => emit('duel:cancel', {})); } }, '👥 Défier un ami'),
    ),
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', {}, 'Rejoindre un ami :'), codeInput,
      h('button', { class: 'btn small', onclick: async () => { const t = team(); if (!t) return; const r = await emit('duel:join', { code: codeInput.value, team: t }); if (r.error) toast(r.error, true); } }, 'Rejoindre')));
  wrap.insertBefore(actions, picker ? picker.el : null);
};

let closeWaitingFn = null;
function showWaiting(content, onCancel) {
  closeWaiting();
  const close = modal(h('div', { style: { textAlign: 'center' } },
    h('h3', { class: 'dots' }, typeof content === 'string' ? content : 'En attente'),
    typeof content === 'string' ? null : content,
    onCancel ? h('div', {}, h('button', { class: 'btn', onclick: () => { onCancel(); closeWaiting(); } }, 'Annuler')) : null,
  ), { closable: false });
  closeWaitingFn = close;
}
function closeWaiting() { closeWaitingFn?.(); closeWaitingFn = null; }

// --- Boss ---
SCREENS.boss = async body => {
  const wrap = h('div', { class: 'wrap' });
  body.append(wrap);
  await refreshCollection();
  let b;
  try { b = await api('/boss'); } catch (e) { wrap.append(h('p', {}, e.message)); return; }
  const timerEl = h('span', { class: 'chip' });
  const tick = () => { timerEl.textContent = `⏳ Nouveau boss dans ${countdown(b.endsAt - Date.now())}`; if (Date.now() > b.endsAt && state.screen === 'boss') { clearInterval(iv); render(); } };
  const iv = setInterval(() => { if (state.screen !== 'boss') clearInterval(iv); else tick(); }, 1000);
  tick();
  wrap.append(h('div', { class: 'panel boss-hero' },
    h('div', { class: 'art' }, spriteCanvas(b.card, 4)),
    h('div', {},
      h('div', { class: 'pixel', style: { fontSize: '10px', color: 'var(--bad)' } }, '👹 BOSS DES 30 MINUTES'),
      h('h2', { style: { margin: '8px 0' } }, b.card.title),
      h('div', { class: 'row' }, typeBadge(b.card.type), h('span', { class: `r-${b.rarity}` }, rarityStars(b.rarity)), timerEl),
      h('p', { class: 'muted' }, b.card.description),
      h('p', {}, `Récompense : ${b.reward.coins} pièces et ${Math.round(b.reward.drop * 100)} % de chances de gagner la carte du boss.`, b.alreadyWon ? ' (Déjà battu : récompense réduite.)' : ''),
      h('p', { class: 'muted', style: { fontSize: '18px' } }, 'Plus le boss est rare, plus il est solide. Ses PV augmentent avec le nombre de joueurs, et à 3 ou 4 il attaque deux fois par tour.'),
      h('button', { class: 'btn small', onclick: () => cardDetail(b.card) }, 'Voir ses attaques'))));

  const picker = teamPicker('boss');
  const team = () => { if (!picker.ok()) { toast(`Choisis ${TEAM_SIZE} cartes.`, true); return null; } return picker.get(); };
  const lobby = state.lobby && state.lobby.slot === b.slot && state.lobby.members.some(m => m.id === state.profile.id) ? state.lobby : null;

  if (lobby) {
    const host = lobby.hostId === state.profile.id;
    wrap.append(h('div', { class: 'panel', style: { marginTop: '16px' } },
      h('h3', {}, 'Ton groupe'),
      h('div', { class: 'row' }, 'Code à partager :', h('span', { class: 'code' }, lobby.code)),
      h('div', { class: 'list', style: { marginTop: '12px' } }, lobby.members.map(m => h('div', { class: 'li' }, h('b', {}, (m.id === lobby.hostId ? '👑 ' : '') + m.name), h('span', { class: 'muted' }, m.cards.join(' · '))))),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        host ? h('button', { class: 'btn primary', onclick: async () => { const r = await emit('boss:start', {}); if (r.error) toast(r.error, true); else state.lobby = null; } }, `Lancer le combat (${lobby.members.length}/4)`) : h('span', { class: 'muted dots' }, 'Le chef du groupe va lancer le combat'),
        h('button', { class: 'btn ghost', onclick: async () => { await emit('boss:leave', {}); state.lobby = null; render(); } }, 'Quitter le groupe'))));
  } else {
    const codeInput = h('input', { class: 'field', placeholder: 'CODE', maxlength: 4, style: { width: '120px', textTransform: 'uppercase' } });
    const join = async code => { const t = team(); if (!t) return; const r = await emit('boss:join', { code, team: t }); if (r.error) return toast(r.error, true); state.lobby = r; render(); };
    wrap.append(h('div', { class: 'panel', style: { marginTop: '16px' } },
      h('h3', {}, 'Affronter le boss'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: async () => { const t = team(); if (!t) return; showWaiting('Le boss arrive'); const r = await emit('boss:solo', { team: t }); if (r.error) { closeWaiting(); toast(r.error, true); } } }, '⚔️ Seul'),
        h('button', { class: 'btn cyan', onclick: async () => { const t = team(); if (!t) return; const r = await emit('boss:create', { team: t }); if (r.error) return toast(r.error, true); state.lobby = r; render(); } }, '👥 Créer un groupe'),
        h('span', {}, 'ou rejoindre :'), codeInput, h('button', { class: 'btn small', onclick: () => join(codeInput.value) }, 'Rejoindre')),
      b.lobbies.length ? [h('h3', { style: { marginTop: '14px' } }, 'Groupes ouverts'),
        h('div', { class: 'list' }, b.lobbies.map(l => h('div', { class: 'li' }, h('span', {}, `${l.members.map(m => m.name).join(', ')} (${l.members.length}/4)`), h('button', { class: 'btn small', onclick: () => join(l.code) }, 'Rejoindre'))))] : null));
  }
  wrap.append(picker.el);
};

// --- Tour infinie ---
SCREENS.tower = async body => {
  const wrap = h('div', { class: 'wrap' });
  body.append(wrap);
  await refreshCollection();
  const status = await emit('tower:status', {});
  wrap.append(h('h2', {}, '🗼 Tour infinie'),
    h('div', { class: 'panel' },
      h('p', {}, 'Monte le plus haut possible avec la même équipe. Les gardiens deviennent plus nombreux et plus rares à chaque étage. Entre deux étages, tes cartes récupèrent 30 % de leurs PV, mais les cartes K.O. le restent.'),
      h('p', { class: 'muted' }, `Ton record : étage ${state.profile.stats.towerBest} · Chaque étage rapporte 10 × son numéro en pièces.`)));
  if (status && !status.none) {
    wrap.append(h('div', { class: 'panel', style: { marginTop: '16px' } },
      h('h3', {}, `Ascension en cours : étage ${status.floor}`),
      h('div', { class: 'list' }, status.team.map(f => h('div', { class: 'li' }, h('span', {}, f.title), h('span', {}, f.fainted ? 'K.O.' : `${f.hp}/${f.maxHp} PV`)))),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn gold', onclick: nextFloor }, 'Étage suivant ▶'),
        h('button', { class: 'btn ghost', onclick: async () => { await emit('tower:quit', {}); render(); } }, 'Abandonner l\'ascension'))));
    return;
  }
  const picker = teamPicker('tower');
  wrap.append(h('div', { class: 'row', style: { marginTop: '16px' } },
    h('button', { class: 'btn primary', onclick: async () => {
      if (!picker.ok()) return toast(`Choisis ${TEAM_SIZE} cartes.`, true);
      showWaiting('Ouverture des portes de la tour');
      const r = await emit('tower:start', { team: picker.get() });
      if (r.error) { closeWaiting(); toast(r.error, true); }
    } }, 'Commencer l\'ascension')), picker.el);
};

async function nextFloor() {
  showWaiting('Montée à l\'étage suivant');
  const r = await emit('tower:next', {});
  if (r.error) { closeWaiting(); toast(r.error, true); go('tower'); }
}

// --- Classements ---
SCREENS.leaderboard = async body => {
  const wrap = h('div', { class: 'wrap' });
  body.append(wrap);
  const lb = await api('/leaderboard');
  const list = (title, rows, unit) => h('div', { class: 'panel' }, h('h3', {}, title),
    rows.length ? h('div', { class: 'list' }, rows.map((r, i) => h('div', { class: 'li' }, h('span', {}, `${i + 1}. ${r.name}`), h('b', {}, `${r.value} ${unit}`)))) : h('p', { class: 'muted' }, 'Personne pour l\'instant.'));
  wrap.append(h('h2', {}, '🏆 Classements'), h('div', { class: 'lb-grid' },
    list('Duels en ligne', lb.rating, 'pts'), list('Tour infinie', lb.tower, 'ét.'), list('Boss vaincus', lb.boss, ''),
    list('Thème du jour', lb.theme, 'vict.'), list('Collectionneurs', lb.cards, 'cartes')));
};

// --- Combat ---
SCREENS.battle = body => {
  if (!state.battleInit) return go('home');
  const host = h('div', {});
  body.append(host);
  state.battle = mountBattle(host, state.battleInit, {
    emit,
    onExit: meta => { refreshCollection(); go(meta?.kind === 'boss' ? 'boss' : meta?.kind === 'tower' ? 'tower' : 'home'); },
    onNextFloor: () => { nextFloor(); },
  });
};

function openBattle(init) {
  closeWaiting();
  if (state.battle) { state.battle.destroy(); state.battle = null; }
  state.battleInit = init;
  state.lobby = null;
  go('battle');
}

// ---------- Démarrage ----------
(async () => {
  if (state.token) {
    try {
      state.profile = await api('/me');
      await refreshCollection();
      connectSocket();
      go('home');
      return;
    } catch { /* jeton invalide */ }
  }
  go('login');
})();
