# -*- coding: utf-8 -*-
"""
personal.py — salariații și câștigul din sectorul public, pe județe.

Pentru fiecare județ: numărul mediu de salariați și câștigul salarial mediu brut
lunar în administrația publică, învățământ și sănătate (secțiunile O, P și Q din
CAEN Rev.2). Sursa e INS TEMPO, ultimul an publicat. Statistica INS nu cuprinde
personalul militar și asimilat (armată, poliție, servicii).

De aici, împreună cu execuția bugetară (unelte/finante.py), raportul scoate de
unde pleacă fiecare județ ca număr de oameni și ca bani.

Independent: doar biblioteca standard.
Rulare:  python unelte/personal.py [--surse DIR] [--forteaza]
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
CALE_IESIRE = "date/personal-judete.json"
# secțiunile CAEN urmărite: litera cu care începe eticheta din TEMPO
SECTIUNI = {"O": "administrație publică", "P": "învățământ", "Q": "sănătate și asistență socială"}
MATRICE = [
    ("FOM104F", "salariati", "numărul mediu al salariaților"),
    ("FOM107E", "castigBrut", "câștigul salarial mediu brut lunar, lei"),
]
TABEL = str.maketrans("ĂÂÎȘŞȚŢăâîșşțţ", "AAISSTTaaisstt")


def curat(text):
    return " ".join(str(text or "").translate(TABEL).upper().replace("-", " ").split())


def cere(cale, corp=None, incercari=3):
    date = json.dumps(corp).encode("utf-8") if corp is not None else None
    antete = {"User-Agent": AGENT}
    if date is not None:
        antete["Content-Type"] = "application/json"
    for k in range(incercari):
        try:
            cerere = urllib.request.Request(f"{TEMPO}/{cale}", data=date, headers=antete)
            with urllib.request.urlopen(cerere, timeout=90) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError):
            if k == incercari - 1:
                raise
            time.sleep(2 * (k + 1))
    return ""


def matrice(cod, surse, forteaza):
    """Întoarce (an, {numele județului: {secțiune: valoare}}) pentru ultimul an publicat."""
    cale = os.path.join(surse, "tempo", f"{cod}-judete.json")
    if os.path.exists(cale) and not forteaza:
        with open(cale, encoding="utf-8") as f:
            salvat = json.load(f)
            return salvat["an"], salvat["valori"]
    meta = json.loads(cere(f"matrix/{cod}?lang=ro"))
    det = meta["details"]
    alese = []
    for dim in meta["dimensionsMap"]:
        eticheta = dim["label"].strip().lower()
        optiuni = dim["options"]
        if eticheta.startswith("caen"):
            alese.append([o for o in optiuni if re.match(r"^[OPQ]\s{2}", o["label"])])
        elif eticheta.startswith("sexe"):
            alese.append([o for o in optiuni if o["label"].strip() == "Total"])
        elif eticheta.startswith("ani"):
            alese.append(optiuni[-1:])
        else:
            alese.append(optiuni)
    interogare = ":".join(",".join(str(o["nomItemId"]) for o in a) for a in alese)
    text = cere("pivot", {
        "language": "ro", "encQuery": interogare, "matCode": cod,
        "matMaxDim": det["matMaxDim"], "matRegJ": det["matRegJ"], "matUMSpec": det["matUMSpec"]
    })
    an, valori = None, {}
    for linie in text.splitlines()[1:]:
        campuri = [c.strip() for c in linie.split(",")]
        sectiune = next((c[0] for c in campuri if re.match(r"^[OPQ]\s{2}", c)), None)
        an_linie = next((re.match(r"Anul (\d{4})", c) for c in campuri if c.startswith("Anul ")), None)
        try:
            valoare = float(campuri[-1])
        except ValueError:
            continue
        if not sectiune or not an_linie:
            continue
        an = int(an_linie.group(1))
        # județul e câmpul care nu e nici secțiune, nici sex, nici an, nici unitate de măsură
        judet = next((c for c in campuri[:-1] if c not in ("Total",) and not c.startswith("Anul ")
                      and not re.match(r"^[A-Z]\s{2}", c) and c not in ("Numar persoane", "Lei")), None)
        if judet:
            valori.setdefault(judet, {})[sectiune] = valoare
    os.makedirs(os.path.dirname(cale), exist_ok=True)
    with open(cale, "w", encoding="utf-8") as f:
        json.dump({"an": an, "valori": valori}, f, ensure_ascii=False)
    return an, valori


def principal():
    ap = argparse.ArgumentParser(description="Salariații și câștigul din sectorul public, pe județe (INS TEMPO).")
    ap.add_argument("--surse", default=os.path.join(tempfile.gettempdir(), "ro-adp-surse"))
    ap.add_argument("--forteaza", action="store_true", help="cere din nou, ignorând copiile locale")
    arg = ap.parse_args()

    if not os.path.exists(CALE_UAT):
        print(f"Lipsește {CALE_UAT}. Rulează întâi unelte/prelucrare.py.")
        return 1
    with open(CALE_UAT, encoding="utf-8") as f:
        judete = json.load(f)["judete"]
    dupa_nume = {curat(j["n"]): j["c"] for j in judete}
    dupa_nume["MUNICIPIUL BUCURESTI"] = dupa_nume.get("BUCURESTI")

    iesire = {"versiune": 1, "generat": time.strftime("%Y-%m-%d"), "ani": {}, "sectiuni": SECTIUNI, "judete": {}}
    for cod, cheie, descriere in MATRICE:
        try:
            an, valori = matrice(cod, arg.surse, arg.forteaza)
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as e:
            print(f"{cod}: nu s-a putut lua ({type(e).__name__}: {e})")
            return 1
        potrivite = 0
        for nume, pe_sectiuni in valori.items():
            judet = dupa_nume.get(curat(nume))
            if judet is None:
                continue   # totalul, macroregiunile și regiunile nu sunt județe
            iesire["judete"].setdefault(str(judet), {})[cheie] = pe_sectiuni
            potrivite += 1
        iesire["ani"][cheie] = an
        print(f"{cod} {cheie}: {potrivite} județe, anul {an} — {descriere}")

    iesire["surse"] = ["INS TEMPO: FOM104F (salariați pe secțiuni CAEN și județe), FOM107E (câștig brut pe secțiuni și județe)"]
    iesire["nota"] = ("Secțiunile O, P și Q din CAEN Rev.2. Statistica nu cuprinde personalul militar și asimilat. "
                      "Câștigul e brut, lunar, medie anuală.")
    with open(CALE_IESIRE, "w", encoding="utf-8") as f:
        json.dump(iesire, f, ensure_ascii=False, separators=(",", ":"))
    print(f"scris {CALE_IESIRE} ({os.path.getsize(CALE_IESIRE)} octeți)")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
