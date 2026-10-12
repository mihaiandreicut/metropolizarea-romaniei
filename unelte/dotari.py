# -*- coding: utf-8 -*-
"""
dotari.py — dotările oficiale ale localităților, din registrele publice.

Scorul de centralitate al unei reședințe se sprijinea până acum pe serviciile
din OpenStreetMap, unde acoperirea e neuniformă. Aici intră sursele oficiale,
toate de pe data.gov.ro:

  * farmaciile — Ministerul Sănătății, „Situația farmaciilor din România”
    (câte un fișier pe județ, cu localitatea fiecărei farmacii);
  * oficiile poștale — Poșta Română, „Lista subunităților poștale”
    (oficii, ghișee și agenții, cu localitatea și localitățile deservite);
  * medicii de familie — CNAS, „Lista furnizori”, contractele de medicină de
    familie; fișierul are doar casa de asigurări, deci rezultatul e pe județ.

Poliția nu are registru deschis: posturile comunale nu sunt publicate nici de
IGPR, nici pe data.gov.ro, așa că rămân pe datele din OpenStreetMap.

Independent: doar biblioteca standard. Cititoarele de .xls/.xlsx sunt cele din
unelte/prelucrare.py, încărcate din fișier, ca să nu existe două implementări.
Rulare:  python unelte/dotari.py [--surse DIR] [--forteaza]
"""

import argparse
import json
import os
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

AGENT = "ro-adp/1.0 (harta administrativa)"
API = "https://data.gov.ro/api/3/action/package_search"
CALE_UAT = "date/romania-uat.json"
CALE_LOCALITATI = "date/localitati.json"
CALE_IESIRE = "date/dotari-uat.json"
# tipurile de subunități poștale care înseamnă prezență la ghișeu
TIPURI_POSTA = ("OF", "GH", "AG", "APR")


def citeste_tabele():
    """Împrumută cititoarele de .xls/.xlsx din prelucrare.py (aceeași implementare)."""
    cale = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prelucrare.py")
    with open(cale, encoding="utf-8") as f:
        sursa = f.read().split("def principal(")[0]
    spatiu = {"__file__": cale, "__name__": "prelucrare_part"}
    exec(compile(sursa, cale, "exec"), spatiu)
    return spatiu["citeste_xls"], spatiu["citeste_xlsx"]


def descarca(url, cale, forteaza=False, incercari=3):
    if os.path.exists(cale) and not forteaza:
        with open(cale, "rb") as f:
            return f.read()
    for i in range(incercari):
        try:
            cerere = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(cerere, timeout=120, context=ssl.create_default_context()) as r:
                continut = r.read()
            os.makedirs(os.path.dirname(cale), exist_ok=True)
            with open(cale, "wb") as f:
                f.write(continut)
            return continut
        except (urllib.error.URLError, TimeoutError) as e:
            if i == incercari - 1:
                raise
            print(f"   {os.path.basename(cale)} — {e} (încercarea {i + 1})")
            time.sleep(3 * (i + 1))


def set_de_date(titlu, interogare):
    """Un set de pe data.gov.ro, căutat după titlu exact."""
    url = f"{API}?q={urllib.parse.quote(interogare)}&rows=10"
    cerere = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(cerere, timeout=60, context=ssl.create_default_context()) as r:
        rezultate = json.loads(r.read())["result"]["results"]
    for p in rezultate:
        if p["title"].strip().lower() == titlu.lower():
            return p
    raise LookupError(f"setul „{titlu}” nu a fost găsit pe data.gov.ro")


def fara_diacritice(text):
    tabel = str.maketrans("ăâîșşțţĂÂÎȘŞȚŢ", "aaissttAAISSTT")
    return " ".join(str(text or "").translate(tabel).lower().replace("-", " ").split())


def index_localitati(date, localitati):
    """{(cod județ, nume normalizat): SIRUTA} pentru toate localitățile țării."""
    uat_judet = {u["s"]: u["j"] for u in date["uat"]}
    index = {}
    for loc in localitati["localitati"]:
        judet = uat_judet.get(loc["u"])
        if judet is None:
            continue
        index.setdefault((judet, fara_diacritice(loc["n"])), loc["s"])
    return index


