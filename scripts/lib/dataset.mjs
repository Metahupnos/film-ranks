/** Lecture / ecriture des catalogues JSON servis depuis public/data/. */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const dataPath = name => path.join(ROOT, 'public', 'data', `${name}.json`)

export async function load(name) {
  try {
    return JSON.parse(await readFile(dataPath(name), 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

export async function save(name, rows) {
  const file = dataPath(name)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(rows, null, 2) + '\n', 'utf8')
  return path.relative(process.cwd(), file)
}

/** Rangs presse et spectateurs, calcules a l'interieur de chaque decennie. */
export function rankByDecade(rows) {
  for (const [key, field] of [
    ['presse', 'rang_presse'],
    ['spectateurs', 'rang_spectateurs'],
  ]) {
    const decades = new Map()
    for (const row of rows) {
      if (!decades.has(row.decennie)) decades.set(row.decennie, [])
      decades.get(row.decennie).push(row)
    }
    for (const list of decades.values()) {
      list
        .slice()
        .sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1))
        .forEach((row, i) => {
          row[field] = i + 1
        })
    }
  }
  return rows
}

/** Options communes aux deux scripts de collecte. */
export function parseArgs(argv, defaults = {}) {
  const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
  }
  return {
    dryRun: argv.includes('--dry-run'),
    minPresse: parseFloat(flag('min-presse', defaults.minPresse ?? '3.5')),
    years: flag('years', defaults.years ?? '').split(',').map(y => y.trim()).filter(Boolean),
    tmdbKey: process.env.TMDB_API_KEY || flag('tmdb-key', ''),
    flag,
  }
}
