// Filtre de contenu sensible : ces pages ne sortent jamais des packs.

export const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Sujets écartés des packs (comparés sans accents).
const PAGE_BLOCK = [
  'enfant soldat',
  // English
  'convicted',
  // Español / Português / Italiano
  
  // Deutsch
  
];

// Mots qu'on ne veut pas voir comme nom d'attaque (identités, religions…).
const MOVE_BLOCK = [
  ...PAGE_BLOCK,
  
];

// Chaque mot doit commencer un mot du texte (« haine » ne bloque pas « chaîne »).
const escapeRe = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toRegex = list => new RegExp('(^|[^a-z0-9])(' + list.map(escapeRe).join('|') + ')');
const PAGE_RE = toRegex(PAGE_BLOCK);
const MOVE_RE = toRegex(MOVE_BLOCK);

export function isSensitivePage(page) {
  const blob = norm([page.title, page.description, page.frDescription, page.extract?.slice(0, 600), ...(page.categories || [])].join(' | ')) + ' ';
  return PAGE_RE.test(blob);
}

export function isBadMoveName(name) {
  return MOVE_RE.test(norm(name) + ' ');
}
