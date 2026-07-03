import requests
import pandas as pd
import sqlite3
import json
from datetime import datetime

URL_STOERUNGEN = "https://data.webservice-kvb.koeln/service/opendata/aufzugsstoerung/json"
URL_AUFZUEGE = "https://data.webservice-kvb.koeln/service/opendata/aufzuege/json"
URL_FAHRTREPPEN = "https://data.webservice-kvb.koeln/service/opendata/fahrtreppen/json"
URL_FAHRTREPPEN_STOERUNG = "https://data.webservice-kvb.koeln/service/opendata/fahrtreppenstoerung/json"
URL_HALTESTELLEN = "https://data.webservice-kvb.koeln/service/opendata/haltestellen/json"
URL_HALTESTELLENBEREICHE = "https://data.webservice-kvb.koeln/service/opendata/haltestellenbereiche/json"

def fetch_and_save(url, tabellenname):
    r = requests.get(url)
    r.encoding = 'utf-8'
    r.raise_for_status()
    try:
        data = json.loads(r.content.decode('utf-8'))
    except UnicodeDecodeError:
        data = json.loads(r.content.decode('latin-1'))
    rows = []
    for f in data["features"]:
        p = f["properties"]
        row = dict(p)
        if f.get("geometry") and f["geometry"].get("coordinates"):
            c = f["geometry"]["coordinates"]
            row["lon"] = c[0]
            row["lat"] = c[1]
        row["abgerufen_am"] = datetime.now().isoformat()
        rows.append(row)
    df = pd.DataFrame(rows)
    conn = sqlite3.connect("/opt/superset/kvb_data.db")
    df.to_sql(tabellenname, conn, if_exists="replace", index=False)
    conn.close()
    print(str(len(df)) + " Eintraege in " + tabellenname + " gespeichert.")

fetch_and_save(URL_STOERUNGEN, "stoerungen")
fetch_and_save(URL_AUFZUEGE, "aufzuege")
fetch_and_save(URL_FAHRTREPPEN, "fahrtreppen")
fetch_and_save(URL_FAHRTREPPEN_STOERUNG, "fahrtreppen_stoerungen")
fetch_and_save(URL_HALTESTELLEN, "haltestellen")
fetch_and_save(URL_HALTESTELLENBEREICHE, "haltestellenbereiche")

with open('/root/fahrtrichtungen.json', 'r', encoding='utf-8') as f:
    fahr_data = json.load(f)

df_fahr = pd.DataFrame(fahr_data)
conn = sqlite3.connect("/opt/superset/kvb_data.db")
df_fahr.to_sql("fahrtrichtungen", conn, if_exists="replace", index=False)
conn.close()
print(str(len(df_fahr)) + " Eintraege in fahrtrichtungen gespeichert.")

df_barrierefreiheit = pd.read_csv('/root/KVB_Stations_Names4VsC.csv', sep=';', encoding='utf-8')
conn = sqlite3.connect("/opt/superset/kvb_data.db")
df_barrierefreiheit.to_sql("barrierefreiheit", conn, if_exists="replace", index=False)
conn.close()
print(str(len(df_barrierefreiheit)) + " Eintraege in barrierefreiheit gespeichert.")

df_stadtbahn_gleise = pd.read_csv('/root/stadtbahn_gleise.csv', sep=';', encoding='utf-8')
conn = sqlite3.connect("/opt/superset/kvb_data.db")
df_stadtbahn_gleise.to_sql("stadtbahn_gleise", conn, if_exists="replace", index=False)
conn.close()
print(str(len(df_stadtbahn_gleise)) + " Eintraege in stadtbahn_gleise gespeichert.")
