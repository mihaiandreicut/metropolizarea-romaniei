/* ============================================================================
   e-ro-adp — stratul „Regiuni — simulare” (index.html): nivelul al doilea al
   reorganizării, județele grupate în regiuni.

   Pe hartă: regiunile generate, capitalele lor și rețelele de instituții cu
   circumscripție regională care există deja (curți de apel, camere ale
   notarilor publici, direcții regionale ale finanțelor, agenții de dezvoltare
   — date/regiuni-institutii.json). Peste ele, indicatorii care arată
   dezechilibrul: populație, PIB pe locuitor, câștig pe oră lucrată, distanța
   până la capitală.

   În varianta simulată regiunea e nivelul ales — la ea se asimilează consiliul
   județean și prefectura —, iar județul rămâne doar cu un singur oficiu, bine
   organizat, pentru serviciile deconcentrate și controlul de legalitate.

   Modul independent: tot ce folosește (date, hartă, topologie, algoritmul de
   regionalizare) vine prin contextul primit în initializeaza(context).
   ========================================================================== */
window.AdpRegiuni = function() {
    "use strict";

    const CALE = "date/regiuni-institutii.json";
    const VARIANTE = [8, 12, 16];
    // variantele fixe: rețele de circumscripții care există deja, nu calculate
    const FIXE = [
        { cod: "judete", eticheta: "Azi: 41 de județe și București" },
        { cod: "adr", eticheta: "8 regiuni de dezvoltare (propunerea)" },
        { cod: "curte-apel", eticheta: "Curțile de apel, cu Metropola" }
    ];
    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 });
    const SIMBOL = {
        "curte-apel": { eticheta: "curte de apel", token: "--serie-1" },
        "camera-notari": { eticheta: "cameră a notarilor", token: "--serie-3" },
        "dgrfp": { eticheta: "direcție regională a finanțelor", token: "--serie-5" },
        "adr": { eticheta: "agenție de dezvoltare regională", token: "--serie-7" }
    };

    let D = null;              // contextul de la AdpAplicatie
    let institutii = null;     // conținutul date/regiuni-institutii.json
    let judete = [];           // județele, cu populație, economie, centru, reședință
    let veciniJudet = null;    // Map cod județ -> [coduri vecine]
    let rezultat = null;
    let culoare = new Map();
    let retele = null;         // rețelele de instituții bifate
    let selectata = null;
    let activ = false;
    let strat = null;
    let stratLimite = null;

    const $ = sel => document.querySelector(sel);
    const codJudet = idx => D.date.uat[idx].j;

    /** Numeral + substantiv, cu „de” unde o cere româna. */
    function cate(n, singular, plural) {
        if (n === 1) return `1 ${singular}`;
        const rest = n % 100;
        return `${NF.format(n)} ${n && (rest === 0 || rest >= 20) ? "de " : ""}${plural}`;
    }

    // ------------------------------------------------------------ pregătirea datelor
    function pregateste() {
        const pregatit = D.regionalizare.pregatesteJudete(D.date, D.vecini, institutii);
        judete = pregatit.judete;
        veciniJudet = pregatit.vecini;
    }

    function parametri() {
        return {
            nrRegiuni: Number($("#rg-nr").value),
            lambdaPopulatie: Number($("#rg-pop").value),
            lambdaEconomic: Number($("#rg-eco").value),
            echilibruEconomic: Number($("#rg-eco").value) > 0,
            capitalaInstitutionala: $("#rg-institutii").checked,
            respectaIstorice: $("#rg-istorice").checked
        };
    }

    const varianta = () => $("#rg-varianta").value;

    /** O variantă: calculată de algoritm sau una fixă (curțile de apel, regiunile de dezvoltare). */
    function variantaRezultat(cod) {
        if (cod === "calculata") return D.regionalizare.calculeaza(judete, veciniJudet, institutii.sisteme, parametri());
        if (cod === "judete") return D.regionalizare.judeteAzi(judete, institutii.sisteme, parametri());
        const r = D.regionalizare.dinCircumscriptii(judete, veciniJudet, institutii.sisteme, cod, parametri());
        if (r && cod === "adr") {
            // regiunile de dezvoltare se cunosc după nume, nu după orașul agenției
            r.regiuni.forEach(x => {
                if (x.metropola) return;
                const a = D.date.adr.find(z => z.c === (judete.find(j => j.c === x.capitala) || {}).adr);
                if (a) x.nume = `${a.n} (${x.nume})`;
            });
        }
        return r;
    }

    /** Consilierii regionali ai unei variante: scara art. 171, la dublul populației, plus un președinte pe regiune. */
    function consilieri(r) {
        const INST = window.AdpInstitutii, R = window.AdpReorganizare;
        if (!INST || !R) return null;
        if (r.azi) {
            // azi: consilierii județeni (art. 171) și președinții consiliilor județene; Bucureștiul are regulile lui
            const azi = INST.consilieriJudeteni(D.date);
            return { locuri: Array.from(azi.values()).reduce((a, n) => a + n, 0), presedinti: azi.size, peRegiune: azi };
        }
        const c = INST.consiliiRegionale(D.date, R.FACTOR_CONSILIERI,
            r.regiuni.map(x => ({ cod: x.capitala, nume: x.nume, judete: x.judete })));
        return { locuri: c.reduce((a, x) => a + x.locuri, 0), presedinti: c.length, peRegiune: new Map(c.map(x => [x.cod, x.locuri])) };
    }

    function ruleaza() {
        const fixa = varianta() !== "calculata";
        $("#rg-parametri").hidden = fixa;
        rezultat = variantaRezultat(varianta());
        const vecineleRegiunii = cap => {
            const set = new Set();
            rezultat.regiuni.find(r => r.capitala === cap).judete.forEach(c =>
                (veciniJudet.get(c) || []).forEach(n => {
                    const alta = rezultat.judetRegiune.get(n);
                    if (alta !== undefined && alta !== cap) set.add(alta);
                }));
            return Array.from(set);
        };
        culoare = D.topologie.coloreaza(rezultat.regiuni.map(r => r.capitala), vecineleRegiunii,
            (a, b) => a !== b, 8);
        if (selectata && !rezultat.regiuni.some(r => r.capitala === selectata)) selectata = null;
        deseneaza();
        randeazaPanou();
    }

    // ------------------------------------------------------------ hartă
    function stil(idx) {
        if (!rezultat) return "--neutru-harta";
        const cap = rezultat.judetRegiune.get(codJudet(idx));
        if (cap === undefined) return "--neutru-harta";
        if (selectata !== null && cap !== selectata) return "--neutru-harta";
        return `--serie-${culoare.get(cap) + 1}`;
    }

    function deseneaza() {
        D.harta.coloreaza(stil);
        strat.clearLayers();
        stratLimite.clearLayers();
        if (!rezultat) return;

        // limitele regiunilor, din arcele dintre județe cu regiuni diferite
        const plasa = D.topologie.plasa(D.topo, u => {
            const cap = rezultat.judetRegiune.get(u.j);
            return cap === undefined ? -1 : cap;
        }, false);
        D.harta.linii(plasa, { token: "--limita-regiune", weight: 2.6 }).addTo(stratLimite);

        // instituțiile existente, pe rețele
        institutii.sisteme.filter(s => retele.has(s.cod)).forEach(s => {
            s.sedii.forEach(sediu => {
                if (!sediu.e) return;
                const m = D.harta.punct(sediu.e, {
                    radius: 5,
                    tokenContur: "--suprafata",
                    weight: 1.4,
                    tokenUmplere: SIMBOL[s.cod] ? SIMBOL[s.cod].token : "--text",
                    fillOpacity: 1
                });
                m.bindTooltip(`<strong>${D.esc(sediu.nume)}</strong><br>${D.esc(s.nume)}<br>` +
                    `${cate(sediu.judete.length, "județ", "județe")} în circumscripție`, { direction: "top" });
                m.addTo(strat);
            });
        });

        // capitalele propuse
        rezultat.regiuni.forEach(r => {
            const j = judete.find(x => x.c === r.capitala);
            D.harta.punct(j.oras.e, {
                radius: 8, tokenContur: "--text", weight: 2.5,
                tokenUmplere: "--suprafata", fillOpacity: 1
            }).addTo(strat);
            D.harta.eticheta(j.oras.e, D.esc(r.nume), "e-scenariu").addTo(strat);
        });
    }

    // ------------------------------------------------------------ panou
    function randIndicator(eticheta, valoare, nota) {
        return `<tr><th scope="row">${eticheta}</th><td>${valoare}${nota ? ` <small>${nota}</small>` : ""}</td></tr>`;
    }

    function randeazaPanou() {
        const I = rezultat.indicatori;
        const P = rezultat.parametri;
        const cons = consilieri(rezultat);
        const acum = institutii.sisteme.find(s => s.cod === "adr");
        const tabel = `<table class="tabel-atribute">
                ${rezultat.azi ? randIndicator("Județe", NF.format(I.nrRegiuni), "41 de județe și municipiul București")
                    : randIndicator("Regiuni", NF.format(I.nrRegiuni), `față de 42 de județe azi (cu Bucureștiul) și ${acum.sedii.length} regiuni de dezvoltare`)}
                ${randIndicator("Populația medie a unei regiuni", NF.format(Math.round(I.populatieMedie)))}
                ${randIndicator("Cea mai mare / cea mai mică", NF1.format(I.raportPopulatie) + "×", "ca populație")}
                ${randIndicator("PIB pe locuitor: max / min", I.raportPibLoc ? NF1.format(I.raportPibLoc) + "×" : "—", "între regiuni")}
                ${randIndicator("Drum până la capitala regiunii", NF.format(Math.round(I.minuteMediu)) + " min", `în medie · maxim ${NF.format(Math.round(I.kmMax))} km`)}
                ${randIndicator("Capitale care sunt deja curți de apel", `${I.capitaleCuCurteDeApel} din ${I.nrRegiuni}`)}
                ${rezultat.azi ? randIndicator("Consilii județene și prefecturi", NF.format(I.nrRegiuni), "câte unul în fiecare județ")
                    : randIndicator("Oficii județene (unul pe județ)", NF.format(I.oficiiJudetene), "consiliul județean și prefectura trec la regiune")}
                ${cons ? randIndicator(rezultat.azi ? "Consilieri județeni" : "Consilieri regionali", `${NF.format(cons.locuri)} + ${NF.format(cons.presedinti)} președinți`,
                    rezultat.azi ? "art. 171; fără București, care are Consiliul General"
                        : "art. 171, la dublul populației; azi, 1.379 de consilieri și președinți de consiliu județean") : ""}
            </table>`;
        const fixa = rezultat.circumscriptii;
        const nota = fixa
            ? rezultat.azi ? `<p class="nota"><b>Situația de azi</b> (${D.esc(fixa.temei)}): ${D.esc(fixa.nota)} E punctul de
                plecare al comparației: fiecare județ e o „regiune”, cu reședința lui drept capitală, iar indicatorii se
                socotesc la fel ca pentru celelalte variante. Drumul mediu e cel de la centrul județului la reședință
                (linie dreaptă × ${NF1.format(P.ocol)}, la ${P.vitezaMedie} km/h), pentru locuitorii din afara Bucureștiului și a Ilfovului.</p>`
            : `<p class="nota"><b>${D.esc(fixa.nume)}</b> (${D.esc(fixa.temei)}): ${D.esc(fixa.nota)} Nimic nu e calculat:
                județele stau unde le-a pus legea, iar capitala fiecărei regiuni e sediul instituției.
                ${fixa.separare ? `O singură abatere: Bucureștiul și Ilfovul formează Metropola, separat, ca în toate variantele;
                celelalte județe ale circumscripției București (${D.esc(fixa.separare.judete.join(", "))}) formează o regiune
                a lor, cu capitala la ${D.esc(fixa.separare.capitala)}, aleasă ca la varianta calculată.` : ""} Indicatorii sunt
                aceiași ca la varianta calculată, ca să se poată compara. Distanțele sunt estimate (linie dreaptă ×
                ${NF1.format(P.ocol)}, la ${P.vitezaMedie} km/h); drumul mediu e al locuitorilor din afara Bucureștiului și a Ilfovului.</p>`
            : `<p class="nota">Capitalele se aleg dintre orașele cu funcții regionale de azi (curte de apel 3 puncte,
                direcție regională a finanțelor și agenție de dezvoltare câte 2, cameră a notarilor 1), iar regiunile
                cresc pe vecinătăți, echilibrând populația și nivelul economic. Distanțele sunt estimate
                (linie dreaptă × ${NF1.format(P.ocol)}, la ${P.vitezaMedie} km/h), nu rutate — timpii reali vin doar
                pentru localități, în scenariile de comasare.</p>`;

        const lista = rezultat.regiuni.map(r => {
            const dep = judete.find(j => j.c === r.judetCelMaiDepartat);
            return `<li data-capitala="${r.capitala}" tabindex="0" class="${selectata === r.capitala ? "selectat" : ""}">
                <span class="mostra f-c${culoare.get(r.capitala)}"></span>
                <span class="grup-nume">${D.esc(r.nume)}</span>
                <span class="numar">${NF.format(r.populatie)}</span>
                <span class="grup-detalii">
                    ${r.pibLoc ? `${NF.format(r.pibLoc)} EUR/loc.` : "—"} ·
                    ${r.euroPeOra ? `${NF1.format(r.euroPeOra)} EUR/oră` : "—"} ·
                    ${cate(r.judete.length, "județ", "județe")} ·
                    ${cons && cons.peRegiune.has(r.capitala) ? `${NF.format(cons.peRegiune.get(r.capitala))} consilieri · ` : ""}
                    ${dep ? `cel mai departe: ${D.esc(dep.nume)}, ${NF.format(Math.round(r.kmMax))} km` : ""}
                    ${r.istorice.length > 1 ? `<span class="eticheta-stare" title="${D.esc(r.istorice.join(" + "))}">regiuni istorice diferite</span>` : ""}
                    <br><small>${r.judete.map(c => D.esc((judete.find(j => j.c === c) || {}).auto || "")).join(" ")}</small>
                </span>
            </li>`;
        }).join("");

        $("#rg-rezultat").innerHTML = `${tabel}
            ${nota}
            <h3 class="subtitlu-sectiune">${rezultat.azi ? "Județele" : fixa ? "Regiunile" : "Regiunile propuse"} (${rezultat.regiuni.length}) <small class="nota">— clic pentru detalii</small></h3>
            <ol class="lista-grupuri">${lista}</ol>`;

        document.querySelectorAll("#rg-rezultat li[data-capitala]").forEach(li => {
            const alege = () => {
                const cap = Number(li.dataset.capitala);
                selectata = selectata === cap ? null : cap;
                deseneaza();
                randeazaPanou();
                randeazaDetalii();
            };
            li.addEventListener("click", alege);
            li.addEventListener("keydown", e => { if (e.key === "Enter") alege(); });
        });
        randeazaDetalii();
    }

    function randeazaDetalii() {
        const cont = $("#rg-detalii");
        const r = selectata === null ? null : rezultat.regiuni.find(x => x.capitala === selectata);
        if (!r) {
            cont.hidden = true;
            return;
        }
        const membre = r.judete.map(c => judete.find(j => j.c === c)).filter(Boolean)
            .sort((a, b) => b.populatie - a.populatie);
        const randuri = membre.map(j => `<tr>
                <th scope="row">${D.esc(j.nume)}${j.c === r.capitala ? " <small>(capitală)</small>" : ""}</th>
                <td>${NF.format(j.populatie)}</td>
                <td>${j.pibLoc ? NF.format(j.pibLoc) : "—"}</td>
            </tr>`).join("");
        const peRetele = institutii.sisteme.map(s => {
            const inRegiune = r.institutii.filter(i => i.sistem === s.cod);
            if (!inRegiune.length) return "";
            return `<li><b>${D.esc(s.nume)}</b>: ${inRegiune.map(i => D.esc(i.oras)).join(", ")}</li>`;
        }).join("");
        cont.innerHTML = `
            <h3>${D.esc(r.nume)}</h3>
            <div class="tip">${rezultat.azi ? "reședință de județ" : rezultat.circumscriptii ? "sediu de " + D.esc(rezultat.circumscriptii.nume.toLowerCase().replace(/^curți de apel$/, "curte de apel").replace(/^agenții pentru dezvoltare regională$/, "agenție de dezvoltare")) : "capitală de regiune"} · ${cate(r.judete.length, "județ", "județe")} ·
                ${NF.format(r.populatie)} loc. · ${NF.format(Math.round(r.suprafata))} km²</div>
            <table class="tabel-atribute">
                ${randIndicator("PIB pe locuitor", r.pibLoc ? NF.format(r.pibLoc) + " EUR" : "—", institutii.anEconomie.judete)}
                ${randIndicator("Câștig pe oră lucrată", r.euroPeOra ? NF1.format(r.euroPeOra) + " EUR" : "—", "media regiunilor NUTS2 componente")}
                ${randIndicator("Drum mediu până la capitală", NF.format(Math.round(60 * r.kmMediu / rezultat.parametri.vitezaMedie)) + " min",
            `maxim ${NF.format(Math.round(r.kmMax))} km`)}
                ${randIndicator("Oficii județene", NF.format(r.oficiiJudetene), "unul pe județ")}
                ${randIndicator("Regiuni istorice", D.esc(r.istorice.join(", ")))}
            </table>
            <h4 class="subtitlu-sectiune">Instituțiile regionale de azi din regiune</h4>
            <ul class="lista-simpla">${peRetele || "<li>niciuna</li>"}</ul>
            <h4 class="subtitlu-sectiune">Județele componente</h4>
            <table class="tabel-atribute">
                <thead><tr><th>Județ</th><th>Populație</th><th>PIB/loc.</th></tr></thead>
                <tbody>${randuri}</tbody>
            </table>`;
        cont.hidden = false;
    }

    /** Compară variantele fixe (curțile de apel, regiunile de dezvoltare) cu cele calculate: 8, 12 și 16 regiuni. */
    function compara() {
        const fixe = FIXE.map(f => ({ r: variantaRezultat(f.cod), eticheta: f.eticheta, cod: f.cod })).filter(x => x.r);
        const calculate = D.regionalizare.compara(judete, veciniJudet, institutii.sisteme, VARIANTE, parametri())
            .map(r => ({ r: r, eticheta: `${r.indicatori.nrRegiuni} regiuni, calculate`, cod: "calculata" }));
        const randuri = fixe.concat(calculate).map(x => {
            const r = x.r, I = r.indicatori, cons = consilieri(r);
            return `<tr data-nr="${I.nrRegiuni}" data-varianta="${x.cod}" tabindex="0">
                <th scope="row">${D.esc(x.eticheta)}</th>
                <td>${NF.format(Math.round(I.populatieMedie))}</td>
                <td>${NF1.format(I.raportPopulatie)}×</td>
                <td>${I.raportPibLoc ? NF1.format(I.raportPibLoc) + "×" : "—"}</td>
                <td>${NF.format(Math.round(I.minuteMediu))}</td>
                <td>${I.capitaleCuCurteDeApel}/${I.nrRegiuni}</td>
                <td>${cons ? NF.format(cons.locuri + cons.presedinti) : "—"}</td>
            </tr>`;
        }).join("");
        $("#rg-comparatie").innerHTML = `
            <h3 class="subtitlu-sectiune">Variante comparate <small class="nota">— clic pe un rând ca să-l vezi pe hartă</small></h3>
            <div class="tabel-derulant"><table class="tabel-atribute tabel-comparatie tabel-judete">
                <thead><tr><th>Variantă</th><th>pop. medie</th><th>max/min pop.</th><th>max/min PIB</th><th>min. la capitală</th><th>capitale cu C.A.</th><th>consilieri + președinți</th></tr></thead>
                <tbody>${randuri}</tbody>
            </table></div>`;
        document.querySelectorAll("#rg-comparatie tr[data-nr]").forEach(tr => {
            const alege = () => {
                $("#rg-varianta").value = tr.dataset.varianta;
                if (tr.dataset.varianta === "calculata") $("#rg-nr").value = tr.dataset.nr;
                actualizeazaEtichete();
                ruleaza();
            };
            tr.addEventListener("click", alege);
            tr.addEventListener("keydown", e => { if (e.key === "Enter") alege(); });
        });
    }

    function actualizeazaEtichete() {
        $("#rg-nr-val").textContent = $("#rg-nr").value;
        $("#rg-pop-val").textContent = $("#rg-pop").value;
        $("#rg-eco-val").textContent = $("#rg-eco").value;
    }

    function initControale() {
        const cont = $("#rg-retele");
        cont.innerHTML = institutii.sisteme.map(s =>
            `<label><input type="checkbox" value="${D.esc(s.cod)}" ${s.cod === "curte-apel" ? "checked" : ""}>
                ${D.esc(s.nume)}</label>`).join("");
        retele = new Set(["curte-apel"]);
        cont.querySelectorAll("input").forEach(cb => cb.addEventListener("change", () => {
            retele = new Set(Array.from(cont.querySelectorAll("input:checked")).map(x => x.value));
            if (activ) deseneaza();
        }));
        ["#rg-nr", "#rg-pop", "#rg-eco"].forEach(id => $(id).addEventListener("input", () => {
            actualizeazaEtichete();
            if (activ) ruleaza();
        }));
        ["#rg-institutii", "#rg-istorice"].forEach(id =>
            $(id).addEventListener("change", () => { if (activ) ruleaza(); }));
        $("#rg-compara").addEventListener("click", compara);
        $("#rg-varianta").addEventListener("change", () => {
            selectata = null;
            if (activ) ruleaza();
        });
        actualizeazaEtichete();
    }

    function tooltip(idx) {
        if (!activ || !rezultat) return "";
        const cap = rezultat.judetRegiune.get(codJudet(idx));
        if (cap === undefined) return "";
        const r = rezultat.regiuni.find(x => x.capitala === cap);
        const j = judete.find(x => x.c === codJudet(idx));
        return `<div class="rand"><span>Regiune propusă</span><b>${D.esc(r.nume)}</b></div>
            <div class="rand"><span>PIB pe locuitor (județ)</span><b>${j && j.pibLoc ? NF.format(j.pibLoc) + " EUR" : "—"}</b></div>`;
    }

    // ------------------------------------------------------------ ciclul modului
    function intra() {
        activ = true;
        $("#rg-sectiune").hidden = false;
        if (!rezultat) ruleaza();
        else {
            deseneaza();
            randeazaPanou();
        }
    }

    function iese() {
        activ = false;
        strat.clearLayers();
        stratLimite.clearLayers();
        $("#rg-sectiune").hidden = true;
    }

    /** @param context de la AdpAplicatie: { date, topo, vecini, harta, topologie, regionalizare, esc, ... } */
    function initializeaza(context) {
        D = context;
        strat = D.harta.stratNou("puncte");
        stratLimite = D.harta.stratNou("limite");
        D.adaugaTooltip(tooltip);
        const definitie = {
            titlu: "Regiuni — simulare",
            stil: stil,
            limite: { judet: true },
            legenda: () => institutii
                ? `<ul class="legenda">${institutii.sisteme.filter(s => retele.has(s.cod)).map(s =>
                    `<li><span class="mostra punct" style="background:var(${SIMBOL[s.cod] ? SIMBOL[s.cod].token : "--text"})"></span><span>${D.esc(s.nume)}</span></li>`).join("")}
                    <li><span class="mostra punct sediu"></span><span>capitala regiunii propuse</span></li></ul>`
                : `<p class="nota">Se încarcă datele regionale…</p>`,
            nota: "Simulare: județele grupate în regiuni, comparate cu rețelele de instituții care au deja circumscripție regională.",
            etichete: () => [],
            intra: () => { if (institutii) intra(); },
            iese: iese
        };
        D.adaugaMod("regiuni", definitie);
        fetch(CALE).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        }).then(j => {
            institutii = j;
            pregateste();
            initControale();
            const dinAdresa = laPornire => {
                const adresa = /^#regiuni(?:=([a-z-]+))?$/.exec(location.hash);
                if (adresa) {
                    const alta = adresa[1] && $(`#rg-varianta option[value="${adresa[1]}"]`) && $("#rg-varianta").value !== adresa[1];
                    if (alta) { $("#rg-varianta").value = adresa[1]; selectata = null; }
                    const radio = document.querySelector("input[name=mod][value=regiuni]");
                    // secțiunile pliate în care stau comutatorul și panoul se deschid
                    [radio, $("#rg-sectiune")].forEach(el => {
                        for (let d = el && el.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
                    });
                    if (radio && !radio.checked) {
                        radio.checked = true;
                        radio.dispatchEvent(new Event("change", { bubbles: true }));
                    } else if (alta && activ) ruleaza();
                }
                if (laPornire && document.querySelector("input[name=mod]:checked").value === "regiuni") intra();
                // venit printr-o legătură directă: panoul se derulează la regiuni
                if (adresa) requestAnimationFrame(() => $("#rg-sectiune").scrollIntoView({ block: "start" }));
            };
            dinAdresa(true);
            // și când ancora se schimbă în pagină (meniul „Simulări”)
            window.addEventListener("hashchange", () => dinAdresa(false));
        }).catch(e => {
            console.warn(`[e-ro-adp] "${CALE}" nu a putut fi încărcat (${e.message}). Rulează unelte/regiuni_date.py.`);
            const radio = document.querySelector("input[name=mod][value=regiuni]");
            if (radio) radio.disabled = true;
        });
    }

    return {
        initializeaza: initializeaza
    };
}();
