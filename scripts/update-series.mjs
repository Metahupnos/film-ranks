#!/usr/bin/env node
/**
 * Construit / met a jour public/data/series.json.
 *
 * Allocine fournit le titre, les cotes presse et spectateurs, la duree d'un episode,
 * les genres, le createur, le casting, l'affiche, la bande-annonce et les annees de
 * diffusion. TMDB ajoute le pays, sa propre note, et surtout ce qu'Allocine n'expose
 * pas en liste : nombre de saisons et d'episodes, statut et plateforme de diffusion.
 *
 * Deux listings sont parcourus :
 *   - le tri par cote presse, qui n'est pas plafonne comme celui des films ;
 *   - le tri par note spectateurs, decennie par decennie, en rattrapage. Allocine
 *     n'a en effet aucune cote presse pour la plupart des series anterieures a 2010
 *     (Sur ecoute, Dexter, Dr House, Sons of Anarchy...) : sans cette seconde passe
 *     la decennie 2000 se resumerait a quatre titres. On n'y retient que les series
 *     sans cote presse et bien notees par le public.
 *
 * --max-rattrapage borne la profondeur de parcours de chaque decennie : les listes
 * etant triees par note, une decennie deja bien couverte atteint le plafond en
 * quelques pages, tandis qu'une decennie clairsemee est parcourue plus loin.
 *
 * Usage :
 *   TMDB_API_KEY=xxx node scripts/update-series.mjs [--min-presse 3.5]
 *                                                   [--min-spectateurs 4.0]
 *                                                   [--max-rattrapage 150]
 *                                                   [--since 2000] [--dry-run]
 */

import {
  ALLOCINE, clean, crawl, normTitle, parseCommonCard,
} from './lib/allocine.mjs'
import { enrichAll, enrichSeries } from './lib/tmdb.mjs'
import { load, parseArgs, rankByDecade, save } from './lib/dataset.mjs'

const MAX_PAGES = 80 // 15 series par page

const { dryRun, minPresse, tmdbKey, flag } = parseArgs(process.argv.slice(2))
const SINCE = parseInt(flag('since', '2000'), 10)
const MIN_SPECTATEURS = parseFloat(flag('min-spectateurs', '4.0'))
const MAX_RATTRAPAGE = parseInt(flag('max-rattrapage', '150'), 10)
const DECENNIES = [2000, 2010, 2020].filter(d => d + 9 >= SINCE)

function parseCard(card) {
  const base = parseCommonCard(card)
  const id = card.match(/ficheserie_gen_cserie=(\d+)\.html/)?.[1]
  if (!base || !id) return null

  // Bloc info : "2011 - 2014 | 42 min | Drame, Policier". L'annee de fin est absente
  // pour une saison unique, et remplacee par "Depuis 2016" pour une serie en cours.
  const info = clean(base.info)
  const head = info.split('|')[0]
  const annees = [...head.matchAll(/\b(\d{4})\b/g)].map(m => parseInt(m[1], 10))

  return {
    cserie: id,
    title: base.title,
    presse: base.presse,
    spectateurs: base.spectateurs,
    duree: info.match(/(\d+\s*min)/)?.[1]?.replace(/\s+/, ' ') ?? null,
    genres: base.genres,
    createur: base.names,
    acteurs: base.acteurs,
    poster: base.poster,
    ba: base.ba,
    annee_debut: annees[0] ?? null,
    annee_fin: annees[1] ?? null,
  }
}

async function main() {
  const existing = await load('series')
  const known = new Set(existing.map(s => normTitle(s.title)))

  process.stdout.write(`Catalogue actuel : ${existing.length} series\n`)
  process.stdout.write(
    `Seuils : presse >= ${minPresse}, ou spectateurs >= ${MIN_SPECTATEURS} sans cote presse. A partir de ${SINCE}.\n\n`
  )

  const retenue = s =>
    s.presse != null ? s.presse >= minPresse : (s.spectateurs ?? 0) >= MIN_SPECTATEURS

  // Les deux listes sont triees par note decroissante : on s'arrete des qu'une page
  // entiere passe sous le seuil correspondant.
  const passes = [
    {
      nom: 'presse',
      url: `${ALLOCINE}/series-tv/presse/`,
      note: s => s.presse ?? 0,
      seuil: minPresse,
      plafond: Infinity,
    },
    ...DECENNIES.map(dec => ({
      nom: `notes ${dec}`,
      url: `${ALLOCINE}/series-tv/notes/decennie-${dec}/`,
      note: s => s.spectateurs ?? 0,
      seuil: MIN_SPECTATEURS,
      plafond: MAX_RATTRAPAGE,
    })),
  ]

  const scraped = []
  for (const passe of passes) {
    let retenues = 0
    const rows = await crawl({
      baseUrl: passe.url,
      maxPages: MAX_PAGES,
      parse: parseCard,
      onPage: (pageRows, page) => {
        const best = pageRows.length ? Math.max(...pageRows.map(passe.note)) : 0
        retenues += pageRows.filter(s => retenue(s) && (s.annee_debut ?? 0) >= SINCE).length
        process.stdout.write(
          `  ${passe.nom} p${page}: ${pageRows.length} series, ${retenues} retenues (max ${best.toFixed(1)})\n`
        )
        return best >= passe.seuil && retenues < passe.plafond
      },
    })
    scraped.push(...rows)
  }

  const seen = new Set()
  const candidates = scraped.filter(s => {
    if (!retenue(s)) return false
    if (!s.annee_debut || s.annee_debut < SINCE) return false
    const key = normTitle(s.title)
    if (known.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })

  process.stdout.write(`\n${scraped.length} series lues, ${candidates.length} nouvelles retenues\n`)
  if (!candidates.length) return
  if (!tmdbKey) process.stdout.write('! TMDB_API_KEY absent : pays, saisons, statut et plateforme seront vides\n')

  const extras = await enrichAll(
    tmdbKey,
    candidates.map(s => ({ ...s, year: s.annee_debut })),
    enrichSeries,
    (s, i, total) => {
      const note = s.presse != null ? `presse ${s.presse}` : `spectateurs ${s.spectateurs}`
      process.stdout.write(`  [${i + 1}/${total}] ${s.title} (${s.annee_debut}, ${note})\n`)
    }
  )

  const additions = candidates.map((s, i) => ({
    title: s.title,
    presse: s.presse,
    spectateurs: s.spectateurs,
    duree: s.duree,
    genres: s.genres,
    createur: s.createur,
    poster: s.poster,
    ba: s.ba,
    rang_presse: null,
    rang_spectateurs: null,
    decennie: `${String(s.annee_debut).slice(0, 3)}0`,
    annee_debut: s.annee_debut,
    annee_fin: s.annee_fin,
    pays: extras[i].pays ?? null,
    tmdb_note: extras[i].tmdb_note ?? null,
    tmdb_votes: extras[i].tmdb_votes ?? null,
    saisons: extras[i].saisons ?? null,
    episodes: extras[i].episodes ?? null,
    statut: extras[i].statut ?? null,
    plateforme: extras[i].plateforme ?? null,
    acteurs: extras[i].acteurs ?? s.acteurs,
  }))

  const merged = rankByDecade([...existing, ...additions])

  if (dryRun) {
    process.stdout.write(`\n[dry-run] ${additions.length} series non ecrites\n`)
    return
  }
  process.stdout.write(`\n${merged.length} series ecrites dans ${await save('series', merged)}\n`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
