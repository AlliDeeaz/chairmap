"""
Baut die finale Stadtbahn-Gleis-Tabelle:
- Basis ist data/KVB_Stations_Names4VsC.csv (vom Nutzer kuratiert: Kurzname,
  voller Haltestellenname, Linie, Barrierefreiheit, Ebene, Ausstieg aus der
  Bahn, Gleis, Aufzug, Rolltreppe, Rampe). Eine Basis-Zeile kann mehrere
  Linien zusammenfassen (z.B. "1, 3, 4, 7, 9, 16, 18"), wird hier pro
  Einzel-Linie aufgespalten.
- Pro PDF-Lageplan (siehe extract_lageplaene.py fuer die Koordinaten-Logik)
  werden Gleis-Nummer und Fahrtrichtung je Linie ergaenzt. Basis-Werte fuer
  Haltestellenname/Barrierefreiheit/Ebene/Ausstieg/Aufzug/Rolltreppe/Rampe
  haben Vorrang, sofern vorhanden; sonst greift der PDF-Wert.
- Bekannte Sonderfaelle (siehe KURZNAME_REMAP) und Stationen ganz ohne
  Basis-Eintrag werden im QA-Report am Ende aufgelistet statt stillschweigend
  verworfen.
- Zusatzspalte "Aufzug_Fahrtrichtung_Hinweis": Fahrtrichtungs-Texte aus
  data/fahrtrichtungen.json (pro Aufzug-Zugang/"bereich" erfasst), OHNE
  Gleis-Zuordnung - ein Aufzug-Zugang kann mehrere Gleise/Ebenen gleichzeitig
  verbinden, eine automatische Gleis-Zuordnung waere oft falsch (siehe
  load_aufzug_hinweise). Gilt pro Kurzname, wiederholt sich auf allen Zeilen
  dieser Haltestelle.

Schreibt eine NEUE Datei (ueberschreibt NICHT lageplaene_extraction.csv):
    data/stadtbahn_gleise.csv

Aufruf:
    source .venv-lageplaene/bin/activate
    python3 scripts/merge_stations.py
"""

import csv
import json
import re
from pathlib import Path

from extract_lageplaene import (
    DB_KONTAMINIERTE_LAGEPLAENE,
    LAGEPLAENE_DIR,
    assign_to_gleis,
    find_gleis_anchors,
    find_line_entries,
    kurzname_and_name_from_filename,
    parse_entry,
    row_segments,
    station_level_flags,
)
import pdfplumber

BASE_CSV = Path(__file__).resolve().parent.parent / "data" / "KVB_Stations_Names4VsC.csv"
FAHRTRICHTUNGEN_JSON = Path(__file__).resolve().parent.parent / "data" / "fahrtrichtungen.json"
HALTESTELLEN_JSON = Path(__file__).resolve().parent.parent / "data" / "haltestellen.json"
OUTPUT_CSV = Path(__file__).resolve().parent.parent / "data" / "stadtbahn_gleise.csv"

# Der Dateiname-Kurzname des PDFs stimmt nicht immer mit dem Stadtbahn-Kurzname
# in der Basis-CSV ueberein, wenn das PDF nach der Bus-Haltestelle benannt ist.
# TRI_Lpan_Trimbornstr_Kalk_Post.pdf zeigt inhaltlich "KALK POST" (Gleis 1/2,
# Linie 1+9) - das ist KPO in der Basis-CSV, "Trimbornstr." ist nur die
# Bus-Haltestelle im selben Lageplan.
KURZNAME_REMAP = {"TRI": "KPO"}

# Diese PDF-Kurznamen sind reine S-Bahn/Bus-Bahnhoefe (S6/S11/SB.. + 3-stellige
# Busnummern), keine KVB-Stadtbahnlinie bedient sie. find_line_entries()
# filtert das ueber KVB_STADTBAHNLINIEN sowieso schon auf 0 Zeilen raus; hier
# nur zur Dokumentation/QA-Transparenz aufgefuehrt.
KEINE_STADTBAHN = {"BFD", "BFL", "BFN", "BFS", "BFW", "BWH"}


def normalize_ja_nein(value):
    v = (value or "").strip().upper()
    if v in ("J", "JA"):
        return "JA"
    if v in ("N", "NEIN"):
        return "NEIN"
    return ""


