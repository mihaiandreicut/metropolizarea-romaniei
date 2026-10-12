/* ============================================================================
   e-ro-adp — stratul „Regiuni tematice” (index.html): țări, zone etnografice,
   regiuni etno-culturale și funcționale (date/regiuni-tematice.json).

   Apartenența e mulți-la-mulți: un UAT poate ține de mai multe regiuni, iar o
   regiune poate trece peste limitele de județ și de regiune istorică. Harta
   arată întrepătrunderea (în câte regiuni intră fiecare UAT) și contururile
   suprapuse; panoul arată, pentru fiecare regiune, peste ce județe se întinde
   și cu cine se suprapune — analiza de pornire pentru viitoarele județe
   (nicio regiune culturală nu e „monopolul” unui singur județ).

   Modul independent: tot ce folosește (date, hartă, topologie) vine prin
   contextul primit în initializeaza(context), de la AdpAplicatie.
   ========================================================================== */
window.AdpTematice = function() {
    "use strict";

    const CALE = "date/regiuni-tematice.json";
    const NF = new Intl.NumberFormat("ro-RO");
    const PCT = new Intl.NumberFormat("ro-RO", { style: "percent", maximumFractionDigits: 0 });
    const CERTITUDINE = {
        publicata: { eticheta: "listă publicată", clasa: "s-disponibil" },
        reconstituita: { eticheta: "reconstituită", clasa: "s-partial" },
        regula: { eticheta: "după regulă", clasa: "s-exemple" }
    };
    // pragul de la care o regiune „domină” un județ (partea din populația județului)
    const PRAG_DOMINANTA = 0.5;

    let D = null;               // contextul de la AdpAplicatie
    let tematice = null;        // conținutul date/regiuni-tematice.json
    let regiuni = [];           // regiunile, cu membrii ca indecși de UAT
    let apartenenta = null;     // Map idx UAT → [{ r, f }]
    let tipuriActive = null;
    let selectata = null;
    let activ = false;
    let strat = null;
    let stratEtichete = null;

    const $ = sel => document.querySelector(sel);

    function vizibile() {
        return regiuni.filter(r => tipuriActive.has(r.tip));
    }

    function regiuniUat(idx) {
        return (apartenenta.get(idx) || []).filter(x => tipuriActive.has(x.r.tip));
    }

    // ------------------------------------------------------------ pregătirea datelor
    function pregateste() {
        const idxDupaSiruta = new Map(D.date.uat.map((u, i) => [u.s, i]));
        apartenenta = new Map();
        regiuni = tematice.regiuni.map(r => {
            const membri = r.uat.map(m => ({ idx: idxDupaSiruta.get(m.s), f: m.f, sate: m.sate || [] }))
                .filter(m => m.idx !== undefined);
            const reg = Object.assign({}, r, { membri: membri, set: new Set(membri.map(m => m.idx)) });
            membri.forEach(m => {
                (apartenenta.get(m.idx) || apartenenta.set(m.idx, []).get(m.idx)).push({ r: reg, f: m.f });
            });
            return reg;
        });
        regiuni.forEach(r => {
            // populația regiunii pe județe și pe regiuni istorice
            const peJudet = new Map();
            const peIstoric = new Map();
            r.membri.forEach(m => {
                const u = D.date.uat[m.idx];
                const p = (u.p21 || 0) * m.f;
                peJudet.set(u.j, (peJudet.get(u.j) || 0) + p);
                peIstoric.set(u.ist, (peIstoric.get(u.ist) || 0) + p);
            });
            r.peJudet = Array.from(peJudet).sort((a, b) => b[1] - a[1]);
            r.peIstoric = Array.from(peIstoric).sort((a, b) => b[1] - a[1]);
            // suprapuneri: alte regiuni care au UAT-uri comune
            const comune = new Map();
            r.membri.forEach(m => (apartenenta.get(m.idx) || []).forEach(x => {
                if (x.r !== r) comune.set(x.r, (comune.get(x.r) || 0) + 1);
            }));
            r.suprapuneri = Array.from(comune).sort((a, b) => b[1] - a[1]);
            // eticheta: UAT-ul membru cel mai apropiat de centrul ponderat cu suprafața
            let lat = 0, lng = 0, a = 0;
            r.membri.forEach(m => {
                const u = D.date.uat[m.idx];
                lat += u.e[0] * u.a;
                lng += u.e[1] * u.a;
                a += u.a;
            });
            const c = [lat / a, lng / a];
            const ales = r.membri.slice().sort((x, y) => {
                const ux = D.date.uat[x.idx].e, uy = D.date.uat[y.idx].e;
                return ((ux[0] - c[0]) ** 2 + ((ux[1] - c[1]) * 0.7) ** 2) - ((uy[0] - c[0]) ** 2 + ((uy[1] - c[1]) * 0.7) ** 2);
            })[0];
            r.centru = D.date.uat[ales.idx].e;
        });
    }

    // ------------------------------------------------------------ hartă
    function stil(u, idx) {
        if (selectata) {
            const m = selectata.membri.find(x => x.idx === idx);
            if (!m) return "--neutru-harta";
            return m.f >= 1 ? "--secv-5" : "--secv-3";
        }
        const n = regiuniUat(idx).length;
        return n === 0 ? "--neutru-harta" : n === 1 ? "--secv-2" : n === 2 ? "--secv-4" : "--secv-6";
    }

    function deseneaza() {
        strat.clearLayers();
        vizibile().forEach(r => {
            const esteSel = r === selectata;
            D.harta.linii(D.topologie.contur(D.topo, idx => r.set.has(idx)), {
                token: esteSel ? "--accent" : "--text",
                weight: esteSel ? 3.5 : 1.6,
                opacity: esteSel ? 1 : 0.85,
                dashArray: esteSel ? null : "5 3"
            }).addTo(strat);
        });
        asazaEtichete();
    }

    /**
     * Etichetele regiunilor, fără suprapuneri: se așază întâi cea selectată, apoi
     * cele mai populate; una care ar cădea peste alta, la zoomul curent, se sare.
     */
    function asazaEtichete() {
        stratEtichete.clearLayers();
        if (!activ) return;
        const ordine = vizibile().slice().sort((a, b) =>
            (b === selectata) - (a === selectata) || b.populatie - a.populatie);
        const puse = [];
        ordine.forEach(r => {
            const p = D.harta.laEcran(r.centru);
            const latime = 4 * r.nume.length + 20;   // aproximare a lățimii textului
            if (puse.some(q => Math.abs(q.x - p.x) < (q.latime + latime) / 2 && Math.abs(q.y - p.y) < 15)) return;
            puse.push({ x: p.x, y: p.y, latime: latime });
            D.harta.eticheta(r.centru, D.esc(r.nume), "e-tematic" + (r === selectata ? " e-selectat" : "")).addTo(stratEtichete);
        });
    }

    function recoloreaza() {
        if (!activ) return;
        D.reaplicaMod();
    }

    // ------------------------------------------------------------ panou
    function insigna(r) {
        const c = CERTITUDINE[r.certitudine];
        return `<span class="stare-date ${c.clasa}">${c.eticheta}</span>`;
    }

    function autoJudet(cod) {
        const j = D.date.judete.find(x => x.c === Number(cod));
        return j ? j.auto : "?";
    }

    function randeazaLista() {
        const lista = vizibile().slice().sort((a, b) => a.nume.localeCompare(b.nume, "ro"));
        $("#tm-lista").innerHTML = lista.map(r => `
            <li data-id="${D.esc(r.id)}" tabindex="0" aria-selected="${r === selectata}">
                <span class="grup-nume">${D.esc(r.nume)}</span>
                <span class="numar">${NF.format(r.populatie)}</span>
                <span class="grup-detalii">${D.esc(tematice.tipuri[r.tip])} · ${r.membri.length} UAT · jud. ${r.peJudet.map(([j]) => autoJudet(j)).join(", ")}
                    ${r.peJudet.length > 1 ? `<span class="eticheta-stare">${r.peJudet.length} județe</span>` : ""}
                    ${r.suprapuneri.length ? `<span class="eticheta-stare">se suprapune</span>` : ""}
                </span>
            </li>`).join("");
        document.querySelectorAll("#tm-lista li").forEach(li => {
            const alege = () => selecteaza(regiuni.find(r => r.id === li.dataset.id));
            li.addEventListener("click", alege);
            li.addEventListener("keydown", e => { if (e.key === "Enter") alege(); });
        });
    }

    function selecteaza(r) {
        selectata = selectata === r ? null : r;
        recoloreaza();
        randeazaLista();
        randeazaDetalii();
        if (selectata) D.harta.zoomLa(selectata.membri.map(m => m.idx), 11);
    }

    function randeazaDetalii() {
        const cont = $("#tm-detalii");
        if (!selectata) {
            cont.hidden = true;
            return;
        }
        const r = selectata;
        const total = r.peJudet.reduce((s, [, p]) => s + p, 0) || 1;
        const partiale = r.membri.filter(m => m.f < 1);
        const numeSate = sirute => {
            const loc = D.localitati();
            if (!loc) return "";
            const toate = [];
            loc.forEach(lista => lista.forEach(x => { if (sirute.includes(x.s)) toate.push(x.n); }));
            return toate.join(", ");
        };
        cont.innerHTML = `
            <h3>${D.esc(r.nume)}</h3>
            <div class="tip">${D.esc(tematice.tipuri[r.tip])} · ${insigna(r)}</div>
            ${r.descriere ? `<p class="nota">${D.esc(r.descriere)}</p>` : ""}
            <table class="tabel-atribute">
                <tr><th scope="row">Populație (RPL 2021)</th><td>${NF.format(r.populatie)}</td></tr>
                <tr><th scope="row">UAT-uri</th><td>${r.membri.length}${partiale.length ? ` (${partiale.length} doar parțial)` : ""}</td></tr>
                <tr><th scope="row">Județe</th><td>${r.peJudet.map(([j, p]) => `${D.esc(D.numeJudet(j))} ${PCT.format(p / total)}`).join(", ")}</td></tr>
                <tr><th scope="row">Regiuni istorice (1930)</th><td>${r.peIstoric.map(([i, p]) => `${D.esc(i)} ${PCT.format(p / total)}`).join(", ")}</td></tr>
                <tr><th scope="row">Se suprapune cu</th><td>${r.suprapuneri.length ? r.suprapuneri.map(([o, n]) => `${D.esc(o.nume)} (${n} UAT)`).join(", ") : "—"}</td></tr>
            </table>
            ${partiale.length ? `<h4 class="subtitlu-sectiune">UAT-uri parțiale — doar satele</h4><ul class="lista-simpla nota">${partiale.map(m =>
                `<li><b>${D.esc(D.date.uat[m.idx].n)}</b> (${PCT.format(m.f)} din populație): ${D.esc(numeSate(m.sate)) || "—"}</li>`).join("")}</ul>` : ""}
            <p class="nota">Surse: ${r.surse.map(s => `<a href="${D.esc(s.url)}" target="_blank" rel="noopener">${D.esc(s.titlu)}</a>`).join("; ")}</p>
            <p class="nota"><b>UAT-uri:</b> ${r.membri.map(m => D.esc(D.date.uat[m.idx].n) + (m.f < 1 ? "*" : "")).join(", ")}</p>`;
        cont.hidden = false;
    }

    /** Analiza pe județe: câte regiuni tematice are fiecare județ și dacă una domină. */
    function randeazaAnaliza() {
        const peJudet = new Map();
        vizibile().forEach(r => r.peJudet.forEach(([j, p]) => {
            const x = peJudet.get(j) || { regiuni: [] };
            x.regiuni.push({ r: r, p: p });
            peJudet.set(j, x);
        }));
        const popJudet = new Map();
        D.date.uat.forEach(u => popJudet.set(u.j, (popJudet.get(u.j) || 0) + (u.p21 || 0)));
        const randuri = Array.from(peJudet, ([j, x]) => {
            x.regiuni.sort((a, b) => b.p - a.p);
            const dom = x.regiuni[0];
            return { j: j, n: x.regiuni.length, dom: dom, pondere: dom.p / popJudet.get(j) };
        }).sort((a, b) => b.n - a.n || b.pondere - a.pondere);
        const peste = vizibile().filter(r => r.peJudet.length > 1);
        const multiple = Array.from(apartenenta).filter(([, lst]) => lst.filter(x => tipuriActive.has(x.r.tip)).length > 1).length;
        $("#tm-analiza").innerHTML = `
            <p class="nota"><b>${peste.length}</b> din ${vizibile().length} regiuni trec peste o limită de județ; <b>${NF.format(multiple)}</b> UAT-uri țin de cel puțin două regiuni.</p>
            <table class="tabel-atribute tabel-comparatie">
                <thead><tr><th>Județ</th><th>regiuni</th><th>cea mai mare (din populația județului)</th></tr></thead>
                <tbody>${randuri.map(x => `
                    <tr>
                        <th scope="row">${D.esc(D.numeJudet(x.j))}</th>
                        <td>${x.n}</td>
                        <td>${D.esc(x.dom.r.nume)} ${PCT.format(x.pondere)}${x.pondere >= PRAG_DOMINANTA ? ` <span class="eticheta-stare atentie" title="O singură regiune tematică are peste jumătate din populația județului">dominantă</span>` : ""}</td>
                    </tr>`).join("")}
                </tbody>
            </table>`;
    }

    function legenda() {
        const nr = [0, 0, 0, 0];
        D.date.uat.forEach((u, idx) => { nr[Math.min(3, regiuniUat(idx).length)]++; });
        if (selectata) {
            return `<ul class="legenda">
                <li><span class="mostra f-s5"></span><span>UAT întreg în ${D.esc(selectata.nume)}</span></li>
                <li><span class="mostra f-s3"></span><span>UAT parțial (doar unele sate)</span></li>
                <li><span class="mostra linie" style="border-top-color:var(--accent)"></span><span>conturul regiunii selectate</span></li>
            </ul>`;
        }
        return `<p class="nota" style="margin-bottom:6px">în câte regiuni tematice intră UAT-ul</p>
            <ul class="legenda">
                <li><span class="mostra f-neutru"></span><span>în niciuna</span><span class="numar">${NF.format(nr[0])} UAT</span></li>
                <li><span class="mostra f-s2"></span><span>într-una</span><span class="numar">${NF.format(nr[1])} UAT</span></li>
                <li><span class="mostra f-s4"></span><span>în două</span><span class="numar">${NF.format(nr[2])} UAT</span></li>
                <li><span class="mostra f-s6"></span><span>în trei sau mai multe</span><span class="numar">${NF.format(nr[3])} UAT</span></li>
                <li><span class="mostra linie punctata"></span><span>conturul unei regiuni</span></li>
            </ul>`;
    }

    function tooltip(idx) {
        if (!activ) return "";
        const lst = regiuniUat(idx);
        if (!lst.length) return "";
        return `<div class="rand"><span>Regiuni tematice</span><b>${lst.map(x => D.esc(x.r.nume) + (x.f < 1 ? ` (${PCT.format(x.f)})` : "")).join(", ")}</b></div>`;
    }

    // ------------------------------------------------------------ ciclul modului
    function intra() {
        activ = true;
        $("#tm-sectiune").hidden = false;
        deseneaza();
        randeazaLista();
        randeazaDetalii();
        randeazaAnaliza();
    }

    function iese() {
        activ = false;
        strat.clearLayers();
        stratEtichete.clearLayers();
        $("#tm-sectiune").hidden = true;
    }

    function initFiltre() {
        const cont = $("#tm-tipuri");
        cont.innerHTML = Object.entries(tematice.tipuri).map(([k, v]) =>
            `<label><input type="checkbox" value="${D.esc(k)}" checked> ${D.esc(v)}</label>`).join("");
        cont.querySelectorAll("input").forEach(cb => cb.addEventListener("change", () => {
            tipuriActive = new Set(Array.from(cont.querySelectorAll("input:checked")).map(x => x.value));
            if (selectata && !tipuriActive.has(selectata.tip)) selectata = null;
            recoloreaza();
        }));
        $("#tm-deselecteaza").addEventListener("click", () => {
            selectata = null;
            recoloreaza();
        });
    }

    /** @param context de la AdpAplicatie: { date, topo, harta, topologie, numeJudet, esc, localitati, adaugaMod, ... } */
    function initializeaza(context) {
        D = context;
        strat = D.harta.stratNou("limite");
        stratEtichete = D.harta.stratNou("etichete");
        D.harta.laSchimbareVedere(asazaEtichete);
        D.adaugaTooltip(tooltip);
        const definitie = {
            titlu: "Regiuni tematice",
            stil: stil,
            limite: { judet: true },
            legenda: () => tematice ? legenda() : `<p class="nota">Se încarcă regiunile tematice…</p>`,
            nota: "",
            etichete: () => [],
            intra: () => { if (tematice) intra(); },
            iese: iese
        };
        D.adaugaMod("tematice", definitie);
        fetch(CALE).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        }).then(j => {
            tematice = j;
            definitie.nota = tematice.nota;
            tipuriActive = new Set(Object.keys(tematice.tipuri));
            pregateste();
            initFiltre();
            if (document.querySelector("input[name=mod][value=tematice]").checked) recoloreaza();
        }).catch(e => {
            console.warn(`[e-ro-adp] "${CALE}" nu a putut fi încărcat (${e.message}). Stratul „Regiuni tematice” rămâne gol.`);
        });
    }

    return {
        initializeaza: initializeaza
    };
}();
