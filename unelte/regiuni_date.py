# -*- coding: utf-8 -*-
"""
regiuni_date.py — datele pentru nivelul al doilea al reorganizării: județele
grupate în regiuni.

Adună trei lucruri și le scrie în date/regiuni-institutii.json:

  1. Instituțiile cu circumscripție regională, adică rețelele care arată ce
     orașe sunt deja centre peste nivelul județului: curțile de apel, camerele
     notarilor publici (una în circumscripția fiecărei curți de apel, Legea
     36/1995 art. 41), direcțiile generale regionale ale finanțelor publice și
     agențiile pentru dezvoltare regională. Circumscripțiile sunt scrise aici
     ca tabele, cu temeiul legal alături — nu există un registru deschis din
     care să fie citite.
  2. Economia județelor și a regiunilor, de la Eurostat: PIB pe locuitor și PIB
     total la nivel NUTS3 (județ), remunerarea salariaților și orele lucrate la
     nivel NUTS2 (regiune de dezvoltare), pe total și pe sectoare — de aici ies
     câștigul mediu pe oră și structura lui.
  3. Centrul de greutate al fiecărui județ, ponderat cu populația UAT-urilor,
     pentru distanțele până la o viitoare capitală de regiune.

Independent: doar biblioteca standard, fără alte module ale proiectului.
Rulare:  python unelte/regiuni_date.py [--surse DIR] [--fara-retea]
"""

import argparse
import json
import os
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.request
from math import asin, cos, radians, sin, sqrt

AGENT = "e-ro-adp/1.0 (harta administrativa a Romaniei; date publice)"
EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
AN_ECONOMIE = 2022          # ultimul an cu date regionale complete la Eurostat
CALE_UAT = "date/romania-uat.json"
CALE_IESIRE = "date/regiuni-institutii.json"

# --- circumscripțiile instituțiilor regionale, pe numere de înmatriculare ------
# Curțile de apel: Legea 304/2022 privind organizarea judiciară, anexa nr. 1.
CURTI_APEL = {
    "Alba Iulia": ["AB", "HD", "SB"],
    "Bacău": ["BC", "NT"],
    "Brașov": ["BV", "CV"],
    "București": ["B", "CL", "GR", "IL", "IF", "TR"],
    "Cluj-Napoca": ["CJ", "BN", "MM", "SJ"],
    "Constanța": ["CT", "TL"],
    "Craiova": ["DJ", "GJ", "MH", "OT"],
    "Galați": ["GL", "BR", "VN"],
    "Iași": ["IS", "VS"],
    "Oradea": ["BH", "SM"],
    "Pitești": ["AG", "VL"],
    "Ploiești": ["PH", "BZ", "DB"],
    "Suceava": ["SV", "BT"],
    "Timișoara": ["TM", "AR", "CS"],
    "Târgu Mureș": ["MS", "HR"],
}

# Direcțiile generale regionale ale finanțelor publice (ANAF), HG 520/2013.
DGRFP = {
    "Brașov": ["BV", "AB", "CV", "HR", "MS", "SB"],
    "Cluj-Napoca": ["CJ", "BH", "BN", "MM", "SM", "SJ"],
    "Craiova": ["DJ", "GJ", "MH", "OT", "VL"],
    "Galați": ["GL", "BR", "BZ", "CT", "TL", "VN"],
    "Iași": ["IS", "BC", "BT", "NT", "SV", "VS"],
    "Ploiești": ["PH", "AG", "CL", "DB", "GR", "IL", "TR"],
    "Timișoara": ["TM", "AR", "CS", "HD"],
    "București": ["B", "IF"],
}

SISTEME = [
    {
        "cod": "curte-apel",
        "nume": "Curți de apel",
        "temei": "Legea 304/2022, anexa nr. 1",
        "sursa": "portal.just.ro",
        "circumscriptii": CURTI_APEL,
        "nota": "Cea mai veche rețea regională a statului: 15 circumscripții, în mare parte "
                "neschimbate de la reforma judiciară interbelică.",
    },
    {
        "cod": "camera-notari",
        "nume": "Camerele notarilor publici",
        "temei": "Legea 36/1995, art. 41",
        "sursa": "Uniunea Națională a Notarilor Publici",
        "circumscriptii": CURTI_APEL,
        "nota": "În circumscripția fiecărei curți de apel funcționează o cameră a notarilor "
                "publici, deci rețeaua notarială copiază rețeaua judiciară.",
    },
    {
        "cod": "dgrfp",
        "nume": "Direcții generale regionale ale finanțelor publice",
        "temei": "HG 520/2013",
        "sursa": "ANAF",
        "circumscriptii": DGRFP,
        "nota": "Opt direcții regionale, cu limite apropiate de regiunile de dezvoltare, dar nu "
                "identice: Hunedoara ține de Timișoara, Vâlcea de Craiova.",
    },
]

