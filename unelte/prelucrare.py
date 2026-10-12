# -*- coding: utf-8 -*-
"""
e-ro-adp — prelucrarea datelor pentru hartă: generează date/romania-uat.json și
date/localitati.json din sursele oficiale.

Script autonom: doar biblioteca standard Python (3.9+). Nu importă nimic din
proiect și niciun pachet extern — fișierele Excel (.xlsx și .xls vechi) sunt
citite de cititoarele de mai jos.

Rulare (din rădăcina proiectului sau de oriunde):
    python unelte/prelucrare.py [--surse DIR] [--iesire DIR]

    --surse   unde se descarcă / se găsesc sursele (implicit: %TEMP%/e-ro-adp-surse);
              ce lipsește se descarcă automat (~90 MB, în principal Eurostat GISCO)
    --iesire  unde se scriu fișierele JSON (implicit: <proiect>/date)

Surse:
    Eurostat GISCO — LAU 2024 (geometrie, populația 2024 după domiciliu), LAU 2021, LAU 2011
    INS — SIRUTA 2025; RPL 2021 tabelele 1.22, 1.3.2, 2.2.2; lista UAT izolate / dispersate
    geo-spatial.org — județele interbelice 1930 (CC BY-SA 3.0) → regiunile istorice
    Wikidata — coordonatele localităților pe cod SIRUTA (P843, P625)
    Ministerul Educației — rețeaua școlară 2024–2025
"""
import argparse
import csv
import json
import math
import os
import re
import sqlite3
import struct
import sys
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict

RADACINA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT = "e-ro-adp/1.0 (prelucrare date administrative; script autonom)"

CUANTA = 1e-4         # grade — grila de cuantizare (~11 m pe latitudine, ~8 m pe longitudine)
TOLERANTA = 6e-4      # grade — toleranța Douglas-Peucker pe arce (~50–65 m)

GISCO = "https://gisco-services.ec.europa.eu/distribution/v2/lau/"
RPL = "https://www.recensamantromania.ro/wp-content/uploads/"
SURSE = {
    "lau2024.gpkg": GISCO + "gpkg/LAU_RG_01M_2024_4326.gpkg",
    "lau2021.csv": GISCO + "csv/LAU_RG_01M_2021_4326.csv",
    "lau2011.csv": GISCO + "csv/LAU_RG_01M_2011_4326.csv",
    "siruta2025.xlsx": "https://data.gov.ro/dataset/fcba1a54-cffd-422c-b3ac-920f63564085/resource/"
                       "0ab29d86-302c-4cfa-b9b9-fd5c7ff90710/download/siruta_s1_2025.csv",
    "rpl-1.22.xlsx": RPL + "2023/05/Tabel-1.22.xlsx",
    "rpl-1.03.xls": RPL + "2023/05/Tabel-1.03_1.3.1-si-1.03.2.xls",
    "rpl-2.02.xlsx": RPL + "2023/06/Tabel-2.02.1-si-Tabel-2.02.2.xlsx",
    "izolate-dispersate.xls": RPL + "2022/02/Lista-UAT-uri-izolat_dispersate_site-RPL_rev.xls",
    "judete1930.zip": "http://geo-spatial.org/vechi/file_download/29417",
    "retea-scolara.xlsx": "https://data.gov.ro/dataset/69abefd6-8d94-458c-bc5a-a40c52e73402/resource/"
                          "d474f5be-9f11-440b-a309-df7f34960e33/download/retea-scolara-2024-2025.xlsx",
}
WIKIDATA_SPARQL = "SELECT ?s ?siruta ?coord WHERE { ?s wdt:P843 ?siruta . ?s wdt:P625 ?coord . }"


# ============================================================ descărcare
def asigura(director, nume):
    cale = os.path.join(director, nume)
    if os.path.exists(cale) and os.path.getsize(cale) > 0:
        return cale
    if nume == "wikidata-siruta.csv":
        url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": WIKIDATA_SPARQL})
        antete = {"User-Agent": AGENT, "Accept": "text/csv"}
    else:
        url = SURSE[nume]
        antete = {"User-Agent": AGENT}
    print("  descarc", nume, "...", flush=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=antete), timeout=600) as r, open(cale + ".tmp", "wb") as f:
        while True:
            bucata = r.read(1 << 20)
            if not bucata:
                break
            f.write(bucata)
    os.replace(cale + ".tmp", cale)
    return cale


# ============================================================ cititor .xlsx (OOXML)
NS_M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _coloana(ref):
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + ord(ch.upper()) - 64
    return n - 1


def _numar(text):
    v = float(text)
    return int(v) if v.is_integer() else v


def citeste_xlsx(cale, foaie=0):
    """Rândurile unei foi (după index sau nume), ca tupluri; celulele goale = None."""
    with zipfile.ZipFile(cale) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        foi = [(s.get("name"), s.get(NS_R + "id")) for s in wb.find(NS_M + "sheets")]
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        tinte = {r.get("Id"): r.get("Target") for r in rels}
        rid = foi[foaie][1] if isinstance(foaie, int) else dict(foi)[foaie]
        tinta = tinte[rid]
        cale_foaie = tinta.lstrip("/") if tinta.startswith("/") else "xl/" + tinta
        partajate = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(NS_M + "si"):
                partajate.append("".join(t.text or "" for t in si.iter(NS_M + "t")))
        radacina = ET.fromstring(z.read(cale_foaie))
    randuri = []
    for rand in radacina.iter(NS_M + "row"):
        celule = {}
        for c in rand.iter(NS_M + "c"):
            tip = c.get("t")
            v = c.find(NS_M + "v")
            if tip == "s":
                val = partajate[int(v.text)]
            elif tip == "inlineStr":
                val = "".join(t.text or "" for t in c.iter(NS_M + "t"))
            elif tip in ("str", "e"):
                val = v.text if v is not None else None
            elif tip == "b":
                val = v is not None and v.text == "1"
            else:
                val = _numar(v.text) if v is not None and v.text is not None else None
            celule[_coloana(c.get("r"))] = val
        if celule:
            randuri.append(tuple(celule.get(k) for k in range(max(celule) + 1)))
    return randuri


