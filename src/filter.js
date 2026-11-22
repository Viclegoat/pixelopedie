// Filtre de contenu sensible : ces pages ne sortent jamais des packs.

export const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Sujets écartés des packs (comparés sans accents).
const PAGE_BLOCK = [
  'sexe', 'sexuel', 'sexualit', 'pornograph', 'erotique', 'prostitu', 'proxenet', 'viol ', 'viols', 'violee', 'pedophil',
  'pedocrimin', 'inceste', 'agression sexuelle', 'harcelement',
  'attentat', 'terroris', 'jihadis', 'djihadis', 'genocide', 'massacre', 'shoah', 'holocauste', 'extermination',
  'camp de concentration', "camp d'extermination", 'nazi', 'waffen', 'gestapo', 'ku klux', 'neonazi', 'suprematis',
  'suicide', 'meurtre', 'meurtrier', 'assassinat de', 'tuerie', 'fusillade', 'tueur', 'criminel', 'crime contre',
  'affaire criminelle', 'fait divers', 'condamne pour', 'execution de', 'torture', 'pogrom', 'nettoyage ethnique',
  'esclavage', 'traite negriere', 'lynchage', 'catastrophe', 'accident ferroviaire', 'accident aerien', 'naufrage',
  'epidemie', 'victime', 'mort de ', 'deces de ', 'drogue', 'stupefiant', 'overdose', 'racis', 'antisemit', 'islamophob',
  'homophob', 'injure', 'haine', 'dictateur', 'criminel de guerre', 'crimes de guerre', 'enfant soldat', 'mafia',
];

// Mots qu'on ne veut pas voir comme nom d'attaque (identités, religions…).
const MOVE_BLOCK = [
  ...PAGE_BLOCK,
  'juif', 'juive', 'judai', 'musulman', 'islam', 'arabe', 'chretien', 'catholi', 'protestant', 'bouddhis', 'hindou',
  'religion', 'ethni', 'noir', 'immigr', 'migrant', 'handicap', 'gay', 'lesbien', 'transgenre', 'mort', 'deces', 'cancer',
  'maladie', 'prison', 'condamn', 'proces', 'diffamation', 'extreme droite', 'extreme gauche',
];

// Chaque mot doit commencer un mot du texte (« haine » ne bloque pas « chaîne »).
const escapeRe = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toRegex = list => new RegExp('(^|[^a-z0-9])(' + list.map(escapeRe).join('|') + ')');
const PAGE_RE = toRegex(PAGE_BLOCK);
const MOVE_RE = toRegex(MOVE_BLOCK);

export function isSensitivePage(page) {
  const blob = norm([page.title, page.description, page.extract?.slice(0, 600), ...(page.categories || [])].join(' | ')) + ' ';
  return PAGE_RE.test(blob);
}

export function isBadMoveName(name) {
  return MOVE_RE.test(norm(name) + ' ');
}
