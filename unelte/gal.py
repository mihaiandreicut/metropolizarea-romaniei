# -*- coding: utf-8 -*-
"""
gal.py — grupurile de acțiune locală (LEADER 2023–2027), pe UAT.

Sursa e lista publicată de Ministerul Agriculturii: „Lista Grupurilor de Acțiune
Locală selectate 2023–2027”, un PDF cu un rând pe grup și, în coloana „Acoperire
teritorială”, UAT-urile lui. De aici iese, pentru fiecare UAT, grupul din care
face parte — harta pe care se împart azi banii europeni de dezvoltare locală.

UAT-urile din afara oricărui grup (orașele peste 20.000 de locuitori și comunele
rămase pe dinafară) sunt alăturate, separat, grupului cel mai apropiat din județ:
lista lor e scrisă distinct, ca să nu treacă drept membri.

Spre deosebire de celelalte scripturi, acesta are nevoie de un cititor de PDF:
pachetul `pymupdf` (pip install pymupdf). Fără el, scriptul spune ce lipsește.
PDF-ul se pune în folderul de surse, ca `gal/lista-gal-2023-2027.pdf`.

Rulare:  python unelte/gal.py [--surse DIR]
"""

import argparse
import difflib
import json
import os
import re
import sys
import tempfile
import time

CALE_UAT = "date/romania-uat.json"
CALE_IESIRE = "date/gal-uat.json"
PDF = os.path.join("gal", "lista-gal-2023-2027.pdf")
SURSA = ("https://www.madr.ro/docs/dezvoltare-rurala/Axa_LEADER/2023-2027/2026/"
         "Lista-cu-Grupurile-de-Actiune-Locala-2023-2027-selectate-de-MADR-si-datele-de-contact-"
         "ale-acestora-actualizata-la-data-de-10.02.2026.pdf")

TABEL = str.maketrans("ĂÂÎȘŞȚŢăâîșşțţ", "AAISSTTaaisstt")
PREFIXE = ("ORASUL ", "ORAS ", "MUNICIPIUL ", "MUN. ", "COMUNA ", "COM. ")


def curat(text):
    """Nume fără diacritice, cu majuscule și spații simple: cheia de potrivire."""
    cheie = " ".join(str(text or "").translate(TABEL).upper().replace("-", " ").replace(".", ". ").split())
    for prefix in PREFIXE:
        if cheie.startswith(prefix):
            cheie = cheie[len(prefix):]
    return cheie.replace(". ", ".").strip(" .")


def randuri_pdf(cale):
    """Rândurile tabelului din PDF: [nr, denumire, județe, acoperire, suprafață, populație]."""
    try:
        import pymupdf
    except ImportError:
        print("Lipsește pachetul pymupdf (cititorul de PDF): pip install pymupdf")
        return None
    randuri = []
    with pymupdf.open(cale) as doc:
        for pagina in doc:
            for tabel in pagina.find_tables().tables:
                for r in tabel.extract():
                    celule = [" ".join(str(c or "").split()) for c in r]
                    if len(celule) >= 7 and celule[0].isdigit():
                        randuri.append(celule[:7])
    return randuri


