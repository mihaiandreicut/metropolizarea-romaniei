/* ============================================================================
   adp-panou.js — panoul de pe prima pagină (index.html)

   Citește date/panou.json (scris de unelte/panou.js, cu aceleași module ca
   harta și raportul) și desenează: cifra mare, cifrele de bază, de unde vin
   banii, curba costului pe locuitor, regiunile, variantele de regiuni și
   tabelul județelor, cu filtre și sortare. Graficele sunt SVG desenat aici,
   colorat cu tokenii temei (css/adp-tema.css), deci urmează și modul întunecat.
   ========================================================================== */
(function () {
    "use strict";

    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const $ = s => document.querySelector(s);
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const mld = v => `${NF1.format(v / 1e9)} mld. lei`;
    const mil = v => `${NF1.format(v / 1e6)} mil. lei`;
    const bani = v => Math.abs(v) >= 1e9 ? mld(v) : mil(v);
    const procent = (a, b) => `${b < a ? "−" : "+"}${NF.format(Math.round(100 * Math.abs(b - a) / a))}%`;
    const cate = (n, sg, pl) => {
        if (n === 1) return `1 ${sg}`;
        const rest = n % 100;
        return `${NF.format(n)} ${n && (rest === 0 || rest >= 20) ? "de " : ""}${pl}`;
    };
    let D = null;

    // ------------------------------------------------------------ tooltip comun
    const tip = $("#pn-tooltip");
    function legaTooltip(cont) {
        cont.addEventListener("mousemove", e => {
            const t = e.target.closest("[data-tip]");
            if (!t) { tip.hidden = true; return; }
            tip.innerHTML = t.getAttribute("data-tip");
            tip.hidden = false;
            const l = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
            tip.style.left = `${l}px`;
            tip.style.top = `${e.clientY + 14}px`;
        });
        cont.addEventListener("mouseleave", () => { tip.hidden = true; });
    }

    // ------------------------------------------------------------ cifra mare și cifrele de bază
    function erou() {
        const b = D.bani, ani = D.retele.total / b.total;
        $("#pn-erou-cifra").innerHTML = `
            <span class="pn-erou-eticheta">Se eliberează în fiecare an</span>
            <strong>${NF1.format(b.total / 1e9)}<small> mld. lei</small></strong>
            <span class="pn-erou-nota">între ${NF1.format(b.plaja[0] / 1e9)} și ${NF1.format(b.plaja[1] / 1e9)} mld., după ipoteze ·
                apă și canalizare pentru toți în <b>${NF.format(Math.round(ani))} ani</b></span>`;
    }

    function kpi() {
        const N = D.national, A = D.alesi, R = D.retele;
        const tile = (eticheta, azi, dupa, nota, clasa, sens) => `
            <article class="pn-kpi-tile ${clasa || ""}">
                <span class="pn-kpi-eticheta">${eticheta}</span>
                <span class="pn-kpi-azi">${azi !== null ? `azi ${azi} <span aria-label="devine">→</span>` : "&nbsp;"}</span>
                <div class="pn-kpi-valori"><strong>${dupa}</strong>${sens ? `<span class="pn-kpi-delta ${sens.clasa}">${sens.text}</span>` : ""}</div>
                <p>${nota}</p>
            </article>`;
        $("#pn-kpi").innerHTML = [
            tile("Comune și orașe", NF.format(N.uat[0]), NF.format(N.uat[1]),
                `sub ${NF.format(D.parametri.pMin)} de locuitori: ${NF.format(N.subPrag[0])} → ${NF.format(N.subPrag[1])}`,
                "", { text: procent(N.uat[0], N.uat[1]), clasa: "bun" }),
            tile("Primăria, pe locuitor", NF.format(Math.round(D.bani.aparatAzi / popCuDate())),
                NF.format(Math.round(D.bani.aparatDupa / popCuDate())) + "<small> lei/an</small>",
                `aparatul tuturor primăriilor: ${NF1.format(D.bani.aparatAzi / 1e9)} → ${NF1.format(D.bani.aparatDupa / 1e9)} mld. lei pe an`,
                "", { text: procent(D.bani.aparatAzi, D.bani.aparatDupa), clasa: "bun" }),
            tile("Apă și canalizare pentru toți", null, NF.format(Math.round(R.total / 1e9)) + "<small> mld. lei</small>",
                `${NF1.format(R.apa.locuitori / 1e6)} mil. de oameni fără apă, ${NF1.format(R.canal.locuitori / 1e6)} mil. fără canalizare: ` +
                `${NF.format(Math.round(R.total / D.bani.total))} ani de economie`, "pn-kpi-accent"),
            tile("Aleși locali și județeni", NF.format(A.total[0]), NF.format(A.total[1]),
                `primari: ${NF.format(A.primari[0])} → ${NF.format(A.primari[1])}; fără București`,
                "", { text: procent(A.total[0], A.total[1]), clasa: "neutru" }),
            tile("Oameni în administrație", NF.format(N.oameni[0]), NF.format(N.oameni[1]),
                "primării, consilii județene, serviciile statului; profesorii și medicii nu intră", "",
                { text: procent(N.oameni[0], N.oameni[1]), clasa: "neutru" }),
            tile("Drumul până la primărie", NF1.format(N.timp[0]), NF1.format(N.timp[1]) + "<small> min</small>",
                `sate la peste ${D.parametri.tMax} de minute: ${NF.format(N.pesteTMax[0])} → ${NF.format(N.pesteTMax[1])}, fiecare cu derogare scrisă`,
                "pn-kpi-atentie", { text: "costul", clasa: "atentie" })
        ].join("");
    }
    // populația cu execuție bugetară (fără București), pentru costul pe locuitor
    const popCuDate = () => D.judete.reduce((a, j) => a + j.populatie, 0);

    // ------------------------------------------------------------ de unde vin banii
    function graficBani() {
        const b = D.bani, L = 640, H = 150, x0 = 8, lat = L - 16;
        const max = Math.ceil(b.plaja[1] / 1e9) * 1e9;
        const x = v => x0 + lat * v / max;
        const parti = [
            { n: "Primării", v: b.primarii, cls: "pn-s1", sigur: true,
                nota: `aparatul scade de la ${NF1.format(b.aparatAzi / 1e9)} la ${NF1.format(b.aparatDupa / 1e9)} mld.; biroul din sat păstrează ${Math.round(b.cota * 100)}%` },
            { n: "Consilii județene", v: b.cj, cls: "pn-s2", sigur: true, nota: `jumătate din aparatul de ${NF1.format(b.aparatCJ / 1e9)} mld.` },
            { n: "Serviciile statului din județe", v: b.stat, cls: "pn-s3", sigur: false, nota: `o cincime din personalul de ${NF1.format(b.personalStat / 1e9)} mld.` }
        ];
        let cursor = 0;
        const yBara = 64, hBara = 40;
        const segmente = parti.map(p => {
            const a = x(cursor), w = x(cursor + p.v) - a;
            cursor += p.v;
            return `<rect class="${p.cls}${p.sigur ? "" : " pn-ipoteza"}" x="${a + 1}" y="${yBara}" width="${Math.max(0, w - 2)}" height="${hBara}" rx="4"
                data-tip="<b>${esc(p.n)}</b><br>${mld(p.v)} pe an (${NF.format(Math.round(100 * p.v / b.total))}%)<br>${esc(p.nota)}"/>`;
        }).join("");
        const ticks = [];
        for (let v = 0; v <= max; v += 1e9) ticks.push(`<line class="pn-grila-linie" x1="${x(v)}" x2="${x(v)}" y1="${yBara - 6}" y2="${yBara + hBara + 6}"/>
            <text class="pn-axa-text" x="${x(v)}" y="${H - 4}" text-anchor="middle">${NF.format(v / 1e9)}</text>`);
        const yP = 30;
        const plaja = `<g class="pn-plaja" data-tip="<b>Plaja ipotezelor</b><br>${mld(b.plaja[0])} – ${mld(b.plaja[1])} pe an<br>biroul din sat 15–35%, consiliul județean −30…−70%, statul −10…−30%">
            <line x1="${x(b.plaja[0])}" x2="${x(b.plaja[1])}" y1="${yP}" y2="${yP}"/>
            <line x1="${x(b.plaja[0])}" x2="${x(b.plaja[0])}" y1="${yP - 7}" y2="${yP + 7}"/>
            <line x1="${x(b.plaja[1])}" x2="${x(b.plaja[1])}" y1="${yP - 7}" y2="${yP + 7}"/>
            <circle cx="${x(b.total)}" cy="${yP}" r="6"/>
            <rect x="${x(b.plaja[0])}" y="${yP - 12}" width="${x(b.plaja[1]) - x(b.plaja[0])}" height="24" fill="transparent"/>
        </g>
        <text class="pn-axa-text" x="${x(b.plaja[0]) - 8}" y="${yP + 4}" text-anchor="end">${NF1.format(b.plaja[0] / 1e9)}</text>
        <text class="pn-axa-text" x="${x(b.plaja[1]) + 8}" y="${yP + 4}">${NF1.format(b.plaja[1] / 1e9)}</text>
        <text class="pn-valoare" x="${x(b.total)}" y="${yP - 12}" text-anchor="middle">${NF1.format(b.total / 1e9)}</text>`;
        const legenda = parti.map(p => `<li>
                <span class="pn-mostra ${p.cls}${p.sigur ? "" : " pn-ipoteza"}"></span>
                <span class="pn-leg-nume">${esc(p.n)}</span>
                <b>${mld(p.v)}</b>
                <span class="pn-eticheta ${p.sigur ? "sigur" : "ipoteza"}">${p.sigur ? "din execuția bugetară" : "ipoteză"}</span>
            </li>`).join("");
        $("#pn-bani").innerHTML = `
            <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Economia pe an: ${mld(b.total)}, din care primării ${mld(b.primarii)}, consilii județene ${mld(b.cj)}, serviciile statului ${mld(b.stat)}; plaja ${mld(b.plaja[0])} – ${mld(b.plaja[1])}">
                <defs><pattern id="pn-hasura" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="7" height="7" class="pn-s3"/><line x1="0" y1="0" x2="0" y2="7" class="pn-hasura-linie"/></pattern></defs>
                ${ticks.join("")}${segmente}${plaja}
            </svg>
            <p class="pn-axa-titlu">miliarde de lei pe an · cercul: calculul de bază; linia: plaja ipotezelor</p>
            <ul class="pn-legenda">${legenda}</ul>
            <p class="pn-nota">Cât lasă în urmă primăria desființată, pentru biroul din sat: ${D.bani.primariiPeCota.map(([c, v]) =>
                `<b>${Math.round(c * 100)}%</b> → ${NF1.format(v / 1e9)} mld.`).join(" · ")} la primării.
                <a href="raport.html#tablou">Reglează în raport →</a></p>`;
        legaTooltip($("#pn-bani"));
    }

    // ------------------------------------------------------------ curba costului
    function graficCurba() {
        const c = D.curba, L = 640, H = 260, st = 44, dr = 8, sus = 24, jos = 46;
        const max = Math.ceil(Math.max(...c.map(x => x.lei)) / 500) * 500;
        const lat = (L - st - dr) / c.length;
        const y = v => sus + (H - sus - jos) * (1 - v / max);
        const eticheta = x => x.pana === null ? `peste ${NF.format(x.de / 1000)} mii` :
            x.de === 0 ? `sub ${NF.format(x.pana)}` : `${NF.format(x.de / 1000)}–${NF.format(x.pana / 1000)} mii`;
        const grila = [];
        for (let v = 0; v <= max; v += 500) grila.push(`<line class="pn-grila-linie" x1="${st}" x2="${L - dr}" y1="${y(v)}" y2="${y(v)}"/>
            <text class="pn-axa-text" x="${st - 8}" y="${y(v) + 4}" text-anchor="end">${NF.format(v)}</text>`);
        const bare = c.map((x, k) => {
            const bx = st + k * lat + lat * 0.18, w = lat * 0.64, sub = x.pana !== null && x.pana <= D.parametri.pMin;
            return `<rect class="${sub ? "pn-s1" : "pn-s1-deschis"}" x="${bx}" y="${y(x.lei)}" width="${w}" height="${y(0) - y(x.lei)}" rx="4"
                    data-tip="<b>${esc(eticheta(x))} de locuitori</b><br>${NF.format(x.lei)} lei pe locuitor, pe an<br>${cate(x.primarii, "primărie", "primării")} · aparatul înghite ${x.dinVenituri}% din veniturile proprii"/>
                <text class="pn-valoare" x="${bx + w / 2}" y="${y(x.lei) - 6}" text-anchor="middle">${NF.format(x.lei)}</text>
                <text class="pn-axa-text" x="${bx + w / 2}" y="${H - jos + 16}" text-anchor="middle">${esc(eticheta(x).replace(" mii", ""))}</text>`;
        }).join("");
        // pragul propus: între clasa care se termină la 3.000 și următoarea
        const kPrag = c.findIndex(x => x.de === D.parametri.pMin);
        const xPrag = st + kPrag * lat;
        const prag = kPrag > 0 ? `<line class="pn-prag" x1="${xPrag}" x2="${xPrag}" y1="${sus - 8}" y2="${y(0)}"/>
            <text class="pn-prag-text" x="${xPrag + 6}" y="${sus + 2}">pragul propus: ${NF.format(D.parametri.pMin)} de locuitori</text>` : "";
        $("#pn-curba").innerHTML = `
            <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Costul primăriei pe locuitor scade de la ${NF.format(c[0].lei)} de lei în comunele sub 1.500 de locuitori la ${NF.format(c[c.length - 1].lei)} de lei în orașele de peste 50.000">
                ${grila.join("")}${bare}${prag}
                <text class="pn-axa-text" x="${(st + L - dr) / 2}" y="${H - 6}" text-anchor="middle">locuitori (mii, unde scrie)</text>
            </svg>
            <p class="pn-axa-titlu">lei pe locuitor, pe an · culoarea închisă: localitățile sub prag, care se comasează</p>
            <p class="pn-nota">Sub ${NF.format(D.parametri.pMin)} de locuitori, aparatul primăriei înghite ${c[0].dinVenituri}% și ${c[1].dinVenituri}% din
                veniturile proprii; peste 50.000, ${c[c.length - 1].dinVenituri}%. <a href="sinteza.html#curba">Curba, în sinteză →</a></p>`;
        legaTooltip($("#pn-curba"));
    }

    // ------------------------------------------------------------ regiuni și variante
    function regiuni() {
        const max = Math.max(...D.regiuni.map(r => r.economie));
        const legatura = r => /București/.test(r.n) ? "harta.html#judet=23" : `harta.html#regiune=${r.c}`;
        $("#pn-regiuni").innerHTML = `<div class="tabel-derulant"><table class="pn-tabel">
            <thead><tr><th scope="col">Regiunea</th><th scope="col" class="num">Locuitori</th><th scope="col" class="num">UAT → unități</th><th scope="col">Economie pe an</th></tr></thead>
            <tbody>${D.regiuni.slice().sort((a, b) => b.economie - a.economie).map(r => `
                <tr data-href="${legatura(r)}" tabindex="0">
                    <th scope="row"><a href="${legatura(r)}">${esc(r.n)}</a></th>
                    <td class="num">${NF.format(r.populatie)}</td>
                    <td class="num">${NF.format(r.uat)} → <b>${NF.format(r.unitati)}</b></td>
                    <td><span class="pn-bara-rand"><span class="pn-bara" style="width:${(100 * r.economie / max).toFixed(1)}%"></span><span>${bani(r.economie)}</span></span></td>
                </tr>`).join("")}</tbody></table></div>`;
        randuriClicabile($("#pn-regiuni"));
    }

    function variante() {
        const leg = v => v.cod === "calculata" ? "harta.html#regiuni=calculata" : `harta.html#regiuni=${v.cod}`;
        $("#pn-variante").innerHTML = `<div class="tabel-derulant"><table class="pn-tabel">
            <thead><tr><th scope="col">Varianta</th><th scope="col" class="num">Unități</th>
                <th scope="col" class="num">Mare / mică</th><th scope="col" class="num">Drum la capitală</th><th scope="col" class="num">Consilieri</th></tr></thead>
            <tbody>${D.variante.map(v => `
                <tr data-href="${leg(v)}" tabindex="0" class="${v.cod === "judete" ? "pn-azi" : v.cod === "adr" ? "pn-propunere" : ""}">
                    <th scope="row"><a href="${leg(v)}">${esc(v.nume)}</a></th>
                    <td class="num" data-tip="populația medie: ${NF.format(v.populatieMedie)}">${NF.format(v.regiuni)}</td>
                    <td class="num">${NF1.format(v.raportPopulatie)}×</td>
                    <td class="num">${NF.format(v.minute)} min</td>
                    <td class="num">${NF.format(v.consilieri)}</td>
                </tr>`).join("")}</tbody></table></div>
            <p class="pn-nota">Consilieri și președinți: azi, de consiliu județean; în rest, regionali (Codul administrativ, art. 171,
                la dublul populației). Drumul e estimat (linie dreaptă × 1,3, la 70 km/h), fără București și Ilfov.</p>`;
        randuriClicabile($("#pn-variante"));
        legaTooltip($("#pn-variante"));
    }

    function randuriClicabile(cont) {
        cont.querySelectorAll("tr[data-href]").forEach(tr => {
            const mergi = e => { if (!e.target.closest("a")) location.href = tr.dataset.href; };
            tr.addEventListener("click", mergi);
            tr.addEventListener("keydown", e => { if (e.key === "Enter") mergi(e); });
        });
    }

    // ------------------------------------------------------------ administrația, azi și propus
    function structura() {
        const N = D.national, A = D.alesi;
        const rand = (nivel, azi, propus) => `<tr><th scope="row">${nivel}</th><td>${azi}</td><td>${propus}</td></tr>`;
        $("#pn-structura").innerHTML = `<div class="tabel-derulant"><table class="pn-tabel pn-tabel-structura">
            <thead><tr><th scope="col">Nivelul</th><th scope="col">Azi</th><th scope="col">Propus</th></tr></thead>
            <tbody>
                ${rand("Satele", `${NF.format(N.sate)}, cu delegat doar unde n-au consilier`, `<b>${NF.format(N.sate)}</b>, fiecare cu delegat și fond propriu`)}
                ${rand("Comunele și orașele", `${NF.format(N.uat[0])}, fiecare cu primar și consiliu`, `<b>${NF.format(N.uat[1])}</b>, cu un birou în fiecare fostă primărie`)}
                ${rand("Districtele", "—", `<b>${NF.format(N.districte)}</b>, conduse de primari, fără alegeri noi`)}
                ${rand("Județele", "41 și Bucureștiul, cu consiliu ales și prefectură", "<b>41</b>, ca identitate și circumscripție; un oficiu")}
                ${rand("Regiunile", `${NF.format(N.regiuni)} de dezvoltare, fără conducere aleasă`, `<b>${NF.format(N.regiuni)}</b>, cu consiliu ales (${NF.format(A.judeteni[1])} de mandate)`)}
                ${rand("Aleși locali și județeni", NF.format(A.total[0]), `<b>${NF.format(A.total[1])}</b>`)}
            </tbody></table></div>`;
    }

    // ------------------------------------------------------------ simulările, cu hărțile lor
    function card(s) {
        return `<a class="pn-sim-card" href="${s.href}">
            <img src="img/panou/${s.img}.jpg" width="480" height="340" loading="lazy" alt="${esc(s.alt)}">
            <div class="pn-sim-corp">
                ${s.eticheta ? `<span class="pn-eticheta ${s.etichetaClasa || "sigur"}">${esc(s.eticheta)}</span>` : ""}
                <h4>${esc(s.titlu)}</h4>
                <dl class="pn-sim-cifre">${s.cifre.map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`).join("")}</dl>
                <span class="pn-sim-deschide">Deschide pe hartă →</span>
            </div>
        </a>`;
    }

    function simulari() {
        const v = (cod, nume) => D.variante.find(x => x.cod === cod && (!nume || x.nume === nume)) || {};
        const cifreReg = x => [["unități", NF.format(x.regiuni)], ["drum la capitală", `${NF.format(x.minute)} min`],
            ["mare / mică", `${NF1.format(x.raportPopulatie)}×`], ["consilieri", NF.format(x.consilieri)]];
        const regiuni = [
            { x: v("judete"), img: "regiuni-judete", href: "harta.html#regiuni=judete", titlu: "Azi: 41 de județe și București",
                eticheta: "situația de azi", etichetaClasa: "neutru", alt: "Harta celor 41 de județe și a Bucureștiului" },
            { x: v("adr"), img: "regiuni-adr", href: "harta.html#regiuni=adr", titlu: "8 regiuni de dezvoltare",
                eticheta: "propunerea", alt: "Harta celor 8 regiuni de dezvoltare, cu București–Ilfov ca Metropolă" },
            { x: v("curte-apel"), img: "regiuni-curti-apel", href: "harta.html#regiuni=curte-apel", titlu: "Curțile de apel, cu Metropola",
                eticheta: "alternativă", etichetaClasa: "ipoteza", alt: "Harta celor 16 regiuni ale curților de apel, cu București–Ilfov separat" },
            { x: v("calculata", "12 regiuni calculate"), img: "regiuni-calculate", href: "harta.html#regiuni=calculata", titlu: "Regiuni calculate (aici, 12)",
                eticheta: "alternativă", etichetaClasa: "ipoteza", alt: "Harta a 12 regiuni calculate de algoritm" }
        ];
        $("#pn-sim-regiuni").innerHTML = regiuni.map(s => card(Object.assign(s, { cifre: cifreReg(s.x) }))).join("");

        const N = D.national, b = D.bani;
        const brasov = D.judete.find(j => j.c === 8), ilfov = D.judete.find(j => j.c === 23);
        const total = j => j.economie[0] + j.economie[1] + j.economie[2];
        const comasare = [
            { img: "comasare-tara", href: "harta.html#tara", titlu: "Toată țara", eticheta: "propunerea",
                alt: "Harta celor 1.441 de unități propuse, fiecare cu culoarea ei",
                cifre: [["unități", `${NF.format(N.uat[0])} → <b>${NF.format(N.uat[1])}</b>`], ["primării, pe an", `−${NF1.format(b.primarii / 1e9)} mld. lei`],
                    ["drum mediu", `${NF1.format(N.timp[0])} → ${NF1.format(N.timp[1])} min`]] },
            brasov && { img: "comasare-judet", href: "harta.html#judet=8", titlu: "Un județ, pas cu pas: Brașov",
                alt: "Harta județului Brașov, cu unitățile propuse",
                cifre: [["unități", `${NF.format(brasov.uat)} → <b>${NF.format(brasov.unitati)}</b>`], ["economie pe an", mil(total(brasov))],
                    ["drum mediu", `${NF1.format(brasov.timp[0])} → ${NF1.format(brasov.timp[1])} min`]] },
            N.capitala && ilfov && { img: "capitala", href: "harta.html#judet=23", titlu: "Capitala și Ilfovul",
                alt: "Bucureștiul și cele 14 UAT-uri lipite de el, care trec la Capitală",
                cifre: [["UAT-uri preluate", NF.format(N.capitala.preluate)], ["locuitori", `${NF1.format(N.capitala.populatie / 1e6)} mil.`],
                    ["Ilfov", `${NF.format(ilfov.uat)} → <b>${NF.format(ilfov.unitati)}</b> unități`]] }
        ].filter(Boolean);
        $("#pn-sim-comasare").innerHTML = comasare.map(card).join("");
    }

    // ------------------------------------------------------------ simulările, comparate
    const SCURT = { azi: "Azi", p2000: "Prag 2.000", propus: "Propunerea: 3.000", p5000: "Prag 5.000",
        t45: "Limita de 45 min", faraOras: "Fără preluare de oraș", faraCapitala: "Fără regula Capitalei" };
    const SCURT_REG = v => v.cod === "judete" ? "Azi: județele" : v.cod === "adr" ? "Propunerea: 8" :
        v.cod === "curte-apel" ? "Curțile de apel" : v.nume.replace(" regiuni calculate", " calculate");
    const legReg = v => v.cod === "calculata" ? "harta.html#regiuni=calculata" : `harta.html#regiuni=${v.cod}`;

    /**
     * Grafice mici, unul lângă altul: aceleași rânduri (variantele), câte o măsură pe grafic.
     * `randuri`: [{ nume, clasa, href, tip }], `panouri`: [{ titlu, valori, format }]
     */
    function multipli(cont, randuri, panouri) {
        cont.innerHTML = panouri.map(pn => {
            const max = Math.max(...pn.valori.map(v => Math.abs(v))) || 1;
            return `<figure class="pn-multiplu"><figcaption>${pn.titlu}</figcaption><ul>${randuri.map((r, k) => `
                <li class="${r.clasa || ""}" data-tip="<b>${esc(r.nume)}</b><br>${r.tip}">
                    <a class="pn-m-eticheta" href="${r.href}">${esc(r.nume)}</a>
                    <span class="pn-m-bara"><span style="width:${(100 * Math.abs(pn.valori[k]) / max).toFixed(1)}%"></span></span>
                    <span class="pn-m-valoare">${pn.format(pn.valori[k])}</span>
                </li>`).join("")}</ul></figure>`;
        }).join("");
        legaTooltip(cont);
    }

    function comparatieComasare() {
        const S = D.scenarii;
        const tip = s => `${NF.format(s.unitati)} de unități · ${s.economie ? NF1.format(s.economie / 1e9) + " mld. lei pe an" : "fără economie"}` +
            `<br>drum mediu ${NF1.format(s.timp)} min · ${NF.format(s.sate30)} sate la peste 30 min`;
        const clasa = s => s.cod === "propus" ? "pn-m-propus" : s.cod === "azi" ? "pn-m-azi" : "";
        // --- graficul de compromis: ce câștigi (economia) și ce plătești (satele departe de primărie)
        const L = 600, H = 400, st = 58, dr = 24, sus = 22, jos = 52;
        const maxX = Math.ceil(Math.max(...S.map(s => s.sate30)) / 200) * 200, maxY = Math.ceil(Math.max(...S.map(s => s.economie)) / 1e9);
        const x = v => st + (L - st - dr) * v / maxX, y = v => sus + (H - sus - jos) * (1 - v / (maxY * 1e9));
        const grila = [];
        for (let v = 0; v <= maxY; v++) grila.push(`<line class="pn-grila-linie" x1="${st}" x2="${L - dr}" y1="${y(v * 1e9)}" y2="${y(v * 1e9)}"/>
            <text class="pn-axa-text" x="${st - 8}" y="${y(v * 1e9) + 4}" text-anchor="end">${v}</text>`);
        for (let v = 0; v <= maxX; v += 200) grila.push(`<text class="pn-axa-text" x="${x(v)}" y="${H - jos + 18}" text-anchor="middle">${NF.format(v)}</text>`);
        // eticheta fiecărui punct, așezată de mână ca să nu se calce
        const POZ = { azi: [12, 4, "start"], p2000: [-12, 4, "end"], propus: [-12, -14, "end"], p5000: [12, 4, "start"],
            t45: [-12, -12, "end"], faraOras: [-12, 18, "end"], faraCapitala: [12, 20, "start"] };
        const prag = ["p2000", "propus", "p5000"].map(c => S.find(s => s.cod === c)).filter(Boolean);
        const linie = prag.length > 1 ? `<polyline class="pn-traseu" points="${prag.map(s => `${x(s.sate30)},${y(s.economie)}`).join(" ")}"/>
            <text class="pn-traseu-text" x="${x(prag[prag.length - 1].sate30) - 6}" y="${y(prag[prag.length - 1].economie) - 14}" text-anchor="end">pragul de locuitori crește</text>` : "";
        const puncte = S.map(s => {
            const [dx, dy, anc] = POZ[s.cod] || [12, 4, "start"];
            const cx = x(s.sate30), cy = y(s.economie);
            return `<g class="pn-punct ${clasa(s)}" data-tip="<b>${esc(SCURT[s.cod] || s.nume)}</b><br>${tip(s)}">
                <circle cx="${cx}" cy="${cy}" r="${s.cod === "propus" ? 9 : 7}"/>
                <circle cx="${cx}" cy="${cy}" r="16" fill="transparent"/>
                <text x="${cx + dx}" y="${cy + dy}" text-anchor="${anc}">${esc(SCURT[s.cod] || s.nume)}</text></g>`;
        }).join("");
        $("#pn-comp-punct").innerHTML = `
            <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Variantele de comasare: economia pe an față de numărul de sate la peste 30 de minute de primărie">
                ${grila.join("")}${linie}${puncte}
                <text class="pn-axa-titlu-svg" x="${(st + L - dr) / 2}" y="${H - 8}" text-anchor="middle">sate (peste 50 de locuitori) la peste 30 de minute de primărie →</text>
                <text class="pn-axa-titlu-svg" transform="translate(14 ${(sus + H - jos) / 2}) rotate(-90)" text-anchor="middle">economie la primării, mld. lei pe an →</text>
            </svg>
            <p class="pn-nota">Sus e mai bine (mai mulți bani), la stânga e mai bine (mai puține sate departe). Propunerea stă la cotul curbei:
                pragul de 5.000 mai aduce 0,8 mld. lei, dar trimite încă ${NF.format(S.find(s => s.cod === "p5000").sate30 - S.find(s => s.cod === "propus").sate30)} de sate dincolo de 30 de minute.</p>`;
        legaTooltip($("#pn-comp-punct"));
        // --- graficele mici: toate cifrele fiecărei variante
        multipli($("#pn-comp-multipli"), S.map(s => ({ nume: SCURT[s.cod] || s.nume, clasa: clasa(s),
            href: s.cod === "propus" || s.cod === "azi" ? "harta.html#tara" : "harta.html#tara", tip: tip(s) })), [
            { titlu: "Comune și orașe", valori: S.map(s => s.unitati), format: v => NF.format(v) },
            { titlu: "Economie la primării, mld. lei pe an", valori: S.map(s => s.economie), format: v => v ? NF1.format(v / 1e9) : "0" },
            { titlu: "Drum mediu până la primărie, min", valori: S.map(s => s.timp), format: v => NF1.format(v) },
            { titlu: "Sate la peste 30 de minute", valori: S.map(s => s.sate30), format: v => NF.format(v) }
        ]);
        $("#pn-comp-tabel").innerHTML = `<div class="tabel-derulant"><table class="pn-tabel">
            <thead><tr><th scope="col">Varianta</th><th scope="col" class="num">Comune și orașe</th><th scope="col" class="num">Sub 3.000 loc.</th>
                <th scope="col" class="num">Economie pe an</th><th scope="col" class="num">Drum mediu</th><th scope="col" class="num">Sate &gt; 30 min</th></tr></thead>
            <tbody>${S.map(s => `<tr class="${s.cod === "propus" ? "pn-propunere" : s.cod === "azi" ? "pn-azi" : ""}"><th scope="row">${esc(s.nume)}</th>
                <td class="num">${NF.format(s.unitati)}</td><td class="num">${NF.format(s.sub3000)}</td>
                <td class="num">${s.economie ? mld(s.economie) : "—"}</td><td class="num">${NF1.format(s.timp)} min</td><td class="num">${NF.format(s.sate30)}</td></tr>`).join("")}</tbody>
            </table></div>
            <p class="pn-nota">Economia e cea de la primării, cu ipoteza de bază (biroul din sat păstrează un sfert). Pe hartă poți încerca orice altă
                combinație de praguri, la pasul „Regulile”.</p>`;
    }

    function graficCota() {
        const C = D.cote, L = 900, H = 230, st = 58, dr = 24, sus = 26, jos = 40;
        const maxY = Math.ceil(Math.max(...C.map(c => c[1])) / 1e9);
        const x = c => st + (L - st - dr) * c / 0.5, y = v => sus + (H - sus - jos) * (1 - v / (maxY * 1e9));
        const grila = [];
        for (let v = 0; v <= maxY; v++) grila.push(`<line class="pn-grila-linie" x1="${st}" x2="${L - dr}" y1="${y(v * 1e9)}" y2="${y(v * 1e9)}"/>
            <text class="pn-axa-text" x="${st - 8}" y="${y(v * 1e9) + 4}" text-anchor="end">${v}</text>`);
        C.forEach(([c]) => grila.push(`<text class="pn-axa-text" x="${x(c)}" y="${H - jos + 18}" text-anchor="middle">${Math.round(c * 100)}%</text>`));
        const marcate = C.filter(([c]) => [0.15, 0.25, 0.35].some(m => Math.abs(m - c) < 1e-9));
        $("#pn-cota").innerHTML = `
            <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Economia la primării scade de la ${NF1.format(C[0][1] / 1e9)} mld. lei, dacă primăriile unite nu lasă nimic în urmă, la ${NF1.format(C[C.length - 1][1] / 1e9)} mld., dacă păstrează jumătate">
                ${grila.join("")}
                <polyline class="pn-linie" points="${C.map(([c, v]) => `${x(c)},${y(v)}`).join(" ")}"/>
                ${C.map(([c, v]) => `<circle class="pn-linie-punct ${Math.abs(c - 0.25) < 1e-9 ? "baza" : ""}" cx="${x(c)}" cy="${y(v)}" r="${Math.abs(c - 0.25) < 1e-9 ? 7 : 4}"
                    data-tip="<b>Biroul din sat păstrează ${Math.round(c * 100)}%</b><br>economie la primării: ${mld(v)} pe an"/><circle cx="${x(c)}" cy="${y(v)}" r="14" fill="transparent"
                    data-tip="<b>Biroul din sat păstrează ${Math.round(c * 100)}%</b><br>economie la primării: ${mld(v)} pe an"/>`).join("")}
                ${marcate.map(([c, v]) => `<text class="pn-valoare" x="${x(c)}" y="${y(v) - 14}" text-anchor="middle">${NF1.format(v / 1e9)}${Math.abs(c - 0.25) < 1e-9 ? " · calculul de bază" : ""}</text>`).join("")}
                <text class="pn-axa-titlu-svg" x="${(st + L - dr) / 2}" y="${H - 6}" text-anchor="middle">cât păstrează unitatea nouă din aparatul fiecărei primării care se unește cu ea, pentru biroul din sat</text>
            </svg>
            <p class="pn-axa-titlu">miliarde de lei pe an, la primării</p>
            <p class="pn-nota">Fiecare zece puncte mută cam 0,5 mld. lei. Ipoteza de bază, un sfert, e de verificat pe două–trei comasări reale.
                <a href="raport.html#tablou">Cursorul, în raport →</a></p>`;
        legaTooltip($("#pn-cota"));
    }

    function multipliRegiuni() {
        const V = D.variante;
        const clasa = v => v.cod === "adr" ? "pn-m-propus" : v.cod === "judete" ? "pn-m-azi" : "";
        const tip = v => `${NF.format(v.regiuni)} unități · drum la capitală ${NF.format(v.minute)} min<br>cea mai mare / cea mai mică: ${NF1.format(v.raportPopulatie)}× · ${NF.format(v.consilieri)} de consilieri și președinți`;
        multipli($("#pn-reg-multipli"), V.map(v => ({ nume: SCURT_REG(v), clasa: clasa(v), href: legReg(v), tip: tip(v) })), [
            { titlu: "Regiuni (azi, județe)", valori: V.map(v => v.regiuni), format: v => NF.format(v) },
            { titlu: "Drum mediu la capitală, min", valori: V.map(v => v.minute), format: v => NF.format(v) },
            { titlu: "Cea mai mare / cea mai mică", valori: V.map(v => v.raportPopulatie), format: v => NF1.format(v) + "×" },
            { titlu: "Consilieri și președinți", valori: V.map(v => v.consilieri), format: v => NF.format(v) }
        ]);
    }

    // ------------------------------------------------------------ tabelul județelor
    const COLOANE = [
        { cheie: "n", titlu: "Județul", val: j => j.n },
        { cheie: "adr", titlu: "Regiunea", val: j => numeRegiune(j.adr) },
        { cheie: "populatie", titlu: "Locuitori", num: true, val: j => j.populatie },
        { cheie: "uat", titlu: "UAT → unități", num: true, val: j => j.unitati / j.uat },
        { cheie: "subPrag", titlu: "Sub 3.000 loc.", num: true, val: j => j.subPrag[0] },
        { cheie: "timp", titlu: "Drum mediu, min", num: true, val: j => j.timp[1] },
        { cheie: "pesteTMax", titlu: "Sate > 30 min", num: true, val: j => j.pesteTMax },
        { cheie: "economie", titlu: "Economie pe an", num: true, val: j => economie(j) }
    ];
    const economie = j => j.economie[0] + j.economie[1] + j.economie[2];
    const numeRegiune = c => ((D.regiuni.find(r => r.c === c) || {}).n || "").replace(" (Metropola)", "");
    const stare = { cheie: "economie", sens: -1, text: "", regiune: "" };

    function judete() {
        const lista = D.judete.filter(j => (!stare.regiune || String(j.adr) === stare.regiune) &&
            (!stare.text || j.n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
                .includes(stare.text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""))));
        const col = COLOANE.find(c => c.cheie === stare.cheie);
        lista.sort((a, b) => {
            const x = col.val(a), y = col.val(b);
            return (typeof x === "string" ? x.localeCompare(y, "ro") : x - y) * stare.sens;
        });
        const max = Math.max(...D.judete.map(economie));
        const antet = COLOANE.map(c => `<th scope="col" class="${c.num ? "num" : ""}" aria-sort="${stare.cheie === c.cheie ? (stare.sens > 0 ? "ascending" : "descending") : "none"}">
            <button type="button" class="pn-sortare" data-cheie="${c.cheie}">${c.titlu}<span aria-hidden="true">${stare.cheie === c.cheie ? (stare.sens > 0 ? " ▲" : " ▼") : ""}</span></button></th>`).join("");
        const sageata = (a, b) => `${NF.format(a)} → <b>${NF.format(b)}</b>`;
        const randuri = lista.map(j => `<tr>
                <th scope="row"><a href="harta.html#judet=${j.c}">${esc(j.n)}</a>${j.capitala ? ' <span class="pn-eticheta sigur">cu Capitala</span>' : ""}</th>
                <td>${esc(numeRegiune(j.adr))}</td>
                <td class="num">${NF.format(j.populatie)}</td>
                <td class="num">${sageata(j.uat, j.unitati)}</td>
                <td class="num">${sageata(j.subPrag[0], j.subPrag[1])}</td>
                <td class="num">${NF1.format(j.timp[0])} → <b>${NF1.format(j.timp[1])}</b></td>
                <td class="num">${NF.format(j.pesteTMax)}</td>
                <td><span class="pn-bara-rand" data-tip="<b>${esc(j.n)}</b><br>primării ${mil(j.economie[0])}<br>consiliul județean ${mil(j.economie[1])}<br>serviciile statului ${mil(j.economie[2])}">
                    <span class="pn-bara" style="width:${(100 * economie(j) / max).toFixed(1)}%"></span><span>${mil(economie(j))}</span></span></td>
            </tr>`).join("");
        $("#pn-judete").innerHTML = `<table class="pn-tabel pn-tabel-judete"><thead><tr>${antet}</tr></thead><tbody>${randuri ||
            `<tr><td colspan="${COLOANE.length}">Niciun județ nu se potrivește.</td></tr>`}</tbody></table>`;
        $("#pn-judete").querySelectorAll(".pn-sortare").forEach(b => b.addEventListener("click", () => {
            const cheie = b.dataset.cheie;
            stare.sens = stare.cheie === cheie ? -stare.sens : (COLOANE.find(c => c.cheie === cheie).num ? -1 : 1);
            stare.cheie = cheie;
            judete();
            const nou = $(`#pn-judete .pn-sortare[data-cheie="${cheie}"]`);
            if (nou) nou.focus();
        }));
    }

    function filtre() {
        $("#pn-regiune").innerHTML += D.regiuni.map(r => `<option value="${r.c}">${esc(r.n)}</option>`).join("");
        $("#pn-cauta").addEventListener("input", e => { stare.text = e.target.value.trim(); judete(); });
        $("#pn-regiune").addEventListener("change", e => { stare.regiune = e.target.value; judete(); });
        legaTooltip($("#pn-judete"));
    }

    // ------------------------------------------------------------ pornire
    fetch("date/panou.json").then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    }).then(j => {
        D = j;
        erou();
        kpi();
        graficBani();
        graficCurba();
        structura();
        regiuni();
        simulari();
        comparatieComasare();
        graficCota();
        multipliRegiuni();
        variante();
        filtre();
        judete();
        $("#pn-subsol").insertAdjacentHTML("beforeend", ` Date generate la ${esc(D.generat)}.`);
    }).catch(e => {
        $("#pn-kpi").innerHTML = `<p class="nota">Datele panoului nu s-au putut încărca (${esc(e.message)}). Rulează <code>node unelte/panou.js</code>.</p>`;
    });
})();
