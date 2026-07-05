# ChairMap – Projekt-Infrastruktur & Ist-Zustand
> Letzte Aktualisierung: Juli 2026  
> Autor: Chris Falck (rokdee / AlliDeeaz)  
> Zweck: Single Source of Truth für alle Claude-Instanzen, VS Code Claude Code, und zukünftige Chats

---

## 1. Infrastruktur-Übersicht

| Gerät / Container | IP | Port | Dienst | Öffentlich erreichbar |
|---|---|---|---|---|
| Proxmox Host (UM270) | 192.168.0.164 | 8006 | Proxmox VE | Nein |
| Proxmox Host (UM270) | 192.168.0.164 | 445 | SMB Freigabe | Nein |
| CT 101 (pihole) | 192.168.0.244 | 80 | Pi-hole DNS/DHCP | Nein |
| CT 102 (superset) | 192.168.0.171 | 8088 | Apache Superset | superset.rokdee.com |
| CT 102 (superset) | 192.168.0.171 | 8089 | ChairMap FastAPI | api-chairmap.rokdee.com |
| CT 103 (docker) | 192.168.0.72 | 9443 | Portainer | Nein |
| CT 103 (docker) | 192.168.0.72 | 8080 | nginx / ChairMap Frontend | chairmap.rokdee.com |
| IONOS FTP | — | — | Landing Page | rokdee.com/chairmap/ |
| IONOS FTP | — | — | Linksammlung | rokdee.com/chairmap/links |
| CT 104 (superchair) | 192.168.0.104 | 5432 | PostgreSQL 17 + PostGIS 3.5 | Nein |
| VM 100 (homeassistant) | 192.168.0.189 | 8123 | Home Assistant | Nein |
| VM 100 (homeassistant) | 192.168.0.189 | 8099 | Nextcloud | Nein |
| Mac Mini | 192.168.0.50 | — | Entwicklung | Nein |
| Mac Mini | 192.168.0.50 | 445 | SMB Freigabe | Nein |
| Mac Mini (lokal) | localhost | 5173 | Vite Dev-Server (npm run dev) | Nur lokal |

### IONOS – Statische Seiten
- Host: `home98589031.1and1-data.host`
- User: `p36165879`
- Protokoll: SFTP
- Pfad: `/wordpress/chairmap/`

| Datei | URL |
|---|---|
| `index.html` | rokdee.com/chairmap/ |
| `links.html` | rokdee.com/chairmap/links |

Lokale Quelle: `/Volumes/2TB/_backup/_Projekte/Linksammlungen/Links4ChairMap_3.html` → Upload als `links.html`

### Cloudflare Tunnel
- Tunnel-ID: `9a1cb691-a474-459c-9bb0-71084dbf3b7d`
- Config: `/etc/cloudflared/config.yml` auf CT 102
- Service: `systemctl status cloudflared` auf CT 102
- DNS: Domain `rokdee.com` bei IONOS, Nameserver zeigen auf Cloudflare

---

## 2. CT 102 – Superset + FastAPI

### Superset
- URL: `https://superset.rokdee.com`
- Läuft in venv: `/opt/superset/venv/`
- Service starten: `source /opt/superset/venv/bin/activate`
- Datenbank-Verbindung in Superset: **"KVB-Daten"** (SQLite → wird zu PostgreSQL migriert)

### FastAPI (ChairMap API)
- Datei: `/root/chairmap_api.py`
- Auch lokal: `~/chairmap/server/chairmap_api.py`
- Service: `chairmap-api.service` → `systemctl restart chairmap-api`
- Port: 8089
- Swagger UI: `https://api-chairmap.rokdee.com/docs`
- ReDoc: `https://api-chairmap.rokdee.com/redoc`

### API-Endpoints (aktuell)
| Endpoint | Beschreibung |
|---|---|
| `/aufzuege` | JOIN aufzuege + stoerungen + fahrtrichtungen |
| `/stoerungen` | Aktuelle Störungen |
| `/haltestellen` | Alle KVB Haltestellen |
| `/fahrtrichtungen` | Fahrtrichtungen |
| `/barrierefreiheit` | Barrierefreiheits-Tabelle |
| `/haltestellen-barrierefreiheit` | JOIN haltestellen + barrierefreiheit via kurzname |

