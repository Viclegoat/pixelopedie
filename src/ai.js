// Génération des attaques par Claude (optionnelle).
// Activée seulement si la variable d'environnement ANTHROPIC_API_KEY est définie.
// Sans clé, le jeu utilise les attaques tirées des liens de la page Wikipédia.
import Anthropic from '@anthropic-ai/sdk';
import { TYPE_IDS, EFFECTS } from '../public/shared/types.js';
import { isBadMoveName } from './filter.js';

const MODEL = process.env.PIXELOPEDIE_MODEL || 'claude-opus-5-5';
let client = null;

export function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const ARCHETYPES = ['costume', 'sportif', 'blouse', 'hoodie', 'royal', 'tenue', 'soldat', 'artiste', 'robe', 'chef', 'explorateur',
  'animal', 'oiseau', 'poisson', 'plante', 'golem', 'robot', 'esprit', 'mascotte'];
const ACCESSORIES = ['micro', 'mallette', 'raquette', 'ovale', 'basket', 'casque', 'gants', 'ballon', 'medaille', 'fiole', 'livre',
  'laptop', 'sceptre', 'epee', 'fusil', 'guitare', 'pinceau', 'clap', 'plume', 'aureole', 'toque', 'carte', 'pot', 'queue',
  'eau', 'neige', 'pierre', 'antenne', 'canon', 'atome', 'note'];
const EFFECT_IDS = [...Object.keys(EFFECTS), 'aucun'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sensitive', 'type', 'archetype', 'accessory', 'moves'],
  properties: {
    sensitive: { type: 'boolean' },
    type: { type: 'string', enum: TYPE_IDS },
    archetype: { type: 'string', enum: ARCHETYPES },
    accessory: { type: 'string', enum: ACCESSORIES },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type', 'power', 'effect'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: TYPE_IDS },
          power: { type: 'integer' },
          effect: { type: 'string', enum: EFFECT_IDS },
        },
      },
    },
  },
};

const SYSTEM = `Tu conçois des cartes pour Pixelopédie, un jeu de combat façon Pokémon où chaque carte est une page de Wikipédia en français.
Pour la page donnée, invente 4 attaques drôles et reconnaissables, liées au sujet (ses œuvres, son parti, ses répliques connues, ses traits célèbres, ses lieux, ses objets...).
Règles :
- Les 3 premières attaques infligent des dégâts (power entre 55 et 110, la première est la plus forte). La 4e est une attaque de soutien (power 0) avec un effet.
- Noms courts (2 à 24 caractères), en français, sans guillemets.
- L'humour peut gentiment caricaturer le rôle public ou un trait connu d'une personnalité, mais jamais d'insulte, ni de moquerie sur l'origine, la religion, le handicap, la sexualité, la santé ou la mort.
- Effets possibles : ${Object.entries(EFFECTS).map(([k, v]) => `${k} (${v})`).join(', ')}, aucun.
- Types possibles : ${TYPE_IDS.join(', ')}.
- archetype et accessory décrivent le petit corps en pixel art sous la tête du personnage.
- Mets sensitive à true si la page porte sur un sujet qui ne doit pas devenir une carte de jeu : sexualité, crime, attentat, génocide, victimes, drame récent, suicide, drogue, haine, ou une personne surtout connue pour un crime.`;

export async function aiDesign(page, hint) {
  if (!client) client = new Anthropic();
  const content = [
    `Titre : ${page.title}`,
    `Description : ${page.description || '(aucune)'}`,
    `Résumé : ${(page.extract || '').slice(0, 900)}`,
    `Liens de l'introduction : ${hint.links.slice(0, 40).map(l => l.target).join(', ')}`,
    `Catégories : ${(page.categories || []).slice(0, 20).join(', ')}`,
    `Type deviné automatiquement : ${hint.type} ; personne : ${hint.person ? 'oui' : 'non'} ; rareté : ${hint.rarity}`,
  ].join('\n');

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) console.warn('[ia] clé API invalide, attaques Wikipédia utilisées');
    else if (err instanceof Anthropic.RateLimitError) console.warn('[ia] limite atteinte, attaques Wikipédia utilisées');
    else if (err instanceof Anthropic.APIError) console.warn(`[ia] erreur ${err.status} : ${err.message}`);
    else console.warn('[ia] erreur réseau', err?.message);
    return null;
  }
  if (response.stop_reason === 'refusal') return { sensitive: true };
  const text = response.content.find(b => b.type === 'text')?.text;
  if (!text) return null;
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (data.sensitive) return { sensitive: true };

  const moves = (data.moves || []).slice(0, 4).map((m, i) => {
    const support = i === 3;
    const effect = m.effect === 'aucun' ? null : (EFFECT_IDS.includes(m.effect) ? m.effect : null);
    return {
      name: String(m.name || '').slice(0, 26).trim(),
      type: TYPE_IDS.includes(m.type) ? m.type : data.type,
      power: support ? 0 : Math.max(50, Math.min(110, Math.round(m.power) || 70)),
      acc: support ? 100 : (m.power >= 90 ? 90 : 100),
      effect: support && !effect ? 'atk+' : effect,
      chance: support || effect === 'drain' ? 100 : 30,
    };
  });
  if (moves.length < 4 || moves.some(m => !m.name || isBadMoveName(m.name))) return null;
  return {
    sensitive: false,
    type: TYPE_IDS.includes(data.type) ? data.type : hint.type,
    look: { archetype: data.archetype, accessory: data.accessory },
    moves,
  };
}
