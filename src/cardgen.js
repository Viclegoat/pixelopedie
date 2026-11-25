// Transforme une page Wikipédia en carte de combat.
import { TYPE_IDS, TYPES, rarityFromViews, rarityById, rarityIndex, rarityFor } from '../public/shared/types.js';
import { norm, isBadMoveName } from './filter.js';
import { pageUrl } from './wiki.js';
import { aiEnabled, aiDesign } from './ai.js';

// ---------- Aléatoire déterministe (même page = même carte) ----------
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = typeof seed === 'number' ? seed : hashStr(seed);
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// ---------- Classification par mots-clés ----------
const KEYWORDS = {
  politique: ['homme politique', 'femme politique', 'personnalite politique', 'politicien', 'president', 'ministre', 'depute', 'senateur', 'maire', 'parti ', 'election', 'gouvern', 'diplomat', 'syndical', 'militant', 'politique', "chef d'etat", 'loi ', 'constitution', 'ambassad', 'referendum', 'conseiller', 'administrat'],
  histoire: ['roi ', 'reine', 'empereur', 'imperatrice', 'prince', 'princesse', 'duc ', 'duchesse', 'comte ', 'comtesse', 'pharaon', 'dynastie', 'siecle', 'antiqu', 'medieval', 'moyen age', 'historien', 'archeolog', 'noblesse', 'noble ', 'seigneur', 'revolution', 'empire', 'royaume', 'monument historique', 'chateau', 'historique', 'colonial'],
  science: ['physicien', 'chimiste', 'mathematicien', 'biologiste', 'astronome', 'scientifique', 'medecin', 'chercheur', 'theoreme', 'equation', 'molecule', 'element chimique', 'planete', 'etoile', 'asteroide', 'galaxie', 'maladie', 'proteine', 'gene ', 'physique', 'chimie', 'mathemati', 'astronomi', 'medecine', 'geologue', 'mineral', 'cratere', 'professeur', 'philosophe', 'economiste', 'sociologue'],
  tech: ['logiciel', 'informatique', 'ordinateur', 'jeu video', 'entreprise', 'societe ', 'constructeur', 'automobile', 'avion', 'locomotive', 'navire', 'ingenieur', 'technolog', 'internet', 'site web', 'programm', 'electroni', 'telephone', 'console', 'robot', 'satellite', 'fusee', 'moteur', 'vehicule', 'train ', 'aeronef', 'bateau', 'industri', 'inventeur', 'architecte'],
  nature: ['espece', 'genre de', 'famille de', 'animal', 'plante', 'oiseau', 'insecte', 'poisson', 'mammifere', 'reptile', 'amphibien', 'champignon', 'arbre', 'fleur', 'papillon', 'coleoptere', 'araignee', 'mollusque', 'bacterie', 'vegetal', 'faune', 'flore', 'naturaliste', 'botaniste', 'zoolog', 'race de', 'cultivar'],
  geo: ['commune', 'ville', 'village', 'pays', 'region', 'departement', 'canton', 'riviere', 'fleuve', 'lac ', 'montagne', 'mont ', 'ile ', 'capitale', 'quartier', 'province', 'municipalite', 'localite', 'district', 'territoire', 'desert', 'volcan', 'gare', 'aeroport', 'pont ', 'rue ', 'arrondissement', 'comte de', 'hameau', 'vallee', 'col ', 'sommet', 'baie', 'cap ', 'plage', 'station'],
  guerre: ['militaire', 'general', 'marechal', 'bataille', 'guerre', 'soldat', 'armee', 'regiment', 'officier', 'amiral', 'arme ', 'char ', 'fusil', 'sous-marin', 'croiseur', 'cuirasse', 'combat', 'siege de', 'escadrille', 'chevalier', 'aviateur', 'resistant'],
  art: ['chanteur', 'chanteuse', 'musicien', 'compositeur', 'peintre', 'sculpteur', 'ecrivain', 'poete', 'poetesse', 'romancier', 'romanciere', 'acteur', 'actrice', 'realisateur', 'realisatrice', 'film', 'album', 'chanson', 'roman', 'groupe de', 'rappeur', 'artiste', 'oeuvre', 'tableau', 'opera', 'serie televisee', 'bande dessinee', 'dessinateur', 'photographe', 'danseur', 'danseuse', 'comedien', 'comedienne', 'livre', 'piece de theatre', 'musique', 'manga', 'anime', 'single', 'scenariste', 'illustrat', 'journaliste', 'essayiste', 'animateur', 'animatrice'],
  sport: ['footballeur', 'footballeuse', 'joueur', 'joueuse', 'cycliste', 'athlete', 'tennis', 'rugby', 'basket', 'handball', 'boxeur', 'nageur', 'nageuse', 'skieur', 'skieuse', 'pilote', 'club de', 'football', 'sport', 'olympique', 'championnat', 'coupe du monde', 'equipe', 'entraineur', 'judoka', 'escrimeur', 'golfeur', 'hockey', 'volley', 'stade', 'tour de france', 'grand prix', 'lutteur', 'catcheur', 'gymnaste', 'patineu', 'biathl', 'rameur', 'karate', 'marathon', 'jeux olympiques', 'competition'],
  mythe: ['dieu', 'deesse', 'mytholog', 'legende', 'legendaire', 'saint ', 'sainte', 'religieu', 'eglise', 'cathedrale', 'abbaye', 'eveque', 'pape', 'pretre', 'moine', 'biblique', 'divinite', 'creature', 'personnage de fiction', 'personnage', 'fantome', 'demon', 'ange', 'magie', 'sorcier', 'heros', 'super-heros', 'chapelle', 'basilique', 'monastere', 'prieure', 'cardinal', 'theolog'],
  quotidien: ['cuisine', 'plat ', 'fromage', 'vin ', 'boisson', 'aliment', 'recette', 'gateau', 'dessert', 'marque', 'jouet', 'vetement', 'mode ', 'emission', 'television', 'radio', 'journal', 'magazine', 'jeu de societe', 'fete', 'tradition', 'outil', 'meuble', 'objet', 'restaurant', 'chef cuisinier', 'cuisinier', 'biere', 'cocktail', 'fruit', 'legume', 'patisserie', 'youtubeu', 'influenceu', 'chaine', 'soupe', 'sauce', 'mets', 'potage', 'ragout', 'pain ', 'viande', 'salade', 'friandise', 'confiserie', 'charcuterie', 'specialite culinaire', 'gastronomie'],
};

