# -*- coding: utf-8 -*-
"""
populatie.py — populația de referință a fiecărui UAT: populația după domiciliu la
1 ianuarie, ultimul an publicat de INS (TEMPO, matricea POP107D).

Scrie date/populatie-uat.json și adaugă câmpul „pop” (plus metadatele „populatie”)
în date/romania-uat.json, fără să atingă restul fișierului. Harta, raportul și
scripturile din unelte/ folosesc „pop” ca populație de azi; „p21” rămâne
recensământul din 2021, pentru structura etnică și pe vârste.

Sursa, în ordinea în care se încearcă:
  1. --csv FIȘIER: un export POP107D pe localități, cu coloanele
     grupe/AGE, Sexe/SEX, Localitati/REF_AREA_2 („1017 MUNICIPIUL ALBA IULIA”),
     Ani/TIME_PERIOD („2026” sau „Anul 2026”) și valoarea (OBS_VALUE/Valoare);
     se însumează toate grupele de vârstă și ambele sexe. Exportul se face din
     TEMPO-Online (statistici.insse.ro:8077), matricea POP107D.
  2. Oglinda publică a bazei TEMPO (api-ins.gov2.ro, proiectul gov2-ro/tempo-ins-dump),
     setul POP107D_grupe_localitate.

Verificări: fiecare UAT din hartă are valoare; totalul pe țară se tipărește, ca să
fie comparat cu comunicatul de presă al INS (1 ianuarie 2026: 21.646,2 mii persoane).

Independent: doar biblioteca standard.
Rulare:  python unelte/populatie.py [--an 2026] [--csv FIȘIER]
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

RADACINA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CALE_UAT = os.path.join(RADACINA, "date", "romania-uat.json")
CALE_IESIRE = os.path.join(RADACINA, "date", "populatie-uat.json")
OGLINDA = "https://api-ins.gov2.ro/api/datasets/POP107D_grupe_localitate"
AGENT = "ro-adp/1.0 (harta administrativa)"
SURSA = "INS — TEMPO, POP107D: populația după domiciliu la 1 ianuarie, pe localități"


def coloana(rand, *nume):
    for n in nume:
        for k in rand:
            if k and k.strip().lower() == n.lower():
                return rand[k]
    return None


def citeste_csv(text, an):
    """Însumează vârstele și sexele pe cod SIRUTA, pentru anul cerut."""
    pop, randuri = defaultdict(float), defaultdict(int)
    for rand in csv.DictReader(io.StringIO(text)):
        loc = coloana(rand, "REF_AREA_2", "Localitati", "localitate")
        an_rand = coloana(rand, "TIME_PERIOD", "Ani", "Perioade")
        valoare = coloana(rand, "OBS_VALUE", "Valoare", "valoare")
        varsta = (coloana(rand, "AGE", "grupe", "Varste si grupe de varsta") or "").strip().lower()
        sex = (coloana(rand, "SEX", "Sexe") or "").strip().lower()
        if not loc or not an_rand or valoare in (None, ""):
            continue
        # totalurile, dacă exportul le are, nu se adună peste detalii
        if varsta == "total" or sex in ("total", "ambele sexe"):
            continue
        m = re.match(r"\s*(\d+)\s", loc)
        if not m or int(re.sub(r"\D", "", an_rand) or 0) != an:
            continue
        cod = int(m.group(1))
        pop[cod] += float(valoare)
        randuri[cod] += 1
    return pop, randuri


def din_oglinda(an):
    filtre = urllib.parse.quote(json.dumps({"TIME_PERIOD": [str(an)]}))
    url = f"{OGLINDA}/download?format=csv&lang=ro&filters={filtre}"
    for k in range(3):
        try:
            cerere = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(cerere, timeout=300) as r:
                return r.read().decode("utf-8")
        except Exception:
            if k == 2:
                raise
            time.sleep(3 * (k + 1))
    return ""


def principal():
    a = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    a.add_argument("--an", type=int, default=2026)
    a.add_argument("--csv", help="export POP107D descărcat manual")
    a = a.parse_args()

    if a.csv:
        with open(a.csv, encoding="utf-8-sig") as f:
            text = f.read()
        sursa = f"{SURSA} (export TEMPO-Online)"
    else:
        print(f"descarc POP107D, anul {a.an}, din oglinda TEMPO …")
        text = din_oglinda(a.an)
        sursa = f"{SURSA} (prin oglinda publică api-ins.gov2.ro, proiectul gov2-ro/tempo-ins-dump)"
    pop, randuri = citeste_csv(text, a.an)

    with open(CALE_UAT, encoding="utf-8") as f:
        harta = json.load(f)
    coduri = [u["s"] for u in harta["uat"]]
    lipsa = [c for c in coduri if c not in pop]
    if lipsa:
        print(f"EROARE: {len(lipsa)} UAT-uri fără valoare în {a.an}: {lipsa[:10]}", file=sys.stderr)
        return 1
    total = sum(pop[c] for c in coduri)
    print(f"{len(coduri)} UAT-uri; total pe țară la 1 ianuarie {a.an}: {round(total):,}".replace(",", "."))

    iesire = {
        "versiune": 1,
        "generat": time.strftime("%Y-%m-%d"),
        "an": a.an,
        "referinta": f"1 ianuarie {a.an}",
        "sursa": sursa,
        "nota": "Populația după domiciliu e mai mare decât cea rezidentă acolo unde mulți locuitori "
                "au plecat fără să-și schimbe domiciliul. INS calculează populația rezidentă doar pe județe.",
        "total": round(total),
        "uat": {str(c): round(pop[c]) for c in coduri},
    }
    with open(CALE_IESIRE, "w", encoding="utf-8") as f:
        json.dump(iesire, f, ensure_ascii=False, separators=(",", ":"))
    print("scris", CALE_IESIRE)

    # romania-uat.json: același format compact, doar câmpul „pop” și metadatele în plus
    harta["populatie"] = {"camp": "pop", "an": a.an, "referinta": iesire["referinta"], "sursa": sursa}
    for u in harta["uat"]:
        u["pop"] = iesire["uat"][str(u["s"])]
    with open(CALE_UAT, "w", encoding="utf-8") as f:
        json.dump(harta, f, ensure_ascii=False, separators=(",", ":"))
    print("actualizat", CALE_UAT)
    return 0


if __name__ == "__main__":
    sys.exit(principal())