def coloana(antet, *chei):
    for i, c in enumerate(antet):
        text = fara_diacritice(c)
        if all(k in text for k in chei):
            return i
    return None


def farmacii(surse, forteaza, citeste_xls, dupa_auto, index):
    """Farmaciile, din fișierele pe județ ale Ministerului Sănătății."""
    p = set_de_date("Situatia farmaciilor din Romania", "farmacii")
    pe_localitate, fara, total = {}, [], 0
    for resursa in p["resources"]:
        nume = (resursa.get("name") or "").strip()
        cale = os.path.join(surse, "farmacii", nume.replace("/", "-") or "f.xls")
        try:
            descarca(resursa["url"], cale, forteaza)
            randuri = citeste_xls(cale)
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            print(f"   {nume}: {type(e).__name__}")
            continue
        if not randuri:
            continue
        antet = randuri[0]
        c_jud, c_loc = coloana(antet, "jud"), coloana(antet, "localitate")
        if c_jud is None or c_loc is None:
            continue
        for r in randuri[1:]:
            if len(r) <= max(c_jud, c_loc):
                continue
            auto = str(r[c_jud] or "").strip().upper()[:2]
            judet = dupa_auto.get(auto)
            cheie = (judet, fara_diacritice(r[c_loc]))
            total += 1
            siruta = index.get(cheie)
            if siruta:
                pe_localitate[siruta] = pe_localitate.get(siruta, 0) + 1
            else:
                fara.append(f"{r[c_loc]} ({auto})")
    print(f"   farmacii: {total}, din care {sum(pe_localitate.values())} potrivite "
          f"în {len(pe_localitate)} de localități")
    if fara:
        print(f"      fără potrivire: {', '.join(fara[:4])}{' …' if len(fara) > 4 else ''}")
    return pe_localitate


def posta(surse, forteaza, citeste_xls, dupa_auto, index):
    """Subunitățile poștale (oficii, ghișee, agenții), din lista Poștei Române."""
    p = set_de_date("Lista unitatilor postale", "posta romana oficii postale")
    resursa = next((r for r in p["resources"] if "subunit" in fara_diacritice(r.get("name"))), None)
    if resursa is None:
        print("   poștă: lista subunităților nu a fost găsită")
        return {}
    cale = os.path.join(surse, "posta.xls")
    descarca(resursa["url"], cale, forteaza)
    randuri = citeste_xls(cale)
    antet = randuri[0]
    c_jud, c_loc, c_tip = coloana(antet, "jud"), coloana(antet, "localitate"), coloana(antet, "tip")
    if c_jud is None or c_loc is None:
        print("   poștă: lipsesc coloanele de județ/localitate")
        return {}
    pe_localitate, total, fara = {}, 0, []
    for r in randuri[1:]:
        if len(r) <= max(c_jud, c_loc):
            continue
        tip = str(r[c_tip] or "").strip().upper() if c_tip is not None and c_tip < len(r) else "OF"
        if tip and tip not in TIPURI_POSTA:
            continue
        total += 1
        judet = dupa_auto.get(str(r[c_jud] or "").strip().upper()[:2])
        siruta = index.get((judet, fara_diacritice(r[c_loc])))
        if siruta:
            pe_localitate[siruta] = pe_localitate.get(siruta, 0) + 1
        else:
            fara.append(str(r[c_loc]))
    print(f"   poștă: {total} de subunități, din care {sum(pe_localitate.values())} potrivite "
          f"în {len(pe_localitate)} de localități")
    if fara:
        print(f"      fără potrivire: {', '.join(fara[:4])}{' …' if len(fara) > 4 else ''}")
    return pe_localitate


