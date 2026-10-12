/* ============================================================================
   e-ro-adp — harta Leaflet (UAT-uri, limite, etichete, evidențiere)

   Leaflet 1.9.4 e servit local din vendor/leaflet/ (fără CDN). Poligoanele se
   desenează pe canvas (3.181 de UAT-uri — SVG ar fi mai lent la pan/zoom).
   Culorile nu se scriu în JS: se citesc din tokenii CSS (css/adp-tema.css) și
   se recitesc la schimbarea temei luminos/întunecat.

   Folosit de: adp-aplicatie.js. Modul independent: primește prin parametri
   biblioteca Leaflet și geometria deja pregătită (inelele fiecărui UAT și
   plasele de limite); nu știe nimic despre „moduri” de colorare — primește o
   funcție care întoarce stilul fiecărui UAT.
   ========================================================================== */
window.AdpHarta = function() {
    "use strict";

    const ZOOM_ETICHETE_UAT = 10;
    const MAX_ETICHETE_UAT = 450;

    const FUNDALURI = {
        simplu: {
            // plăcile OSM în tonuri de gri (filtru CSS .fundal-gri) — fundal discret sub umpleri,
            // fără cheie API (CARTO cere acum cheie)
            nume: "Simplă (OSM, gri)",
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            atribuire: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
            maxZoom: 19,
            clasa: "fundal-gri"
        },
        osm: {
            nume: "OpenStreetMap",
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            atribuire: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
            maxZoom: 19
        },
        relief: {
            nume: "Relief (OpenTopoMap)",
            url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            atribuire: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>, SRTM | &copy; <a href=\"https://opentopomap.org\">OpenTopoMap</a> (CC-BY-SA)",
            maxZoom: 17,
            subdomains: "abc"
        },
        niciunul: { nume: "Fără fundal" }
    };

    let L = null;           // Leaflet, primit la inițializare
    let harta = null;
    let geo = null;         // { uat: [{n, t, e}], inele: [...], plase: {...}, limite }
    let randator = null;
    let poligoane = [];
    let stratUat = null;
    let straturiLimite = {};
    let stratEtichete = null;
    let stratEticheteUat = null;
    let evidentiere = null;
    let selectie = null;
    let fundal = null;
    let numeFundal = "simplu";
    let functieStil = null;
    let opacitate = 0.7;
    let eticheteRegiuni = [];
    let apeluri = {};
    let limiteActive = {};

    function esc(text) {
        return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
    }

    function token(nume) {
        return getComputedStyle(document.documentElement).getPropertyValue(nume).trim();
    }

    /**
     * Creează harta în elementul dat.
     * @param leaflet     biblioteca Leaflet (L)
     * @param element     containerul hărții
     * @param geometrie   { uat: [{n, t, e}], inele: [inelele fiecărui UAT, ca [lat, lng]],
     *                      plase: {uat, judet, adr, istoric, tara}, limite: [[s, v], [n, e]] }
     * @param evenimente  { survol(idx, ev), iesire(), clic(idx) }
     */
    function initializeaza(leaflet, element, geometrie, evenimente) {
        L = leaflet;
        geo = geometrie;
        apeluri = evenimente || {};
        randator = L.canvas({ padding: 0.3, tolerance: 2 });
        harta = L.map(element, {
            preferCanvas: true,
            zoomSnap: 0.25,
            zoomDelta: 0.5,
            minZoom: 5,
            maxZoom: 16,
            attributionControl: true,
            renderer: randator
        });
        harta.attributionControl.setPrefix(false);
        harta.createPane("limite").style.zIndex = 420;
        harta.createPane("evidentiere").style.zIndex = 430;
        harta.createPane("puncte").style.zIndex = 440;
        harta.createPane("etichete").style.zIndex = 450;
        harta.getPane("limite").style.pointerEvents = "none";
        harta.getPane("evidentiere").style.pointerEvents = "none";
        harta.getPane("etichete").style.pointerEvents = "none";

        stratUat = L.featureGroup().addTo(harta);
        poligoane = geo.inele.map((inele, idx) => {
            const p = L.polygon(inele, {
                renderer: randator,
                stroke: false,
                fillOpacity: opacitate,
                smoothFactor: 0.5
            });
            p.idx = idx;
            return p;
        });
        poligoane.forEach(p => stratUat.addLayer(p));
        stratUat.on("mouseover", e => apeluri.survol && apeluri.survol(e.layer.idx, e));
        stratUat.on("mousemove", e => apeluri.survol && apeluri.survol(e.layer.idx, e));
        stratUat.on("mouseout", () => {
            if (evidentiere) evidentiere.setLatLngs([]);
            if (apeluri.iesire) apeluri.iesire();
        });
        stratUat.on("click", e => apeluri.clic && apeluri.clic(e.layer.idx));

        const limRandator = L.canvas({ pane: "limite", padding: 0.3 });
        const optLimita = { renderer: limRandator, interactive: false, pane: "limite", fill: false };
        straturiLimite = {};
        ["uat", "judet", "adr", "istoric", "tara"].forEach(k => {
            straturiLimite[k] = L.polyline(geo.plase[k], Object.assign({}, optLimita));
        });
        straturiLimite.tara.addTo(harta);

        evidentiere = L.polygon([], { pane: "evidentiere", interactive: false, fill: false, renderer: L.svg({ pane: "evidentiere" }) }).addTo(harta);
        selectie = L.polygon([], { pane: "evidentiere", interactive: false, fill: false, renderer: L.svg({ pane: "evidentiere" }) }).addTo(harta);

        stratEtichete = L.layerGroup().addTo(harta);
        stratEticheteUat = L.layerGroup().addTo(harta);
        harta.on("zoomend moveend", actualizeazaEticheteUat);

        // vederea inițială se fixează abia când containerul are dimensiuni reale (altfel
        // Leaflet calculează zoomul maxim pe un container de 0 px)
        harta.setView([45.9, 25.0], 7, { animate: false });
        seteazaFundal(numeFundal);
        aplicaStiluriLimite();

        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", reimprospateazaTema);
        // containerul își poate schimba mărimea după ce se așază panoul (mobil / desktop)
        let vedereFixata = false;
        const fixeazaVederea = () => {
            if (vedereFixata || !element.clientWidth || !element.clientHeight) return;
            vedereFixata = true;
            harta.invalidateSize({ animate: false });
            reseteazaVederea(false);
        };
        new ResizeObserver(() => {
            harta.invalidateSize();
            fixeazaVederea();
        }).observe(element);
        fixeazaVederea();
        return harta;
    }

    function reimprospateazaTema() {
        seteazaFundal(numeFundal);
        aplicaStiluriLimite();
        if (functieStil) coloreaza(functieStil);
    }

    function seteazaFundal(nume) {
        numeFundal = nume;
        if (fundal) {
            harta.removeLayer(fundal);
            fundal = null;
        }
        const f = FUNDALURI[nume];
        if (!f || !f.url) return;
        fundal = L.tileLayer(f.url, {
            className: f.clasa || "",
            attribution: f.atribuire,
            maxZoom: f.maxZoom,
            subdomains: f.subdomains || "abcd",
            detectRetina: false
        });
        fundal.on("tileerror", () => {
            if (!fundal._avertizat) {
                fundal._avertizat = true;
                console.warn(`[e-ro-adp] Fundalul „${f.nume}” nu a putut fi încărcat (fără rețea?). Harta rămâne fără fundal.`);
            }
        });
        fundal.addTo(harta);
        fundal.bringToBack();
    }

    function aplicaStiluriLimite() {
        const s = {
            uat: { color: token("--limita-uat"), weight: 0.6 },
            judet: { color: token("--limita-judet-culoare"), weight: 1.4 },
            adr: { color: token("--limita-adr-culoare"), weight: 2.6 },
            istoric: { color: token("--limita-istoric-culoare"), weight: 2.4, dashArray: "7 4" },
            tara: { color: token("--contur-tara"), weight: 1.6 }
        };
        Object.keys(s).forEach(k => straturiLimite[k].setStyle(Object.assign({ opacity: 1 }, s[k])));
        // survol: contur subțire; selecție: contur gros, ambele în culoarea textului
        // (albastrul de accent s-ar pierde peste umplerile secvențiale albastre)
        evidentiere.setStyle({ color: token("--evidentiere"), weight: 1.5, opacity: 0.9 });
        selectie.setStyle({ color: token("--evidentiere"), weight: 3.5, opacity: 1 });
    }

    /**
     * Colorează UAT-urile. `fn(idx)` întoarce numele unui token CSS
     * (ex. "--serie-3") sau null pentru „fără umplere”.
     */
    function coloreaza(fn) {
        functieStil = fn;
        const cache = {};
        poligoane.forEach(p => {
            const t = fn(p.idx);
            if (!t) {
                p.setStyle({ fillOpacity: 0 });
                return;
            }
            const c = cache[t] || (cache[t] = token(t) || t);
            p.setStyle({ fillColor: c, fillOpacity: opacitate });
        });
    }

    function seteazaOpacitate(valoare) {
        opacitate = valoare;
        if (functieStil) coloreaza(functieStil);
    }

    function arataLimite(stare) {
        limiteActive = Object.assign({}, stare);
        ["uat", "judet", "adr", "istoric"].forEach(k => {
            const strat = straturiLimite[k];
            if (stare[k] && !harta.hasLayer(strat)) strat.addTo(harta);
            if (!stare[k] && harta.hasLayer(strat)) harta.removeLayer(strat);
        });
    }

    function evidentiaza(idx) {
        evidentiere.setLatLngs(idx === null ? [] : poligoane[idx].getLatLngs());
    }

    function selecteaza(idx) {
        selectie.setLatLngs(idx === null ? [] : poligoane[idx].getLatLngs());
    }

    function zoomLa(indecsi, maxZoom) {
        const lista = Array.isArray(indecsi) ? indecsi : [indecsi];
        const b = L.latLngBounds([]);
        lista.forEach(idx => b.extend(poligoane[idx].getBounds()));
        harta.fitBounds(b, { padding: [30, 30], maxZoom: maxZoom || 11 });
    }

    function reseteazaVederea(animat) {
        harta.fitBounds(geo.limite || [[43.6, 20.2], [48.3, 29.8]], { padding: [10, 10], animate: animat !== false });
    }

    /** Etichete de regiune/județ: [{text, lat, lng, clasa}] — rămân la orice zoom. */
    function seteazaEtichete(lista) {
        eticheteRegiuni = lista || [];
        stratEtichete.clearLayers();
        eticheteRegiuni.forEach(e => {
            L.marker([e.lat, e.lng], {
                pane: "etichete",
                interactive: false,
                keyboard: false,
                icon: L.divIcon({ className: "eticheta-harta " + (e.clasa || ""), html: `<span>${e.text}</span>`, iconSize: null })
            }).addTo(stratEtichete);
        });
    }

    let eticheteUatActive = true;

    function arataEticheteUat(da) {
        eticheteUatActive = da;
        actualizeazaEticheteUat();
    }

    /** Numele UAT-urilor apar doar de aproape și doar pentru cele din ecran. */
    function actualizeazaEticheteUat() {
        stratEticheteUat.clearLayers();
        if (!eticheteUatActive || harta.getZoom() < ZOOM_ETICHETE_UAT) return;
        const b = harta.getBounds();
        let n = 0;
        for (let k = 0; k < geo.uat.length && n < MAX_ETICHETE_UAT; k++) {
            const u = geo.uat[k];
            if (!b.contains(u.e)) continue;
            n++;
            L.marker(u.e, {
                pane: "etichete",
                interactive: false,
                keyboard: false,
                icon: L.divIcon({
                    className: "eticheta-harta e-uat" + (u.t !== "comună" ? " e-urban" : ""),
                    html: `<span>${esc(u.n)}</span>`,
                    iconSize: null
                })
            }).addTo(stratEticheteUat);
        }
    }

    /** Punctul de pe ecran (px, față de colțul hărții) al unei coordonate. */
    function laEcran(latlng) {
        return harta.latLngToContainerPoint(latlng);
    }

    /** Se apelează fn la fiecare schimbare de vedere (zoom sau deplasare). */
    function laSchimbareVedere(fn) {
        harta.on("zoomend moveend", fn);
    }

    /** Strat liber pentru straturi suplimentare (localități, scenarii). */
    function stratNou(pane) {
        return L.layerGroup([], { pane: pane || "puncte" }).addTo(harta);
    }

    /** Linii (plase de arce) pe un pane al hărții, în culoarea unui token CSS. */
    function linii(arce, optiuni) {
        const o = Object.assign({ pane: "limite", interactive: false, weight: 2, opacity: 1 }, optiuni || {});
        if (o.token) o.color = token(o.token);
        return L.polyline(arce, o);
    }

    /** Punct circular (localitate, reședință) — culorile se dau ca tokeni CSS. */
    function punct(latlng, optiuni) {
        const o = Object.assign({ pane: "puncte" }, optiuni || {});
        if (o.tokenContur) o.color = token(o.tokenContur);
        if (o.tokenUmplere) o.fillColor = token(o.tokenUmplere);
        return L.circleMarker(latlng, o);
    }

    /** Etichetă text fixă (L.divIcon), cu clasa CSS dată. Textul trebuie deja escapat. */
    function eticheta(latlng, html, clasa) {
        return L.marker(latlng, {
            pane: "etichete",
            interactive: false,
            keyboard: false,
            icon: L.divIcon({ className: "eticheta-harta " + (clasa || ""), html: `<span>${html}</span>`, iconSize: null })
        });
    }

    return {
        FUNDALURI: FUNDALURI,
        initializeaza: initializeaza,
        coloreaza: coloreaza,
        seteazaOpacitate: seteazaOpacitate,
        seteazaFundal: seteazaFundal,
        arataLimite: arataLimite,
        evidentiaza: evidentiaza,
        selecteaza: selecteaza,
        zoomLa: zoomLa,
        reseteazaVederea: reseteazaVederea,
        seteazaEtichete: seteazaEtichete,
        arataEticheteUat: arataEticheteUat,
        stratNou: stratNou,
        laEcran: laEcran,
        laSchimbareVedere: laSchimbareVedere,
        zoom: () => harta.getZoom(),
        linii: linii,
        punct: punct,
        eticheta: eticheta,
        token: token,
        harta: () => harta,
        poligon: idx => poligoane[idx]
    };
}();
