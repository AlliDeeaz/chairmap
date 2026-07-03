import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

const API_URL = 'https://api-chairmap.rokdee.com'
const GESPEICHERT_STORAGE_KEY = 'chairmap-gespeicherte-aufzuege'

const HALTESTELLEN_SOURCE_ID = 'haltestellen'
const HALTESTELLEN_LAYER_ID = 'haltestellen-layer'

const BARRIEREFREIHEIT_SOURCE_ID = 'haltestellen-barrierefreiheit'
const BARRIEREFREIHEIT_LAYER_ID = 'haltestellen-barrierefreiheit-layer'
const BARRIEREFREIHEIT_OFFSET_DEG = 0.00006

const BUS_SOURCE_ID = 'bus-haltestellen'
const BUS_LAYER_ID = 'bus-haltestellen-layer'
const BUS_LABEL_LAYER_ID = 'bus-haltestellen-label'

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

const BARRIEREFREIHEIT_RANK = { nein: 0, eingeschraenkt: 1, unbekannt: 2, ja: 3 }

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

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}

function getHaltestelleName(aufzug, gleisInfo) {
  if (gleisInfo?.haltestelle) return gleisInfo.haltestelle
  if (aufzug.haltestelle) return aufzug.haltestelle
  const match = aufzug.Bezeichnung.match(/\(([^)]+)\)/)
  return match ? match[1] : aufzug.Bezeichnung
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
  const haupttabsRef = useRef(null)
  const origBgColor = useRef(null)
  const buildingLayerIds = useRef([])
  const prev3DView = useRef(null)
  const is3DInit = useRef(true)

  const [aufzuege, setAufzuege] = useState([])
  const [haltestellen, setHaltestellen] = useState([])
  const [barrierefreiheit, setBarrierefreiheit] = useState([])
  const [fahrtrichtungen, setFahrtrichtungen] = useState(new Map())
  const [stadtbahnGleise, setStadtbahnGleise] = useState([])
  const [bereichKurzname, setBereichKurzname] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [mapReady, setMapReady] = useState(false)

  const [filter, setFilter] = useState('alle')
  const [showAufzuege, setShowAufzuege] = useState(true)
  const [showStadtbahnHaltestellen, setShowStadtbahnHaltestellen] = useState(true)
  const [showBusHaltestellen, setShowBusHaltestellen] = useState(false)
  const [selectedAufzug, setSelectedAufzug] = useState(null)

  const [listOpen, setListOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [layerSectionOpen, setLayerSectionOpen] = useState(window.innerWidth >= 601)
  const [helpOpen, setHelpOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [showSatellite, setShowSatellite] = useState(false)
  const [show3DBuildings, setShow3DBuildings] = useState(true)
  const [showHelpPopup, setShowHelpPopup] = useState(
    () => !localStorage.getItem('chairmap-onboarding-seen')
  )

  function closeHelpPopup(permanent) {
    setShowHelpPopup(false)
    if (permanent) localStorage.setItem('chairmap-onboarding-seen', '1')
  }
  const [mainTab, setMainTab] = useState('aufzuege')
  const [aufzugSubTab, setAufzugSubTab] = useState('alle')
  const [suchtext, setSuchtext] = useState('')
  const [haupttabsScrollable, setHaupttabsScrollable] = useState(false)
  const [gespeichert, setGespeichert] = useState(() => {
    try {
      const raw = localStorage.getItem(GESPEICHERT_STORAGE_KEY)
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(GESPEICHERT_STORAGE_KEY, JSON.stringify([...gespeichert]))
    } catch {
      // localStorage nicht verfuegbar (z.B. privater Modus) - Favoriten bleiben nur fuer die Sitzung
    }
  }, [gespeichert])

  function toggleGespeichert(kennung) {
    setGespeichert(prev => {
      const next = new Set(prev)
      if (next.has(kennung)) next.delete(kennung)
      else next.add(kennung)
      return next
    })
  }

  useEffect(() => {
    if (!selectedAufzug) return
    const onKeyDown = e => {
      if (e.key === 'Escape') setSelectedAufzug(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedAufzug])

  useEffect(() => {
    if (!showHelpPopup) return
    const onKeyDown = e => {
      if (e.key === 'Escape') closeHelpPopup(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showHelpPopup])

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
        setLastUpdated(new Date())
      })
      .catch(() => setError('Daten konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [])

  function refreshAufzuege() {
    if (refreshing) return
    setRefreshing(true)
    fetch(`${API_URL}/aufzuege`)
      .then(r => r.json())
      .then(data => {
        setAufzuege(data)
        setLastUpdated(new Date())
      })
      .catch(() => setError('Aufzüge konnten nicht aktualisiert werden.'))
      .finally(() => setRefreshing(false))
  }

  useEffect(() => {
    // Eigene, fehlertolerante Fetches: der /stadtbahn-gleise Endpoint ist optional
    // (muss serverseitig erst angelegt werden) und soll die uebrige App nicht blockieren.
    fetch(`${API_URL}/stadtbahn-gleise`)
      .then(r => (r.ok ? r.json() : []))
      .then(data => setStadtbahnGleise(Array.isArray(data) ? data : []))
      .catch(() => setStadtbahnGleise([]))

    fetch('/haltestellenbereiche-kurzname.json')
      .then(r => (r.ok ? r.json() : {}))
      .then(data => setBereichKurzname(data && typeof data === 'object' ? data : {}))
      .catch(() => setBereichKurzname({}))
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
    map.current.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: true,
        showUserHeading: true
      }),
      'top-right'
    )
    map.current.on('load', () => setMapReady(true))
    map.current.on('click', () => setSelectedAufzug(null))
  }, [])

  useEffect(() => {
    if (!map.current || aufzuege.length === 0) return

    markersRef.current.forEach(({ marker }) => marker.remove())
    markersRef.current = []

    if (!showAufzuege) return

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
  }, [aufzuege, filter, showAufzuege])

  useEffect(() => {
    markersRef.current.forEach(({ el, kennung }) => {
      el.classList.toggle('aufzug-marker--selected', selectedAufzug?.Kennung === kennung)
    })
  }, [selectedAufzug])

  useEffect(() => {
    if (!mapReady || !map.current) return
    origBgColor.current = map.current.getPaintProperty('background', 'background-color')
    buildingLayerIds.current = map.current.getStyle().layers
      .filter(l => l.type === 'fill-extrusion')
      .map(l => l.id)
    map.current.addSource('satellite-source', {
      type: 'raster',
      tiles: ['https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=dRgWDG2iVEnaZFJ4hRoW'],
      tileSize: 256,
      maxzoom: 20,
      attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a>'
    })
    const firstLayerId = map.current.getStyle().layers[0]?.id
    map.current.addLayer({
      id: 'satellite-layer',
      type: 'raster',
      source: 'satellite-source',
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 1 }
    }, firstLayerId)
  }, [mapReady])

  useEffect(() => {
    if (!mapReady || !map.current || !map.current.getLayer('satellite-layer')) return
    map.current.setLayoutProperty('satellite-layer', 'visibility', showSatellite ? 'visible' : 'none')
    if (showSatellite) {
      map.current.setPaintProperty('background', 'background-color', 'rgba(0,0,0,0)')
    } else {
      map.current.setPaintProperty('background', 'background-color', origBgColor.current || '#f9f5ed')
    }
  }, [showSatellite, mapReady])

  useEffect(() => {
    if (!mapReady || !map.current) return
    buildingLayerIds.current.forEach(id => {
      if (map.current.getLayer(id)) {
        map.current.setLayoutProperty(id, 'visibility', show3DBuildings ? 'visible' : 'none')
      }
    })
    if (is3DInit.current) {
      is3DInit.current = false
      return
    }
    if (show3DBuildings) {
      prev3DView.current = {
        pitch: map.current.getPitch(),
        bearing: map.current.getBearing(),
      }
      map.current.easeTo({ pitch: 55, bearing: 20, duration: 900 })
    } else {
      map.current.easeTo({
        pitch: prev3DView.current?.pitch ?? 0,
        bearing: prev3DView.current?.bearing ?? 0,
        duration: 700,
      })
    }
  }, [show3DBuildings, mapReady])

  useEffect(() => {
    const busStops = haltestellen.filter(h => h.Betriebsbereich !== 'STRAB')
    if (!mapReady || !map.current || busStops.length === 0) return

    const geojson = {
      type: 'FeatureCollection',
      features: busStops.map(h => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
        properties: { Name: h.Name, Linien: h.Linien }
      }))
    }

    if (map.current.getSource(BUS_SOURCE_ID)) {
      map.current.getSource(BUS_SOURCE_ID).setData(geojson)
    } else {
      map.current.addSource(BUS_SOURCE_ID, { type: 'geojson', data: geojson })
      map.current.addLayer({
        id: BUS_LAYER_ID,
        type: 'circle',
        source: BUS_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 5,
          'circle-color': '#7c3aed',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      })
      map.current.addLayer({
        id: BUS_LABEL_LAYER_ID,
        type: 'symbol',
        source: BUS_SOURCE_ID,
        layout: {
          visibility: 'none',
          'text-field': 'B',
          'text-size': 8,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: { 'text-color': '#ffffff' }
      })
      map.current.on('click', BUS_LAYER_ID, e => {
        const feature = e.features[0]
        new maplibregl.Popup()
          .setLngLat(feature.geometry.coordinates)
          .setDOMContent(buildHaltestellePopup(feature.properties))
          .addTo(map.current)
      })
      map.current.on('mouseenter', BUS_LAYER_ID, () => {
        map.current.getCanvas().style.cursor = 'pointer'
      })
      map.current.on('mouseleave', BUS_LAYER_ID, () => {
        map.current.getCanvas().style.cursor = ''
      })
    }
  }, [mapReady, haltestellen])

  useEffect(() => {
    if (!mapReady || !map.current || !map.current.getLayer(BUS_LAYER_ID)) return
    const vis = showBusHaltestellen ? 'visible' : 'none'
    map.current.setLayoutProperty(BUS_LAYER_ID, 'visibility', vis)
    if (map.current.getLayer(BUS_LABEL_LAYER_ID)) {
      map.current.setLayoutProperty(BUS_LABEL_LAYER_ID, 'visibility', vis)
    }
  }, [mapReady, showBusHaltestellen])

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
      showStadtbahnHaltestellen ? 'visible' : 'none'
    )
  }, [mapReady, showStadtbahnHaltestellen])

  const gestoertCount = aufzuege.filter(a => a.status !== 'in_betrieb').length
  const selectedFahrtrichtung = selectedAufzug ? fahrtrichtungen.get(selectedAufzug.Kennung) : null
  const selectedTitle = selectedFahrtrichtung
    ? `${selectedFahrtrichtung.halt} - Aufzug ${selectedFahrtrichtung.bereich}`
    : selectedAufzug?.Bezeichnung

  const gleiseByKurzname = useMemo(() => {
    const map = new Map()
    stadtbahnGleise.forEach(row => {
      if (!map.has(row.Kurzname)) {
        map.set(row.Kurzname, { haltestelle: row.Haltestelle, linien: new Set() })
      }
      if (row.Linie) map.get(row.Kurzname).linien.add(row.Linie)
    })
    return map
  }, [stadtbahnGleise])

  const aufzuegeListe = useMemo(() => {
    return aufzuege.map(a => {
      const kurzname = bereichKurzname[a.Haltestellenbereich]
      const gleisInfo = kurzname ? gleiseByKurzname.get(kurzname) : null
      const linien = gleisInfo ? [...gleisInfo.linien].sort((x, y) => Number(x) - Number(y)) : []
      const fahrtrichtungText = fahrtrichtungen.get(a.Kennung)?.beschreibung || null
      return { ...a, haltestelleName: getHaltestelleName(a, gleisInfo), linien, fahrtrichtungText }
    })
  }, [aufzuege, bereichKurzname, gleiseByKurzname, fahrtrichtungen])

  const aufzuegeGefiltert = useMemo(() => {
    const q = suchtext.trim().toLowerCase()
    if (!q) return aufzuegeListe
    return aufzuegeListe.filter(a => a.haltestelleName.toLowerCase().includes(q))
  }, [aufzuegeListe, suchtext])

  const aufzugSubTabCounts = {
    alle: aufzuegeGefiltert.length,
    stoerungen: aufzuegeGefiltert.filter(a => a.status !== 'in_betrieb').length,
    gespeichert: aufzuegeGefiltert.filter(a => gespeichert.has(a.Kennung)).length
  }

  const listeNachTab = {
    alle: aufzuegeGefiltert,
    stoerungen: aufzuegeGefiltert.filter(a => a.status !== 'in_betrieb'),
    gespeichert: aufzuegeGefiltert.filter(a => gespeichert.has(a.Kennung))
  }[aufzugSubTab]

  const kurznameCoords = useMemo(() => {
    const map = new Map()
    haltestellen.forEach(h => {
      if (h.Kurzname) map.set(h.Kurzname, { lon: h.lon, lat: h.lat })
    })
    return map
  }, [haltestellen])

  const aufzuegeByKurzname = useMemo(() => {
    const map = new Map()
    aufzuege.forEach(a => {
      const kurzname = bereichKurzname[a.Haltestellenbereich]
      if (!kurzname) return
      if (!map.has(kurzname)) map.set(kurzname, [])
      map.get(kurzname).push(a)
    })
    return map
  }, [aufzuege, bereichKurzname])

  const haltestellenListe = useMemo(() => {
    const map = new Map()
    stadtbahnGleise.forEach(row => {
      if (!map.has(row.Kurzname)) {
        map.set(row.Kurzname, {
          kurzname: row.Kurzname,
          haltestelle: row.Haltestelle,
          linien: new Set(),
          ebenen: new Set(),
          barrierefreiheitWerte: new Set(),
          hatAufzugLautStammdaten: false
        })
      }
      const entry = map.get(row.Kurzname)
      if (row.Linie) entry.linien.add(row.Linie)
      if (row.Ebene) entry.ebenen.add(row.Ebene)
      if (row.Barrierefreiheit) entry.barrierefreiheitWerte.add(normalizeBarrierefreiheit(row.Barrierefreiheit))
      if (row.Aufzug === 'JA') entry.hatAufzugLautStammdaten = true
    })

    return [...map.values()]
      .map(entry => {
        const coords = kurznameCoords.get(entry.kurzname)
        const liveAufzuege = aufzuegeByKurzname.get(entry.kurzname) || []
        const barrierefreiheitSorted = [...entry.barrierefreiheitWerte].sort(
          (a, b) => BARRIEREFREIHEIT_RANK[a] - BARRIEREFREIHEIT_RANK[b]
        )
        return {
          kurzname: entry.kurzname,
          haltestelle: entry.haltestelle,
          linien: [...entry.linien].sort((a, b) => Number(a) - Number(b)),
          ebenen: [...entry.ebenen],
          barrierefreiheit: barrierefreiheitSorted[0] || 'unbekannt',
          barrierefreiheitVariiert: barrierefreiheitSorted.length > 1,
          hatAufzugLautStammdaten: entry.hatAufzugLautStammdaten,
          liveAufzuege,
          lon: coords?.lon,
          lat: coords?.lat
        }
      })
      .sort((a, b) => a.haltestelle.localeCompare(b.haltestelle, 'de'))
  }, [stadtbahnGleise, kurznameCoords, aufzuegeByKurzname])

  const haltestellenGefiltert = useMemo(() => {
    const q = suchtext.trim().toLowerCase()
    if (!q) return haltestellenListe
    return haltestellenListe.filter(h => h.haltestelle.toLowerCase().includes(q))
  }, [haltestellenListe, suchtext])

  function selectHaltestelleFromList(h) {
    setListOpen(false)
    if (h.liveAufzuege.length > 0) {
      setSelectedAufzug(h.liveAufzuege[0])
    }
    if (map.current && h.lon != null && h.lat != null) {
      map.current.flyTo({ center: [h.lon, h.lat], zoom: Math.max(map.current.getZoom(), 16) })
    }
  }

  useEffect(() => {
    function checkHaupttabsOverflow() {
      const el = haupttabsRef.current
      if (!el) return
      setHaupttabsScrollable(el.scrollWidth > el.clientWidth + 1)
    }
    checkHaupttabsOverflow()
    window.addEventListener('resize', checkHaupttabsOverflow)
    return () => window.removeEventListener('resize', checkHaupttabsOverflow)
  }, [])

  function scrollHaupttabsRight() {
    haupttabsRef.current?.scrollBy({ left: 140, behavior: 'smooth' })
  }

  function selectFromList(aufzug) {
    setSelectedAufzug(aufzug)
    setListOpen(false)
    if (map.current) {
      map.current.flyTo({ center: [aufzug.lon, aufzug.lat], zoom: Math.max(map.current.getZoom(), 15) })
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>♿ ChairMap</h1>
        <p className="app-subtitle">Routenplanung für ein barrierefreies Köln</p>
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

        {!panelOpen && (
          <button
            className="panel-fab"
            onClick={() => setPanelOpen(true)}
            aria-label="Menü öffnen"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        )}

        <div className={`control-panel${panelOpen ? '' : ' panel-hidden'}`} role="region" aria-label="Karten-Steuerung">

          {/* Panel close – mobile only */}
          <button className="panel-close-btn" onClick={() => setPanelOpen(false)} aria-label="Menü schließen">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            <span>Menü</span>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginLeft:'auto'}}>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          {/* Liste / List View */}
          <button
            className="list-view-btn"
            onClick={() => setListOpen(open => !open)}
            aria-expanded={listOpen}
          >
            <ListIcon />
            <span>Liste</span>
            <svg className="list-view-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>

          {/* Kartenlayer – collapsible on mobile */}
          <button
            className="layer-section-header"
            onClick={() => setLayerSectionOpen(v => !v)}
            aria-expanded={layerSectionOpen}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
            <span>Kartenlayer</span>
            <svg className={`layer-section-arrow${layerSectionOpen ? ' open' : ''}`} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          <div className={`layer-groups${layerSectionOpen ? ' open' : ''}`}>

          {/* Satellit */}
          <div className="layer-group layer-group--satellite">
            <div className="layer-row">
              <span className="layer-icon-wrap">🛰️</span>
              <span className="layer-label">Satellit</span>
              <button
                className={`layer-toggle${showSatellite ? ' layer-toggle--on' : ''}`}
                role="switch"
                aria-checked={showSatellite}
                aria-label="Satellitenbild ein-/ausblenden"
                onClick={() => setShowSatellite(v => !v)}
              />
            </div>
          </div>

          {/* 3D Gebäude */}
          <div className="layer-group">
            <div className="layer-row">
              <span className="layer-icon-wrap">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </span>
              <span className="layer-label">3D-Gebäude</span>
              <button
                className={`layer-toggle${show3DBuildings ? ' layer-toggle--on' : ''}`}
                role="switch"
                aria-checked={show3DBuildings}
                aria-label="3D-Gebäude ein-/ausblenden"
                onClick={() => setShow3DBuildings(v => !v)}
              />
            </div>
          </div>

          {/* Aufzüge */}
          <div className="layer-group">
            <div className="layer-row">
              <span className="layer-icon-wrap">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 9l3-3 3 3"/><path d="M9 15l3 3 3-3"/></svg>
              </span>
              <span className="layer-label">Aufzüge</span>
              <button
                className={`layer-toggle${showAufzuege ? ' layer-toggle--on' : ''}`}
                role="switch"
                aria-checked={showAufzuege}
                aria-label="Aufzüge ein-/ausblenden"
                onClick={() => setShowAufzuege(v => !v)}
              />
            </div>
            {showAufzuege && (
              <>
                <div className="layer-sub">
                  <button
                    className={`layer-filter-btn${filter === 'alle' ? ' active' : ''}`}
                    onClick={() => setFilter('alle')}
                    aria-pressed={filter === 'alle'}
                  >Alle</button>
                  <button
                    className={`layer-filter-btn${filter === 'stoerung' ? ' active' : ''}`}
                    onClick={() => setFilter('stoerung')}
                    aria-pressed={filter === 'stoerung'}
                  >Störungen ({gestoertCount})</button>
                </div>
                <div className="refresh-row">
                  <button
                    className={`refresh-btn${refreshing ? ' refresh-btn--spinning' : ''}`}
                    onClick={refreshAufzuege}
                    disabled={refreshing}
                    aria-label="Aufzüge aktualisieren"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10"/>
                      <path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
                    </svg>
                  </button>
                  <span className="last-updated">
                    {refreshing
                      ? 'Aktualisieren…'
                      : lastUpdated
                        ? `Zuletzt: ${lastUpdated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
                        : ''}
                  </span>
                </div>
                <div className="layer-legend-row">
                  <span className="layer-legend-item"><span className="legend-dot legend-dot--ok" />In Betrieb</span>
                  <span className="layer-legend-item"><span className="legend-dot legend-dot--bad" />Außer Betrieb</span>
                </div>
              </>
            )}
          </div>

          {/* Rolltreppen – demnächst */}
          <div className="layer-group">
            <div className="layer-row layer-row--disabled">
              <span className="layer-icon-wrap">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l4-4 4 4 4-4 4-4"/><path d="M4 7l3 3"/></svg>
              </span>
              <span className="layer-label">Rolltreppen <span className="layer-soon">demnächst</span></span>
              <button className="layer-toggle" role="switch" aria-checked={false} disabled />
            </div>
          </div>

          {/* Stadtbahn-Haltestellen */}
          <div className="layer-group">
            <div className="layer-row">
              <span className="layer-icon-wrap">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M3 10h18"/><path d="M8 17l-1.5 2"/><path d="M16 17l1.5 2"/></svg>
              </span>
              <span className="layer-label">Stadtbahn-Haltestellen</span>
              <button
                className={`layer-toggle${showStadtbahnHaltestellen ? ' layer-toggle--on' : ''}`}
                role="switch"
                aria-checked={showStadtbahnHaltestellen}
                aria-label="Stadtbahn-Haltestellen ein-/ausblenden"
                onClick={() => setShowStadtbahnHaltestellen(v => !v)}
              />
            </div>
            {showStadtbahnHaltestellen && (
              <div className="layer-legend-row">
                <span className="layer-legend-item"><span className="legend-dot" style={{ background: BARRIEREFREIHEIT_COLORS.ja }} />Barrierefrei</span>
                <span className="layer-legend-item"><span className="legend-dot" style={{ background: BARRIEREFREIHEIT_COLORS.eingeschraenkt }} />Eingeschränkt</span>
                <span className="layer-legend-item"><span className="legend-dot" style={{ background: BARRIEREFREIHEIT_COLORS.nein }} />Nicht barrierefrei</span>
                <span className="layer-legend-item"><span className="legend-dot" style={{ background: BARRIEREFREIHEIT_COLORS.unbekannt }} />Unbekannt</span>
              </div>
            )}
          </div>

          {/* Bus-Haltestellen */}
          <div className="layer-group">
            <div className="layer-row">
              <span className="layer-icon-wrap">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M8 17l-1.5 2"/><path d="M16 17l1.5 2"/><circle cx="7.5" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14" r="1" fill="currentColor" stroke="none"/></svg>
              </span>
              <span className="layer-label">Bus-Haltestellen</span>
              <button
                className={`layer-toggle${showBusHaltestellen ? ' layer-toggle--on' : ''}`}
                role="switch"
                aria-checked={showBusHaltestellen}
                aria-label="Bus-Haltestellen ein-/ausblenden"
                onClick={() => setShowBusHaltestellen(v => !v)}
              />
            </div>
            {showBusHaltestellen && (
              <div className="layer-legend-row">
                <span className="layer-legend-item"><span className="legend-dot" style={{ background: '#7c3aed' }} />Bushaltestelle</span>
              </div>
            )}
          </div>

            <button className="layer-collapse-btn" onClick={() => setLayerSectionOpen(false)}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 15l-6-6-6 6"/>
              </svg>
              Einklappen
            </button>

          </div>{/* end layer-groups */}

          {/* Anleitung – collapsible on all screen sizes */}
          <button
            className="help-header"
            onClick={() => setHelpOpen(v => !v)}
            aria-expanded={helpOpen}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>Anleitung</span>
            <svg className={`help-arrow${helpOpen ? ' open' : ''}`} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {helpOpen && (
            <div className="help-groups">

              <div className="help-section">
                <p className="help-section-title">Karte bedienen</p>
                <dl className="help-list">
                  <div className="help-row"><dt>Standort</dt><dd>Icon rechts auf der Karte</dd></div>
                  <div className="help-row"><dt>Bewegen</dt><dd>1-Finger-Drag · Linksklick+Drag</dd></div>
                  <div className="help-row"><dt>Zoomen</dt><dd>Pinch · Mausrad · +/− Buttons</dd></div>
                  <div className="help-row"><dt>3D-Ansicht</dt><dd>2-Finger hoch/runter · Rechtsklick+Drag</dd></div>
                  <div className="help-row"><dt>Drehen</dt><dd>2-Finger rotieren · Rechtsklick seitlich</dd></div>
                  <div className="help-row"><dt>Reset</dt><dd>Kompassnadel oben rechts tippen</dd></div>
                </dl>
              </div>

              <div className="help-section">
                <p className="help-section-title">Marker & Details</p>
                <dl className="help-list">
                  <div className="help-row">
                    <dt><span className="legend-dot legend-dot--ok" style={{display:'inline-block',marginRight:2}}/><span className="legend-dot legend-dot--bad" style={{display:'inline-block'}}/> Marker</dt>
                    <dd>Tippen → Aufzug-Details öffnen</dd>
                  </div>
                  <div className="help-row"><dt>Haltestelle</dt><dd>Farbigen Punkt tippen</dd></div>
                  <div className="help-row"><dt>Schließen</dt><dd>× oben rechts in der Sidebar</dd></div>
                </dl>
              </div>

              <div className="help-section">
                <p className="help-section-title">Layer & Filter</p>
                <dl className="help-list">
                  <div className="help-row"><dt>Satellitenansicht</dt><dd>Schalter neben „Satellit"</dd></div>
                  <div className="help-row"><dt>3D-Ansicht</dt><dd>Schalter neben „3D-Gebäude"</dd></div>
                  <div className="help-row"><dt>Alle Aufzüge</dt><dd>Aufzüge → „Alle"-Button</dd></div>
                  <div className="help-row"><dt>Aufzugsstörungen</dt><dd>Aufzüge → „Störungen"-Button</dd></div>
                  <div className="help-row"><dt>Rolltreppen</dt><dd>Demnächst verfügbar</dd></div>
                  <div className="help-row"><dt>Stadtbahn-HST</dt><dd>Haltestellen mit Barrierefreiheitsstatus</dd></div>
                  <div className="help-row"><dt>Bus-HST</dt><dd>Bushaltestellen ein-/ausblenden</dd></div>
                  <div className="help-row"><dt>Liste</dt><dd>Blauer „Liste"-Button links unten</dd></div>
                </dl>
              </div>

            </div>
          )}

        </div>{/* end control-panel */}

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

        <aside
          className={listOpen ? 'aufzug-liste open' : 'aufzug-liste'}
          aria-hidden={!listOpen}
          aria-label="Aufzug-Liste"
        >
          <button className="liste-close" onClick={() => setListOpen(false)} aria-label="Schließen">×</button>

          <input
            type="search"
            className="liste-suche"
            placeholder="Haltestelle suchen…"
            value={suchtext}
            onChange={e => setSuchtext(e.target.value)}
            aria-label="Haltestelle suchen"
          />

          <div className="haupttabs-wrapper">
            <div className="haupttabs" role="tablist" aria-label="Hauptkategorien" ref={haupttabsRef}>
              <button
                role="tab"
                aria-selected={mainTab === 'aufzuege'}
                className={mainTab === 'aufzuege' ? 'haupttab active' : 'haupttab'}
                onClick={() => setMainTab('aufzuege')}
              >
                KVB Aufzüge
              </button>
              <button
                role="tab"
                aria-selected={mainTab === 'stationen'}
                className={mainTab === 'stationen' ? 'haupttab active' : 'haupttab'}
                onClick={() => setMainTab('stationen')}
              >
                KVB Stations
              </button>
            </div>
            {haupttabsScrollable && (
              <button
                className="liste-tabs-scroll-hint"
                aria-label="Weitere Tabs anzeigen"
                onClick={scrollHaupttabsRight}
              >
                ›
              </button>
            )}
          </div>

          {mainTab === 'aufzuege' && (
            <div className="liste-tabs" role="tablist" aria-label="Aufzug-Unterkategorien">
              <button
                role="tab"
                aria-selected={aufzugSubTab === 'alle'}
                className={aufzugSubTab === 'alle' ? 'liste-tab active' : 'liste-tab'}
                onClick={() => setAufzugSubTab('alle')}
              >
                Alle ({aufzugSubTabCounts.alle})
              </button>
              <button
                role="tab"
                aria-selected={aufzugSubTab === 'stoerungen'}
                className={aufzugSubTab === 'stoerungen' ? 'liste-tab active' : 'liste-tab'}
                onClick={() => setAufzugSubTab('stoerungen')}
              >
                Störungen ({aufzugSubTabCounts.stoerungen})
              </button>
              <button
                role="tab"
                aria-selected={aufzugSubTab === 'gespeichert'}
                className={aufzugSubTab === 'gespeichert' ? 'liste-tab active' : 'liste-tab'}
                onClick={() => setAufzugSubTab('gespeichert')}
              >
                Gespeichert ({aufzugSubTabCounts.gespeichert})
              </button>
            </div>
          )}

          <div className="liste-refresh-row">
            <span className="last-updated">
              {refreshing
                ? 'Aktualisieren…'
                : lastUpdated
                  ? `Zuletzt: ${lastUpdated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
                  : ''}
            </span>
            <button
              className={`refresh-btn${refreshing ? ' refresh-btn--spinning' : ''}`}
              onClick={refreshAufzuege}
              disabled={refreshing}
              aria-label="Aufzüge aktualisieren"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
              </svg>
            </button>
          </div>

          {mainTab === 'stationen' ? (
            <ul className="aufzug-liste-items">
              {haltestellenGefiltert.length === 0 && (
                <li className="aufzug-liste-empty">Keine Haltestelle gefunden.</li>
              )}
              {haltestellenGefiltert.map(h => {
                const hatStoerung = h.liveAufzuege.some(a => a.status !== 'in_betrieb')
                return (
                  <li key={h.kurzname} className="aufzug-liste-item">
                    <button className="aufzug-liste-item-main" onClick={() => selectHaltestelleFromList(h)}>
                      <span
                        className="legend-dot"
                        style={{ background: BARRIEREFREIHEIT_COLORS[h.barrierefreiheit] }}
                      />
                      <span className="aufzug-liste-item-text">
                        <strong>{h.haltestelle}</strong>
                        {h.linien.length > 0 && <span className="popup-meta"> · Linie {h.linien.join(', ')}</span>}
                        {h.ebenen.length > 0 && <span className="popup-meta"> · {h.ebenen.join('/')}</span>}
                        <span className="aufzug-liste-item-richtung">
                          {h.liveAufzuege.length > 0 ? (
                            <>
                              <span className={hatStoerung ? 'legend-dot legend-dot--bad' : 'legend-dot legend-dot--ok'} />
                              {h.liveAufzuege.length} {h.liveAufzuege.length > 1 ? 'Aufzüge' : 'Aufzug'}
                              {hatStoerung ? ' · Störung' : ''}
                            </>
                          ) : h.hatAufzugLautStammdaten ? (
                            'Aufzug vorhanden'
                          ) : (
                            'Kein Aufzug'
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <ul className="aufzug-liste-items">
              {listeNachTab.length === 0 && (
                <li className="aufzug-liste-empty">
                  {aufzugSubTab === 'gespeichert' ? 'Noch keine Aufzüge gespeichert.' : 'Keine Einträge.'}
                </li>
              )}
              {listeNachTab.map(a => (
                <li key={a.Kennung} className="aufzug-liste-item">
                  <button className="aufzug-liste-item-main" onClick={() => selectFromList(a)}>
                    <span className={a.status === 'in_betrieb' ? 'legend-dot legend-dot--ok' : 'legend-dot legend-dot--bad'} />
                    <span className="aufzug-liste-item-text">
                      <strong>{a.haltestelleName}</strong>
                      {a.linien.length > 0 && <span className="popup-meta"> · Linie {a.linien.join(', ')}</span>}
                      {a.fahrtrichtungText && (
                        <span className="aufzug-liste-item-richtung">
                          {getSegmentIcon(a.fahrtrichtungText)}
                          {renderSegmentText(a.fahrtrichtungText.replace(/\s*<>\s*/g, ' → '))}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    className="star-btn"
                    onClick={() => toggleGespeichert(a.Kennung)}
                    aria-pressed={gespeichert.has(a.Kennung)}
                    aria-label={gespeichert.has(a.Kennung) ? 'Aus Gespeichert entfernen' : 'Aufzug merken'}
                  >
                    {gespeichert.has(a.Kennung) ? '★' : '☆'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {showHelpPopup && (
        <div className="onboarding-backdrop" onClick={() => closeHelpPopup(false)}>
          <div className="onboarding-modal" onClick={e => e.stopPropagation()}>
            <button className="onboarding-close" onClick={() => closeHelpPopup(false)} aria-label="Schließen">×</button>
            <h2 className="onboarding-title">Willkommen bei ChairMap ♿</h2>
            <p className="onboarding-subtitle">Barrierefreie Aufzüge &amp; Haltestellen der KVB in Köln</p>

            <div className="help-groups onboarding-help">
              <div className="help-section">
                <p className="help-section-title">Karte bedienen</p>
                <dl className="help-list">
                  <div className="help-row"><dt>Standort</dt><dd>Icon rechts auf der Karte</dd></div>
                  <div className="help-row"><dt>Bewegen</dt><dd>1-Finger-Drag · Linksklick+Drag</dd></div>
                  <div className="help-row"><dt>Zoomen</dt><dd>Pinch · Mausrad · +/− Buttons</dd></div>
                  <div className="help-row"><dt>3D-Ansicht</dt><dd>2-Finger hoch/runter · Rechtsklick+Drag</dd></div>
                  <div className="help-row"><dt>Drehen</dt><dd>2-Finger rotieren · Rechtsklick seitlich</dd></div>
                  <div className="help-row"><dt>Reset</dt><dd>Kompassnadel oben rechts tippen</dd></div>
                </dl>
              </div>
              <div className="help-section">
                <p className="help-section-title">Marker &amp; Details</p>
                <dl className="help-list">
                  <div className="help-row">
                    <dt><span className="legend-dot legend-dot--ok" style={{display:'inline-block',marginRight:2}}/><span className="legend-dot legend-dot--bad" style={{display:'inline-block'}}/> Marker</dt>
                    <dd>Tippen → Aufzug-Details öffnen</dd>
                  </div>
                  <div className="help-row"><dt>Haltestelle</dt><dd>Farbigen Punkt tippen</dd></div>
                  <div className="help-row"><dt>Schließen</dt><dd>× oben rechts in der Sidebar</dd></div>
                </dl>
              </div>
              <div className="help-section">
                <p className="help-section-title">Layer &amp; Filter</p>
                <dl className="help-list">
                  <div className="help-row"><dt>Satellitenansicht</dt><dd>Schalter neben „Satellit"</dd></div>
                  <div className="help-row"><dt>3D-Ansicht</dt><dd>Schalter neben „3D-Gebäude"</dd></div>
                  <div className="help-row"><dt>Alle Aufzüge</dt><dd>Aufzüge → „Alle"-Button</dd></div>
                  <div className="help-row"><dt>Aufzugsstörungen</dt><dd>Aufzüge → „Störungen"-Button</dd></div>
                  <div className="help-row"><dt>Rolltreppen</dt><dd>Demnächst verfügbar</dd></div>
                  <div className="help-row"><dt>Stadtbahn-HST</dt><dd>Haltestellen mit Barrierefreiheitsstatus</dd></div>
                  <div className="help-row"><dt>Bus-HST</dt><dd>Bushaltestellen ein-/ausblenden</dd></div>
                  <div className="help-row"><dt>Liste</dt><dd>Blauer „Liste"-Button links unten</dd></div>
                </dl>
              </div>
            </div>

            <div className="onboarding-footer">
              <button className="onboarding-skip" onClick={() => closeHelpPopup(false)}>Schließen</button>
              <button className="onboarding-confirm" onClick={() => closeHelpPopup(true)}>Nicht mehr anzeigen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
