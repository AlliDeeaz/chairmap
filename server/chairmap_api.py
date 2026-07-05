from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import psycopg2
import psycopg2.extras
import sqlite3  # nur noch fuer stadtbahn_gleise, bis diese Tabelle final migriert ist
from datetime import datetime, date

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

PG_CONFIG = {
    "host": "192.168.0.104",
    "port": 5432,
    "dbname": "chairmap",
    "user": "chairmap_app",
    "password": os.environ["CHAIRMAP_DB_PASSWORD"],
}

SQLITE_DB_PATH = "/opt/superset/kvb_data.db"  # nur noch fuer stadtbahn_gleise


def query_pg(sql):
    conn = psycopg2.connect(**PG_CONFIG)
    conn.set_client_encoding("UTF8")
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql)
    rows = []
    for row in cur.fetchall():
        row = dict(row)
        for k, v in row.items():
            if isinstance(v, (datetime, date)):
                row[k] = v.isoformat()
        rows.append(row)
    cur.close()
    conn.close()
    return rows

def query_sqlite(sql):
    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(sql)
    rows = [dict(row) for row in cur.fetchall()]
    conn.close()
    return rows


# Hinweis: Postgres faltet unquotierte Spaltennamen zu lowercase.
# Alle Aliase unten reproduzieren bewusst die alten SQLite-JSON-Keys 1:1,
# damit das Frontend (das auf diese exakten Property-Namen zugreift) nicht bricht.

@app.get("/aufzuege")
def get_aufzuege():
    data = query_pg("""
        SELECT 
            a.kennung AS "Kennung",
            a.bezeichnung AS "Bezeichnung",
            a.haltestellenbereich AS "Haltestellenbereich",
            a.info AS "Info",
            a.lon,
            a.lat,
            CASE WHEN s.kennung IS NOT NULL THEN 'ausser_betrieb' ELSE 'in_betrieb' END as status,
            s.timestamp as stoerung_seit,
            f.beschreibung as fahrtrichtung,
            f.halt as haltestelle
        FROM aufzuege a
        LEFT JOIN stoerungen s ON a.kennung = s.kennung
        LEFT JOIN fahrtrichtungen f ON a.kennung = f.kennung
    """)
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")


@app.get("/stoerungen")
def get_stoerungen():
    data = query_pg("""
        SELECT
            kennung AS "Kennung",
            bezeichnung AS "Bezeichnung",
            haltestellenbereich AS "Haltestellenbereich",
            info AS "Info",
            "timestamp",
            lon,
            lat,
            abgerufen_am
        FROM stoerungen
    """)
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")


@app.get("/haltestellen")
def get_haltestellen():
    data = query_pg("""
        SELECT
            ass AS "ASS",
            name AS "Name",
            kurzname AS "Kurzname",
            betriebsbereich AS "Betriebsbereich",
            linien AS "Linien",
            lon,
            lat,
            abgerufen_am
        FROM haltestellen
    """)
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")


@app.get("/fahrtrichtungen")
def get_fahrtrichtungen():
    data = query_pg("SELECT kennung, halt, bereich, beschreibung FROM fahrtrichtungen")
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")


@app.get("/barrierefreiheit")
def get_barrierefreiheit():
    data = query_pg("""
        SELECT
            kurzname AS "Kurzname",
            haltestelle AS "Haltestelle",
            linie AS "Linie",
            barrierefreiheit AS "Barrierefreiheit",
            ebene AS "Ebene",
            ausstieg_aus_der_bahn AS "Ausstieg aus der Bahn",
            gleis AS "Gleis",
            aufzug AS "Aufzug",
            rolltreppe AS "Rolltreppe",
            rampe AS "Rampe"
        FROM barrierefreiheit
    """)
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")


@app.get("/haltestellen-barrierefreiheit")
def get_haltestellen_barrierefreiheit():
    data = query_pg("""
        SELECT
            h.name as haltestelle,
            h.kurzname as kurzname,
            h.lon,
            h.lat,
            b.barrierefreiheit AS "Barrierefreiheit",
            b.linie as linie
        FROM haltestellen h
        LEFT JOIN barrierefreiheit b ON h.kurzname = b.kurzname
        WHERE h.betriebsbereich = 'STRAB'
        ORDER BY h.name
    """)
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")


@app.get("/stadtbahn-gleise")
def get_stadtbahn_gleise():
    # TEMPORAER: stadtbahn_gleise ist noch nicht nach Postgres migriert,
    # da die CSV noch in Pflege ist. Sobald fertig: hier auf query_pg() umstellen.
    data = query_sqlite("SELECT * FROM stadtbahn_gleise")
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")
