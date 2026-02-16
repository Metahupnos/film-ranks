import { useState } from 'react'
import films from './data/films.json'
import './App.css'

function StarRating({ note, max = 5 }) {
  const stars = []
  for (let i = 1; i <= max; i++) {
    if (i <= Math.floor(note)) stars.push('★')
    else if (i - note < 1) stars.push('⯪')
    else stars.push('☆')
  }
  return <span className="stars">{stars.join('')}</span>
}

function FilmCard({ film, rank, sortBy, onPosterClick }) {
  const displayRank = sortBy === 'tmdb' ? null : sortBy === 'presse' ? film.rang_presse : film.rang_spectateurs
  return (
    <div className="film-card">
      <div className="rank">{displayRank ? `#${displayRank}` : '—'}</div>
      {film.poster && (
        <img
          src={film.poster}
          alt={film.title}
          className="film-poster"
          onClick={() => onPosterClick(film)}
        />
      )}
      <div className="film-info">
        <h3 className="film-title">{film.title}</h3>
        <div className="film-meta">
          {film.date_sortie && <span>{new Date(film.date_sortie).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' })}</span>}
          {film.date_sortie && film.duree && <span className="sep">|</span>}
          {film.duree && <span>{film.duree}</span>}
          {(film.date_sortie || film.duree) && film.genres && <span className="sep">|</span>}
          {film.genres && <span>{film.genres}</span>}
          {film.realisateur && <span className="sep">—</span>}
          {film.realisateur && <span className="director">{film.realisateur}</span>}
          {film.pays && <span className="sep">|</span>}
          {film.pays && <span className="pays">{film.pays}</span>}
        </div>
        {film.acteurs && <div className="film-actors">{film.acteurs}</div>}
        <div className="ratings">
          {film.presse != null && (
            <div className="rating">
              <span className="rating-label">Cote presse</span>
              <StarRating note={film.presse} />
              <span className="rating-note">{film.presse.toFixed(1)}</span>
            </div>
          )}
          {film.spectateurs != null && (
            <div className="rating">
              <span className="rating-label">Cote spectateurs</span>
              <StarRating note={film.spectateurs} />
              <span className="rating-note">{film.spectateurs.toFixed(1)}</span>
            </div>
          )}
          {film.tmdb_note != null && (
            <div className="rating">
              <span className="rating-label">Cote TMDB</span>
              <span className="rating-note tmdb">{film.tmdb_note.toFixed(1)}<span className="tmdb-max">/10</span></span>
            </div>
          )}
        </div>
      </div>
      <a href={film.ba} target="_blank" rel="noopener noreferrer" className="btn-ba">
        ▶ Trailer
      </a>
    </div>
  )
}

function parseDureeMinutes(duree) {
  if (!duree) return 0
  const h = duree.match(/(\d+)h/)
  const m = duree.match(/(\d+)min/)
  return (h ? parseInt(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0)
}

function App() {
  const [sortBy, setSortBy] = useState('presse')
  const [decennie, setDecennie] = useState('2020')
  const [genreFilter, setGenreFilter] = useState('Tous')
  const [dureeFilter, setDureeFilter] = useState('Tous')
  const [paysFilter, setPaysFilter] = useState('Tous')
  const [search, setSearch] = useState('')
  const [modalFilm, setModalFilm] = useState(null)

  // Extract all unique genres
  const allGenres = [...new Set(
    films.flatMap(f => f.genres ? f.genres.split(', ') : [])
  )].sort()

  const allPays = [...new Set(
    films.flatMap(f => f.pays ? f.pays.split(', ') : [])
  )].sort()

  const filtered = films.filter(f => {
    if (search) {
      const q = search.toLowerCase()
      const haystack = [f.title, f.realisateur, f.acteurs, f.pays, f.genres, f.date_sortie]
        .filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (decennie !== 'all' && f.decennie !== decennie) return false
    if (genreFilter !== 'Tous' && !(f.genres && f.genres.includes(genreFilter))) return false
    if (paysFilter !== 'Tous' && !(f.pays && f.pays.includes(paysFilter))) return false
    if (dureeFilter !== 'Tous') {
      const min = parseDureeMinutes(f.duree)
      if (dureeFilter === 'court' && min >= 100) return false
      if (dureeFilter === 'moyen' && (min < 100 || min > 120)) return false
      if (dureeFilter === 'long' && min <= 120) return false
    }
    return true
  })
  const sorted = [...filtered].sort((a, b) => {
    if (decennie === 'all') {
      const da = a.date_sortie || ''
      const db = b.date_sortie || ''
      return db.localeCompare(da)
    }
    if (sortBy === 'tmdb') {
      const na = a.tmdb_note ?? -1
      const nb = b.tmdb_note ?? -1
      return nb - na
    }
    const ra = sortBy === 'presse' ? a.rang_presse : a.rang_spectateurs
    const rb = sortBy === 'presse' ? b.rang_presse : b.rang_spectateurs
    if (ra == null && rb == null) return 0
    if (ra == null) return 1
    if (rb == null) return -1
    return ra - rb
  })

  return (
    <div className="app">
      <header>
        <h1>🎬 Top Films</h1>
        <p className="subtitle">Classement Allociné — Presse, Spectateurs & TMDB</p>
        <input
          type="text"
          className="search-bar"
          placeholder="Rechercher un titre, acteur, réalisateur, année, pays..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="sort-bar">
          <span>Décennie :</span>
          <button className={decennie === 'all' ? 'active' : ''} onClick={() => setDecennie('all')}>
            Toutes
          </button>
          <button className={decennie === '2000' ? 'active' : ''} onClick={() => setDecennie('2000')}>
            2000 — 2009
          </button>
          <button className={decennie === '2010' ? 'active' : ''} onClick={() => setDecennie('2010')}>
            2010 — 2019
          </button>
          <button className={decennie === '2020' ? 'active' : ''} onClick={() => setDecennie('2020')}>
            2020 — 2029
          </button>
        </div>
        <div className="sort-bar">
          <span>Trier par :</span>
          <button className={sortBy === 'presse' ? 'active' : ''} onClick={() => setSortBy('presse')}>
            Cote presse
          </button>
          <button className={sortBy === 'spectateurs' ? 'active' : ''} onClick={() => setSortBy('spectateurs')}>
            Cote spectateurs
          </button>
          <button className={sortBy === 'tmdb' ? 'active' : ''} onClick={() => setSortBy('tmdb')}>
            Cote TMDB
          </button>
        </div>
        <div className="filter-row">
          <span>Genre :</span>
          <select value={genreFilter} onChange={e => setGenreFilter(e.target.value)}>
            <option value="Tous">Tous</option>
            {allGenres.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <span className="filter-sep">Pays :</span>
          <select value={paysFilter} onChange={e => setPaysFilter(e.target.value)}>
            <option value="Tous">Tous</option>
            {allPays.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="genre-bar">
          <span>Durée :</span>
          <button className={dureeFilter === 'Tous' ? 'active' : ''} onClick={() => setDureeFilter('Tous')}>
            Tous
          </button>
          <button className={dureeFilter === 'court' ? 'active' : ''} onClick={() => setDureeFilter('court')}>
            &lt; 1h40
          </button>
          <button className={dureeFilter === 'moyen' ? 'active' : ''} onClick={() => setDureeFilter('moyen')}>
            1h40 — 2h
          </button>
          <button className={dureeFilter === 'long' ? 'active' : ''} onClick={() => setDureeFilter('long')}>
            &gt; 2h
          </button>
        </div>
      </header>
      <p className="result-count">{sorted.length} film{sorted.length > 1 ? 's' : ''}</p>
      <main>
        {sorted.map((film, i) => (
          <FilmCard key={film.title} film={film} rank={i + 1} sortBy={sortBy} onPosterClick={setModalFilm} />
        ))}
      </main>
      {modalFilm && (
        <div className="modal-overlay" onClick={() => setModalFilm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModalFilm(null)}>&times;</button>
            <img src={modalFilm.poster} alt={modalFilm.title} className="modal-poster" />
            <h2 className="modal-title">{modalFilm.title}</h2>
            <p className="modal-meta">
              {modalFilm.duree}{modalFilm.genres ? ` — ${modalFilm.genres}` : ''}
            </p>
            {modalFilm.realisateur && <p className="modal-director">{modalFilm.realisateur}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
