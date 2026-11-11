/* ============================================================================
   e-ro-adp — pagina hărții (index.html): moduri de colorare, legendă,
   căutare, detalii UAT, localitățile componente ale UAT-ului selectat.

   Modul independent: nu citește globalele altor module. Primește prin
   porneste(dependente) biblioteca Leaflet, topologia, harta și extensiile de
   pagină (scenarii, regiuni tematice); legătura se face o singură dată, în
   index.html. Extensiile primesc un „context” cu datele și funcțiile de care
   au nevoie și își pot adăuga propriul mod de colorare.

   Date: date/romania-uat.json (UAT-uri + atribute) și date/localitati.json
   (satele / localitățile componente, încărcate în fundal).
   ========================================================================== */
window.AdpAplicatie = function() {
    "use strict";

    const CALE_UAT = "date/romania-uat.json";
    const CALE_LOCALITATI = "date/localitati.json";
    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

    const CLASE_POPULATIE = [1500, 3000, 5000, 10000, 20000, 100000];
    const CLASE_DENSITATE = [25, 50, 75, 100, 200, 1000];
    const CLASE_VARSTNICI = [15, 18, 21, 24, 27, 30];

    const TIP_LOCALITATE = {
        9: "reședință de municipiu", 10: "localitate componentă", 11: "sat",
        17: "reședință de oraș", 18: "localitate componentă", 19: "sat",
        22: "reședința comunei", 23: "sat"
    };

    let Harta = null;       // AdpHarta, primit la pornire
    let Topologie = null;   // AdpTopologie, primit la pornire
    let date = null;
    let topo = null;
    let vecini = null;
    let localitati = null;
    let localitatiPeUat = null;
    let mod = "adr";
    let selectat = null;
    let stratSate = null;
    // extensiile (ex. adp-scenariu.js) pot adăuga rânduri în tooltip: fn(idx) -> HTML
    const extinderiTooltip = [];
    // ...și pot prelua clicul pe hartă: fn(idx) -> true dacă l-a tratat
    const extinderiClic = [];

    const $ = sel => document.querySelector(sel);

    function esc(text) {
        if (text === null || text === undefined) return "";
        return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
    }

    function fara(s) {
        return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    }

    function clasa(valoare, praguri) {
        if (valoare === null || valoare === undefined || isNaN(valoare)) return null;
        let k = 0;
        while (k < praguri.length && valoare >= praguri[k]) k++;
        return k + 1;
    }

    function densitate(u) {
        return u.a ? u.pop / u.a : null;
    }

    function slot(n) {
        return `--serie-${Number(n) + 1}`;
    }

    // ------------------------------------------------------------ moduri
    const MODURI = {
        adr: {
            titlu: "Regiuni de dezvoltare (ADR)",
            stil: u => slot(date.culori.adr[u.adr]),
            limite: { judet: true, adr: true },
            legenda: () => legendaCategorii(date.adr.map(r => ({
                cheie: r.c, nume: r.n, slot: date.culori.adr[r.c],
                detaliu: `reședința ADR: ${r.resedinta}`
            })), u => u.adr),
            nota: "Cele 8 regiuni de dezvoltare (Legea 315/2004), corespunzătoare nivelului NUTS 2. Culorile se repetă doar între regiuni care nu se învecinează.",
            etichete: () => eticheteGrup(u => u.adr, k => date.adr.find(r => r.c === k).n, "e-regiune")
        },
        judete: {
            titlu: "Județe",
            stil: u => slot(date.culori.jud[u.j]),
            limite: { judet: true },
            legenda: () => `<p class="nota">41 de județe și municipiul București (NUTS 3). Culorile doar separă județele vecine; numele e pe hartă.</p>`,
            nota: "",
            etichete: () => eticheteGrup(u => u.j, k => numeJudet(k), "e-judet")
        },
        istorice: {
            titlu: "Regiuni istorice",
            stil: u => slot(date.culori.ist[u.ist]),
            limite: { judet: false, istoric: true },
            legenda: () => legendaCategorii(date.istorice.map(n => ({ cheie: n, nume: n, slot: date.culori.ist[n] })), u => u.ist),
            nota: "Fiecare UAT preia provincia istorică a județului interbelic (1930) în care se află. Maramureș = Maramureșul istoric; Crișana cuprinde și Sătmarul și Sălajul. Delimitare orientativă, după limitele digitizate de geo-spatial.org.",
            etichete: () => eticheteGrup(u => u.ist, k => k, "e-regiune")
        },
        uat: {
            titlu: "UAT-uri (după tip)",
            stil: u => u.t === "municipiu" ? "--serie-1" : u.t === "oraș" ? "--serie-2" : "--neutru-harta",
            limite: { uat: true, judet: true },
            legenda: () => legendaCategorii([
                { cheie: "municipiu", nume: "Municipiu", slot: 0 },
                { cheie: "oraș", nume: "Oraș", slot: 1 },
                { cheie: "comună", nume: "Comună", clasaMostra: "f-neutru" }
            ], u => u.t),
            nota: "3.181 de unități administrativ-teritoriale: 103 municipii, 216 orașe, 2.862 de comune (SIRUTA 2025). Numele apar de la zoom 10.",
            etichete: () => eticheteGrup(u => u.j, k => numeJudet(k), "e-judet")
        },
        populatie: {
            titlu: "Populație (INS, 1 ianuarie 2026)",
            stil: u => `--secv-${clasa(u.pop, CLASE_POPULATIE)}`,
            limite: { uat: true, judet: true },
            legenda: () => legendaSecventiala(CLASE_POPULATIE, "locuitori", u => clasa(u.pop, CLASE_POPULATIE)),
            nota: "Populația rezidentă estimată la 1 ianuarie 2026: recensământul 2021, cu evoluția după domiciliu, adus la totalurile rezidente ale INS pe județe. Pragul de 3.000 de locuitori, minimul comunei în propunere, separă treptele 2 și 3; 5.000, folosit des ca minim pentru o comună viabilă, separă treptele 3 și 4.",
            etichete: () => eticheteGrup(u => u.j, k => numeJudet(k), "e-judet")
        },
        densitate: {
            titlu: "Densitate (loc./km²)",
            stil: u => `--secv-${clasa(densitate(u), CLASE_DENSITATE)}`,
            limite: { uat: true, judet: true },
            legenda: () => legendaSecventiala(CLASE_DENSITATE, "loc./km²", u => clasa(densitate(u), CLASE_DENSITATE)),
            nota: "Populația 2021 raportată la suprafața UAT-ului (GISCO).",
            etichete: () => eticheteGrup(u => u.j, k => numeJudet(k), "e-judet")
        },
        varstnici: {
            titlu: "Vârstnici 65+ (%)",
            stil: u => u.v65 === null ? "--fara-date" : `--secv-${clasa(u.v65, CLASE_VARSTNICI)}`,
            limite: { uat: true, judet: true },
            legenda: () => legendaSecventiala(CLASE_VARSTNICI, "% din populație", u => u.v65 === null ? null : clasa(u.v65, CLASE_VARSTNICI)),
            nota: "Ponderea populației de 65 de ani și peste (RPL 2021, tabelul 1.3.2). Un indicator al presiunii pe servicii și al declinului demografic.",
            etichete: () => eticheteGrup(u => u.j, k => numeJudet(k), "e-judet")
        }
    };

    function numeJudet(cod) {
        const j = date.judete.find(x => x.c === Number(cod));
        return j ? j.n : "?";
    }

    /**
     * Etichetă pentru fiecare grup de UAT-uri, pusă în „miezul” grupului: UAT-ul
     * cel mai depărtat (în pași de vecinătate) de marginea grupului; la egalitate,
     * cel mai apropiat de centrul ponderat cu suprafața. Centrul simplu cade prost
     * la regiunile în formă de inel (Sud-Muntenia în jurul Bucureștiului).
     */
    function eticheteGrup(cheie, text, clasaCss) {
        const chei = date.uat.map(cheie);
        const adancime = new Array(date.uat.length).fill(-1);
        let coada = [];
        date.uat.forEach((u, i) => {
            if (vecini[i].some(v => chei[v] !== chei[i]) || vecini[i].length < 2) {
                adancime[i] = 0;
                coada.push(i);
            }
        });
        while (coada.length) {
            const urm = [];
            coada.forEach(i => vecini[i].forEach(v => {
                if (adancime[v] === -1 && chei[v] === chei[i]) {
                    adancime[v] = adancime[i] + 1;
                    urm.push(v);
                }
            }));
            coada = urm;
        }
        const grup = new Map();
        date.uat.forEach((u, i) => {
            const g = grup.get(chei[i]) || { lat: 0, lng: 0, a: 0, membri: [] };
            g.lat += u.e[0] * u.a;
            g.lng += u.e[1] * u.a;
            g.a += u.a;
            g.membri.push(i);
            grup.set(chei[i], g);
        });
        return Array.from(grup, ([k, g]) => {
            const c = [g.lat / g.a, g.lng / g.a];
            const dist = i => (date.uat[i].e[0] - c[0]) ** 2 + ((date.uat[i].e[1] - c[1]) * 0.7) ** 2;
            const max = Math.max(...g.membri.map(i => adancime[i]));
            // jumătate din adâncimea maximă: destul de departe de margine, dar aproape de centru
            const prag = Math.ceil(max / 2);
            const ales = g.membri.filter(i => adancime[i] >= prag).sort((a, b) => dist(a) - dist(b))[0];
            return { text: esc(text(k)), lat: date.uat[ales].e[0], lng: date.uat[ales].e[1], clasa: clasaCss };
        });
    }

    function legendaCategorii(elemente, cheie) {
        const nr = new Map();
        const pop = new Map();
        date.uat.forEach(u => {
            const k = cheie(u);
            nr.set(k, (nr.get(k) || 0) + 1);
            pop.set(k, (pop.get(k) || 0) + (u.pop || 0));
        });
        return `<ul class="legenda">${elemente.map(e => `
            <li title="${esc(e.detaliu || "")}">
                <span class="mostra ${e.clasaMostra || "f-c" + e.slot}"></span>
                <span>${esc(e.nume)}</span>
                <span class="numar">${NF.format(nr.get(e.cheie) || 0)} UAT · ${NF1.format((pop.get(e.cheie) || 0) / 1e6)} mil.</span>
            </li>`).join("")}</ul>`;
    }

    function legendaSecventiala(praguri, unitate, clasaUat) {
        const nr = new Array(praguri.length + 2).fill(0);
        date.uat.forEach(u => {
            const c = clasaUat(u);
            nr[c === null ? 0 : c]++;
        });
        const eticheta = k => k === 0 ? `< ${NF.format(praguri[0])}` : k === praguri.length ? `≥ ${NF.format(praguri[k - 1])}` : `${NF.format(praguri[k - 1])}–${NF.format(praguri[k])}`;
        const randuri = [];
        for (let k = 0; k <= praguri.length; k++) {
            randuri.push(`<li><span class="mostra f-s${k + 1}"></span><span>${eticheta(k)}</span><span class="numar">${NF.format(nr[k + 1])} UAT</span></li>`);
        }
        if (nr[0]) randuri.push(`<li><span class="mostra f-nd"></span><span>fără date</span><span class="numar">${nr[0]}</span></li>`);
        return `<p class="nota" style="margin-bottom:6px">${esc(unitate)}</p><ul class="legenda">${randuri.join("")}</ul>`;
    }

    function aplicaMod(nou) {
        const vechi = MODURI[mod];
        if (vechi && vechi.iese && nou !== mod) vechi.iese();
        mod = nou;
        const m = MODURI[mod];
        Harta.coloreaza(idx => m.stil(date.uat[idx], idx));
        $("#legenda-titlu").textContent = m.titlu;
        $("#legenda").innerHTML = m.legenda() + (m.nota ? `<p class="nota" style="margin-top:10px">${esc(m.nota)}</p>` : "");
        // limitele implicite ale modului; utilizatorul le poate schimba după
        document.querySelectorAll("#limite input").forEach(cb => {
            cb.checked = !!m.limite[cb.value];
        });
        aplicaLimite();
        Harta.seteazaEtichete(m.etichete());
        // modurile adăugate de extensii își desenează straturile proprii
        if (m.intra) m.intra();
    }

    function aplicaLimite() {
        const stare = {};
        document.querySelectorAll("#limite input").forEach(cb => { stare[cb.value] = cb.checked; });
        Harta.arataLimite(stare);
    }

    // ------------------------------------------------------------ tooltip + detalii
    const tooltip = () => $("#tooltip");

    function arataTooltip(idx, ev) {
        const u = date.uat[idx];
        Harta.evidentiaza(idx);
        const t = tooltip();
        const extra = extinderiTooltip.map(fn => fn(idx) || "").join("");
        t.innerHTML = `<strong>${esc(u.n)}</strong>
            <div class="rand"><span>${esc(u.t)}, jud. ${esc(numeJudet(u.j))}</span></div>
            <div class="rand"><span>Populație 2026</span><b>${NF.format(u.pop)}</b></div>${extra}`;
        t.hidden = false;
        const p = ev.containerPoint;
        const zona = $(".zona-harta").getBoundingClientRect();
        const x = Math.min(p.x + 14, zona.width - t.offsetWidth - 8);
        const y = p.y + 14 + t.offsetHeight > zona.height ? p.y - t.offsetHeight - 10 : p.y + 14;
        t.style.left = x + "px";
        t.style.top = y + "px";
    }

    function ascundeTooltip() {
        tooltip().hidden = true;
    }

    function rand(eticheta, valoare) {
        return `<tr><th scope="row">${esc(eticheta)}</th><td>${valoare}</td></tr>`;
    }

    function arataDetalii(idx) {
        selectat = idx;
        Harta.selecteaza(idx);
        const u = date.uat[idx];
        const adr = date.adr.find(r => r.c === u.adr);
        const d = densitate(u);
        const evolutie = u.p11d ? (100 * ((u.pd || u.pop) - u.p11d) / u.p11d) : null;
        const et = u.et || {};
        const minoritate = et.min && et.pmin >= 1 ? `${esc(et.min)} ${NF1.format(et.pmin)}%${et.pmin >= 20 ? ` <span class="eticheta-stare atentie" title="Peste 20%: drept la folosirea limbii materne în administrație (Codul administrativ)">≥ 20%</span>` : ""}` : "—";
        const html = `
            <h3>${esc(u.n)}</h3>
            <div class="tip">${esc(u.t)}${u.r ? " — reședință de județ" : ""} · jud. ${esc(numeJudet(u.j))} · SIRUTA ${u.s}</div>
            <table class="tabel-atribute">
                ${rand("Regiune de dezvoltare", esc(adr ? adr.n : "—"))}
                ${rand("Regiune istorică", esc(u.ist))}
                ${rand("Județ interbelic (1930)", esc(u.j30))}
                ${rand("Populație rezidentă estimată, 1 ianuarie 2026", NF.format(u.pop))}
                ${u.pd ? rand("Populație după domiciliu, 1 ianuarie 2026", NF.format(u.pd)) : ""}
                ${rand("Populație rezidentă 2021 (recensământ)", NF.format(u.p21))}
                ${rand("Evoluție 2011–2026 (domiciliu)", evolutie === null ? "—" : `${evolutie > 0 ? "+" : ""}${NF1.format(evolutie)}%`)}
                ${rand("Suprafață", `${NF1.format(u.a)} km²`)}
                ${rand("Densitate", d === null ? "—" : `${NF1.format(d)} loc./km²`)}
                ${rand("Copii 0–14 ani", u.v014 === null ? "—" : `${NF1.format(u.v014)}%`)}
                ${rand("Vârstnici 65+", u.v65 === null ? "—" : `${NF1.format(u.v65)}%`)}
                ${rand("Minoritatea cea mai mare", minoritate)}
                ${rand("Localități componente", NF.format(u.ns))}
                ${rand("Indice de dispersie (Demangeon)", u.dm === null ? "—" : NF1.format(u.dm) + (u.dsp ? ` <span class="eticheta-stare atentie" title="Pe lista INS a UAT-urilor dispersate teritorial (RPL 2021)">dispersat</span>` : ""))}
                ${rand("Izolat (> 20 km de DN/E/A)", u.iz ? `<span class="eticheta-stare atentie">da</span>` : "nu")}
            </table>
            <div id="lista-sate"></div>`;
        $("#detalii").innerHTML = html;
        $("#detalii-sectiune").hidden = false;
        arataSate(idx);
    }

    // ------------------------------------------------------------ localitatea căutată
    let stratLocalitate = null;
    let vedereInainte = null;    // vederea hărții dinainte de căutare, refăcută la închiderea fișei
    /**
     * Pe hartă rămân doar UAT-urile care formează unitatea nouă a localității căutate: colorate,
     * cu conturul unității, granițele dintre ele, numele lor, satele (cu drumul până la noua
     * primărie) și primăria. Restul hărții se ascunde până se închide fișa sau până când un mod
     * ori scenariul colorează iar harta. `d` = { uat, membri: [SIRUTA], resedinta, sate, sat }.
     */
    function arataLocalitatea(d) {
        if (!d.uat) {
            Harta.izoleaza(null);
            return;
        }
        if (!Harta.izolata()) {
            const h = Harta.harta();
            vedereInainte = { centru: h.getCenter(), zoom: h.getZoom() };
        }
        const dupaSiruta = new Map(date.uat.map((u, i) => [u.s, i]));
        const membri = (d.membri && d.membri.length ? d.membri : [d.uat]).map(s => dupaSiruta.get(s)).filter(i => i !== undefined);
        if (!membri.length) return;
        const set = new Set(membri);
        const ales = dupaSiruta.get(d.uat);
        const resedinta = dupaSiruta.get(d.resedinta);
        if (!stratLocalitate) {
            stratLocalitate = Harta.stratNou("evidentiere");
        }
        stratLocalitate.clearLayers();
        // granițele dintre comunele unite (arcele cu membri de ambele părți), apoi conturul unității noi, gros
        const interioare = [];
        topo.folosire.forEach((pe, a) => {
            if (pe && pe.length === 2 && set.has(pe[0]) && set.has(pe[1])) interioare.push(topo.arce[a]);
        });
        if (interioare.length) {
            stratLocalitate.addLayer(Harta.linii(interioare, { pane: "evidentiere", token: "--suprafata", weight: 2, opacity: 0.95 }));
        }
        stratLocalitate.addLayer(Harta.linii(Topologie.contur(topo, i => set.has(i)),
            { pane: "evidentiere", token: "--evidentiere", weight: 3.5 }));
        // satele: punctul crește cu populația; cel căutat și reședința au nume
        const sate = d.sate || [];
        const max = Math.max(1, ...sate.map(x => x[3] || 0));
        sate.forEach(x => {
            if (x[4] === null) return;
            const eAles = d.sat && x[0] === d.sat;
            Harta.punct([x[4], x[5]], {
                pane: "evidentiere",
                radius: eAles ? 8 : 3 + 6 * Math.sqrt((x[3] || 0) / max),
                tokenContur: "--suprafata", weight: 1.5,
                tokenUmplere: eAles ? "--accent" : "--text",
                fillOpacity: eAles ? 1 : 0.7
            }).bindTooltip(`<strong>${esc(x[1])}</strong><br>${NF.format(x[3] || 0)} loc. · până la primărie: ` +
                `${x[6] < 0.5 ? "în localitate" : Math.round(x[6]) + " min"} → <b>${x[7] < 0.5 ? "în localitate" : Math.round(x[7]) + " min"}</b>`,
                { direction: "top" }).addTo(stratLocalitate);
            if (eAles) stratLocalitate.addLayer(Harta.eticheta([x[4], x[5]], esc(x[1]), "e-localitate e-sat-ales"));
        });
        // numele comunelor și primăria unității noi
        membri.forEach(i => {
            const u = date.uat[i];
            const ePrimarie = i === resedinta && membri.length > 1;
            stratLocalitate.addLayer(Harta.eticheta(u.e, `${esc(u.n)}${ePrimarie ? "<small>primăria</small>" : ""}`,
                "e-localitate" + (i === ales ? " e-ales" : "") + (ePrimarie ? " e-primarie" : "")));
        });
        if (resedinta !== undefined && membri.length > 1) {
            stratLocalitate.addLayer(Harta.punct(date.uat[resedinta].e, {
                pane: "evidentiere", radius: 9, tokenContur: "--evidentiere", weight: 3,
                tokenUmplere: "--suprafata", fillOpacity: 1
            }));
        }
        Harta.selecteaza(null);
        document.body.classList.add("harta-izolata");
        Harta.izoleaza(membri, i => i === ales ? "--secv-4" : "--secv-2", [stratLocalitate], refacuta => {
            document.body.classList.remove("harta-izolata");
            // închiderea fișei: harta revine unde era; dacă a preluat-o simularea, rămâne a ei
            if (refacuta && vedereInainte) Harta.harta().setView(vedereInainte.centru, vedereInainte.zoom);
            vedereInainte = null;
        });
        Harta.zoomLa(membri, 12);
    }

    // ------------------------------------------------------------ localități componente
    function arataSate(idx) {
        if (stratSate) stratSate.clearLayers();
        const cont = $("#lista-sate");
        if (!cont) return;
        if (!localitatiPeUat) {
            cont.innerHTML = `<p class="nota">Se încarcă localitățile componente…</p>`;
            return;
        }
        const u = date.uat[idx];
        const sate = (localitatiPeUat.get(u.s) || []).slice().sort((a, b) => (b.p || 0) - (a.p || 0));
        const max = Math.max(1, ...sate.map(s => s.p || 0));
        cont.innerHTML = `
            <h2 style="margin-top:16px">Localități componente (${sate.length})</h2>
            <table class="tabel-atribute">${sate.map(s => `
                <tr>
                    <th scope="row">${esc(s.n)}${s.t === 9 || s.t === 17 || s.t === 22 ? " <small>(reședință)</small>" : ""}</th>
                    <td style="text-align:right">${s.p === null || s.p === undefined ? "—" : NF.format(s.p)}</td>
                    <td style="width:34%"><span style="display:block;height:6px;border-radius:3px;background:var(--accent);width:${Math.max(2, 100 * (s.p || 0) / max)}%"></span></td>
                </tr>`).join("")}
            </table>
            <p class="nota" style="margin-top:6px">Populația rezidentă la 1 ianuarie 2026 e estimată: recensământul 2021 (RPL 2021, tab. 1.22), cu evoluția după domiciliu (INS, POP107D), adus la totalurile rezidente pe județe și medii (INS, POP105A). Domiciliul îi numără și pe cei plecați din țară. Punctele de pe hartă: coordonate Wikidata.</p>`;
        sate.forEach(s => {
            if (!s.e) return;
            Harta.punct(s.e, {
                radius: 3 + 9 * Math.sqrt((s.p || 0) / max),
                tokenContur: "--suprafata",
                weight: 1.5,
                tokenUmplere: "--text",
                fillOpacity: s.t === 9 || s.t === 17 || s.t === 22 ? 0.95 : 0.6
            }).bindTooltip(`<strong>${esc(s.n)}</strong><br>${esc(TIP_LOCALITATE[s.t] || "")} · ${s.p === null || s.p === undefined ? "—" : NF.format(s.p)} loc.`, { direction: "top" })
                .addTo(stratSate);
        });
    }

    function incarcaLocalitati() {
        fetch(CALE_LOCALITATI).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        }).then(j => {
            localitati = j.localitati;
            localitatiPeUat = new Map();
            localitati.forEach(l => {
                (localitatiPeUat.get(l.u) || localitatiPeUat.set(l.u, []).get(l.u)).push(l);
            });
            if (selectat !== null) arataSate(selectat);
        }).catch(e => {
            console.warn(`[e-ro-adp] "${CALE_LOCALITATI}" nu a putut fi încărcat (${e.message}). Detaliile UAT se afișează fără localitățile componente.`);
            localitatiPeUat = new Map();
        });
    }

    // ------------------------------------------------------------ căutare
    function initCautare() {
        const input = $("#cautare");
        const lista = $("#cautare-lista");
        const index = date.uat.map((u, idx) => ({ idx: idx, cheie: fara(u.n), u: u }));
        let rezultate = [];
        let activ = -1;

        function randeaza() {
            if (!rezultate.length) {
                lista.hidden = true;
                input.setAttribute("aria-expanded", "false");
                return;
            }
            lista.innerHTML = rezultate.map((r, k) => `<li role="option" id="opt-${k}" data-idx="${r.idx}" aria-selected="${k === activ}">${esc(r.u.n)} <small>${esc(r.u.t)}, ${esc(numeJudet(r.u.j))}</small></li>`).join("");
            lista.hidden = false;
            input.setAttribute("aria-expanded", "true");
            input.setAttribute("aria-activedescendant", activ >= 0 ? `opt-${activ}` : "");
        }

        function alege(idx) {
            rezultate = [];
            randeaza();
            input.value = date.uat[idx].n;
            Harta.zoomLa(idx);
            arataDetalii(idx);
        }

        input.addEventListener("input", () => {
            const q = fara(input.value.trim());
            activ = -1;
            if (q.length < 2) {
                rezultate = [];
            } else {
                rezultate = index.filter(r => r.cheie.includes(q))
                    .sort((a, b) => (b.cheie.startsWith(q) - a.cheie.startsWith(q)) || (b.u.pop - a.u.pop))
                    .slice(0, 12);
            }
            randeaza();
        });
        input.addEventListener("keydown", e => {
            if (!rezultate.length) return;
            if (e.key === "ArrowDown") { activ = Math.min(activ + 1, rezultate.length - 1); randeaza(); e.preventDefault(); }
            if (e.key === "ArrowUp") { activ = Math.max(activ - 1, 0); randeaza(); e.preventDefault(); }
            if (e.key === "Enter") { alege(rezultate[Math.max(activ, 0)].idx); e.preventDefault(); }
            if (e.key === "Escape") { rezultate = []; randeaza(); }
        });
        lista.addEventListener("mousedown", e => {
            const li = e.target.closest("li");
            if (li) alege(Number(li.dataset.idx));
        });
        input.addEventListener("blur", () => setTimeout(() => { rezultate = []; randeaza(); }, 150));
    }

    // ------------------------------------------------------------ pornire
    function initControale() {
        document.querySelectorAll("input[name=mod]").forEach(r => r.addEventListener("change", () => aplicaMod(r.value)));
        document.querySelectorAll("#limite input").forEach(cb => cb.addEventListener("change", aplicaLimite));
        const selFundal = $("#fundal");
        selFundal.innerHTML = Object.entries(Harta.FUNDALURI).map(([k, f]) => `<option value="${k}">${esc(f.nume)}</option>`).join("");
        selFundal.addEventListener("change", () => Harta.seteazaFundal(selFundal.value));
        const opac = $("#opacitate");
        opac.addEventListener("input", () => Harta.seteazaOpacitate(Number(opac.value) / 100));
        $("#etichete-uat").addEventListener("change", e => Harta.arataEticheteUat(e.target.checked));
        $("#reset-vedere").addEventListener("click", () => Harta.reseteazaVederea(true));
        $("#inchide-detalii").addEventListener("click", () => {
            selectat = null;
            Harta.selecteaza(null);
            if (stratSate) stratSate.clearLayers();
            $("#detalii-sectiune").hidden = true;
        });
    }

    /**
     * @param dependente {
     *     leaflet: L, topologie: AdpTopologie, harta: AdpHarta,
     *     reorganizare: AdpReorganizare (pentru extensii),
     *     extensii: [module cu initializeaza(context)]
     * }
     */
    function porneste(dependente) {
        Topologie = dependente.topologie;
        Harta = dependente.harta;
        fetch(CALE_UAT).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        }).then(j => {
            date = j;
            topo = Topologie.decodeaza(date);
            vecini = Topologie.vecini(topo);
            Harta.initializeaza(dependente.leaflet, $("#harta"), {
                uat: date.uat,
                inele: date.uat.map(u => Topologie.inele(topo, u)),
                plase: {
                    uat: Topologie.plasa(topo, u => u.s, false),
                    judet: Topologie.plasa(topo, u => u.j, false),
                    adr: Topologie.plasa(topo, u => u.adr, false),
                    istoric: Topologie.plasa(topo, u => u.ist, false),
                    tara: Topologie.plasa(topo, () => 0, true)
                },
                limite: date.limite
            }, {
                survol: arataTooltip,
                iesire: ascundeTooltip,
                // o extensie care preia clicul (scenariul, pe unitățile lui) îl oprește aici
                clic: idx => {
                    if (extinderiClic.some(fn => fn(idx))) return;
                    arataDetalii(idx);
                }
            });
            stratSate = Harta.stratNou("puncte");
            const context = {
                date: date,
                topo: topo,
                vecini: vecini,
                harta: Harta,
                topologie: Topologie,
                reorganizare: dependente.reorganizare,
                regionalizare: dependente.regionalizare,
                infrastructura: dependente.infrastructura,
                numeJudet: numeJudet,
                esc: esc,
                localitati: () => localitatiPeUat,
                adaugaTooltip: fn => extinderiTooltip.push(fn),
                adaugaClic: fn => extinderiClic.push(fn),
                adaugaMod: (cheie, definitie) => { MODURI[cheie] = definitie; },
                // o extensie care preia harta (scenariul) oprește straturile modului curent...
                suspendaMod: () => { if (MODURI[mod].iese) MODURI[mod].iese(); },
                // ...și îl reface când termină
                reaplicaMod: () => aplicaMod(mod)
            };
            (dependente.extensii || []).forEach(x => x.initializeaza(context));
            initControale();
            initCautare();
            // caseta „Caută-ți localitatea” (js/adp-localitatea.js): pe hartă rămân doar ei
            document.addEventListener("ro-adp:localitate", e => arataLocalitatea(e.detail || {}));
            aplicaMod(mod);
            $("#incarcare").remove();
            incarcaLocalitati();
        }).catch(e => {
            console.error(`[e-ro-adp] "${CALE_UAT}" nu a putut fi încărcat (${e.message}).`);
            $("#incarcare").textContent = "Datele hărții nu au putut fi încărcate. Pagina trebuie servită prin HTTP (vezi README.md).";
        });
    }

    return {
        porneste: porneste
    };
}();
