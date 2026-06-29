# Ardoise — suivi de dépenses

Application web perso pour suivre ses dépenses : saisie rapide, catégories,
statistiques et graphiques, **import d'un relevé bancaire CSV** (format Crédit
Mutuel géré). Tout est stocké **localement dans le navigateur** (localStorage),
rien ne part sur un serveur.

Stack : **Vite + React + Tailwind**, graphiques **Recharts**, parsing CSV
**PapaParse**, icônes **lucide-react**.

## Démarrer

```bash
npm install
npm run dev      # http://localhost:5173
```

Build de production et prévisualisation :

```bash
npm run build    # génère dist/
npm run preview
```

## Importer un relevé Crédit Mutuel

1. Espace **Ma Banque** → ouvrir le compte → **Autres → Export** → choisir la
   période → télécharger en **CSV**.
2. Dans Ardoise, bouton **« Importer un relevé (CSV) »**, sélectionner le
   fichier.

L'import (`src/lib/importBank.js`) gère :
- séparateur `;` ou `,` (auto-détecté) ;
- décimale française (virgule) ou point ;
- date `JJ/MM/AAAA` ou `AAAA-MM-JJ` ;
- colonne **Montant** signée **ou** colonnes **Débit/Crédit** séparées ;
- avec ou sans ligne d'en-tête.

Seuls les **débits** (dépenses) sont importés ; les crédits sont ignorés. Un
fichier d'exemple est fourni dans `sample/exemple-credit-mutuel.csv`.

## Déployer sur GitHub Pages

`vite.config.js` utilise déjà `base: "./"` (chemins relatifs), donc le build
fonctionne sous un sous-dossier `https://<user>.github.io/ardoise/`.

Méthode simple via GitHub Actions (`.github/workflows/deploy.yml`) :

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Puis dans **Settings → Pages**, choisir **GitHub Actions** comme source.

> Rappel : les données vivent dans le `localStorage` du navigateur. Elles sont
> donc propres à chaque machine/navigateur et ne se synchronisent pas. Le
> bouton **Exporter** produit un CSV de sauvegarde.
