# Pixelopédie

Jeu de cartes en ligne où **chaque page Wikipédia devient un combattant en pixel art**.
On ouvre des packs de pages au hasard, on collectionne, puis on se bat au tour par tour,
avec des attaques tirées du sujet de la page.

Chaque carte reçoit :

- **un personnage pixel art** : la tête montre la vraie photo de la page (nette), et le corps en pixel art dépend du sujet.
  Un footballeur porte un maillot et un ballon, un chanteur un micro, une commune devient un golem de pierre, un oiseau a un bec et des pattes…
- **un type** (Politique, Histoire, Science, Tech, Nature, Géographie, Guerre, Art, Sport, Mythe, Quotidien), déduit de la description et des catégories ;
- **une rareté** selon la popularité de la page (vues sur un an) ;
- **4 attaques** à thème. Elles sont tirées des liens de l'introduction de la page.
  Par exemple, Carlos attaque avec « Dorothée », « Eddie Barclay », « Chantal Goya ». Un cardinal de la Renaissance attaque avec « Clément VII », « Viterbo », « Exil ».
  Chaque attaque a sa propre animation en pixel art, choisie d'après son nom puis son type : « Incendie » met le feu, « Océan » envoie une vague,
  « Roland-Garros » une balle de tennis, « Rassemblement national » une bulle « RN! ». Deux attaques d'une même carte n'ont jamais la même animation.

## Lancer le jeu

