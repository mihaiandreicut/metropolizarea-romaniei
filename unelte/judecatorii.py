# -*- coding: utf-8 -*-
"""
judecatorii.py — circumscripțiile judecătoriilor, pe UAT.

Circumscripția unei judecătorii e singura împărțire sub județ pe care statul o
folosește deja în mai multe locuri: instanța, parchetul, iar prin Legea 36/1995
și competența teritorială a notarilor publici. Proiectul o ia ca desen de pornire
al districtelor: un oraș cu judecătorie și localitățile arondate lui.

Sursa: portal.just.ro, pagina „Circumscripții” a fiecărei judecătorii (lista de
localități, după Hotărârea 102/2021). Lista e pe sate; aici se urcă la UAT, cu
votul majorității satelor lui.

Independent: doar biblioteca standard.
Rulare:  python unelte/judecatorii.py [--surse DIR] [--forteaza]
"""

import argparse
import difflib
import html
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

AGENT = "ro-adp/1.0 (harta administrativa)"
PORTAL = "https://portal.just.ro"
CALE_UAT = "date/romania-uat.json"
CALE_LOCALITATI = "date/localitati.json"
CALE_IESIRE = "date/judecatorii-uat.json"
PAGINI_MAXIME = 60   # câte pagini de câte 30 de rânduri se cer cel mult pentru o instanță
# judecătoriile din Mehedinți lipsesc din lista de pe prima pagină a portalului, dar paginile lor există
INSTANTE_IN_PLUS = {181: "Judecătoria BAIA DE ARAMĂ", 225: "Judecătoria DROBETA-TURNU SEVERIN",
                    274: "Judecătoria ORŞOVA", 313: "Judecătoria STREHAIA", 332: "Judecătoria VÂNJU MARE"}

TABEL = str.maketrans("ĂÂÎȘŞȚŢăâîșşțţ", "AAISSTTaaisstt")


def curat(text):
    """Nume fără diacritice, cu majuscule și spații simple: cheia de potrivire."""
    return " ".join(str(text or "").translate(TABEL).upper().replace("-", " ").split())