def load_base(path):
    """Liest die Basis-CSV und spaltet Mehrfach-Linien-Zeilen pro Einzel-Linie auf."""
    expanded = {}
    order = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            kurzname = row["Kurzname"].strip()
            linien = [l.strip() for l in row["Linie"].split(",") if l.strip()]
            for linie in linien:
                key = (kurzname, linie)
                expanded[key] = {
                    "Haltestelle": row["Haltestelle"].strip(),
                    "Barrierefreiheit": row["Barrierefreiheit"].strip(),
                    "Ebene": row["Ebene"].strip(),
                    "Ausstieg_aus_der_Bahn": row["Ausstieg aus der Bahn"].strip(),
                    "Gleis": row["Gleis"].strip(),
                    "Aufzug": normalize_ja_nein(row["Aufzug"]),
                    "Rolltreppe": normalize_ja_nein(row["Rolltreppe"]),
                    "Rampe": row["Rampe"].strip(),
                }
                order.append(key)
    return expanded, order


def load_aufzug_hinweise(fahrtrichtungen_path, haltestellen_path):
    """Aggregiert Aufzug-Fahrtrichtungen aus fahrtrichtungen.json pro Kurzname.

    fahrtrichtungen.json ist pro Aufzug/Zugang ("bereich" wie A1/A2) erfasst,
    nicht pro Gleis - ein einzelner Aufzug kann mehrere Gleise/Ebenen
    gleichzeitig verbinden (siehe NSG: bereich A2 verbindet sowohl Gleis 1
    als auch Gleis 3). Eine Gleis-Zuordnung waere daher oft falsch, deshalb
    nur als Haltestellen-weiter Hinweistext ohne Gleis-Bezug.
    """
    if not fahrtrichtungen_path.exists() or not haltestellen_path.exists():
        return {}

    with open(haltestellen_path, encoding="utf-8") as f:
        hst = json.load(f)
    name_to_kurz = {}
    for feat in hst["features"]:
        p = feat["properties"]
        name_to_kurz.setdefault(p["Name"], set()).add(p["Kurzname"])

    def kurzname_for(halt):
        base = re.sub(r"\s*\([^)]*\)\s*$", "", halt).strip()
        kurz = name_to_kurz.get(base) or name_to_kurz.get(halt)
        return next(iter(kurz)) if kurz else None

    with open(fahrtrichtungen_path, encoding="utf-8") as f:
        fahrtrichtungen = json.load(f)

    hinweise = {}
    for f in fahrtrichtungen:
        kurz = kurzname_for(f["halt"])
        if not kurz:
            continue
        hinweise.setdefault(kurz, []).append(f"{f['bereich']}: {f['beschreibung']}")

    return {kurz: " | ".join(parts) for kurz, parts in hinweise.items()}


def extract_pdf_rows(path):
    with pdfplumber.open(path) as pdf:
        words = pdf.pages[0].extract_words()

    kurzname, name_from_file = kurzname_and_name_from_filename(path)
    if kurzname in DB_KONTAMINIERTE_LAGEPLAENE:
        return []
    kurzname = KURZNAME_REMAP.get(kurzname, kurzname)
    aufzug_pdf, rolltreppe_pdf = station_level_flags(words)

    rows = row_segments(words)
    anchors = find_gleis_anchors(rows)
    entries = find_line_entries(rows)
    assigned, _ = assign_to_gleis(entries, anchors)

    out = []
    for gleis, e in assigned:
        linie, fahrtrichtung = parse_entry(e["text"])
        out.append(
            {
                "kurzname": kurzname,
                "name_from_file": name_from_file,
                "gleis": gleis,
                "linie": linie,
                "fahrtrichtung": fahrtrichtung,
                "aufzug_pdf": aufzug_pdf,
                "rolltreppe_pdf": rolltreppe_pdf,
            }
        )
    return out