### kvb_fetch.py
- Datei: `/root/kvb_fetch.py`
- Auch lokal: `~/chairmap/server/kvb_fetch.py`
- Cron (alle 15 Min): `*/15 * * * * /opt/superset/venv/bin/python /root/kvb_fetch.py`
- Lädt von KVB OpenData API und importiert in SQLite
- Importiert auch: `fahrtrichtungen.json` und `KVB_Stations_Access.csv` von `/root/`

---

## 3. Datenbank – PostgreSQL (Migration abgeschlossen)

### SQLite (Legacy, auf CT 102)
- Pfad: `/opt/superset/kvb_data.db`
- Wird **nicht mehr aktiv genutzt**, außer für `stadtbahn_gleise` (Hybrid-Endpoint in API, bewusst bis CSV fertig gepflegt)

### PostgreSQL + PostGIS (produktiv, CT 104)
- Host: `192.168.0.104`
- Port: 5432
- Datenbank: `chairmap`
- User: `chairmap_app`
- PostGIS 3.5 installiert
- CT 102 hat Zugriff via `pg_hba.conf`: `host chairmap chairmap_app 192.168.0.171/32 scram-sha-256`
- **Migration abgeschlossen** (Juli 2026, verifiziert): `kvb_fetch_postgres.py` läuft produktiv, Cron auf CT 102 umgestellt
- Migrierte Tabellen: `aufzuege`, `stoerungen`, `fahrtreppen`, `fahrtreppen_stoerungen`, `haltestellen`, `haltestellenbereiche`, `fahrtrichtungen`, `barrierefreiheit`, `gtfs_stops`
- Nicht migriert: `stadtbahn_gleise` (bewusst, CSV noch in Pflege), `db_facilities` (bleibt auf SQLite, DB-FaSta-Daten)
- **Superset**: neue DB-Connection `KVB_postGRES` (CT 104). Alle 4 virtuellen Datasets + physische Datasets auf Postgres umgestellt. `db_facilities` verbleibt auf alter SQLite-Connection `KVB`.

### Tabellen-Übersicht

#### Automatisch aktualisiert (alle 15 Min via kvb_fetch.py):
| Tabelle | Einträge | Quelle |
|---|---|---|
| aufzuege | 65 | KVB OpenData API |
| stoerungen | variabel | KVB OpenData API |
| fahrtreppen | 264 | KVB OpenData API |
| fahrtreppen_stoerungen | variabel | KVB OpenData API |
| haltestellen | 2156 | KVB OpenData API |
| haltestellenbereiche | 906 | KVB OpenData API |
| fahrtrichtungen | 66 | /root/fahrtrichtungen.json (manuell kuratiert) |
| barrierefreiheit | 223 | /root/KVB_Stations_Access.csv (manuell kuratiert) |

#### Statische Tabellen:
| Tabelle | Einträge | Quelle |
|---|---|---|
| gtfs_stops | ~20.000 | VRS GTFS-Feed |
| db_facilities | variabel | DB FaSta API |
| stadtbahn_gleise | 370 | stadtbahn_gleise.csv (noch in Pflege!) |

### Wichtige Join-Keys
- `kurzname` (z.B. "AMG", "NEU") — eindeutiger KVB-Schlüssel, verbindet alle Tabellen
- `Haltestellenbereich` (numerisch) — verbindet aufzuege mit haltestellenbereiche
- `Kennung` (z.B. "007-01") — eindeutig für jeden Aufzug

### Bekanntes Kreuzprodukt-Problem
JOIN `haltestellen` + `barrierefreiheit` über `kurzname` erzeugt Duplikate weil:
- `haltestellen` hat mehrere Zeilen pro Kurzname (eine pro physischem Gleis/Fahrtrichtung)
- `barrierefreiheit` hat bei ~15 Stationen mehrere Zeilen (eine pro Linie mit unterschiedlichem Status)
- Lösung: `stadtbahn_gleise` als Master-Tabelle mit eindeutigem Key `Kurzname+Linie+Gleis`

---

## 4. stadtbahn_gleise – Master-Tabelle (in Arbeit)

### Spalten
```
Kurzname; Haltestelle; Linie; Gleis; Fahrtrichtung; Barrierefreiheit; Ebene;
Ausstieg_aus_der_Bahn; Aufzug; Rolltreppe; Rampe; Aufzug_Fahrtrichtung_Hinweis
```

### Stand
- 370 Zeilen aus PDF-Lageplänen extrahiert + manuell kuratiert
- Ebene: U-Bahn / Straße / Hochbahn
- Barrierefreiheit: JA / NEIN / eingeschraenkt
- **Noch keine lon/lat** — sollen aus gtfs_stops per Script eingetragen werden
- **Noch nicht vollständig** — wird weiter gepflegt