def cere(url, date=None, incercari=3):
    for k in range(incercari):
        try:
            cerere = urllib.request.Request(url, data=date, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(cerere, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError):
            if k == incercari - 1:
                raise
            time.sleep(2 * (k + 1))
    return ""


def instante(surse, forteaza):
    """Lista judecătoriilor de pe prima pagină a portalului: [(id, nume)]."""
    cale = os.path.join(surse, "just", "acasa.html")
    if not os.path.exists(cale) or forteaza:
        os.makedirs(os.path.dirname(cale), exist_ok=True)
        with open(cale, "w", encoding="utf-8") as f:
            f.write(cere(f"{PORTAL}/SitePages/acasa.aspx"))
    with open(cale, encoding="utf-8") as f:
        pagina = f.read()
    gasite = {}
    for cod, nume in re.findall(r"id_inst=(\d+)[^>]*>([^<]{3,80})<", pagina):
        nume = " ".join(html.unescape(nume).split())
        if nume.startswith("Judecătoria"):
            gasite[int(cod)] = nume
    gasite.update(INSTANTE_IN_PLUS)
    return sorted(gasite.items())


def randuri(pagina):
    """Rândurile tabelului de circumscripții: [(județ, localitate)]."""
    gasite = []
    for rand in re.findall(r"<tr[^>]*>(.*?)</tr>", pagina, flags=re.S):
        celule = [" ".join(html.unescape(re.sub(r"<[^>]+>", " ", c)).split())
                  for c in re.findall(r"<td[^>]*class=\"ms-vb\"[^>]*>(.*?)</td>", rand, flags=re.S)]
        if len(celule) >= 4 and celule[1].startswith("Localitatea "):
            gasite.append((celule[0], celule[1][len("Localitatea "):].strip()))
    return gasite


def circumscriptie(cod, surse, forteaza, pauza):
    """Toate localitățile unei judecătorii; tabelul vine în pagini de câte 30, prin postback."""
    cale = os.path.join(surse, "just", f"circumscriptie-{cod}.json")
    if os.path.exists(cale) and not forteaza:
        with open(cale, encoding="utf-8") as f:
            return [tuple(x) for x in json.load(f)]
    url = f"{PORTAL}/{cod}/SitePages/Circumscriptii.aspx?id_inst={cod}"
    pagina = cere(url)
    toate = randuri(pagina)
    for _ in range(PAGINI_MAXIME):
        urmatoarea = re.search(r"__doPostBack\('([^']+)','(dvt_firstrow=\{\d+\})'\);\"><img[^>]*next\.gif", pagina)
        if not urmatoarea:
            break
        campuri = {nume: html.unescape(valoare) for nume, valoare in
                   re.findall(r"<input type=\"hidden\" name=\"([^\"]+)\"[^>]*value=\"([^\"]*)\"", pagina)}
        campuri["__EVENTTARGET"] = html.unescape(urmatoarea.group(1))
        campuri["__EVENTARGUMENT"] = urmatoarea.group(2)
        if pauza:
            time.sleep(pauza)
        pagina = cere(url, urllib.parse.urlencode(campuri).encode("utf-8"))
        noi = randuri(pagina)
        if not noi or noi[0] in toate:
            break   # serverul a întors aceeași pagină: nu se mai avansează
        toate.extend(noi)
    os.makedirs(os.path.dirname(cale), exist_ok=True)
    with open(cale, "w", encoding="utf-8") as f:
        json.dump(toate, f, ensure_ascii=False)
    return toate


def principal():
    ap = argparse.ArgumentParser(description="Circumscripțiile judecătoriilor, urcate de la sat la UAT.")
    ap.add_argument("--surse", default=os.path.join(tempfile.gettempdir(), "ro-adp-surse"))
    ap.add_argument("--forteaza", action="store_true", help="cere din nou, ignorând copiile locale")
    arg = ap.parse_args()

    for cale in (CALE_UAT, CALE_LOCALITATI):
        if not os.path.exists(cale):
            print(f"Lipsește {cale}. Rulează întâi unelte/prelucrare.py.")
            return 1
    with open(CALE_UAT, encoding="utf-8") as f:
        date = json.load(f)
    with open(CALE_LOCALITATI, encoding="utf-8") as f:
        localitati = json.load(f)["localitati"]

    judet_uat = {u["s"]: u["j"] for u in date["uat"]}
    nume_judet = {curat(j["n"]): j["c"] for j in date["judete"]}
    # (județ, numele satului) -> UAT-urile în care există un sat cu numele ăsta
    dupa_nume = {}
    for loc in localitati:
        if loc["u"] in judet_uat:
            dupa_nume.setdefault((judet_uat[loc["u"]], curat(loc["n"])), set()).add(loc["u"])
    nume_uat = {u["s"]: u["n"] for u in date["uat"]}

    try:
        lista = instante(arg.surse, arg.forteaza)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"Lista instanțelor nu a putut fi luată ({type(e).__name__}: {e})")
        return 1
    print(f"{len(lista)} judecătorii")

    voturi = {}        # UAT -> {judecătorie: câte sate}
    nesigure = []      # (județ, sat, judecătorie): nume care apare în mai multe UAT-uri
    nepotrivite = []
    for k, (cod, nume) in enumerate(lista, 1):
        try:
            sate = circumscriptie(cod, arg.surse, arg.forteaza, 0.2)
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"   {nume}: nu s-a putut lua ({type(e).__name__}: {e})")
            continue
        for judet, sat in sate:
            cod_judet = nume_judet.get(curat(judet))
            # „Veseud (Slimnic)”: numele satului, cu comuna între paranteze
            m = re.match(r"^(.*?)\s*\((.*?)\)\s*$", sat)
            baza, indiciu = (m.group(1), curat(m.group(2))) if m else (sat, None)
            candidati = dupa_nume.get((cod_judet, curat(baza))) or dupa_nume.get((cod_judet, curat(sat)))
            if not candidati:
                nepotrivite.append(f"{sat} ({judet})")
                continue
            if indiciu:
                cu_indiciu = {u for u in candidati if curat(nume_uat[u]) == indiciu}
                candidati = cu_indiciu or candidati
            if len(candidati) == 1:
                uat = next(iter(candidati))
                voturi.setdefault(uat, {}).setdefault(cod, 0)
                voturi[uat][cod] += 1
            else:
                nesigure.append((candidati, cod))
        if k % 20 == 0 or k == len(lista):
            print(f"   {k}/{len(lista)} instanțe")

    # satele cu nume repetat în județ merg la UAT-ul care are deja sate la aceeași instanță
    for candidati, cod in nesigure:
        alese = [u for u in candidati if cod in voturi.get(u, {})] or list(candidati)
        for uat in alese:
            voturi.setdefault(uat, {}).setdefault(cod, 0)
            voturi[uat][cod] += 1 / len(alese)

    pe_uat = {uat: max(v.items(), key=lambda x: x[1])[0] for uat, v in voturi.items()}
    impartite = sum(1 for v in voturi.values() if len(v) > 1)

    def seamana(a, b, exact=False):
        """„SÂNNICOLAUL MARE” e Sânnicolau Mare, „GURA HONŢ” e Gurahonț."""
        a, b = curat(a).replace(" ", ""), curat(b).replace(" ", "")
        return a == b or (not exact and difflib.SequenceMatcher(None, a, b).ratio() >= 0.88)

    def cu_numele(cheie, candidati, nume_de):
        """Candidatul cu numele dat: întâi potrivirea exactă (Deta nu e Denta), apoi cea apropiată."""
        for exact in (True, False):
            gasit = next((c for c in candidati if seamana(cheie, nume_de(c), exact)), None)
            if gasit is not None:
                return gasit
        return None

    # orașele mari apar în tabel pe străzi, nu ca localitate: iau instanța care le poartă numele
    judet_instanta = {}
    for uat, cod in pe_uat.items():
        judet_instanta.setdefault(cod, judet_uat[uat])
    for u in date["uat"]:
        if u["s"] in pe_uat:
            continue
        in_judet = [(cod, nume) for cod, nume in lista if judet_instanta.get(cod, u["j"]) == u["j"]]
        gasita = cu_numele(u["n"], in_judet, lambda x: x[1].replace("Judecătoria", ""))
        if gasita:
            pe_uat[u["s"]] = gasita[0]
            judet_instanta.setdefault(gasita[0], u["j"])
    # ce a mai rămas ia instanța celui mai apropiat UAT din județ care are una
    for u in date["uat"]:
        if u["s"] in pe_uat or not u.get("e"):
            continue
        vecini = [v for v in date["uat"] if v["j"] == u["j"] and v["s"] in pe_uat and v.get("e")]
        if vecini:
            aproape = min(vecini, key=lambda v: (v["e"][0] - u["e"][0]) ** 2 + (v["e"][1] - u["e"][1]) ** 2)
            pe_uat[u["s"]] = pe_uat[aproape["s"]]

    # reședința: UAT-ul care poartă numele instanței, căutat întâi în circumscripția ei
    judecatorii = []
    for cod, nume in lista:
        ale = [u for u, c in pe_uat.items() if c == cod]
        if not ale:
            continue   # instanță desființată sau fără circumscripție publicată
        cheie = nume.replace("Judecătoria", "")
        sediu = cu_numele(cheie, ale, lambda x: nume_uat[x])
        if sediu is None:
            judet = judet_uat[ale[0]]
            sediu = cu_numele(cheie, [u["s"] for u in date["uat"] if u["j"] == judet], lambda x: nume_uat[x])
        judecatorii.append({"id": cod, "nume": nume, "sediu": sediu, "uat": len(ale)})

    fara = [u["n"] for u in date["uat"] if u["s"] not in pe_uat]
    print(f"UAT-uri cu judecătorie: {len(pe_uat)} din {len(date['uat'])}; împărțite între două instanțe: {impartite}")
    print(f"fără potrivire: {len(fara)} UAT-uri ({', '.join(fara[:8])}{' …' if len(fara) > 8 else ''}); "
          f"{len(nepotrivite)} sate nerecunoscute")
    print(f"instanțe fără reședință găsită: {[j['nume'] for j in judecatorii if j['sediu'] is None and j['uat']]}")

    iesire = {
        "versiune": 1,
        "generat": time.strftime("%Y-%m-%d"),
        "judecatorii": judecatorii,
        "uat": {str(u): c for u, c in sorted(pe_uat.items())},
        "surse": [f"{PORTAL} — pagina „Circumscripții” a fiecărei judecătorii (Hotărârea 102/2021)"],
        "nota": "Lista oficială e pe sate; UAT-ul ia instanța majorității satelor lui. Competența teritorială "
                "a notarilor publici e aceeași circumscripție (Legea 36/1995)."
    }
    with open(CALE_IESIRE, "w", encoding="utf-8") as f:
        json.dump(iesire, f, ensure_ascii=False, separators=(",", ":"))
    print(f"scris {CALE_IESIRE} ({os.path.getsize(CALE_IESIRE)} octeți)")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