def medici_familie(surse, forteaza, citeste_xls, dupa_cas):
    """Contractele de medicină de familie, pe case de asigurări (deci pe județ)."""
    p = set_de_date("Lista furnizori", "CNAS lista furnizori")
    resursa = next((r for r in p["resources"]
                    if "medicina de familie" in fara_diacritice(r.get("name"))), None)
    if resursa is None:
        print("   medici de familie: fișierul nu a fost găsit")
        return {}
    cale = os.path.join(surse, "medici-familie.xls")
    descarca(resursa["url"], cale, forteaza)
    randuri = citeste_xls(cale)
    antet = randuri[0]
    c_cas = coloana(antet, "cod", "cas")
    if c_cas is None:
        print("   medici de familie: lipsește coloana casei de asigurări")
        return {}
    pe_judet, fara = {}, set()
    for r in randuri[1:]:
        if len(r) <= c_cas:
            continue
        cod = str(r[c_cas] or "").strip().upper().replace("CAS-", "")
        judet = dupa_cas.get(cod)
        if judet is None:
            fara.add(cod)
            continue
        pe_judet[judet] = pe_judet.get(judet, 0) + 1
    print(f"   medici de familie: {sum(pe_judet.values())} de contracte, în {len(pe_judet)} de județe")
    if fara:
        print(f"      case necunoscute: {', '.join(sorted(fara)[:6])}")
    return pe_judet


def principal():
    ap = argparse.ArgumentParser(description="Dotările oficiale ale localităților (farmacii, poștă, medici).")
    ap.add_argument("--surse", default=os.path.join(tempfile.gettempdir(), "ro-adp-surse"))
    ap.add_argument("--forteaza", action="store_true", help="descarcă din nou, ignorând copiile locale")
    arg = ap.parse_args()

    for cale in (CALE_UAT, CALE_LOCALITATI):
        if not os.path.exists(cale):
            print(f"Lipsește {cale}. Rulează întâi unelte/prelucrare.py.")
            return 1
    with open(CALE_UAT, encoding="utf-8") as f:
        date = json.load(f)
    with open(CALE_LOCALITATI, encoding="utf-8") as f:
        localitati = json.load(f)
    os.makedirs(arg.surse, exist_ok=True)
    citeste_xls, _ = citeste_tabele()

    dupa_auto = {j["auto"]: j["c"] for j in date["judete"]}
    # Bucureștiul apare în fișiere și ca sector
    dupa_auto.setdefault("B", next((j["c"] for j in date["judete"] if j["auto"] == "B"), None))
    index = index_localitati(date, localitati)
    print(f"index: {len(index)} de localități")

    print("1/3 farmacii (Ministerul Sănătății)")
    f = farmacii(arg.surse, arg.forteaza, citeste_xls, dupa_auto, index)
    print("2/3 subunități poștale (Poșta Română)")
    po = posta(arg.surse, arg.forteaza, citeste_xls, dupa_auto, index)
    print("3/3 medici de familie (CNAS)")
    m = medici_familie(arg.surse, arg.forteaza, citeste_xls, dupa_auto)

    localitati_iesire = {}
    for siruta in set(list(f.keys()) + list(po.keys())):
        localitati_iesire[str(siruta)] = {
            k: v for k, v in (("farmacii", f.get(siruta)), ("posta", po.get(siruta))) if v
        }
    iesire = {
        "versiune": 1,
        "generat": time.strftime("%Y-%m-%d"),
        "localitati": localitati_iesire,
        "judete": {str(k): {"mediciFamilie": v} for k, v in m.items()},
        "surse": [
            "Ministerul Sănătății — Situația farmaciilor din România (data.gov.ro)",
            "Poșta Română — Lista subunităților poștale (data.gov.ro)",
            "CNAS — Lista furnizori, contracte de medicină de familie (data.gov.ro)"
        ],
        "nota": "Posturile de poliție nu au registru deschis (nici IGPR, nici data.gov.ro), "
                "deci pentru ele rămân datele din OpenStreetMap. Medicii de familie vin pe "
                "casă de asigurări, deci doar pe județ."
    }
    with open(CALE_IESIRE, "w", encoding="utf-8") as fh:
        json.dump(iesire, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"scris {CALE_IESIRE} ({os.path.getsize(CALE_IESIRE)} octeți)")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
