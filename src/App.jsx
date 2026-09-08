import { useEffect, useMemo, useState } from 'react'
import './App.css'

const TABS = [
  { id: 'films', label: '🎬 Films', unite: ['film', 'films'] },
  { id: 'series', label: '📺 Séries', unite: ['série', 'séries'] },
]

// Les deux catalogues sont servis depuis public/data/ et charges a la demande : les
// embarquer dans le bundle le ferait passer de 200 ko a plus de 2 Mo. Le resultat est
// garde en memoire pour que revenir sur un onglet soit instantane.
const chargés = new Map()
const echecs = new Map()
const enCours = new Map()

function charger(tab) {
  if (!enCours.has(tab)) {
    enCours.set(
      tab,
      fetch(`${import.meta.env.BASE_URL}data/${tab}.json`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        })
        .then(rows => chargés.set(tab, rows))
        .catch(err => echecs.set(tab, err.message))
    )
  }
  return enCours.get(tab)
}

function useCatalogue(tab) {
  const [, rerender] = useState(0)

  useEffect(() => {
    if (chargés.has(tab) || echecs.has(tab)) return
    let annule = false
    charger(tab).then(() => {
      if (!annule) rerender(n => n + 1)
    })
    return () => {
      annule = true
    }
  }, [tab])

  if (chargés.has(tab)) return { status: 'ready', rows: chargés.get(tab) }
  if (echecs.has(tab)) return { status: 'error', rows: [], message: echecs.get(tab) }
  return { status: 'loading', rows: [] }
}

function StarRating({ note, max = 5 }) {
  const stars = []
  for (let i = 1; i <= max; i++) {
    if (i <= Math.floor(note)) {
      stars.push(<span key={i} className="star full">★</span>)
    } else if (i - note < 1) {
      stars.push(<span key={i} className="star half">★</span>)
    } else {
      stars.push(<span key={i} className="star empty">★</span>)
    }
  }
  return <span className="stars">{stars}</span>
}

/** "2022 — 2026" pour une serie terminee, "Depuis 2022" pour une serie en cours. */
function periode(serie) {
  if (!serie.annee_debut) return null
  if (serie.annee_fin && serie.annee_fin !== serie.annee_debut) {
    return `${serie.annee_debut} — ${serie.annee_fin}`
  }
  return serie.statut === 'En cours' ? `Depuis ${serie.annee_debut}` : String(serie.annee_debut)
}

function Meta({ item, kind }) {
  const parts = []
  if (kind === 'films') {
    if (item.date_sortie) {
      parts.push(new Date(item.date_sortie).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' }))
    }
    if (item.duree) parts.push(item.duree)
  } else {
    const p = periode(item)
    if (p) parts.push(p)
    if (item.saisons) {
      parts.push(`${item.saisons} saison${item.saisons > 1 ? 's' : ''}${item.episodes ? ` · ${item.episodes} ép.` : ''}`)
    }
    if (item.duree) parts.push(`${item.duree}/ép.`)
  }
  if (item.genres) parts.push(item.genres)

  const auteur = kind === 'films' ? item.realisateur : item.createur

  return (
    <div className="film-meta">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="sep">|</span>}
          {part}
        </span>
      ))}
      {auteur && <span className="sep">—</span>}
      {auteur && <span className="director">{auteur}</span>}
      {item.pays && <span className="sep">|</span>}
      {item.pays && <span className="pays">{item.pays}</span>}
    </div>
  )
}

function Card({ item, kind, onPosterClick }) {
  return (
    <div className="film-card">
      {item.poster && (
        <img src={item.poster} alt={item.title} className="film-poster" onClick={() => onPosterClick(item)} />
      )}
      <div className="film-info">
        <h3 className="film-title">{item.title}</h3>
        <Meta item={item} kind={kind} />
        {kind === 'series' && (item.plateforme || item.statut) && (
          <div className="badges">
            {item.plateforme && <span className="badge badge-plateforme">{item.plateforme}</span>}
            {item.statut && (
              <span className={`badge badge-statut statut-${item.statut === 'En cours' ? 'live' : 'fini'}`}>
                {item.statut}
              </span>
            )}
          </div>
        )}
        {item.acteurs && <div className="film-actors">{item.acteurs}</div>}
        <div className="ratings">
          {item.presse != null && (
            <div className="rating">
              <span className="rating-label">Cote presse</span>
              <StarRating note={item.presse} />
              <span className="rating-note">{item.presse.toFixed(1)}</span>
            </div>
          )}
          {item.spectateurs != null && (
            <div className="rating">
              <span className="rating-label">Cote spectateurs</span>
              <StarRating note={item.spectateurs} />
              <span className="rating-note">{item.spectateurs.toFixed(1)}</span>
            </div>
          )}
          {item.tmdb_note != null && (
            <div className="rating">
              <span className="rating-label">Cote TMDB</span>
              <span className="rating-note tmdb">{item.tmdb_note.toFixed(1)}<span className="tmdb-max">/10</span></span>
            </div>
          )}
        </div>
      </div>
      <a href={item.ba} target="_blank" rel="noopener noreferrer" className="btn-ba">
        ▶ Trailer
      </a>
    </div>
  )
}

