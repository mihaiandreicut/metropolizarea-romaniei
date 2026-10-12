# -*- coding: utf-8 -*-
"""
e-ro-adp — regiunile tematice (țări, zone etnografice, regiuni etno-culturale):
generează date/regiuni-tematice.json.

Apartenența e MULȚI-LA-MULȚI: un UAT (sau doar câteva sate ale lui) poate ține
de mai multe regiuni în același timp — nicio regiune nu „deține” un teritoriu.
Definițiile de mai jos sunt nume (cum apar în surse); scriptul le rezolvă în
coduri SIRUTA și calculează, pentru fiecare UAT, ce parte din populația lui
(RPL 2021) intră în regiune.

Script autonom: doar biblioteca standard Python. Citește date/romania-uat.json
și date/localitati.json (generate de unelte/prelucrare.py).

Rulare:
    python unelte/regiuni_tematice.py [--date DIR]

Certitudinea fiecărei regiuni:
    publicata      — lista vine dintr-o sursă citată (articol, GAL, asociație)
    reconstituita  — lista e completată din surse parțiale; de validat local
    regula         — apartenența rezultă dintr-o regulă (ex. județul interbelic)
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

RADACINA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# coduri SIRUTA de județ
AB, AR, AG, BC, BH, BN, BV, CS, CJ, CV, HR, HD, MM, MH, MS, SM, SJ, SB, SV, VL, VN = (
    1, 2, 3, 4, 5, 6, 8, 11, 12, 14, 19, 20, 24, 25, 26, 30, 31, 32, 33, 38, 39)

TIPURI = {
    "tara": "Țară (regiune istorico-etnografică)",
    "zona": "Zonă etnografică",
    "etnoculturala": "Regiune etno-culturală / comunitate",
    "functionala": "Zonă funcțională",
}

WIKI = "https://ro.wikipedia.org/wiki/"

# uat = UAT-uri întregi; sate = localități componente (restul UAT-ului rămâne în afară)
REGIUNI = [
    dict(id="barsei", nume="Țara Bârsei", tip="tara", judete=[BV], certitudine="reconstituita",
         descriere="Lista din sursă, completată cu Săcele și Tărlungeni (satele săcelene), care lipsesc din ea.",
         surse=[("Wikipedia — Țara Bârsei", WIKI + "Țara_Bârsei")],
         uat=["Bod", "Bran", "Brașov", "Codlea", "Cristian", "Feldioara", "Ghimbav", "Hălchiu", "Hărman", "Prejmer",
              "Râșnov", "Sânpetru", "Vulcan", "Zărnești", "Săcele", "Tărlungeni"],
         sate=["Dumbrăvița", "Măieruș", "Rotbav"]),
    dict(id="fagarasului", nume="Țara Făgărașului (Țara Oltului)", tip="tara", judete=[BV, SB], certitudine="publicata",
         surse=[("Wikipedia — Țara Făgărașului", WIKI + "Țara_Făgărașului")],
         uat=["Făgăraș", "Victoria", "Avrig"],
         sate=["Beclean", "Berivoi", "Bogata Olteană", "Boholț", "Breaza", "Bucium", "Calbor", "Cincșor", "Comăna de Jos",
               "Comăna de Sus", "Copăcel", "Corbi", "Cuciulata", "Dejani", "Dopca", "Drăguș", "Dridif", "Fântâna",
               "Grid", "Gura Văii", "Hălmeag", "Hârseni", "Hoghiz", "Hurez", "Iași", "Ileni", "Lisa", "Ludișor",
               "Lupșa", "Luța", "Măliniș", "Mărgineni", "Mândra", "Ohaba", "Olteț", "Paltin", "Părău", "Perșani",
               "Pojorta", "Racovița", "Râușor", "Recea", "Rucăr", "Săsciori", "Săvăstreni", "Sâmbăta de Jos",
               "Sâmbăta de Sus", "Scoreiu", "Sebeș", "Șercaia", "Șercăița", "Șinca Veche", "Șinca Nouă", "Șona", "Toderița",
               "Ucea de Jos", "Ucea de Sus", "Vad", "Vâlcea", "Veneția de Jos", "Veneția de Sus", "Viștea de Jos",
               "Viștea de Sus", "Viștișoara", "Voila", "Voivodeni", "Feldioara",
               "Arpașu de Jos", "Arpașu de Sus", "Cârța", "Cârțișoara", "Colun", "Noul Român", "Porumbacu de Jos",
               "Porumbacu de Sus", "Poienița", "Sărata", "Sebeșu de Jos", "Sebeșu de Sus", "Turnu Roșu"]),
    dict(id="hategului", nume="Țara Hațegului", tip="tara", judete=[HD], certitudine="publicata",
         surse=[("Wikipedia — Țara Hațegului", WIKI + "Țara_Hațegului")],
         uat=["Hațeg", "Pui", "Râu de Mori", "Sântămăria-Orlea", "Baru", "Sălașu de Sus", "Totești", "Densuș",
              "Răchitova", "Sarmizegetusa", "General Berthelot"],
         sate=["Călan", "Streisângeorgiu"]),
    dict(id="padurenilor", nume="Ținutul Pădurenilor", tip="zona", judete=[HD], certitudine="publicata",
         surse=[("Wikipedia — Ținutul Pădurenilor", WIKI + "Ținutul_Pădurenilor")],
         uat=["Bătrâna", "Bunila", "Cerbăl", "Ghelari", "Lelese", "Lunca Cernii de Jos", "Toplița"],
         sate=["Alun", "Cerișor", "Poienița Voinii", "Plop", "Ruda", "Vălari", "Cernișoara Florese", "Ciulpăz",
               "Dumbrava", "Cutin"]),
    dict(id="zarandului", nume="Țara Zarandului", tip="tara", judete=[HD, AR], certitudine="reconstituita",
         surse=[("GAL „Țara Zarandului” (MADR, LEADER 2023–2027) — partea din Hunedoara",
                 "https://www.madr.ro/docs/dezvoltare-rurala/Axa_LEADER/2014-2020/2024/Lista-cu-Grupurile-de-Ac%C8%9Biune-Local%C4%83-2023-2027-selectate-de-MADR-si-datele-de-contact-ale-acestora.pdf"),
                ("Wikipedia — Țara Zarandului (partea din Crișana)", WIKI + "Țara_Zarandului")],
         uat=["Brad", "Baia de Criș", "Băița", "Blăjeni", "Buceș", "Bucureșci", "Bulzeștii de Sus", "Crișcior",
              "Luncoiu de Jos", "Ribița", "Tomești", "Vața de Jos", "Vălișoara",
              "Hălmagiu", "Hălmăgel", "Vârfurile", "Pleșcuța", "Brazii", "Gurahonț"]),
    dict(id="motilor", nume="Țara Moților", tip="tara", judete=[AB, HD], certitudine="reconstituita",
         surse=[("Wikipedia — Țara Moților", WIKI + "Țara_Moților"),
                ("GAL „Arieșul Mare” și GAL „Drumul Iancului” (MADR, LEADER 2023–2027)",
                 "https://www.madr.ro/docs/dezvoltare-rurala/Axa_LEADER/2014-2020/2024/Lista-cu-Grupurile-de-Ac%C8%9Biune-Local%C4%83-2023-2027-selectate-de-MADR-si-datele-de-contact-ale-acestora.pdf")],
         uat=["Abrud", "Albac", "Arieșeni", "Avram Iancu", "Baia de Arieș", "Bistra", "Bucium", "Câmpeni", "Ciuruleasa",
              "Gârda de Sus", "Horea", "Lupșa", "Mogoș", "Poiana Vadului", "Roșia Montană", "Sălciua", "Scărișoara",
              "Sohodol", "Vadu Moților", "Vidra", "Brad", "Baia de Criș", "Bulzeștii de Sus"]),
    dict(id="oasului", nume="Țara Oașului", tip="tara", judete=[SM], certitudine="publicata",
         surse=[("Wikipedia — Țara Oașului", WIKI + "Țara_Oașului")],
         uat=["Negrești-Oaș", "Bătarci", "Bixad", "Călinești-Oaș", "Cămărzana", "Certeze", "Gherța Mică", "Orașu Nou",
              "Racșa", "Tarna Mare", "Târșolț", "Turț", "Vama"]),
    dict(id="codrului", nume="Țara Codrului", tip="tara", judete=[MM, SM, SJ], certitudine="publicata",
         surse=[("Wikipedia — Țara Codrului", WIKI + "Țara_Codrului")],
         uat=["Ardusat", "Fărcașa", "Gărdani", "Sălsig", "Asuaju de Sus", "Băița de sub Codru", "Băsești", "Bicaz",
              "Oarța de Jos", "Ariniș", "Supur", "Crucișor", "Săcășeni", "Socond", "Valea Vinului", "Viile Satu Mare",
              "Homoroade", "Hodod", "Bogdand", "Beltiug", "Pomi", "Cehal", "Săuca", "Bârsău", "Benesat"],
         sate=["Arduzel", "Chelința", "Mânău", "Someș-Uileac", "Tohat", "Țicău", "Vicea",
               "Horoatu Cehului", "Motiș", "Nadiș", "Ulciug"]),
    dict(id="chioarului", nume="Țara Chioarului", tip="tara", judete=[MM], certitudine="reconstituita",
         surse=[("Wikipedia — Țara Chioarului", WIKI + "Țara_Chioarului"),
                ("Portal Maramureș — Țara Chioarului", "https://portal-maramures.ro/tara-chioarului/")],
         uat=["Șomcuta Mare", "Remetea Chioarului", "Satulung", "Valea Chioarului", "Mireșu Mare", "Copalnic-Mănăștur",
              "Cernești", "Coaș", "Săcălășeni", "Coltău", "Dumbrăvița"]),
    dict(id="lapusului", nume="Țara Lăpușului", tip="tara", judete=[MM], certitudine="publicata",
         surse=[("Wikipedia — Țara Lăpușului", WIKI + "Țara_Lăpușului")],
         uat=["Târgu Lăpuș", "Băiuț", "Coroieni", "Cupșeni", "Groșii Țibleșului", "Lăpuș", "Suciu de Sus"]),
    dict(id="maramuresului", nume="Țara Maramureșului", tip="tara", judete=[MM], certitudine="regula",
         surse=[("Maramureșul istoric = județul interbelic Maramureș (1930), geo-spatial.org",
                 "http://geo-spatial.org/vechi/download/romania-limitele-administrative-ale-jude-elor-interbelice-1930")],
         regula=dict(j30=["Maramureș"])),
    dict(id="nasaudului", nume="Țara Năsăudului", tip="tara", judete=[BN], certitudine="reconstituita",
         surse=[("GAL „Țara Năsăudului” și GAL al Someșului Mare superior (MADR, LEADER 2023–2027)",
                 "https://www.madr.ro/docs/dezvoltare-rurala/Axa_LEADER/2014-2020/2024/Lista-cu-Grupurile-de-Ac%C8%9Biune-Local%C4%83-2023-2027-selectate-de-MADR-si-datele-de-contact-ale-acestora.pdf")],
         uat=["Năsăud", "Coșbuc", "Dumitra", "Feldru", "Nimigea", "Parva", "Rebra", "Rebrișoara", "Romuli", "Salva",
              "Șieu-Măgheruș", "Șintereag", "Telciu", "Rodna", "Maieru", "Șanț", "Sângeorz-Băi"]),
    dict(id="dornelor", nume="Țara Dornelor", tip="tara", judete=[SV], certitudine="publicata",
         surse=[("Wikipedia — Țara Dornelor", WIKI + "Țara_Dornelor")],
         uat=["Vatra Dornei", "Coșna", "Poiana Stampei", "Dorna Candrenilor", "Șaru Dornei", "Panaci", "Dorna-Arini",
              "Ciocănești", "Cârlibaba", "Iacobeni"]),
    dict(id="vrancei", nume="Țara Vrancei", tip="tara", judete=[VN], certitudine="publicata",
         surse=[("Asociația Țara Vrancei — teritoriu", "https://tara-vrancei.ro/despre-noi/teritoriu/")],
         uat=["Bârsești", "Năruja", "Nereju", "Nistorești", "Paltin", "Soveja", "Tulnici", "Valea Sării",
              "Vizantea-Livezi", "Vrâncioaia", "Negrilești", "Păulești", "Spulber", "Câmpuri", "Răcoasa", "Vidra"]),
    dict(id="lovistei", nume="Țara Loviștei", tip="tara", judete=[VL], certitudine="publicata",
         descriere="Nucleul (Loviștea „populară”, la est de defileul Oltului): Câineni, Titești, Boișoara, Racovița, "
                   "Perișani. Loviștea extinsă cuprinde și Brezoi, Mălaia și Voineasa. A aparținut Țării Românești "
                   "(județul Argeș), azi e în Vâlcea.",
         surse=[("Wikipedia — Țara Loviștei", WIKI + "Țara_Loviștei"),
                ("Via Valahia — The Land of Loviștea", "https://viavalahia.ro/en/the-land-of-lovistea/")],
         uat=["Câineni", "Titești", "Boișoara", "Racovița", "Perișani", "Brezoi", "Mălaia", "Voineasa"]),
    dict(id="almajului", nume="Țara Almăjului", tip="tara", judete=[CS], certitudine="publicata",
         surse=[("Wikipedia — Țara Almăjului", WIKI + "Țara_Almăjului")],
         uat=["Bănia", "Bozovici", "Dalboșeț", "Eftimie Murgu", "Lăpușnicu Mare", "Prigor", "Șopotu Nou"],
         sate=["Borlovenii Noi", "Borlovenii Vechi", "Gârbovăț", "Moceriș", "Pătaș", "Prilipeț", "Putna", "Șopotu Vechi"]),
    dict(id="clisurii", nume="Clisura Dunării", tip="zona", judete=[CS, MH], certitudine="publicata",
         surse=[("Wikipedia — Clisura Dunării", WIKI + "Clisura_Dunării")],
         uat=["Orșova", "Moldova Nouă", "Socol", "Pojejena", "Coronini", "Gârnic", "Sichevița", "Berzasca",
              "Svinița", "Dubova", "Eșelnița", "Ilovița", "Breznița-Ocol"]),
    dict(id="marginimii", nume="Mărginimea Sibiului", tip="zona", judete=[SB], certitudine="publicata",
         surse=[("Wikipedia — Mărginimea Sibiului", WIKI + "Mărginimea_Sibiului")],
         uat=["Săliște", "Tălmaciu", "Gura Râului", "Jina", "Orlat", "Poiana Sibiului", "Poplaca", "Rășinari",
              "Râu Sadului", "Sadu", "Tilișca"],
         sate=["Boița", "Fântânele", "Galeș", "Rod", "Sibiel", "Tălmăcel", "Vale"]),
    dict(id="amlasului", nume="Țara Amlașului", tip="tara", judete=[SB], certitudine="publicata",
         descriere="Cacova Sibiului din sursă se numește azi Fântânele (orașul Săliște).",
         surse=[("Wikipedia — Țara Amlașului", WIKI + "Țara_Amlașului")],
         sate=["Aciliu", "Amnaș", "Fântânele", "Galeș", "Orlat", "Săcel", "Săliște", "Sibiel", "Tilișca"]),
    dict(id="secaselor", nume="Țara Secașelor", tip="tara", judete=[AB, SB], certitudine="publicata",
         surse=[("GAL „Țara Secașelor Alba–Sibiu” (MADR, LEADER 2023–2027)",
                 "https://madr.ro/docs/dezvoltare-rurala/Axa_LEADER/2023-2027/2025/Lista-Grupuri-de-Actiune-Locala-2023-2027-selectate-de-MADR-si-datele-de-contact-ale-acestora-actualizata-la-data-de-22.08.2025.pdf")],
         uat=["Berghin", "Bucerdea Grânoasă", "Câlnic", "Cenade", "Cergău", "Ciugud", "Crăciunelu de Jos", "Cut",
              "Daia Română", "Doștat", "Gârbova", "Mihalț", "Ohaba", "Roșia de Secaș", "Sântimbru", "Spring",
              "Valea Lungă", "Apoldu de Jos", "Loamneș", "Ludoș", "Păuca", "Slimnic", "Șura Mare", "Șura Mică",
              "Ocna Sibiului"]),
    dict(id="calatei", nume="Țara Călatei", tip="tara", judete=[CJ, SJ], certitudine="publicata",
         surse=[("Wikipedia — Țara Călatei", WIKI + "Țara_Călatei")],
         uat=["Aghireșu", "Călățele", "Feleacu", "Fildu de Jos", "Gilău", "Huedin", "Mărgău", "Poieni", "Sâncraiu",
              "Săcuieu", "Săvădisla"],
         sate=["Bologa", "Morlaca", "Călata", "Finciu", "Șardu", "Mănășturu Românesc", "Ticu-Colonie", "Dâncu",
               "Ticu", "Bica", "Brăișoru", "Buteni", "Stolna", "Tăuți", "Vălișoara", "Lita", "Hășdate", "Finișel",
               "Agârbiciu", "Nadășu"]),
    dict(id="beiusului", nume="Țara Beiușului", tip="tara", judete=[BH], certitudine="reconstituita",
         descriere="Depresiunea Beiușului, pe Crișul Negru superior.",
         surse=[("Bihor în imagini — Țara Beiușului", "https://www.bihorinimagini.ro/en/photo-gallery/beiusului-county/")],
         uat=["Beiuș", "Ștei", "Nucet", "Vașcău", "Drăgănești", "Finiș", "Budureasa", "Pietroasa", "Rieni",
              "Lazuri de Beiuș", "Curățele", "Remetea", "Uileacu de Beiuș", "Buntești", "Șoimi", "Tărcaia", "Căbești",
              "Cărpinet", "Criștioru de Jos", "Câmpani", "Pocola", "Roșia"]),
    dict(id="secuiesc", nume="Ținutul Secuiesc", tip="etnoculturala", judete=[HR, CV, MS], certitudine="regula",
         descriere="Scaunele secuiești Ciuc, Odorhei și Trei Scaune (= județele interbelice omonime) și UAT-urile "
                   "cu majoritate maghiară din fostul județ interbelic Mureș — aproximare a scaunului Mureș.",
         surse=[("Județele interbelice (1930), geo-spatial.org",
                 "http://geo-spatial.org/vechi/download/romania-limitele-administrative-ale-jude-elor-interbelice-1930"),
                ("INS — RPL 2021, tabelul 2.2.2 (etnie pe UAT)",
                 "https://www.recensamantromania.ro/rezultate-rpl-2021/rezultate-definitive-caracteristici-etno-culturale-demografice/")],
         regula=dict(j30=["Ciuc", "Odorhei", "Trei Scaune"], j30_minoritate=("Mureș", "Maghiari", 50))),
    dict(id="carasovenilor", nume="Carașovenii (croații din Caraș)", tip="etnoculturala", judete=[CS],
         certitudine="publicata",
         surse=[("Wikipedia — Carașoveni", WIKI + "Carașoveni")],
         uat=["Carașova", "Lupac"]),
    dict(id="vaii_jiului", nume="Valea Jiului", tip="functionala", judete=[HD], certitudine="publicata",
         descriere="Bazinul carbonifer: cele șase orașe din Valea Jiului.",
         surse=[("Wikipedia — Valea Jiului", WIKI + "Valea_Jiului")],
         uat=["Petroșani", "Petrila", "Aninoasa", "Vulcan", "Lupeni", "Uricani"]),
]


# --- culegere din Wikipedia -------------------------------------------------
# Lista scrisă mai sus e cea verificată; restul țării se completează din articolele
# Wikipedia despre „țări” și zone etnografice. Apartenența se deduce din textul
# articolului: se iau UAT-urile județelor pomenite în articol ale căror nume apar
# în text. E o reconstituire, nu o listă publicată — de aceea certitudinea e marcată.
CAUTARI = [
    'intitle:"Țara" zonă etnografică',
    'intitle:"Ținutul" zonă etnografică',
    '"zonă etnografică" comune',
    '"regiune etnografică" România',
]
SEMINTE = [
    "Țara Oașului", "Țara Maramureșului", "Țara Lăpușului", "Țara Chioarului", "Țara Codrului",
    "Țara Silvaniei", "Țara Năsăudului", "Țara Călatei", "Țara Moților", "Țara Zarandului",
    "Țara Hălmagiului", "Țara Beiușului", "Țara Crișurilor", "Țara Hațegului", "Țara Almăjului",
    "Țara Severinului", "Țara Loviștei", "Țara Vrancei", "Țara Buzaielor", "Țara Bârsei",
    "Țara Făgărașului", "Țara Amlașului", "Țara Secașelor", "Țara Hangului", "Țara Dornelor",
    "Țara Gugulanilor", "Țara Mocanilor", "Țara Pădurenilor", "Ținutul Pădurenilor",
    "Mărginimea Sibiului", "Valea Jiului", "Clisura Dunării", "Țara Secuilor", "Ținutul Secuiesc",
    "Câmpia Transilvaniei", "Podișul Mehedinți", "Bărăganul", "Codrii Vlăsiei", "Dobrogea de Nord",
    "Delta Dunării", "Valea Hârtibaciului", "Valea Someșului", "Valea Trotușului", "Țara Bistriței",
    "Țara Gurghiului", "Valea Mureșului", "Luncavăț", "Horezu", "Valea Bistriței",
]
MIN_MEMBRI = 4
MAX_MEMBRI = 140


def wiki_api(**kw):
    """Un apel la API-ul Wikipedia, cu reîncercări: serverul limitează cererile rapide (429)."""
    import json as _json
    import ssl
    import time as _time
    import urllib.error
    import urllib.parse
    import urllib.request
    kw.setdefault("format", "json")
    kw.setdefault("action", "query")
    url = "https://ro.wikipedia.org/w/api.php?" + urllib.parse.urlencode(kw)
    cerere = urllib.request.Request(url, headers={"User-Agent": "ro-adp/1.0 (harta administrativa a Romaniei)"})
    ultima = None
    for incercare in range(5):
        try:
            with urllib.request.urlopen(cerere, timeout=60, context=ssl.create_default_context()) as r:
                _time.sleep(1.2)
                return _json.loads(r.read())
        except urllib.error.HTTPError as e:
            ultima = e
            if e.code != 429:
                raise
            _time.sleep(10 * (incercare + 1))
    raise ultima


def wiki_articole():
    """Titlurile articolelor candidate: căutările plus lista de semințe."""
    titluri = list(SEMINTE)
    for q in CAUTARI:
        try:
            d = wiki_api(list="search", srsearch=q, srlimit=50)
            titluri += [x["title"] for x in d.get("query", {}).get("search", [])]
        except Exception as e:
            print("  ! căutarea „%s” a eșuat: %s" % (q, e))
    # din căutări vin și articole care nu sunt regiuni („Cetatea…”, „Icoanele…”, „Revolta…”);
    # se păstrează doar titlurile care arată ca un nume de regiune
    inceputuri = ("Țara ", "Ținutul ", "Zona ", "Valea ", "Clisura ", "Depresiunea ", "Câmpia ",
                  "Podișul ", "Codrii ", "Delta ", "Mărginimea ", "Lunca ", "Dobrogea", "Bărăgan",
                  "Bucovina", "Maramureș", "Banat", "Oltenia", "Muntenia", "Moldova", "Crișana")
    semint = {cheie(x) for x in SEMINTE}
    vazute, curate = set(), []
    for t in titluri:
        k = cheie(t)
        if k in vazute or any(x in t for x in ("Listă", "Categorie", "dezambiguizare")):
            continue
        if k not in semint and not t.startswith(inceputuri):
            continue
        vazute.add(k)
        curate.append(t)
    return curate


def wiki_text(titluri, cache):
    """Textul fiecărui articol, luat în loturi de 20 și păstrat local."""
    import json as _json
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            texte = _json.load(f)
    else:
        texte = {}
    lipsa = [t for t in titluri if t not in texte]
    # API-ul dă textul întreg al unui singur articol pe cerere, deci se cere unul câte unul
    for i, titlu in enumerate(lipsa):
        lot = [titlu]
        try:
            d = wiki_api(prop="extracts", explaintext=1, redirects=1, titles=titlu)
        except Exception as e:
            print("  ! „%s” a eșuat: %s" % (titlu, e))
            continue

        for pag in d.get("query", {}).get("pages", {}).values():
            if "extract" in pag:
                texte[pag["title"]] = pag["extract"]
        for t in lot:
            texte.setdefault(t, "")
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w", encoding="utf-8") as f:
        _json.dump(texte, f, ensure_ascii=False)
    return texte


def regiuni_din_wikipedia(uat, judete_nume, cache):
    """
    Regiuni reconstituite din articolele Wikipedia: UAT-urile județelor pomenite în
    articol ale căror nume apar în text. Nu intră reședințele de județ decât dacă
    articolul le numește explicit de mai multe ori — altfel ar aduna tot județul.
    """
    titluri = wiki_articole()
    print("  Wikipedia: %d articole candidate" % len(titluri))
    texte = wiki_text(titluri, cache)
    dupa_judet = defaultdict(list)
    for u in uat:
        dupa_judet[u["j"]].append(u)
    iesire = []
    for titlu in titluri:
        text = texte.get(titlu) or ""
        if len(text) < 400:
            continue
        k_text = cheie(text)
        judete = [c for c, nume in judete_nume.items() if cheie(nume) in k_text]
        if not judete or len(judete) > 8:
            continue
        membri = []
        for c in judete:
            for u in dupa_judet[c]:
                nume = u["n"]
                if len(nume) < 4:
                    continue
                if not text.count(nume):
                    continue
                if u.get("r"):
                    continue          # reședința de județ e pomenită ca reper, nu ca membru
                membri.append(u)
        # un singur UAT potrivit într-un județ e aproape sigur o omonimie („Ostrov” în Olt,
        # pentru un articol despre Deltă): județul acela iese din regiune
        pe_judet = defaultdict(list)
        for u in membri:
            pe_judet[u["j"]].append(u)
        membri = [u for c, lista in pe_judet.items() if len(lista) >= 2 for u in lista]
        if not (MIN_MEMBRI <= len(membri) <= MAX_MEMBRI):
            continue
        iesire.append(dict(
            id="wiki-" + cheie(titlu)[:28],
            nume=titlu,
            tip="zona",
            judete=sorted(judete),
            certitudine="reconstituita",
            descriere="Listă reconstituită automat din articolul Wikipedia: UAT-urile pomenite în text. "
                      "De verificat local.",
            surse=[("Wikipedia — " + titlu, WIKI + titlu.replace(" ", "_"))],
            uat=[u["n"] for u in membri],
        ))
    print("  Wikipedia: %d regiuni reconstituite" % len(iesire))
    return iesire


def cheie(s):
    s = s.replace("ş", "ș").replace("ţ", "ț").strip().lower()
    s = "".join(ch for ch in unicodedata.normalize("NFD", s) if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s)


def main():
    arg = argparse.ArgumentParser(description="Generează date/regiuni-tematice.json.")
    arg.add_argument("--date", default=os.path.join(RADACINA, "date"))
    arg.add_argument("--fara-wikipedia", action="store_true",
                     help="doar regiunile verificate, fără reconstituirile din Wikipedia")
    arg.add_argument("--cache", default=os.path.join(RADACINA, "unelte", ".cache-wikipedia.json"))
    a = arg.parse_args()
    uat = json.load(open(os.path.join(a.date, "romania-uat.json"), encoding="utf-8"))["uat"]
    loc = json.load(open(os.path.join(a.date, "localitati.json"), encoding="utf-8"))["localitati"]
    uat_dupa_siruta = {u["s"]: u for u in uat}
    sate_uat = defaultdict(list)
    for x in loc:
        sate_uat[x["u"]].append(x)
    judet = {u["s"]: u["j"] for u in uat}

    toate = list(REGIUNI)
    if not a.fara_wikipedia:
        judete_nume = {}
        for u in uat:
            judete_nume.setdefault(u["j"], u["j30"])
        try:
            import json as _json
            cu_nume = _json.load(open(os.path.join(a.date, "romania-uat.json"), encoding="utf-8"))["judete"]
            judete_nume = {j["c"]: j["n"] for j in cu_nume}
        except Exception:
            pass
        # numele curate (fără paranteze) și listele deja verificate, ca să nu se dubleze
        fara_paranteze = lambda n: cheie(re.sub(r"\(.*?\)", "", n))
        cunoscute = {fara_paranteze(r["nume"]) for r in REGIUNI}
        liste = [{cheie(x) for x in r.get("uat", [])} for r in REGIUNI]
        for r in regiuni_din_wikipedia(uat, judete_nume, a.cache):
            if fara_paranteze(r["nume"]) in cunoscute:
                continue
            noua = {cheie(x) for x in r["uat"]}
            if any(len(noua & veche) >= 0.5 * len(noua) for veche in liste if veche):
                continue              # aceeași regiune, cu alt nume
            toate.append(r)

    probleme = 0
    rezultat = []
    for r in toate:
        membri = {}                                      # SIRUTA UAT → populația care intră în regiune
        sate_ale = defaultdict(set)
        for nume in r.get("uat", []):
            k = cheie(nume)
            gasite = [u for u in uat if u["j"] in r["judete"] and cheie(u["n"]) == k]
            if len(gasite) != 1:
                print("  ! %s: UAT „%s” — %d potriviri" % (r["id"], nume, len(gasite)))
                probleme += 1
                continue
            membri[gasite[0]["s"]] = gasite[0]["p21"] or 0
        ambigue = []
        repere = [uat_dupa_siruta[s]["e"] for s in membri]
        for nume in r.get("sate", []):
            k = cheie(nume)
            gasite = [x for x in loc if judet.get(x["u"]) in r["judete"] and cheie(x["n"]) == k]
            if not gasite:
                print("  ! %s: sat „%s” — nicio potrivire" % (r["id"], nume))
                probleme += 1
            elif len(gasite) == 1:
                sate_ale[gasite[0]["u"]].add(gasite[0]["s"])
                if gasite[0]["e"]:
                    repere.append(gasite[0]["e"])
            else:
                ambigue.append((nume, gasite))
        # omonime (ex. Paltin în Șinca Nouă și în Boița): satul cel mai apropiat de restul regiunii
        if repere:
            c = (sum(p[0] for p in repere) / len(repere), sum(p[1] for p in repere) / len(repere))
            for nume, gasite in ambigue:
                ales = min((x for x in gasite if x["e"]),
                           key=lambda x: (x["e"][0] - c[0]) ** 2 + ((x["e"][1] - c[1]) * 0.7) ** 2)
                sate_ale[ales["u"]].add(ales["s"])
                print("  · %s: „%s” omonim, ales în %s" % (r["id"], nume, uat_dupa_siruta[ales["u"]]["n"]))
        elif ambigue:
            probleme += len(ambigue)
        for u, sate in sate_ale.items():
            if u in membri:
                continue                                 # UAT-ul e deja întreg în regiune
            pop = sum(x["p"] or 0 for x in sate_uat[u] if x["s"] in sate)
            membri[u] = pop
        regula = r.get("regula")
        if regula:
            for u in uat:
                j30 = u["j30"].replace(" (aprox.)", "")
                if j30 in regula.get("j30", []):
                    membri[u["s"]] = u["p21"] or 0
                m = regula.get("j30_minoritate")
                if m and j30 == m[0] and u.get("et") and u["et"].get("min") == m[1] and u["et"]["pmin"] >= m[2]:
                    membri[u["s"]] = u["p21"] or 0
        lista = []
        for s, pop in sorted(membri.items()):
            total = uat_dupa_siruta[s]["p21"] or 0
            pondere = round(min(1.0, pop / total), 3) if total else 1.0
            intrare = dict(s=s, f=pondere)
            if pondere < 1 and s in sate_ale:
                intrare["sate"] = sorted(sate_ale[s])
            lista.append(intrare)
        populatie = sum(round((uat_dupa_siruta[x["s"]]["p21"] or 0) * x["f"]) for x in lista)
        rezultat.append(dict(
            id=r["id"], nume=r["nume"], tip=r["tip"], certitudine=r["certitudine"],
            descriere=r.get("descriere", ""), surse=[dict(titlu=t, url=u) for t, u in r["surse"]],
            uat=lista, populatie=populatie))
        print("%-22s %3d UAT (%2d parțial)  %8d loc." % (
            r["id"], len(lista), sum(1 for x in lista if x["f"] < 1), populatie))

    cale = os.path.join(a.date, "regiuni-tematice.json")
    with open(cale, "w", encoding="utf-8") as f:
        json.dump(dict(versiune=1, tipuri=TIPURI,
                       nota="Un UAT poate ține de mai multe regiuni. UAT-urile incluse doar cu unele sate apar ca parțiale.",
                       campuri=dict(s="cod SIRUTA al UAT-ului", f="partea din populația UAT-ului (RPL 2021) care ține "
                                    "de regiune; 1 = UAT întreg", sate="codurile SIRUTA ale satelor, la UAT-urile parțiale"),
                       regiuni=rezultat), f, ensure_ascii=False, indent=1)
    print("scris", cale, "—", len(rezultat), "regiuni;", probleme, "nume nerezolvate")
    return 1 if probleme else 0


if __name__ == "__main__":
    sys.exit(main())