// Rôles qui l'emportent sur le reste (« journaliste et homme politique » → Politique).
const STRONG_KEYWORDS = {
  politique: ['homme politique', 'femme politique', 'personnalite politique', "chef d'etat", 'president de la republique', 'premier ministre'],
  sport: ['footballeur', 'footballeuse', 'cycliste', 'joueur de tennis', 'joueuse de tennis', 'pilote automobile'],
  histoire: ['roi ', 'reine ', 'empereur', 'imperatrice', 'pharaon'],
  mythe: ['dieu ', 'deesse', 'mythologie'],
  nature: ['espece', 'genre de', 'famille de'],
  geo: ['commune ', 'village', 'ville '],
  quotidien: ['specialite culinaire', 'plat traditionnel', 'soupe', 'recette de cuisine'],
};

function scoreTypes(text, weight, scores) {
  const t = ' ' + norm(text) + ' ';
  for (const type of TYPE_IDS) {
    for (const k of KEYWORDS[type]) if (t.includes(k)) scores[type] += weight;
    for (const k of STRONG_KEYWORDS[type] || []) if (t.includes(k)) scores[type] += weight * 2;
  }
}

export function classify(page) {
  const scores = Object.fromEntries(TYPE_IDS.map(t => [t, 0]));
  scoreTypes(page.description, 4, scores);
  scoreTypes(page.title, 1, scores);
  scoreTypes((page.extract || '').split(/(?<=\.)\s/)[0] || '', 2, scores);
  for (const c of (page.categories || []).slice(0, 25)) scoreTypes(c, 1, scores);
  let best = null, bestScore = 0;
  for (const t of TYPE_IDS) if (scores[t] > bestScore) { best = t; bestScore = scores[t]; }
  return best || pick(rng(page.title + ':type'), TYPE_IDS);
}

export function classifyName(name) {
  const scores = Object.fromEntries(TYPE_IDS.map(t => [t, 0]));
  scoreTypes(name, 1, scores);
  let best = null, bestScore = 0;
  for (const t of TYPE_IDS) if (scores[t] > bestScore) { best = t; bestScore = scores[t]; }
  return best;
}

