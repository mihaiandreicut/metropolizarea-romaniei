# -*- coding: utf-8 -*-
"""
infrastructura.py — indicatorii de infrastructură esențială pe UAT.

Pentru fiecare UAT: rețeaua de apă, de canalizare și de gaze (km), străzile
orășenești și câte sunt modernizate, bibliotecile și populația școlară. Sursa e
INS TEMPO, matricele pe localități, ultimul an publicat pentru fiecare UAT.

Ce NU există la INS pe UAT: starea drumurilor comunale. Pentru comune, singurul
semn oficial e cheltuiala pe drumuri din execuția bugetară (unelte/finante.py).

Independent: doar biblioteca standard.
Rulare:  python unelte/infrastructura.py [--surse DIR] [--forteaza]
"""

import argparse
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request

AGENT = "ro-adp/1.0 (harta administrativa)"
TEMPO = "http://statistici.insse.ro:8077/tempo-ins"
CALE_UAT = "date/romania-uat.json"
CALE_LOCALITATI = "date/localitati.json"
CALE_IESIRE = "date/infrastructura-uat.json"
ANI = 3   # câți ani înapoi se cer; se păstrează ultimul cu valoare

# matricea, cheia din ieșire, categoriile cerute (pentru matricele cu dimensiuni în plus;
# valorile categoriilor alese se adună), descrierea
MATRICE = [
    ("GOS106B", "apa", None, "rețeaua de distribuție a apei potabile, km"),
    ("GOS110A", "canal", None, "conductele de canalizare, km"),
    ("GOS116A", "gaze", None, "conductele de distribuție a gazelor, km"),
    ("GOS104A", "strazi", None, "străzile orășenești, km (doar municipii și orașe)"),
    ("GOS105A", "straziModernizate", None, "străzile orășenești modernizate, km"),
    ("ART101B", "biblioteci", ("Total",), "bibliotecile, număr"),
    ("SCL103D", "elevi", ("Total",), "populația școlară, persoane"),
    ("SAN101B", "spitale", ("Spitale", "Proprietate publica", "Proprietate mixta", "Proprietate privata"),
     "spitalele, publice și private, număr"),
    ("SAN101B", "spitalePublice", ("Spitale", "Proprietate publica"), "spitalele publice, număr"),
]


def cere(cale, corp=None, incercari=3):
    """GET sau POST (JSON) către TEMPO, cu reluare la erori trecătoare."""
    date = json.dumps(corp).encode("utf-8") if corp is not None else None
    antete = {"User-Agent": AGENT}
    if date is not None:
        antete["Content-Type"] = "application/json"
    for k in range(incercari):
        try:
            cerere = urllib.request.Request(f"{TEMPO}/{cale}", data=date, headers=antete)
            with urllib.request.urlopen(cerere, timeout=90) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError) as e:
            if k == incercari - 1:
                raise
            time.sleep(2 * (k + 1))
    return ""


def matrice(cod, cheie, categorii, surse, forteaza, pauza):
    """Întoarce {siruta: (valoare, an)} pentru o matrice, cerută județ cu județ."""
    cale = os.path.join(surse, "tempo", f"{cod}-{cheie}.json")
    if os.path.exists(cale) and not forteaza:
        with open(cale, encoding="utf-8") as f:
            return {int(k): tuple(v) for k, v in json.load(f).items()}

    meta = json.loads(cere(f"matrix/{cod}?lang=ro"))
    det = meta["details"]
    dims = meta["dimensionsMap"]
    i_jud, i_loc, i_an = det["nomJud"] - 1, det["nomLoc"] - 1, det["matTime"] - 1
    ani = dims[i_an]["options"][-ANI:]
    sume = {}   # (siruta, an) -> suma valorilor din categoriile alese
    for judet in dims[i_jud]["options"]:
        if judet["label"].strip().upper() == "TOTAL":
            continue
        localitati = [o for o in dims[i_loc]["options"] if o.get("parentId") == judet["nomItemId"]]
        if not localitati:
            continue
        alese = []
        for k, dim in enumerate(dims):
            if k == i_jud:
                alese.append([judet])
            elif k == i_loc:
                alese.append(localitati)
            elif k == i_an:
                alese.append(ani)
            elif categorii and len(dim["options"]) > 1:
                alese.append([o for o in dim["options"] if o["label"].strip() in categorii] or dim["options"])
            else:
                alese.append(dim["options"])
        interogare = ":".join(",".join(str(o["nomItemId"]) for o in a) for a in alese)
        text = cere("pivot", {
            "language": "ro", "encQuery": interogare, "matCode": cod,
            "matMaxDim": det["matMaxDim"], "matRegJ": det["matRegJ"], "matUMSpec": det["matUMSpec"]
        })
        for linie in text.splitlines()[1:]:
            campuri = [c.strip() for c in linie.split(",")]
            siruta = next((re.match(r"(\d+) ", c + " ") for c in campuri if re.match(r"\d{3,6} \D", c)), None)
            an = next((re.match(r"Anul (\d{4})", c) for c in campuri if c.startswith("Anul ")), None)
            try:
                valoare = float(campuri[-1])
            except ValueError:
                continue
            if not siruta or not an:
                continue
            cheie_an = (int(siruta.group(1)), int(an.group(1)))
            sume[cheie_an] = sume.get(cheie_an, 0) + valoare
        if pauza:
            time.sleep(pauza)
    rezultat = {}
    for (s, a), valoare in sume.items():
        if s not in rezultat or a > rezultat[s][1]:
            rezultat[s] = (valoare, a)

    os.makedirs(os.path.dirname(cale), exist_ok=True)
    with open(cale, "w", encoding="utf-8") as f:
        json.dump(rezultat, f)
    return rezultat