# ============================================================ cititor .xls (BIFF8 în container OLE2/CFB)
def _flux_workbook(date):
    if date[:8] != bytes.fromhex("D0CF11E0A1B11AE1"):
        raise ValueError("nu e un fișier OLE2 (.xls)")
    S = 1 << struct.unpack_from("<H", date, 0x1E)[0]
    nr_fat = struct.unpack_from("<I", date, 0x2C)[0]
    director = struct.unpack_from("<I", date, 0x30)[0]
    prag_mini = struct.unpack_from("<I", date, 0x38)[0]
    difat_start, nr_difat = struct.unpack_from("<II", date, 0x44)
    difat = list(struct.unpack_from("<109I", date, 0x4C))
    s = difat_start
    for _ in range(nr_difat):
        v = struct.unpack_from("<%dI" % (S // 4), date, (s + 1) * S)
        difat.extend(v[:-1])
        s = v[-1]
    fat = []
    for sec in difat[:nr_fat]:
        fat.extend(struct.unpack_from("<%dI" % (S // 4), date, (sec + 1) * S))

    def lant(start):
        bucati = []
        s = start
        while s < 0xFFFFFFFA:
            bucati.append(date[(s + 1) * S:(s + 2) * S])
            s = fat[s]
        return b"".join(bucati)

    intrari = lant(director)
    for k in range(len(intrari) // 128):
        e = intrari[k * 128:(k + 1) * 128]
        lung = struct.unpack_from("<H", e, 0x40)[0]
        nume = e[:max(0, lung - 2)].decode("utf-16-le")
        if nume in ("Workbook", "Book") and e[0x42] == 2:
            start, marime = struct.unpack_from("<II", e, 0x74)
            if marime < prag_mini:
                raise ValueError("fluxul Workbook e în mini-stream (neacceptat)")
            return lant(start)[:marime]
    raise ValueError("fluxul Workbook lipsește")


class _Cursor:
    """Citește șiruri SST care pot trece peste granițele înregistrărilor CONTINUE."""

    def __init__(self, segmente):
        self.seg = segmente
        self.i = 0
        self.p = 0

    def rest(self):
        return len(self.seg[self.i]) - self.p

    def octeti(self, n):
        rez = b""
        while n > 0:
            if self.rest() == 0:
                self.i += 1
                self.p = 0
            k = min(n, self.rest())
            rez += self.seg[self.i][self.p:self.p + k]
            self.p += k
            n -= k
        return rez

    def sir(self):
        cch = struct.unpack("<H", self.octeti(2))[0]
        opt = self.octeti(1)[0]
        larg = opt & 1
        runs = struct.unpack("<H", self.octeti(2))[0] if opt & 8 else 0
        ext = struct.unpack("<I", self.octeti(4))[0] if opt & 4 else 0
        bucati = []
        ramas = cch
        while ramas > 0:
            if self.rest() == 0:
                # un șir rupt continuă cu un nou octet de opțiuni (doar lățimea caracterelor)
                self.i += 1
                self.p = 0
                larg = self.seg[self.i][0] & 1
                self.p = 1
            w = 2 if larg else 1
            k = min(ramas, self.rest() // w)
            if k == 0:
                self.p = len(self.seg[self.i])
                continue
            brut = self.seg[self.i][self.p:self.p + k * w]
            self.p += k * w
            bucati.append(brut.decode("utf-16-le") if larg else brut.decode("latin-1"))
            ramas -= k
        self.octeti(4 * runs)
        self.octeti(ext)
        return "".join(bucati)


def _sir_simplu(b, p, lung_octeti=2):
    cch = struct.unpack_from("<H", b, p)[0] if lung_octeti == 2 else b[p]
    p += lung_octeti
    opt = b[p]
    p += 1
    if opt & 1:
        return b[p:p + 2 * cch].decode("utf-16-le")
    return b[p:p + cch].decode("latin-1")


def _rk(v):
    if v & 2:
        n = struct.unpack("<i", struct.pack("<I", v & 0xFFFFFFFC))[0] >> 2
    else:
        n = struct.unpack("<d", struct.pack("<Q", (v & 0xFFFFFFFC) << 32))[0]
    return n / 100 if v & 1 else n


def citeste_xls(cale, foaie=0):
    """Rândurile unei foi dintr-un .xls (BIFF8), ca tupluri; celulele goale = None."""
    flux = _flux_workbook(open(cale, "rb").read())
    inreg = []
    p = 0
    while p + 4 <= len(flux):
        tip, lung = struct.unpack_from("<HH", flux, p)
        inreg.append((tip, flux[p + 4:p + 4 + lung], p))
        p += 4 + lung
    foi, sst = [], []
    for k, (tip, b, _) in enumerate(inreg):
        if tip == 0x0085:                           # BOUNDSHEET
            poz = struct.unpack_from("<I", b, 0)[0]
            foi.append((_sir_simplu(b, 6, 1), poz))
        elif tip == 0x00FC:                         # SST (+ CONTINUE)
            segmente = [b]
            j = k + 1
            while j < len(inreg) and inreg[j][0] == 0x003C:
                segmente.append(inreg[j][1])
                j += 1
            unice = struct.unpack_from("<I", b, 4)[0]
            c = _Cursor(segmente)
            c.p = 8
            sst = [c.sir() for _ in range(unice)]
        elif tip == 0x000A and foi:                 # EOF al fluxului global
            break
    poz = foi[foaie][1] if isinstance(foaie, int) else dict(foi)[foaie]
    start = next(k for k, (_, _, p) in enumerate(inreg) if p == poz)
    celule = defaultdict(dict)
    ultima_formula = None
    for tip, b, _ in inreg[start + 1:]:
        if tip == 0x000A:
            break
        if tip == 0x00FD:                           # LABELSST
            r, c, _, i = struct.unpack_from("<HHHI", b)
            celule[r][c] = sst[i]
        elif tip == 0x0203:                         # NUMBER
            r, c, _, v = struct.unpack_from("<HHHd", b)
            celule[r][c] = int(v) if v.is_integer() else v
        elif tip == 0x027E:                         # RK
            r, c, _, v = struct.unpack_from("<HHHI", b)
            v = _rk(v)
            celule[r][c] = int(v) if float(v).is_integer() else v
        elif tip == 0x00BD:                         # MULRK
            r, c0 = struct.unpack_from("<HH", b)
            for k in range((len(b) - 6) // 6):
                v = _rk(struct.unpack_from("<I", b, 4 + 6 * k + 2)[0])
                celule[r][c0 + k] = int(v) if float(v).is_integer() else v
        elif tip == 0x0204:                         # LABEL
            r, c = struct.unpack_from("<HH", b)
            celule[r][c] = _sir_simplu(b, 6)
        elif tip == 0x0006:                         # FORMULA (rezultatul memorat)
            r, c = struct.unpack_from("<HH", b)
            if b[12:14] == b"\xff\xff":
                ultima_formula = (r, c) if b[6] == 0 else None
            else:
                v = struct.unpack_from("<d", b, 6)[0]
                celule[r][c] = int(v) if v.is_integer() else v
        elif tip == 0x0207 and ultima_formula:      # STRING (rezultat text al formulei)
            celule[ultima_formula[0]][ultima_formula[1]] = _sir_simplu(b, 0)
            ultima_formula = None
    randuri = []
    for r in sorted(celule):
        d = celule[r]
        randuri.append(tuple(d.get(k) for k in range(max(d) + 1)))
    return randuri


def citeste_foaie(cale, foaie=0):
    return citeste_xls(cale, foaie) if cale.lower().endswith(".xls") else citeste_xlsx(cale, foaie)


def celula(r, k):
    return r[k] if k < len(r) else None


# ============================================================ geometrie: GeoPackage, shapefile
def citeste_wkb(buf, off=0):
    """Întoarce (listă de poligoane [listă de inele [listă (lon, lat)]], offset)."""
    bo = "<" if buf[off] == 1 else ">"
    tip = struct.unpack_from(bo + "I", buf, off + 1)[0]
    off += 5
    baza = tip % 1000
    dim = 3 if (tip // 1000) in (1, 2) else (4 if tip // 1000 == 3 else 2)
    if baza == 3:
        nr = struct.unpack_from(bo + "I", buf, off)[0]
        off += 4
        inele = []
        for _ in range(nr):
            np_ = struct.unpack_from(bo + "I", buf, off)[0]
            off += 4
            pts = []
            for _ in range(np_):
                v = struct.unpack_from(bo + "d" * dim, buf, off)
                off += 8 * dim
                pts.append((v[0], v[1]))
            inele.append(pts)
        return [inele], off
    if baza == 6:
        nr = struct.unpack_from(bo + "I", buf, off)[0]
        off += 4
        pol = []
        for _ in range(nr):
            p, off = citeste_wkb(buf, off)
            pol.extend(p)
        return pol, off
    raise ValueError("tip WKB necunoscut %d" % tip)


def citeste_gpkg_geom(blob):
    env = (blob[3] >> 1) & 7
    return citeste_wkb(blob, 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[env])[0]


def citeste_shp(b):
    off = 100
    rez = []
    while off < len(b):
        _, lung = struct.unpack_from(">II", b, off)
        off += 8
        rec = b[off:off + lung * 2]
        off += lung * 2
        if struct.unpack_from("<i", rec, 0)[0] == 0:
            rez.append([])
            continue
        np_, npt = struct.unpack_from("<ii", rec, 36)
        parti = list(struct.unpack_from("<%di" % np_, rec, 44)) + [npt]
        p0 = 44 + 4 * np_
        pts = [struct.unpack_from("<dd", rec, p0 + 16 * i) for i in range(npt)]
        rez.append([pts[parti[i]:parti[i + 1]] for i in range(np_)])
    return rez


def citeste_dbf(f):
    n, hl, rl = struct.unpack_from("<IHH", f, 4)
    campuri = []
    i = 32
    while f[i] != 0x0D:
        campuri.append((f[i:i + 11].split(b"\0")[0].decode("cp1250"), f[i + 16]))
        i += 32
    rez = []
    off = hl
    for _ in range(n):
        rec = f[off + 1:off + rl]
        off += rl
        p = 0
        d = {}
        for nume, ln in campuri:
            v = rec[p:p + ln]
            p += ln
            try:
                d[nume] = v.decode("utf-8").strip()
            except UnicodeDecodeError:
                d[nume] = v.decode("cp1250").strip()
        rez.append(d)
    return rez


def in_poligon(x, y, inele):
    ins = False
    for r in inele:
        j = len(r) - 1
        for i in range(len(r)):
            xi, yi = r[i]
            xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-300) + xi:
                ins = not ins
            j = i
    return ins


def arie(r):
    return sum(r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1] for i in range(len(r))) / 2


def punct_interior(inele):
    """Punct garantat interior: mijlocul celui mai lat segment interior pe o orizontală."""
    ext = max(inele, key=lambda r: abs(arie(r)))
    ys = sorted(p[1] for p in ext)
    for frac in (0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8):
        y = ys[0] + (ys[-1] - ys[0]) * frac
        xs = []
        for r in inele:
            for i in range(len(r)):
                (x1, y1), (x2, y2) = r[i - 1], r[i]
                if (y1 > y) != (y2 > y):
                    xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        cand = [(xs[k + 1] - xs[k], (xs[k] + xs[k + 1]) / 2, y) for k in range(0, len(xs) - 1, 2)]
        if cand:
            _, x, y = max(cand)
            return x, y
    return ext[0]


# ============================================================ denumiri
def diacritice(s):
    return s.replace("ş", "ș").replace("Ş", "Ș").replace("ţ", "ț").replace("Ţ", "Ț")


MICI = {"de", "din", "la", "lui", "pe", "sub", "cu", "și", "în", "peste", "dintre", "spre", "a"}


def titlu(s):
    rez = []
    primul = True
    for c in re.split(r"(\s+|-)", diacritice(s.strip()).lower()):
        if not c or c.isspace() or c == "-":
            rez.append(c)
            continue
        rez.append(c if (not primul and c in MICI)
                   else re.sub(r"(^|\.)([a-zăâîșț])", lambda m: m.group(1) + m.group(2).upper(), c))
        primul = False
    return "".join(rez)


def fara_prefix(s):
    s = diacritice(s.strip())
    for p in ("MUNICIPIUL ", "ORAȘ ", "COMUNA "):
        if s.startswith(p):
            return s[len(p):]
    return s


def cheie(s):
    s = fara_prefix(str(s)).upper().replace("ORAS ", "")
    s = "".join(ch for ch in unicodedata.normalize("NFD", s) if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^A-Z0-9]", "", s)


def cheie_bruta(s):
    s = "".join(ch for ch in unicodedata.normalize("NFD", diacritice(s.strip().upper())) if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^A-Z0-9]", "", s)


def nr(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


# ============================================================ culori (reguli de lizibilitate pentru regiuni vecine)
# Paleta categorială — aceleași valori ca tokenii --serie-1..8 din css/adp-tema.css (lumină / întuneric).
PALETA = {
    "luminos": ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
    "intunecat": ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
}
# Machado, Oliveira & Fernandes (2009), severitate 1.0, în RGB liniar
MACHADO = {
    "protan": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    "deutan": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
}
PRAG_CVD = 6.0      # ΔE OKLab ×100, min(protan, deutan) — acceptabil doar cu etichete directe (harta le are)
PRAG_NORMAL = 15.0  # ΔE OKLab ×100, vedere normală


def _liniar(h):
    h = h.lstrip("#")
    rez = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        rez.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return rez


def _oklab(r, g, b):
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def _simulat(h, tip):
    r, g, b = _liniar(h)
    return [max(0.0, min(1.0, M[0] * r + M[1] * g + M[2] * b)) for M in MACHADO[tip]]


def delta_e(h1, h2, tip=None):
    a = _oklab(*(_simulat(h1, tip) if tip else _liniar(h1)))
    b = _oklab(*(_simulat(h2, tip) if tip else _liniar(h2)))
    return 100 * math.dist(a, b)


def perechi_bune():
    """Perechile de sloturi care pot sta alături: CVD ≥ 6 și vedere normală ≥ 15, în ambele teme."""
    bune = set()
    for i in range(8):
        for j in range(i + 1, 8):
            ok = True
            for pal in PALETA.values():
                cvd = min(delta_e(pal[i], pal[j], "protan"), delta_e(pal[i], pal[j], "deutan"))
                if cvd < PRAG_CVD or delta_e(pal[i], pal[j]) < PRAG_NORMAL:
                    ok = False
            if ok:
                bune.add((i, j))
    return bune


def coloreaza_harta(noduri, vecini, bune, distincte):
    """Atribuie sloturi 0..7 astfel încât vecinii să fie o pereche bună.
    distincte=True: căutare exhaustivă care maximizează numărul de culori diferite."""
    ok = lambda a, b: a != b and (min(a, b), max(a, b)) in bune
    ordine = sorted(noduri, key=lambda n: -len(vecini.get(n, ())))
    col = {}

    def posibil(n):
        """Mai are nodul necolorat n măcar un slot compatibil cu vecinii deja colorați?"""
        return any(all(v not in col or ok(s, col[v]) for v in vecini.get(n, ())) for s in range(8))

    if not distincte:
        def pune(k):
            if k == len(ordine):
                return True
            for s in range(8):
                if all(v not in col or ok(s, col[v]) for v in vecini.get(ordine[k], ())):
                    col[ordine[k]] = s
                    # verificare înainte: aceeași ordine de căutare, deci aceeași soluție, dar
                    # ramurile moarte se taie imediat (altfel județele durează minute)
                    if all(v in col or posibil(v) for v in vecini.get(ordine[k], ())) and pune(k + 1):
                        return True
                    del col[ordine[k]]
            return False
        if not pune(0):
            raise RuntimeError("colorarea hărții nu are soluție")
        return col
    cel_mai_bun = [0, None]

    def cauta(k):
        if k == len(ordine):
            n = len(set(col.values()))
            if n > cel_mai_bun[0]:
                cel_mai_bun[0], cel_mai_bun[1] = n, dict(col)
            return
        if len(set(col.values())) + (len(ordine) - k) <= cel_mai_bun[0]:
            return
        for s in range(8):
            if all(v not in col or ok(s, col[v]) for v in vecini.get(ordine[k], ())):
                col[ordine[k]] = s
                cauta(k + 1)
                del col[ordine[k]]
    cauta(0)
    return cel_mai_bun[1]


# ============================================================ topologie și simplificare
def construieste_topologie(uat_geom):
    uat_q = {}
    for cod, pol in uat_geom.items():
        qpol = []
        for p in pol:
            for inel in p:
                q = []
                for lon, lat in inel:
                    pt = (int(round(lon / CUANTA)), int(round(lat / CUANTA)))
                    if not q or q[-1] != pt:
                        q.append(pt)
                if len(q) > 1 and q[0] == q[-1]:
                    q.pop()
                if len(q) >= 3:
                    qpol.append(q)
        uat_q[cod] = qpol

    # joncțiune = punct în care vecinii diferă între inele (acolo se taie arcele)
    vecini, jonctiuni = {}, set()
    for pol in uat_q.values():
        for r in pol:
            n = len(r)
            for i in range(n):
                a, b = r[i - 1], r[(i + 1) % n]
                s = (a, b) if a < b else (b, a)
                v = vecini.get(r[i])
                if v is None:
                    vecini[r[i]] = s
                elif v != s:
                    jonctiuni.add(r[i])

    arce, index = [], {}

    def inregistreaza(seg):
        t = tuple(seg)
        if t in index:
            return index[t]
        rv = tuple(reversed(seg))
        if rv in index:
            return ~index[rv]
        index[t] = len(arce)
        arce.append(list(seg))
        return index[t]

    uat_arce = {}
    for cod, pol in uat_q.items():
        inele = []
        for r in pol:
            n = len(r)
            idx = [i for i in range(n) if r[i] in jonctiuni]
            if not idx:
                k = min(range(n), key=lambda i: r[i])
                rr = r[k:] + r[:k]
                fw = tuple(rr + [rr[0]])
                rv = tuple([rr[0]] + list(reversed(rr[1:])) + [rr[0]])
                if fw in index:
                    inele.append([index[fw]])
                elif rv in index:
                    inele.append([~index[rv]])
                else:
                    index[fw] = len(arce)
                    arce.append(list(fw))
                    inele.append([index[fw]])
                continue
            k = idx[0]
            rr = r[k:] + r[:k] + [r[k]]
            refs, start = [], 0
            for i in range(1, len(rr)):
                if rr[i] in jonctiuni or i == len(rr) - 1:
                    refs.append(inregistreaza(rr[start:i + 1]))
                    start = i
            inele.append(refs)
        uat_arce[cod] = inele
    return arce, uat_arce


def douglas_peucker(pts, tol):
    if len(pts) <= 2:
        return pts
    pastreaza = [False] * len(pts)
    pastreaza[0] = pastreaza[-1] = True
    stiva = [(0, len(pts) - 1)]
    while stiva:
        i, j = stiva.pop()
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy)
        dmax, kmax = -1, -1
        for k in range(i + 1, j):
            x, y = pts[k]
            d = abs(dy * (x - x1) - dx * (y - y1)) / L if L else math.hypot(x - x1, y - y1)
            if d > dmax:
                dmax, kmax = d, k
        if dmax > tol:
            pastreaza[kmax] = True
            stiva.append((i, kmax))
            stiva.append((kmax, j))
    return [p for p, k in zip(pts, pastreaza) if k]


def simplifica(arce):
    tol = TOLERANTA / CUANTA
    rez = []
    for a in arce:
        if a[0] == a[-1]:
            far = max(range(len(a)), key=lambda i: (a[i][0] - a[0][0]) ** 2 + (a[i][1] - a[0][1]) ** 2)
            s = douglas_peucker(a[:far + 1], tol)[:-1] + douglas_peucker(a[far:], tol)
            if len(s) < 4:
                s = a if len(a) <= 8 else [a[0], a[len(a) // 3], a[2 * len(a) // 3], a[0]]
            rez.append(s)
        else:
            rez.append(douglas_peucker(a, tol))
    return rez


# ============================================================ constante administrative
PROVINCII_1930 = {
    "Oltenia": ["Dolj", "Gorj", "Mehedinţi", "Romanaţi", "Vâlcea"],
    "Muntenia": ["Argeş", "Brăila", "Buzău", "Dâmboviţa", "Ialomiţa", "Ilfov", "Muscel", "Olt", "Prahova",
                 "Râmnicu Sărat", "Teleorman", "Vlaşca"],
    "Dobrogea": ["Constanţa", "Tulcea", "Durostor", "Caliacra"],
    "Moldova": ["Bacău", "Baia", "Botoşani", "Covurlui", "Dorohoi", "Fălciu", "Iaşi", "Neamţ", "Putna", "Roman",
                "Tecuci", "Tutova", "Vaslui"],
    "Bucovina": ["Câmpulung", "Rădăuţi", "Suceava", "Cernăuţi", "Storojineţ"],
    "Transilvania": ["Alba", "Braşov", "Ciuc", "Cluj", "Făgăraş", "Hunedoara", "Mureş", "Năsăud", "Odorhei", "Sibiu",
                     "Someş", "Târnava Mare", "Târnava Mică", "Trei Scaune", "Turda"],
    "Banat": ["Caraş", "Severin", "Timiş-Torontal"],
    "Crișana": ["Arad", "Bihor", "Satu Mare", "Sălaj"],
    "Maramureș": ["Maramureş"],
    "Basarabia": ["Tighina", "Cetatea Albă", "Ismail", "Hotin", "Lăpuşna", "Cahul", "Orhei", "Soroca", "Bălţi"],
}
ISTORICE = ["Transilvania", "Banat", "Crișana", "Maramureș", "Bucovina", "Moldova", "Dobrogea", "Muntenia", "Oltenia"]
TIP_UAT = {1: "municipiu", 4: "municipiu", 2: "oraș", 5: "oraș", 3: "comună", 9: "municipiu"}  # 9 = București în SIRUTA 2025
ADR = {1: "Nord-Est", 2: "Sud-Est", 3: "Sud-Muntenia", 4: "Sud-Vest Oltenia", 5: "Vest", 6: "Nord-Vest",
       7: "Centru", 8: "București-Ilfov"}
ADR_RESEDINTA = {1: "Piatra Neamț", 2: "Brăila", 3: "Călărași", 4: "Craiova", 5: "Timișoara", 6: "Cluj-Napoca",
                 7: "Alba Iulia", 8: "București"}
AUTO = {1: "AB", 2: "AR", 3: "AG", 4: "BC", 5: "BH", 6: "BN", 7: "BT", 8: "BV", 9: "BR", 10: "BZ", 11: "CS",
        12: "CJ", 13: "CT", 14: "CV", 15: "DB", 16: "DJ", 17: "GL", 18: "GJ", 19: "HR", 20: "HD", 21: "IL", 22: "IS",
        23: "IF", 24: "MM", 25: "MH", 26: "MS", 27: "NT", 28: "OT", 29: "PH", 30: "SM", 31: "SJ", 32: "SB", 33: "SV",
        34: "TR", 35: "TM", 36: "TL", 37: "VS", 38: "VL", 39: "VN", 40: "B", 51: "CL", 52: "GR"}
# tabelul INS 2.2.2 scrie unele denumiri fără diacritice
ETNII_CORECTATE = {"Croati": "Croați", "Sarbi": "Sârbi", "Rusi-Lipoveni": "Ruși-lipoveni", "Tatari": "Tătari"}
RESEDINTE = (9, 17, 22)


def nivel_scoala(nume):
    n = diacritice(nume or "").upper()
    if n.startswith(("LICEUL", "COLEGIUL", "SEMINARUL", "ȘCOALA PROFESIONAL", "SCOALA PROFESIONAL",
                     "ȘCOALA POSTLICEAL", "SCOALA POSTLICEAL")):
        return 3
    if "GIMNAZIAL" in n:
        return 2
    if "PRIMAR" in n:
        return 1
    if n.startswith(("GRĂDINIȚA", "GRADINITA", "CREȘA", "CRESA")):
        return 0
    return None


# ============================================================ programul principal
def main():
    arg = argparse.ArgumentParser(description="Generează date/romania-uat.json și date/localitati.json.")
    arg.add_argument("--surse", default=os.path.join(tempfile.gettempdir(), "e-ro-adp-surse"))
    arg.add_argument("--iesire", default=os.path.join(RADACINA, "date"))
    a = arg.parse_args()
    os.makedirs(a.surse, exist_ok=True)
    os.makedirs(a.iesire, exist_ok=True)
    sursa = lambda nume: asigura(a.surse, nume)

    # --- SIRUTA
    siruta = {}
    for r in citeste_foaie(sursa("siruta2025.xlsx"))[1:]:
        cod, den, codp, jud, sup, tip, niv, med, reg, fsj = r[:10]
        siruta[int(cod)] = dict(den=diacritice(den), jud=int(jud), sup=int(sup), tip=int(tip), niv=int(niv),
                                reg=int(reg), nuts=celula(r, 11), fsj=int(fsj or 0))
    judete = {v["jud"]: v for v in siruta.values() if v["tip"] == 40}

    # --- RPL 2021, tab. 1.22: populația pe UAT și pe localitate
    pop2021, nume2021 = {}, {}
    for r in citeste_foaie(sursa("rpl-1.22.xlsx")):
        try:
            cod = int(str(celula(r, 1)).strip())
        except ValueError:
            continue
        pop2021[cod] = int(r[3]) if isinstance(celula(r, 3), (int, float)) else None
        nume2021[cod] = str(r[2]).strip()

    # --- LAU 2024: geometria UAT
    con = sqlite3.connect(sursa("lau2024.gpkg"))
    tabel = con.execute("select table_name from gpkg_contents").fetchone()[0]
    uat_geom, uat_lau = {}, {}
    for gid, blob, pop, supr in con.execute(
            'select GISCO_ID, geom, POP_2024, AREA_KM2 from "%s" where CNTR_CODE=\'RO\'' % tabel):
        cod = int(gid.split("_")[1])
        uat_geom[cod] = citeste_gpkg_geom(blob)
        uat_lau[cod] = dict(pop2024=int(pop or 0), supr=float(supr or 0))
    con.close()
    print("UAT din LAU 2024:", len(uat_geom), "— fără SIRUTA:", [c for c in uat_geom if c not in siruta])

    pop2011d = {}
    with open(sursa("lau2011.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["CNTR_CODE"] == "RO":
                pop2011d[int(r["LAU_ID"])] = int(float(r["POP_2011"] or 0))

    # --- județele interbelice 1930 → regiunea istorică
    jud_prov = {j: p for p, lst in PROVINCII_1930.items() for j in lst}
    with zipfile.ZipFile(sursa("judete1930.zip")) as z:
        nume_shp = next(n for n in z.namelist() if n.endswith(".shp") and "__MACOSX" not in n)
        geom1930 = citeste_shp(z.read(nume_shp))
        attr1930 = citeste_dbf(z.read(nume_shp[:-4] + ".dbf"))
    jud1930 = []
    for g, at in zip(geom1930, attr1930):
        xs = [p[0] for r in g for p in r]
        ys = [p[1] for r in g for p in r]
        jud1930.append(dict(nume=at["Nume"], prov=jud_prov[at["Nume"]], inele=g, bbox=(min(xs), min(ys), max(xs), max(ys))))

    def provincie(lon, lat):
        for j in jud1930:
            b = j["bbox"]
            if b[0] <= lon <= b[2] and b[1] <= lat <= b[3] and in_poligon(lon, lat, j["inele"]):
                return j["prov"], j["nume"]
        # granița țării e digitizată diferit în 1930: cel mai apropiat vârf
        d, j = min(((x - lon) ** 2 + (y - lat) ** 2, j) for j in jud1930 for r in j["inele"] for x, y in r[::5])
        return j["prov"], j["nume"] + " (aprox.)"

    # --- coordonatele localităților (Wikidata)
    coord = {}
    with open(sursa("wikidata-siruta.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            m = re.match(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)", r["coord"])
            if m and r["siruta"].strip().isdigit():
                coord.setdefault(int(r["siruta"]), (float(m.group(1)), float(m.group(2))))

    # --- tabelele RPL pe UAT (potrivire pe județ + denumire)
    cheie_jud = {cheie_bruta(titlu(j["den"].replace("JUDEȚUL ", "").replace("MUNICIPIUL ", ""))): c
                 for c, j in judete.items()}
    cheie_uat = defaultdict(list)
    for c in uat_geom:
        s = siruta[c]
        cheie_uat[(s["jud"], cheie(s["den"]))].append(c)
        if c in nume2021 and cheie(nume2021[c]) != cheie(s["den"]):
            cheie_uat[(s["jud"], cheie(nume2021[c]))].append(c)
    pop_jud = defaultdict(int)
    for c in uat_geom:
        pop_jud[siruta[c]["jud"]] += pop2021.get(c) or 0

    def tabel_uat(randuri, citeste):
        """Județul e rândul al cărui total = populația județului; urmează UAT-urile lui."""
        rez, jud, vazute = {}, None, set()
        for r in randuri:
            n = celula(r, 0)
            if not isinstance(n, str) or not n.strip():
                continue
            k = cheie_bruta(n)
            if (k in cheie_jud and nr(celula(r, 1)) == pop_jud.get(cheie_jud[k])) or (k == "MUNICIPIULBUCURESTI" and jud != 40):
                jud = cheie_jud.get(k, 40)
                if jud != 40:
                    continue
            if jud is None:
                continue
            lst = [c for c in cheie_uat.get((jud, cheie(n)), []) if c not in vazute]
            if lst:
                vazute.add(lst[0])
                rez[lst[0]] = citeste(r)
        return rez

    def varste(r):
        tot = nr(celula(r, 1))
        v014 = sum(nr(celula(r, k)) for k in (2, 3, 4))
        v65 = sum(nr(celula(r, k)) for k in range(15, 20))
        return (round(100 * v014 / tot, 1), round(100 * v65 / tot, 1)) if tot else (None, None)

    varsta = tabel_uat(citeste_foaie(sursa("rpl-1.03.xls"), 1), varste)

    randuri_etnie = citeste_foaie(sursa("rpl-2.02.xlsx"), 1)
    antet = next(r for r in randuri_etnie if celula(r, 2) == "Români")
    etnii_nume = [ETNII_CORECTATE.get(e, e) for e in antet[2:25]]

    def etnie(r):
        tot = nr(celula(r, 1))
        vals = [nr(celula(r, k)) for k in range(2, 25)]
        nedecl = vals[-1]
        declarati = tot - nedecl
        best = max(range(1, 21), key=lambda k: vals[k])   # fără români, „altă etnie”, „nedisponibil”
        if vals[best] == 0:
            return dict(min=None, pmin=0, pmind=0, nedecl=round(100 * nedecl / tot, 1) if tot else 0)
        return dict(min=etnii_nume[best], pmin=round(100 * vals[best] / tot, 1) if tot else 0,
                    pmind=round(100 * vals[best] / declarati, 1) if declarati else 0,
                    nedecl=round(100 * nedecl / tot, 1) if tot else 0)

    etnii = tabel_uat(randuri_etnie, etnie)
    print("vârste potrivite:", len(varsta), "— etnii potrivite:", len(etnii))

    izolate = {int(celula(r, 2)) for r in citeste_foaie(sursa("izolate-dispersate.xls"), "UAT-uri izolate")
               if isinstance(celula(r, 2), (int, float))}
    dispersate = {int(r[1]): round(float(r[4]), 1) for r in citeste_foaie(sursa("izolate-dispersate.xls"), "UAT-uri dispersate")
                  if isinstance(celula(r, 1), (int, float)) and isinstance(celula(r, 4), (int, float))}
    print("izolate:", len(izolate), "— dispersate:", len(dispersate))

    sate_uat = defaultdict(list)
    for c, s in siruta.items():
        if s["niv"] == 3 and s["tip"] != 6 and s["sup"] in uat_geom:
            sate_uat[s["sup"]].append(c)

    def demangeon(c):
        """Id = (N − N') · n / N — populația din afara reședinței ori numărul de sate."""
        lst = sate_uat.get(c, [])
        N = pop2021.get(c) or 0
        res = [x for x in lst if siruta[x]["tip"] in RESEDINTE]
        Np = sum(pop2021.get(x) or 0 for x in res)
        return round((N - Np) * (len(lst) - len(res)) / N, 1) if N else None

    # --- topologie
    arce, uat_arce = construieste_topologie(uat_geom)
    arce_s = simplifica(arce)
    xs = [p[0] for a in arce for p in a]
    ys = [p[1] for a in arce for p in a]
    X0, X1, Y0, Y1 = min(xs), max(xs), min(ys), max(ys)
    print("arce:", len(arce), "— puncte:", sum(map(len, arce)), "→", sum(map(len, arce_s)))

    uat_lista = []
    for cod in sorted(uat_arce, key=lambda c: (siruta[c]["fsj"], c)):
        s = siruta[cod]
        lon, lat = punct_interior([r for p in uat_geom[cod] for r in p])
        prov, j30 = provincie(lon, lat)
        uat_lista.append(dict(
            s=cod, n=titlu(fara_prefix(s["den"])), t=TIP_UAT[s["tip"]], r=1 if s["tip"] in (1, 5, 9) else 0,
            j=s["jud"], adr=s["reg"], ist=prov, j30=diacritice(j30),
            p21=pop2021.get(cod), p24=uat_lau[cod]["pop2024"], p11d=pop2011d.get(cod), a=round(uat_lau[cod]["supr"], 2),
            v014=varsta.get(cod, (None, None))[0], v65=varsta.get(cod, (None, None))[1],
            et=etnii.get(cod), iz=1 if cod in izolate else 0, dsp=dispersate.get(cod), dm=demangeon(cod),
            ns=len(sate_uat.get(cod, [])), e=[round(lat, 5), round(lon, 5)], i=uat_arce[cod]))

    # --- culori: regiunile vecine primesc perechi de sloturi validate
    folosire = defaultdict(list)
    for idx, u in enumerate(uat_lista):
        for inel in u["i"]:
            for ref in inel:
                folosire[ref if ref >= 0 else ~ref].append(idx)

    def adiacenta(ch):
        ad = defaultdict(set)
        for us in folosire.values():
            if len(us) == 2:
                x, y = ch(uat_lista[us[0]]), ch(uat_lista[us[1]])
                if x != y:
                    ad[x].add(y)
                    ad[y].add(x)
        return ad

    bune = perechi_bune()
    noduri = lambda ch: list(dict.fromkeys(ch(u) for u in uat_lista))
    culori = {
        "adr": {str(k): v for k, v in coloreaza_harta(noduri(lambda u: u["adr"]), adiacenta(lambda u: u["adr"]), bune, True).items()},
        "ist": coloreaza_harta(noduri(lambda u: u["ist"]), adiacenta(lambda u: u["ist"]), bune, True),
        "jud": {str(k): v for k, v in coloreaza_harta(noduri(lambda u: u["j"]), adiacenta(lambda u: u["j"]), bune, False).items()},
        "perechi": ["%d,%d" % p for p in sorted(bune)],
    }

    def codifica(a):
        rez, px, py = [], 0, 0
        for k, (x, y) in enumerate(a):
            X, Y = x - X0, y - Y0
            rez += [X, Y] if k == 0 else [X - px, Y - py]
            px, py = X, Y
        return rez

    topo = dict(
        versiune=1,
        surse=[
            "Eurostat GISCO — LAU 2024 (1:1 000 000), © EuroGeographics pentru limitele administrative",
            "INS — SIRUTA semestrul 1 2025 (data.gov.ro)",
            "INS — RPL 2021, tabelele 1.22, 1.3.2, 2.2.2; lista UAT-urilor izolate și dispersate",
            "geo-spatial.org — limitele județelor interbelice (1930), CC BY-SA 3.0",
        ],
        proiectie="WGS84 (lon/lat), cuantizare %g grade; arce: [x0, y0, dx, dy, ...], lon = (origine[0] + x) * cuanta" % CUANTA,
        cuanta=CUANTA,
        origine=[X0, Y0],
        limite=[[Y0 * CUANTA, X0 * CUANTA], [Y1 * CUANTA, X1 * CUANTA]],
        arce=[codifica(x) for x in arce_s],
        judete=[dict(c=cod, n=titlu(j["den"].replace("JUDEȚUL ", "").replace("MUNICIPIUL ", "")),
                     auto=AUTO.get(cod, "?"), adr=j["reg"], nuts=j["nuts"])
                for cod, j in sorted(judete.items(), key=lambda kv: kv[1]["fsj"])],
        adr=[dict(c=k, n=v, resedinta=ADR_RESEDINTA[k]) for k, v in ADR.items()],
        istorice=ISTORICE,
        uat=uat_lista,
        culori=culori,
    )
    cale = os.path.join(a.iesire, "romania-uat.json")
    with open(cale, "w", encoding="utf-8") as f:
        json.dump(topo, f, ensure_ascii=False, separators=(",", ":"))
    print("scris", cale, os.path.getsize(cale), "octeți")

    # --- localitățile componente, cu școlile din rețeaua școlară
    scoli = defaultdict(lambda: [0, 0, 0, 0])   # grădinițe, școli primare, gimnaziale, licee
    for r in citeste_foaie(sursa("retea-scolara.xlsx")):
        if celula(r, 14) != "Unitate de învățământ" or not celula(r, 8):
            continue
        nv = nivel_scoala(celula(r, 13))
        if nv is not None:
            scoli[int(r[8])][nv] += 1
    loc = []
    for cod, s in siruta.items():
        if s["niv"] != 3 or s["tip"] == 6 or s["sup"] not in uat_arce:
            continue
        c = coord.get(cod)
        loc.append(dict(s=cod, n=titlu(s["den"]), u=s["sup"], t=s["tip"], p=pop2021.get(cod),
                        e=[round(c[1], 5), round(c[0], 5)] if c else None, sc=scoli[cod] if cod in scoli else None))
    cale = os.path.join(a.iesire, "localitati.json")
    with open(cale, "w", encoding="utf-8") as f:
        json.dump(dict(versiune=1, campuri=dict(s="cod SIRUTA", n="denumire", u="SIRUTA UAT", t="tip SIRUTA",
                                                p="populatie RPL 2021", e="[lat, lng] Wikidata",
                                                sc="unitati de invatamant 2024-2025: [gradinite, sc. primare, sc. gimnaziale, licee]"),
                       localitati=loc), f, ensure_ascii=False, separators=(",", ":"))
    print("scris", cale, os.path.getsize(cale), "octeți —", len(loc), "localități")


if __name__ == "__main__":
    sys.exit(main())