const PERSON_RE = /\b(homme|femme|acteur|actrice|chanteu|joueu|footballeu|ecrivain|peintre|poete|compositeu|musicien|politi|roi|reine|empereur|imperatrice|prince|princesse|athlete|cycliste|pilote|scientifique|physicien|chimiste|mathematicien|militaire|general|saint|sainte|pape|eveque|realisat|journaliste|philosophe|historien|sculpteur|architecte|ingenieur|medecin|avocat|entrepreneu|chef|rappeur|animat|youtubeu|nageu|boxeu|skieu|judoka|gymnaste|depute|senat|ministre|maire|president|diplomate|religieu|moine|pretre|aviateur|explorat|navigat|dessinat|illustrat|comedien|danseu|mannequin|entraineu|economiste|sociologue|biologiste|astronome|professeur|inventeu|duc|duchesse|comte|comtesse|marquis)/;

export function isPerson(page) {
  const d = norm(page.description);
  const ex = norm((page.extract || '').slice(0, 220));
  if (/\b(page d'homonymie|commune|ville|village|espece|genre|famille|film|album|chanson|roman|jeu|club|equipe|entreprise|parti|bataille|eglise|chateau)\b/.test(d)) return false;
  if (/\bnee? (le|en|vers|a|au|dans)\b/.test(ex) || /\(nee? /.test(ex)) return true;
  return PERSON_RE.test(d);
}

// ---------- Apparence du personnage ----------
function appearance(page, type, person) {
  const d = norm(page.description + ' ' + (page.extract || '').slice(0, 200));
  const has = re => re.test(d);
  if (person) {
    switch (type) {
      case 'politique': return { archetype: 'costume', accessory: has(/journalist|animat/) ? 'micro' : 'mallette' };
      case 'sport': return { archetype: 'sportif', accessory:
        has(/tennis|badminton|squash|tennis de table/) ? 'raquette' : has(/rugby/) ? 'ovale' : has(/basket|handball|volley/) ? 'basket' :
        has(/cycli|pilote|automobile|moto/) ? 'casque' : has(/box|judo|karate|lutte|catch/) ? 'gants' : has(/football/) ? 'ballon' : 'medaille' };
      case 'science': return { archetype: 'blouse', accessory: has(/mathemati|philosoph|economi/) ? 'livre' : 'fiole' };
      case 'tech': return { archetype: 'hoodie', accessory: 'laptop' };
      case 'histoire': return has(/\b(roi|reine|empereur|imperatrice|prince|princesse|pharaon|duc|duchesse|comte|comtesse|tsar|sultan|calife|monarque|marquis)/)
        ? { archetype: 'royal', accessory: 'sceptre' } : { archetype: 'tenue', accessory: 'livre' };
      case 'guerre': return { archetype: 'soldat', accessory: has(/chevalier|medieval|croise|samourai|antique|siecle/) ? 'epee' : 'fusil' };
      case 'art': return { archetype: 'artiste', accessory:
        has(/chanteu|rappeu|chanson/) ? 'micro' : has(/musicien|guitar|compositeu|groupe|pianiste|violon/) ? 'guitare' :
        has(/peintre|dessinat|illustrat|sculpteu|graveu|photograph/) ? 'pinceau' : has(/acteur|actrice|realisat|cinema|comedien/) ? 'clap' : 'plume' };
      case 'mythe': return { archetype: 'robe', accessory: 'aureole' };
      case 'quotidien': return has(/cuisin|chef|patissi/) ? { archetype: 'chef', accessory: 'toque' } : { archetype: 'costume', accessory: 'micro' };
      default: return { archetype: 'explorateur', accessory: 'carte' };
    }
  }
  switch (type) {
    case 'nature':
      if (has(/plante|arbre|fleur|vegetal|champignon|cultivar|algue|mousse|fougere/)) return { archetype: 'plante', accessory: 'pot' };
      if (has(/oiseau|passereau|rapace|echassier|palmipede|anatide|psittacide|colibri|perroquet|hibou|chouette|aigle|faucon|manchot|pingouin|canard|oie |cygne|mouette|goeland|pigeon|corbeau|moineau|mesange|hirondelle|engoulevent|bernache|cardinal/)) return { archetype: 'oiseau', accessory: 'queue' };
      if (has(/poisson|requin|raie |cetace|dauphin|baleine|orque|poulpe|pieuvre|calmar|meduse|crustace|homard|crabe|crevette|hippocampe|saumon|truite|thon/)) return { archetype: 'poisson', accessory: 'eau' };
      return { archetype: 'animal', accessory: 'queue' };
    case 'geo': return { archetype: 'golem', accessory: has(/riviere|fleuve|lac|mer|ocean|baie|cours d'eau|ruisseau|canal/) ? 'eau' : has(/montagne|mont|sommet|volcan|massif|col/) ? 'neige' : 'pierre' };
    case 'tech': return { archetype: 'robot', accessory: 'antenne' };
    case 'mythe': return { archetype: 'esprit', accessory: 'aureole' };
    case 'guerre': return { archetype: 'robot', accessory: 'canon' };
    case 'sport': return { archetype: 'sportif', accessory: 'medaille' };
    case 'politique': return { archetype: 'costume', accessory: 'mallette' };
    case 'histoire': return { archetype: 'golem', accessory: 'pierre' };
    case 'science': return { archetype: 'esprit', accessory: 'atome' };
    case 'art': return { archetype: 'mascotte', accessory: has(/album|chanson|single|musique|opera/) ? 'note' : has(/film|serie|cinema/) ? 'clap' : 'plume' };
    default: return { archetype: 'mascotte', accessory: 'gants' };
  }
}

// ---------- Statistiques ----------
const BIAS = {
  politique: [1.1, 1.0, 1.0, 0.9], histoire: [1.1, 1.0, 1.1, 0.8], science: [0.9, 1.2, 1.0, 0.9],
  tech: [0.9, 1.1, 1.1, 1.0], nature: [1.2, 0.9, 1.0, 1.0], geo: [1.3, 0.85, 1.3, 0.6],
  guerre: [1.0, 1.3, 1.1, 0.8], art: [0.9, 1.1, 0.8, 1.2], sport: [0.9, 1.1, 0.9, 1.3],
  mythe: [1.0, 1.1, 1.0, 1.0], quotidien: [1.2, 0.9, 0.9, 1.0],
};
function makeStats(title, type, rarity) {
  const r = rng(title + ':stats');
  const w = BIAS[type].map(b => b * (0.75 + r() * 0.5));
  const sum = w.reduce((a, b) => a + b, 0);
  const total = rarityById(rarity).total;
  const [hp, atk, def, spd] = w.map(x => Math.round(total * x / sum));
  return { hp, atk, def, spd };
}

// ---------- Attaques ----------
const STATUS_MOVES = {
  politique: [['Langue de bois', 'def+'], ['Promesse électorale', 'atk+'], ['49.3', 'censure'], ['Sondage', 'spd+']],
  histoire: [['Archives', 'def+'], ['Couronnement', 'atk+'], ['Traité de paix', 'atk-'], ['Exil', 'censure']],
  science: [['Eurêka', 'atk+'], ['Expérience ratée', 'polemique'], ['Vaccin', 'heal'], ['Relecture par les pairs', 'def-']],
  tech: [['Mise à jour', 'atk+'], ['Ctrl+Z', 'heal'], ['Pare-feu', 'def+'], ['Bug', 'censure']],
  nature: [['Photosynthèse', 'heal'], ['Camouflage', 'def+'], ['Hibernation', 'heal'], ['Pollen', 'polemique']],
  geo: [['Brouillard', 'atk-'], ['Érosion', 'def-'], ['Microclimat', 'heal'], ['Relief', 'def+']],
  guerre: [['Tranchée', 'def+'], ['Cri de guerre', 'atk+'], ['Repli tactique', 'spd+'], ['Propagande', 'polemique']],
  art: [['Inspiration', 'atk+'], ['Standing ovation', 'heal'], ['Critique acerbe', 'atk-'], ['Rappel', 'spd+']],
  sport: [['Échauffement', 'atk+'], ['Mi-temps', 'heal'], ['Carton jaune', 'censure'], ['Sprint', 'spd+']],
  mythe: [['Prière', 'heal'], ['Malédiction', 'polemique'], ['Bénédiction', 'def+'], ['Prophétie', 'atk+']],
  quotidien: [['Pause café', 'heal'], ['Sieste', 'heal'], ['Apéro', 'atk+'], ['Embouteillage', 'censure']],
};
const FALLBACK_NAMES = {
  politique: ['Discours enflammé', 'Motion de censure', 'Débat télévisé', 'Coup de com'],
  histoire: ['Charge royale', 'Révolution', 'Édit royal', 'Conquête'],
  science: ['Rayon laser', 'Réaction en chaîne', 'Théorème', 'Big Bang'],
  tech: ['Surchauffe', 'Code source', 'Spam', 'Écran bleu'],
  nature: ['Morsure', 'Liane fouet', 'Charge sauvage', 'Pollinisation'],
  geo: ['Séisme', 'Avalanche', 'Crue', 'Tempête'],
  guerre: ['Assaut', 'Canonnade', 'Embuscade', 'Blitz'],
  art: ['Coup de pinceau', 'Fausse note', 'Tirade', "Chef-d'œuvre"],
  sport: ['Tir enroulé', 'Tacle glissé', 'Smash', 'Sprint final'],
  mythe: ['Foudre divine', 'Sortilège', 'Jugement', 'Rayon sacré'],
  quotidien: ['Coup de baguette', 'Raclette', 'Ticket de caisse', 'Coup de fourchette'],
};

function effectFor(name) {
  const n = ' ' + norm(name) + ' ';
  if (/loi |tribunal|censure|interdi|police|juge|justice|cour |conseil|senat|assemblee|parlement|reglement|constitution|administration/.test(n)) return 'censure';
  if (/polemi|scandale|controvers|tele|tv|journal|presse|media|news|radio|figaro|magazine|blog|twitter|debat|emission/.test(n)) return 'polemique';
  if (/parti|rassemblement|union|alliance|ligue|mouvement|federation|club|equipe|armee|troupe|championnat|coupe/.test(n)) return 'atk+';
  if (/chateau|fort |mur |muraille|bouclier|armure|cathedrale|eglise|palais|tour |citadelle|institut|ecole|universite|academie|lycee/.test(n)) return 'def+';
  if (/medecin|hopital|sante|eau |source|soin|cuisine|repas|vin |cafe|the |pain|fromage|recette/.test(n)) return 'heal';
  if (/banque|impot|taxe|argent|euro|dollar|bourse|entreprise|societe|commerce|marche/.test(n)) return 'drain';
  if (/critique|satire|ironie|humour|caricature|parodie/.test(n)) return 'atk-';
  return null;
}

const TOO_GENERIC = new Set(['france', 'francais', 'europe', 'monde', 'union europeenne', 'etats-unis', 'paris', 'terre', 'humain', 'homme', 'femme']);

const GEO_PAREN = /\((?:[^)]*(?:departement|commune|ville|region|province|seine|rhone|loire|marne|oise|nord|cours d'eau|riviere|fleuve|etat|comte|canton))/;

function cleanLinkName(link) {
  const proper = /^[A-ZÀ-ÖØ-Þ0-9]/.test(link.text);
  let name = proper ? link.text : link.target.replace(/\s*\([^)]*\)\s*$/, '');
  if (name.length > 26) name = link.target.replace(/\s*\([^)]*\)\s*$/, '');
  return { name: name.charAt(0).toUpperCase() + name.slice(1), proper };
}

function moveCandidates(page, links, person) {
  const titleWords = new Set(norm(page.title).split(/[^a-z0-9]+/).filter(w => w.length > 3));
  const out = [];
  // Lieux de naissance / de décès : peu parlants comme attaques.
  const places = [];
  const placeRe = /\b(?:nee?|morte?|decedee?)\b[^.;]{0,70}?\ba ([a-z][^,.;()]+)/g;
  let pm;
  const ex = norm(page.extract || '');
  while ((pm = placeRe.exec(ex))) places.push(pm[1].trim().split(' ').slice(0, 3).join(' '));
  links.forEach((link, i) => {
    const { name, proper } = cleanLinkName(link);
    const n = norm(name);
    if (name.length < 2 || name.length > 26) return;
    if (/^\d|\b(1[0-9]{3}|20[0-9]{2})\b|janvier|fevrier|mars|avril|mai |juin|juillet|aout|septembre|octobre|novembre|decembre|siecle/.test(n)) return;
    if (n.split(/[^a-z0-9]+/).some(w => titleWords.has(w))) return;
    if (isBadMoveName(name) || isBadMoveName(link.target) || TOO_GENERIC.has(n)) return;
    // Adjectifs qui pointent vers un nom (« français » → France) : peu parlant.
    if (!proper && !norm(link.target).startsWith(n.slice(0, 4))) return;
    let score = proper ? 10 : 3;
    if (GEO_PAREN.test(norm(link.target))) score -= 6;
    if (person && places.some(pl => pl && (n.startsWith(pl) || pl.startsWith(n)))) score -= 8;
    score -= i * 0.05;
    out.push({ name, score, target: link.target });
  });
  out.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return out.filter(c => { const k = norm(c.name); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Remet une carte déjà créée dans la bonne rareté (après un changement de seuils).
// Les stats gardent leurs proportions et l'attaque signature suit la rareté, comme pour une carte neuve.
export function reclassify(card) {
  const next = rarityFor(card.views, card.lang);
  if (next === card.rarity) return false;
  const k = rarityById(next).total / rarityById(card.rarity).total;
  for (const s of ['hp', 'atk', 'def', 'spd']) card.stats[s] = Math.max(1, Math.round(card.stats[s] * k));
  const sig = card.moves?.[0];
  if (sig?.power > 0) sig.power = Math.max(40, sig.power + (rarityIndex(next) - rarityIndex(card.rarity)) * 3);
  card.rarity = next;
  return true;
}

export function proceduralMoves(page, type, rarity, links, person) {
  const r = rng(page.title + ':moves');
  const ri = rarityIndex(rarity);
  const cands = moveCandidates(page, links, person);
  const fallback = [...FALLBACK_NAMES[type]].sort(() => r() - 0.5);
  const nextName = () => cands.length ? cands.shift() : { name: fallback.shift() || 'Coup de page', target: null };
  const otherType = () => { let t; do { t = pick(r, TYPE_IDS); } while (t === type); return t; };

  const m1 = nextName(), m2 = nextName(), m3 = nextName();
  const moves = [];
  moves.push({ name: m1.name, type, power: 85 + Math.round(r() * 10) + ri * 3, acc: 90, effect: effectFor(m1.name), chance: 30 });
  moves.push({ name: m2.name, type, power: 60 + Math.round(r() * 15), acc: 100, effect: effectFor(m2.name) || pick(r, ['polemique', 'def-', 'atk+', null]), chance: 30 });
  const covType = classifyName(m3.target || m3.name);
  moves.push({ name: m3.name, type: covType && covType !== type ? covType : otherType(), power: 70 + Math.round(r() * 12), acc: 95, effect: effectFor(m3.name), chance: 30 });
  const [sname, seffect] = pick(r, STATUS_MOVES[type]);
  moves.push({ name: sname, type, power: 0, acc: 100, effect: seffect, chance: 100 });
  for (const m of moves) if (m.effect === 'drain') m.chance = 100;
  return moves;
}

// ---------- Assemblage ----------
export async function buildCard(rawPage, links = []) {
  // Page étrangère : on l'analyse avec sa description française (les mots-clés du jeu sont en français).
  const lang = rawPage.lang || 'fr';
  const page = lang === 'fr' ? rawPage : { ...rawPage, description: rawPage.frDescription || rawPage.description };
  const type0 = classify(page);
  const person = isPerson(page);
  const rarity = rarityFor(page.views, lang);

  let type = type0, look = appearance(page, type0, person), moves = null, source = 'wiki';
  if (aiEnabled()) {
    const design = await aiDesign(page, { type: type0, person, rarity, links }).catch(() => null);
    if (design?.sensitive) return null;
    if (design) {
      type = design.type || type0;
      look = design.look || appearance(page, type, person);
      moves = design.moves;
      source = 'ia';
    }
  }
  if (!moves) moves = proceduralMoves(page, type, rarity, links, person);

  return {
    id: lang === 'fr' ? String(page.pageid) : `${lang}:${page.pageid}`,
    lang,
    qid: page.qid || null,
    title: page.title,
    description: page.description || '',
    extract: (page.extract || '').slice(0, 700),
    image: page.image || null,
    url: pageUrl(page.title, lang),
    views: page.views || 0,
    rarity,
    type,
    person,
    ...look,
    stats: makeStats(page.title, type, rarity),
    moves,
    categories: (page.categories || []).slice(0, 40),
    source,
    createdAt: Date.now(),
  };
}

export { appearance, TYPES };