# ---------------------------------------------------------------- utilitare


def descarca(url, cale, forteaza=False, incercari=3):
    """Descarcă o singură dată, apoi folosește copia locală."""
    if os.path.exists(cale) and not forteaza:
        with open(cale, "rb") as f:
            return f.read()
    ctx = ssl.create_default_context()
    for i in range(incercari):
        try:
            cerere = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(cerere, timeout=120, context=ctx) as r:
                continut = r.read()
            os.makedirs(os.path.dirname(cale), exist_ok=True)
            with open(cale, "wb") as f:
                f.write(continut)
            return continut
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"   {url.split('/')[-1][:60]} — {e} (încercarea {i + 1})")
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"nu s-a putut descărca: {url}")


def eurostat(nume, interogare, surse, forteaza=False):
    """Un tabel Eurostat, întors ca {cod geo: valoare} pentru anul cerut."""
    url = f"{EUROSTAT}{nume}?format=JSON&lang=en&{interogare}"
    cale = os.path.join(surse, f"eurostat-{nume}-{abs(hash(interogare)) % 10 ** 8}.json")
    d = json.loads(descarca(url, cale, forteaza))
    geo = d["dimension"]["geo"]["category"]["index"]
    valori = d["value"]
    # indexul global al unei valori = suma produselor indecșilor pe dimensiuni; cu o
    # singură opțiune pe restul dimensiunilor, rămâne chiar indexul lui geo
    return {cod: valori.get(str(poz)) for cod, poz in geo.items() if valori.get(str(poz)) is not None}


def fara_diacritice(text):
    tabel = str.maketrans("ăâîșşțţĂÂÎȘŞȚŢ", "aaissttAAISSTT")
    return text.translate(tabel).lower().strip()


def eurostat_etichete(nume, interogare, surse, forteaza=False):
    """{cod geo: nume} pentru un tabel Eurostat — folosit la potrivirea județelor."""
    url = f"{EUROSTAT}{nume}?format=JSON&lang=en&{interogare}"
    cale = os.path.join(surse, f"eurostat-{nume}-{abs(hash(interogare)) % 10 ** 8}.json")
    d = json.loads(descarca(url, cale, forteaza))
    return d["dimension"]["geo"]["category"]["label"]


def distanta(a, b):
    """Kilometri între două puncte [lat, lon] (haversine)."""
    r = 6371.0
    dlat, dlon = radians(b[0] - a[0]), radians(b[1] - a[1])
    h = sin(dlat / 2) ** 2 + cos(radians(a[0])) * cos(radians(b[0])) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(h))


# ---------------------------------------------------------------- prelucrare


def centre_judete(date):
    """Centrul de greutate al fiecărui județ, ponderat cu populația UAT-urilor."""
    acum = {}
    for u in date["uat"]:
        if not u.get("e"):
            continue
        p = max(1, u.get("p21") or 1)
        s = acum.setdefault(u["j"], [0.0, 0.0, 0.0])
        s[0] += u["e"][0] * p
        s[1] += u["e"][1] * p
        s[2] += p
    return {j: [round(s[0] / s[2], 5), round(s[1] / s[2], 5)] for j, s in acum.items()}


def resedinte(date):
    """Reședințele de județ, după numele UAT-ului (pentru sediile instituțiilor)."""
    return {u["n"]: u for u in date["uat"] if u.get("r")}


