"""
Extrahiert Gleis/Linie/Fahrtrichtung sowie Aufzug/Rolltreppe-Verfuegbarkeit
aus den KVB-Lageplan-PDFs in Lageplaene/ und schreibt eine CSV-Tabelle.

Hintergrund / bekannte Grenzen (siehe auch Analyse im Chat):
- Die Lageplaene sind grafische Liniennetz-Diagramme, kein Fliesstext.
  Gleis-Nummern, Linien und Fahrtrichtungen muessen ueber die
  Wortkoordinaten rekonstruiert werden (siehe row_segments/assign_to_gleis).
- "Aufzug"/"Rolltreppe" stehen nur als Legenden-Bildunterschrift im Text,
  und zwar nur wenn die Haltestelle ein solches Element ueberhaupt hat.
  Das ist zuverlaessig PRO HALTESTELLE auswertbar, nicht pro Gleis
  (die genaue Position ist ein gezeichnetes Vektor-Icon, kein Text).
- "Ebene" (U-Bahn/Strasse/Hochbahn) kommt in keinem PDF als Text vor.
  Stattdessen wird sie aus data/KVB_Stations_Names4VsC.csv nachgeschlagen
  (Spalten Kurzname/Linie/Ebene), wo der Nutzer sie bereits teilweise von
  Hand eingetragen hat. Fehlt ein Eintrag dort, bleibt die Spalte leer.
- Stationen mit nebeneinanderliegenden Gleisen unter einem gemeinsamen
  "Gleis Gleis"-Doppel-Header (z.B. Neumarkt, Gleis 5/6) koennen dazu
  fuehren, dass eines der beiden Gleise keinen sauberen Anker bekommt.
  Solche Faelle werden im QA-Report am Ende ausgegeben.

Aufruf:
    source .venv-lageplaene/bin/activate
    python3 scripts/extract_lageplaene.py
"""

import csv
import re
from pathlib import Path

import pdfplumber

LAGEPLAENE_DIR = Path(__file__).resolve().parent.parent / "Lageplaene"
OUTPUT_CSV = Path(__file__).resolve().parent.parent / "data" / "lageplaene_extraction.csv"
EBENE_LOOKUP_CSV = Path(__file__).resolve().parent.parent / "data" / "KVB_Stations_Names4VsC.csv"

LINE_NUM_RE = re.compile(r"^\d{1,3}$")

# Es gibt keine KVB-Stadtbahnlinien mit anderer Nummer als diesen - alles
# andere (z.B. 121, 140, 147, 184, 186) sind Bus-/TaxiBus-Liniennummern,
# die im selben Diagramm unter "Bussteig A/B" auftauchen.
KVB_STADTBAHNLINIEN = {"1", "3", "4", "5", "7", "9", "12", "13", "15", "16", "17", "18"}

# Diese Lageplaene zeigen im selben Diagramm sowohl KVB-Stadtbahn- als auch
# DB-Regionalzug-Gleise (RE/RB/RRX/S-Bahn). Die DB-Liniennummern (z.B. "RE 1",
# "RE 5") trennen sich beim Worterkennen manchmal vom "RE"/"RB"-Praefix und
# kollidieren dann zufaellig mit einer echten KVB-Liniennummer (z.B. "1 (RRX)
# Aachen Hbf" wird faelschlich als KVB-Linie 1 erkannt). Bis dafuer ein
# verlaesslicher Filter existiert, werden diese Kurznamen komplett
# uebersprungen - Gleis/Fahrtrichtung dort manuell nachtragen.
DB_KONTAMINIERTE_LAGEPLAENE = {"BFM", "PST", "MTP", "VSG"}

GLEIS_X_TOL = 15.0
GLEIS_Y_MIN = 2.0
GLEIS_Y_MAX = 25.0
MAX_ASSIGN_DISTANCE = 90.0