def merge_row(base, pdf_row, kurzname, linie, aufzug_hinweise):
    """Baut eine Ausgabezeile; Basis-Werte gewinnen, PDF-Werte fuellen Luecken."""
    base = base or {}
    return {
        "Kurzname": kurzname,
        "Haltestelle": base.get("Haltestelle") or (pdf_row["name_from_file"] if pdf_row else ""),
        "Linie": linie,
        "Gleis": base.get("Gleis") or (pdf_row["gleis"] if pdf_row else ""),
        "Fahrtrichtung": pdf_row["fahrtrichtung"] if pdf_row else "",
        "Barrierefreiheit": base.get("Barrierefreiheit", ""),
        "Ebene": base.get("Ebene", ""),
        "Ausstieg_aus_der_Bahn": base.get("Ausstieg_aus_der_Bahn", ""),
        "Aufzug": base.get("Aufzug") or (pdf_row["aufzug_pdf"] if pdf_row else ""),
        "Rolltreppe": base.get("Rolltreppe") or (pdf_row["rolltreppe_pdf"] if pdf_row else ""),
        "Rampe": base.get("Rampe", ""),
        "Aufzug_Fahrtrichtung_Hinweis": aufzug_hinweise.get(kurzname, ""),
    }


def main():
    base_lookup, base_order = load_base(BASE_CSV)
    aufzug_hinweise = load_aufzug_hinweise(FAHRTRICHTUNGEN_JSON, HALTESTELLEN_JSON)
    pdf_files = sorted(LAGEPLAENE_DIR.glob("*.pdf"))

    all_pdf_rows = []
    for path in pdf_files:
        try:
            all_pdf_rows.extend(extract_pdf_rows(path))
        except Exception as exc:
            print(f"  FEHLER beim Lesen von {path.name}: {exc}")

    output_rows = []
    matched_keys = set()
    pdf_rows_ohne_basis = []

    for pdf_row in all_pdf_rows:
        key = (pdf_row["kurzname"], pdf_row["linie"])
        base = base_lookup.get(key)
        if base is not None:
            matched_keys.add(key)
        else:
            pdf_rows_ohne_basis.append(pdf_row)
        output_rows.append(merge_row(base, pdf_row, key[0], key[1], aufzug_hinweise))

    base_ohne_pdf = []
    for key in base_order:
        if key in matched_keys:
            continue
        kurzname, linie = key
        output_rows.append(merge_row(base_lookup[key], None, kurzname, linie, aufzug_hinweise))
        base_ohne_pdf.append(key)

    output_rows.sort(key=lambda r: (r["Kurzname"], r["Linie"], r["Gleis"]))

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "Kurzname",
                "Haltestelle",
                "Linie",
                "Gleis",
                "Fahrtrichtung",
                "Barrierefreiheit",
                "Ebene",
                "Ausstieg_aus_der_Bahn",
                "Aufzug",
                "Rolltreppe",
                "Rampe",
                "Aufzug_Fahrtrichtung_Hinweis",
            ],
            delimiter=";",
        )
        writer.writeheader()
        writer.writerows(output_rows)

    print(f"\n{len(output_rows)} Zeilen geschrieben -> {OUTPUT_CSV}\n")

    print("=== QA-Report ===")
    print(f"PDFs ohne jede KVB-Stadtbahnlinie (S-Bahn/Bus, korrekt uebersprungen): {sorted(KEINE_STADTBAHN)}")
    print(
        f"PDFs mit DB-Regionalzug-Kontamination (RE/RB/RRX), komplett uebersprungen "
        f"bis manuell nachgetragen: {sorted(DB_KONTAMINIERTE_LAGEPLAENE)}"
    )

    if pdf_rows_ohne_basis:
        print(f"\nPDF-Linien OHNE Basis-Eintrag ({len(pdf_rows_ohne_basis)}) - bitte in {BASE_CSV.name} ergaenzen:")
        seen = set()
        for r in pdf_rows_ohne_basis:
            k = (r["kurzname"], r["linie"])
            if k in seen:
                continue
            seen.add(k)
            print(f"  {r['kurzname']:5s} ({r['name_from_file']}): Linie {r['linie']}")

    stations_ohne_pdf = sorted({k[0] for k in base_ohne_pdf})
    print(f"\nBasis-Kurznamen ohne (oder mit unvollstaendiger) PDF-Zuordnung: {len(stations_ohne_pdf)}")
    print("  (erwartet fuer alle Haltestellen ausserhalb der 67 Lageplan-PDFs)")


if __name__ == "__main__":
    main()
