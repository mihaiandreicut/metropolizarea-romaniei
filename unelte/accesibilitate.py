# -*- coding: utf-8 -*-
"""
e-ro-adp — atributele de accesibilitate ale localităților, pe județe:
generează date/judete/<judet>.json și date/judete/index.json.

Pentru fiecare localitate componentă (sat, localitate a unui oraș):
    timp și distanță rutieră până la fiecare reședință de UAT din județ   (OSRM)
    dotări din OpenStreetMap, atribuite celei mai apropiate localități     (Overpass)
    altitudine                                                             (OpenTopoData, SRTM 90 m)
Școlile (rețeaua școlară oficială) vin deja din date/localitati.json.

Script autonom: doar biblioteca standard Python (3.9+). Citește datele generate de
unelte/prelucrare.py (date/romania-uat.json, date/localitati.json).

Serviciile publice au limite de folosire: cererile sunt rare (pauză între ele),
iar un județ deja generat nu se mai cere din nou (se poate relua oricând).
Toată țara: ~700 de cereri OSRM, ~40 Overpass, ~140 OpenTopoData — circa o oră.

Rulare:
    python unelte/accesibilitate.py                    # toate județele (fără București)
    python unelte/accesibilitate.py --judete 18,11     # doar Gorj și Caraș-Severin
    python unelte/accesibilitate.py --forteaza         # regenerează și ce există deja
"""
import argparse
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