def row_segments(words, top_tol=2.0, xgap=25.0):
    """Gruppiert Woerter zu visuellen Textzeilen-Abschnitten (2D-Layout-Rekonstruktion)."""
    bands = []
    for w in sorted(words, key=lambda w: w["top"]):
        placed = False
        for b in bands:
            if abs(b["top"] - w["top"]) <= top_tol:
                b["words"].append(w)
                placed = True
                break
        if not placed:
            bands.append({"top": w["top"], "words": [w]})

    segments = []
    for b in bands:
        ws = sorted(b["words"], key=lambda w: w["x0"])
        cur = [ws[0]]
        for w in ws[1:]:
            # "Gleis" und NACHGESTELLTE blanke Zahlen gehoeren immer zum
            # naechsten/eigenen Gleis-Label-Anker, nie zum vorherigen
            # Linien-Eintrag - auch wenn der Abstand klein ist (sonst frisst
            # z.B. "18 Buchheim Herler Str." die direkt danebenstehende
            # Gleis-Nummer "2" auf und der Gleis-Anker verschwindet, siehe
            # ZOO_Lpan_Zoo-Flora.pdf). Die FUEHRENDE Liniennummer (cur hat
            # noch nur 1 Wort) darf dabei nicht von ihrem eigenen Text
            # abgetrennt werden, daher der len(cur) > 1 - Schutz.
            starts_new_anchor_token = w["text"] == "Gleis" or LINE_NUM_RE.match(w["text"])
            ends_before_anchor_token = cur[-1]["text"] == "Gleis" or (
                len(cur) > 1 and LINE_NUM_RE.match(cur[-1]["text"])
            )
            if w["x0"] - cur[-1]["x1"] > xgap or starts_new_anchor_token or ends_before_anchor_token:
                segments.append(cur)
                cur = [w]
            else:
                cur.append(w)
        segments.append(cur)

    out = []
    for seg in segments:
        text = " ".join(w["text"] for w in seg)
        out.append(
            {
                "text": text,
                "x0": min(w["x0"] for w in seg),
                "x1": max(w["x1"] for w in seg),
                "top": min(w["top"] for w in seg),
                "bottom": max(w["bottom"] for w in seg),
            }
        )
    out.sort(key=lambda r: (r["top"], r["x0"]))
    return out


def find_gleis_anchors(rows):
    """Findet 'Gleis'-Beschriftungen und die direkt darunter stehende Gleis-Nummer."""
    gleis_rows = [r for r in rows if r["text"] == "Gleis"]
    num_rows = [r for r in rows if LINE_NUM_RE.match(r["text"])]
    anchors = []
    for g in gleis_rows:
        candidates = [
            n
            for n in num_rows
            if abs(n["x0"] - g["x0"]) < GLEIS_X_TOL and GLEIS_Y_MIN < (n["top"] - g["top"]) < GLEIS_Y_MAX
        ]
        if candidates:
            n = min(candidates, key=lambda n: n["top"] - g["top"])
            anchors.append({"gleis": n["text"], "top": (g["top"] + n["bottom"]) / 2})
    return anchors


SCALE_BAR_RE = re.compile(r"^\d{1,3}\s*m$")


def find_line_entries(rows):
    """Findet Zeilen-Abschnitte, die mit einer Liniennummer beginnen (z.B. '16 Bad Godesberg [...]')."""
    entries = []
    for r in rows:
        if r["text"] == "Gleis" or LINE_NUM_RE.match(r["text"]):
            continue  # das ist die Gleis-Nummer selbst, kein Linien-Eintrag
        if SCALE_BAR_RE.match(r["text"]):
            continue  # Massstabsleiste, z.B. "75 m"
        tokens = r["text"].split()
        if (
            len(tokens) > 1
            and tokens[0] in KVB_STADTBAHNLINIEN
            and "Bussteig" not in r["text"]
        ):
            entries.append(r)
    return entries


def parse_entry(text):
    tokens = text.split()
    linie = tokens[0]
    fahrtrichtung = " ".join(tokens[1:])
    return linie, fahrtrichtung


def assign_to_gleis(entries, anchors):
    assigned = []
    unassigned = []
    for e in entries:
        if not anchors:
            unassigned.append(e)
            continue
        nearest = min(anchors, key=lambda a: abs(a["top"] - e["top"]))
        if abs(nearest["top"] - e["top"]) <= MAX_ASSIGN_DISTANCE:
            assigned.append((nearest["gleis"], e))
        else:
            unassigned.append(e)
    return assigned, unassigned


AUFZUG_BEGRIFFE = {"Aufzug", "Fahrstuhl"}
ROLLTREPPE_BEGRIFFE = {"Rolltreppe"}


def station_level_flags(words):
    texts = {w["text"] for w in words}
    aufzug = "JA" if texts & AUFZUG_BEGRIFFE else "NEIN"
    rolltreppe = "JA" if texts & ROLLTREPPE_BEGRIFFE else "NEIN"
    return aufzug, rolltreppe