function parseDureeMinutes(duree) {
  if (!duree) return 0
  const h = duree.match(/(\d+)h/)
  const m = duree.match(/(\d+)\s*min/)
  return (h ? parseInt(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0)
}

/** Valeurs distinctes d'un champ multi-valué ("Drame, Policier"), triées. */
function vocabulaire(rows, champ) {
  return [...new Set(rows.flatMap(r => (r[champ] ? r[champ].split(', ') : [])))].sort()
}

const FILTRES_VIDES = {
  genre: 'Tous',
  pays: 'Tous',
  duree: 'Tous',
  plateforme: 'Toutes',
  statut: 'Tous',
  saisons: 'Toutes',
}

function App() {
  const [tab, setTab] = useState('films')
  const [sortBy, setSortBy] = useState('presse')
  const [decennie, setDecennie] = useState('all')
  const [filtres, setFiltres] = useState(FILTRES_VIDES)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)

  const { status, rows, message } = useCatalogue(tab)
  const onglet = TABS.find(t => t.id === tab)

  // Les vocabulaires genres / pays / plateformes different d'un onglet a l'autre.
  const changeTab = id => {
    setTab(id)
    setFiltres(FILTRES_VIDES)
    setSearch('')
  }
  const setFiltre = (nom, valeur) => setFiltres(f => ({ ...f, [nom]: valeur }))

  const genres = useMemo(() => vocabulaire(rows, 'genres'), [rows])
  const pays = useMemo(() => vocabulaire(rows, 'pays'), [rows])
  const plateformes = useMemo(() => vocabulaire(rows, 'plateforme'), [rows])

  const sorted = useMemo(() => {
    const filtered = rows.filter(r => {
      if (search) {
        const q = search.toLowerCase()
        const haystack = [r.title, r.realisateur, r.createur, r.acteurs, r.pays, r.genres, r.plateforme]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (decennie !== 'all' && r.decennie !== decennie) return false
      if (filtres.genre !== 'Tous' && !r.genres?.includes(filtres.genre)) return false
      if (filtres.pays !== 'Tous' && !r.pays?.includes(filtres.pays)) return false

      if (tab === 'films' && filtres.duree !== 'Tous') {
        const min = parseDureeMinutes(r.duree)
        if (filtres.duree === 'court' && min >= 100) return false
        if (filtres.duree === 'moyen' && (min < 100 || min > 120)) return false
        if (filtres.duree === 'long' && min <= 120) return false
      }

      if (tab === 'series') {
        if (filtres.plateforme !== 'Toutes' && !r.plateforme?.includes(filtres.plateforme)) return false
        if (filtres.statut !== 'Tous' && r.statut !== filtres.statut) return false
        if (filtres.saisons !== 'Toutes') {
          const n = r.saisons ?? 0
          if (filtres.saisons === '1' && n !== 1) return false
          if (filtres.saisons === '2-3' && (n < 2 || n > 3)) return false
          if (filtres.saisons === '4+' && n < 4) return false
        }
      }
      return true
    })

    const key = sortBy === 'presse' ? 'presse' : sortBy === 'spectateurs' ? 'spectateurs' : 'tmdb_note'
    return filtered.sort((a, b) => {
      const na = a[key] ?? -1
      const nb = b[key] ?? -1
      if (nb !== na) return nb - na
      const da = a.date_sortie ?? String(a.annee_debut ?? '')
      const db = b.date_sortie ?? String(b.annee_debut ?? '')
      return db.localeCompare(da)
    })
  }, [rows, search, decennie, filtres, sortBy, tab])

  const [singulier, pluriel] = onglet.unite

  return (
    <div className="app">
      <header>
        <a href="https://metahupnos.github.io/" className="avatar-link" target="_blank" rel="noopener noreferrer">
          <img src={`${import.meta.env.BASE_URL}krissy.jpeg`} alt="Kiki" className="avatar" />
          <span className="avatar-name">Kiki ©</span>
        </a>
        <h1>Movie Choice</h1>
        <div className="tab-bar">
          {TABS.map(t => (
            <button
              key={t.id}
              className={t.id === tab ? 'tab active' : 'tab'}
              onClick={() => changeTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="search-bar"
          placeholder={
            tab === 'films'
              ? 'Rechercher un titre, acteur, réalisateur, pays...'
              : 'Rechercher un titre, acteur, créateur, plateforme...'
          }
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="filter-row">
          <label className="filter-group">
            Décennie :
            <select value={decennie} onChange={e => setDecennie(e.target.value)}>
              <option value="all">Toutes</option>
              <option value="2000">2000 — 2009</option>
              <option value="2010">2010 — 2019</option>
              <option value="2020">2020 — 2029</option>
            </select>
          </label>
          <label className="filter-group">
            Trier par :
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="presse">Cote presse</option>
              <option value="spectateurs">Cote spectateurs</option>
              <option value="tmdb">Cote TMDB</option>
            </select>
          </label>
        </div>
        <div className="filter-row">
          <label className="filter-group">
            Genre :
            <select value={filtres.genre} onChange={e => setFiltre('genre', e.target.value)}>
              <option value="Tous">Tous</option>
              {genres.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        </div>
        <div className="filter-row">
          <label className="filter-group">
            Pays :
            <select value={filtres.pays} onChange={e => setFiltre('pays', e.target.value)}>
              <option value="Tous">Tous</option>
              {pays.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          {tab === 'films' && (
            <label className="filter-group">
              Durée :
              <select value={filtres.duree} onChange={e => setFiltre('duree', e.target.value)}>
                <option value="Tous">Tous</option>
                <option value="court">&lt; 1h40</option>
                <option value="moyen">1h40 — 2h</option>
                <option value="long">&gt; 2h</option>
              </select>
            </label>
          )}
          {tab === 'series' && (
            <label className="filter-group">
              Saisons :
              <select value={filtres.saisons} onChange={e => setFiltre('saisons', e.target.value)}>
                <option value="Toutes">Toutes</option>
                <option value="1">1 seule</option>
                <option value="2-3">2 à 3</option>
                <option value="4+">4 et plus</option>
              </select>
            </label>
          )}
        </div>
        {tab === 'series' && (
          <div className="filter-row">
            <label className="filter-group">
              Plateforme :
              <select value={filtres.plateforme} onChange={e => setFiltre('plateforme', e.target.value)}>
                <option value="Toutes">Toutes</option>
                {plateformes.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="filter-group">
              Statut :
              <select value={filtres.statut} onChange={e => setFiltre('statut', e.target.value)}>
                <option value="Tous">Tous</option>
                <option value="En cours">En cours</option>
                <option value="Terminée">Terminée</option>
                <option value="Annulée">Annulée</option>
              </select>
            </label>
          </div>
        )}
      </header>

      {status === 'loading' && <p className="etat">Chargement des {pluriel}…</p>}
      {status === 'error' && <p className="etat erreur">Catalogue indisponible ({message}).</p>}
      {status === 'ready' && (
        <>
          <p className="result-count">
            {sorted.length} {sorted.length > 1 ? pluriel : singulier}
          </p>
          <main>
            {sorted.map(item => (
              <Card
                key={`${item.title}-${item.decennie}`}
                item={item}
                kind={tab}
                onPosterClick={setModal}
              />
            ))}
          </main>
        </>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModal(null)}>&times;</button>
            <img src={modal.poster} alt={modal.title} className="modal-poster" />
            <h2 className="modal-title">{modal.title}</h2>
            <p className="modal-meta">
              {tab === 'series' ? periode(modal) : modal.duree}
              {modal.genres ? ` — ${modal.genres}` : ''}
            </p>
            {(modal.realisateur || modal.createur) && (
              <p className="modal-director">{modal.realisateur ?? modal.createur}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
