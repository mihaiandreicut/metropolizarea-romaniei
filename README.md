# Metropolizarea României

Hartă interactivă și raport pentru o propunere de reformă administrativ-teritorială: 8 regiuni de dezvoltare, județe ca limite și circumscripții, zone metropolitane și districte (circumscripțiile judecătoriilor), comune comasate.

Pagini:

- `index.html` — harta (regiuni, județe, districte, comune comasate, indicatori pe UAT)
- `raport.html` — raportul cu cifre pe județe, costuri și economii
- `sinteza.html` — sinteza și regulile de comasare
- `principii.html` — principiile (administrativ vs. funcțional)
- `metodologie.html` — metoda și sursele

Site static, fără build: se deschide prin orice server HTTP (`python -m http.server`) sau direct prin GitHub Pages. Salvarea alegerilor de pe hartă (`date/corectii-districte.json`) cere `python unelte/server.py 8781`.

Scripturile de prelucrare a datelor sunt în `unelte/`. Datele vin din surse publice: INS TEMPO, data.gov.ro, geo-spatial.org, OpenStreetMap, Wikipedia (CC BY-SA 3.0) și execuția bugetară a UAT-urilor.
