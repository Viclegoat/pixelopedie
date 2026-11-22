// Sauvegarde des comptes et des cartes.
// Par défaut dans un fichier JSON (data/db.json). Si DATABASE_URL est défini (PostgreSQL, par exemple Neon),
// tout va dans la base : une ligne par joueur et par carte, et seules les lignes modifiées sont réécrites.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'db.json');

export const db = {
  users: {},      // id -> profil
  names: {},      // pseudo en minuscules -> id
  tokens: {},     // jeton de session -> id
  cards: {},      // pageid -> carte générée (cache partagé)
  meta: {},       // boss, thèmes, etc.
};

let sql = null;                // (requête, paramètres) => Promise<{ rows }> quand PostgreSQL est utilisé
const written = new Map();     // clé de ligne -> JSON déjà enregistré (true pour les cartes, qui ne changent jamais)
const WHOLE = ['names', 'tokens', 'meta'];

// Accepte aussi la commande « psql '…' » copiée telle quelle depuis Neon.
// sslmode=require est déjà traité comme verify-full par pg : on l'écrit ainsi pour éviter un long avertissement au démarrage.
export function databaseUrl(raw) {
  const found = String(raw).match(/postgres(?:ql)?:\/\/[^\s'"]+/);
  if (!found) throw new Error('DATABASE_URL doit commencer par postgresql://');
  const url = new URL(found[0]);
  if (/^(require|prefer|verify-ca)$/.test(url.searchParams.get('sslmode') || '')) url.searchParams.set('sslmode', 'verify-full');
  return url.href;
}

export async function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl(process.env.DATABASE_URL), max: 3 });
    pool.on('error', e => console.error('[db] PostgreSQL :', e.message));
    return usePostgres((text, params) => pool.query(text, params));
  }
  if (fs.existsSync(FILE)) {
    try { Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
    catch (e) { console.error('[db] fichier illisible, on repart de zéro', e.message); }
  }
}

// Branche la sauvegarde sur une base PostgreSQL (exporté aussi pour les tests).
export async function usePostgres(query) {
  sql = query;
  await sql(`create table if not exists pixelopedie (
    key text primary key, value jsonb not null, updated_at timestamptz not null default now())`);
  const { rows } = await sql('select key, value from pixelopedie');
  for (const { key, value } of rows) {
    if (WHOLE.includes(key)) { db[key] = value; written.set(key, JSON.stringify(value)); continue; }
    const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
    if (kind === 'user') { db.users[id] = value; written.set(key, JSON.stringify(value)); }
    else if (kind === 'card') { db.cards[id] = value; written.set(key, true); }
  }
  console.log(`[db] PostgreSQL : ${Object.keys(db.users).length} joueurs et ${Object.keys(db.cards).length} cartes chargés.`);
}

let timer = null;
export function save() {
  if (timer) return;
  timer = setTimeout(flush, sql ? 3000 : 1500);
}
export function flush() {
  clearTimeout(timer); timer = null;
  if (sql) return flushPostgres();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

let writing = null, again = false;
async function flushPostgres() {
  if (writing) { again = true; return writing; }
  const changes = [], seen = new Set();
  const put = (key, value) => { seen.add(key); const s = JSON.stringify(value); if (written.get(key) !== s) changes.push([key, s]); };
  for (const [id, u] of Object.entries(db.users)) put('user:' + id, u);
  for (const [id, c] of Object.entries(db.cards)) { const key = 'card:' + id; seen.add(key); if (!written.has(key)) changes.push([key, JSON.stringify(c)]); }
  for (const k of WHOLE) put(k, db[k]);
  const removed = [...written.keys()].filter(k => !seen.has(k));
  if (!changes.length && !removed.length) return;
  writing = (async () => {
    try {
      for (let i = 0; i < changes.length; i += 200) {
        const part = changes.slice(i, i + 200);
        await sql(`insert into pixelopedie (key, value)
          select k, v::jsonb from unnest($1::text[], $2::text[]) as t(k, v)
          on conflict (key) do update set value = excluded.value, updated_at = now()`, [part.map(c => c[0]), part.map(c => c[1])]);
        for (const [k, s] of part) written.set(k, k.startsWith('card:') ? true : s);
      }
      if (removed.length) {
        await sql('delete from pixelopedie where key = any($1::text[])', [removed]);
        removed.forEach(k => written.delete(k));
      }
    } catch (e) {
      console.error('[db] sauvegarde PostgreSQL impossible, nouvel essai bientôt :', e.message);
      setTimeout(save, 5000);
    }
  })();
  await writing;
  writing = null;
  if (again) { again = false; return flushPostgres(); }
}

// ---------- Comptes ----------
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

export function createUser(name, password) {
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(12).toString('hex');
  const user = {
    id, name, salt, pass: hash(password, salt),
    coins: 300, freePackAt: 0, starterPacks: 2,
    collection: {},           // cardId -> { count, at }
    stats: { wins: 0, losses: 0, rating: 1000, towerBest: 0, bossWins: 0 },
    boss: {},                 // slot -> déjà récompensé
    theme: {},                // jour -> { claimed, wins }
    createdAt: Date.now(),
  };
  db.users[id] = user;
  db.names[name.toLowerCase()] = id;
  save();
  return user;
}

export function checkPassword(user, password) {
  const a = Buffer.from(hash(password, user.salt), 'hex');
  const b = Buffer.from(user.pass, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newToken(user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = user.id;
  save();
  return token;
}

export const userByToken = token => (token && db.tokens[token] ? db.users[db.tokens[token]] : null);
export const userByName = name => db.users[db.names[(name || '').toLowerCase()]];

export function addCard(user, card) {
  const entry = user.collection[card.id] || { count: 0, at: Date.now() };
  entry.count++;
  user.collection[card.id] = entry;
  save();
  return entry.count;
}

export function publicProfile(user) {
  return {
    id: user.id, name: user.name, coins: user.coins, freePackAt: user.freePackAt, starterPacks: user.starterPacks,
    stats: user.stats, cardCount: Object.keys(user.collection).length,
  };
}
