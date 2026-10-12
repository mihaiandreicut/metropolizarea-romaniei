# -*- coding: utf-8 -*-
"""
finante.py — datele financiare pentru criteriul de capacitate administrativă.

Criteriul vine din legea moldovenească: o unitate stă în picioare dacă aparatul
administrativ și instituțiile sociale nu înghit mai mult de 30% din veniturile
ei proprii. Pentru România, datele pe UAT stau în platforma Ministerului
Finanțelor „Transparență bugetară” (transparenta-bugetara.gov.ro).

Scriptul face două lucruri:

  1. Ia de pe mfinante.gov.ro situațiile plăților restante („arierate”), care
     sunt publicate lunar. Atenție: fișierul e agregat pe județe, nu pe UAT-uri.
  2. Dacă în folderul de surse există un export pe UAT din platforma de
     transparență bugetară (un .xls/.xlsx cu CUI/SIRUTA, venituri proprii și
     cheltuieli de funcționare), îl citește și scoate indicatorul pe UAT.

Platforma de transparență refuză conexiunile TLS din afara unui browser, deci
pasul 2 are nevoie de un fișier descărcat manual; scriptul spune exact ce
așteaptă și unde.

Independent: doar biblioteca standard. Cititoarele de .xls/.xlsx sunt cele din
unelte/prelucrare.py, încărcate din fișier, ca să nu existe două implementări.
Rulare:  python unelte/finante.py [--surse DIR] [--forteaza]
"""

import argparse
import json
import os
import re
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.request

