/* ============================================================================
   e-ro-adp — scenariile de reorganizare pe hartă (index.html, secțiunea
   „Reorganizare — scenarii”)

   Încarcă date/judete/<judet>.json (accesibilitatea localităților), rulează
   AdpReorganizare cu parametrii din panou și desenează rezultatul: unitățile
   noi colorate (culori alese astfel încât grupurile vecine să rămână
   distinguibile), limitele lor, reședințele, satele peste timpul maxim și
   candidații la transfer. Se poate rula pe un județ sau pe toată țara.

   Modul independent: nu citește globalele altor module. Tot ce folosește
   (date, hartă, topologie, algoritmul de reorganizare) vine prin contextul
   primit în initializeaza(context), de la AdpAplicatie.
   ========================================================================== */
window.AdpScenariu = function() {
    "use strict";

    const CALE_INDEX = "date/judete/index.json";
    const CALE_FINANTE = "date/finante-uat.json";
    const CALE_DOTARI = "date/dotari-uat.json";
    const CALE_INSTITUTII = "date/regiuni-institutii.json";
    const CALE_INFRA = "date/infrastructura-uat.json";
    const CALE_CORECTII = "date/corectii-districte.json";
    const CALE_JUDECATORII = "date/judecatorii-uat.json";
    const CALE_GAL = "date/gal-uat.json";
    const CHEIE_CORECTII = "ro-adp.corectii";   // copia de lucru din browser, până la salvare
    const TOATA_TARA = "*";
    const PREFIX_ADR = "adr:";
    const RESEDINTE = [9, 17, 22];
    const ZOOM_NUME_DISTRICTE = 8;   // sub acest zoom, numele districtelor s-ar suprapune
    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

    let D = null;           // contextul primit de la AdpAplicatie
    let vecini = null;
    // perechile de sloturi care pot sta alături (validate pentru daltonism, calculate de
    // unelte/prelucrare.py și salvate în date/romania-uat.json → culori.perechi)
    let perechiBune = new Set();
    let judete = [];        // din date/judete/index.json
    let finante = null;     // din date/finante-uat.json (plăți restante, MF)
    let dotari = null;      // din date/dotari-uat.json (farmacii, poștă — registre oficiale)
    let institutii = null;  // din date/regiuni-institutii.json (pentru regiunile din harta finală)
    let infra = null;       // din date/infrastructura-uat.json (apă, canalizare, străzi, școli — INS)
    let judecatorii = null; // din date/judecatorii-uat.json: desenul de pornire al districtelor
    let gal = null;         // din date/gal-uat.json: grupurile de acțiune locală, pe UAT
    let corectii = [];          // alegerile voluntare în lucru: [{ uat, district, nume }]
    let comasari = [];          // comasările alese de mână: [{ uat, cu, nume }]
    let tintaComasare = null;   // UAT-ul (SIRUTA) la care se alipesc următoarele clicuri
    let stratNume = null;       // numele și populația districtelor, pe hartă
    let corectiiSalvate = "[]"; // cum sunt în fișier, ca text, pentru comparație
    let editare = false;        // clicul pe hartă mută comune între districte
    let regiuni = null;     // rezultatul regionalizării, când e activă harta finală
    let final = false;      // harta finală: comune + districte + regiuni, toate odată
    let districtAles = null;   // districtul deschis, când se coboară la comunele lui
    let ultimulTeritoriu = null;
    let nivel = "regiuni";     // nivelul desenat: regiuni, judete, districte, comune
    let ales = null;           // poligonul ales pe hartă: { tip: "adr" | "judet", cod }
    let stratAles = null;      // conturul lui
    const incarcate = new Map();
    let rezultat = null;
    let exCurent = null;    // datele județului, când scenariul e pe un singur județ
    let national = false;
    let activ = false;
    let strat = null;
    let stratLimite = null;
    let culoareGrup = new Map();

    const $ = sel => document.querySelector(sel);

    /** Numeral + substantiv, cu „de” unde o cere româna („27 de județe”, dar „3 județe”). */
    function cate(n, singular, plural) {
        if (n === 1) return `1 ${singular}`;
        const rest = n % 100;
        return `${NF.format(n)} ${n && (rest === 0 || rest >= 20) ? "de " : ""}${plural}`;
    }

    function perecheBuna(a, b) {
        return perechiBune.has(Math.min(a, b) + "," + Math.max(a, b));
    }

    /** Legenda de pe hartă: ce spune umplerea la nivelul ales și ce e fiecare linie. */
    function deseneazaLegenda() {
        const cont = $("#sc-legenda");
        if (!cont) return;
        if (!activ) {
            cont.hidden = true;
            return;
        }
        const umplere = {
            regiuni: "fiecare culoare, o regiune",
            judete: "fiecare culoare, un județ",
            districte: "fiecare culoare, o zonă metropolitană sau un district",
            comune: final ? "tonul dă regiunea, nuanța comuna comasată" : "fiecare culoare, o comună comasată"
        }[nivel];
        const linie = (token, grosime, stil, text) => `<li>
            <span class="linie" style="border-top-color:var(${token});border-top-width:${grosime}px;border-top-style:${stil}"></span>
            <span>${text}</span></li>`;
        const cuUnitati = nivel === "districte" || nivel === "comune";
        cont.innerHTML = `<h4>Legendă</h4>
            <ul>
                <li><span class="umplere" style="background:linear-gradient(90deg,var(--serie-1),var(--serie-3),var(--serie-4))"></span>
                    <span>${umplere}</span></li>
                <li class="legenda-grup">Administrativ — cine e ales</li>
                ${linie("--limita-adr-culoare", 4, "solid", "regiunea")}
                ${linie("--limita-judet-culoare", 2, nivel === "judete" ? "solid" : "dashed", "județul: limită și circumscripție")}
                ${cuUnitati ? linie("--limita-regiune", 1.5, "solid", "comuna sau orașul") : ""}
                ${nivel !== "regiuni" ? `<li class="legenda-grup">Funcțional — unde se dau serviciile</li>` : ""}
                ${nivel !== "regiuni" ? linie("--limita-district-culoare", 3, "solid", "districtul / zona metropolitană") : ""}
                ${cuUnitati ? linie("--limita-district-culoare", 2, "dotted", "microregiunea (grupul de acțiune locală)") : ""}
                ${ales ? linie("--evidentiere", 4, "solid", "teritoriul ales") : ""}
                ${!national && cuUnitati ? `<li><span class="mostra punct sediu"></span><span>reședința unității</span></li>
                    <li><span class="mostra punct"></span><span>sat</span></li>` : ""}
            </ul>`;
        cont.hidden = false;
    }

    /** Culoarea unui UAT, după nivelul ales: regiune, județ, district sau unitate nouă. */
    function culoareNivel(r, culoriUnitati) {
        const serie = n => `--serie-${(n % 8) + 1}`;
        if (nivel === "regiuni") return idx => serie(D.date.uat[idx].adr - 1);
        if (nivel === "judete") return idx => serie(D.date.uat[idx].j - 1);
        if (nivel === "districte" && r.unitateDistrict) {
            const lista = (r.districte || []).map(d => d.sediu);
            const slot = new Map(lista.map((d, k) => [d, k]));
            return idx => {
                const u = r.grup.get(idx);
                const d = u === undefined ? undefined : r.unitateDistrict.get(u);
                return d === undefined ? "--neutru-harta" : serie(slot.get(d) || 0);
            };
        }
        return idx => r.grup.has(idx)
            ? (culoriUnitati ? culoriUnitati.get(r.grup.get(idx)) : `--serie-${culoareGrup.get(r.grup.get(idx)) + 1}`)
            : "--neutru-harta";
    }

    /** Amestecă o culoare hexa cu alb (f > 0) sau cu negru (f < 0), pentru nuanțe. */
    function nuanta(hex, f) {
        const n = parseInt(hex.replace("#", ""), 16);
        const canal = d => {
            const v = (n >> d) & 255;
            return Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f));
        };
        return `rgb(${canal(16)}, ${canal(8)}, ${canal(0)})`;
    }

    /**
     * Culorile hărții finale: fiecare unitate nouă primește o nuanță a culorii regiunii
     * ei de dezvoltare, iar vecinele capătă nuanțe diferite. Așa se citesc deodată toate
     * nivelurile: regiunea din tonul general, unitatea din nuanță, restul din contururi.
     */
    function culoriStructura(r) {
        const baza = ["--serie-1", "--serie-3", "--serie-4", "--serie-5",
            "--serie-2", "--serie-6", "--serie-7", "--serie-8"];
        const hex = D.date.adr.map((a, k) => D.harta.token(baza[k % baza.length]) || "#2a78d6");
        const trepte = [0.45, 0.15, -0.15];
        const adrUnitate = new Map();
        r.grupuri.forEach(g => adrUnitate.set(g.sediu, D.date.uat[g.sediu].adr));
        const ad = new Map(r.grupuri.map(g => [g.sediu, new Set()]));
        r.uat.forEach(i => vecini[i].forEach(n => {
            const a = r.grup.get(i), b = r.grup.get(n);
            if (a !== undefined && b !== undefined && a !== b) ad.get(a).add(b);
        }));
        const slot = D.topologie.coloreaza(r.grupuri.map(g => g.sediu),
            g => Array.from(ad.get(g)), (a, b) => a !== b, trepte.length);
        const culori = new Map();
        r.grupuri.forEach(g => {
            const adr = adrUnitate.get(g.sediu) || 1;
            culori.set(g.sediu, nuanta(hex[(adr - 1) % hex.length], trepte[slot.get(g.sediu) % trepte.length]));
        });
        return culori;
    }

    /** Sloturi de culoare pentru unitățile noi: vecinii primesc perechi validate. */
    function coloreazaGrupuri(r) {
        const ad = new Map(r.grupuri.map(g => [g.sediu, new Set()]));
        r.uat.forEach(i => vecini[i].forEach(n => {
            const a = r.grup.get(i), b = r.grup.get(n);
            if (a !== undefined && b !== undefined && a !== b) ad.get(a).add(b);
        }));
        return D.topologie.coloreaza(r.grupuri.map(g => g.sediu), g => Array.from(ad.get(g)), perecheBuna, 8);
    }

    function parametri() {
        return {
            // banda de praguri: comuna crește spre minim + 2.000, unitatea cu oraș
            // pornește de unde se termină banda rurală și are propria țintă
            pMin: Number($("#sc-pmin").value),
            pTinta: Number($("#sc-pmin").value) + 2000,
            pMinOras: Number($("#sc-pmin").value) + 2000,
            pTintaOras: Number($("#sc-pmin").value) + 4000,
            tMax: Number($("#sc-tmax").value),
            pOrasAutonom: Number($("#sc-oras").value),
            pMaxRural: Number($("#sc-pmax").value),
            tMaxFortat: Number($("#sc-tfortat").value),
            praguriLegale: $("#sc-legal").checked,
            proiectie: $("#sc-proiectie").checked,
            forteaza: $("#sc-fortare").checked,
            absorbtieUrbana: $("#sc-urban").checked,
            respectaIstorice: $("#sc-istorice").checked,
            regimMinoritati: $("#sc-minoritati").value,
            dotari: dotari && dotari.localitati,
            // desenul de pornire al districtelor; alegerile de mână trec înaintea lui
            corectii: $("#sc-baza").value === "judecatorii" ? D.reorganizare.alegeriCuCircumscriptii(judecatorii, corectii)
                : $("#sc-baza").value === "gal" ? D.reorganizare.alegeriCuGal(D.date, gal, corectii) : corectii,
            comasari: comasari,
            districte: true
        };
    }

    // ------------------------------------------------------------ cascada de teritoriu
    const numeAdr = a => a.n === "București-Ilfov" ? "București–Ilfov (Metropola)" : a.n;

    function optiuni(sel, prima, lista, valoare) {
        sel.innerHTML = `<option value="">${D.esc(prima)}</option>` +
            lista.map(x => `<option value="${x.v}">${D.esc(x.t)}</option>`).join("");
        sel.value = valoare === null || valoare === undefined ? "" : String(valoare);
        sel.disabled = !lista.length;
    }

    /**
     * Cele patru liste — regiune, județ, zonă, comună — se umplu una din alta și se țin
     * la zi cu starea hărții, indiferent dacă s-a coborât din listă, din panou sau cu
     * clic pe poligon.
     */
    function sincronizeazaCascada() {
        const cheie = $("#sc-exemplu").value;
        const codAdr = cheie.startsWith(PREFIX_ADR) ? Number(cheie.slice(PREFIX_ADR.length)) : null;
        const codJudet = cheie !== TOATA_TARA && codAdr === null ? Number(cheie) : null;
        const adrCurent = codAdr !== null ? codAdr
            : codJudet !== null ? (D.date.uat.find(u => u.j === codJudet) || {}).adr : null;

        optiuni($("#sc-regiune"), "Toată țara — alege regiunea",
            D.date.adr.map(a => ({ v: a.c, t: numeAdr(a) })), adrCurent);
        optiuni($("#sc-judet"), adrCurent === null ? "— întâi regiunea —" : "Toate județele regiunii",
            adrCurent === null ? [] : judeteleAdr(adrCurent).map(j => ({ v: j.cod, t: j.nume })), codJudet);

        const r = rezultat;
        const districte = codJudet !== null && r && r.districte ? r.districte : [];
        optiuni($("#sc-zona"), codJudet === null ? "— întâi județul —" : "Toate zonele județului",
            districte.map(d => ({
                v: d.sediu,
                t: `${d.nume} — ${d.tip === "metropolitan" ? "zonă metropolitană" : "district"}`
            })), districtAles);

        const d = districtAles !== null ? districte.find(x => x.sediu === districtAles) : null;
        const comune = d ? d.unitati.map(u => r.grupuri.find(g => g.sediu === u)).filter(Boolean) : [];
        optiuni($("#sc-comuna"), d ? "Toate comunele zonei" : "— întâi zona —",
            comune.map(g => ({ v: g.sediu, t: `${g.nume} (${NF.format(g.populatie)} loc.)` })), null);
    }

    function leagaCascada() {
        $("#sc-regiune").addEventListener("change", e => {
            const cod = e.target.value;
            $("#sc-exemplu").value = cod ? PREFIX_ADR + cod : TOATA_TARA;
            seteazaNivel(cod ? "judete" : "regiuni");
            ruleaza(true);
        });
        $("#sc-judet").addEventListener("change", e => {
            const cod = e.target.value;
            if (cod) {
                $("#sc-exemplu").value = cod;
                seteazaNivel("districte");
            } else {
                $("#sc-exemplu").value = PREFIX_ADR + $("#sc-regiune").value;
                seteazaNivel("judete");
            }
            ruleaza(true);
        });
        $("#sc-zona").addEventListener("change", e => {
            const r = rezultat;
            districtAles = e.target.value ? Number(e.target.value) : null;
            seteazaNivel(districtAles === null ? "districte" : "comune");
            const d = districtAles !== null && r.districte.find(x => x.sediu === districtAles);
            if (d) {
                const uat = [];
                d.unitati.forEach(u => r.uat.forEach(i => { if (r.grup.get(i) === u) uat.push(i); }));
                D.harta.zoomLa(uat, 11);
            } else {
                D.harta.zoomLa(r.uat, 9);
            }
            deseneaza();
            afiseazaRezultat();
        });
        $("#sc-comuna").addEventListener("change", e => {
            if (!e.target.value) return;
            const sediu = Number(e.target.value);
            D.harta.zoomLa(rezultat.uat.filter(i => rezultat.grup.get(i) === sediu), 12);
            arataDosar(sediu);
        });
    }

    /** Schimbă nivelul desenat, fără să refacă scenariul dacă nu e nevoie. */
    function seteazaNivel(nou, redeseneaza) {
        nivel = nou;
        ales = null;
        $("#sc-dosar").hidden = true;
        const r = document.querySelector(`input[name=nivel][value="${nou}"]`);
        if (r) r.checked = true;
        if (redeseneaza && rezultat) {
            deseneaza();
            afiseazaRezultat();
        }
    }

    function actualizeazaEtichete() {
        const pmin = Number($("#sc-pmin").value);
        $("#sc-pmin-val").textContent = `${NF.format(pmin)}–${NF.format(pmin + 2000)} la comune, ` +
            `${NF.format(pmin + 2000)}–${NF.format(pmin + 4000)} cu oraș`;
        $("#sc-tmax-val").textContent = $("#sc-tmax").value;
        $("#sc-oras-val").textContent = NF.format(Number($("#sc-oras").value));
        $("#sc-pmax-val").textContent = NF.format(Number($("#sc-pmax").value));
        $("#sc-tfortat-val").textContent = $("#sc-tfortat").value;
        // pragul unic de autonomie e înlocuit de pragurile de rang, când sunt active
        const legal = $("#sc-legal").checked;
        $("#sc-oras").disabled = legal;
        $("label[for=sc-oras]").classList.toggle("inactiv", legal);
    }

    async function incarca(cod) {
        if (incarcate.has(cod)) return incarcate.get(cod);
        const j = judete.find(x => x.cod === cod);
        const r = await fetch("date/" + j.fisier);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const date = await r.json();
        incarcate.set(cod, date);
        return date;
    }

    /** Numele teritoriului ales, așa cum se citește într-un titlu. */
    function numeTeritoriu() {
        const cheie = $("#sc-exemplu").value;
        if (cheie === TOATA_TARA) return "țării";
        if (cheie.startsWith(PREFIX_ADR)) {
            const a = D.date.adr.find(x => x.c === Number(cheie.slice(PREFIX_ADR.length)));
            return a ? "regiunii " + (a.n === "București-Ilfov" ? "București–Ilfov" : a.n) : "regiunii";
        }
        const j = judete.find(x => String(x.cod) === cheie);
        return j ? "județului " + j.nume : "teritoriului";
    }

    /** Județele unei regiuni ADR, după regiunea UAT-urilor ei. */
    function judeteleAdr(codAdr) {
        return judete.filter(j => {
            const u = D.date.uat.find(x => x.j === j.cod);
            return u && u.adr === codAdr;
        });
    }

    async function ruleaza(zoom) {
        const cheie = $("#sc-exemplu").value;
        if (cheie !== ultimulTeritoriu) {
            districtAles = null;
            ales = null;
            ultimulTeritoriu = cheie;
        }
        const codAdr = cheie.startsWith(PREFIX_ADR) ? Number(cheie.slice(PREFIX_ADR.length)) : null;
        national = cheie === TOATA_TARA || codAdr !== null;
        try {
            if (national) {
                const lista = codAdr === null ? judete : judeteleAdr(codAdr);
                $("#sc-rezultat").innerHTML = `<p class="nota">Se calculează scenariul pentru ${cate(lista.length, "județ", "județe")}…</p>`;
                const toate = await Promise.all(lista.map(j => incarca(j.cod)));
                exCurent = null;
                const optiuni = parametri();
                if (codAdr !== null) {
                    optiuni.zona = D.date.uat.map((u, i) => u.adr === codAdr ? i : -1).filter(i => i >= 0);
                }
                rezultat = D.reorganizare.calculeazaNational(D.date, vecini, toate, optiuni);
            } else {
                exCurent = await incarca(Number(cheie));
                const optiuni = parametri();
                rezultat = D.reorganizare.calculeaza(D.date, vecini, exCurent, optiuni);
                if (optiuni.districte) {
                    const p = D.reorganizare.calculeazaDistrict(D.date, vecini, exCurent, rezultat, optiuni);
                    rezultat.districte = p.districte;
                    rezultat.unitateDistrict = p.unitateDistrict;
                    rezultat.unitateMicro = p.unitateMicro;
                }
            }
        } catch (e) {
            console.error(`[e-ro-adp] Datele de accesibilitate nu au putut fi încărcate (${e.message}).`);
            $("#sc-rezultat").innerHTML = `<p class="nota">Datele județului nu au putut fi încărcate. Rulează <code>python unelte/accesibilitate.py</code>.</p>`;
            return;
        }
        culoareGrup = coloreazaGrupuri(rezultat);
        if (!activ) D.suspendaMod();
        activ = true;
        deseneaza();
        afiseazaRezultat();
        if (zoom) {
            if (cheie === TOATA_TARA) D.harta.reseteazaVederea(true);
            else D.harta.zoomLa(rezultat.uat, national ? 9 : 10);
        }
        $("#sc-inchide").hidden = false;
    }

    /**
     * Harta finală: proiectul complet — unitățile de bază, districtele și regiunile,
     * desenate împreună, fiecare nivel cu culoarea lui, plus rezumatul proiectului.
     */
    async function hartaFinala() {
        final = true;
        $("#sc-exemplu").value = TOATA_TARA;
        $("#sc-district").checked = true;
        if (!institutii) {
            institutii = await fetch(CALE_INSTITUTII).then(r => r.ok ? r.json() : null).catch(() => null);
        }
        // regiunile proiectului sunt cele 8 de dezvoltare existente, nu o simulare:
        // București–Ilfov devine Metropola, restul rămân cum sunt
        const popAdr = new Map();
        D.date.uat.forEach(u => popAdr.set(u.adr, (popAdr.get(u.adr) || 0) + (u.p21 || 0)));
        regiuni = D.date.adr.map(a => ({
            cod: a.c,
            nume: a.n === "București-Ilfov" ? "București–Ilfov (Metropola)" : a.n,
            populatie: popAdr.get(a.c) || 0
        }));
        await ruleaza(true);
    }

    function inchide() {
        final = false;
        regiuni = null;
        activ = false;
        rezultat = null;
        exCurent = null;
        strat.clearLayers();
        stratLimite.clearLayers();
        stratAles.clearLayers();
        stratNume.clearLayers();
        ales = null;
        $("#sc-legenda").hidden = true;
        $("#sc-rezultat").innerHTML = "";
        $("#sc-dosar").hidden = true;
        $("#sc-inchide").hidden = true;
        D.reaplicaMod();
    }

    // ------------------------------------------------------------ hartă
    function deseneaza() {
        const r = rezultat;
        deseneazaLegenda();
        const culoare = culoareNivel(r, final ? culoriStructura(r) : null);
        const inAles = idx => !ales ||
            (ales.tip === "adr" ? D.date.uat[idx].adr === ales.cod : D.date.uat[idx].j === ales.cod);
        D.harta.coloreaza(idx => inAles(idx) ? culoare(idx) : "--neutru-harta");
        // conturul poligonului ales, peste toate celelalte limite
        stratAles.clearLayers();
        if (ales) {
            // `contur` întreabă pe indexul UAT-ului, nu pe obiect
            D.harta.linii(D.topologie.contur(D.topo, inAles),
                { token: "--evidentiere", weight: 4 }).addTo(stratAles);
        }
        if (editare && modEditare() === "comasare" && tintaComasare !== null) {
            const iTinta = D.date.uat.findIndex(u => u.s === tintaComasare);
            const unitate = r.grup.get(iTinta);
            D.harta.linii(D.topologie.contur(D.topo, i => r.grup.get(i) === unitate && unitate !== undefined),
                { token: "--evidentiere", weight: 4 }).addTo(stratAles);
        } else if (editare && r.unitateDistrict) {
            const tinta = Number($("#sc-tinta").value);
            const iTinta = tinta ? D.date.uat.findIndex(u => u.s === tinta) : -1;
            const sediu = iTinta >= 0 ? r.unitateDistrict.get(r.grup.get(iTinta)) : undefined;
            if (sediu !== undefined) {
                D.harta.linii(D.topologie.contur(D.topo, i => r.unitateDistrict.get(r.grup.get(i)) === sediu),
                    { token: "--evidentiere", weight: 4 }).addTo(stratAles);
            }
        }
        D.harta.arataLimite({ uat: !national, judet: true });
        D.harta.seteazaEtichete([]);

        // limitele unităților noi (și conturul zonei calculate)
        stratLimite.clearLayers();
        const indexUat = new Map(D.date.uat.map((u, i) => [u, i]));
        const plasa = D.topologie.plasa(D.topo, u => {
            const idx = indexUat.get(u);
            return r.grup.has(idx) ? r.grup.get(idx) : -1;
        }, false);
        // fiecare nivel își arată conturul lui și pe cele de deasupra, nu și pe cele de dedesubt:
        // la regiuni nu se văd comunele, la județe nu se văd încă unitățile
        const cuUnitati = nivel === "districte" || nivel === "comune";
        const cuDistricte = nivel !== "regiuni";
        if (cuUnitati) {
            D.harta.linii(plasa, {
                token: "--limita-regiune",
                weight: nivel === "comune" ? 2.6 : (national ? 1 : 1.6)
            }).addTo(stratLimite);
        }

        // ierarhia se vede mereu: județele punctate, regiunile cu linie groasă
        D.harta.linii(D.topologie.plasa(D.topo, u => u.j, false), {
            token: "--limita-judet-culoare",
            weight: nivel === "judete" ? 3 : 1.6,
            dashArray: nivel === "judete" ? null : "6 4"
        }).addTo(stratLimite);
        D.harta.linii(D.topologie.plasa(D.topo, u => u.adr, false), {
            token: "--limita-adr-culoare",
            weight: nivel === "regiuni" ? 5 : 3.5
        }).addTo(stratLimite);

        // microregiunile din interiorul districtului: linie întreruptă, sub limita lui
        if (r.unitateMicro && cuUnitati) {
            D.harta.linii(D.topologie.plasa(D.topo, u => {
                const sediu = r.grup.get(indexUat.get(u));
                return sediu === undefined ? -1 : (r.unitateMicro.get(sediu) ?? -1);
            }, false), {
                token: "--limita-district-culoare", weight: national ? 1.4 : 2.4, dashArray: "2 5"
            }).addTo(stratLimite);
        }

        // nivelul intermediar: limite mai groase peste cele ale unităților
        if (r.unitateDistrict && cuDistricte) {
            const plasaLimite = D.topologie.plasa(D.topo, u => {
                const idx = indexUat.get(u);
                const sediu = r.grup.get(idx);
                return sediu === undefined ? -1 : (r.unitateDistrict.get(sediu) ?? -1);
            }, false);
            D.harta.linii(plasaLimite, {
                token: "--limita-district-culoare",
                weight: nivel === "districte" ? 4.5 : (national ? 2.4 : 3)
            }).addTo(stratLimite);
        }

        // harta finală: peste unități și districte vin și limitele regiunilor
        if (final && regiuni) {
            const plasaRegiuni = D.topologie.plasa(D.topo, u => u.adr, false);
            D.harta.linii(plasaRegiuni, { token: "--limita-adr-culoare", weight: 5 }).addTo(stratLimite);
        }

        deseneazaNumeDistricte();
        strat.clearLayers();
        if (national || !exCurent) return;   // la scară națională nu se desenează cele ~14.000 de sate
        const ex = exCurent;
        const esteResedinta = k => RESEDINTE.includes(ex.sate[k].t);
        const satResedinta = uatIdx => ex.sate.find(x => x.u === D.date.uat[uatIdx].s && RESEDINTE.includes(x.t));

        // candidații la transfer: linie punctată spre reședința propusă
        r.sate.filter(s => s.transfer).forEach(s => {
            D.harta.linii([[s.e, satResedinta(s.transfer.g).e]], {
                pane: "puncte", token: "--stare-serios", weight: 1.6, dashArray: "4 4", opacity: 0.9
            }).addTo(strat);
        });

        r.sate.forEach(s => {
            const esteSediu = esteResedinta(s.k) && r.grup.get(s.uat) === s.uat;
            const esteFostSediu = esteResedinta(s.k) && !esteSediu;
            let umplere = "--text";
            if (s.depasire) umplere = "--stare-atentie";
            else if (s.transfer) umplere = "--stare-serios";
            const m = D.harta.punct(s.e, {
                radius: esteSediu ? 7 : esteFostSediu ? 4.5 : 3,
                tokenContur: esteSediu ? "--text" : "--suprafata",
                weight: esteSediu ? 2.5 : 1.2,
                tokenUmplere: esteSediu ? "--suprafata" : umplere,
                fillOpacity: 1
            });
            const g = r.grupuri.find(x => x.sediu === r.grup.get(s.uat));
            const linii = [
                `<strong>${D.esc(s.n)}</strong>${esteSediu ? " — reședință nouă" : esteFostSediu ? " — fostă reședință" : ""}`,
                `${s.p === null || s.p === undefined ? "—" : NF.format(s.p)} loc. · UAT actual: ${D.esc(D.date.uat[s.uat].n)}`,
                `Unitate nouă: <b>${D.esc(g.nume)}</b>`,
                `Timp la reședință: ${NF1.format(s.tAcum)} → <b>${NF1.format(s.tNou)} min</b>`
            ];
            if (s.depasire) linii.push(`⚠ peste ${r.parametri.tMax} min`);
            if (s.transfer) linii.push(`↪ mai aproape de ${D.esc(D.date.uat[s.transfer.g].n)}: ${NF1.format(s.transfer.t)} min`);
            m.bindTooltip(linii.join("<br>"), { direction: "top" });
            m.addTo(strat);
        });

        // numele noilor unități, lângă reședință
        r.grupuri.forEach(g => {
            D.harta.eticheta(satResedinta(g.sediu).e, D.esc(g.nume), "e-scenariu").addTo(strat);
        });
    }

    /**
     * Numele și populația fiecărui district, scrise pe hartă la reședința lui. La scara țării
     * s-ar călca unele pe altele, așa că apar de la un anumit zoom în sus.
     */
    function deseneazaNumeDistricte() {
        stratNume.clearLayers();
        const r = rezultat;
        if (!r || !r.districte || nivel !== "districte") return;
        if (national && D.harta.zoom() < ZOOM_NUME_DISTRICTE) return;
        r.districte.forEach(d => {
            const e = D.date.uat[d.sediu].e;
            if (!e || (ales && !(ales.tip === "adr" ? D.date.uat[d.sediu].adr === ales.cod : D.date.uat[d.sediu].j === ales.cod))) return;
            D.harta.eticheta(e, `${D.esc(d.nume)}<br><small>${NF.format(d.populatie)} loc.</small>`, "e-scenariu")
                .addTo(stratNume);
        });
    }

    // ------------------------------------------------------------ dosarul unei unități
    /**
     * Tot ce a dus la unitatea asta: condițiile verificate cu praguri și stare,
     * pașii algoritmului în ordinea în care s-au petrecut, derogările.
     * Se deschide din listă sau cu clic pe hartă, cât timp scenariul e activ.
     */
    function arataDosar(sediu) {
        const cont = $("#sc-dosar");
        const g = rezultat && rezultat.grupuri.find(x => x.sediu === sediu);
        if (!g) {
            cont.hidden = true;
            return;
        }
        const conditii = g.conditii.map(c => `
            <tr class="${c.stare === "derogare" ? "c-derogare" : ""}">
                <th scope="row">${D.esc(c.nume)}</th>
                <td>${D.esc(String(c.valoare))}</td>
                <td><small>${c.stare === "derogare" ? `<span class="eticheta-stare atentie">derogare</span> ` : ""}${D.esc(String(c.prag))}</small></td>
            </tr>`).join("");
        const pasi = g.dosar.map(e =>
            `<li><b>${D.esc(e.regula)}</b> — ${D.esc(e.text)}</li>`).join("");
        cont.innerHTML = `
            <h3>${D.esc(g.nume)}</h3>
            <div class="tip">${D.esc(g.urban ? D.date.uat[g.sediu].t : "comună")} ·
                ${cate(g.membri.length, "UAT comasat", "UAT-uri comasate")} ·
                ${cate(g.nrSate, "sat", "sate")} · ${NF.format(g.populatie)} loc.</div>
            <table class="tabel-atribute tabel-dosar"><tbody>${conditii}</tbody></table>
            <h4 class="subtitlu-sectiune">Cum s-a format, pas cu pas</h4>
            <ol class="pasi-dosar">${pasi}</ol>
            ${tabelBani(g.membri, "Banii unității", [g])}
            ${infrastructura(g.membri, "Infrastructura esențială a unității")}
            ${restante(g)}
            <p class="nota"><b>UAT-uri:</b> ${g.membri.map(i =>
                `${D.esc(D.date.uat[i].n)} (${NF.format(D.date.uat[i].p21)})`).join(", ")}.
                <br><b>Delegați sătești:</b> ${cate(g.nrSate, "sat, cu fond propriu", "sate, fiecare cu fond propriu")}.
                ${g.birouri.length ? `<br><b>Birouri permanente:</b> ${g.birouri.map(i => D.esc(D.date.uat[i].n)).join(", ")}.` : ""}
                ${g.transferuri ? `<br>${cate(g.transferuri, "sat ar sta mai bine", "sate ar sta mai bine")} în unitatea vecină (linie punctată pe hartă).` : ""}</p>
            <button id="sc-dosar-inchide" class="buton" type="button">Închide dosarul</button>`;
        cont.hidden = false;
        $("#sc-dosar-inchide").addEventListener("click", () => { cont.hidden = true; });
        cont.scrollIntoView({ block: "nearest" });
    }

    /** Fișa de infrastructură esențială a unei liste de UAT-uri: drumuri, apă-canal, educație, cultură. */
    function infrastructura(indecsi, titlu) {
        if (!infra || !D.infrastructura || !indecsi.length) return "";
        const a = D.infrastructura.agrega(D.date, infra, finante, indecsi);
        const numeUat = i => D.date.uat[i].n;
        return D.infrastructura.tabel(a, titlu, finante && finante.anExecutie, numeUat) +
            D.infrastructura.planActiuni(a, "Ce e de făcut, și din ce bani", numeUat);
    }

    // ------------------------------------------------------------ alegerile voluntare
    const curata = lista => (lista || []).map(c =>
        ({ uat: Number(c.uat), district: Number(c.district), nume: c.nume || "" }));
    const numeSiruta = s => (D.date.uat.find(u => u.s === s) || { n: String(s) }).n;
    const curataComasari = lista => (lista || []).map(c =>
        ({ uat: Number(c.uat), cu: Number(c.cu), nume: c.nume || "" }));
    const stare = () => JSON.stringify({ corectii: corectii, comasari: comasari });
    const modificat = () => stare() !== corectiiSalvate;
    const modEditare = () => (document.querySelector("input[name=sc-mod-editare]:checked") || {}).value || "district";

    function citesteLocal() {
        try {
            const text = localStorage.getItem(CHEIE_CORECTII);
            if (!text) return null;
            const j = JSON.parse(text);
            // forma veche ținea doar lista alegerilor de district
            return Array.isArray(j) ? { corectii: curata(j), comasari: [] }
                : { corectii: curata(j.corectii), comasari: curataComasari(j.comasari) };
        } catch (e) {
            return null;   // stocarea locală poate fi oprită; alegerile rămân doar în pagină
        }
    }

    function scrieLocal(lista) {
        try {
            if (lista) localStorage.setItem(CHEIE_CORECTII, stare());
            else localStorage.removeItem(CHEIE_CORECTII);
        } catch (e) {
            console.warn(`[ro-adp] Alegerile nu au putut fi ținute în browser (${e.message}).`);
        }
    }

    /** Județul pe care e scenariul, sau null dacă e pe o regiune ori pe toată țara. */
    function judetulCurent() {
        const cheie = $("#sc-exemplu").value;
        return cheie === TOATA_TARA || cheie.startsWith(PREFIX_ADR) ? null : Number(cheie);
    }

    /** Panoul de editare: orașele județului ca ținte, alegerile făcute, starea salvării. */
    function deseneazaEditare(mesaj) {
        $("#sc-editare").hidden = !editare;
        $("#sc-editeaza").setAttribute("aria-pressed", String(editare));
        if (!editare) return;
        const cod = activ ? judetulCurent() : null;
        const orase = cod === null ? []
            : D.date.uat.filter(u => u.j === cod && u.t !== "comună").sort((a, b) => a.n.localeCompare(b.n, "ro"));
        const tinta = $("#sc-tinta");
        const pastrat = tinta.value;
        tinta.innerHTML = `<option value="">— alege orașul-reședință —</option>` +
            orase.map(u => `<option value="${u.s}">${D.esc(u.n)}</option>`).join("");
        if (orase.some(u => String(u.s) === pastrat)) tinta.value = pastrat;
        tinta.disabled = !orase.length;
        const comasare = modEditare() === "comasare";
        tinta.hidden = comasare;
        $("#sc-tinta-eticheta").hidden = comasare;
        $("#sc-ajutor-editare").textContent = comasare
            ? "Dă clic pe comuna sau orașul la care se alipesc celelalte, apoi pe fiecare UAT care se comasează cu el. " +
              "Încă un clic pe același UAT anulează; clic pe țintă alege alta."
            : "Alege orașul-reședință, apoi dă clic pe hartă pe comunele care trec la districtul lui. " +
              "Încă un clic pe aceeași comună anulează alegerea.";

        const inJudet = s => {
            const u = D.date.uat.find(x => x.s === s);
            return u && (cod === null || u.j === cod);
        };
        const randuri = corectii.filter(c => inJudet(c.uat)).map(c =>
            `<li><span>${D.esc(numeSiruta(c.uat))} → districtul <b>${D.esc(numeSiruta(c.district))}</b></span>
                <button class="buton" type="button" data-sterge="${c.uat}"
                    aria-label="Șterge alegerea: ${D.esc(numeSiruta(c.uat))}">✕</button></li>`)
            .concat(comasari.filter(c => inJudet(c.uat)).map(c =>
                `<li><span>${D.esc(numeSiruta(c.uat))} + <b>${D.esc(numeSiruta(c.cu))}</b> <small>(comasare)</small></span>
                <button class="buton" type="button" data-desface="${c.uat}"
                    aria-label="Desface comasarea: ${D.esc(numeSiruta(c.uat))}">✕</button></li>`));
        $("#sc-alegeri").innerHTML = randuri.length ? randuri.join("")
            : `<li class="nota">Nicio alegere în acest județ.</li>`;
        document.querySelectorAll("#sc-alegeri button[data-sterge]").forEach(b =>
            b.addEventListener("click", () => {
                corectii = corectii.filter(c => c.uat !== Number(b.dataset.sterge));
                scrieLocal(corectii);
                ruleaza(false);
            }));
        document.querySelectorAll("#sc-alegeri button[data-desface]").forEach(b =>
            b.addEventListener("click", () => {
                comasari = comasari.filter(c => c.uat !== Number(b.dataset.desface));
                scrieLocal(corectii);
                ruleaza(false);
            }));
        $("#sc-stare-salvare").textContent = mesaj || (cod === null
            ? "Alege un județ și apasă „Arată scenariul”: districtele se reorganizează județ cu județ."
            : modificat() ? "Modificări nesalvate."
                : `${cate(corectii.length + comasari.length, "alegere salvată", "alegeri salvate")}, în toată țara.`);
        $("#sc-salveaza").disabled = !modificat();
        $("#sc-renunta").disabled = !modificat();
    }

    /** Clic pe hartă în editare: orașul devine țintă, comuna trece la districtul-țintă. */
    function alegeUat(idx) {
        const u = D.date.uat[idx];
        if (modEditare() === "comasare") {
            if (tintaComasare === null) {
                tintaComasare = u.s;
                deseneaza();
                deseneazaEditare(`Ținta: ${u.n}. Dă clic pe UAT-urile care se comasează cu ea.`);
                return;
            }
            if (tintaComasare === u.s) {
                tintaComasare = null;
                deseneaza();
                deseneazaEditare("Alege ținta: comuna sau orașul la care se alipesc celelalte.");
                return;
            }
            const avea = comasari.find(c => c.uat === u.s);
            comasari = comasari.filter(c => c.uat !== u.s);
            if (!avea || avea.cu !== tintaComasare) {
                comasari.push({ uat: u.s, cu: tintaComasare, nume: `${u.n} + ${numeSiruta(tintaComasare)}` });
            }
            scrieLocal(corectii);
            ruleaza(false);
            return;
        }
        if (u.t !== "comună") {
            $("#sc-tinta").value = String(u.s);
            deseneaza();
            deseneazaEditare(`Ținta: districtul ${u.n}. Dă clic pe comunele care trec la el.`);
            return;
        }
        const tinta = Number($("#sc-tinta").value);
        if (!tinta) {
            deseneazaEditare("Alege întâi orașul-reședință: din listă sau cu clic pe el, pe hartă.");
            return;
        }
        const avea = corectii.find(c => c.uat === u.s);
        corectii = corectii.filter(c => c.uat !== u.s);
        // al doilea clic pe aceeași comună, cu aceeași țintă, anulează alegerea
        if (!avea || avea.district !== tinta) {
            corectii.push({ uat: u.s, district: tinta, nume: `${u.n} → ${numeSiruta(tinta)}` });
        }
        scrieLocal(corectii);
        ruleaza(false);
    }

    /**
     * Salvarea: fișierul date/corectii-districte.json, prin serverul proiectului
     * (unelte/server.py). Pe un server care doar citește, alegerile rămân în browser și
     * se pot descărca, pentru a fi puse de mână în date/.
     */
    async function salveaza() {
        const corp = JSON.stringify({
            versiune: 1,
            descriere: "Alegerile voluntare: UAT-ul (cod SIRUTA) intră în districtul cu reședința în UAT-ul `district`.",
            corectii: corectii,
            comasari: comasari
        }, null, 1);
        let scris = false;
        try {
            const r = await fetch(CALE_CORECTII, {
                method: "PUT", headers: { "Content-Type": "application/json" }, body: corp
            });
            scris = r.ok;
        } catch (e) {
            scris = false;
        }
        if (scris) {
            corectiiSalvate = stare();
            scrieLocal(null);
            deseneazaEditare(`Salvat în ${CALE_CORECTII}: ${cate(corectii.length + comasari.length, "alegere", "alegeri")}.`);
        } else {
            scrieLocal(corectii);
            deseneazaEditare("Serverul nu acceptă scriere: alegerile rămân în acest browser. " +
                "Descarcă fișierul și pune-l în date/, sau pornește unelte/server.py.");
        }
    }

    function descarca() {
        const corp = JSON.stringify({ versiune: 1, corectii: corectii, comasari: comasari }, null, 1);
        const legatura = document.createElement("a");
        legatura.href = URL.createObjectURL(new Blob([corp], { type: "application/json" }));
        legatura.download = "corectii-districte.json";
        legatura.click();
        URL.revokeObjectURL(legatura.href);
    }

    function renunta() {
        const salvat = JSON.parse(corectiiSalvate);
        corectii = salvat.corectii || [];
        comasari = salvat.comasari || [];
        tintaComasare = null;
        scrieLocal(null);
        if (activ) ruleaza(false);
        else deseneazaEditare();
    }

    /**
     * Execuția bugetară însumată peste o listă de UAT-uri (indecși), din datele
     * Ministerului Finanțelor republicate ca JSON: venituri proprii, cheltuiala cu
     * aparatul, investiții, plăți restante.
     */
    function bani(indecsi) {
        if (!finante || !finante.executieUat) return null;
        let venituri = 0, aparat = 0, investitii = 0, total = 0, restante = 0, cu = 0;
        indecsi.forEach(i => {
            const e = finante.executieUat[D.date.uat[i].s];
            if (e) {
                venituri += e.venituriProprii || 0;
                aparat += e.cheltuieliAparat || 0;
                investitii += e.investitii || 0;
                total += e.cheltuieliTotal || 0;
                cu++;
            }
            const a = finante.arierateUat && finante.arierateUat[D.date.uat[i].s];
            if (a) restante += a;
        });
        if (!cu) return null;
        return {
            venituri: venituri, aparat: aparat, investitii: investitii, total: total,
            restante: restante, cu: cu,
            pondere: venituri ? 100 * aparat / venituri : null,
            pondereInvestitii: total ? 100 * investitii / total : null
        };
    }

    // ipoteza de cost (aceeași ca în raport): unitatea nouă păstrează aparatul
    // primăriei-reședință și un sfert din al fiecărei primării desființate, pentru
    // oficiile multifuncționale rămase în sate
    const COTA_BIROURI = 0.25;
    const ANI_PROIECTIE = [1, 5, 10, 25];

    const INFLATIE = 0.03;         // pentru economia cumulată pe 10 ani
    const ANI_ECONOMIE = 10;

    /**
     * Funcțiile de conducere dintr-un teritoriu, azi și după reorganizare.
     * Azi: primar și viceprimar în fiecare UAT (doi viceprimari în municipiile reședință
     * de județ — Codul administrativ, art. 148), iar în fiecare județ președintele și cei
     * doi vicepreședinți ai consiliului județean, prefectul și subprefectul.
     * După: primar și viceprimar în fiecare unitate nouă; conducerea județeană dispare.
     */
    function functiiConducere(indecsi, grupuri) {
        const judete = new Set(indecsi.map(i => D.date.uat[i].j));
        const resedinte = indecsi.filter(i => D.date.uat[i].r).length;
        const acum = 2 * indecsi.length + resedinte + 5 * judete.size;
        const resedinteDupa = grupuri.filter(g => g.membri.some(i => D.date.uat[i].r)).length;
        const dupa = 2 * grupuri.length + resedinteDupa;
        return { acum: acum, dupa: dupa, judete: judete.size };
    }

    /** Economia pe un an și cumulată pe ANI_ECONOMIE, cu inflație; primul an, pe jumătate. */
    function economieCuInflatie(economie) {
        let total = economie / 2;
        for (let an = 2; an <= ANI_ECONOMIE; an++) total += economie * Math.pow(1 + INFLATIE, an - 1);
        return total;
    }

    /** Fișa unei regiuni: ce e azi, ce devine și cât rămâne. */
    function fisaRegiunii(r, adr) {
        return fisaTeritoriu(r, r.uat.filter(i => D.date.uat[i].adr === adr.c));
    }

    /** Fișa unei mulțimi de UAT-uri (o regiune, un județ): azi și după reorganizare. */
    function fisaTeritoriu(r, indecsi) {
        if (!indecsi.length) return "";
        const setIndecsi = new Set(indecsi);
        const grupuri = r.grupuri.filter(g => setIndecsi.has(g.sediu));
        const populatie = indecsi.reduce((a, i) => a + (D.date.uat[i].p21 || 0), 0);
        const suprafata = indecsi.reduce((a, i) => a + (D.date.uat[i].a || 0), 0);
        const c = costAparat(grupuri);
        const f = functiiConducere(indecsi, grupuri);
        const rand = (et, acum, dupa) => `<tr><th scope="row">${et}</th><td>${acum}</td><td>${dupa}</td></tr>`;
        const districte = r.districte ? r.districte.filter(d => setIndecsi.has(d.sediu)).length : null;
        return `<table class="tabel-atribute tabel-comparatie">
                <thead><tr><th></th><th>azi</th><th>după</th></tr></thead>
                <tbody>
                    ${rand("Populație", NF.format(populatie), "aceeași")}
                    ${rand("Suprafață", NF.format(Math.round(suprafata)) + " km²", "aceeași")}
                    ${rand("Comune și orașe", NF.format(indecsi.length), NF.format(grupuri.length))}
                    ${rand("Nivel intermediar", `${f.judete} consilii județene`,
                        districte === null ? "—" : `${NF.format(districte)} districte`)}
                    ${rand("Funcții de conducere", NF.format(f.acum), NF.format(f.dupa))}
                    ${c ? rand("Cheltuieli administrative pe an", milioane(c.acum), milioane(c.dupa)) : ""}
                </tbody>
            </table>
            ${c ? `<p class="nota"><b>Economie: ${milioane(c.economie)} pe an</b> și
                <b>${milioane(economieCuInflatie(c.economie))} în ${ANI_ECONOMIE} ani</b>, cu o inflație de
                ${Math.round(INFLATIE * 100)}% pe an și cu primul an socotit pe jumătate, pentru tranziție.</p>` : ""}`;
    }

    /** Cheltuiala cu aparatul, acum și după comasare, pentru o listă de unități noi. */
    function costAparat(grupuri) {
        if (!finante || !finante.executieUat) return null;
        const al = i => finante.executieUat[D.date.uat[i].s];
        let acum = 0, dupa = 0, cu = 0;
        grupuri.forEach(g => {
            const ale = g.membri.map(al).filter(Boolean);
            if (!ale.length) return;
            cu += ale.length;
            acum += ale.reduce((a, e) => a + (e.cheltuieliAparat || 0), 0);
            const sediu = al(g.sediu);
            const altele = ale.filter(e => e !== sediu);
            dupa += (sediu ? sediu.cheltuieliAparat || 0 : Math.max(...ale.map(e => e.cheltuieliAparat || 0))) +
                COTA_BIROURI * altele.reduce((a, e) => a + (e.cheltuieliAparat || 0), 0);
        });
        if (!cu) return null;
        const economie = acum - dupa;
        return {
            acum: acum, dupa: dupa, economie: economie,
            proiectie: ANI_PROIECTIE.map(ani => ({
                ani: ani,
                // primul an se duce pe tranziție, pe jumătate; din al doilea, economia e întreagă
                cumulat: ani === 1 ? economie / 2 : economie / 2 + economie * (ani - 1)
            }))
        };
    }

    const milioane = v => v === null || v === undefined ? "—"
        : Math.abs(v) >= 1e9 ? `${NF1.format(v / 1e9)} mld. lei` : `${NF1.format(v / 1e6)} mil. lei`;

    // ordin de mărime pentru echivalențe: un kilometru de drum comunal modernizat
    // (Programul Anghel Saligny, valori medii de contract)
    const LEI_PE_KM_DRUM = 1800000;

    /**
     * Sumarul financiar al unui teritoriu: ce costă administrația azi, ce ar costa după
     * comasare și ce rămâne — pe locuitor, pe an și cumulat. E prima cifră pe care o
     * vede omul, pentru că e singura care îl privește direct.
     */
    function sumarFinanciar(indecsi, grupuri, titlu) {
        const b = bani(indecsi);
        const c = grupuri && grupuri.length ? costAparat(grupuri) : null;
        if (!b || !c) return "";
        const locuitori = indecsi.reduce((a, i) => a + (D.date.uat[i].p21 || 0), 0);
        const peCap = v => locuitori ? `${NF.format(Math.round(v / locuitori))} lei` : "—";
        const km = Math.round(c.economie / LEI_PE_KM_DRUM);
        const la25 = c.proiectie[c.proiectie.length - 1];
        return `<div class="sumar-financiar">
                <h3>${D.esc(titlu)}</h3>
                <div class="cifre">
                    <div class="cifra">
                        <span class="eticheta">administrația costă azi</span>
                        <b>${peCap(b.aparat)}</b>
                        <small>pe locuitor, pe an · ${milioane(b.aparat)} în total</small>
                    </div>
                    <div class="cifra">
                        <span class="eticheta">ar costa după reorganizare</span>
                        <b>${peCap(c.dupa)}</b>
                        <small>pe locuitor, pe an · ${milioane(c.dupa)} în total</small>
                    </div>
                    <div class="cifra castig">
                        <span class="eticheta">rămâne pentru servicii</span>
                        <b>${peCap(c.economie)}</b>
                        <small>pe locuitor, în fiecare an · ${milioane(c.economie)} în total</small>
                    </div>
                </div>
                <p class="nota">Adică, în fiecare an, cât ${km > 0 ? `<b>${NF.format(km)} km de drum comunal
                    modernizat</b>` : "o parte din investițiile de azi"} (ordin de mărime, la 1,8 mil. lei/km).
                    În ${la25.ani} de ani se adună <b>${milioane(la25.cumulat)}</b>, din care primul an se duce
                    pe jumătate pe tranziție. Banii nu dispar din teritoriu: se mută de la aparat la servicii,
                    pentru că impozitele rămân aceleași.</p>
            </div>`;
    }

    /** Tabelul de statistici financiare pentru un teritoriu (regiune, județ, district). */
    function tabelBani(indecsi, titlu, grupuri) {
        const b = bani(indecsi);
        if (!b) return "";
        const c = grupuri && grupuri.length ? costAparat(grupuri) : null;
        const rand = (et, val, nota) => `<tr><th scope="row">${et}</th><td>${val}
            ${nota ? `<small>${nota}</small>` : ""}</td></tr>`;
        const prag = finante.pragAdministratie || 30;
        return `<h3 class="subtitlu-sectiune">${titlu} <small class="nota">— execuția ${finante.anExecutie || ""}</small></h3>
            <table class="tabel-atribute">
                ${rand("Venituri proprii", milioane(b.venituri), `${NF.format(b.cu)} de primării cu date`)}
                ${rand("Cheltuieli totale", milioane(b.total))}
                ${rand("Aparat administrativ", milioane(b.aparat),
                    b.pondere === null ? "" : `${NF1.format(b.pondere)}% din veniturile proprii, prag ${prag}%`)}
                ${rand("Investiții", milioane(b.investitii),
                    b.pondereInvestitii === null ? "" : `${NF1.format(b.pondereInvestitii)}% din cheltuieli`)}
                ${rand("Plăți restante", b.restante ? milioane(b.restante) : "—",
                    finante.perioadaArierate ? "la " + finante.perioadaArierate : "")}
            </table>
            ${!c ? "" : `<table class="tabel-atribute">
                ${rand("Aparat administrativ, după comasare", milioane(c.dupa),
                    `ipoteză: reședința plus ${Math.round(COTA_BIROURI * 100)}% din fiecare primărie desființată`)}
                ${rand("Economie anuală", milioane(c.economie),
                    c.acum ? `${NF1.format(100 * c.economie / c.acum)}% din cheltuiala de azi` : "")}
                ${c.proiectie.map(x => rand(`Economie cumulată la ${x.ani} ${x.ani === 1 ? "an" : "ani"}`,
                    milioane(x.cumulat), x.ani === 1 ? "jumătate din primul an se duce pe tranziție" : "")).join("")}
            </table>`}`;
    }

    /** Plățile restante ale UAT-urilor dintr-o unitate propusă (date de la Ministerul Finanțelor). */
    function restante(g) {
        if (!finante || !finante.arierateUat) return "";
        const cu = g.membri
            .map(i => ({ nume: D.date.uat[i].n, lei: finante.arierateUat[D.date.uat[i].s] }))
            .filter(x => x.lei);
        if (!cu.length) return "";
        const total = cu.reduce((a, x) => a + x.lei, 0);
        return `<p class="nota"><b>Plăți restante</b> (Ministerul Finanțelor, ${D.esc(finante.perioadaArierate || "")}):
            ${NF.format(Math.round(total))} lei — ${cu.map(x => `${D.esc(x.nume)} ${NF.format(Math.round(x.lei))}`).join(", ")}.</p>`;
    }

    /** Leagă listele de niveluri: regiune → județe → districte. Se cheamă din ambele ramuri. */
    function legaNivele() {
        document.querySelectorAll("li[data-nivel-adr]").forEach(li => {
            const alege = () => {
                const cod = li.dataset.nivelAdr;
                $("#sc-exemplu").value = PREFIX_ADR + cod;
                marcheazaRegiunea(cod);
                seteazaNivel("judete");
                ruleaza(true);
            };
            li.addEventListener("click", alege);
            li.addEventListener("keydown", e => { if (e.key === "Enter") alege(); });
        });
        document.querySelectorAll("li[data-nivel-judet]").forEach(li => {
            const alege = () => {
                $("#sc-exemplu").value = li.dataset.nivelJudet;
                marcheazaRegiunea(null);
                seteazaNivel("districte");
                ruleaza(true);
            };
            li.addEventListener("click", alege);
            li.addEventListener("keydown", e => { if (e.key === "Enter") alege(); });
        });    }

    /**
     * Lista nivelului ales, cu clic pentru coborâre: regiunile duc la județe, județele la
     * districte, districtele la comunele comasate. Două–trei clicuri de la țară la sat.
     */
    function listaNivel(r) {
        const cheie = $("#sc-exemplu").value;
        const nf = v => NF.format(Math.round(v));
        if (nivel === "regiuni") {
            const pop = new Map();
            D.date.uat.forEach(u => pop.set(u.adr, (pop.get(u.adr) || 0) + (u.p21 || 0)));
            return `<h3 class="subtitlu-sectiune">Regiuni <small class="nota">— clic pentru județele ei</small></h3>
                <ol class="lista-grupuri">${D.date.adr.map((a, k) => `
                    <li data-nivel-adr="${a.c}" tabindex="0">
                        <span class="mostra f-c${k % 8}"></span>
                        <span class="grup-nume">${D.esc(a.n === "București-Ilfov" ? "București–Ilfov (Metropola)" : a.n)}</span>
                        <span class="numar">${nf(pop.get(a.c) || 0)}</span>
                        <span class="grup-detalii"><small>capitala: ${D.esc(a.resedinta)}</small>
                            ${fisaRegiunii(r, a)}</span>
                    </li>`).join("")}</ol>`;
        }
        if (nivel === "judete") {
            const inZona = j => cheie === TOATA_TARA || !cheie.startsWith(PREFIX_ADR) ||
                D.date.uat.some(u => u.j === j.c && u.adr === Number(cheie.slice(PREFIX_ADR.length)));
            const pop = new Map();
            D.date.uat.forEach(u => pop.set(u.j, (pop.get(u.j) || 0) + (u.p21 || 0)));
            const lista = D.date.judete.filter(inZona);
            return `<h3 class="subtitlu-sectiune">${cate(lista.length, "județ", "județe")}
                    <small class="nota">— clic pentru districtele lui</small></h3>
                <ol class="lista-grupuri">${lista.map((j, k) => `
                    <li data-nivel-judet="${j.c}" tabindex="0">
                        <span class="mostra f-c${(j.c - 1) % 8}"></span>
                        <span class="grup-nume">${D.esc(j.n)}</span>
                        <span class="numar">${nf(pop.get(j.c) || 0)}</span>
                    </li>`).join("")}</ol>`;
        }
        return "";
    }

    /** Microregiunile unui district: polii lui de dezvoltare, fiecare cu comunele sale. */
    function microregiuniDistrict(d, r) {
        if (!d.microregiuni || !d.microregiuni.length) return "";
        const randuri = d.microregiuni.map(m => {
            const nume = m.unitati.map(u => (r.grupuri.find(g => g.sediu === u) || {}).nume).filter(Boolean);
            return `<li><b>${D.esc(m.nume)}</b> <small>(${D.esc(m.tipPol)})</small> — ${NF.format(m.populatie)} loc.,
                din care ${NF.format(m.popLeader)} eligibili la LEADER
                ${m.inBanda ? "" : `<span class="eticheta-stare atentie">în afara pragului</span>`}
                <br><small>${nume.map(n => D.esc(n)).join(", ")}</small></li>`;
        }).join("");
        return `<h4 class="subtitlu-sectiune">${cate(d.microregiuni.length, "microregiune", "microregiuni")}
                <small class="nota">— câte un grup de acțiune locală în jurul fiecărui oraș</small></h4>
            <ul class="pasi-dosar">${randuri}</ul>`;
    }

    /** În ce grupuri de acțiune locală sunt azi UAT-urile unui district. */
    function galuriDistrict(indecsi) {
        if (!gal || !gal.uat) return "";
        const nume = new Map(gal.gal.map(g => [g.id, g.nume]));
        const pe = new Map();
        const fara = [];
        indecsi.forEach(i => {
            const g = gal.uat[D.date.uat[i].s];
            if (g === undefined) fara.push(i);
            else pe.set(g, (pe.get(g) || []).concat([i]));
        });
        const randuri = Array.from(pe).sort((a, b) => b[1].length - a[1].length).map(([g, lista]) =>
            `<li><b>${D.esc(nume.get(g) || String(g))}</b> — ${lista.map(i => D.esc(D.date.uat[i].n)).join(", ")}</li>`);
        if (fara.length) {
            randuri.push(`<li><b>În afara oricărui grup</b> — ${fara.map(i => D.esc(D.date.uat[i].n)).join(", ")}</li>`);
        }
        return `<h4 class="subtitlu-sectiune">Azi, la fonduri: ${cate(pe.size, "grup de acțiune locală", "grupuri de acțiune locală")}</h4>
            <ul class="pasi-dosar">${randuri.join("")}</ul>`;
    }

    /** Comunele comasate dintr-un district: ultima treaptă a navigării. */
    function comuneleDistrictului(r) {
        if (districtAles === null || !r.districte) return "";
        const d = r.districte.find(x => x.sediu === districtAles);
        if (!d) return "";
        const unitati = d.unitati.map(u => r.grupuri.find(g => g.sediu === u)).filter(Boolean);
        return `<div class="detalii" style="margin:10px 0">
            <h3>${D.esc(d.nume)} — ${cate(unitati.length, "comună sau oraș", "comune și orașe")}</h3>
            <div class="tip">${d.tip === "metropolitan" ? "zonă metropolitană"
                : "district rural, cu statutul zonei metropolitane"} ·
                ${NF.format(d.populatie)} loc. · drumul cel mai lung ${NF1.format(d.timpMax)} min</div>
            <table class="tabel-atribute tabel-dosar"><tbody>${(d.criterii || []).map(c => `
                <tr class="${c.stare === "derogare" ? "c-derogare" : ""}">
                    <th scope="row">${D.esc(c.nume)}</th>
                    <td>${D.esc(c.valoare)}</td>
                    <td><small>${c.stare === "derogare" ? `<span class="eticheta-stare atentie">neîndeplinit</span> ` : ""}${D.esc(c.prag)}</small></td>
                </tr>`).join("")}</tbody></table>
            ${microregiuniDistrict(d, r)}
            ${galuriDistrict(unitati.flatMap(g => g.membri))}
            ${(d.primite && d.primite.length) || (d.cuprinde && d.cuprinde.length) ? `<p class="nota">Ca să treacă
                pragul de 25.000 de locuitori, districtul ${d.primite.length ? `a primit de la vecini: <b>${d.primite.map(n => D.esc(n)).join(", ")}</b>` : ""}
                ${d.cuprinde.length ? `${d.primite.length ? "și " : ""}s-a unit cu districtul <b>${d.cuprinde.map(n => D.esc(n)).join(", ")}</b>` : ""}.</p>` : ""}
            <p class="nota">${d.manual ? "<b>Constituit și prin alegere voluntară.</b> " : ""}Districtul are un
                <b>grup de acțiune locală</b>: primarii lui, împreună cu firme, fermieri și asociații
                (niciun grup nu are majoritatea), cu birou de proiecte și întâlnire lunară cu primăriile.</p>
            ${tabelBani(unitati.flatMap(g => g.membri), "Banii districtului", unitati)}
            ${infrastructura(unitati.flatMap(g => g.membri), "Infrastructura esențială a districtului")}
            <ol class="lista-grupuri">${unitati.map(g => `
                <li data-sediu="${g.sediu}" tabindex="0">
                    <span class="mostra f-c${culoareGrup.get(g.sediu)}"></span>
                    <span class="grup-nume">${D.esc(g.nume)}${g.urban ? "" : " <small>(comună)</small>"}</span>
                    <span class="numar">${NF.format(g.populatie)}</span>
                    <span class="grup-detalii"><small>${g.membri.map(i => D.esc(D.date.uat[i].n)).join(", ")}</small></span>
                </li>`).join("")}</ol>
            <button id="sc-inapoi-district" class="buton" type="button">← înapoi la districte</button>
        </div>`;
    }

    /** Clic pe hartă, cât timp scenariul e activ: deschide dosarul unității atinse. */
    function clicPeHarta(idx) {
        if (!activ || !rezultat) return false;
        if (editare && !national && rezultat.grup.has(idx)) {
            alegeUat(idx);
            return true;
        }
        const u = D.date.uat[idx];
        if (nivel === "regiuni") {
            alegePoligon({ tip: "adr", cod: u.adr });
            return true;
        }
        if (nivel === "judete") {
            alegePoligon({ tip: "judet", cod: u.j });
            return true;
        }
        if (!rezultat.grup.has(idx)) return false;
        if (nivel === "districte" && rezultat.unitateDistrict) {
            const d = rezultat.unitateDistrict.get(rezultat.grup.get(idx));
            if (d !== undefined) {
                districtAles = d;
                afiseazaRezultat();
                $("#sc-rezultat").scrollIntoView({ block: "nearest" });
                return true;
            }
        }
        arataDosar(rezultat.grup.get(idx));
        return true;
    }

    /**
     * Alege o regiune sau un județ ca poligon: restul hărții se stinge, conturul se
     * îngroașă, iar în panou apare fișa lui, cu butonul de coborâre la nivelul următor.
     */
    function alegePoligon(nou) {
        const acelasi = ales && nou && ales.tip === nou.tip && ales.cod === nou.cod;
        ales = acelasi ? null : nou;
        deseneaza();
        const cont = $("#sc-dosar");
        if (!ales) {
            cont.hidden = true;
            return;
        }
        const r = rezultat;
        const esteAdr = ales.tip === "adr";
        const indecsi = r.uat.filter(i => esteAdr ? D.date.uat[i].adr === ales.cod : D.date.uat[i].j === ales.cod);
        const nume = esteAdr
            ? (D.date.adr.find(a => a.c === ales.cod) || {}).n
            : (D.date.judete.find(j => j.c === ales.cod) || {}).n;
        if (!indecsi.length) {
            cont.innerHTML = `<h3>${D.esc(nume || "")}</h3>
                <p class="nota">Teritoriul nu e în scenariul curent. Alege „toată țara” la teritoriu.</p>`;
            cont.hidden = false;
            return;
        }
        const setIndecsi = new Set(indecsi);
        const grupuri = r.grupuri.filter(g => setIndecsi.has(g.sediu));
        cont.innerHTML = `
            <h3>${D.esc(esteAdr && nume === "București-Ilfov" ? "București–Ilfov (Metropola)" : nume || "")}</h3>
            <div class="tip">${esteAdr ? "regiune" : "județ"} ·
                ${cate(new Set(indecsi.map(i => D.date.uat[i].j)).size, "județ", "județe")} ·
                ${cate(indecsi.length, "UAT", "UAT-uri")}</div>
            ${fisaTeritoriu(r, indecsi)}
            ${sumarFinanciar(indecsi, grupuri, "Ce costă administrația")}
            ${infrastructura(indecsi, "Infrastructura esențială")}
            <div class="butoane">
                <button id="sc-coboara" class="buton principal" type="button">${esteAdr
                    ? "Vezi județele regiunii" : "Vezi districtele județului"}</button>
                <button id="sc-dosar-inchide" class="buton" type="button">Închide</button>
            </div>`;
        cont.hidden = false;
        cont.scrollIntoView({ block: "nearest" });
        D.harta.zoomLa(indecsi, esteAdr ? 8 : 9);
        $("#sc-dosar-inchide").addEventListener("click", () => alegePoligon(null));
        $("#sc-coboara").addEventListener("click", () => {
            const cod = ales.cod;
            ales = null;
            cont.hidden = true;
            if (esteAdr) {
                $("#sc-exemplu").value = PREFIX_ADR + cod;
                marcheazaRegiunea(String(cod));
                seteazaNivel("judete");
            } else {
                $("#sc-exemplu").value = String(cod);
                marcheazaRegiunea(null);
                seteazaNivel("districte");
            }
            ruleaza(true);
        });
    }

    // ------------------------------------------------------------ panou
    function randIndicator(eticheta, inainte, dupa) {
        return `<tr><th scope="row">${eticheta}</th><td>${inainte}</td><td>${dupa}</td></tr>`;
    }

    function tabelIndicatori() {
        const a = rezultat.inainte, d = rezultat.dupa, P = rezultat.parametri;
        return `<table class="tabel-atribute tabel-comparatie">
                <thead><tr><th></th><th>acum</th><th>propus</th></tr></thead>
                <tbody>
                ${randIndicator("Unități administrative", NF.format(a.unitati), NF.format(d.unitati))}
                ${randIndicator(`Sub ${NF.format(P.pMin)} loc.`, NF.format(a.subPrag), NF.format(d.subPrag))}
                ${randIndicator(`Sub prag în ${P.anProiectie}`, NF.format(a.subPrag2050), NF.format(d.subPrag2050))}
                ${randIndicator("Sub 3.000 loc.", NF.format(a.sub3000), NF.format(d.sub3000))}
                ${randIndicator("Populația mediană", NF.format(a.mediana), NF.format(d.mediana))}
                ${randIndicator("Timp mediu sat → reședință", NF1.format(a.timpMediu) + " min", NF1.format(d.timpMediu) + " min")}
                ${randIndicator(`Sate peste ${P.tMax} min`, NF.format(a.pesteTMax), NF.format(d.pesteTMax))}
                </tbody>
            </table>`;
    }

    function legendaPuncte(P) {
        return `<ul class="legenda" style="margin:10px 0">
                <li><span class="mostra punct sediu"></span><span>reședința unității noi</span></li>
                <li><span class="mostra punct"></span><span>sat / localitate componentă</span></li>
                <li><span class="mostra punct atentie"></span><span>peste ${P.tMax} min de reședință</span></li>
                <li><span class="mostra punct serios"></span><span>candidat la transfer (linie punctată)</span></li>
            </ul>`;
    }

    /** Ce rămâne în afara calculului: Bucureștiul, plus județele fără date generate încă. */
    function neacoperite(r) {
        if (!r.neacoperite.length) return "";
        if (r.neacoperite.length === 1) return `; ${D.esc(D.date.uat[r.neacoperite[0]].n)} rămâne neschimbat`;
        return `; ${cate(r.neacoperite.length, "UAT rămâne neschimbat", "UAT-uri rămân neschimbate")} (județe fără date generate)`;
    }

    /** Unde suntem: țară → regiune → județ → district. */
    function firulNavigarii(r) {
        const cheie = $("#sc-exemplu").value;
        const pasi = [`<button type="button" data-sari="tara" class="pas">România</button>`];
        if (cheie.startsWith(PREFIX_ADR)) {
            pasi.push(`<span class="pas-activ">${D.esc(numeTeritoriu().replace("regiunii ", ""))}</span>`);
        } else if (cheie !== TOATA_TARA) {
            const j = judete.find(x => String(x.cod) === cheie);
            const adr = j && D.date.uat.find(u => u.j === j.cod);
            const regiune = adr && D.date.adr.find(x => x.c === adr.adr);
            if (regiune) {
                pasi.push(`<button type="button" data-sari="adr:${regiune.c}" class="pas">${D.esc(regiune.n)}</button>`);
            }
            pasi.push(`<span class="pas-activ">${D.esc(j ? j.nume : "")}</span>`);
            if (districtAles !== null && r.districte) {
                const d = r.districte.find(x => x.sediu === districtAles);
                if (d) pasi.push(`<span class="pas-activ">${D.esc(d.nume)}</span>`);
            }
        }
        return `<nav class="fir-navigare">${pasi.join('<span class="separator">›</span>')}</nav>`;
    }

    function afiseazaRezultat() {
        const r = rezultat;
        const P = r.parametri;
        sincronizeazaCascada();
        deseneazaEditare();
        $("#sc-dosar").hidden = true;   // dosarul de dinainte nu mai e valabil
        const birouri = r.grupuri.reduce((s, g) => s + g.birouri.length, 0);
        const transferuri = r.sate.filter(s => s.transfer).length;
        const rezumat = `<p class="nota" style="margin-top:8px">Sate cu delegat sătesc ales (Codul administrativ, art. 142) și fond propriu: <b>${NF.format(r.sate.length)}</b>, dintre care <b>${NF.format(birouri)}</b> foste reședințe la peste ${P.tBirou} min de noua reședință, deci și cu birou permanent. Sate care ar sta mai bine în unitatea vecină: <b>${NF.format(transferuri)}</b>.</p>`;

        const proiect = !final ? "" : `
            <div class="detalii" style="margin:10px 0">
                <h3>Proiectul de reorganizare, pe trei niveluri</h3>
                <table class="tabel-atribute">
                    <tr><th scope="row">Unități de bază</th><td>${NF.format(r.inainte.unitati)} → <b>${NF.format(r.dupa.unitati)}</b> comune și orașe</td></tr>
                    <tr><th scope="row">Districte</th><td>${r.districte ? NF.format(r.districte.length) : "—"},
                        din care ${r.districte ? NF.format(r.districte.filter(x => x.tip === "metropolitan").length) : "—"} zone metropolitane</td></tr>
                    <tr><th scope="row">Regiuni</th><td>${regiuni ? NF.format(regiuni.length) : "—"} —
                        cele de dezvoltare de azi, cu București–Ilfov ca Metropolă</td></tr>
                    <tr><th scope="row">Consilii județene</th><td>desființate; atribuțiile trec la districte și la regiune</td></tr>
                    <tr><th scope="row">Sate cu delegat și fond propriu</th><td>${NF.format(r.sate.length)}</td></tr>
                </table>
                <p class="nota">Straturile, de jos în sus: <b>fundalul</b> dă regiunea (fiecare regiune
                    are tonul ei, fiecare unitate nuanța ei),
                    <b style="color:var(--limita-adr-culoare)">conturul gros albastru</b> limitele regiunilor,
                    <b style="color:var(--limita-judet-culoare)">linia întreruptă roșie</b> județele de azi,
                    <b style="color:var(--limita-district-culoare)">conturul portocaliu</b> districtele, iar
                    <b>linia subțire</b> comunele comasate. Cifrele complete și impactul financiar:
                    <a href="raport.html">raportul comparativ</a>.</p>
            </div>`;

        const statistici = !r.districte || !r.districte.length ? "" : (() => {
            const d = r.districte;
            const pop = d.reduce((a, x) => a + x.populatie, 0);
            const metro = d.filter(x => x.tip === "metropolitan");
            const unitati = d.reduce((a, x) => a + x.nrUnitati, 0);
            const inPrag = d.filter(x => x.praguriUE && x.praguriUE.potrivit).length;
            const peRegula = d.filter(x => x.respectaRegula).length;
            const tMaxim = Math.max(...d.map(x => x.timpMax).filter(isFinite), 0);
            const rand = (et, val, nota) => `<tr><th scope="row">${et}</th><td>${val}
                ${nota ? `<small>${nota}</small>` : ""}</td></tr>`;
            return `${tabelBani(r.uat, "Banii " + numeTeritoriu(), r.grupuri)}
                <h3 class="subtitlu-sectiune">Districtele ${D.esc(numeTeritoriu())}</h3>
                <table class="tabel-atribute">
                    ${rand("Districte", NF.format(d.length), `${NF.format(metro.length)} metropolitane, ${NF.format(d.length - metro.length)} rurale`)}
                    ${rand("Populația medie", NF.format(Math.round(pop / d.length)), `cea mai mare ${NF.format(d[0].populatie)}, cea mai mică ${NF.format(d[d.length - 1].populatie)}`)}
                    ${rand("Unități de bază", NF.format(unitati), `${NF1.format(unitati / d.length)} de district în medie`)}
                    ${rand("Drumul cel mai lung la reședința de district", NF1.format(tMaxim) + " min")}
                    ${rand("Îndeplinesc toate criteriile", `${NF.format(peRegula)} din ${NF.format(d.length)}`, "reședință oraș, cel puțin o comună asociată, 25.000 loc., teritoriu continuu")}
                    ${rand("Se încadrează în pragurile europene", `${NF.format(inPrag)} din ${NF.format(d.length)}`, "LEADER pe comune și orașe mici, 10.000–150.000 loc.; orașele peste 20.000, pe strategia urbană")}
                    ${rand("Constituite și prin alegere voluntară", NF.format(d.filter(x => x.manual).length))}
                </table>`;
        })();

        const districte = !r.districte ? "" : `
            <h3 class="subtitlu-sectiune">Nivelul intermediar: ${cate(r.districte.length, "district", "districte")}
                <small class="nota">— ${$("#sc-baza").value === "judecatorii" && judecatorii ? "circumscripțiile judecătoriilor, "
                    : $("#sc-baza").value === "gal" && gal ? "teritoriile grupurilor de acțiune locală, " : ""}conduse de consiliul primarilor, cu vot ponderat</small></h3>
            <ol class="lista-grupuri">${r.districte.slice(0, national ? 40 : 60).map(p => `
                <li data-district="${p.sediu}" tabindex="0" class="${districtAles === p.sediu ? "selectat" : ""}">
                    <span class="mostra"></span>
                    <span class="grup-nume">${D.esc(p.nume)}</span>
                    <span class="numar">${NF.format(p.populatie)}</span>
                    <span class="grup-detalii">${cate(p.nrUnitati, "unitate", "unități")} ·
                        reședință ${NF.format(p.popSediu)} loc. · drum max ${NF1.format(p.timpMax)} min
                        ${p.tip === "metropolitan" ? `<span class="eticheta-stare">zonă metropolitană</span>` : ""}
                        ${p.manual ? `<span class="eticheta-stare">alegere voluntară</span>` : ""}
                        ${p.praguriUE && !p.praguriUE.potrivit ? `<span class="eticheta-stare atentie" title="Pragul LEADER / DLRC pentru un grup de acțiune locală">${D.esc(p.praguriUE.nota)}</span>` : ""}
                        ${p.respectaRegula ? "" : `<span class="eticheta-stare atentie">${D.esc(p.motive.join(", "))}</span>`}
                    </span>
                </li>`).join("")}</ol>`;

        if (national) {
            const numeJudet = cod => (judete.find(x => x.cod === cod) || {}).nume || D.numeJudet(cod);
            const randuri = r.judete.slice().sort((a, b) => b.inainte.unitati - a.inainte.unitati).map(j => `
                <tr data-cod="${j.judet}" tabindex="0">
                    <th scope="row">${D.esc(numeJudet(j.judet))}</th>
                    <td>${NF.format(j.inainte.unitati)} → <b>${NF.format(j.dupa.unitati)}</b></td>
                    <td>${NF.format(j.dupa.subPrag)}</td>
                    <td>${NF1.format(j.dupa.timpMediu)}</td>
                </tr>`).join("");
            $("#sc-rezultat").innerHTML = `
                ${firulNavigarii(r)}
                ${sumarFinanciar(r.uat, r.grupuri, "Ce costă administrația " + numeTeritoriu())}
                ${proiect}
                ${listaNivel(r)}
                ${statistici}
                ${districte}
                ${tabelIndicatori()}
                ${rezumat}
                <p class="nota">${cate(r.judete.length, "județ calculat", "județe calculate")}${neacoperite(r)}. Satele nu se desenează la scara țării — alege un județ pentru detalii.</p>
                <h3 class="subtitlu-sectiune">Pe județe (clic pentru detalii)</h3>
                <div class="tabel-derulant"><table class="tabel-atribute tabel-comparatie tabel-judete">
                    <thead><tr><th>Județ</th><th>UAT</th><th>sub prag</th><th>timp mediu</th></tr></thead>
                    <tbody>${randuri}</tbody>
                </table></div>`;
            legaNivele();
            document.querySelectorAll(".tabel-judete tr[data-cod]").forEach(tr => {
                const alege = () => {
                    $("#sc-exemplu").value = tr.dataset.cod;
                    ruleaza(true);
                };
                tr.addEventListener("click", alege);
                tr.addEventListener("keydown", e => { if (e.key === "Enter") alege(); });
            });
            return;
        }

        $("#sc-rezultat").innerHTML = `
            ${firulNavigarii(r)}
            ${sumarFinanciar(r.uat, r.grupuri, "Ce costă administrația " + numeTeritoriu())}
            ${listaNivel(r)}
            ${statistici}
            ${comuneleDistrictului(r)}
            ${districte}
            ${tabelIndicatori()}
            ${rezumat}
            ${legendaPuncte(P)}
            <h3 class="subtitlu-sectiune">Unitățile propuse (${r.grupuri.length}) <small class="nota">— clic pentru dosarul complet</small></h3>
            <ol class="lista-grupuri">${r.grupuri.map(g => `
                <li data-sediu="${g.sediu}" tabindex="0">
                    <span class="mostra f-c${culoareGrup.get(g.sediu)}"></span>
                    <span class="grup-nume">${D.esc(g.nume)}${g.urban ? "" : " <small>(comună)</small>"}</span>
                    <span class="numar">${NF.format(g.populatie)}</span>
                    <span class="grup-detalii">${g.membri.length} UAT · ${g.nrSate} sate · ${NF1.format(g.timpMediu)} / ${NF1.format(g.timpMax)} min
                        ${g.subPrag ? `<span class="eticheta-stare atentie" title="Comasarea cu vecinii e blocată de: ${D.esc(g.motive.join(", "))}">sub prag: ${D.esc(g.motive.join(", "))}</span>` : ""}
                        ${g.riscMinoritate.length ? `<span class="eticheta-stare atentie">minoritate &lt; ${P.pragMinoritate}%</span>` : ""}
                        ${g.istorice.length > 1 ? `<span class="eticheta-stare" title="${D.esc(g.istorice.join(" + "))}">regiuni istorice diferite</span>` : ""}
                        <br><small>${g.membri.map(i => D.esc(D.date.uat[i].n)).join(", ")}</small>
                    </span>
                </li>`).join("")}
            </ol>`;
        legaNivele();
        document.querySelectorAll("li[data-district]").forEach(li => {
            const alege = () => {
                const sediu = Number(li.dataset.district);
                districtAles = districtAles === sediu ? null : sediu;
                if (districtAles !== null) seteazaNivel("comune");
                const d = r.districte.find(x => x.sediu === districtAles);
                if (d) {
                    const uat = [];
                    d.unitati.forEach(u => r.uat.forEach(i => { if (r.grup.get(i) === u) uat.push(i); }));
                    D.harta.zoomLa(uat, 11);
                }
                afiseazaRezultat();
            };
            li.addEventListener("click", alege);
            li.addEventListener("keydown", e => { if (e.key === "Enter") alege(); });
        });
        const inapoi = $("#sc-inapoi-district");
        if (inapoi) inapoi.addEventListener("click", () => {
            districtAles = null;
            D.harta.zoomLa(r.uat, 9);
            afiseazaRezultat();
        });
        document.querySelectorAll(".fir-navigare button[data-sari]").forEach(b =>
            b.addEventListener("click", () => {
                const tinta = b.dataset.sari;
                districtAles = null;
                $("#sc-exemplu").value = tinta === "tara" ? TOATA_TARA : tinta;
                marcheazaRegiunea(tinta.startsWith(PREFIX_ADR) ? tinta.slice(PREFIX_ADR.length) : null);
                ruleaza(true);
            }));

        document.querySelectorAll(".lista-grupuri li[data-sediu]").forEach(li => {
            const alege = () => {
                const s = Number(li.dataset.sediu);
                D.harta.zoomLa(r.uat.filter(i => r.grup.get(i) === s), 12);
                arataDosar(s);
            };
            li.addEventListener("click", alege);
            li.addEventListener("keydown", e => { if (e.key === "Enter") alege(); });
        });
    }

    function tooltipScenariu(idx) {
        if (!activ || !rezultat || !rezultat.grup.has(idx)) return "";
        const g = rezultat.grupuri.find(x => x.sediu === rezultat.grup.get(idx));
        return `<div class="rand"><span>Unitate nouă</span><b>${D.esc(g.nume)}</b></div>
            <div class="rand"><span>Populația unității noi</span><b>${NF.format(g.populatie)}</b></div>`;
    }

    /** Scurtături: un clic pe o regiune arată districtele ei, cu statistici. */
    function completeazaRegiuni() {
        const cont = $("#sc-regiuni");
        if (!cont) return;
        cont.innerHTML = D.date.adr.map(a => {
            const nume = a.n === "București-Ilfov" ? "București–Ilfov" : a.n;
            return `<button type="button" data-adr="${a.c}" aria-pressed="false">${D.esc(nume)}</button>`;
        }).join("") + `<button type="button" data-adr="" aria-pressed="false">toată țara</button>`;
        cont.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
            const cod = b.dataset.adr;
            $("#sc-exemplu").value = cod ? PREFIX_ADR + cod : TOATA_TARA;
            $("#sc-district").checked = true;
            final = false;
            regiuni = null;
            marcheazaRegiunea(cod);
            ruleaza(true);
        }));
    }

    function marcheazaRegiunea(cod) {
        document.querySelectorAll("#sc-regiuni button").forEach(b =>
            b.setAttribute("aria-pressed", String(b.dataset.adr === (cod || ""))));
    }

    function completeazaJudete() {
        const sel = $("#sc-exemplu");
        const regiuni = D.date.adr.map(r => {
            const n = judeteleAdr(r.c).length;
            return n ? `<option value="${PREFIX_ADR}${r.c}">${D.esc(r.n)} (${cate(n, "județ", "județe")})</option>` : "";
        }).join("");
        sel.innerHTML = `<option value="${TOATA_TARA}">Toată țara (${cate(judete.length, "județ", "județe")})</option>` +
            `<optgroup label="Regiuni de dezvoltare">${regiuni}</optgroup>` +
            `<optgroup label="Județe">${judete.map(j => `<option value="${j.cod}">${D.esc(j.nume)}</option>`).join("")}</optgroup>`;
        const implicit = judete.find(j => j.nume === "Sibiu");
        if (implicit) sel.value = String(implicit.cod);
    }

    /** @param context de la AdpAplicatie: { date, topo, vecini, harta, topologie, reorganizare, esc, ... } */
    function initializeaza(context) {
        D = context;
        vecini = D.vecini;
        perechiBune = new Set(D.date.culori.perechi || []);
        strat = D.harta.stratNou("puncte");
        stratLimite = D.harta.stratNou("limite");
        stratAles = D.harta.stratNou("limite");
        stratNume = D.harta.stratNou("puncte");
        D.adaugaTooltip(tooltipScenariu);
        D.adaugaClic(clicPeHarta);
        ["#sc-pmin", "#sc-tmax", "#sc-oras", "#sc-pmax", "#sc-tfortat"].forEach(id => $(id).addEventListener("input", () => {
            actualizeazaEtichete();
            if (activ) ruleaza(false);
        }));
        ["#sc-urban", "#sc-minoritati", "#sc-proiectie", "#sc-fortare", "#sc-legal", "#sc-istorice", "#sc-district", "#sc-baza"]
            .forEach(id => $(id).addEventListener("change", () => {
                actualizeazaEtichete();
                if (activ) ruleaza(false);
            }));
        $("#sc-exemplu").addEventListener("change", () => {
            const cheie = $("#sc-exemplu").value;
            marcheazaRegiunea(cheie.startsWith(PREFIX_ADR) ? cheie.slice(PREFIX_ADR.length) : null);
            if (activ) ruleaza(true);
        });
        // „Arată scenariul” arată exact ce e ales în cascadă: regiunea cu județele ei,
        // județul cu zonele lui, zona cu comunele ei
        $("#sc-ruleaza").addEventListener("click", () => {
            final = false;
            regiuni = null;
            const regiune = $("#sc-regiune").value, judet = $("#sc-judet").value, zona = $("#sc-zona").value;
            $("#sc-exemplu").value = judet || (regiune ? PREFIX_ADR + regiune : TOATA_TARA);
            const pastrat = zona && judet ? Number(zona) : null;
            seteazaNivel(pastrat !== null ? "comune" : judet ? "districte" : regiune ? "judete" : "regiuni");
            ultimulTeritoriu = $("#sc-exemplu").value;   // zona aleasă rămâne aleasă
            districtAles = pastrat;
            ruleaza(true);
        });
        $("#sc-final").addEventListener("click", hartaFinala);
        document.querySelectorAll("input[name=nivel]").forEach(radio =>
            radio.addEventListener("change", () => {
                // districtele au nevoie de calculul lor; restul se redesenează pe loc
                if (radio.value === "districte" && !$("#sc-district").checked) {
                    $("#sc-district").checked = true;
                    nivel = radio.value;
                    if (activ) ruleaza(false);
                    return;
                }
                if (radio.value === "regiuni" && $("#sc-exemplu").value !== TOATA_TARA) {
                    $("#sc-exemplu").value = TOATA_TARA;
                    nivel = radio.value;
                    ruleaza(true);
                    return;
                }
                seteazaNivel(radio.value, true);
                if (!activ) ruleaza(true);
            }));
        $("#sc-inchide").addEventListener("click", inchide);
        $("#sc-editeaza").addEventListener("click", () => {
            editare = !editare;
            // editarea se face pe districte, cu limitele lor la vedere
            if (editare && activ && nivel !== "districte" && nivel !== "comune") seteazaNivel("districte", true);
            else if (activ) deseneaza();
            deseneazaEditare();
        });
        $("#sc-tinta").addEventListener("change", () => { if (activ) deseneaza(); });
        document.querySelectorAll("input[name=sc-mod-editare]").forEach(radio => radio.addEventListener("change", () => {
            tintaComasare = null;
            if (activ) deseneaza();
            deseneazaEditare();
        }));
        D.harta.laSchimbareVedere(() => { if (activ) deseneazaNumeDistricte(); });
        $("#sc-salveaza").addEventListener("click", salveaza);
        $("#sc-renunta").addEventListener("click", renunta);
        $("#sc-descarca").addEventListener("click", descarca);
        document.querySelectorAll("input[name=mod]").forEach(r => r.addEventListener("change", () => {
            if (activ) inchide();
        }));
        actualizeazaEtichete();
        fetch(CALE_DOTARI).then(r => r.ok ? r.json() : null).then(j => { dotari = j; }).catch(() => {
            console.warn(`[ro-adp] "${CALE_DOTARI}" nu a putut fi încărcat. Rulează unelte/dotari.py.`);
        });
        fetch(CALE_FINANTE).then(r => r.ok ? r.json() : null).then(j => { finante = j; }).catch(() => {
            console.warn(`[ro-adp] "${CALE_FINANTE}" nu a putut fi încărcat. Rulează unelte/finante.py.`);
        });
        fetch(CALE_GAL).then(r => r.ok ? r.json() : null).then(j => { gal = j; }).catch(() => {
            console.warn(`[ro-adp] "${CALE_GAL}" nu a putut fi încărcat. Rulează unelte/gal.py.`);
        });
        fetch(CALE_JUDECATORII).then(r => r.ok ? r.json() : null).then(j => { judecatorii = j; }).catch(() => {
            console.warn(`[ro-adp] "${CALE_JUDECATORII}" nu a putut fi încărcat. Rulează unelte/judecatorii.py.`);
        });
        fetch(CALE_INFRA).then(r => r.ok ? r.json() : null).then(j => { infra = j; }).catch(() => {
            console.warn(`[ro-adp] "${CALE_INFRA}" nu a putut fi încărcat. Rulează unelte/infrastructura.py.`);
        });
        // alegerile voluntare: fișierul e baza, copia din browser sunt modificările nesalvate
        fetch(CALE_CORECTII, { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(j => {
            corectii = curata(j && j.corectii);
            comasari = curataComasari(j && j.comasari);
            corectiiSalvate = stare();
            const local = citesteLocal();
            if (local) {
                corectii = local.corectii;
                comasari = local.comasari;
            }
        }).catch(() => {
            console.warn(`[ro-adp] "${CALE_CORECTII}" nu a putut fi încărcat; se pornește fără alegeri voluntare.`);
            const local = citesteLocal();
            if (local) {
                corectii = local.corectii;
                comasari = local.comasari;
            }
        });
        fetch(CALE_INDEX).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        }).then(j => {
            judete = j.judete;
            completeazaJudete();
            completeazaRegiuni();
            leagaCascada();
            sincronizeazaCascada();
        }).catch(e => {
            console.warn(`[e-ro-adp] "${CALE_INDEX}" nu a putut fi încărcat (${e.message}). Rulează unelte/accesibilitate.py.`);
            $("#sc-exemplu").innerHTML = `<option>— lipsesc datele de accesibilitate —</option>`;
            $("#sc-ruleaza").disabled = true;
        });
    }

    return {
        initializeaza: initializeaza
    };
}();
