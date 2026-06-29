# PASSATION — Ardoise

Document de reprise pour continuer le développement (Claude Code).

## 1. Ce que c'est

Suivi de dépenses perso, mono-utilisateur, **sans backend**. Données en
`localStorage` (préfixe `ardoise:`). Décision d'archi assumée : on a écarté
toute intégration API bancaire (DSP2 / agrégateurs type Enable Banking) car ça
imposait un serveur + un flux OAuth/SCA. À la place : **export manuel du relevé
Crédit Mutuel → import CSV** dans l'app. C'est suffisant pour le besoin.

## 2. État actuel (v0.1)

Fonctionnel :
- saisie d'une dépense (montant, libellé, catégorie, date) ;
- 9 catégories par défaut + ajout/suppression de catégories perso (couleur) ;
- total du mois, comparaison au mois précédent, moyenne/jour, poste principal ;
- barre de répartition segmentée (élément signature) ;
- donut de répartition (Recharts) + histogramme 12 mois ;
- liste filtrable (catégorie) + recherche texte + suppression ;
- import CSV relevé bancaire avec auto-catégorisation par mots-clés ;
- export CSV de sauvegarde ;
- persistance localStorage ; responsive ; thème sombre (slate/emerald).

## 3. Arborescence

```
ardoise/
├── index.html
├── package.json            # react, recharts, lucide-react, papaparse + vite/tailwind
├── vite.config.js          # base: "./" pour GitHub Pages
├── tailwind.config.js
├── postcss.config.js
├── sample/
│   └── exemple-credit-mutuel.csv
└── src/
    ├── main.jsx
    ├── index.css           # directives Tailwind
    ├── Ardoise.jsx         # tout le composant (UI + état + graphiques)
    └── lib/
        ├── storage.js      # shim localStorage (get/set/remove, préfixe ardoise:)
        └── importBank.js    # parsing CSV banque + règles d'auto-catégorisation
```

## 4. Modèle de données

```js
// clé localStorage "ardoise:data"
{
  expenses: [
    { id, amount /*number, positif*/, label, categoryId, date /*"YYYY-MM-DD"*/ }
  ],
  categories: [
    { id, label, color /*hex*/, builtin /*bool*/ }
  ]
}
```

Les icônes des catégories built-in sont mappées dans `Ardoise.jsx` (`ICONS`),
pas stockées. Une catégorie perso retombe sur l'icône générique `Tag`.

## 5. Format d'import Crédit Mutuel (référence)

CSV : séparateur `;`, **décimale = virgule**, date `JJ/MM/AAAA`, ligne d'en-tête.
Deux variantes de colonnes selon la caisse régionale :
- une colonne `Montant` signée (débits négatifs), **ou**
- deux colonnes `Débit` / `Crédit`.

`importBank.js` gère les deux + un fallback heuristique sans en-tête. Il ne
garde que les débits. Si une caisse sort un format exotique, ajuster
`findHeader` / `colIndexes` / `toNumber` / `toISODate`.

## 6. Pistes / TODO (par priorité)

1. **Dédoublonnage à l'import** : éviter de réimporter deux fois les mêmes
   opérations (clé = date+montant+libellé). Aujourd'hui un double import crée
   des doublons.
2. **Re-catégorisation rapide** : permettre de changer la catégorie d'une
   dépense depuis la liste (menu/clic), utile après un import.
3. **Édition d'une dépense** (actuellement : suppression seulement).
4. **Budgets par catégorie** + alerte de dépassement sur la barre de répartition.
5. **Support OFX/QIF** en plus du CSV (formats aussi proposés par le CM).
6. **Récap annuel** / vue par année, en plus du mensuel.
7. **Sauvegarde/restauration JSON** complète (l'export actuel est un CSV plat,
   il ne réimporte pas les catégories perso).
8. Persiste les règles d'auto-catégorisation côté utilisateur (éditables dans
   l'UI plutôt qu'en dur dans `importBank.js`).

## 7. Conventions

- Montants affichés via `Intl.NumberFormat("fr-FR", { currency: "EUR" })`.
- Dates internes en ISO `YYYY-MM-DD`, affichage en `fr-FR`.
- Couleurs de catégorie appliquées en `style` inline (dynamiques), le reste en
  classes Tailwind statiques (ne pas construire de classes par concaténation,
  Tailwind ne les détecterait pas au build).
- UI et libellés en français, tutoiement, ton sobre.