def load_ebene_lookup(path):
    """Liest data/KVB_Stations_Names4VsC.csv und baut Kurzname -> [(linien_set, ebene), ...].

    Ebene kann pro Linie variieren (z.B. AMG: Linie 13 = Hochbahn, Linie 16 = Strasse),
    daher wird zusaetzlich zum Kurzname auch die Linie abgeglichen, falls ein
    Kurzname mehrere unterschiedliche Ebenen-Eintraege hat.
    """
    lookup = {}
    if not path.exists():
        return lookup
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            ebene = (row.get("Ebene") or "").strip()
            if not ebene:
                continue
            kurzname = row["Kurzname"].strip()
            linien = {l.strip() for l in row["Linie"].split(",") if l.strip()}
            lookup.setdefault(kurzname, []).append((linien, ebene))
    return lookup


def lookup_ebene(lookup, kurzname, linie):
    entries = lookup.get(kurzname)
    if not entries:
        return ""
    if len(entries) == 1:
        return entries[0][1]
    # mehrere Ebenen-Eintraege fuer diesen Kurzname - ueber die Linie disambiguieren
    matches = [ebene for linien, ebene in entries if linie in linien]
    if len(matches) == 1:
        return matches[0]
    return ""


def kurzname_and_name_from_filename(path):
    parts = path.stem.split("_")
    kurzname = parts[0]
    # parts[1] ist immer "Lpan"/"Lplan" - der Rest ist der Klartext-Name
    name = " ".join(parts[2:]).replace("_", " ")
    return kurzname, name


def process_pdf(path, ebene_lookup):
    with pdfplumber.open(path) as pdf:
        page = pdf.pages[0]
        words = page.extract_words()

    kurzname, name = kurzname_and_name_from_filename(path)
    aufzug, rolltreppe = station_level_flags(words)

    if kurzname in DB_KONTAMINIERTE_LAGEPLAENE:
        return [], {"file": path.name, "kurzname": kurzname, "skipped": "DB-Regionalzug-Mischdiagramm"}

    rows = row_segments(words)
    anchors = find_gleis_anchors(rows)
    entries = find_line_entries(rows)
    assigned, unassigned = assign_to_gleis(entries, anchors)

    out_rows = []
    for gleis, e in assigned:
        linie, fahrtrichtung = parse_entry(e["text"])
        out_rows.append(
            {
                "Haltestelle": kurzname,
                "Haltestelle_Name": name,
                "Gleis": gleis,
                "Linie": linie,
                "Fahrtrichtung": fahrtrichtung,
                "Ebene": lookup_ebene(ebene_lookup, kurzname, linie),
                "Aufzug_vorhanden": aufzug,
                "Rolltreppe_vorhanden": rolltreppe,
            }
        )

    qa = {
        "file": path.name,
        "kurzname": kurzname,
        "n_anchors": len(anchors),
        "n_entries": len(entries),
        "n_assigned": len(assigned),
        "n_unassigned": len(unassigned),
    }
    return out_rows, qa


def main():
    pdf_files = sorted(LAGEPLAENE_DIR.glob("*.pdf"))
    ebene_lookup = load_ebene_lookup(EBENE_LOOKUP_CSV)
    all_rows = []
    qa_report = []

    for path in pdf_files:
        try:
            rows, qa = process_pdf(path, ebene_lookup)
        except Exception as exc:  # defekte/abweichende PDFs nicht den ganzen Lauf abbrechen lassen
            qa_report.append({"file": path.name, "error": str(exc)})
            continue
        all_rows.extend(rows)
        qa_report.append(qa)

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "Haltestelle",
                "Haltestelle_Name",
                "Gleis",
                "Linie",
                "Fahrtrichtung",
                "Ebene",
                "Aufzug_vorhanden",
                "Rolltreppe_vorhanden",
            ],
            delimiter=";",
        )
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\n{len(pdf_files)} PDFs verarbeitet, {len(all_rows)} Zeilen geschrieben -> {OUTPUT_CSV}\n")

    print("=== QA-Report: Haltestellen mit moeglichem manuellem Review-Bedarf ===")
    for qa in qa_report:
        if "error" in qa:
            print(f"  FEHLER {qa['file']}: {qa['error']}")
        elif "skipped" in qa:
            print(f"  {qa['kurzname']:5s} ({qa['file']}): UEBERSPRUNGEN - {qa['skipped']}")
        elif qa["n_anchors"] == 0:
            print(f"  {qa['kurzname']:5s} ({qa['file']}): KEIN Gleis-Anker gefunden")
        elif qa["n_unassigned"] > 0:
            print(
                f"  {qa['kurzname']:5s} ({qa['file']}): {qa['n_unassigned']} Linien-Eintraege "
                f"konnten keinem Gleis zugeordnet werden (von {qa['n_entries']})"
            )


if __name__ == "__main__":
    main()