### Datenqualitäts-Hinweise (verifiziert Juli 2026)
- Zwei echte Duplikate gefunden: `BAH;Bahnstraße;1` und `NEU;Neumarkt;7;5` — reiner Copy-Paste-Fehler
- Scheinbare Duplikate bei gleichem `Kurzname+Linie+Gleis` sind **keine** Fehler, sondern legitime Mehrfach-Fahrtrichtungen (z.B. Mittelbahnsteige wie Dom/Hbf, Chlodwigplatz)
- **Korrekter Unique-Key:** `Kurzname + Linie + Gleis + Fahrtrichtung` (nicht nur erste drei Felder)
- **Achtung Namens-Strings:** KVB-API und VRS-GTFS liefern uneinheitliche Abkürzungen (`Rudolfpl.` vs. ausgeschrieben, `Str.`/`Straße`, `von`/`Von`). Für Joins nur `kurzname`/`stop_id` verwenden, nie Namens-Strings

### Geplantes Koordinaten-Script
```python
# gtfs_koordinaten.py (auf CT 102)
# Liest gtfs_stops child-stops mit Gleisnummer
# Joined über Haltestellenname → kurzname via haltestellenbereiche
# Trägt lon/lat + Ebene in stadtbahn_gleise ein (nur leere Felder)
# Script liegt unter /root/gtfs_koordinaten.py
```

### Scoring-System (geplant, 5 Stufen)
- 5: Aufzug + stufenloser Einstieg
- 4: Straßenlevel + stufenlos (kein Aufzug nötig)
- 3: Rolltreppe oder eingeschränkt
- 2: Stufen beim Einstieg, Gleis erreichbar
- 1: Treppen überall (Slabystraße = Score 1)

---

## 5. CT 103 – Docker / Frontend

### nginx Container
- Portainer: `http://192.168.0.72:9443`
- nginx serviert aus: `/root/chairmap-dist/`
- Port: 8080

### Deploy-Workflow
```bash
# Auf Mac Mini:
cd ~/chairmap
npm run build
rsync -avz --delete dist/ root@192.168.0.72:/root/chairmap-dist/
```

---

## 6. Frontend – ChairMap PWA

### Tech Stack
- React + Vite
- MapLibre GL JS
- OpenFreeMap Liberty-Stil (3D-Gebäude)
- MapTiler Satellite-V2 (Toggle-Layer)
- vite-plugin-pwa (Service Worker, Manifest)

### Repo
- GitHub: `https://github.com/AlliDeeaz/chairmap` (public)
- Lokal: `~/chairmap/` auf Mac Mini
- Dev-Server: `npm run dev` → `localhost:5173`

### PWA-Config (vite.config.js)
```javascript
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    skipWaiting: true,
    clientsClaim: true,
    // API: NetworkFirst (5s timeout, 1h cache)
    // Tiles: CacheFirst (30 Tage)
  }
})
```

### Karten-Konfiguration
```javascript
// src/App.jsx
const API_URL = 'https://api-chairmap.rokdee.com'
// MapLibre initial view:
center: [6.9603, 50.9333]  // Köln Hbf
zoom: 13
// Liberty style:
'https://tiles.openfreemap.org/styles/liberty'
// Satellite tiles:
'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=...'
```
> **Achtung:** MapTiler API-Key ist aktuell hardcoded in `src/App.jsx` — sollte in `.env` als `VITE_MAPTILER_KEY` ausgelagert werden.

### localStorage-Keys (Frontend)
| Key | Wert | Bedeutung |
|---|---|---|
| `chairmap-gespeicherte-aufzuege` | JSON-Array von Kennungen | Favoriten (Gespeichert-Tab) |
| `chairmap-location-asked` | `'1'` | Location-Popup wurde einmal gezeigt, nicht mehr anzeigen |
| `chairmap-onboarding-seen` | `'1'` | Veraltet – war Hilfe-Popup, jetzt durch Location-Popup ersetzt |

### Features (aktuell live)
- Aufzüge als Marker (grün/rot) mit Popup-Sidebar inkl. Fahrtrichtungstext
- Haltestellen als farbige Punkte (Barrierefreiheits-Ampel: grün/gelb/rot/grau)
- **Aufzugsliste** mit Tabs: Aufzüge (Alle / Störungen / Gespeichert) + Stationen
- **Suchfeld** in der Liste (filtert Aufzüge und Haltestellen live)
- **Favoriten** (★-Button pro Aufzug, persistiert in localStorage)
- Filter: Alle Aufzüge / Nur Störungen
- **3D-Gebäude Toggle** mit automatischer Kameraanimation (pitch 55°, bearing 20°)
  - Building-Layer-IDs werden dynamisch ermittelt via `getStyle().layers.filter(l => l.type === 'fill-extrusion')`
