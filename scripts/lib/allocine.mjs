/**
 * Helpers partages par les scripts de collecte Allocine.
 *
 * Les listings films et series partagent la meme structure de carte HTML : seuls
 * changent l'URL, l'identifiant (cfilm / cserie) et le contenu du bloc "info".
 */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export const ALLOCINE = 'https://www.allocine.fr'

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function get(url, opts = {}) {
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

// ------------------------------------------------------------------ Texte

export const deaccent = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')

const ENTITIES = {
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â',
  ccedil: 'ç', ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', icirc: 'î',
  iuml: 'ï', ntilde: 'ñ', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
  laquo: '«', raquo: '»', rsquo: '’', deg: '°',
}

export function decodeEntities(s) {
  if (!s) return s
  return s
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m)
}

export const clean = s => decodeEntities((s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())

/** Cle de deduplication : titre sans accents ni ponctuation. */
export const normTitle = t =>
  deaccent(decodeEntities(t || '').toLowerCase()).replace(/[^a-z0-9]+/g, '').trim()

/** Allocine obfusque ses URLs : on retire les marqueurs "ACr" puis on decode le base64. */
export function decodeAcLink(token) {
  try {
    const url = Buffer.from(token.replace(/ACr/g, ''), 'base64').toString('utf8')
    return /^\/[\w/.=&?-]+$/.test(url) ? ALLOCINE + url : null
  } catch {
    return null
  }
}

const MONTHS = {
  janvier: '01', fevrier: '02', mars: '03', avril: '04', mai: '05', juin: '06',
  juillet: '07', aout: '08', septembre: '09', octobre: '10', novembre: '11', decembre: '12',
}

export function parseFrenchDate(txt) {
  const t = clean(txt)
  const m = t.match(/(\d{1,2})\s+([a-zA-Zéûôà]+)\s+(\d{4})/)
  if (!m) {
    const y = t.match(/\b(\d{4})\b/)
    return y ? `${y[1]}-01-01` : null
  }
  const month = MONTHS[deaccent(m[2].toLowerCase())]
  return month ? `${m[3]}-${month}-${String(m[1]).padStart(2, '0')}` : null
}

export function parseNote(txt) {
  if (!txt) return null
  const n = parseFloat(String(txt).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// ------------------------------------------------------------------ Cartes

/** Recupere la note qui suit immediatement un intitule ("Presse" / "Spectateurs"). */
export function ratingAfter(card, label) {
  const at = card.search(new RegExp(`rating-title[^>]*>\\s*${label}\\s*<`))
  if (at < 0) return null
  const m = card.slice(at).match(/stareval-note[^>]*>([\d,]+)</)
  return m ? parseNote(m[1]) : null
}

export const splitCards = html =>
  html.split('<div class="card entity-card entity-card-list').slice(1)

/** Les noms cliquables d'un bloc (genres, realisateurs, acteurs...). */
export const linkedNames = block =>
  [...block.matchAll(/dark-grey-link"[^>]*>([^<]+)</g)].map(m => clean(m[1])).filter(Boolean)

/** Champs communs a toutes les cartes : titre, notes, genres, casting, visuels. */
export function parseCommonCard(card) {
  const titleMatch = card.match(/meta-title-link"[^>]*>([\s\S]*?)<\/a>/)
  if (!titleMatch) return null

  const info = card.match(/meta-body-info"[\s\S]*?<\/div>/)?.[0] ?? ''
  const dir = card.match(/meta-body-direction[\s\S]*?<\/div>/)?.[0] ?? ''
  const actors = card.match(/meta-body-actor[\s\S]*?<\/div>/)?.[0] ?? ''
  const trailerToken = card.match(/class="(ACr[\w=+/]+) thumbnail-container/)?.[1]

  const genres = linkedNames(info)
  const names = linkedNames(dir)
  const cast = linkedNames(actors)

  return {
    info,
    title: clean(titleMatch[1]),
    presse: ratingAfter(card, 'Presse'),
    spectateurs: ratingAfter(card, 'Spectateurs'),
    genres: genres.length ? genres.join(', ') : null,
    names: names.length ? names.join(', ') : null,
    acteurs: cast.length ? cast.join(', ') : null,
    poster: card.match(/thumbnail-img"[^>]*\s(?:data-src|src)="(https:\/\/[^"]+)"/)?.[1] ?? null,
    ba: trailerToken ? decodeAcLink(trailerToken) : null,
  }
}

/**
 * Parcourt un listing pagine.
 *
 * `parse` transforme une carte en objet (ou null pour l'ignorer) ; `onPage` recoit
 * les objets d'une page et renvoie false pour arreter la pagination.
 */
export async function crawl({ baseUrl, maxPages, parse, onPage, delay = 400 }) {
  const out = []
  for (let page = 1; page <= maxPages; page++) {
    const html = await get(`${baseUrl}${page > 1 ? `?page=${page}` : ''}`)

    // Au-dela de la derniere page Allocine renvoie une liste generique : on verifie
    // que la pagination pointe bien sur la page demandee.
    const current = html.match(/item current-item"[^>]*>\s*(\d+)\s*</)?.[1]
    if (page > 1 && current !== String(page)) break

    const cards = splitCards(html)
    if (!cards.length) break

    const parsed = cards.map(parse).filter(Boolean)
    out.push(...parsed)

    if (onPage && onPage(parsed, page) === false) break
    await sleep(delay)
  }
  return out
}
