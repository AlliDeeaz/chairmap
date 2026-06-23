import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

const API_URL = 'https://api-chairmap.rokdee.com'

const HALTESTELLEN_SOURCE_ID = 'haltestellen'
const HALTESTELLEN_LAYER_ID = 'haltestellen-layer'

const BARRIEREFREIHEIT_SOURCE_ID = 'haltestellen-barrierefreiheit'
const BARRIEREFREIHEIT_LAYER_ID = 'haltestellen-barrierefreiheit-layer'
const BARRIEREFREIHEIT_OFFSET_DEG = 0.00006

const BARRIEREFREIHEIT_COLORS = {
  ja: '#22c55e',
  eingeschraenkt: '#f59e0b',
  nein: '#ef4444',
  unbekannt: '#9ca3af'
}

const BARRIEREFREIHEIT_LABELS = {
  ja: 'Ja',
  eingeschraenkt: 'Eingeschränkt',
  nein: 'Nein',
  unbekannt: 'Unbekannt'
}

function normalizeBarrierefreiheit(value) {
  const v = (value || '').toString().toLowerCase()
  if (v === 'ja') return 'ja'
  if (v === 'nein') return 'nein'
  if (v.startsWith('eingeschr')) return 'eingeschraenkt'
  return 'unbekannt'
}