def principal():
    ap = argparse.ArgumentParser(description="Grupurile de acțiune locală 2023–2027, pe UAT.")
    ap.add_argument("--surse", default=os.path.join(tempfile.gettempdir(), "ro-adp-surse"))
    arg = ap.parse_args()

    cale_pdf = os.path.join(arg.surse, PDF)
    if not os.path.exists(cale_pdf):
        print(f"Lipsește {cale_pdf}.\nDescarcă lista de la:\n  {SURSA}")
        return 1
    if not os.path.exists(CALE_UAT):
        print(f"Lipsește {CALE_UAT}. Rulează întâi unelte/prelucrare.py.")
        return 1
    with open(CALE_UAT, encoding="utf-8") as f:
        date = json.load(f)
    randuri = randuri_pdf(cale_pdf)
    if randuri is None:
        return 1

    cod_judet = {curat(j["n"]): j["c"] for j in date["judete"]}
    pe_judet = {}   # județ -> {cheie nume: siruta}
    for u in date["uat"]:
        pe_judet.setdefault(u["j"], {})[curat(u["n"])] = u["s"]

    def gaseste(nume, judete):
        """SIRUTA unui UAT căutat după nume în județele date: întâi exact, apoi aproape."""
        cheie = curat(nume)
        if not cheie:
            return None
        for j in judete:
            if cheie in pe_judet.get(j, {}):
                return pe_judet[j][cheie]
        for j in judete:
            aproape = difflib.get_close_matches(cheie, list(pe_judet.get(j, {})), n=1, cutoff=0.84)
            if aproape:
                return pe_judet[j][aproape[0]]
        return None

    grupuri, pe_uat, nepotrivite, dubluri = [], {}, [], []
    for nr, denumire, _decizie, judete_text, acoperire, suprafata, populatie in randuri:
        judete = [cod_judet[curat(x)] for x in judete_text.split(",") if curat(x) in cod_judet]
        # „…, Valea Lungă (Jud. Alba), Apoldu de Jos, … (Jud. Sibiu)”: județul scris după un șir de nume
        bucati = re.split(r"\(\s*jud\.?\s*([^)]+)\)", acoperire, flags=re.I)
        membri = []
        for k in range(0, len(bucati), 2):
            indiciu = cod_judet.get(curat(bucati[k + 1])) if k + 1 < len(bucati) else None
            unde = [indiciu] if indiciu else judete
            for nume in bucati[k].split(","):
                if not curat(nume):
                    continue
                # „Ciumeghiu (Bihor)”: județul între paranteze; „Petreu (Abrămuț)”: satul și comuna lui
                m = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", nume.strip())
                unde_acum = unde
                if m and curat(m.group(2)) in cod_judet:
                    nume, unde_acum = m.group(1), [cod_judet[curat(m.group(2))]]
                elif m:
                    nume = m.group(2)
                siruta = gaseste(nume, unde_acum) or gaseste(nume, judete)
                if siruta is None:
                    nepotrivite.append(f"{nume.strip()} ({denumire[:40]})")
                elif siruta in pe_uat:
                    dubluri.append(f"{nume.strip()}: și în grupul {pe_uat[siruta]}")
                else:
                    pe_uat[siruta] = int(nr)
                    membri.append(siruta)

        def numar(text):
            try:
                return float(text.replace(" ", "").replace(",", "."))
            except ValueError:
                return None
        grupuri.append({
            "id": int(nr), "nume": denumire, "judete": judete,
            "populatie": numar(populatie), "suprafata": numar(suprafata), "uat": len(membri)
        })

    # UAT-urile din afara oricărui grup se alătură grupului celui mai apropiat membru din județ
    alaturate = {}
    membri_judet = {}
    for u in date["uat"]:
        if u["s"] in pe_uat and u.get("e"):
            membri_judet.setdefault(u["j"], []).append(u)
    for u in date["uat"]:
        if u["s"] in pe_uat or not u.get("e") or u["j"] not in membri_judet:
            continue
        aproape = min(membri_judet[u["j"]],
                      key=lambda v: (v["e"][0] - u["e"][0]) ** 2 + (v["e"][1] - u["e"][1]) ** 2)
        alaturate[u["s"]] = pe_uat[aproape["s"]]

    in_afara = [u for u in date["uat"] if u["s"] not in pe_uat]
    print(f"{len(grupuri)} grupuri; {len(pe_uat)} UAT-uri membre din {len(date['uat'])}")
    print(f"în afara oricărui grup: {len(in_afara)} UAT-uri, din care "
          f"{sum(1 for u in in_afara if u['t'] == 'comună')} comune; alăturate celui mai apropiat grup: {len(alaturate)}")
    print(f"nume nepotrivite: {len(nepotrivite)} ({'; '.join(nepotrivite[:6])}{' …' if len(nepotrivite) > 6 else ''})")
    if dubluri:
        print(f"UAT-uri scrise în două grupuri: {len(dubluri)} ({'; '.join(dubluri[:4])})")

    iesire = {
        "versiune": 1,
        "generat": time.strftime("%Y-%m-%d"),
        "gal": grupuri,
        "uat": {str(s): g for s, g in sorted(pe_uat.items())},
        "alaturate": {str(s): g for s, g in sorted(alaturate.items())},
        "nepotrivite": nepotrivite,
        "surse": ["Ministerul Agriculturii și Dezvoltării Rurale — Lista Grupurilor de Acțiune Locală "
                  "selectate 2023–2027, actualizată la 10.02.2026: " + SURSA],
        "nota": "„uat” sunt membrii din lista oficială; „alaturate” sunt UAT-urile din afara oricărui grup, "
                "puse lângă grupul celui mai apropiat membru din județ — doar pentru varianta de districte pe GAL."
    }
    with open(CALE_IESIRE, "w", encoding="utf-8") as f:
        json.dump(iesire, f, ensure_ascii=False, separators=(",", ":"))
    print(f"scris {CALE_IESIRE} ({os.path.getsize(CALE_IESIRE)} octeți)")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