- **Satellite-Layer Toggle** (MapTiler Satellite-V2 als Raster unter Liberty-Vektoren)
  - Trick: Liberty `background-color` wird auf `rgba(0,0,0,0)` gesetzt damit Satellitenbild durchscheint
- Stadtbahn-Haltestellen Layer (Barrierefreiheits-Ampel, ein-/ausblendbar)
- Bus-Haltestellen Layer (lila Punkte, ein-/ausblendbar)
- Stadtbahn-Gleise Overlay (aus stadtbahn_gleise via API)
- Standort-Popup beim ersten Besuch (fragt Browser-Geolocation-Permission vor)
- Standort-Tracking (GeolocateControl, Button rechts oben)
- **Anleitung** als ausklappbarer Bereich im Control-Panel (alle Bildschirmgrößen)
- **Kartenlayer** auf Mobile ausklappbar (mit „Einklappen"-Button am Ende der Liste)
- **Aktualisieren-Button** mit Spinner + Timestamp (im Panel und in der Liste)
- PWA installierbar (iOS: Teilen → Zum Homebildschirm; Android: Browser-Prompt)
- Service Worker: skipWaiting + clientsClaim → Updates sofort aktiv

### Halbfertige / gestoppte Features
- `panelOpen` State + `setPanelOpen` existieren in `src/App.jsx` aber sind noch nicht an UI verdrahtet (Burger-Menü zum Ausblenden des ganzen Control-Panels war geplant, aber Ansatz noch nicht final)

### Features (geplant)
- Burger-Menü / Panel-Toggle (Control-Panel komplett aus-/einblenden)
- Barrierefreiheits-Ampel korrekt (nach stadtbahn_gleise PostgreSQL-Migration)
- Alternativrouten bei Aufzugsausfall
- Routenplanung mit PostGIS
- Community-Meldungen für nicht gemeldete Ausfälle
- Toiletten-Layer (AWB Köln Open Data)
- Behindertenparkplätze (geoportal.nrw)
- MapTiler API-Key in `.env` auslagern (`VITE_MAPTILER_KEY`)

---

## 7. Datendateien (lokal auf Mac)

| Datei | Pfad | Beschreibung |
|---|---|---|
| stadtbahn_gleise.csv | ~/chairmap/data/stadtbahn_gleise.csv | Master-Tabelle (in Pflege) |
| fahrtrichtungen.json | ~/chairmap/data/fahrtrichtungen.json | Manuell kuratiert, von KVB per Email |
| KVB_Stations_Access.csv | ~/chairmap/data/KVB_Stations_Access.csv | Barrierefreiheits-Tabelle mit kurzname |
| chairmap_api.py | ~/chairmap/server/chairmap_api.py | FastAPI Backend |
| kvb_fetch.py | ~/chairmap/server/kvb_fetch.py | Daten-Fetch Script |

### Auf CT 102 (/root/)
- `fahrtrichtungen.json`
- `KVB_Stations_Access.csv`
- `kvb_fetch.py`
- `chairmap_api.py`
- `gtfs_koordinaten.py` (neu, für Koordinaten-Import)
- `kvb_fetch_postgres.py` (in Vorbereitung)
- `chairmap_api_postgres.py` (in Vorbereitung)

---

## 8. Superset – Datasets & Queries

### Virtual Datasets
| Name | Beschreibung |
|---|---|
| KVB_Stations_AXS | haltestellen + barrierefreiheit JOIN via kurzname |
| KölnStations-VRS | GTFS Gleiskoordinaten mit Ebenen (U/Stadtb.) |
| Störungen+FR | stoerungen + fahrtrichtungen JOIN |
| aufzuege_mit_fahrtrichtungen | aufzuege + stoerungen + fahrtrichtungen |

### Gespeicherte SQL-Queries
- `KölnStations-VRS` — GTFS parent/child Gleiskoordinaten
- `Störungen_SQL` — Störungen mit Fahrtrichtung
- Barrierefreiheits-Query — haltestellen + barrierefreiheit via kurzname

### Dashboard
- URL: `https://superset.rokdee.com/superset/dashboard/kvb/`
- Slug: `kvb`

---

## 9. Externe Datenquellen

| Quelle | URL | Was |
|---|---|---|
| KVB OpenData | data.webservice-kvb.koeln | Aufzüge, Haltestellen, Störungen |
| VRS GTFS | vrs.de/fuer-unternehmen/open-data-service | GTFS-Feed (Gleise, Koordinaten) |
| DB FaSta | developers.deutschebahn.com/db-api-marketplace | DB Aufzugsstatus |
| OpenFreeMap | tiles.openfreemap.org | Kartenkacheln (Liberty-Stil) |
| MapTiler | cloud.maptiler.com | Satellite-V2 Tiles |
| Overpass API | overpass-turbo.eu | OSM-Daten (Toiletten, POIs) |
| KölnWiki | koelnwiki.de/wiki/Stadtbahnlinien | Haltestellendetails |

---

## 10. Shell-Aliases (~/.zshrc auf Mac)

```bash
alias cm-deploy='rsync -avz --delete ~/chairmap/dist/ root@192.168.0.72:/root/chairmap-dist/'
alias cm-push='cd ~/chairmap && git add . && git commit -m "update" && git push'
alias cm-102='ssh root@192.168.0.171'
alias cm-103='ssh root@192.168.0.72'
alias cm-104='ssh root@192.168.0.104'
alias cm-data='scp ~/chairmap/data/stadtbahn_gleise.csv root@192.168.0.171:/root/ && ssh root@192.168.0.171 "source /opt/superset/venv/bin/activate && python3 /root/kvb_fetch.py && systemctl restart chairmap-api"'
alias cm-status='ssh root@192.168.0.171 "systemctl status chairmap-api cloudflared --no-pager"'
```

### Toolbox-Script
- Datei: `/Users/rokd/Library/Scripts/chairmap_tools.sh`
- AppleScript-Wrapper: `/Users/rokd/Library/Scripts/ChairMap Toolbox.scpt`

---

## 11. Offene TODOs (priorisiert)

### Sofort / Datenbank
- [x] PostgreSQL-Migration abschließen ✓ (Juli 2026, bis auf stadtbahn_gleise)
- [x] Superset auf PostgreSQL umstellen ✓
- [ ] stadtbahn_gleise.csv fertig pflegen (Duplikate bereinigt, Unique-Key = Kurzname+Linie+Gleis+Fahrtrichtung)
- [ ] GTFS-Koordinaten in stadtbahn_gleise eintragen — `gtfs_koordinaten.py` kann Superset-Query `KölnStations-VRS` als Vorlage nutzen (hat parent/child-Join + Ebenen-Klassifikation bereits fertig)
- [ ] Passwort aus `kvb_fetch_postgres.py` / `chairmap_api.py` auslagern (aktuell Klartext) — **vor** Git-Repo auf CT 102
- [ ] CT 102: Git-Repo einrichten (`git clone`) damit Deploy via `git pull` statt `nano`/`scp` läuft

### Frontend
- [ ] Kreuzprodukt-Problem lösen (stadtbahn_gleise als Basis für Haltestellen-Layer)
- [x] Aufzugsliste mit Tabs (Alle / Störungen / Gespeichert + Stationen) ✓
- [x] Anleitung-Panel im Control-Panel ✓
- [ ] Burger-Menü / Panel komplett ein-/ausblendbar (`panelOpen` State vorbereitet, UI fehlt noch)
- [ ] Versionsnummer / Build-Timestamp anzeigen
- [ ] Hard-Reload Button für SW-Cache
- [ ] MapTiler API-Key in `.env` auslagern

### Daten
- [ ] stadtbahn_gleise vollständig pflegen (Gleise, Linien, Barrierefreiheit)
- [ ] Scoring-System implementieren
- [ ] Alternativrouten-Tabelle anlegen

### Geplant (mittelfristig)
- [ ] Routenplanung mit PostGIS
- [ ] Toiletten-Layer (AWB Köln Open Data)
- [ ] Community-Meldungen
- [ ] GTFS-Realtime für Live-Taktdaten

---

## 12. Wichtige Hinweise / Fallstricke

- **venv auf CT 102**: immer `source /opt/superset/venv/bin/activate` vor Python-Scripts, oder `/opt/superset/venv/bin/python` direkt
- **Encoding**: KVB-API liefert manchmal Latin-1 statt UTF-8 — `try/except UnicodeDecodeError` in kvb_fetch.py
- **JSON-Encoding**: FastAPI braucht expliziten `JSONResponse(content=data, media_type="application/json; charset=utf-8")` für korrekte Umlaute durch Cloudflare
- **PostgreSQL Kleinschreibung**: PostgreSQL faltet unquotierte Spaltennamen zu lowercase — API-Aliase mit `AS "OriginalName"` nötig damit Frontend-Keys nicht brechen
- **Service Worker Cache**: skipWaiting + clientsClaim aktiv, trotzdem manchmal manueller Hard-Reload nötig (DevTools → Application → Service Workers → Unregister)
- **stadtbahn_gleise noch nicht in PostgreSQL** — bleibt vorübergehend in SQLite bis CSV fertig
- **Safari Button-Font**: Safari erbt `font-family`/`font-size` nicht automatisch von Parent in `<button>`-Elementen. Fix ganz oben in `App.css`: `button, input, select, textarea { font-family: inherit; font-size: inherit; }`
- **Verschachtelte `<a>`-Tags**: Kein `<a>` in `<a>` — ungültiges HTML, Browser reißt es auseinander. Karten mit mehreren Links müssen als `<div class="card">` statt `<a class="card">` gebaut werden (siehe Links4ChairMap_3.html)
- **MapTiler Key hardcoded**: API-Key `dRgWDG2iVEnaZFJ4hRoW` steht direkt in `src/App.jsx`. Solange das Repo public ist, ist der Key öffentlich sichtbar. Key ist auf `chairmap.rokdee.com` (Referrer) in MapTiler beschränkt — trotzdem besser in `.env` auslagern
- **CORS**: FastAPI muss `chairmap.rokdee.com` (und `localhost:5173`) in `allow_origins` haben
- **VSCode + Claude Code**: VSCode muss „Claude Code: Autosave" aktiviert haben, sonst schreibt Claude Code zwar auf Disk, aber VSCode zeigt die alte Version im Buffer (Bullet-Icon im Tab) — Datei muss manuell mit Cmd+S gespeichert werden
- **MapLibre Satellite-Trick**: Satellite-Rasterquelle vor dem ersten Liberty-Layer einfügen; dann Liberty `background`-Layer-`background-color` auf `rgba(0,0,0,0)` setzen — alle Vektorlayer (Straßen, Gebäude, Marker) bleiben darüber sichtbar
- **3D-Building-Layer-IDs**: Nicht hardcoden — dynamisch ermitteln nach Map-Load: `map.getStyle().layers.filter(l => l.type === 'fill-extrusion').map(l => l.id)`
- **`GRANT ALL ON SCHEMA public`**: Seit PostgreSQL 15 hat ein neu angelegter User standardmäßig kein CREATE-Recht auf `public`, auch mit `ALL PRIVILEGES` auf die Datenbank. Einmalig als `postgres`-Superuser ausführen: `GRANT ALL ON SCHEMA public TO chairmap_app;` — sonst `permission denied for schema public` beim ersten `CREATE TABLE`
- **`datetime`-Serialisierung (Postgres vs. SQLite)**: Postgres `TIMESTAMP`-Spalten kommen via psycopg2 als Python-`datetime`-Objekte zurück (nicht als String wie SQLite). FastAPIs `JSONResponse` kann das nicht serialisieren → in `query_pg()` alle `datetime`/`date`-Werte explizit per `isinstance()`-Check zu `.isoformat()` konvertieren
- **Superset Spalten-Casing Cleanup**: Nach SQLite→Postgres-Migration entstehen in Superset doppelte Spalteneinträge (alte Großschreibung + neue Kleinschreibung). Fix: Aliase ohne Anführungszeichen in SQL verwenden (Postgres macht alles lowercase), dann im Dataset-Editor „Sync columns from source" klicken
- **`haltestellenbereiche` hat keine Koordinaten**: Live gegen KVB-API verifiziert — kein `geometry`-Feld vorhanden, kein Bug
- **Proxmox-Konsole Copy-Paste-Bug**: Browser-Konsole verschluckt/verdoppelt gelegentlich Zeichen bei Fenster-Resize. Bekannter Proxmox-UI-Bug. Für längere Scripts besser SSH direkt nutzen statt Proxmox-Console
- **Passwort Klartext in Scripts**: `PG_CONFIG` in `kvb_fetch_postgres.py` und `chairmap_api.py` enthält DB-Passwort im Klartext — vor Git-Repo auf CT 102 unbedingt in Umgebungsvariable / `.env` auslagern
