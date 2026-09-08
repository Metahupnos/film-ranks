# Movie Choice

Dashboard pour choisir quoi regarder : deux catalogues, films et séries, notés par la
presse et les spectateurs (Allociné) et par TMDB.

**En ligne : https://metahupnos.github.io/film-ranks/**

## Les deux onglets

| | Films | Séries |
|---|---|---|
| Tri | cote presse / spectateurs / TMDB | idem |
| Filtres communs | décennie, genre, pays, recherche plein texte | idem |
| Filtres propres | durée | plateforme, statut, nombre de saisons |

Les séries affichent en plus le nombre de saisons et d'épisodes, la plateforme de
diffusion et le statut (En cours / Terminée / Annulée) — de quoi éviter de se lancer
dans une série annulée au bout d'une saison.

## Développement

```bash
npm install
npm run dev       # serveur de dev
npm run build     # build de production
npm run lint
npm run deploy    # build + publication sur gh-pages
```

## Mise à jour des catalogues

Les données vivent dans `public/data/films.json` et `public/data/series.json`, servies
en HTTP et chargées à la demande par l'onglet concerné — les embarquer dans le bundle
le ferait passer de 200 ko à plus de 2 Mo.

Les deux scripts sont **incrémentaux** : ils ne touchent pas aux fiches existantes et
n'ajoutent que ce qui manque, en dédupliquant sur le titre normalisé.

```bash
# Une clé TMDB est nécessaire pour les champs pays / note TMDB / casting,
# et pour les séries : saisons, épisodes, statut, plateforme.
# Elle se récupère sur https://www.themoviedb.org/settings/api
$env:TMDB_API_KEY = "..."          # PowerShell
export TMDB_API_KEY=...            # bash

npm run update:films               # dernières sorties (2025-2026 par défaut)
npm run update:series              # catalogue séries

# Options
npm run update:films -- --years 2024,2025,2026 --min-presse 3.0 --dry-run
npm run update:series -- --min-presse 4.0 --since 2010
```

`--dry-run` affiche ce qui serait ajouté sans écrire les fichiers.

### D'où viennent les données

- **Allociné** — titre, cotes presse et spectateurs, durée, genres, réalisateur ou
  créateur, affiche, bande-annonce, date de sortie ou années de diffusion.
  Les scripts parcourent les listings triés par cote presse. Deux particularités :
  les URLs de bandes-annonces sont obfusquées en base64 (avec des marqueurs `ACr`
  insérés), et le tri presse des **films** est plafonné à 180 entrées par an — d'où
  une seconde passe sur la liste par popularité pour récupérer la tranche basse.
  Celui des séries n'est pas plafonné, une seule passe suffit.
- **TMDB** — pays (en anglais), note et nombre de votes, casting principal, et pour
  les séries saisons, épisodes, statut et plateforme.

Le seuil par défaut est une cote presse **≥ 3.5**, ce qui correspond à la densité
historique du catalogue (~50-100 titres par an et par décennie).

`scripts/lib/` contient ce que les deux scripts partagent : requêtes et parsing
Allociné (`allocine.mjs`), enrichissement TMDB (`tmdb.mjs`), lecture/écriture des
catalogues et calcul des rangs par décennie (`dataset.mjs`).
