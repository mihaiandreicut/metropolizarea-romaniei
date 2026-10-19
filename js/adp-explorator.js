/* ============================================================================
   ro-adp — tabloul interactiv al raportului (raport.html, secțiunea „tablou”)

   Aceleași cifre ca în restul raportului, dar de căutat: filtre pe regiune,
   județ, tip și probleme, căutare după nume, sortare pe orice coloană. Sub
   filtre: indicatorii teritoriului ales, tabelul regiunilor sau al județelor,
   populația pe districte și tabelul districtelor, fiecare cu fișa lui —
   comunele, grupurile de acțiune locală de azi și planul de acțiuni.

   Modul independent: nu calculează nimic din datele brute. Primește rândurile
   gata făcute de la AdpRaport, prin porneste(date).
   ========================================================================== */
window.AdpExplorator = function() {
    "use strict";

    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 });
    // clasele de mărime ale districtelor, în locuitori
    const CLASE = [
        { cheie: "c1", eticheta: "sub 25.000", min: 0, max: 25000 },
        { cheie: "c2", eticheta: "25.000 – 50.000", min: 25000, max: 50000 },
        { cheie: "c3", eticheta: "50.000 – 100.000", min: 50000, max: 100000 },
        { cheie: "c4", eticheta: "100.000 – 150.000", min: 100000, max: 150000 },
        { cheie: "c5", eticheta: "peste 150.000", min: 150000, max: Infinity }
    ];
    const PRAG_CANALIZARE = 60;   // % din locuitori în UAT-uri cu rețea, sub care apare la probleme
    const PROBLEME = [
        { cheie: "spital", eticheta: "fără spital public", are: d => d.spitale === 0 },
        { cheie: "leader", eticheta: "în afara pragurilor LEADER", are: d => !d.ue.potrivit },
        { cheie: "criterii", eticheta: "criterii neîndeplinite", are: d => !d.criteriiOk },
        { cheie: "canal", eticheta: `canalizare sub ${PRAG_CANALIZARE}%`, are: d => d.canalPct !== null && d.canalPct < PRAG_CANALIZARE },
        { cheie: "subprag", eticheta: "cu comune sub prag", are: d => d.subPrag > 0 },
        { cheie: "gal", eticheta: "împărțit azi între mai multe GAL-uri", are: d => d.gal.length > 1 }
    ];
    const COLOANE = [
        { cheie: "nume", eticheta: "Districtul", text: true },
        { cheie: "judetNume", eticheta: "Județul", text: true },
        { cheie: "populatie", eticheta: "Populație" },
        { cheie: "nrUnitati", eticheta: "Comune și orașe" },
        { cheie: "canalPct", eticheta: "Canalizare" },
        { cheie: "spitale", eticheta: "Spital public" },
        { cheie: "leader", eticheta: "LEADER" },
        { cheie: "nrMicro", eticheta: "GAL-uri: azi → propus" },
        { cheie: "nrActiuni", eticheta: "De făcut" }
    ];

    let D = null;   // datele primite: { regiuni, judete, districte, aniEconomie, inflatie }
    const stare = {
        adr: "", judet: "", tip: "", text: "", clasa: "",
        probleme: new Set(),
        sortare: { cheie: "populatie", sens: -1 },
        deschise: new Set()
    };

    const $ = sel => document.querySelector(sel);

    function esc(text) {
        if (text === null || text === undefined) return "";
        return String(text).replace(/[&<>"']/g, c =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
    }

    /** Fără diacritice și cu litere mici: căutarea găsește „salişte” și „Săliște” la fel. */
    const simplu = text => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const lei = v => v === null || v === undefined ? "—"
        : Math.abs(v) >= 1e9 ? `${NF1.format(v / 1e9)} mld. lei`
            : Math.abs(v) >= 1e6 ? `${NF1.format(v / 1e6)} mil. lei` : `${NF.format(Math.round(v))} lei`;
    const suma = (lista, camp) => lista.reduce((a, x) => a + (x[camp] || 0), 0);

    function economieCuInflatie(economie) {
        let total = economie / 2;   // primul an, pe jumătate: tranziția
        for (let an = 2; an <= D.aniEconomie; an++) total += economie * Math.pow(1 + D.inflatie, an - 1);
        return total;
    }

    function bara(procent, eticheta) {
        if (procent === null || procent === undefined || isNaN(procent)) return "—";
        const clasa = procent >= 80 ? "" : procent >= 50 ? " atentie" : " serios";
        return `<span class="bara${clasa}"><span style="width:${Math.max(0, Math.min(100, Math.round(procent)))}%"></span></span>` +
            `${eticheta === undefined ? NF.format(Math.round(procent)) + "%" : eticheta}`;
    }

    // ------------------------------------------------------------ filtrare și sortare
    function filtrate() {
        const text = simplu(stare.text.trim());
        const clasa = CLASE.find(c => c.cheie === stare.clasa);
        const probleme = PROBLEME.filter(p => stare.probleme.has(p.cheie));
        return D.districte.filter(d =>
            (!stare.adr || String(d.adr) === stare.adr) &&
            (!stare.judet || String(d.judet) === stare.judet) &&
            (!stare.tip || d.tip === stare.tip) &&
            (!clasa || (d.populatie >= clasa.min && d.populatie < clasa.max)) &&
            (!text || d.cautare.includes(text)) &&
            probleme.every(p => p.are(d)));
    }

    function sortate(lista) {
        const col = COLOANE.find(c => c.cheie === stare.sortare.cheie) || COLOANE[2];
        const sens = stare.sortare.sens;
        return lista.slice().sort((a, b) => {
            const x = a[col.cheie], y = b[col.cheie];
            if (col.text) return sens * String(x).localeCompare(String(y), "ro");
            // valorile lipsă stau mereu la coadă
            if (x === null || x === undefined) return 1;
            if (y === null || y === undefined) return -1;
            return sens * (x - y) || String(a.nume).localeCompare(String(b.nume), "ro");
        });
    }

    // ------------------------------------------------------------ randare
    function randeazaFiltre() {
        const judete = D.judete.filter(j => !stare.adr || String(j.adr) === stare.adr);
        $("#f-adr").innerHTML = `<option value="">toate regiunile</option>` +
            D.regiuni.map(r => `<option value="${r.cod}">${esc(r.nume)}</option>`).join("");
        $("#f-adr").value = stare.adr;
        $("#f-judet").innerHTML = `<option value="">toate județele</option>` +
            judete.map(j => `<option value="${j.cod}">${esc(j.nume)}</option>`).join("");
        $("#f-judet").value = stare.judet;
        $("#f-tip").value = stare.tip;
        if ($("#f-text").value !== stare.text) $("#f-text").value = stare.text;
        $("#f-probleme").innerHTML = PROBLEME.map(p =>
            `<button type="button" class="cip" data-problema="${p.cheie}" aria-pressed="${stare.probleme.has(p.cheie)}">${esc(p.eticheta)}</button>`).join("");
    }

    function randeazaCarduri(lista) {
        const populatie = suma(lista, "populatie");
        const economie = suma(lista, "costAcum") - suma(lista, "costDupa");
        const faraCanal = suma(lista, "faraCanal");
        const metropolitane = lista.filter(d => d.tip === "metropolitan").length;
        const faraSpital = lista.filter(d => d.spitale === 0).length;
        const card = (eticheta, valoare, nota, clasa) => `<div class="card-cifra ${clasa || ""}">
            <span class="card-eticheta">${eticheta}</span>
            <strong>${valoare}</strong>
            <small>${nota}</small></div>`;
        $("#carduri").innerHTML =
            card("Populație", NF.format(populatie), `${NF.format(Math.round(suma(lista, "suprafata")))} km²`) +
            card("Zone metropolitane și districte", NF.format(lista.length),
                `${NF.format(metropolitane)} zone metropolitane, ${NF.format(lista.length - metropolitane)} districte`) +
            card("Comune și orașe", `${NF.format(suma(lista, "nrUat"))} → ${NF.format(suma(lista, "nrUnitati"))}`,
                `${NF.format(suma(lista, "subPrag"))} rămân sub pragul lor (5.000 comuna, 7.000 cu oraș)`) +
            card("Economie pe an", lei(economie),
                `${lei(economieCuInflatie(economie))} în ${D.aniEconomie} ani, cu inflație de ${Math.round(D.inflatie * 100)}%`, "bun") +
            card("Locuitori fără canalizare", NF.format(faraCanal),
                populatie ? `${NF1.format(100 * faraCanal / populatie)}% din populație, în UAT-uri fără nicio rețea` : "", "atentie") +
            card("Fără spital public", NF.format(faraSpital),
                faraSpital === 1 ? "district" : "districte", faraSpital ? "atentie" : "bun");
    }

    function randeazaTeritorii(lista) {
        // fără regiune aleasă se văd regiunile; cu regiune, județele ei
        const peRegiuni = !stare.adr && !stare.judet;
        const cheie = peRegiuni ? "adr" : "judet";
        const nume = new Map((peRegiuni ? D.regiuni : D.judete).map(x => [x.cod, x.nume]));
        const grupe = new Map();
        lista.forEach(d => {
            if (!grupe.has(d[cheie])) grupe.set(d[cheie], []);
            grupe.get(d[cheie]).push(d);
        });
        const rand = (cod, ale, total) => {
            const populatie = suma(ale, "populatie");
            const economie = suma(ale, "costAcum") - suma(ale, "costDupa");
            const metropolitane = ale.filter(d => d.tip === "metropolitan").length;
            return `<tr class="${total ? "rand-total" : ""}">
                <th scope="row">${total ? "Total" : `<button type="button" class="legatura" data-${cheie}="${cod}">
                    <span class="mostra f-c${(cod - 1) % 8}"></span>${esc(nume.get(cod) || "")}</button>`}</th>
                <td>${NF.format(populatie)}</td>
                <td>${NF.format(metropolitane)} + ${NF.format(ale.length - metropolitane)}</td>
                <td>${NF.format(suma(ale, "nrUat"))} → <b>${NF.format(suma(ale, "nrUnitati"))}</b></td>
                <td>${lei(suma(ale, "costAcum"))}</td>
                <td>${lei(suma(ale, "costDupa"))}</td>
                <td><b>${lei(economie)}</b></td>
                <td>${lei(economieCuInflatie(economie))}</td>
                <td>${bara(populatie ? 100 * suma(ale, "canalPop") / populatie : null)}</td>
            </tr>`;
        };
        const randuri = Array.from(grupe).sort((a, b) => suma(b[1], "populatie") - suma(a[1], "populatie"))
            .map(([cod, ale]) => rand(cod, ale, false)).join("");
        $("#tabel-teritorii").innerHTML = `<div class="tabel-derulant"><table class="tabel-doc tabel-numeric tabel-harta">
            <thead><tr><th>${peRegiuni ? "Regiunea" : "Județul"}</th><th>Populație</th>
                <th>Zone metropolitane + districte</th><th>Comune și orașe</th><th>Administrația azi</th><th>După</th>
                <th>Economie pe an</th><th>În ${D.aniEconomie} ani</th><th>Canalizare</th></tr></thead>
            <tbody>${randuri}${grupe.size > 1 ? rand(0, lista, true) : ""}</tbody>
        </table></div>`;
    }

    function randeazaPopulatie(lista) {
        const cont = $("#grafic-populatie");
        if (!lista.length) {
            cont.innerHTML = `<p class="nota">Niciun district nu trece prin filtre.</p>`;
            return;
        }
        const pop = lista.map(d => d.populatie).sort((a, b) => a - b);
        const maxim = Math.max(...CLASE.map(c => lista.filter(d => d.populatie >= c.min && d.populatie < c.max).length), 1);
        const clase = CLASE.map(c => {
            const ale = lista.filter(d => d.populatie >= c.min && d.populatie < c.max);
            return `<button type="button" class="rand-clasa" data-clasa="${c.cheie}" aria-pressed="${stare.clasa === c.cheie}">
                <span class="clasa-eticheta">${c.eticheta}</span>
                <span class="clasa-bara"><span style="width:${Math.round(100 * ale.length / maxim)}%"></span></span>
                <span class="clasa-numar">${NF.format(ale.length)} <small>· ${NF.format(suma(ale, "populatie"))} loc.</small></span>
            </button>`;
        }).join("");
        cont.innerHTML = `<p class="nota">Cel mai mic: <b>${NF.format(pop[0])}</b> · mediana:
                <b>${NF.format(pop[Math.floor(pop.length / 2)])}</b> · cel mai mare: <b>${NF.format(pop[pop.length - 1])}</b>
                locuitori. Clic pe o clasă o alege ca filtru.</p>
            <div class="clase-populatie">${clase}</div>`;
    }

    function fisaDistrict(d) {
        const retea = v => v === null ? "—"
            : `<span class="eticheta-stare ${v[0] === v[1] ? "bun" : v[0] ? "atentie" : "critic"}">${v[0] === v[1] && v[1] === 1 ? "da" : v[0] ? `${v[0]} din ${v[1]}` : "nu"}</span>`;
        const unitati = d.unitati.map(u => `<tr>
            <th scope="row">${esc(u.nume)} <small>${esc(u.tip)}</small></th>
            <td class="num">${NF.format(u.populatie)}</td>
            <td>${u.uat.length > 1 ? esc(u.uat.join(", ")) : "<small>rămâne cum e</small>"}</td>
            <td>${retea(u.apa)}</td><td>${retea(u.canal)}</td><td>${retea(u.gaze)}</td>
            <td>${u.subPrag ? `<span class="eticheta-stare atentie">sub prag</span>`
                : u.derogari ? `<span class="eticheta-stare atentie">${u.derogari === 1 ? "o derogare" : u.derogari + " derogări"}</span>`
                    : `<span class="eticheta-stare bun">în criterii</span>`}</td>
        </tr>`).join("");
        const actiuni = d.actiuni.length
            ? `<ol>${d.actiuni.map(a => `<li><b>${esc(a.text)}</b>${a.populatie ? ` — ${NF.format(a.populatie)} loc.` : ""}
                <br><small>${esc(a.fond)}</small></li>`).join("")}</ol>`
            : `<p class="nota">Nimic de semnalat din datele disponibile.</p>`;
        const galuri = d.gal.length
            ? `<ul>${d.gal.map(g => `<li>${esc(g.nume)} <small>— ${NF.format(g.uat)} UAT</small></li>`).join("")}
                ${d.faraGal ? `<li><small>${NF.format(d.faraGal)} UAT în afara oricărui grup</small></li>` : ""}</ul>`
            : `<p class="nota">Niciun UAT nu e azi într-un grup de acțiune locală.</p>`;
        const microregiuni = d.microregiuni.map(m => `<li><b>${esc(m.nume)}</b> <small>(${esc(m.tipPol)})</small> —
            ${NF.format(m.populatie)} loc., ${NF.format(m.popLeader)} eligibili
            ${m.inBanda ? "" : `<span class="eticheta-stare atentie">în afara pragului</span>`}
            <br><small>${esc(m.unitati.join(", "))}</small></li>`).join("");
        const criterii = d.criterii.map(c => `<li class="${c.stare === "ok" ? "" : "neindeplinit"}">
            <span class="eticheta-stare ${c.stare === "ok" ? "bun" : "atentie"}">${c.stare === "ok" ? "da" : "nu"}</span>
            ${esc(c.nume)}: <b>${esc(c.valoare)}</b> <small>(${esc(c.prag)})</small></li>`).join("");
        const s = d.strategie;
        const strategie = `<div><h4>Strategia districtului</h4><ul>
                <li><b>Priorități:</b> ${s.prioritati.length
                    ? esc(s.prioritati.map(p => p.text).join("; ")) + (s.maiMulte ? ` și încă ${NF.format(s.maiMulte)}` : "")
                    : "nimic de semnalat din datele disponibile"}</li>
                <li><b>Instrumente:</b> ${esc(s.instrument)}; ${NF.format(s.microregiuni)}
                    ${s.microregiuni === 1 ? "microregiune" : "microregiuni"} (grupuri de acțiune locală),
                    ${NF.format(s.microInBanda)} în pragurile LEADER</li>
                <li><b>Din ce fonduri:</b> ${esc(s.fonduri.join("; ") || "—")}</li>
                <li><b>Cine o duce:</b> biroul de proiecte al districtului, la ${esc(d.resedinta)}</li>
            </ul></div>`;
        return `<div class="fisa-district">
            ${strategie}
            <div class="fisa-coloane">
                <div><h4>Criteriile districtului</h4><ul class="lista-criterii">${criterii}</ul>
                    <p class="nota">Aparatul primăriilor: ${lei(d.costAcum)} azi → ${lei(d.costDupa)} după comasare.</p></div>
                <div><h4>De făcut, și din ce bani</h4>${actiuni}</div>
                <div><h4>La fonduri, azi</h4>${galuri}
                    <h4>Propus: ${d.microregiuni.length === 1 ? "o microregiune" : `${d.microregiuni.length} microregiuni`}</h4>
                    <ul>${microregiuni}</ul></div>
            </div>
            <h4>Comunele și orașele districtului</h4>
            <div class="tabel-derulant"><table class="tabel-doc">
                <thead><tr><th>Unitatea</th><th>Populație</th><th>UAT-uri comasate</th><th>Apă</th><th>Canalizare</th>
                    <th>Gaze</th><th>Stare</th></tr></thead>
                <tbody>${unitati}</tbody>
            </table></div>
        </div>`;
    }

    function randeazaDistricte(lista) {
        const maxim = Math.max(...lista.map(d => d.populatie), 1);
        const cap = COLOANE.map(c => {
            const activ = stare.sortare.cheie === c.cheie;
            return `<th scope="col" aria-sort="${activ ? (stare.sortare.sens > 0 ? "ascending" : "descending") : "none"}">
                <button type="button" class="sortare" data-sortare="${c.cheie}">${esc(c.eticheta)}
                    <span aria-hidden="true">${activ ? (stare.sortare.sens > 0 ? "▲" : "▼") : ""}</span></button></th>`;
        }).join("");
        const randuri = sortate(lista).map(d => {
            const deschis = stare.deschise.has(d.id);
            return `<tr class="rand-explorator ${deschis ? "deschis" : ""}">
                <th scope="row"><button type="button" class="legatura" data-deschide="${d.id}" aria-expanded="${deschis}">
                    <span aria-hidden="true">${deschis ? "▾" : "▸"}</span> ${esc(d.nume)}</button>
                    ${d.tip === "metropolitan" ? `<span class="eticheta-stare plin">zonă metropolitană</span>` : ""}
                    ${d.manual ? `<span class="eticheta-stare">alegere voluntară</span>` : ""}
                    ${d.resedinta !== d.nume ? `<br><small>reședința: ${esc(d.resedinta)}</small>` : ""}</th>
                <td>${esc(d.judetNume)}</td>
                <td class="num">${bara(100 * d.populatie / maxim, NF.format(d.populatie))}</td>
                <td class="num">${NF.format(d.nrUat)} → <b>${NF.format(d.nrUnitati)}</b></td>
                <td class="num">${bara(d.canalPct)}</td>
                <td>${d.spitale === null ? "—" : `<span class="eticheta-stare ${d.spitale ? "bun" : "critic"}">${d.spitale ? d.spitale : "nu"}</span>`}</td>
                <td><span class="eticheta-stare ${d.ue.potrivit ? "bun" : "atentie"}" title="${esc(d.ue.nota)}">${d.ue.potrivit ? "în prag" : "în afară"}</span></td>
                <td class="num">${NF.format(d.nrGal)} → <b>${NF.format(d.nrMicro)}</b></td>
                <td class="num">${NF.format(d.nrActiuni)}</td>
            </tr>${deschis ? `<tr class="rand-fisa"><td colspan="${COLOANE.length}">${fisaDistrict(d)}</td></tr>` : ""}`;
        }).join("");
        $("#tabel-districte").innerHTML = lista.length
            ? `<div class="tabel-derulant"><table class="tabel-doc tabel-explorator">
                <thead><tr>${cap}</tr></thead><tbody>${randuri}</tbody></table></div>`
            : `<p class="nota">Niciun district nu trece prin filtre. Scoate un filtru sau apasă „Resetează”.</p>`;
    }

    function randeaza() {
        const lista = filtrate();
        randeazaFiltre();
        randeazaCarduri(lista);
        randeazaTeritorii(lista);
        randeazaPopulatie(lista);
        randeazaDistricte(lista);
        const activ = stare.adr || stare.judet || stare.tip || stare.text || stare.clasa || stare.probleme.size;
        $("#f-numar").textContent = `${NF.format(lista.length)} din ${NF.format(D.districte.length)} districte`;
        $("#f-reset").disabled = !activ;
    }

    // ------------------------------------------------------------ legături
    function leaga() {
        $("#f-adr").addEventListener("change", e => {
            stare.adr = e.target.value;
            stare.judet = "";
            randeaza();
        });
        $("#f-judet").addEventListener("change", e => {
            stare.judet = e.target.value;
            randeaza();
        });
        $("#f-tip").addEventListener("change", e => {
            stare.tip = e.target.value;
            randeaza();
        });
        $("#f-text").addEventListener("input", e => {
            stare.text = e.target.value;
            // în timpul tastării se reface doar ce depinde de listă, ca să nu se piardă cursorul
            const lista = filtrate();
            randeazaCarduri(lista);
            randeazaTeritorii(lista);
            randeazaPopulatie(lista);
            randeazaDistricte(lista);
            $("#f-numar").textContent = `${NF.format(lista.length)} din ${NF.format(D.districte.length)} districte`;
            $("#f-reset").disabled = false;
        });
        $("#f-reset").addEventListener("click", () => {
            Object.assign(stare, { adr: "", judet: "", tip: "", text: "", clasa: "" });
            stare.probleme.clear();
            randeaza();
        });
        $("#tablou").addEventListener("click", e => {
            const buton = e.target.closest("button");
            if (!buton) return;
            const d = buton.dataset;
            if (d.problema) {
                if (stare.probleme.has(d.problema)) stare.probleme.delete(d.problema);
                else stare.probleme.add(d.problema);
            } else if (d.clasa) {
                stare.clasa = stare.clasa === d.clasa ? "" : d.clasa;
            } else if (d.adr) {
                stare.adr = d.adr;
                stare.judet = "";
            } else if (d.judet) {
                stare.judet = d.judet;
            } else if (d.sortare) {
                const col = COLOANE.find(c => c.cheie === d.sortare);
                stare.sortare = stare.sortare.cheie === d.sortare
                    ? { cheie: d.sortare, sens: -stare.sortare.sens }
                    : { cheie: d.sortare, sens: col && col.text ? 1 : -1 };
            } else if (d.deschide) {
                const id = Number(d.deschide);
                if (stare.deschise.has(id)) stare.deschise.delete(id);
                else stare.deschise.add(id);
            } else {
                return;
            }
            randeaza();
        });
    }

    /** @param date { regiuni, judete, districte, aniEconomie, inflatie } — pregătite de AdpRaport */
    function porneste(date) {
        if (!$("#tablou")) return;
        const numeJudet = new Map(date.judete.map(j => [j.cod, j.nume]));
        D = date;
        D.districte.forEach(d => {
            d.judetNume = numeJudet.get(d.judet) || "";
            d.canalPct = d.canalPop === null || !d.populatie ? null : 100 * d.canalPop / d.populatie;
            d.leader = d.ue.potrivit ? 1 : 0;
            d.nrGal = d.gal.length;
            d.nrMicro = d.microregiuni.length;
            d.nrActiuni = d.actiuni.length;
            d.cautare = simplu(d.cautare);
        });
        leaga();
        randeaza();
    }

    return {
        porneste: porneste
    };
}();
