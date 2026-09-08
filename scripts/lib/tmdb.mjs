/**
 * Enrichissement TMDB : pays, note, nombre de votes, casting principal, et pour les
 * series le nombre de saisons, le statut et la plateforme de diffusion.
 *
 * La cle se lit dans TMDB_API_KEY et n'est jamais ecrite dans le depot.
 */

import { get, sleep } from './allocine.mjs'

const TMDB = 'https://api.themoviedb.org/3'

export const hasKey = key => Boolean(key)

/** TMDB ne renvoie que des codes ISO pour les series : on charge la table une fois. */
let countryNames = null
async function isoToName(key, code) {
  if (!countryNames) {
    const list = await get(`${TMDB}/configuration/countries?api_key=${key}&language=en-US`, { json: true })
    countryNames = new Map(list.map(c => [c.iso_3166_1, c.english_name]))
  }
  return countryNames.get(code) ?? code
}

async function search(key, kind, title, year) {
  const q = encodeURIComponent(title)
  const yearParam = kind === 'movie' ? 'year' : 'first_air_date_year'
  let res = await get(
    `${TMDB}/search/${kind}?api_key=${key}&language=fr-FR&query=${q}${year ? `&${yearParam}=${year}` : ''}`,
    { json: true }
  )
  if (!res.results?.length && year) {
    res = await get(`${TMDB}/search/${kind}?api_key=${key}&language=fr-FR&query=${q}`, { json: true })
  }
  return res.results?.[0] ?? null
}

const cast5 = details =>
  (details.credits?.cast ?? []).slice(0, 5).map(c => c.name).join(', ') || null

export async function enrichMovie(key, { title, year }) {
  const hit = await search(key, 'movie', title, year)
  if (!hit) return null
  const d = await get(
    `${TMDB}/movie/${hit.id}?api_key=${key}&language=en-US&append_to_response=credits`,
    { json: true }
  )
  return {
    pays: (d.production_countries ?? []).map(c => c.name).join(', ') || null,
    tmdb_note: typeof d.vote_average === 'number' ? d.vote_average : null,
    tmdb_votes: typeof d.vote_count === 'number' ? d.vote_count : null,
    acteurs: cast5(d),
  }
}

const STATUTS = {
  'Returning Series': 'En cours',
  'Ended': 'Terminée',
  'Canceled': 'Annulée',
  'In Production': 'À venir',
  'Planned': 'À venir',
  'Pilot': 'À venir',
}

export async function enrichSeries(key, { title, year }) {
  const hit = await search(key, 'tv', title, year)
  if (!hit) return null
  const d = await get(
    `${TMDB}/tv/${hit.id}?api_key=${key}&language=en-US&append_to_response=credits`,
    { json: true }
  )

  let pays = (d.production_countries ?? []).map(c => c.name).join(', ')
  if (!pays && d.origin_country?.length) {
    const names = []
    for (const code of d.origin_country) names.push(await isoToName(key, code))
    pays = names.join(', ')
  }

  return {
    pays: pays || null,
    tmdb_note: typeof d.vote_average === 'number' ? d.vote_average : null,
    tmdb_votes: typeof d.vote_count === 'number' ? d.vote_count : null,
    acteurs: cast5(d),
    saisons: d.number_of_seasons ?? null,
    episodes: d.number_of_episodes ?? null,
    statut: STATUTS[d.status] ?? d.status ?? null,
    plateforme: (d.networks ?? []).map(n => n.name).join(', ') || null,
  }
}

/** Enrichit une liste en serie, en signalant les echecs sans interrompre le run. */
export async function enrichAll(key, items, enrich, onProgress) {
  const out = []
  for (const [i, item] of items.entries()) {
    let extra = null
    if (key) {
      try {
        extra = await enrich(key, item)
      } catch (err) {
        process.stdout.write(`  ! TMDB echec pour "${item.title}" : ${err.message}\n`)
      }
      await sleep(120)
    }
    out.push(extra ?? {})
    onProgress?.(item, i, items.length)
  }
  return out
}