def principal():
    ap = argparse.ArgumentParser(description="Indicatorii de infrastructură esențială pe UAT (INS TEMPO).")
    ap.add_argument("--surse", default=os.path.join(tempfile.gettempdir(), "ro-adp-surse"))
    ap.add_argument("--forteaza", action="store_true", help="cere din nou, ignorând copiile locale")
    arg = ap.parse_args()

    if not os.path.exists(CALE_UAT):
        print(f"Lipsește {CALE_UAT}. Rulează întâi unelte/prelucrare.py.")
        return 1
    with open(CALE_UAT, encoding="utf-8") as f:
        cunoscute = {u["s"] for u in json.load(f)["uat"]}

    uat, ani, campuri = {}, {}, {}
    for k, (cod, cheie, categorii, descriere) in enumerate(MATRICE, 1):
        try:
            valori = matrice(cod, cheie, categorii, arg.surse, arg.forteaza, 0.15)
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as e:
            print(f"{k}/{len(MATRICE)} {cod}: nu s-a putut lua ({type(e).__name__}: {e})")
            continue
        potrivite = 0
        for siruta, (valoare, an) in valori.items():
            if siruta not in cunoscute:
                continue
            uat.setdefault(str(siruta), {})[cheie] = round(valoare, 1)
            ani[cheie] = max(ani.get(cheie, 0), an)
            potrivite += 1
        campuri[cheie] = f"{descriere} (INS TEMPO, {cod})"
        print(f"{k}/{len(MATRICE)} {cod} {cheie}: {potrivite} UAT-uri, ultimul an {ani.get(cheie)}")

    # unitățile de învățământ pe UAT, din lista localităților (prelucrare.py): INS numără doar
    # unitățile cu personalitate juridică, aici intră și structurile din sate
    if os.path.exists(CALE_LOCALITATI):
        with open(CALE_LOCALITATI, encoding="utf-8") as f:
            localitati = json.load(f)["localitati"]
        for loc in localitati:
            sc = loc.get("sc")
            if not sc or loc.get("u") not in cunoscute:
                continue
            rand = uat.setdefault(str(loc["u"]), {})
            rand["scoli"] = rand.get("scoli", 0) + sum(sc)
            rand["licee"] = rand.get("licee", 0) + sc[3]
        campuri["scoli"] = "unitățile de învățământ, cu structurile din sate (date/localitati.json)"
        campuri["licee"] = "din care licee"
        print(f"   școli: {sum(1 for v in uat.values() if v.get('scoli'))} UAT-uri")

    if not uat:
        print("Nicio matrice nu a putut fi luată; fișierul de ieșire rămâne neschimbat.")
        return 1
    iesire = {
        "versiune": 1,
        "generat": time.strftime("%Y-%m-%d"),
        "campuri": campuri,
        "ani": ani,
        "uat": uat,
        "surse": ["INS TEMPO (statistici.insse.ro), matricele pe județe și localități"],
        "nota": "Un UAT fără valoare la apă, canalizare sau gaze nu are rețea publică raportată la INS. "
                "Străzile există doar pentru municipii și orașe; pentru drumurile comunale INS nu publică "
                "date pe UAT."
    }
    with open(CALE_IESIRE, "w", encoding="utf-8") as f:
        json.dump(iesire, f, ensure_ascii=False, separators=(",", ":"))
    print(f"scris {CALE_IESIRE} ({os.path.getsize(CALE_IESIRE)} octeți)")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
