import os
import requests
import psycopg2
import json
import csv
import sqlite3  # nur noch fuer stadtbahn_gleise, bis diese Tabelle final migriert ist
from datetime import datetime

URL_STOERUNGEN = "https://data.webservice-kvb.koeln/service/opendata/aufzugsstoerung/json"
URL_AUFZUEGE = "https://data.webservice-kvb.koeln/service/opendata/aufzuege/json"
URL_FAHRTREPPEN = "https://data.webservice-kvb.koeln/service/opendata/fahrtreppen/json"
URL_FAHRTREPPEN_STOERUNG = "https://data.webservice-kvb.koeln/service/opendata/fahrtreppenstoerung/json"
URL_HALTESTELLEN = "https://data.webservice-kvb.koeln/service/opendata/haltestellen/json"
URL_HALTESTELLENBEREICHE = "https://data.webservice-kvb.koeln/service/opendata/haltestellenbereiche/json"

PG_CONFIG = {
    "host": "192.168.0.104",
    "port": 5432,
    "dbname": "chairmap",
    "user": "chairmap_app",
    "password": os.environ["CHAIRMAP_DB_PASSWORD"],
}

# stadtbahn_gleise NICHT hier drin - noch nicht in Postgres, siehe unten
GEOM_TABLES = {"aufzuege", "stoerungen", "fahrtreppen", "fahrtreppen_stoerungen", "haltestellen"}

SQLITE_DB_PATH = "/opt/superset/kvb_data.db"  # nur noch fuer stadtbahn_gleise


def pg_col(name):
    """SQLite/API-Spaltenname -> Postgres-Spaltenname (lowercase, Leerzeichen -> Unterstrich)."""
    return name.lower().replace(" ", "_")


def fetch_and_save(conn, url, tabellenname):
    r = requests.get(url)
    r.encoding = "utf-8"
    r.raise_for_status()
    try:
        data = json.loads(r.content.decode("utf-8"))
    except UnicodeDecodeError:
        data = json.loads(r.content.decode("latin-1"))

    rows = []
    for f in data["features"]:
        p = f["properties"]
        row = dict(p)
        lon = lat = None
        has_coords = f.get("geometry") and f["geometry"].get("coordinates")
        if has_coords:
            lon, lat = f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1]
        if tabellenname in GEOM_TABLES:
            # Nur bei Tabellen mit geom-Spalte lon/lat als Felder mitschicken -
            # sonst (z.B. haltestellenbereiche) gibt es diese Spalten im Schema gar nicht
            row["lon"] = lon
            row["lat"] = lat
        row["abgerufen_am"] = datetime.now().isoformat()
        rows.append(row)

    if not rows:
        print(f"0 Eintraege in {tabellenname} - keine Daten von der API erhalten.")
        return

    pg_columns = [pg_col(k) for k in rows[0].keys()]
    api_keys = list(rows[0].keys())
    has_geom = tabellenname in GEOM_TABLES

    insert_cols = pg_columns + (["geom"] if has_geom else [])
    col_sql = ", ".join(f'"{c}"' for c in insert_cols)
    placeholders = ", ".join(["%s"] * len(pg_columns))

    if has_geom:
        sql = f'INSERT INTO {tabellenname} ({col_sql}) VALUES ({placeholders}, ST_SetSRID(ST_MakePoint(%s, %s), 4326))'
    else:
        sql = f'INSERT INTO {tabellenname} ({col_sql}) VALUES ({placeholders})'

    params = []
    for row in rows:
        values = [row.get(k) for k in api_keys]
        if has_geom:
            params.append(tuple(values) + (row.get("lon"), row.get("lat")))
        else:
            params.append(tuple(values))

    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE TABLE {tabellenname} RESTART IDENTITY CASCADE")
        cur.executemany(sql, params)
    conn.commit()
    print(f"{len(rows)} Eintraege in {tabellenname} gespeichert.")


def import_json_table(conn, path, tabellenname):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not data:
        print(f"0 Eintraege in {tabellenname} - Datei leer.")
        return
    cols = [pg_col(k) for k in data[0].keys()]
    col_sql = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join(["%s"] * len(cols))
    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE TABLE {tabellenname} RESTART IDENTITY CASCADE")
        cur.executemany(
            f"INSERT INTO {tabellenname} ({col_sql}) VALUES ({placeholders})",
            [tuple(row.values()) for row in data],
        )
    conn.commit()
    print(f"{len(data)} Eintraege in {tabellenname} gespeichert.")


def import_csv_table(conn, path, tabellenname):
    with open(path, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    if not rows:
        print(f"0 Eintraege in {tabellenname} - Datei leer.")
        return
    cols = [pg_col(k) for k in rows[0].keys()]
    col_sql = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join(["%s"] * len(cols))
    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE TABLE {tabellenname} RESTART IDENTITY CASCADE")
        cur.executemany(
            f"INSERT INTO {tabellenname} ({col_sql}) VALUES ({placeholders})",
            [tuple(v if v != "" else None for v in row.values()) for row in rows],
        )
    conn.commit()
    print(f"{len(rows)} Eintraege in {tabellenname} gespeichert.")


def main():
    conn = psycopg2.connect(**PG_CONFIG)
    conn.set_client_encoding("UTF8")

    fetch_and_save(conn, URL_STOERUNGEN, "stoerungen")
    fetch_and_save(conn, URL_AUFZUEGE, "aufzuege")
    fetch_and_save(conn, URL_FAHRTREPPEN, "fahrtreppen")
    fetch_and_save(conn, URL_FAHRTREPPEN_STOERUNG, "fahrtreppen_stoerungen")
    fetch_and_save(conn, URL_HALTESTELLEN, "haltestellen")
    fetch_and_save(conn, URL_HALTESTELLENBEREICHE, "haltestellenbereiche")

    import_json_table(conn, "/root/fahrtrichtungen.json", "fahrtrichtungen")
    import_csv_table(conn, "/root/KVB_Stations_Names4VsC.csv", "barrierefreiheit")

    conn.close()

    # TEMPORAER: stadtbahn_gleise noch nicht in Postgres (CSV in Pflege).
    # Bleibt vorerst in SQLite, bis die Tabelle final migriert wird.
    import pandas as pd
    df_stadtbahn_gleise = pd.read_csv("/root/stadtbahn_gleise.csv", sep=";", encoding="utf-8")
    sqlite_conn = sqlite3.connect(SQLITE_DB_PATH)
    df_stadtbahn_gleise.to_sql("stadtbahn_gleise", sqlite_conn, if_exists="replace", index=False)
    sqlite_conn.close()
    print(f"{len(df_stadtbahn_gleise)} Eintraege in stadtbahn_gleise (SQLite, temporaer) gespeichert.")


if __name__ == "__main__":
    main()