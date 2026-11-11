# Metropolizarea României

Hartă interactivă și raport pentru o propunere de reformă administrativ-teritorială: 8 regiuni de dezvoltare, județe ca limite și circumscripții, zone metropolitane și districte (circumscripțiile judecătoriilor), comune comasate.

Pagini:

- `localitatea.html` — „Localitatea mea”: cauți un sat, o comună sau un oraș (sau lași pagina să te găsească) și vezi pe loc cu cine se unește, drumul până la primărie, costul primăriei, banii eliberați și ce se poate face cu ei; cu imagine de distribuit
- `index.html` — harta: simularea pas cu pas pe toată țara, pe o regiune sau pe un județ (teritoriul, regulile, raportul înainte și după, cu țara desfăcută pe regiuni și regiunea pe județe; legături directe `index.html#tara`, `#regiune=N`, `#judet=COD`), plus explorarea liberă (regiuni, districte, comune comasate, indicatori pe UAT)
- `raport.html` — raportul cu cifre pe județe, costuri și economii
- `sinteza.html` — sinteza și regulile de comasare
- `principii.html` — principiile (administrativ vs. funcțional)
- `metodologie.html` — metoda și sursele

Site static, fără build: se deschide prin orice server HTTP (`python -m http.server`) sau direct prin GitHub Pages. Salvarea alegerilor de pe hartă (`date/corectii-districte.json`) cere `python unelte/server.py 8781`.

Scripturile de prelucrare a datelor sunt în `unelte/`. Populația de referință (rezidenții estimați pe UAT la 1 ianuarie, ultimul an publicat de INS: recensământul 2021, cu evoluția după domiciliu — plafonată la ±15% în afara zonelor periurbane, ca înscrierile în masă la domiciliu să nu treacă drept locuitori — adus la populația rezidentă pe județe) se actualizează cu `python unelte/populatie.py`; cifrele citate în sinteză se refac cu `node unelte/cifre.js`, fișele din „Localitatea mea” (`date/fise-localitati.json`) cu `node unelte/fise-localitati.js`, iar sensibilitatea la ponderile scorului de centralitate cu `node unelte/ponderi-centralitate.js` — de rulat după orice schimbare de reguli sau de date. Datele vin din surse publice: INS TEMPO, data.gov.ro, geo-spatial.org, OpenStreetMap, Wikipedia (CC BY-SA 3.0) și execuția bugetară a UAT-urilor.