function spreadOverlappingPoints(rows) {
  const groups = new Map()
  rows.forEach(row => {
    const key = `${row.lon.toFixed(5)},${row.lat.toFixed(5)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  })

  const result = []
  groups.forEach(group => {
    const n = group.length
    group.forEach((row, i) => {
      if (n === 1) {
        result.push(row)
        return
      }
      const angle = (2 * Math.PI * i) / n
      const latRad = (row.lat * Math.PI) / 180
      const dLon = (BARRIEREFREIHEIT_OFFSET_DEG * Math.cos(angle)) / Math.cos(latRad)
      const dLat = BARRIEREFREIHEIT_OFFSET_DEG * Math.sin(angle)
      result.push({ ...row, lon: row.lon + dLon, lat: row.lat + dLat })
    })
  })
  return result
}

function renderSegmentText(text) {
  return text.split(/(Fahrtrichtung:|Ausgang)/).map((part, i) =>
    part === 'Fahrtrichtung:' || part === 'Ausgang'
      ? <strong key={i} className="fahrtrichtung-label">{part}</strong>
      : part
  )
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <polyline points="15 16 20 12 15 8" />
      <line x1="20" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function HochbahnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  )
}

function AufzugIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M10 10l2-2 2 2" />
      <path d="M10 14l2 2 2-2" />
    </svg>
  )
}

function getSegmentIcon(text) {
  if (text.includes('(U)')) return <span className="fahrtrichtung-icon-u">U</span>
  if (text.includes('(H)')) return <HochbahnIcon />
  if (/Ausgang/.test(text)) return <ExitIcon />
  return <AufzugIcon />
}

function FahrtrichtungLevels({ text }) {
  const segments = text.split(/\s*<>\s*/).filter(Boolean).reverse()

  return (
    <div className="fahrtrichtung">
      {segments.map((segment, i) => (
        <div className="fahrtrichtung-segment" key={i}>
          <span className="fahrtrichtung-icon">{getSegmentIcon(segment)}</span>
          <p>{renderSegmentText(segment)}</p>
        </div>
      ))}
    </div>
  )
}

const AUFZUG_MARKER_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M9 9l3-3 3 3" />
    <path d="M9 15l3 3 3-3" />
  </svg>
`

function createAufzugMarkerElement(aufzug) {
  const inBetrieb = aufzug.status === 'in_betrieb'
  const el = document.createElement('div')
  el.className = inBetrieb ? 'aufzug-marker aufzug-marker--ok' : 'aufzug-marker aufzug-marker--bad'
  el.innerHTML = AUFZUG_MARKER_ICON
  el.setAttribute('role', 'button')
  el.setAttribute('tabindex', '0')
  el.setAttribute('aria-label', `${aufzug.Bezeichnung}, ${inBetrieb ? 'in Betrieb' : 'außer Betrieb'}`)
  return el
}

function buildBarrierefreiheitPopup(props) {
  const el = document.createElement('div')
  el.className = 'popup-content'

  const title = document.createElement('b')
  title.textContent = props.haltestelle
  el.appendChild(title)

  el.appendChild(document.createElement('br'))

  const linie = document.createElement('span')
  linie.className = 'popup-meta'
  linie.textContent = `Linie: ${props.linie || '–'}`
  el.appendChild(linie)

  el.appendChild(document.createElement('br'))

  const status = document.createElement('span')
  status.textContent = `Barrierefreiheit: ${BARRIEREFREIHEIT_LABELS[props.status]}`
  el.appendChild(status)

  return el
}

function buildHaltestellePopup(haltestelle) {
  const el = document.createElement('div')
  el.className = 'popup-content'

  const title = document.createElement('b')
  title.textContent = haltestelle.Name
  el.appendChild(title)

  el.appendChild(document.createElement('br'))

  const linien = document.createElement('span')
  linien.className = 'popup-meta'
  linien.textContent = `Linien: ${haltestelle.Linien || '–'}`
  el.appendChild(linien)

  return el
}

function App() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const markersRef = useRef([])

  const [aufzuege, setAufzuege] = useState([])
  const [haltestellen, setHaltestellen] = useState([])
  const [barrierefreiheit, setBarrierefreiheit] = useState([])
  const [fahrtrichtungen, setFahrtrichtungen] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [mapReady, setMapReady] = useState(false)

  const [filter, setFilter] = useState('alle')
  const [showHaltestellen, setShowHaltestellen] = useState(true)
  const [showBarrierefreiheit, setShowBarrierefreiheit] = useState(true)
  const [selectedAufzug, setSelectedAufzug] = useState(null)

  useEffect(() => {
    if (!selectedAufzug) return
    const onKeyDown = e => {
      if (e.key === 'Escape') setSelectedAufzug(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedAufzug])

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/aufzuege`).then(r => r.json()),
      fetch(`${API_URL}/haltestellen`).then(r => r.json()),
      fetch(`${API_URL}/fahrtrichtungen`).then(r => r.json()),
      fetch(`${API_URL}/haltestellen-barrierefreiheit`).then(r => r.json())
    ])
      .then(([aufzuegeData, haltestellenData, fahrtrichtungenData, barrierefreiheitData]) => {
        setAufzuege(aufzuegeData)
        setHaltestellen(haltestellenData)
        setFahrtrichtungen(new Map(fahrtrichtungenData.map(f => [f.kennung, f])))
        setBarrierefreiheit(barrierefreiheitData)
      })
      .catch(() => setError('Daten konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (map.current) return
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [6.9603, 50.9333],
      zoom: 13
    })
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.current.on('load', () => setMapReady(true))
    map.current.on('click', () => setSelectedAufzug(null))
  }, [])

  useEffect(() => {
    if (!map.current || aufzuege.length === 0) return

    markersRef.current.forEach(({ marker }) => marker.remove())
    markersRef.current = []

    const visible =
      filter === 'stoerung' ? aufzuege.filter(a => a.status !== 'in_betrieb') : aufzuege

    visible.forEach(aufzug => {
      const el = createAufzugMarkerElement(aufzug)
      if (selectedAufzug?.Kennung === aufzug.Kennung) {
        el.classList.add('aufzug-marker--selected')
      }
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([aufzug.lon, aufzug.lat])
        .addTo(map.current)

      el.addEventListener('click', e => {
        e.stopPropagation()
        setSelectedAufzug(aufzug)
      })
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setSelectedAufzug(aufzug)
        }
      })

      markersRef.current.push({ marker, el, kennung: aufzug.Kennung })
    })
    // selectedAufzug only seeds the initial highlight here; the effect below keeps it
    // in sync without rebuilding every marker on each selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aufzuege, filter])

  useEffect(() => {
    markersRef.current.forEach(({ el, kennung }) => {
      el.classList.toggle('aufzug-marker--selected', selectedAufzug?.Kennung === kennung)
    })
  }, [selectedAufzug])

  useEffect(() => {
    if (!mapReady || !map.current || haltestellen.length === 0) return

    const geojson = {
      type: 'FeatureCollection',
      features: haltestellen.map(h => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
        properties: { Name: h.Name, Linien: h.Linien }
      }))
    }

    if (map.current.getSource(HALTESTELLEN_SOURCE_ID)) {
      map.current.getSource(HALTESTELLEN_SOURCE_ID).setData(geojson)
    } else {
      map.current.addSource(HALTESTELLEN_SOURCE_ID, { type: 'geojson', data: geojson })
      map.current.addLayer({
        id: HALTESTELLEN_LAYER_ID,
        type: 'circle',
        source: HALTESTELLEN_SOURCE_ID,
        paint: {
          'circle-radius': 5,
          'circle-color': '#2563eb',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      })
      map.current.on('click', HALTESTELLEN_LAYER_ID, e => {
        const feature = e.features[0]
        new maplibregl.Popup()
          .setLngLat(feature.geometry.coordinates)
          .setDOMContent(buildHaltestellePopup(feature.properties))
          .addTo(map.current)
      })
      map.current.on('mouseenter', HALTESTELLEN_LAYER_ID, () => {
        map.current.getCanvas().style.cursor = 'pointer'
      })
      map.current.on('mouseleave', HALTESTELLEN_LAYER_ID, () => {
        map.current.getCanvas().style.cursor = ''
      })
    }
  }, [mapReady, haltestellen])

  useEffect(() => {
    if (!mapReady || !map.current || !map.current.getLayer(HALTESTELLEN_LAYER_ID)) return
    map.current.setLayoutProperty(
      HALTESTELLEN_LAYER_ID,
      'visibility',
      showHaltestellen ? 'visible' : 'none'
    )
  }, [mapReady, showHaltestellen])

  useEffect(() => {
    if (!mapReady || !map.current || barrierefreiheit.length === 0) return

    const spread = spreadOverlappingPoints(barrierefreiheit)
    const geojson = {
      type: 'FeatureCollection',
      features: spread.map(row => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
        properties: {
          haltestelle: row.haltestelle,
          linie: row.linie,
          status: normalizeBarrierefreiheit(row.Barrierefreiheit)
        }
      }))
    }

    if (map.current.getSource(BARRIEREFREIHEIT_SOURCE_ID)) {
      map.current.getSource(BARRIEREFREIHEIT_SOURCE_ID).setData(geojson)
    } else {
      map.current.addSource(BARRIEREFREIHEIT_SOURCE_ID, { type: 'geojson', data: geojson })
      map.current.addLayer({
        id: BARRIEREFREIHEIT_LAYER_ID,
        type: 'circle',
        source: BARRIEREFREIHEIT_SOURCE_ID,
        paint: {
          'circle-radius': 5,
          'circle-color': [
            'match',
            ['get', 'status'],
            'ja', BARRIEREFREIHEIT_COLORS.ja,
            'eingeschraenkt', BARRIEREFREIHEIT_COLORS.eingeschraenkt,
            'nein', BARRIEREFREIHEIT_COLORS.nein,
            BARRIEREFREIHEIT_COLORS.unbekannt
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      })
      map.current.on('click', BARRIEREFREIHEIT_LAYER_ID, e => {
        const feature = e.features[0]
        new maplibregl.Popup()
          .setLngLat(feature.geometry.coordinates)
          .setDOMContent(buildBarrierefreiheitPopup(feature.properties))
          .addTo(map.current)
      })
      map.current.on('mouseenter', BARRIEREFREIHEIT_LAYER_ID, () => {
        map.current.getCanvas().style.cursor = 'pointer'
      })
      map.current.on('mouseleave', BARRIEREFREIHEIT_LAYER_ID, () => {
        map.current.getCanvas().style.cursor = ''
      })
    }
  }, [mapReady, barrierefreiheit])

  useEffect(() => {
    if (!mapReady || !map.current || !map.current.getLayer(BARRIEREFREIHEIT_LAYER_ID)) return
    map.current.setLayoutProperty(
      BARRIEREFREIHEIT_LAYER_ID,
      'visibility',
      showBarrierefreiheit ? 'visible' : 'none'
    )
  }, [mapReady, showBarrierefreiheit])

  const gestoertCount = aufzuege.filter(a => a.status !== 'in_betrieb').length
  const selectedFahrtrichtung = selectedAufzug ? fahrtrichtungen.get(selectedAufzug.Kennung) : null
  const selectedTitle = selectedFahrtrichtung
    ? `${selectedFahrtrichtung.halt} - Aufzug ${selectedFahrtrichtung.bereich}`
    : selectedAufzug?.Bezeichnung

  return (
    <div className="app">
      <header className="app-header">
        <h1>♿ ChairMap</h1>
        <p className="app-subtitle">Barrierefreie Aufzüge &amp; Haltestellen in Köln</p>
      </header>

      <div className="map-wrapper">
        <div ref={mapContainer} className="map" />

        {loading && (
          <div className="status-banner" role="status">
            Lade Daten…
          </div>
        )}
        {error && (
          <div className="status-banner status-banner--error" role="alert">
            {error}
          </div>
        )}

        <div className="control-panel" role="region" aria-label="Karten-Filter und Legende">
          <div className="control-group" role="group" aria-label="Aufzüge filtern">
            <button
              className={filter === 'alle' ? 'filter-btn active' : 'filter-btn'}
              onClick={() => setFilter('alle')}
              aria-pressed={filter === 'alle'}
            >
              Alle Aufzüge
            </button>
            <button
              className={filter === 'stoerung' ? 'filter-btn active' : 'filter-btn'}
              onClick={() => setFilter('stoerung')}
              aria-pressed={filter === 'stoerung'}
            >
              Nur Störungen ({gestoertCount})
            </button>
          </div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showHaltestellen}
              onChange={e => setShowHaltestellen(e.target.checked)}
            />
            Haltestellen anzeigen
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showBarrierefreiheit}
              onChange={e => setShowBarrierefreiheit(e.target.checked)}
            />
            Barrierefreiheit anzeigen
          </label>

          <ul className="legend">
            <li><span className="legend-dot legend-dot--ok" />Aufzug in Betrieb</li>
            <li><span className="legend-dot legend-dot--bad" />Aufzug außer Betrieb</li>
            <li><span className="legend-dot legend-dot--stop" />Haltestelle</li>
            <li><span className="legend-dot" style={{ background: BARRIEREFREIHEIT_COLORS.ja }} />Barrierefrei: ja</li>
            <li><span className="legend-dot" style={{ background: BARRIEREFREIHEIT_COLORS.eingeschraenkt }} />Barrierefrei: eingeschränkt</li>
            <li><span className="legend-dot" style={{ background: BARRIEREFREIHEIT_COLORS.nein }} />Barrierefrei: nein</li>
            <li><span className="legend-dot" style={{ background: BARRIEREFREIHEIT_COLORS.unbekannt }} />Barrierefrei: unbekannt</li>
          </ul>
        </div>

        <aside
          className={selectedAufzug ? 'aufzug-sidebar open' : 'aufzug-sidebar'}
          aria-hidden={!selectedAufzug}
          aria-label="Aufzug-Details"
        >
          {selectedAufzug && (
            <>
              <button
                className="sidebar-close"
                onClick={() => setSelectedAufzug(null)}
                aria-label="Schließen"
              >
                ×
              </button>

              <h2>{selectedTitle}</h2>

              <p className={selectedAufzug.status === 'in_betrieb' ? 'status-ok' : 'status-bad'}>
                {selectedAufzug.status === 'in_betrieb' ? 'In Betrieb' : 'Außer Betrieb'}
              </p>

              {selectedAufzug.status !== 'in_betrieb' && selectedAufzug.stoerung_seit && (
                <p className="popup-meta">
                  Gestört seit:{' '}
                  {new Date(selectedAufzug.stoerung_seit).toLocaleString('de-DE')}
                </p>
              )}

              {selectedFahrtrichtung && (
                <FahrtrichtungLevels text={selectedFahrtrichtung.beschreibung} />
              )}

              {selectedAufzug.Info && <p className="popup-meta">{selectedAufzug.Info}</p>}

              <dl className="sidebar-meta">
                <dt>Haltestellenbereich</dt>
                <dd>{selectedAufzug.Haltestellenbereich}</dd>
                <dt>Kennung</dt>
                <dd>{selectedAufzug.Kennung}</dd>
              </dl>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

export default App
