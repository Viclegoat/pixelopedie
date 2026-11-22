// Données de jeu partagées entre le serveur et le navigateur.

export const TYPES = {
  politique: { name: 'Politique', emoji: '🏛️', color: '#5b6ee1' },
  histoire:  { name: 'Histoire',  emoji: '📜', color: '#b08947' },
  science:   { name: 'Science',   emoji: '🔬', color: '#2bb5a8' },
  tech:      { name: 'Tech',      emoji: '💾', color: '#7f8aa3' },
  nature:    { name: 'Nature',    emoji: '🌿', color: '#4caf50' },
  geo:       { name: 'Géographie',emoji: '🗺️', color: '#d9a441' },
  guerre:    { name: 'Guerre',    emoji: '⚔️', color: '#c0392b' },
  art:       { name: 'Art',       emoji: '🎨', color: '#d35fb7' },
  sport:     { name: 'Sport',     emoji: '⚽', color: '#f07f2e' },
  mythe:     { name: 'Mythe',     emoji: '✨', color: '#9b59b6' },
  quotidien: { name: 'Quotidien', emoji: '🍔', color: '#e0b92a' },
};

export const TYPE_IDS = Object.keys(TYPES);

// Chaque type est super efficace contre 2 types, et peu efficace contre 2 autres.
export const STRONG = {
  politique: ['guerre', 'quotidien'],   // traités de paix, impôts
  histoire:  ['politique', 'mythe'],    // le jugement de l'Histoire, les archives
  science:   ['mythe', 'nature'],       // la raison, le laboratoire
  tech:      ['science', 'quotidien'],  // le calcul, les smartphones
  nature:    ['tech', 'geo'],           // la rouille, l'érosion
  geo:       ['guerre', 'sport'],       // l'hiver russe, l'altitude
  guerre:    ['art', 'histoire'],       // les pillages, l'histoire écrite par les vainqueurs
  art:       ['politique', 'tech'],     // la satire, l'âme que les machines n'ont pas
  sport:     ['histoire', 'nature'],    // les records, la conquête des sommets
  mythe:     ['sport', 'geo'],          // les malédictions, les terres légendaires
  quotidien: ['art', 'science'],        // la culture de masse, les fake news
};

export function effectiveness(atkType, defType) {
  if (STRONG[atkType]?.includes(defType)) return 2;
  if (STRONG[defType]?.includes(atkType)) return 0.5;
  return 1;
}

export const RARITIES = [
  { id: 'commune',    name: 'Commune',     color: '#9aa0a6', total: 300, minViews: 0 },
  { id: 'peu',        name: 'Peu commune', color: '#4caf50', total: 335, minViews: 5000 },
  { id: 'rare',       name: 'Rare',        color: '#2f80ed', total: 375, minViews: 40000 },
  { id: 'epique',     name: 'Épique',      color: '#a259ff', total: 420, minViews: 250000 },
  { id: 'legendaire', name: 'Légendaire',  color: '#f2a900', total: 470, minViews: 1000000 },
];
export const RARITY_IDS = RARITIES.map(r => r.id);
export const rarityById = id => RARITIES.find(r => r.id === id) || RARITIES[0];
export const rarityIndex = id => Math.max(0, RARITY_IDS.indexOf(id));

export function rarityFromViews(views) {
  let r = RARITIES[0];
  for (const x of RARITIES) if (views >= x.minViews) r = x;
  return r.id;
}

export const EFFECTS = {
  'atk+':      'Augmente ton Attaque',
  'def+':      'Augmente ta Défense',
  'spd+':      'Augmente ta Vitesse',
  'atk-':      "Baisse l'Attaque adverse",
  'def-':      'Baisse la Défense adverse',
  'heal':      'Soigne 40 % des PV',
  'polemique': 'Polémique : perd des PV chaque tour',
  'censure':   'Censure : peut rater son tour',
  'drain':     'Récupère la moitié des dégâts',
};

export const STATUS = {
  polemique: { name: 'Polémique', emoji: '🔥', color: '#ff7043' },
  censure:   { name: 'Censuré',   emoji: '🚫', color: '#78909c' },
};

export const MODES = {
  normal: { name: 'Normal',       emoji: '⚔️', desc: 'Combats avec 3 cartes de ta collection.' },
  master: { name: 'Master',       emoji: '🎴', desc: 'Pas de deck : tu ouvres des cartes au hasard pendant le combat.' },
  boss:   { name: 'Boss',         emoji: '👹', desc: 'Un boss différent toutes les 30 minutes, seul ou entre amis.' },
  tower:  { name: 'Tour infinie', emoji: '🗼', desc: 'Des vagues d\'ennemis de plus en plus rares. Jusqu\'où iras-tu ?' },
  theme:  { name: 'Thème du jour',emoji: '📅', desc: 'Chaque jour un thème : seules ses cartes sont autorisées.' },
};

export const PACK_PRICE = 100;
export const FREE_PACK_HOURS = 4;
export const TEAM_SIZE = 3;
export const BOSS_SLOT_MS = 30 * 60 * 1000;

export const cardLevel = count => Math.min(10, Math.max(1, count || 1));