# firewall-ul MF respinge agenții mai lungi sau cu punct și virgulă
AGENT = "ro-adp/1.0 (harta administrativa)"
PAGINA_MF = "https://mfinante.gov.ro/ro/domenii/bugetul-de-stat/informatii-executie-bugetara"
G4D = "https://executii-bugetare.g4d.ro/json"   # execuția lunară pe primării, JSON static
AN_EXECUTIE = 2025                              # ultimul an încheiat
# capitolele de venituri care NU sunt proprii (Legea 273/2006): sume defalcate din TVA,
# subvenții, fonduri externe, operațiuni financiare
CAPITOLE_NEPROPRII = ("11", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49")
# cheltuiala cu aparatul propriu, în clasificația funcțională
CHELTUIELI_APARAT = ("Autoritati executive", "Alte servicii publice generale")
# liniile din clasificația economică ce înseamnă investiție (cheltuială de capital)
LINII_INVESTITII = ("constructii", "active fixe", "reparatii capitale", "masini, echipamente",
                    "mobilier", "fonduri europene nerambursabile", "proiecte cu finantare")
# destinațiile din clasificația funcțională care țin de infrastructura esențială a unui UAT
DOMENII = {
    "drumuri": ("Drumuri si poduri", "Strazi"),
    "apaCanal": ("Alimentare cu apa", "Canalizarea si tratarea apelor reziduale"),
    "educatie": ("Invatamant", "Alte cheltuieli in domeniul invatamantului", "Internate si cantine pentru elevi"),
    "cultura": ("Camine culturale", "Biblioteci publice", "Case de cultura", "Muzee", "Alte servicii culturale",
                "Institutii publice de spectacole", "Scoli populare de arta", "Consolidarea si restaurarea monumentelor",
                "Centre pentru conservarea si promovarea culturii"),
}
# liniile din clasificația economică ce înseamnă cheltuială de personal (titlul 10)
LINII_PERSONAL = (
    "Salarii de baza", "Sporuri pentru conditii de munca", "Alte sporuri", "Indemnizatii de hrana",
    "Contributia asiguratorie pentru munca", "Alte drepturi salariale in bani", "Fond aferent platii cu ora",
    "Indemnizatii platite unor persoane din afara unitatii", "Vouchere de vacanta", "Norme de hrana",
    "Contributii de asigurari sociale de stat", "Ore suplimentare", "Fond de premii", "Drepturi de delegare",
    "Indemnizatii de  detasare", "Alte drepturi salariale in natura", "Contributii de asigurari de somaj",
    "Contributii de asigurari sociale de sanatate", "Contributii pentru concedii si indemnizatii",
    "Contributii de asigurari pentru accidente de munca si boli profesionale", "Indemnizatie de vacanta",
    "Alocatii pentru transportul la si de la locul de munca", "Transportul la si de la locul de munca",
)
BAZA_MF = "https://mfinante.gov.ro"
CALE_UAT = "date/romania-uat.json"
CALE_IESIRE = "date/finante-uat.json"
# numele fișierului pe care îl așteaptă pasul 2, pus manual în folderul de surse
EXPORT_UAT = "transparenta-bugetara-uat.xls"
PRAG_ADMINISTRATIE = 30.0   # % din veniturile proprii (modelul Republicii Moldova)


def citeste_tabele():
    """Împrumută cititoarele de .xls/.xlsx din prelucrare.py (aceeași implementare)."""
    cale = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prelucrare.py")
    with open(cale, encoding="utf-8") as f:
        sursa = f.read().split("def principal(")[0]
    spatiu = {"__file__": cale, "__name__": "prelucrare_part"}
    exec(compile(sursa, cale, "exec"), spatiu)
    return spatiu["citeste_xls"], spatiu["citeste_xlsx"]


def descarca(url, cale, forteaza=False):
    if os.path.exists(cale) and not forteaza:
        with open(cale, "rb") as f:
            return f.read()
    cerere = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(cerere, timeout=120, context=ssl.create_default_context()) as r:
        continut = r.read()
    os.makedirs(os.path.dirname(cale), exist_ok=True)
    with open(cale, "wb") as f:
        f.write(continut)
    return continut


def numar(valoare):
    """Numerele din fișierele MF vin și ca text, cu spații și virgulă zecimală."""
    if valoare is None:
        return None
    if isinstance(valoare, (int, float)):
        return float(valoare)
    text = str(valoare).strip().replace(" ", "").replace("\xa0", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def arierate_judete(surse, forteaza, citeste_xls):
    """Plățile restante ale UAT-urilor, agregate pe județe — cel mai recent fișier lunar."""
    pagina = descarca(PAGINA_MF, os.path.join(surse, "mf-executie.html"), forteaza).decode("utf-8", "replace")
    fisiere = sorted(set(re.findall(r'href="(/documents/[^"]*[Aa]rierate[Uu][Aa][Tt][^"]*\.xls)"', pagina)))
    if not fisiere:
        print("   nu s-a găsit niciun fișier de arierate pe pagina MF")
        return {}, None

    def data_din_nume(cale):
        cifre = re.findall(r"(\d{8})", cale.rsplit("/", 1)[-1])
        if not cifre:
            return ""
        z, l, a = cifre[0][:2], cifre[0][2:4], cifre[0][4:]
        return f"{a}-{l}-{z}"

    fisiere.sort(key=data_din_nume)
    ales = fisiere[-1]
    perioada = data_din_nume(ales)
    brut = descarca(BAZA_MF + ales, os.path.join(surse, ales.rsplit("/", 1)[-1]), forteaza)
    cale = os.path.join(surse, ales.rsplit("/", 1)[-1])
    with open(cale, "wb") as f:
        f.write(brut)
    randuri = citeste_xls(cale)

    # fișierul are două niveluri: rândul cu număr de ordine e județul, iar rândurile
    # fără număr, de sub el, sunt UAT-urile acelui județ care au plăți restante
    judete, uat = {}, []
    judet = None
    for r in randuri:
        if len(r) < 3:
            continue
        nume = str(r[1] or "").strip()
        valoare = numar(r[2])
        if not nume or nume.lower() in ("none", "din care:") or nume.upper() == "TOTAL":
            continue
        ordine = str(r[0] or "").strip()
        if ordine.isdigit():
            judet = nume.upper()
            judete[judet] = valoare or 0
        elif judet and valoare:
            uat.append((judet, nume, valoare))
    print(f"   arierate la {perioada}: {len(judete)} de județe, {len(uat)} de UAT-uri cu plăți restante")
    return judete, uat, perioada


def indicatori_uat(surse, citeste_xls, citeste_xlsx):
    """
    Exportul pe UAT din platforma de transparență bugetară, dacă a fost pus în
    folderul de surse. Se caută coloanele după denumire, ca să meargă și dacă
    exportul vine cu alt antet.
    """
    for nume in (EXPORT_UAT, EXPORT_UAT + "x"):
        cale = os.path.join(surse, nume)
        if not os.path.exists(cale):
            continue
        randuri = citeste_xlsx(cale) if nume.endswith("x") else citeste_xls(cale)
        if not randuri:
            return {}
        antet = [str(c or "").strip().lower() for c in randuri[0]]

        def coloana(*chei):
            for i, c in enumerate(antet):
                if all(k in c for k in chei):
                    return i
            return None

        c_cod = coloana("siruta") or coloana("cod", "uat") or coloana("cui")
        c_venit = coloana("venituri", "proprii")
        c_admin = coloana("cheltuieli", "administrativ") or coloana("cheltuieli", "funcționare")
        if c_cod is None or c_venit is None or c_admin is None:
            print(f"   {nume}: nu s-au găsit coloanele (SIRUTA/CUI, venituri proprii, cheltuieli administrative)")
            return {}
        rezultat = {}
        for r in randuri[1:]:
            cod = numar(r[c_cod] if c_cod < len(r) else None)
            venit = numar(r[c_venit] if c_venit < len(r) else None)
            admin = numar(r[c_admin] if c_admin < len(r) else None)
            if not cod or not venit:
                continue
            rezultat[int(cod)] = {
                "venituriProprii": venit,
                "cheltuieliAdministrative": admin,
                "pondere": round(100 * admin / venit, 1) if admin is not None and venit else None
            }
        print(f"   {nume}: {len(rezultat)} de UAT-uri")
        return rezultat
    print(f"   lipsește exportul pe UAT ({EXPORT_UAT}) — vezi nota din fișierul de ieșire")
    return {}


def personal(d):
    """Cheltuiala de personal a unei instituții: (a aparatului propriu, totală)."""
    aparat = total = 0.0
    for destinatie in d.get("cheltuieli", {}).get("tabel", []) or []:
        suma = sum(linie.get("suma") or 0 for linie in destinatie.get("linii", []) or []
                   if str(linie.get("desc", "")).strip() in LINII_PERSONAL)
        total += suma
        if str(destinatie.get("desc", "")).strip() in CHELTUIELI_APARAT:
            aparat += suma
    return round(aparat, 2), round(total, 2)


def executie_primarii(surse, forteaza, pauza=0.1):
    """
    Execuția bugetară a fiecărei primării, de pe executii-bugetare.g4d.ro: fișiere
    JSON statice, un fișier pe instituție și an, cu veniturile pe capitole și
    cheltuielile pe destinații. De aici ies cele două numere ale criteriului:
    veniturile proprii și cheltuiala cu aparatul administrativ.
    """
    import urllib.parse

    def json_de_la(cale, nume):
        brut = descarca(f"{G4D}/{cale}", os.path.join(surse, "g4d", nume), forteaza)
        return json.loads(brut)

    judete = json_de_la("judete.json", "judete.json")
    rezultat = {}
    judete_cj = {}
    for k, j in enumerate(judete, 1):
        cod = j["cod"]
        try:
            institutii = json_de_la(f"{AN_EXECUTIE}/{cod}/institutii.json", f"{cod}-institutii.json")
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            print(f"   {cod}: lista de instituții nu a putut fi luată ({e})")
            continue
        # consiliul județean: aparatul lui e ce dispare când județul rămâne doar oficiu
        for i in institutii:
            if not i.get("cjudetean"):
                continue
            try:
                d = json_de_la(f"{AN_EXECUTIE}/{cod}/{i['cif']}.json", f"{cod}-{i['cif']}.json")
            except (urllib.error.URLError, TimeoutError, ValueError):
                continue
            chelt = d.get("cheltuieli", {}).get("diagrama", {}) or {}
            aparat_cj = sum(sum(v for v in serie if isinstance(v, (int, float)))
                            for dest, serie in chelt.items() if dest.strip() in CHELTUIELI_APARAT)
            personal_aparat, personal_total = personal(d)
            judete_cj[cod] = {
                "nume": i.get("nume", ""),
                "personalAparat": personal_aparat,
                "personalTotal": personal_total,
                "cheltuieliAparat": round(aparat_cj, 2),
                "cheltuieliTotal": round(d.get("cheltuieli", {}).get("total") or 0, 2),
            }
        primarii = [i for i in institutii if i.get("primarie")]
        luate = 0
        for i in primarii:
            cif = i["cif"]
            try:
                d = json_de_la(f"{AN_EXECUTIE}/{cod}/{cif}.json", f"{cod}-{cif}.json")
            except (urllib.error.URLError, TimeoutError, ValueError):
                continue
            venituri = d.get("venituri", {}).get("diagrama", {}) or {}
            proprii = 0.0
            for capitol, serie in venituri.items():
                codul = re.search(r"\((\d+)\)\s*$", capitol)
                if codul and codul.group(1) in CAPITOLE_NEPROPRII:
                    continue
                proprii += sum(v for v in serie if isinstance(v, (int, float)))
            cheltuieli = d.get("cheltuieli", {}).get("diagrama", {}) or {}
            aparat = 0.0
            for destinatie, serie in cheltuieli.items():
                if destinatie.strip() in CHELTUIELI_APARAT:
                    aparat += sum(v for v in serie if isinstance(v, (int, float)))
            # cât s-a cheltuit pe fiecare domeniu de infrastructură esențială
            domenii = {}
            for domeniu, prefixe in DOMENII.items():
                domenii[domeniu] = round(sum(
                    sum(v for v in serie if isinstance(v, (int, float)))
                    for destinatie, serie in cheltuieli.items()
                    if destinatie.strip().startswith(prefixe)), 2)
            # investițiile, din liniile de clasificație economică ale fiecărei destinații
            investitii = 0.0
            for destinatie in d.get("cheltuieli", {}).get("tabel", []) or []:
                for linie in destinatie.get("linii", []) or []:
                    desc = str(linie.get("desc", "")).lower()
                    if any(cheie in desc for cheie in LINII_INVESTITII):
                        investitii += linie.get("suma") or 0
            personal_aparat, personal_total = personal(d)
            rezultat[cif] = {
                "judet": cod,
                "personalAparat": personal_aparat,
                "personalTotal": personal_total,
                "nume": i.get("nume", ""),
                "venituriProprii": round(proprii, 2),
                "cheltuieliAparat": round(aparat, 2),
                "cheltuieliTotal": round(d.get("cheltuieli", {}).get("total") or 0, 2),
                "investitii": round(investitii, 2),
                "domenii": domenii,
                "pondere": round(100 * aparat / proprii, 1) if proprii > 0 else None,
                "total": round(d.get("venituri", {}).get("total") or 0, 2)
            }
            luate += 1
            if pauza:
                time.sleep(pauza)
        print(f"   {k:2}/{len(judete)} {cod}: {luate} din {len(primarii)} de primării")
    return rezultat, judete_cj


def principal():
    ap = argparse.ArgumentParser(description="Datele financiare pentru criteriul de capacitate administrativă.")
    ap.add_argument("--surse", default=os.path.join(tempfile.gettempdir(), "ro-adp-surse"))
    ap.add_argument("--forteaza", action="store_true", help="descarcă din nou, ignorând copiile locale")
    ap.add_argument("--repede", action="store_true", help="fără pauză între cereri (folosește cu cap)")
    arg = ap.parse_args()

    if not os.path.exists(CALE_UAT):
        print(f"Lipsește {CALE_UAT}. Rulează întâi unelte/prelucrare.py.")
        return 1
    with open(CALE_UAT, encoding="utf-8") as f:
        date = json.load(f)
    os.makedirs(arg.surse, exist_ok=True)
    citeste_xls, citeste_xlsx = citeste_tabele()

    print("1/2 arierate (Ministerul Finanțelor)")
    try:
        arierate, arierate_uat, perioada = arierate_judete(arg.surse, arg.forteaza, citeste_xls)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"   nu s-au putut lua ({type(e).__name__}: {e})")
        arierate, arierate_uat, perioada = {}, [], None

    # numele județelor din fișierul MF sunt cu majuscule și fără diacritice
    tabel = str.maketrans("ĂÂÎȘŞȚŢ", "AAISSTT")
    dupa_nume = {j["n"].upper().translate(tabel): j["c"] for j in date["judete"]}
    pe_judet = {}
    nepotrivite = []
    for nume, valoare in arierate.items():
        cod = dupa_nume.get(nume.translate(tabel))
        if cod is None:
            nepotrivite.append(nume)
        else:
            pe_judet[cod] = valoare
    if nepotrivite:
        print(f"   județe fără potrivire: {', '.join(nepotrivite[:6])}{' …' if len(nepotrivite) > 6 else ''}")

    # UAT-urile cu plăți restante, potrivite după nume în interiorul județului
    pe_uat = {}
    neg = []
    for nume_judet, nume_uat, valoare in arierate_uat:
        cod = dupa_nume.get(nume_judet.translate(tabel))
        cheie = nume_uat.upper().translate(tabel)
        gasit = next((u for u in date["uat"]
                      if u["j"] == cod and u["n"].upper().translate(tabel) == cheie), None)
        if gasit:
            pe_uat[gasit["s"]] = valoare
        else:
            neg.append(f"{nume_uat} ({nume_judet})")
    print(f"   UAT-uri potrivite: {len(pe_uat)}" +
          (f"; fără potrivire: {', '.join(neg[:5])}{' …' if len(neg) > 5 else ''}" if neg else ""))

    print(f"2/3 execuția bugetară pe primării ({AN_EXECUTIE}, executii-bugetare.g4d.ro)")
    try:
        executie, consilii_judetene = executie_primarii(arg.surse, arg.forteaza, 0 if arg.repede else 0.1)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"   nu s-a putut lua ({type(e).__name__}: {e})")
        executie, consilii_judetene = {}, {}
    print(f"   {len(consilii_judetene)} de consilii județene cu execuție")
    print(f"   {len(executie)} de primării cu execuție")

    print("3/3 indicatori pe UAT (export din transparență bugetară, opțional)")
    uat = indicatori_uat(arg.surse, citeste_xls, citeste_xlsx)

    # execuția, potrivită pe SIRUTA: numele primăriei, în județul ei. Potrivirea se face
    # aici, o singură dată, ca modulele din pagină să caute direct după cod.
    dupa_auto = {j["auto"]: j["c"] for j in date["judete"]}
    curat = lambda t: " ".join(str(t or "").upper().translate(tabel)
                               .replace("PRIMARIA", " ").replace("MUNICIPIUL", " ")
                               .replace("ORASUL", " ").replace("COMUNA", " ")
                               .replace("-", " ").split())
    dupa_cheie = {}
    for u in date["uat"]:
        dupa_cheie.setdefault((u["j"], curat(u["n"])), u["s"])
    executie_uat, fara_uat = {}, []
    for cif, e in executie.items():
        # g4d dă județul prin numărul de înmatriculare (SB), nu prin nume
        cod = dupa_auto.get(e["judet"].upper())
        siruta = dupa_cheie.get((cod, curat(e["nume"])))
        if siruta is None:
            fara_uat.append(e["nume"])
            continue
        executie_uat[siruta] = {
            "venituriProprii": e["venituriProprii"],
            "cheltuieliAparat": e["cheltuieliAparat"],
            "cheltuieliTotal": e.get("cheltuieliTotal"),
            "investitii": e.get("investitii"),
            "domenii": e.get("domenii"),
            "personalAparat": e.get("personalAparat"),
            "personalTotal": e.get("personalTotal"),
            "pondere": e["pondere"],
        }
    print(f"   execuție potrivită pe SIRUTA: {len(executie_uat)}" +
          (f"; nepotrivite: {', '.join(fara_uat[:4])}{' …' if len(fara_uat) > 4 else ''}" if fara_uat else ""))

    iesire = {
        "versiune": 1,
        "generat": time.strftime("%Y-%m-%d"),
        "pragAdministratie": PRAG_ADMINISTRATIE,
        "perioadaArierate": perioada,
        "arierateJudete": pe_judet,
        "arierateUat": pe_uat,
        "anExecutie": AN_EXECUTIE,
        "executie": executie,
        "executieUat": executie_uat,
        "consiliiJudetene": {str(dupa_auto[c]): v for c, v in consilii_judetene.items() if c in dupa_auto},
        "uat": uat,
        "surse": [
            "Ministerul Finanțelor — situația plăților restante ale UAT-urilor (agregat pe județe), "
            + PAGINA_MF,
            "Ministerul Finanțelor — platforma Transparență bugetară (www.transparenta-bugetara.gov.ro): "
            "execuția pe fiecare UAT; platforma nu acceptă conexiuni din afara unui browser, "
            f"deci exportul se pune manual în folderul de surse, ca „{EXPORT_UAT}”",
            "Criteriul de capacitate administrativă: Republica Moldova, Legea privind organizarea "
            "administrativ-teritorială — administrația și instituțiile sociale sub 30% din veniturile proprii"
        ],
        "nota": "Fără exportul pe UAT, criteriul financiar rămâne indisponibil în hartă; "
                "arieratele pe județe se pot folosi doar ca semnal, nu ca prag."
    }
    os.makedirs(os.path.dirname(CALE_IESIRE), exist_ok=True)
    with open(CALE_IESIRE, "w", encoding="utf-8") as f:
        json.dump(iesire, f, ensure_ascii=False, separators=(",", ":"))
    print(f"scris {CALE_IESIRE} ({os.path.getsize(CALE_IESIRE)} octeți)")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
