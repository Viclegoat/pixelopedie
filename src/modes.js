// Données des modes Boss et Thème du jour.
import { db, save } from './db.js';
import { drawRarity } from './pool.js';
import { hashStr } from './cardgen.js';
import { BOSS_SLOT_MS, rarityIndex } from '../public/shared/types.js';

// ---------- Boss : un nouveau toutes les 30 minutes ----------
export const BOSS = {
  hp:      { commune: 2.4, peu: 2.8, rare: 3.2, epique: 3.6, legendaire: 4.2 },
  coins:   { commune: 80, peu: 120, rare: 200, epique: 350, legendaire: 600 },
  drop:    { commune: 0.5, peu: 0.45, rare: 0.4, epique: 0.35, legendaire: 0.3 },
};

function rollBossRarity(slot) {
  const r = (hashStr('boss' + slot) % 1000) / 1000;
  return r < 0.30 ? 'commune' : r < 0.55 ? 'peu' : r < 0.77 ? 'rare' : r < 0.92 ? 'epique' : 'legendaire';
}

let bossPromise = null;
export const currentSlot = () => Math.floor(Date.now() / BOSS_SLOT_MS);

export async function currentBoss() {
  const slot = currentSlot();
  const b = db.meta.boss;
  if (b && b.slot === slot && db.cards[b.cardId]) return { ...b, card: db.cards[b.cardId], endsAt: (slot + 1) * BOSS_SLOT_MS };
  if (!bossPromise) {
    bossPromise = (async () => {
      const rarity = rollBossRarity(slot);
      let card = await drawRarity(rarity);
      // Évite de reprendre le boss précédent.
      if (card && b && card.id === b.cardId) card = await drawRarity(rarity);
      if (!card) throw new Error('Aucune carte disponible pour le boss');
      db.meta.boss = { slot, cardId: card.id, rarity: card.rarity };
      save();
    })().finally(() => { bossPromise = null; });
  }
  await bossPromise;
  const nb = db.meta.boss;
  return { ...nb, card: db.cards[nb.cardId], endsAt: (slot + 1) * BOSS_SLOT_MS };
}

export function bossFighterOptions(rarity, players) {
  return {
    hpMult: BOSS.hp[rarity] * (0.5 + 0.5 * players),
    statMult: 1 + rarityIndex(rarity) * 0.03,
    actionsPerTurn: 1 + Math.floor((players - 1) / 2),
  };
}

// ---------- Thème du jour ----------
export const THEMES = [
  { label: "Footballeurs de l'équipe de France", category: 'Footballeur international français', type: 'sport' },
  { label: 'Joueurs du PSG', category: 'Joueur du Paris Saint-Germain', type: 'sport' },
  { label: 'Pilotes de Formule 1', category: 'Pilote de Formule 1', type: 'sport' },
  { label: "Ministres de l'Intérieur", category: "Ministre français de l'Intérieur", type: 'politique' },
  { label: 'Personnalités politiques françaises', category: 'Personnalité politique française', type: 'politique' },
  { label: 'Mathématiciens du XXe siècle', category: 'Mathématicien français du XXe siècle', type: 'science' },
  { label: 'Physiciens du XXe siècle', category: 'Physicien français du XXe siècle', type: 'science' },
  { label: 'Langages de programmation', category: 'Langage de programmation', type: 'tech' },
  { label: 'Jeux vidéo de 2010', category: 'Jeu vidéo sorti en 2010', type: 'tech' },
  { label: 'Dinosaures du Crétacé', category: 'Dinosaure du Crétacé', type: 'nature' },
  { label: 'Oiseaux', category: 'Oiseau décrit en 1758', type: 'nature' },
  { label: 'Mammifères', category: 'Mammifère décrit en 1758', type: 'nature' },
  { label: 'Plantes médicinales', category: 'Plante médicinale', type: 'nature' },
  { label: 'Sommets des Alpes', category: 'Sommet des Alpes françaises', type: 'geo' },
  { label: 'Châteaux de la Loire', category: 'Château de la Loire', type: 'histoire' },
  { label: 'Batailles napoléoniennes', category: 'Bataille des guerres napoléoniennes', type: 'guerre' },
  { label: 'Peintres impressionnistes', category: 'Peintre impressionniste', type: 'art' },
  { label: 'Écrivains du XIXe siècle', category: 'Écrivain français du XIXe siècle', type: 'art' },
  { label: 'Dieux égyptiens', category: 'Divinité égyptienne', type: 'mythe' },
  { label: 'Super-héros Marvel', category: 'Super-héros Marvel', type: 'mythe' },
  { label: 'Chevaliers de la Table ronde', category: 'Chevalier de la Table ronde', type: 'mythe' },
  { label: 'Pâtisseries françaises', category: 'Pâtisserie française', type: 'quotidien' },
  { label: 'Fromages', category: 'Fromage au lait de vache', type: 'quotidien' },
];

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export function todayTheme() {
  const key = dayKey();
  const t = THEMES[hashStr('theme' + key) % THEMES.length];
  const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0);
  return { ...t, id: key, endsAt: tomorrow.getTime() };
}

export function themeEligible(card, theme = todayTheme()) {
  return card.type === theme.type || (card.categories || []).includes(theme.category);
}
