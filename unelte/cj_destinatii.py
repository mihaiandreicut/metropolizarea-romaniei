# -*- coding: utf-8 -*-
"""
cj_destinatii.py — pe ce cheltuiește fiecare consiliu județean, din execuția bugetară 2025.

Pasul 4 din planul de lucru (sinteza.html) mută atribuțiile consiliilor județene la district și la
regiune. Ca mutarea să se așeze pe bani reali, nu pe o ipoteză, aici se iau cheltuielile fiecărui
consiliu județean pe destinații (clasificația funcțională: spitale, drumuri, asistență socială,
cultură ...), cu cheltuiala de personal a fiecărei destinații.

Sursa: executii-bugetare.g4d.ro — aceleași fișiere JSON pe care le citește unelte/finante.py
(un fișier pe instituție și an). Funcțiile de descărcare vin din finante.py, încărcat din fișier,
ca să nu existe două implementări.

Iese: date/cj-destinatii.json. Gruparea destinațiilor pe atribuții și destinația lor (district /
regiune) se face în js/adp-raport.js, ca să se poată schimba fără a descărca din nou.

Rulare:  python unelte/cj_destinatii.py [--surse DIR] [--forteaza]
"""

import argparse
import importlib.util
import json
import os
import tempfile
import time
import urllib.error

CALE_UAT = "date/romania-uat.json"
CALE_IESIRE = "date/cj-destinatii.json"


def incarca_finante():
    cale = os.path.join(os.path.dirname(os.path.abspath(__file__)), "finante.py")
    spec = importlib.util.spec_from_file_location("finante", cale)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def principal():
    ap = argparse.ArgumentParser(description="Cheltuielile consiliilor județene pe destinații.")
    ap.add_argument("--surse", default=os.path.join(tempfile.gettempdir(), "ro-adp-surse"))
    ap.add_argument("--forteaza", action="store_true", help="descarcă din nou și ce există în cache")
    arg = ap.parse_args()

    f = incarca_finante()
    with open(CALE_UAT, encoding="utf-8") as fisier:
        date = json.load(fisier)
    dupa_auto = {j["auto"]: j["c"] for j in date["judete"]}

    def json_de_la(cale, nume):
        brut = f.descarca(f"{f.G4D}/{cale}", os.path.join(arg.surse, "g4d", nume), arg.forteaza)
        return json.loads(brut)

    judete = {}
    lipsa = []
    for k, j in enumerate(json_de_la("judete.json", "judete.json"), 1):
        cod = j["cod"]
        if cod not in dupa_auto:
            continue
        try:
            institutii = json_de_la(f"{f.AN_EXECUTIE}/{cod}/institutii.json", f"{cod}-institutii.json")
            consilii = [i for i in institutii if i.get("cjudetean")]
            if not consilii:
                lipsa.append(cod)
                continue
            d = json_de_la(f"{f.AN_EXECUTIE}/{cod}/{consilii[0]['cif']}.json", f"{cod}-{consilii[0]['cif']}.json")
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            print(f"   {cod}: nu a putut fi luat ({e})")
            lipsa.append(cod)
            continue
        chelt = d.get("cheltuieli", {})
        # personalul fiecărei destinații, din liniile economice ale tabelului
        personal = {}
        for destinatie in chelt.get("tabel", []) or []:
            personal[str(destinatie.get("desc", "")).strip()] = sum(
                linie.get("suma") or 0 for linie in destinatie.get("linii", []) or []
                if str(linie.get("desc", "")).strip() in f.LINII_PERSONAL)
        destinatii = []
        for nume, serie in (chelt.get("diagrama", {}) or {}).items():
            total = sum(v for v in serie if isinstance(v, (int, float)))
            if total:
                destinatii.append({"nume": nume.strip(), "total": round(total),
                                   "personal": round(personal.get(nume.strip(), 0))})
        destinatii.sort(key=lambda x: -x["total"])
        judete[str(dupa_auto[cod])] = {
            "nume": consilii[0].get("nume", ""),
            "total": round(chelt.get("total") or 0),
            "destinatii": destinatii
        }
        print(f"   {k:2}/{len(dupa_auto) + 1} {cod}: {len(destinatii)} destinații")
        time.sleep(0.1)

    iesire = {
        "versiune": 1,
        "generat": time.strftime("%Y-%m-%d"),
        "anExecutie": f.AN_EXECUTIE,
        "judete": judete,
        "surse": [f"Execuția bugetară {f.AN_EXECUTIE} a consiliilor județene, executii-bugetare.g4d.ro (date Ministerul Finanțelor)"],
        "nota": "Cheltuieli pe destinații în clasificația funcțională; personalul e titlul 10 al fiecărei destinații. "
                "Bucureștiul nu are consiliu județean."
    }
    with open(CALE_IESIRE, "w", encoding="utf-8") as fisier:
        json.dump(iesire, fisier, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(judete)} consilii județene -> {CALE_IESIRE}" + (f"; lipsă: {', '.join(lipsa)}" if lipsa else ""))


if __name__ == "__main__":
    principal()
