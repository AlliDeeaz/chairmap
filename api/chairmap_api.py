from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import sqlite3

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DB_PATH = "/opt/superset/kvb_data.db"

def query_db(sql):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(sql)
    rows = [dict(row) for row in cur.fetchall()]
    conn.close()
    return rows

@app.get("/aufzuege")
def get_aufzuege():
    data = query_db("""
        SELECT 
            a.Kennung,
            a.Bezeichnung,
            a.Haltestellenbereich,
            a.Info,
            a.lon,
            a.lat,
            CASE WHEN s.Kennung IS NOT NULL THEN 'ausser_betrieb' ELSE 'in_betrieb' END as status,
            s.timestamp as stoerung_seit,
            f.beschreibung as fahrtrichtung,
            f.halt as haltestelle
        FROM aufzuege a
        LEFT JOIN stoerungen s ON a.Kennung = s.Kennung
        LEFT JOIN fahrtrichtungen f ON a.Kennung = f.kennung
    """)
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")

@app.get("/stoerungen")
def get_stoerungen():
    data = query_db("SELECT * FROM stoerungen")
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")

@app.get("/haltestellen")
def get_haltestellen():
    data = query_db("SELECT * FROM haltestellen")
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")

@app.get("/fahrtrichtungen")
def get_fahrtrichtungen():
    data = query_db("SELECT * FROM fahrtrichtungen")
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")

@app.get("/barrierefreiheit")
def get_barrierefreiheit():
    data = query_db("SELECT * FROM barrierefreiheit")
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")

@app.get("/haltestellen-barrierefreiheit")
def get_haltestellen_barrierefreiheit():
    data = query_db("""
        SELECT
            h.Name as haltestelle,
            h.Kurzname as kurzname,
            h.lon,
            h.lat,
            b.Barrierefreiheit,
            b.Linie as linie
        FROM haltestellen h
        LEFT JOIN barrierefreiheit b ON h.Kurzname = b.kurzname
        WHERE h.Betriebsbereich = 'STRAB'
        ORDER BY h.Name
    """)
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")

@app.get("/stadtbahn-gleise")
def get_stadtbahn_gleise():
    data = query_db("SELECT * FROM stadtbahn_gleise")
    return JSONResponse(content=data, media_type="application/json; charset=utf-8")