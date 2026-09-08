#!/usr/bin/env node
/**
 * Met a jour public/data/films.json avec les dernieres sorties.
 *
 * Source principale : les listings Allocine (titre, cotes presse et spectateurs,
 * duree, genres, realisateur, acteurs, affiche, bande-annonce, date de sortie).
 * Les champs pays / tmdb_note / tmdb_votes / acteurs viennent de TMDB.
 *
 * Usage :
 *   TMDB_API_KEY=xxx node scripts/update-films.mjs [--years 2025,2026]
 *                                                  [--min-presse 3.5] [--dry-run]
 */

import {
  ALLOCINE, clean, crawl, normTitle, parseCommonCard, parseFrenchDate,
} from './lib/allocine.mjs'
import { enrichAll, enrichMovie } from './lib/tmdb.mjs'
import { load, parseArgs, rankByDecade, save } from './lib/dataset.mjs'

const MAX_PRESSE_PAGES = 20 // Allocine plafonne le tri presse a 12 pages par annee
const MAX_POPULAR_PAGES = 70 // au-dela, plus aucun film n'a de cote presse

const {
  dryRun, minPresse, years, tmdbKey,
} = parseArgs(process.argv.slice(2), { years: '2025,2026' })

function parseCard(card) {
  const base = parseCommonCard(card)
  const id = card.match(/fichefilm_gen_cfilm=(\d+)\.html/)?.[1]
  if (!base || !id) return null

  return {
    cfilm: id,
    title: base.title,
    presse: base.presse,
    spectateurs: base.spectateurs,
    duree: clean(base.info).match(/(\d+h(?:\s*\d+min)?|\d+min)/)?.[1] ?? null,
    genres: base.genres,
    realisateur: base.names,
    acteurs: base.acteurs,
    poster: base.poster,
    ba: base.ba,
    date_sortie: parseFrenchDate(base.info.match(/class="date">([^<]*)</)?.[1] ?? ''),
  }
}

/**
 * "presse"     : trie par cote presse decroissante. Rapide, mais plafonne a
 *                180 entrees par annee (soit une coupure vers 3,5).
 * "popularite" : liste complete de l'annee, non triee. Sert de rattrapage pour la
 *                tranche basse que la premiere liste n'atteint pas.
 */
async function scrapeYear(year) {
  const decade = `${String(year).slice(0, 3)}0`
  // Les listings annuels laissent passer quelques ressorties d'annees anterieures.
  const ofYear = card => {
    const f = parseCard(card)
    return f?.date_sortie?.startsWith(String(year)) ? f : null
  }
  const report = (kind, films, page) => {
    const kept = films.filter(f => (f.presse ?? 0) >= minPresse).length
    const best = films.length ? Math.max(...films.map(f => f.presse ?? 0)) : 0
    process.stdout.write(
      `  ${year} ${kind} p${page}: ${films.length} films, ${kept} >= ${minPresse} (max ${best.toFixed(1)})\n`
    )
    return { kept, best }
  }

  const byId = new Map()

  const pressList = await crawl({
    baseUrl: `${ALLOCINE}/films/presse/decennie-${decade}/annee-${year}/`,
    maxPages: MAX_PRESSE_PAGES,
    parse: ofYear,
    // Liste triee : des qu'une page entiere passe sous le seuil, la suite aussi.
    onPage: (films, page) => report('presse', films, page).best >= minPresse,
  })
  for (const f of pressList) byId.set(f.cfilm, f)

  let barren = 0
  const popularList = await crawl({
    baseUrl: `${ALLOCINE}/films/decennie-${decade}/annee-${year}/`,
    maxPages: MAX_POPULAR_PAGES,
    parse: ofYear,
    // Liste non triee : on s'arrete apres 5 pages sans film note par la presse.
    onPage: (films, page) => {
      barren = report('popularite', films, page).kept ? 0 : barren + 1
      return barren < 5
    },
  })
  for (const f of popularList) if (!byId.has(f.cfilm)) byId.set(f.cfilm, f)

  return [...byId.values()]
}

async function main() {
  const existing = await load('films')
  const known = new Set(existing.map(f => normTitle(f.title)))
  const today = new Date().toISOString().slice(0, 10)

  process.stdout.write(`Dataset actuel : ${existing.length} films\n`)
  process.stdout.write(`Annees ciblees : ${years.join(', ')} (cote presse >= ${minPresse})\n\n`)

  const scraped = []
  for (const year of years) scraped.push(...(await scrapeYear(year)))

  const seen = new Set()
  const candidates = scraped.filter(f => {
    if (f.presse == null || f.presse < minPresse) return false
    if (!f.date_sortie || f.date_sortie > today) return false
    const key = normTitle(f.title)
    if (known.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })

  process.stdout.write(`\n${scraped.length} films lus, ${candidates.length} nouveaux retenus\n`)
  if (!candidates.length) return
  if (!tmdbKey) process.stdout.write('! TMDB_API_KEY absent : pays / tmdb_note / tmdb_votes seront vides\n')

  const extras = await enrichAll(
    tmdbKey,
    candidates.map(f => ({ ...f, year: f.date_sortie.slice(0, 4) })),
    enrichMovie,
    (f, i, total) =>
      process.stdout.write(`  [${i + 1}/${total}] ${f.title} (${f.date_sortie}, presse ${f.presse})\n`)
  )

  const additions = candidates.map((f, i) => ({
    title: f.title,
    presse: f.presse,
    spectateurs: f.spectateurs,
    duree: f.duree,
    genres: f.genres,
    realisateur: f.realisateur,
    poster: f.poster,
    ba: f.ba,
    rang_presse: null,
    rang_spectateurs: null,
    decennie: `${f.date_sortie.slice(0, 3)}0`,
    date_sortie: f.date_sortie,
    pays: extras[i].pays ?? null,
    tmdb_note: extras[i].tmdb_note ?? null,
    tmdb_votes: extras[i].tmdb_votes ?? null,
    acteurs: extras[i].acteurs ?? f.acteurs,
  }))

  const merged = rankByDecade([...existing, ...additions])

  if (dryRun) {
    process.stdout.write(`\n[dry-run] ${additions.length} films non ecrits\n`)
    return
  }
  process.stdout.write(`\n${merged.length} films ecrits dans ${await save('films', merged)}\n`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