RADACINA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT = "e-ro-adp/1.0 (studiu reorganizare administrativa; script autonom)"
RESEDINTE = (9, 17, 22)
RAZA_SERVICII_KM = 3.0
LOT_SURSE = 38          # OSRM: cel mult 100 de coordonate pe cerere (surse + destinații)
LOT_DESTINATII = 60
BUCURESTI = 40          # un singur UAT, fără sate — nu are sens aici
# Overpass e des supraîncărcat: se încearcă pe rând mai multe servere publice
OVERPASS = ["https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]

# categorii de dotări, după dotările minime obligatorii din Legea 351/2001, anexa IV
CATEGORII = {
    "primarie": [("amenity", "townhall")],
    "scoala": [("amenity", "school")],
    "gradinita": [("amenity", "kindergarten")],
    "medic": [("amenity", "doctors"), ("amenity", "clinic"), ("amenity", "hospital"), ("healthcare", "doctor"), ("healthcare", "centre")],
    "farmacie": [("amenity", "pharmacy"), ("healthcare", "pharmacy")],
    "posta": [("amenity", "post_office")],
    "politie": [("amenity", "police")],
    "cultura": [("amenity", "library"), ("amenity", "community_centre"), ("amenity", "arts_centre")],
    "biserica": [("amenity", "place_of_worship")],
    "magazin": [("shop", "supermarket"), ("shop", "convenience"), ("shop", "general")],
    "banca": [("amenity", "bank"), ("amenity", "atm")],
    "gara": [("railway", "station"), ("railway", "halt")],
    "autobuz": [("highway", "bus_stop"), ("public_transport", "platform")],
    "veterinar": [("amenity", "veterinary")],
    "pompieri": [("amenity", "fire_station")],
    "sport": [("leisure", "pitch"), ("leisure", "sports_centre")],
}


def slug(nume):
    s = "".join(ch for ch in unicodedata.normalize("NFD", nume.lower()) if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def cere(url, date=None, incercari=5):
    for k in range(incercari):
        try:
            req = urllib.request.Request(url, data=date, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # rețea publică: se reîncearcă cu pauze crescătoare, apoi eroare clară
            print("    reîncerc", k + 1, e, flush=True)
            time.sleep(10 * (k + 1))
    raise RuntimeError("cererea a eșuat de %d ori: %s" % (incercari, url[:120]))


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(d))


def categorie(tags):
    for cat, perechi in CATEGORII.items():
        if any(tags.get(k) == v for k, v in perechi):
            return cat
    return None


def timpi_osrm(sate, resed, pauza):
    """Matricea sat × reședință (minute, km), în loturi pe ambele dimensiuni."""
    timp = [[None] * len(resed) for _ in sate]
    dist = [[None] * len(resed) for _ in sate]
    abatere = [None] * len(sate)
    for i0 in range(0, len(sate), LOT_SURSE):
        surse = sate[i0:i0 + LOT_SURSE]
        for j0 in range(0, len(resed), LOT_DESTINATII):
            dest = resed[j0:j0 + LOT_DESTINATII]
            coord = ";".join(f"{x['e'][1]},{x['e'][0]}" for x in surse + dest)
            url = ("https://router.project-osrm.org/table/v1/driving/" + coord +
                   "?sources=" + ";".join(str(k) for k in range(len(surse))) +
                   "&destinations=" + ";".join(str(len(surse) + k) for k in range(len(dest))) +
                   "&annotations=duration,distance")
            r = cere(url)
            if r.get("code") != "Ok":
                raise RuntimeError("OSRM: " + str(r.get("message")))
            for k in range(len(surse)):
                for m in range(len(dest)):
                    v = r["durations"][k][m]
                    d = r["distances"][k][m]
                    timp[i0 + k][j0 + m] = None if v is None else round(v / 60, 1)
                    dist[i0 + k][j0 + m] = None if d is None else round(d / 1000, 1)
                abatere[i0 + k] = round(r["sources"][k]["distance"])   # cât de departe e drumul de punctul satului
            time.sleep(pauza)
        print("    OSRM", min(i0 + LOT_SURSE, len(sate)), "/", len(sate), flush=True)
    return timp, dist, abatere


def cere_overpass(interogare, pauza):
    """Aceeași interogare, pe rând la fiecare server public, cu pauze crescătoare."""
    date = urllib.parse.urlencode({"data": interogare}).encode()
    for tura in range(3):
        for url in OVERPASS:
            try:
                req = urllib.request.Request(url, data=date, headers={"User-Agent": AGENT})
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:
                print("    Overpass", url.split("/")[2], "—", e, flush=True)
                time.sleep(pauza * (5 + 10 * tura))
    raise RuntimeError("Overpass: toate serverele au refuzat interogarea")


def dotari_osm(sate, toate_localitatile, pauza):
    lat = [x["e"][0] for x in sate]
    lng = [x["e"][1] for x in sate]
    s, v, n, e = min(lat) - 0.05, min(lng) - 0.07, max(lat) + 0.05, max(lng) + 0.07
    filtre = "".join(f'nwr["{k}"="{val}"]({s},{v},{n},{e});' for per in CATEGORII.values() for k, val in per)
    r = cere_overpass(f"[out:json][timeout:240];({filtre});out center tags;", pauza)
    time.sleep(pauza * 4)
    # toate localitățile din zonă (și din județele vecine), ca o dotare de la graniță
    # să nu fie atribuită greșit unui sat din județul curent
    zona = [x for x in toate_localitatile if x["e"] and s - 0.1 <= x["e"][0] <= n + 0.1 and v - 0.1 <= x["e"][1] <= e + 0.1]
    index = {x["s"]: k for k, x in enumerate(sate)}
    serv = [dict() for _ in sate]
    for el in r["elements"]:
        c = categorie(el.get("tags", {}))
        if not c:
            continue
        p = (el["lat"], el["lon"]) if "lat" in el else (el["center"]["lat"], el["center"]["lon"])
        cel = min(zona, key=lambda x: (x["e"][0] - p[0]) ** 2 + ((x["e"][1] - p[1]) * 0.7) ** 2)
        if km(cel["e"], p) <= RAZA_SERVICII_KM and cel["s"] in index:
            d = serv[index[cel["s"]]]
            d[c] = d.get(c, 0) + 1
    print("    OSM:", len(r["elements"]), "elemente", flush=True)
    return serv


def altitudini(sate, pauza):
    alt = []
    for i0 in range(0, len(sate), 100):
        pts = "|".join(f"{x['e'][0]},{x['e'][1]}" for x in sate[i0:i0 + 100])
        r = cere("https://api.opentopodata.org/v1/srtm90m?locations=" + urllib.parse.quote(pts, safe=",|"))
        alt.extend(None if x["elevation"] is None else round(x["elevation"]) for x in r["results"])
        time.sleep(max(1.1, pauza))
    return alt


def main():
    arg = argparse.ArgumentParser(description="Generează date/judete/<judet>.json și date/judete/index.json.")
    arg.add_argument("--judete", default="toate", help="coduri SIRUTA de județ separate prin virgulă, sau „toate”")
    arg.add_argument("--date", default=os.path.join(RADACINA, "date"))
    arg.add_argument("--pauza", type=float, default=1.5, help="secunde între cereri")
    arg.add_argument("--forteaza", action="store_true", help="regenerează și județele deja generate")
    a = arg.parse_args()

    date_uat = json.load(open(os.path.join(a.date, "romania-uat.json"), encoding="utf-8"))
    loc = json.load(open(os.path.join(a.date, "localitati.json"), encoding="utf-8"))["localitati"]
    uat = date_uat["uat"]
    judete = {j["c"]: j for j in date_uat["judete"] if j["c"] != BUCURESTI}
    jud_uat = {u["s"]: u["j"] for u in uat}
    eticheta_uat = {u["s"]: u["e"] for u in uat}
    coduri = sorted(judete) if a.judete == "toate" else [int(x) for x in a.judete.split(",")]
    director = os.path.join(a.date, "judete")
    os.makedirs(director, exist_ok=True)
    cale_index = os.path.join(director, "index.json")
    index = json.load(open(cale_index, encoding="utf-8")) if os.path.exists(cale_index) else {"judete": []}
    dupa_cod = {x["cod"]: x for x in index["judete"]}

    esuate = []
    for cod in coduri:
        j = judete[cod]
        nume = slug(j["n"])
        cale = os.path.join(director, nume + ".json")
        if os.path.exists(cale) and not a.forteaza:
            print("==", j["n"], "— există, sar peste", flush=True)
        else:
            print("==", j["n"], flush=True)
            sate = [dict(x) for x in loc if jud_uat.get(x["u"]) == cod and (x["e"] or x["t"] in RESEDINTE)]
            for x in sate:
                if not x["e"]:
                    # reședință fără coordonate în Wikidata: punctul interior al UAT-ului
                    x["e"] = eticheta_uat[x["u"]]
            resed = [x for x in sate if x["t"] in RESEDINTE]
            if not (len({x["u"] for x in resed}) == len(resed) == len({x["u"] for x in sate})):
                raise RuntimeError("%s: fiecare UAT trebuie să aibă exact o reședință" % j["n"])
            try:
                timp, dist, abatere = timpi_osrm(sate, resed, a.pauza)
                serv = dotari_osm(sate, loc, a.pauza)
                alt = altitudini(sate, a.pauza)
            except RuntimeError as e:
                # un serviciu public indisponibil nu oprește restul județelor
                print("   !! %s — %s; se reia la următoarea rulare" % (j["n"], e), flush=True)
                esuate.append(j["n"])
                continue
            for k, x in enumerate(sate):
                x.update(alt=alt[k], serv=serv[k], abat=abatere[k])
            iesire = dict(
                versiune=1, judet=cod, nume=j["n"], generat=time.strftime("%Y-%m-%d"),
                surse=["OSRM (router.project-osrm.org) pe date OpenStreetMap — timp și distanță rutieră",
                       "OpenStreetMap via Overpass API — dotări, atribuite celei mai apropiate localități (max. %g km)" % RAZA_SERVICII_KM,
                       "OpenTopoData SRTM 90 m — altitudine",
                       "INS RPL 2021 tab. 1.22 — populație; Wikidata — coordonate",
                       "Ministerul Educației — rețeaua școlară 2024-2025 (data.gov.ro), pe cod SIRUTA"],
                resedinte=[x["s"] for x in resed], sate=sate, timp=timp, dist=dist)
            with open(cale + ".tmp", "w", encoding="utf-8") as f:
                json.dump(iesire, f, ensure_ascii=False, separators=(",", ":"))
            os.replace(cale + ".tmp", cale)
            print("   scris", cale, os.path.getsize(cale), "octeți", flush=True)
        if not os.path.exists(cale):
            continue
        generat = json.load(open(cale, encoding="utf-8"))["generat"]
        dupa_cod[cod] = dict(cod=cod, nume=j["n"], auto=j["auto"], fisier="judete/" + nume + ".json", generat=generat)
        index["judete"] = sorted(dupa_cod.values(), key=lambda x: x["nume"])
        with open(cale_index, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=1)
    print("gata:", len(index["judete"]), "județe;", "eșuate:", ", ".join(esuate) if esuate else "niciunul")
    return 1 if esuate else 0


if __name__ == "__main__":
    sys.exit(main())
