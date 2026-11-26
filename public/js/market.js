// Écran Marché : vente à prix fixe, enchères et centre d'échange.
import { RARITIES, rarityIndex } from '/shared/types.js';
import { h, toast, modal, cardEl, cardDetail, countdown, fmt } from './ui.js';

const TABS = [['market', '🏪 Marché'], ['auctions', '🔨 Enchères'], ['trades', '🤝 Échanges'], ['sell', '💼 Vendre']];

export function marketScreen(body, params, ctx) {
  const { api, state, go } = ctx;
  let tab = params.tab || 'market', data = null, q = '', rar = '';
  const wrap = h('div', { class: 'wrap' });
  const tabsEl = h('div', { class: 'rarity-strip' });
  const content = h('div', {});
  body.append(wrap);
  wrap.append(h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, 'Marché des cartes'), h('span', { class: 'spacer' }),
    h('button', { class: 'btn small', onclick: () => load() }, '↻ Actualiser')), tabsEl, content);

  const act = async (path, payload, ok) => {
    try {
      const r = await api(path, payload);
      if (r.profile) { state.profile = r.profile; ctx.renderTop(); }
      if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
      await ctx.refreshCollection();
      await load();
      return r;
    } catch (e) { toast(e.message, true); }
  };

  async function load() {
    try { data = await api('/market'); } catch (e) { content.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
    draw();
  }
  function drawTabs() {
    const pending = data?.trades.filter(t => t.incoming).length || 0;
    tabsEl.replaceChildren(...TABS.map(([id, label]) => h('button', { class: 'btn small' + (tab === id ? ' primary' : ''), onclick: () => { tab = id; draw(); } },
      label, id === 'trades' && pending ? ` (${pending})` : '')));
  }
  const filters = onChange => {
    const s = h('input', { class: 'search-input', placeholder: 'Rechercher…', value: q });
    s.oninput = () => { q = s.value; onChange(); };
    const r = h('select', {}, h('option', { value: '' }, 'Toutes les raretés'), RARITIES.map(x => h('option', { value: x.id }, x.name)));
    r.value = rar; r.onchange = () => { rar = r.value; onChange(); };
    return h('div', { class: 'filters' }, s, r);
  };
  const match = c => (!rar || c.rarity === rar) && (!q || c.title.toLowerCase().includes(q.toLowerCase()));
  const owned = id => state.collection.find(x => x.card.id === id)?.count || 0;

  function draw() {
    drawTabs();
    content.replaceChildren();
    if (!data) return;
    if (data.notes.length && tab !== 'sell') content.append(h('details', { class: 'panel market-notes' },
      h('summary', {}, `📬 Tes notifications (${data.notes.length})`),
      h('div', { class: 'list' }, data.notes.map(n => h('div', { class: 'li' }, h('span', {}, n.text), h('span', { class: 'muted' }, new Date(n.at).toLocaleString('fr-FR')))))));
    ({ market: drawMarket, auctions: drawAuctions, trades: drawTrades, sell: drawSell })[tab]();
  }

  // --- Prix fixe ---
  function drawMarket() {
    const grid = h('div', { class: 'cards' });
    const fill = () => {
      const list = data.listings.filter(l => match(l.card)).sort((a, b) => b.at - a.at);
      grid.replaceChildren(...list.map(l => {
        const el = cardEl(l.card, { onClick: () => cardDetail(l.card, owned(l.card.id)) });
        el.append(h('div', { class: 'sale' },
          h('div', {}, '🪙 ', h('b', {}, fmt(l.price))), h('div', { class: 'muted' }, l.mine ? 'Ta vente' : `par ${l.seller}`),
          l.mine ? h('button', { class: 'btn small ghost', onclick: e => { e.stopPropagation(); act('/market/cancel', { id: l.id }, 'Vente annulée, la carte revient chez toi'); } }, 'Retirer')
            : h('button', { class: 'btn small gold', disabled: state.profile.coins < l.price, onclick: e => { e.stopPropagation(); act('/market/buy', { id: l.id }, `« ${l.card.title} » achetée !`); } }, 'Acheter')));
        return el;
      }));
      if (!list.length) grid.append(h('div', { class: 'empty' }, data.listings.length ? 'Aucune carte avec ces filtres.' : 'Personne ne vend de carte pour l\'instant. Mets-en une en vente dans l\'onglet « Vendre » !'));
    };
    content.append(h('p', { class: 'muted' }, `Achète des cartes à prix fixe aux autres joueurs. Le vendeur reçoit le prix moins ${data.fee * 100} % de commission.`), filters(fill), grid);
    fill();
    if (data.recent.length) content.append(h('h3', { style: { marginTop: '20px' } }, 'Dernières ventes'),
      h('div', { class: 'list' }, data.recent.map(r => h('div', { class: 'li' }, h('span', {}, `${r.kind === 'vente' ? '🏪' : '🔨'} ${r.title}`), h('span', { class: 'muted' }, `🪙 ${fmt(r.amount)}`)))));
  }

  // --- Enchères ---
  function drawAuctions() {
    const grid = h('div', { class: 'cards' });
    const timers = [];
    const fill = () => {
      const list = data.auctions.filter(a => match(a.card)).sort((a, b) => a.endsAt - b.endsAt);
      timers.length = 0;
      grid.replaceChildren(...list.map(a => {
        const el = cardEl(a.card, { onClick: () => cardDetail(a.card, owned(a.card.id)) });
        const left = h('div', { class: 'muted' });
        timers.push([left, a.endsAt]);
        const input = h('input', { type: 'number', class: 'bid-input', min: a.minBid, value: a.minBid, onclick: e => e.stopPropagation() });
        const bid = n => act('/auction/bid', { id: a.id, amount: n }, r => r.won ? `Tu remportes « ${a.card.title} » !` : 'Enchère placée !');
        el.append(h('div', { class: 'sale' },
          h('div', {}, a.bids ? '🔨 ' : 'Départ ', h('b', {}, fmt(a.bids ? a.bid : a.start)), a.bids ? h('span', { class: 'muted' }, ` · ${a.bids} offre${a.bids > 1 ? 's' : ''}`) : null),
          h('div', { class: 'muted' }, a.leading ? '✅ Tu mènes' : a.leader ? `Meilleur : ${a.leader}` : 'Aucune offre'),
          left,
          a.buyout ? h('div', { class: 'muted' }, `Achat immédiat : ${fmt(a.buyout)}`) : null,
          a.mine ? (a.bids ? h('div', { class: 'muted' }, 'Ta carte') : h('button', { class: 'btn small ghost', onclick: e => { e.stopPropagation(); act('/auction/cancel', { id: a.id }, 'Enchère annulée'); } }, 'Annuler'))
            : a.leading ? null
            : h('div', { class: 'row', style: { gap: '4px' }, onclick: e => e.stopPropagation() }, input,
                h('button', { class: 'btn small gold', onclick: () => bid(input.value) }, 'Enchérir'),
                a.buyout ? h('button', { class: 'btn small', onclick: () => bid(a.buyout) }, 'Acheter') : null)));
        return el;
      }));
      if (!list.length) grid.append(h('div', { class: 'empty' }, data.auctions.length ? 'Aucune enchère avec ces filtres.' : 'Aucune enchère en cours. Lance la tienne dans l\'onglet « Vendre » !'));
      tick();
    };
    const tick = () => timers.forEach(([el, end]) => { el.textContent = end > Date.now() ? `⏳ ${countdown(end - Date.now())}` : '⌛ Terminée'; });
    const iv = setInterval(() => { if (!grid.isConnected) clearInterval(iv); else tick(); }, 1000);
    content.append(h('p', { class: 'muted' }, 'Le meilleur enchérisseur à la fin remporte la carte. Tes pièces sont bloquées tant que tu mènes, et rendues si quelqu\'un te dépasse. Une offre dans les 2 dernières minutes prolonge l\'enchère.'), filters(fill), grid);
    fill();
  }

  // --- Échanges ---
  function drawTrades() {
    content.append(h('div', { class: 'row' }, h('p', { class: 'muted', style: { margin: 0 } }, 'Propose un échange de cartes et de pièces à un autre joueur. Rien ne bouge tant qu\'il n\'a pas accepté.'),
      h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => tradeEditor() }, '+ Nouvel échange')));
    const side = (label, s) => h('div', { class: 'trade-side' }, h('div', { class: 'muted' }, label),
      h('div', { class: 'cards mini' }, s.cards.map(c => cardEl(c, { scale: 1, onClick: () => cardDetail(c, owned(c.id)) }))),
      s.coins ? h('div', {}, `🪙 ${fmt(s.coins)} pièces`) : null, !s.cards.length && !s.coins ? h('div', { class: 'muted' }, 'Rien') : null);
    const list = data.trades.sort((a, b) => b.incoming - a.incoming || b.at - a.at);
    if (!list.length) return content.append(h('div', { class: 'empty' }, 'Aucun échange en attente.'));
    list.forEach(t => content.append(h('div', { class: 'panel trade' + (t.incoming ? ' incoming' : '') },
      h('h3', { style: { margin: '0 0 8px' } }, t.incoming ? `📥 ${t.other} te propose :` : `📤 Ta proposition à ${t.other} :`),
      t.message ? h('p', { class: 'muted' }, `« ${t.message} »`) : null,
      h('div', { class: 'trade-grid' },
        side(t.incoming ? `${t.other} te donne` : 'Tu donnes', t.give),
        h('div', { class: 'trade-arrow' }, '⇄'),
        side(t.incoming ? 'Contre ces cartes à toi' : `${t.other} te donne`, t.want)),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        t.incoming ? [h('button', { class: 'btn primary', onclick: () => act('/trade/answer', { id: t.id, accept: true }, 'Échange réussi !') }, 'Accepter'),
          h('button', { class: 'btn ghost', onclick: () => act('/trade/answer', { id: t.id, accept: false }, 'Échange refusé') }, 'Refuser'),
          h('button', { class: 'btn small', onclick: () => tradeEditor(t.other) }, 'Contre-proposer')]
          : h('button', { class: 'btn ghost', onclick: () => act('/trade/answer', { id: t.id, accept: false }, 'Proposition annulée') }, 'Annuler')))));
  }

  function tradeEditor(preset = '') {
    const give = new Set(), want = new Set();
    let theirs = null;
    const who = h('input', { class: 'field', placeholder: 'Pseudo du joueur', value: preset });
    const giveCoins = h('input', { type: 'number', class: 'bid-input', min: 0, value: 0 });
    const wantCoins = h('input', { type: 'number', class: 'bid-input', min: 0, value: 0 });
    const msg = h('input', { class: 'field', placeholder: 'Message (facultatif)', maxlength: 140 });
    const mine = h('div', { class: 'cards mini pick' }), other = h('div', { class: 'cards mini pick' });
    const searchMine = h('input', { class: 'search-input', placeholder: 'Filtrer mes cartes…' });
    const searchOther = h('input', { class: 'search-input', placeholder: 'Filtrer ses cartes…' });
    const pickGrid = (el, list, set, filter) => {
      const f = filter.value.toLowerCase();
      el.replaceChildren(...list.filter(x => set.has(x.card.id) || !f || x.card.title.toLowerCase().includes(f)).slice(0, 120)
        .sort((a, b) => set.has(b.card.id) - set.has(a.card.id) || rarityIndex(b.card.rarity) - rarityIndex(a.card.rarity))
        .map(x => cardEl(x.card, { count: x.count, scale: 1, selected: set.has(x.card.id), onClick: () => { set.has(x.card.id) ? set.delete(x.card.id) : set.size < 10 && set.add(x.card.id); pickGrid(el, list, set, filter); } })));
      if (!el.children.length) el.append(h('div', { class: 'empty' }, list.length ? 'Aucune carte' : '…'));
    };
    const drawMine = () => pickGrid(mine, state.collection, give, searchMine);
    const drawOther = () => theirs ? pickGrid(other, theirs, want, searchOther) : other.replaceChildren(h('div', { class: 'empty' }, 'Entre un pseudo puis clique sur « Voir ses cartes ».'));
    searchMine.oninput = drawMine; searchOther.oninput = drawOther;
    const loadOther = async () => {
      try { const r = await api(`/player/${encodeURIComponent(who.value.trim())}/cards`); theirs = r.cards; who.value = r.name; want.clear(); drawOther(); }
      catch (e) { toast(e.message, true); }
    };
    who.onkeydown = e => { if (e.key === 'Enter') loadOther(); };
    const send = h('button', { class: 'btn primary' }, 'Envoyer la proposition');
    let close;
    send.onclick = async () => {
      send.disabled = true;
      const r = await act('/trade/propose', { to: who.value, give: { cards: [...give], coins: +giveCoins.value || 0 }, want: { cards: [...want], coins: +wantCoins.value || 0 }, message: msg.value }, 'Proposition envoyée !');
      send.disabled = false;
      if (r) { close(); tab = 'trades'; draw(); }
    };
    close = modal(h('div', { class: 'trade-editor' },
      h('h2', { style: { marginRight: '40px' } }, 'Nouvel échange'),
      h('div', { class: 'row' }, who, h('button', { class: 'btn small', onclick: loadOther }, 'Voir ses cartes')),
      h('div', { class: 'trade-cols' },
        h('div', {}, h('h3', {}, 'Tu donnes (max 10)'), searchMine, mine, h('div', { class: 'row' }, '+ 🪙', giveCoins)),
        h('div', {}, h('h3', {}, 'Tu veux (max 10)'), searchOther, other, h('div', { class: 'row' }, '+ 🪙', wantCoins))),
      msg, h('div', { class: 'row', style: { marginTop: '10px' } }, send)));
    drawMine(); drawOther();
    if (preset) loadOther();
  }

  // --- Vendre ---
  function drawSell() {
    const grid = h('div', { class: 'cards' });
    const fill = () => {
      const list = state.collection.filter(x => match(x.card)).sort((a, b) => rarityIndex(b.card.rarity) - rarityIndex(a.card.rarity) || a.card.title.localeCompare(b.card.title));
      grid.replaceChildren(...list.slice(0, 300).map(x => cardEl(x.card, { count: x.count, onClick: () => sellDialog(x) })));
      if (!list.length) grid.append(h('div', { class: 'empty' }, state.collection.length ? 'Aucune carte avec ces filtres.' : 'Ta collection est vide.'));
    };
    const mine = [...data.listings.filter(l => l.mine), ...data.auctions.filter(a => a.mine)];
    content.append(
      ...(mine.length ? [h('p', { class: 'muted' }, `Tu as ${mine.length} carte${mine.length > 1 ? 's' : ''} en vente en ce moment (onglets Marché et Enchères).`)] : []),
      h('p', { class: 'muted' }, 'Clique sur une de tes cartes pour la vendre à prix fixe ou la mettre aux enchères. Elle quitte ta collection pendant la vente et revient si tu annules ou si personne n\'enchérit.'),
      filters(fill), grid);
    fill();
  }

  function sellDialog({ card, count }) {
    const suggest = [20, 40, 80, 160, 400, 1200][rarityIndex(card.rarity)] || 50;
    let mode = 'fixed';
    const priceIn = h('input', { type: 'number', class: 'field', min: 1, value: suggest });
    const buyout = h('input', { type: 'number', class: 'field', min: 0, placeholder: 'Achat immédiat (facultatif)' });
    const hours = h('select', {}, data.hours.map(n => h('option', { value: n }, n < 24 ? `${n} h` : `${n / 24} jour${n > 24 ? 's' : ''}`)));
    hours.value = 24;
    const auctionOpts = h('div', { class: 'hidden' }, h('label', { class: 'muted' }, 'Durée '), hours, buyout);
    const label = h('label', { class: 'muted' }, 'Prix de vente');
    const net = h('div', { class: 'muted' });
    const upd = () => { const p = Math.floor(+priceIn.value || 0); net.textContent = mode === 'fixed' ? `Tu recevras ${fmt(p - Math.floor(p * data.fee))} pièces (commission ${data.fee * 100} %).` : `Commission de ${data.fee * 100} % sur le prix final.`; };
    priceIn.oninput = upd;
    const modeBtn = (id, text) => h('button', { class: 'btn small' + (mode === id ? ' primary' : ''), onclick: () => { mode = id; auctionOpts.classList.toggle('hidden', id !== 'auction'); label.textContent = id === 'fixed' ? 'Prix de vente' : 'Prix de départ'; modes.replaceChildren(modeBtn('fixed', '🏪 Prix fixe'), modeBtn('auction', '🔨 Enchères')); upd(); } }, text);
    const modes = h('div', { class: 'row' }, modeBtn('fixed', '🏪 Prix fixe'), modeBtn('auction', '🔨 Enchères'));
    const go = h('button', { class: 'btn gold' }, 'Mettre en vente');
    let close;
    go.onclick = async () => {
      go.disabled = true;
      const r = mode === 'fixed'
        ? await act('/market/list', { cardId: card.id, price: priceIn.value }, `« ${card.title} » est en vente !`)
        : await act('/auction/start', { cardId: card.id, start: priceIn.value, hours: +hours.value, buyout: +buyout.value || null }, `Enchère lancée pour « ${card.title} » !`);
      go.disabled = false;
      if (r) close();
    };
    close = modal(h('div', { class: 'sell-dialog' },
      h('h2', { style: { marginRight: '40px' } }, `Vendre « ${card.title} »`),
      h('div', { class: 'row', style: { alignItems: 'flex-start' } }, cardEl(card, { count }),
        h('div', { style: { display: 'grid', gap: '8px', flex: 1, minWidth: '200px' } },
          count > 1 ? h('div', { class: 'muted' }, `Tu en as ${count} : tu en vends 1 (ta carte perd un niveau).`) : h('div', { class: 'muted' }, 'C\'est ton seul exemplaire.'),
          modes, label, priceIn, auctionOpts, net, go))));
    upd();
  }

  load();
}
