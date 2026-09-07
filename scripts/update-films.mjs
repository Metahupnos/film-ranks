#!/usr/bin/env node
/**
 * Met a jour src/data/films.json avec les dernieres sorties.
 *
 * Source principale : les pages "Meilleurs films" d'Allocine (titre, cotes presse
 * et spectateurs, duree, genres, realisateur, acteurs, affiche, bande-annonce,
 * date de sortie). Les champs pays / tmdb_note / tmdb_votes sont completes via
 * l'API TMDB, comme pour le reste du dataset.
 *
 * Usage :
 *   TMDB_API_KEY=xxx node scripts/update-films.mjs [--years 2025,2026] [--dry-run]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '..', 'src', 'data', 'films.json')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const ALLOCINE = 'https://www.allocine.fr'
const TMDB = 'https://api.themoviedb.org/3'

const MAX_PAGES = 20 // 15 films par page ; Allocine plafonne le tri presse a 12 pages
const MAX_POPULAR_PAGES = 70 // au-dela, plus aucun film n'a de cote presse

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const DRY_RUN = args.includes('--dry-run')
const YEARS = flag('years', '2025,2026').split(',').map(y => y.trim())
const TMDB_KEY = process.env.TMDB_API_KEY || flag('tmdb-key', '')

// Seuil de cote presse. 3.0 correspond au minimum present dans le dataset, mais la
// selection d'origine etait plus stricte (~50-100 films/an) : 3.5 conserve cette
// densite, et c'est aussi la ou s'arrete la liste "Note presse" d'Allocine.
const MIN_PRESSE = parseFloat(flag('min-presse', '3.5'))

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function get(url, opts = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', ...opts.headers },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return opts.json ? await res.json() : await res.text()
    } catch (err) {
      if (attempt === 3) throw err
      await sleep(800 * attempt)
    }
  }
}

// ---------------------------------------------------------------- Allocine

const MONTHS = {
  janvier: '01', fevrier: '02', mars: '03', avril: '04', mai: '05', juin: '06',
  juillet: '07', aout: '08', septembre: '09', octobre: '10', novembre: '11', decembre: '12',
}

const deaccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

function decodeEntities(s) {
  if (!s) return s
  return s
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&([a-z]+);/gi, (m, name) => {
      const map = {
        eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â',
        ccedil: 'ç', ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', icirc: 'î',
        iuml: 'ï', ntilde: 'ñ', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
        laquo: '«', raquo: '»', rsquo: '’', deg: '°',
      }
      return map[name] ?? m
    })
}

const clean = s => decodeEntities((s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())

/** Allocine obfusque ses URLs : on retire les marqueurs "ACr" puis on decode le base64. */
function decodeAcLink(token) {
  try {
    const b64 = token.replace(/ACr/g, '')
    const url = Buffer.from(b64, 'base64').toString('utf8')
    return /^\/[\w/.=&?-]+$/.test(url) ? ALLOCINE + url : null
  } catch {
    return null
  }
}

function parseFrenchDate(txt) {
  const m = clean(txt).match(/(\d{1,2})\s+([a-zA-Zéûôà]+)\s+(\d{4})/)
  if (!m) {
    const y = clean(txt).match(/\b(\d{4})\b/)
    return y ? `${y[1]}-01-01` : null
  }
  const month = MONTHS[deaccent(m[2].toLowerCase())]
  if (!month) return null
  return `${m[3]}-${month}-${String(m[1]).padStart(2, '0')}`
}

