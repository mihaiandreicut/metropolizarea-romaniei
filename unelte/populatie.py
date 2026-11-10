# -*- coding: utf-8 -*-
"""
populatie.py — populația de referință a fiecărui UAT: populația rezidentă estimată la
1 ianuarie, ultimul an publicat de INS.

INS publică anual populația rezidentă (cei care locuiesc efectiv aici de cel puțin 12 luni)
doar pe județe, iar pe UAT doar populația după domiciliu, care îi numără și pe cei plecați
din țară fără să-și schimbe buletinul — în zonele de emigrare, cu până la jumătate peste
cei care locuiesc acolo. De aceea, populația unui UAT se estimează:

    1. punctul de plecare e recensământul din 2021 (populația rezidentă, p21);
    2. se aplică evoluția UAT-ului după domiciliu între anul recensământului și anul cerut
       (TEMPO, POP107D): pondere = p21 × domiciliu(an) / domiciliu(2021);
    3. ponderile se aduc, pe fiecare județ și mediu (urban / rural), la populația rezidentă
       publicată de INS pentru anul cerut (TEMPO, POP105A).

Evoluția după domiciliu nu e mereu mutare reală: în unele comune (mai ales pe Prut — Hănești,
Cozmești, Ferești, Bogdana) numărul celor cu domiciliul acolo s-a dublat în cinci ani fără ca
satele să crească, prin înscrieri în masă la domiciliu. De aceea factorul domiciliu(an) /
domiciliu(2021) e plafonat la [0,85; 1,15], cu o excepție: zonele periurbane, unde oamenii chiar
se mută — UAT-urile dintr-o zonă urbană funcțională (Eurostat, date/zone-urbane-functionale.json)
sau vecine cu un municipiu, dacă domiciliul lor din 2021 nu depășea deja recensământul cu peste
30% (semn că acolo sunt înscriși mulți care nu locuiesc acolo). Pentru ele rămâne doar pragul de jos.

Scrie date/populatie-uat.json și adaugă în date/romania-uat.json câmpurile „pop” (populația
rezidentă estimată, cea folosită de hartă, raport și unelte) și „pd” (populația după
domiciliu, ca informație), plus metadatele „populatie”, fără să atingă restul fișierului.

Sursele, în ordinea în care se încearcă:
  1. --csv-domiciliu / --csv-rezidenti: exporturile POP107D (pe localități, anii 2021 și
     anul cerut) și POP105A (pe județe și medii, anul cerut) din TEMPO-Online
     (statistici.insse.ro:8077); se însumează grupele de vârstă, sexele (și mediile, unde e cazul).
  2. Oglinda publică a bazei TEMPO (api-ins.gov2.ro, proiectul gov2-ro/tempo-ins-dump).

Verificări: fiecare UAT are valoare; totalurile pe țară se tipăresc, ca să fie comparate cu
comunicatele INS (1 ianuarie 2026: rezidenți 19.041.322, după domiciliu 21.646.220).

Independent: doar biblioteca standard.
Rulare:  python unelte/populatie.py [--an 2026] [--csv-domiciliu F] [--csv-rezidenti F]
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict

RADACINA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CALE_UAT = os.path.join(RADACINA, "date", "romania-uat.json")
CALE_IESIRE = os.path.join(RADACINA, "date", "populatie-uat.json")
CALE_FUA = os.path.join(RADACINA, "date", "zone-urbane-functionale.json")
OGLINDA = "https://api-ins.gov2.ro/api/datasets/"
AGENT = "ro-adp/1.0 (harta administrativa)"
AN_RECENSAMANT = 2021
FACTOR_MIN, FACTOR_MAX = 0.85, 1.15       # evoluția după domiciliu acceptată în afara periurbanului
DOMICILIU_UMFLAT = 1.30                   # domiciliu 2021 / recensământ peste care evoluția e suspectă


def coloana(rand, *nume):
    for n in nume:
        for k in rand:
            if k and k.strip().lower() == n.lower():
                return rand[k]
    return None


def fara_diacritice(text):
    t = unicodedata.normalize("NFD", str(text or ""))
    return "".join(c for c in t if unicodedata.category(c) != "Mn").upper().replace("MUNICIPIUL ", "").strip()


def randuri(text):
    """Rândurile unui export TEMPO, fără totalurile (care s-ar aduna peste detalii)."""
    for rand in csv.DictReader(io.StringIO(text)):
        varsta = (coloana(rand, "AGE", "grupe", "Varste si grupe de varsta") or "").strip().lower()
        sex = (coloana(rand, "SEX", "Sexe") or "").strip().lower()
        mediu = (coloana(rand, "RESIDENCE", "Medii de rezidenta") or "").strip().lower()
        valoare = coloana(rand, "OBS_VALUE", "Valoare", "valoare")
        if valoare in (None, "") or varsta == "total" or sex in ("total", "ambele sexe") or mediu == "total":
            continue
        an = int(re.sub(r"\D", "", coloana(rand, "TIME_PERIOD", "Ani", "Perioade") or "0") or 0)
        yield rand, an, float(valoare), mediu


def domiciliu(text):
    """POP107D: {(siruta, an): populația după domiciliu}."""
    pop = defaultdict(float)
    for rand, an, valoare, _ in randuri(text):
        m = re.match(r"\s*(\d+)\s", coloana(rand, "REF_AREA_2", "Localitati", "localitate") or "")
        if m:
            pop[(int(m.group(1)), an)] += valoare
    return pop


def rezidenti(text):
    """POP105A: {(județ fără diacritice, "urban" | "rural", an): populația rezidentă}."""
    pop = defaultdict(float)
    for rand, an, valoare, mediu in randuri(text):
        judet = fara_diacritice(coloana(rand, "REF_AREA", "judete", "Judete") or "")
        if judet and mediu in ("urban", "rural"):
            pop[(judet, mediu, an)] += valoare
    return pop


def din_oglinda(set_date, ani):
    filtre = urllib.parse.quote(json.dumps({"TIME_PERIOD": [str(a) for a in ani]}))
    url = f"{OGLINDA}{set_date}/download?format=csv&lang=ro&filters={filtre}"
    for k in range(3):
        try:
            cerere = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(cerere, timeout=600) as r:
                return r.read().decode("utf-8")
        except Exception:
            if k == 2:
                raise
            time.sleep(3 * (k + 1))
    return ""


def vecini(harta):
    """{siruta: {sirutele vecinilor}}: UAT-urile care împart un arc al limitei (TopoJSON)."""
    arce = defaultdict(set)

    def aduna(x, s):
        if isinstance(x, list):
            for y in x:
                aduna(y, s)
        else:
            arce[~x if x < 0 else x].add(s)
    for u in harta["uat"]:
        aduna(u["i"], u["s"])
    v = defaultdict(set)
    for coduri in arce.values():
        for s in coduri:
            v[s] |= coduri - {s}
    return v


def periurbane(harta, dom):
    """UAT-urile unde creșterea după domiciliu e luată ca mutare reală (vezi descrierea)."""
    with open(CALE_FUA, encoding="utf-8") as f:
        fua = {s for z in json.load(f)["fua"].values() for s in z["uat"]}
    municipii = {u["s"] for u in harta["uat"] if u["t"] == "municipiu"}
    v = vecini(harta)
    rez = set()
    for u in harta["uat"]:
        d0, p21 = dom.get((u["s"], AN_RECENSAMANT)), u.get("p21")
        if (u["s"] in fua or v[u["s"]] & municipii) and not (d0 and p21 and d0 > DOMICILIU_UMFLAT * p21):
            rez.add(u["s"])
    return rez


def citeste(cale):
    with open(cale, encoding="utf-8-sig") as f:
        return f.read()


def principal():
    a = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    a.add_argument("--an", type=int, default=2026)
    a.add_argument("--csv-domiciliu", help="export POP107D (localități; anii 2021 și --an)")
    a.add_argument("--csv-rezidenti", help="export POP105A (județe și medii; anul --an)")
    a = a.parse_args()

    oglinda = not (a.csv_domiciliu and a.csv_rezidenti)
    if oglinda:
        print(f"descarc POP107D ({AN_RECENSAMANT}, {a.an}) și POP105A ({a.an}) din oglinda TEMPO …")
    dom = domiciliu(citeste(a.csv_domiciliu) if a.csv_domiciliu
                    else din_oglinda("POP107D_grupe_localitate", [AN_RECENSAMANT, a.an]))
    rez = rezidenti(citeste(a.csv_rezidenti) if a.csv_rezidenti
                    else din_oglinda("POP105A_judete_grupe", [a.an]))

    with open(CALE_UAT, encoding="utf-8") as f:
        harta = json.load(f)
    nume_judet = {j["c"]: fara_diacritice(j["n"]) for j in harta["judete"]}
    lipsa = [u["s"] for u in harta["uat"] if (u["s"], a.an) not in dom]
    if lipsa:
        print(f"EROARE: {len(lipsa)} UAT-uri fără domiciliu în {a.an}: {lipsa[:10]}", file=sys.stderr)
        return 1

    # pondere = recensământul × evoluția după domiciliu de la recensământ încoace (plafonată)
    periurban = periurbane(harta, dom)
    pondere, grupe, plafonate = {}, defaultdict(list), {}
    for u in harta["uat"]:
        d0, d1 = dom.get((u["s"], AN_RECENSAMANT)), dom[(u["s"], a.an)]
        baza = u.get("p21") or d1
        factor = d1 / d0 if d0 else 1
        limitat = max(FACTOR_MIN, factor if u["s"] in periurban else min(FACTOR_MAX, factor))
        if limitat != factor:
            plafonate[str(u["s"])] = round(factor, 3)
        pondere[u["s"]] = baza * limitat
        mediu = "rural" if u["t"] == "comună" else "urban"
        grupe[(nume_judet[u["j"]], mediu)].append(u["s"])
    estimat = {}
    for (judet, mediu), coduri in grupe.items():
        tinta = rez.get((judet, mediu, a.an))
        if tinta is None:
            print(f"EROARE: lipsește populația rezidentă {judet} / {mediu} / {a.an}", file=sys.stderr)
            return 1
        suma = sum(pondere[c] for c in coduri) or 1
        for c in coduri:
            estimat[c] = tinta * pondere[c] / suma

    total_rez = sum(estimat.values())
    total_dom = sum(dom[(u["s"], a.an)] for u in harta["uat"])
    fmt = lambda v: f"{round(v):,}".replace(",", ".")
    print(f"{len(estimat)} UAT-uri; la 1 ianuarie {a.an}: rezidenți {fmt(total_rez)}, după domiciliu {fmt(total_dom)}")
    print(f"{len(periurban)} UAT-uri periurbane; {len(plafonate)} cu evoluția după domiciliu plafonată")

    sursa = ("INS — TEMPO: recensământul 2021 (RPL 2021), evoluția după domiciliu pe localități (POP107D) "
             f"și populația rezidentă pe județe și medii (POP105A), 1 ianuarie {a.an}"
             + (" — prin oglinda publică api-ins.gov2.ro (gov2-ro/tempo-ins-dump)" if oglinda else " — exporturi TEMPO-Online"))
    iesire = {
        "versiune": 2,
        "generat": time.strftime("%Y-%m-%d"),
        "an": a.an,
        "referinta": f"1 ianuarie {a.an}",
        "tip": "populația rezidentă estimată",
        "sursa": sursa,
        "metoda": "Recensământul 2021 al fiecărui UAT, înmulțit cu evoluția lui după domiciliu de atunci, "
                  "apoi adus, pe fiecare județ și mediu (urban / rural), la populația rezidentă publicată de INS. "
                  f"Evoluția e plafonată la [{FACTOR_MIN}; {FACTOR_MAX}] în afara zonelor periurbane (zonă urbană "
                  "funcțională Eurostat sau vecinătatea unui municipiu), ca înscrierile în masă la domiciliu "
                  "să nu treacă drept locuitori.",
        "plafonate": plafonate,
        "nota": "Populația după domiciliu (câmpul „domiciliu”) e mai mare decât cea rezidentă acolo unde mulți "
                "au plecat fără să-și schimbe domiciliul; INS publică populația rezidentă doar pe județe.",
        "totalRezident": round(total_rez),
        "totalDomiciliu": round(total_dom),
        "uat": {str(u["s"]): round(estimat[u["s"]]) for u in harta["uat"]},
        "domiciliu": {str(u["s"]): round(dom[(u["s"], a.an)]) for u in harta["uat"]},
    }
    with open(CALE_IESIRE, "w", encoding="utf-8") as f:
        json.dump(iesire, f, ensure_ascii=False, separators=(",", ":"))
    print("scris", CALE_IESIRE)

    # romania-uat.json: același format compact, doar câmpurile „pop”, „pd” și metadatele
    harta["populatie"] = {"camp": "pop", "an": a.an, "referinta": iesire["referinta"], "tip": iesire["tip"],
                          "sursa": sursa}
    for u in harta["uat"]:
        u["pop"] = iesire["uat"][str(u["s"])]
        u["pd"] = iesire["domiciliu"][str(u["s"])]
    with open(CALE_UAT, "w", encoding="utf-8") as f:
        json.dump(harta, f, ensure_ascii=False, separators=(",", ":"))
    print("actualizat", CALE_UAT)
    return 0


if __name__ == "__main__":
    sys.exit(principal())