def economie_judete(date, surse, forteaza):
    """PIB pe locuitor, PIB total și ocuparea, pe județe (NUTS3)."""
    an = AN_ECONOMIE
    interogare = f"unit=EUR_HAB&time={an}&geoLevel=nuts3"
    pib_loc = eurostat("nama_10r_3gdp", interogare, surse, forteaza)
    pib_tot = eurostat("nama_10r_3gdp", f"unit=MIO_EUR&time={an}&geoLevel=nuts3", surse, forteaza)
    ocupati = eurostat("nama_10r_3empers",
                       f"unit=THS&wstatus=EMP&nace_r2=TOTAL&time={an}&geoLevel=nuts3", surse, forteaza)
    # codul NUTS3 din SIRUTA lipsește la câteva județe, așa că se potrivește după nume
    etichete = eurostat_etichete("nama_10r_3gdp", interogare, surse, forteaza)
    dupa_nume = {fara_diacritice(v): k for k, v in etichete.items() if k.startswith("RO") and len(k) == 5}
    dupa_nume.setdefault("bucuresti", dupa_nume.get("municipiul bucuresti"))
    iesire = []
    lipsa = []
    for j in date["judete"]:
        nuts = dupa_nume.get(fara_diacritice(j["n"])) or j.get("nuts")
        if not nuts or nuts not in pib_loc:
            lipsa.append(j["n"])
        iesire.append({
            "c": j["c"],
            "nuts": nuts,
            "auto": j["auto"],
            "pibLoc": pib_loc.get(nuts),
            "pibTotal": pib_tot.get(nuts),
            "ocupati": ocupati.get(nuts),
        })
    if lipsa:
        print(f"   fără date economice: {', '.join(lipsa)}")
    return iesire, an


def economie_regiuni(date, surse, forteaza):
    """Câștigul pe oră lucrată, pe regiuni de dezvoltare (NUTS2) și pe sectoare."""
    an = AN_ECONOMIE
    sectoare = {
        "TOTAL": "toate activitățile",
        "B-E": "industrie",
        "F": "construcții",
        "G-J": "comerț, transport, informații",
        "K-N": "financiar, imobiliare, servicii profesionale",
        "O-U": "administrație, sănătate, educație",
    }
    rezultat = {}
    for cod, eticheta in sectoare.items():
        coe = eurostat("nama_10r_2coe",
                       f"currency=MIO_EUR&nace_r2={cod}&time={an}&geoLevel=nuts2", surse, forteaza)
        ore = eurostat("nama_10r_2emhrw",
                       f"unit=THS&wstatus=SAL&nace_r2={cod}&time={an}&geoLevel=nuts2", surse, forteaza)
        for geo in coe:
            if not geo.startswith("RO") or len(geo) != 4 or geo not in ore or not ore[geo]:
                continue
            r = rezultat.setdefault(geo, {"cod": geo, "sectoare": {}})
            # milioane EUR / mii de ore = EUR pe oră
            r["sectoare"][cod] = {
                "eticheta": eticheta,
                "euroPeOra": round(1000 * coe[geo] / ore[geo], 2),
                "coe": coe[geo],
                "ore": ore[geo],
            }
    # numele regiunilor, din datele proprii (ADR au aceeași împărțire ca NUTS2)
    nume_nuts = {}
    for j in date["judete"]:
        if j.get("nuts"):
            nume_nuts.setdefault(j["nuts"][:4], set()).add(j["adr"])
    for geo, r in rezultat.items():
        coduri = nume_nuts.get(geo, set())
        adr = next((a for a in date["adr"] if a["c"] in coduri), None)
        r["nume"] = adr["n"] if adr else geo
        r["adr"] = adr["c"] if adr else None
        total = r["sectoare"].get("TOTAL")
        r["euroPeOra"] = total["euroPeOra"] if total else None
    return list(rezultat.values()), an