Il faut [Node.js](https://nodejs.org) 18 ou plus récent (20+ conseillé).

```powershell
npm install
```

```powershell
npm start
```

Puis ouvre <http://localhost:3000>.

Au premier démarrage, le serveur met une à deux minutes à remplir sa réserve de cartes.
Il interroge Wikipédia doucement pour respecter ses limites. Les cartes générées sont gardées dans `data/db.json` et réutilisées ensuite.

### Jouer avec des amis

- **Même réseau (Wi-Fi)** : tes amis ouvrent `http://<ton-adresse-IP>:3000`. Ton adresse IP s'affiche avec `ipconfig` sous Windows.
- **Par Internet** : mets le jeu en ligne (voir ci-dessous).

### Mettre le site en ligne (Render + Neon, gratuit)

Le disque gratuit de Render est effacé à chaque redémarrage. Les comptes et les cartes sont donc gardés dans une base PostgreSQL gratuite chez Neon.

1. **Neon** (<https://neon.com>) : crée un projet dans la région *AWS Europe Central 1 (Frankfurt)*, la même que le serveur Render.
   Puis *Connect* et copie la « connection string » (elle commence par `postgresql://`).
2. **GitHub** : envoie ce dossier dans un dépôt (privé ou public).
3. **Render** (<https://render.com>) : *New +* → *Blueprint*, choisis le dépôt. Render lit `render.yaml` et te demande :
   - `DATABASE_URL` : la connection string de Neon ;
   - `WIKI_CONTACT` : l'adresse de ton dépôt GitHub, par exemple.
4. Attends la fin du déploiement : le site est en ligne à l'adresse `https://pixelopedie-xxxx.onrender.com` affichée par Render.

À chaque `git push`, Render remet le site à jour tout seul.
Sur l'offre gratuite, le site s'endort après 15 minutes sans visite et met environ 50 secondes à se réveiller.

Chez un autre hébergeur, les commandes sont `npm install` puis `npm start`, et le port est lu dans `PORT`.

## Réglages (variables d'environnement)

| Variable | Rôle | Par défaut |
|---|---|---|
| `PORT` | Port du serveur | `3000` |
| `DATA_DIR` | Dossier des sauvegardes (comptes, cartes, images) | `./data` |
| `DATABASE_URL` | Facultatif : base PostgreSQL (Neon…) pour garder comptes et cartes ailleurs que dans `data/db.json` | aucune |
| `TRUST_PROXY` | À mettre à `1` derrière un proxy (automatique sur Render) | aucun |
| `WIKI_CONTACT` | Contact envoyé à Wikimedia dans l'en-tête User-Agent (une URL ou une adresse). **Fortement conseillé en ligne** : Wikimedia bride les robots anonymes. | `jeu open source` |
| `CATALOG_TARGET` | Nombre de cartes que le serveur fabrique d'avance en arrière-plan | `20000` |
| `WIKI_GAP_MS` | Délai minimum entre deux requêtes vers Wikipédia | `600` |
| `ANTHROPIC_API_KEY` | Facultatif : si elle est présente, Claude invente les attaques et l'apparence des nouvelles cartes | aucune |
| `PIXELOPEDIE_MODEL` | Modèle Claude utilisé pour les cartes | `claude-opus-5-5` |

Exemple sous PowerShell :

```powershell
$env:WIKI_CONTACT = "https://github.com/ton-pseudo/pixelopedie"; npm start
```

Sans clé API, tout marche : les attaques viennent alors des liens Wikipédia.
Avec une clé, chaque nouvelle carte coûte un petit appel à l'API. Les cartes déjà générées ne coûtent plus rien.

## Les modes

| Mode | Principe | Récompenses |
|---|---|---|
| ⚔️ **Normal** | Équipe de 3 cartes de ta collection, contre un joueur en ligne, l'ordinateur ou un ami (code à 4 caractères) | Victoire 60 pièces (30 contre l'ordinateur), défaite 20 (10). Points de classement en ligne (+20 / −15). |
| 🎴 **Master** | Pas de deck : au début et à chaque K.O., tu ouvres une carte au hasard et tu te bats avec. Le premier à perdre 3 cartes perd. | Le gagnant **garde toutes les cartes ouvertes** pendant le combat, plus un bonus de 20 pièces. |
| 👹 **Boss** | Seul ou en groupe (jusqu'à 4, avec un code), contre un boss qui change toutes les 30 minutes. Plus la page est rare, plus le boss est solide (PV ×2,4 à ×4,8). Ses PV augmentent avec le nombre de joueurs, et à 3 ou 4 joueurs il attaque deux fois par tour. | 80 à 900 pièces selon la rareté, et 50 à 25 % de chances de gagner la carte du boss. Une seule récompense complète par boss. |
| 🗼 **Tour infinie** | Monte d'étage en étage avec la même équipe. Les gardiens sont plus nombreux et plus rares à chaque étage. Entre deux étages, tes cartes récupèrent 30 % de leurs PV, mais les cartes K.O. le restent. | 10 × le numéro de l'étage, et ton record au classement. |
| 📅 **Thème du jour** | Chaque jour un thème (Oiseaux, Pilotes de F1, Châteaux de la Loire, Dieux égyptiens…). Seules les cartes de ce thème sont autorisées. | Un pack gratuit de 3 cartes du thème par jour, récompenses ×1,5 et un classement du jour. |

Les packs coûtent 100 pièces. Un pack gratuit est offert toutes les 4 heures, et chaque nouveau joueur reçoit 2 packs de départ et 300 pièces.
Un pack contient 4 cartes au hasard et 1 carte Rare ou mieux (25 % d'Épique, 12 % de Légendaire, 3 % de Mythique).
Avoir une carte en double augmente son niveau : +3 % de stats par exemplaire, jusqu'au niveau 10.

## Toutes les cartes

Chaque page de Wikipédia peut devenir une carte, dans 6 langues : français, anglais, espagnol, allemand, italien et portugais
(plus de 18 millions de pages). Les cartes étrangères ont un petit badge (EN, ES, DE, IT, PT) et leur description vient de Wikidata, en français.
La rareté est calculée dans chaque langue : une page anglaise doit être environ 10 fois plus lue qu'une page française pour la même rareté.
Une même page n'existe qu'une fois : si « Lionel Messi » existe déjà en français, la recherche en espagnol renvoie cette carte.
Sur l'accueil ou dans l'écran Packs, clique sur une rareté pour voir toutes les cartes déjà créées, ou cherche une page.
Si elle n'existe pas encore comme carte, la recherche la crée tout de suite depuis Wikipédia.
En arrière-plan, le serveur fabrique des cartes en continu (les pages les plus lues de l'année, puis les pages qu'elles citent, puis des pages au hasard),
jusqu'à 20 000 cartes (`CATALOG_TARGET`).

## Règles de combat

- Tour par tour, 45 secondes pour choisir. Après ce délai, le jeu choisit pour toi.
- À chaque tour, tu choisis une attaque ou tu changes de carte (pas de changement en mode Master). La carte la plus rapide frappe en premier.
- Chaque carte a 4 attaques : une attaque signature puissante, une attaque de son type, une attaque d'un autre type et une capacité spéciale (soin, boost, Polémique, Censure…).
- Une attaque de même type que la carte fait +30 % de dégâts.
- **Polémique** : la carte perd 1/10 de ses PV à chaque tour, pendant 4 tours.
- **Censure** : la carte a une chance sur deux de ne pas pouvoir agir, pendant 2 tours.

### Rareté

| Rareté | Vues par an | Puissance |
|---|---|---|
| ★ Commune | moins de 5 000 | base |
| ★★ Peu commune | 5 000+ | +12 % |
| ★★★ Rare | 30 000+ | +25 % |
| ★★★★ Épique | 100 000+ | +40 % |
| ★★★★★ Légendaire | 300 000+ (des milliers de pages) | +57 % |
| ★★★★★★ Mythique | 1 000 000+ (France, Paris, les plus grandes stars…) | +77 % |

### Table des types (super efficace ×2, et ×0,5 dans l'autre sens)

| Type | Fort contre |
|---|---|
| 🏛️ Politique | Guerre, Quotidien |
| 📜 Histoire | Politique, Mythe |
| 🔬 Science | Mythe, Nature |
| 💾 Tech | Science, Quotidien |
| 🌿 Nature | Tech, Géographie |
| 🗺️ Géographie | Guerre, Sport |
| ⚔️ Guerre | Art, Histoire |
| 🎨 Art | Politique, Tech |
| ⚽ Sport | Histoire, Nature |
| ✨ Mythe | Sport, Géographie |
| 🍔 Quotidien | Art, Science |

## Sons et musique

Tout le son est fabriqué en direct dans le navigateur, comme sur une console 8 bits : pas de fichier audio.
La bande originale est composée pour le jeu :

| Morceau | Où |
|---|---|
| « Page au hasard » | menus, packs, collection |
| « Duel encyclopédique » | combats Normal, Master et Thème du jour |
| « Page protégée » | combats de boss |
| « Ascension » | Tour infinie |

Plus des jingles de victoire, de défaite et de match nul.
Chaque animation d'attaque a son propre bruitage (flammes, vague, éclairs, explosion, notes…), tout comme les coups, les soins, les statuts, l'ouverture des packs et la rareté des cartes.
Le bouton 🔊 en bas à droite règle la musique et les effets, ou coupe le son. Le son se coupe aussi quand l'onglet est caché.

## Contenu sensible

Les pages au contenu sensible ne sortent **jamais** des packs : sexualité, attentats, génocides, victimes, crimes, etc.
Les noms d'attaques sont aussi filtrés : jamais de religion, d'origine, de handicap ou de mort utilisés comme « attaque ».
Le filtre couvre les 6 langues. Les listes sont dans `src/filter.js`.

## Marché, enchères et échanges

Le bouton **Marché** (en haut, ou sur l'accueil) ouvre 4 onglets :

- **Marché** : achète des cartes à prix fixe aux autres joueurs.
- **Enchères** : le meilleur enchérisseur à la fin remporte la carte. Les pièces d'une enchère sont bloquées tant qu'on mène, et rendues si quelqu'un surenchérit.
  Une offre dans les 2 dernières minutes prolonge l'enchère de 2 minutes. Le vendeur peut fixer un prix d'achat immédiat.
- **Échanges** : propose à un joueur (par son pseudo) des cartes et des pièces contre certaines de ses cartes et de ses pièces. Rien ne bouge tant qu'il n'a pas accepté ; il peut aussi refuser ou contre-proposer.
- **Vendre** : choisis une de tes cartes et mets-la à prix fixe ou aux enchères (1 h, 6 h, 1 jour ou 3 jours).

Une carte en vente quitte la collection du vendeur et y revient s'il annule ou si personne n'enchérit.
Chaque vente (marché ou enchères) coûte 5 % de commission au vendeur. Les joueurs reçoivent une notification pour chaque vente, enchère dépassée ou échange.

## Organisation du code

```
server.js              serveur web (comptes, packs, classements, proxy d'images)
src/wiki.js            accès à Wikipédia (requêtes groupées et espacées)
src/cardgen.js         type, rareté, stats, apparence et attaques d'une carte
src/ai.js              génération facultative par Claude
src/filter.js          filtre du contenu sensible
src/pool.js            réserve de cartes remplie en arrière-plan
src/battle.js          moteur de combat (côté serveur, anti-triche)
src/modes.js           boss, thèmes du jour
src/market.js          marché, enchères et échanges entre joueurs
src/game.js            temps réel (Socket.io) : files d'attente, duels, raids, tour
src/db.js              sauvegarde (fichier JSON, ou PostgreSQL avec DATABASE_URL)
public/                le site : écrans, pixel art (js/sprite.js), écran de combat (js/battleview.js)
public/js/fx.js        animations des attaques (flammes, vague, éclairs, ballon, notes, bulles…), choisies d'après le nom et le type
public/js/audio.js     synthé 8 bits : bande originale, jingles et bruitages
public/js/market.js    écran Marché (achat, enchères, échanges, vente)
render.yaml            configuration de mise en ligne sur Render
public/shared/types.js règles partagées entre le serveur et le navigateur
```

## Limites connues

- Tout est gardé en mémoire et écrit régulièrement (fichier JSON ou PostgreSQL) : parfait pour un serveur entre amis, pas pour des milliers de joueurs.
- Si beaucoup de joueurs ouvrent des packs en même temps, Wikipédia peut demander une pause. Le jeu attend alors et réutilise les cartes déjà générées.
- Les attaques viennent des liens Wikipédia, donc certaines sont plus parlantes que d'autres. Avec une clé API, elles sont plus drôles et plus précises.
