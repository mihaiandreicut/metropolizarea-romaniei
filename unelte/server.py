# -*- coding: utf-8 -*-
"""
server.py — serverul local al proiectului: pagini statice + salvarea alegerilor.

Face două lucruri:
  1. servește fișierele proiectului, fără cache (ca python -m http.server);
  2. primește PUT pe date/corectii-districte.json și scrie fișierul — „baza de
     date” a alegerilor voluntare făcute pe hartă. Fișierul stă în git, deci
     istoricul și întoarcerea la o variantă mai veche vin de acolo.

Scrierea e îngustă cu intenție: un singur fișier, doar de pe acest calculator,
doar JSON cu forma așteptată. Pe un server care doar citește (publicarea
statică), pagina păstrează alegerile în browser și le oferă la descărcare.

Independent: doar biblioteca standard.
Rulare:  python unelte/server.py [port]        (implicit 8781)
"""

import http.server
import json
import os
import sys

RADACINA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CALE_CORECTII = "/date/corectii-districte.json"
MARIME_MAXIMA = 1024 * 1024   # octeți; cu mult peste ce pot ocupa alegerile a 3.181 de UAT-uri


def valideaza(corp):
    """Întoarce documentul curățat sau ridică ValueError cu motivul."""
    doc = json.loads(corp.decode("utf-8"))
    if not isinstance(doc, dict) or not isinstance(doc.get("corectii"), list):
        raise ValueError("lipsește lista „corectii”")
    corectii = []
    for c in doc["corectii"]:
        if not isinstance(c, dict) or not isinstance(c.get("uat"), int) or not isinstance(c.get("district"), int):
            raise ValueError("fiecare alegere are „uat” și „district”, coduri SIRUTA întregi")
        corectii.append({"uat": c["uat"], "district": c["district"], "nume": str(c.get("nume", ""))[:120]})
    comasari = []
    for c in doc.get("comasari") or []:
        if not isinstance(c, dict) or not isinstance(c.get("uat"), int) or not isinstance(c.get("cu"), int):
            raise ValueError("fiecare comasare are „uat” și „cu”, coduri SIRUTA întregi")
        comasari.append({"uat": c["uat"], "cu": c["cu"], "nume": str(c.get("nume", ""))[:120]})
    return {
        "versiune": 1,
        "descriere": "Alegerile voluntare: UAT-ul (cod SIRUTA) intră în districtul cu reședința în UAT-ul "
                     "`district`. Se aplică peste calculul automat; ce nu e scris aici rămâne cum iese din criterii.",
        "corectii": corectii,
        "comasari": comasari,
    }


class Cerere(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RADACINA, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def raspunde(self, cod, mesaj):
        corp = json.dumps({"mesaj": mesaj}, ensure_ascii=False).encode("utf-8")
        self.send_response(cod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corp)))
        self.end_headers()
        self.wfile.write(corp)

    def do_PUT(self):
        if self.path.split("?")[0] != CALE_CORECTII:
            return self.raspunde(403, "se poate scrie doar fișierul alegerilor")
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return self.raspunde(403, "scrierea se face doar de pe acest calculator")
        try:
            marime = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            marime = 0
        if marime <= 0 or marime > MARIME_MAXIMA:
            return self.raspunde(413, "corp lipsă sau prea mare")
        try:
            doc = valideaza(self.rfile.read(marime))
        except (ValueError, UnicodeDecodeError) as e:
            return self.raspunde(400, f"conținut respins: {e}")
        cale = os.path.join(RADACINA, CALE_CORECTII.lstrip("/"))
        temporar = cale + ".tmp"
        try:
            with open(temporar, "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, indent=1)
            os.replace(temporar, cale)
        except OSError as e:
            return self.raspunde(500, f"fișierul nu a putut fi scris: {e}")
        self.raspunde(200, f"{len(doc['corectii']) + len(doc['comasari'])} alegeri salvate")


def principal():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8781
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Cerere)
    # mesaj fără diacritice: consola Windows (cp1252) nu le poate scrie
    print(f"http://localhost:{port}/ (fara cache; scrie doar {CALE_CORECTII})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(principal())