def sisteme_institutii(date):
    """Sediile și circumscripțiile, cu județele traduse în codurile proprii."""
    dupa_auto = {j["auto"]: j["c"] for j in date["judete"]}
    orase = resedinte(date)
    iesire = []
    for s in SISTEME:
        sedii = []
        for oras, judete in s["circumscriptii"].items():
            u = orase.get(oras)
            if not u:
                print(f"   ATENȚIE: sediul „{oras}” nu a fost găsit între reședințele de județ")
                continue
            necunoscute = [a for a in judete if a not in dupa_auto]
            if necunoscute:
                print(f"   ATENȚIE: {oras} — județe necunoscute: {necunoscute}")
            sedii.append({
                "nume": oras,
                "siruta": u["s"],
                "e": u["e"],
                "judete": [dupa_auto[a] for a in judete if a in dupa_auto],
            })
        iesire.append({k: v for k, v in s.items() if k != "circumscriptii"} | {"sedii": sedii})
    # regiunile de dezvoltare, din datele proprii
    adr_judete = {}
    for j in date["judete"]:
        adr_judete.setdefault(j["adr"], []).append(j["c"])
    sedii_adr = []
    # sediul unei agenții e o reședință de județ; numele se compară fără cratimă, fiindcă
    # „Piatra Neamț” e scris și „Piatra-Neamț”, iar „Călărași” e și numele altor comune
    cheie = lambda nume: nume.replace("-", " ")
    dupa_cheie = {cheie(n): u for n, u in orase.items()}
    for a in date["adr"]:
        u = dupa_cheie.get(cheie(a["resedinta"]))
        if not u:
            print(f"   ATENȚIE: sediul „{a['resedinta']}” nu a fost găsit între reședințele de județ")
        sedii_adr.append({
            "nume": a["resedinta"],
            "siruta": u["s"] if u else None,
            "e": u["e"] if u else None,
            "judete": adr_judete.get(a["c"], []),
        })
    iesire.append({
        "cod": "adr",
        "nume": "Agenții pentru dezvoltare regională",
        "temei": "Legea 315/2004",
        "sursa": "date proprii (romania-uat.json)",
        "nota": "Cele opt regiuni de dezvoltare, fără personalitate administrativă: ele "
                "gestionează fondurile europene, dar nu au prefect, consiliu ales sau buget propriu.",
        "sedii": sedii_adr,
    })
    return iesire


def principal():
    ap = argparse.ArgumentParser(description="Datele pentru nivelul regional (instituții + economie).")
    ap.add_argument("--surse", default=os.path.join(tempfile.gettempdir(), "e-ro-adp-surse"))
    ap.add_argument("--forteaza", action="store_true", help="descarcă din nou, ignorând copiile locale")
    ap.add_argument("--fara-retea", action="store_true", help="doar instituțiile și centrele, fără Eurostat")
    arg = ap.parse_args()

    if not os.path.exists(CALE_UAT):
        print(f"Lipsește {CALE_UAT}. Rulează întâi unelte/prelucrare.py.")
        return 1
    with open(CALE_UAT, encoding="utf-8") as f:
        date = json.load(f)

    print("1/3 instituții regionale")
    sisteme = sisteme_institutii(date)
    print(f"   {sum(len(s['sedii']) for s in sisteme)} de sedii în {len(sisteme)} rețele")

    print("2/3 centrele județelor")
    centre = centre_judete(date)
    judete_centru = {j["c"]: centre.get(j["c"]) for j in date["judete"]}

    judete_ec, an_judete, regiuni_ec, an_regiuni = [], None, [], None
    if not arg.fara_retea:
        print("3/3 economie (Eurostat)")
        judete_ec, an_judete = economie_judete(date, arg.surse, arg.forteaza)
        regiuni_ec, an_regiuni = economie_regiuni(date, arg.surse, arg.forteaza)
        print(f"   {len(judete_ec)} de județe, {len(regiuni_ec)} regiuni NUTS2")
    else:
        judete_ec = [{"c": j["c"], "nuts": j.get("nuts"), "auto": j["auto"]} for j in date["judete"]]

    for j in judete_ec:
        j["centru"] = judete_centru.get(j["c"])

    iesire = {
        "versiune": 1,
        "generat": time.strftime("%Y-%m-%d"),
        "anEconomie": {"judete": an_judete, "regiuni": an_regiuni},
        "surse": [
            "Legea 304/2022, anexa nr. 1 — circumscripțiile curților de apel",
            "Legea 36/1995, art. 41 — camerele notarilor publici",
            "HG 520/2013 — direcțiile generale regionale ale finanțelor publice (ANAF)",
            "Legea 315/2004 — regiunile de dezvoltare",
            f"Eurostat nama_10r_3gdp — PIB regional, {an_judete}",
            f"Eurostat nama_10r_3empers — ocuparea, {an_judete}",
            f"Eurostat nama_10r_2coe și nama_10r_2emhrw — remunerarea salariaților și orele lucrate, {an_regiuni}",
        ],
        "sisteme": sisteme,
        "judete": judete_ec,
        "regiuni": regiuni_ec,
    }
    os.makedirs(os.path.dirname(CALE_IESIRE), exist_ok=True)
    with open(CALE_IESIRE, "w", encoding="utf-8") as f:
        json.dump(iesire, f, ensure_ascii=False, separators=(",", ":"))
    print(f"scris {CALE_IESIRE} ({os.path.getsize(CALE_IESIRE)} octeți)")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