function parseNote(txt) {
  if (!txt) return null
  const n = parseFloat(txt.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Recupere la note qui suit immediatement un intitule ("Presse" / "Spectateurs"). */
function ratingAfter(card, label) {
  const at = card.search(new RegExp(`rating-title[^>]*>\\s*${label}\\s*<`))
  if (at < 0) return null
  const m = card.slice(at).match(/stareval-note[^>]*>([\d,]+)</)
  return m ? parseNote(m[1]) : null
}

function parseCard(card) {
  const idMatch = card.match(/fichefilm_gen_cfilm=(\d+)\.html/)
  const titleMatch = card.match(/meta-title-link"[^>]*>([\s\S]*?)<\/a>/)
  if (!idMatch || !titleMatch) return null

  const infoBlock = card.match(/meta-body-info"[\s\S]*?<\/div>/)?.[0] ?? ''
  const dirBlock = card.match(/meta-body-direction[\s\S]*?<\/div>/)?.[0] ?? ''
  const actorBlock = card.match(/meta-body-actor[\s\S]*?<\/div>/)?.[0] ?? ''

  const genres = [...infoBlock.matchAll(/dark-grey-link"[^>]*>([^<]+)</g)]
    .map(m => clean(m[1]))
    .filter(Boolean)

  const director = [...dirBlock.matchAll(/dark-grey-link"[^>]*>([^<]+)</g)]
    .map(m => clean(m[1]))
    .filter(Boolean)

  const actors = [...actorBlock.matchAll(/dark-grey-link"[^>]*>([^<]+)</g)]
    .map(m => clean(m[1]))
    .filter(Boolean)

  const trailerToken = card.match(/class="(ACr[\w=+/]+) thumbnail-container/)?.[1]
  const poster = card.match(/thumbnail-img"[^>]*\s(?:data-src|src)="(https:\/\/[^"]+)"/)?.[1] ?? null

  return {
    cfilm: idMatch[1],
    title: clean(titleMatch[1]),
    presse: ratingAfter(card, 'Presse'),
    spectateurs: ratingAfter(card, 'Spectateurs'),
    duree: clean(infoBlock).match(/(\d+h(?:\s*\d+min)?|\d+min)/)?.[1] ?? null,
    genres: genres.length ? genres.join(', ') : null,
    realisateur: director.length ? director.join(', ') : null,
    acteurs: actors.length ? actors.join(', ') : null,
    poster,
    ba: trailerToken ? decodeAcLink(trailerToken) : null,
    date_sortie: parseFrenchDate(infoBlock.match(/class="date">([^<]*)</)?.[1] ?? ''),
  }
}

/**
 * Parcourt un listing pagine d'Allocine.
 *
 * "presse"     : trie par cote presse decroissante. Rapide, mais Allocine plafonne
 *                cette liste a 180 entrees par annee (soit une coupure vers 3,5).
 * "popularite" : liste complete de l'annee, non triee par note. Sert de rattrapage
 *                pour la tranche 3,0 - 3,4 que la premiere liste n'atteint pas.
 */
async function scrapeListing(year, kind, maxPages) {
  const decade = `${String(year).slice(0, 3)}0`
  const base =
    kind === 'presse'
      ? `${ALLOCINE}/films/presse/decennie-${decade}/annee-${year}/`
      : `${ALLOCINE}/films/decennie-${decade}/annee-${year}/`

  const out = []
  let barren = 0

  for (let page = 1; page <= maxPages; page++) {
    const html = await get(`${base}${page > 1 ? `?page=${page}` : ''}`)

    // Au-dela de la derniere page Allocine renvoie une liste generique : on verifie
    // que la pagination pointe bien sur la page demandee.
    const current = html.match(/item current-item"[^>]*>\s*(\d+)\s*</)?.[1]
    if (page > 1 && current !== String(page)) break

    const cards = html.split('<div class="card entity-card entity-card-list').slice(1)
    if (!cards.length) break

    const parsed = cards
      .map(parseCard)
      .filter(f => f && f.date_sortie?.startsWith(String(year)))
    out.push(...parsed)

    const kept = parsed.filter(f => (f.presse ?? 0) >= MIN_PRESSE).length
    const best = parsed.length ? Math.max(...parsed.map(f => f.presse ?? 0)) : 0
    process.stdout.write(
      `  ${year} ${kind} p${page}: ${parsed.length} films, ${kept} >= ${MIN_PRESSE} (max ${best.toFixed(1)})\n`
    )

    if (kind === 'presse') {
      // Liste triee : des qu'une page entiere passe sous le seuil, la suite aussi.
      if (best < MIN_PRESSE) break
    } else {
      // Liste non triee : on s'arrete apres plusieurs pages consecutives sans film
      // note par la presse.
      barren = kept ? 0 : barren + 1
      if (barren >= 5) break
    }
    await sleep(400)
  }
  return out
}

async function scrapeYear(year) {
  const byId = new Map()
  for (const f of await scrapeListing(year, 'presse', MAX_PAGES)) byId.set(f.cfilm, f)
  for (const f of await scrapeListing(year, 'popularite', MAX_POPULAR_PAGES)) {
    if (!byId.has(f.cfilm)) byId.set(f.cfilm, f)
  }
  return [...byId.values()]
}

// -------------------------------------------------------------------- TMDB

async function tmdbEnrich(film) {
  if (!TMDB_KEY) return {}
  const year = film.date_sortie?.slice(0, 4)
  const q = encodeURIComponent(film.title)
  try {
    let search = await get(
      `${TMDB}/search/movie?api_key=${TMDB_KEY}&language=fr-FR&query=${q}${year ? `&year=${year}` : ''}`,
      { json: true }
    )
    if (!search.results?.length && year) {
      search = await get(`${TMDB}/search/movie?api_key=${TMDB_KEY}&language=fr-FR&query=${q}`, { json: true })
    }
    const hit = search.results?.[0]
    if (!hit) return {}

    const details = await get(
      `${TMDB}/movie/${hit.id}?api_key=${TMDB_KEY}&language=en-US&append_to_response=credits`,
      { json: true }
    )
    const pays = (details.production_countries ?? []).map(c => c.name).join(', ')
    const cast = (details.credits?.cast ?? []).slice(0, 5).map(c => c.name)
    return {
      pays: pays || null,
      tmdb_note: typeof details.vote_average === 'number' ? details.vote_average : null,
      tmdb_votes: typeof details.vote_count === 'number' ? details.vote_count : null,
      acteurs: cast.length ? cast.join(', ') : film.acteurs,
    }
  } catch (err) {
    process.stdout.write(`  ! TMDB echec pour "${film.title}" : ${err.message}\n`)
    return {}
  }
}

// -------------------------------------------------------------------- Merge

const normTitle = t =>
  deaccent(decodeEntities(t || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, '')
    .trim()

async function main() {
  const existing = JSON.parse(await readFile(DATA_FILE, 'utf8'))
  const known = new Set(existing.map(f => normTitle(f.title)))
  const today = new Date().toISOString().slice(0, 10)

  process.stdout.write(`Dataset actuel : ${existing.length} films\n`)
  process.stdout.write(`Annees ciblees : ${YEARS.join(', ')}\n\n`)

  const scraped = []
  for (const year of YEARS) scraped.push(...(await scrapeYear(year)))

  const seen = new Set()
  const candidates = scraped.filter(f => {
    if (f.presse == null || f.presse < MIN_PRESSE) return false
    if (!f.date_sortie || f.date_sortie > today) return false
    const key = normTitle(f.title)
    if (known.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })

  process.stdout.write(`\n${scraped.length} films lus, ${candidates.length} nouveaux retenus\n`)
  if (!candidates.length) return

  if (!TMDB_KEY) {
    process.stdout.write('! TMDB_API_KEY absent : pays / tmdb_note / tmdb_votes seront vides\n')
  }

  const additions = []
  for (const [i, f] of candidates.entries()) {
    const extra = await tmdbEnrich(f)
    additions.push({
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
      pays: extra.pays ?? null,
      tmdb_note: extra.tmdb_note ?? null,
      tmdb_votes: extra.tmdb_votes ?? null,
      acteurs: extra.acteurs ?? f.acteurs,
    })
    process.stdout.write(`  [${i + 1}/${candidates.length}] ${f.title} (${f.date_sortie}, presse ${f.presse})\n`)
    if (TMDB_KEY) await sleep(120)
  }

  const merged = [...existing, ...additions]

  // rang_presse / rang_spectateurs : rangs par decennie, comme le dataset d'origine
  for (const key of ['presse', 'spectateurs']) {
    const field = key === 'presse' ? 'rang_presse' : 'rang_spectateurs'
    const byDecade = new Map()
    for (const f of merged) {
      if (!byDecade.has(f.decennie)) byDecade.set(f.decennie, [])
      byDecade.get(f.decennie).push(f)
    }
    for (const list of byDecade.values()) {
      list
        .slice()
        .sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1))
        .forEach((f, i) => {
          f[field] = i + 1
        })
    }
  }

  if (DRY_RUN) {
    process.stdout.write(`\n[dry-run] ${additions.length} films non ecrits\n`)
    return
  }

  await writeFile(DATA_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  process.stdout.write(`\n${merged.length} films ecrits dans ${path.relative(process.cwd(), DATA_FILE)}\n`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
