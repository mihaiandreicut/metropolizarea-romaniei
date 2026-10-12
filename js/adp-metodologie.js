/* ============================================================================
   e-ro-adp — pagina metodologie.html: catalogul de atribute (din
   date/atribute-localitati.json) și rezultatele celor două exemple, calculate
   pe loc cu același cod ca harta (AdpReorganizare), cu parametrii impliciți.
   Așa, cifrele din text nu se pot desincroniza de algoritm.

   Modul independent: topologia și algoritmul de reorganizare vin prin
   porneste(dependente); legătura se face în metodologie.html.
   ========================================================================== */
window.AdpMetodologie = function() {
    "use strict";

    const CALE_UAT = "date/romania-uat.json";
    const CALE_ATRIBUTE = "date/atribute-localitati.json";
    const EXEMPLE = ["gorj", "caras-severin"];
    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const ETICHETE_STARE = {
        "disponibil": "disponibil",
        "exemple": "în exemple",
        "partial": "parțial",
        "de colectat": "de colectat"
    };

    const $ = sel => document.querySelector(sel);

    /** Numeral + substantiv, cu „de” unde o cere româna (20+: „25 de unități”, dar „12 unități”). */
    function cate(n, singular, plural) {
        if (n === 1) return `1 ${singular}`;
        const rest = n % 100;
        return `${NF.format(n)} ${n && (rest === 0 || rest >= 20) ? "de " : ""}${plural}`;
    }

    function esc(text) {
        if (text === null || text === undefined) return "";
        return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
    }

    async function json(cale) {
        const r = await fetch(cale);
        if (!r.ok) throw new Error(`${cale}: HTTP ${r.status}`);
        return r.json();
    }

    // ------------------------------------------------------------ catalog
    function randeazaCatalog(cat) {
        const roluri = Object.entries(cat.roluri).map(([k, v]) => `<li><b>${esc(k)}</b> — ${esc(v)}</li>`).join("");
        const stari = Object.entries(cat.stari).map(([k, v]) => `<li><span class="stare-date s-${esc(k.replace(" ", "-"))}">${esc(ETICHETE_STARE[k])}</span> ${esc(v)}</li>`).join("");
        let total = 0;
        const numar = {};
        const categorii = cat.categorii.map(c => {
            const randuri = c.atribute.map(a => {
                total++;
                numar[a.stare] = (numar[a.stare] || 0) + 1;
                return `<tr>
                    <th scope="row">${esc(a.nume)}<br><code>${esc(a.cod)}</code></th>
                    <td>${esc(a.descriere)}<br><small>${esc(a.unitate)} · nivel: ${esc(a.nivel)}</small></td>
                    <td>${a.rol.map(r => `<span class="rol">${esc(r)}</span>`).join(" ")}</td>
                    <td><small>${esc(a.sursa)}</small></td>
                    <td><span class="stare-date s-${esc(a.stare.replace(" ", "-"))}">${esc(ETICHETE_STARE[a.stare])}</span></td>
                </tr>`;
            }).join("");
            return `<h3>${esc(c.cod)}. ${esc(c.nume)}</h3>
                <div class="tabel-derulant"><table class="tabel-doc">
                    <thead><tr><th>Atribut</th><th>Ce arată</th><th>Rol</th><th>Sursă</th><th>Stare</th></tr></thead>
                    <tbody>${randuri}</tbody>
                </table></div>`;
        }).join("");
        $("#catalog").innerHTML = `
            <div class="doua-coloane">
                <div><h3>Rolul unui atribut în metodă</h3><ul class="lista-simpla">${roluri}</ul></div>
                <div><h3>Starea datelor</h3><ul class="lista-simpla">${stari}</ul>
                    <p class="nota">${total} atribute: ${Object.entries(numar).map(([k, v]) => `${v} ${esc(ETICHETE_STARE[k])}`).join(", ")}.</p></div>
            </div>${categorii}`;
    }

    // ------------------------------------------------------------ exemple
    function minoritatiProtejate(date, r) {
        const rez = [];
        r.grupuri.forEach(g => {
            const cuPrag = g.membri.filter(i => date.uat[i].et && date.uat[i].et.min && date.uat[i].et.pmin >= r.parametri.pragMinoritate);
            if (!cuPrag.length) return;
            const etnii = new Set(cuPrag.map(i => date.uat[i].et.min));
            etnii.forEach(et => {
                const n = g.membri.reduce((a, i) => {
                    const e = date.uat[i].et;
                    return a + (e && e.min === et ? date.uat[i].p21 * e.pmin / 100 : 0);
                }, 0);
                rez.push({ grup: g, etnie: et, pondere: 100 * n / g.populatie, uat: cuPrag.filter(i => date.uat[i].et.min === et) });
            });
        });
        return rez;
    }

    function randeazaExemplu(date, ex, r, tinta) {
        const a = r.inainte, d = r.dupa, P = r.parametri;
        const rand = (et, x, y) => `<tr><th scope="row">${et}</th><td>${x}</td><td>${y}</td></tr>`;
        const indicatori = `
            <table class="tabel-doc tabel-numeric" style="max-width:560px">
                <thead><tr><th></th><th>acum</th><th>propus</th></tr></thead>
                <tbody>
                    ${rand("Unități administrative", NF.format(a.unitati), NF.format(d.unitati))}
                    ${rand(`Unități sub ${NF.format(P.pMin)} loc.`, NF.format(a.subPrag), NF.format(d.subPrag))}
                    ${rand(`Unități sub prag în ${P.anProiectie}`, NF.format(a.subPrag2050), NF.format(d.subPrag2050))}
                    ${rand("Unități sub 3.000 loc.", NF.format(a.sub3000), NF.format(d.sub3000))}
                    ${rand("Populația mediană a unei unități", NF.format(a.mediana), NF.format(d.mediana))}
                    ${rand("Timp mediu sat → reședință (ponderat cu populația)", NF1.format(a.timpMediu) + " min", NF1.format(d.timpMediu) + " min")}
                    ${rand(`Sate (≥ ${P.pSatMin} loc.) la peste ${P.tMax} min de reședință`, NF.format(a.pesteTMax), NF.format(d.pesteTMax))}
                </tbody>
            </table>`;

        const unitati = r.grupuri.map(g => {
            const obs = [];
            if (g.subPrag) obs.push(`<span class="eticheta-stare atentie">sub prag</span>`);
            if (g.birouri.length) obs.push(cate(g.birouri.length, "birou local", "birouri locale"));
            if (g.transferuri) obs.push(cate(g.transferuri, "sat de transferat", "sate de transferat"));
            if (g.istorice.length > 1) obs.push(`regiuni istorice: ${esc(g.istorice.join(" + "))}`);
            return `<tr>
                <th scope="row">${esc(g.nume)}${g.urban ? "" : " <small>(comună)</small>"}</th>
                <td>${g.membri.map(i => esc(date.uat[i].n)).join(", ")}</td>
                <td class="num">${NF.format(g.populatie)}</td>
                <td class="num">${g.nrSate}</td>
                <td class="num">${NF1.format(g.timpMediu)} / ${NF1.format(g.timpMax)}</td>
                <td>${obs.join("; ")}</td>
            </tr>`;
        }).join("");

        const minoritati = minoritatiProtejate(date, r).map(m =>
            `<li><b>${esc(m.grup.nume)}</b>: ${esc(m.etnie.toLowerCase())} — ${NF1.format(m.pondere)}% în unitatea nouă (în ${m.uat.map(i => `${esc(date.uat[i].n)} ${NF1.format(date.uat[i].et.pmin)}%`).join(", ")}).</li>`).join("");

        const transferuri = r.sate.filter(s => s.transfer)
            .sort((x, y) => (y.tNou - y.transfer.t) * (y.p || 1) - (x.tNou - x.transfer.t) * (x.p || 1))
            .slice(0, 8)
            .map(s => `<li>${esc(s.n)} (${NF.format(s.p || 0)} loc., azi în ${esc(date.uat[s.uat].n)}) → unitatea <b>${esc(date.uat[s.transfer.g].n)}</b>: ${NF1.format(s.tNou)} → ${NF1.format(s.transfer.t)} min</li>`).join("");

        const altMedie = lista => {
            const v = r.sate.filter(s => lista.includes(s.uat)).map(s => ex.sate[s.k].alt).filter(x => x !== null && x !== undefined);
            return v.length ? Math.round(v.reduce((x, y) => x + y, 0) / v.length) : null;
        };
        const subPrag = r.grupuri.filter(g => g.subPrag).map(g => {
            const alt = altMedie(g.membri);
            const dm = Math.max(...g.membri.map(i => date.uat[i].dm || 0));
            return `<li><b>${esc(g.nume)}</b> — ${NF.format(g.populatie)} loc.; comasarea e blocată de: <b>${esc(g.motive.join(", "))}</b>; altitudinea medie a satelor ${alt === null ? "—" : NF.format(alt) + " m"}${dm >= 5 ? `, indice de dispersie ${NF1.format(dm)}` : ""}</li>`;
        }).join("");

        const nrBirouri = r.grupuri.reduce((s, g) => s + g.birouri.length, 0);
        const nrTransfer = r.sate.filter(s => s.transfer).length;

        tinta.innerHTML = `
            ${indicatori}
            <p>Cu parametrii impliciți (${NF.format(P.pMin)} loc., ${P.tMax} min), cele ${cate(a.unitati, "UAT", "UAT-uri")} se regrupează în <b>${cate(d.unitati, "unitate", "unități")}</b>. Timpul mediu până la reședință crește de la ${NF1.format(a.timpMediu)} la ${NF1.format(d.timpMediu)} minute, dar nicio localitate nu ajunge peste ${cate(P.tMax, "minut", "minute")} dacă nu era deja. Rămân <b>${cate(nrBirouri, "fostă reședință", "foste reședințe")}</b> la peste ${P.tBirou} min de noua reședință (candidate pentru birouri locale) și <b>${cate(nrTransfer, "sat", "sate")}</b> care ar ajunge mai repede la reședința unei unități vecine.</p>
            <h4>Unitățile propuse</h4>
            <div class="tabel-derulant"><table class="tabel-doc">
                <thead><tr><th>Unitate nouă (reședință)</th><th>UAT-uri actuale</th><th class="num">Populație</th><th class="num">Sate</th><th class="num">Timp mediu / max (min)</th><th>Observații</th></tr></thead>
                <tbody>${unitati}</tbody>
            </table></div>
            ${subPrag ? `<h4>Rămân sub prag</h4><p class="nota">„Accesibilitate” = orice comasare ar duce sate peste ${P.tMax} de minute; „minoritate” = ar coborî o minoritate sub pragul de ${P.pragMinoritate}%; „oraș” = regula ca reședința să fie orașul.</p><ul>${subPrag}</ul>` : ""}
            ${minoritati ? `<h4>Minorități peste pragul de ${P.pragMinoritate}% — păstrate</h4><ul>${minoritati}</ul>` : ""}
            ${transferuri ? `<h4>Sate de transferat — cel mai mare câștig</h4><ul>${transferuri}</ul>` : ""}`;

        return { a: a, d: d, nrBirouri: nrBirouri, nrTransfer: nrTransfer };
    }

    function completeazaValori(valori) {
        document.querySelectorAll("[data-val]").forEach(el => {
            const v = el.dataset.val.split(".").reduce((o, k) => (o ? o[k] : undefined), valori);
            if (v === undefined) return;
            if (el.dataset.pl && Number.isInteger(v)) {
                el.textContent = cate(v, el.dataset.sg, el.dataset.pl);
                return;
            }
            el.textContent = typeof v === "number" ? (Number.isInteger(v) ? NF.format(v) : NF1.format(v)) : v;
        });
    }

    /** @param dependente { topologie: AdpTopologie, reorganizare: AdpReorganizare } */
    /** Ce rămâne în afara calculului: Bucureștiul, plus județele fără date generate. */
    function neacoperite(r) {
        if (!r.neacoperite.length) return "";
        if (r.neacoperite.length === 1) return "; Bucureștiul rămâne neschimbat";
        return `; ${cate(r.neacoperite.length, "UAT rămâne neschimbat", "UAT-uri rămân neschimbate")}, din județele fără date generate`;
    }

    /** Scenariul național se calculează la cerere: cere toate fișierele de județ. */
    function pregatesteNational(date, vecini, reorganizare) {
        const buton = $("#national-ruleaza");
        if (!buton) return;
        buton.addEventListener("click", async () => {
            buton.disabled = true;
            const tinta = $("#rezultat-national");
            tinta.innerHTML = `<p class="nota">Se încarcă județele…</p>`;
            try {
                const index = await json("date/judete/index.json");
                const judete = await Promise.all(index.judete.map(j => json("date/" + j.fisier)));
                const r = reorganizare.calculeazaNational(date, vecini, judete, {});
                const a = r.inainte, d = r.dupa, P = r.parametri;
                const rand = (et, x, y) => `<tr><th scope="row">${et}</th><td>${x}</td><td>${y}</td></tr>`;
                const birouri = r.grupuri.reduce((s, g) => s + g.birouri.length, 0);
                const subPragRamase = r.grupuri.filter(g => g.subPrag).length;
                const cuComune = r.grupuri.filter(g => g.urban && g.membri.length > 1);
                const orase = cuComune.length;
                const lipite = cuComune.reduce((s, g) => s + g.membri.length - 1, 0);
                tinta.innerHTML = `
                    <table class="tabel-doc tabel-numeric" style="max-width:560px">
                        <thead><tr><th></th><th>acum</th><th>propus</th></tr></thead>
                        <tbody>
                            ${rand("Unități administrative", NF.format(a.unitati), NF.format(d.unitati))}
                            ${rand(`Unități sub ${NF.format(P.pMin)} loc.`, NF.format(a.subPrag), NF.format(d.subPrag))}
                            ${rand(`Unități sub prag în ${P.anProiectie}`, NF.format(a.subPrag2050), NF.format(d.subPrag2050))}
                            ${rand("Unități sub 3.000 loc.", NF.format(a.sub3000), NF.format(d.sub3000))}
                            ${rand("Populația mediană a unei unități", NF.format(a.mediana), NF.format(d.mediana))}
                            ${rand("Timp mediu sat → reședință", NF1.format(a.timpMediu) + " min", NF1.format(d.timpMediu) + " min")}
                            ${rand(`Sate (≥ ${P.pSatMin} loc.) la peste ${P.tMax} min`, NF.format(a.pesteTMax), NF.format(d.pesteTMax))}
                        </tbody>
                    </table>
                    <p>Cu pragul durabil de ${NF.format(P.pMin)} de locuitori (azi și la ${P.anProiectie}) și cele ${P.tMax} de minute, cele ${cate(a.unitati, "unitate administrativă", "unități administrative")} devin <b>${cate(d.unitati, "unitate", "unități")}</b> (${cate(r.judete.length, "județ calculat", "județe calculate")}${neacoperite(r)}). Dintre unitățile noi, ${NF.format(subPragRamase)} ${subPragRamase === 1 ? "rămâne" : "rămân"} sub prag — acolo unde comasarea ar coborî o minoritate sub 20% sau ar duce un sat la peste ${P.tMaxFortat} de minute de primărie — iar ${cate(lipite, "comună ajunge", "comune ajung")} în unitatea unui oraș, din ${cate(orase, "oraș", "orașe")} care au nevoie de ele ca să-și susțină rangul. Ar fi nevoie de ${cate(birouri, "birou local", "birouri locale")} în fostele reședințe.</p>
                    <p class="nota">Prețul regulii „nicio unitate sub prag”: satele cu cel puțin ${P.pSatMin} de locuitori aflate la peste ${P.tMax} de minute de reședință trec de la ${NF.format(a.pesteTMax)} la ${NF.format(d.pesteTMax)}. Toate au birou local în fosta reședință, iar limita absolută rămâne ${P.tMaxFortat} de minute.</p>`;
            } catch (e) {
                console.error(`[e-ro-adp] Scenariul național nu a putut fi calculat (${e.message}).`);
                tinta.innerHTML = `<p class="nota">Datele de accesibilitate lipsesc. Rulează <code>python unelte/accesibilitate.py</code>.</p>`;
            }
            buton.disabled = false;
        });
    }

    async function porneste(dependente) {
        try {
            const [date, cat] = await Promise.all([json(CALE_UAT), json(CALE_ATRIBUTE)]);
            randeazaCatalog(cat);
            const topo = dependente.topologie.decodeaza(date);
            const vecini = dependente.topologie.vecini(topo);
            const valori = { parametri: dependente.reorganizare.PARAMETRI_IMPLICITI };
            for (const cheie of EXEMPLE) {
                const ex = await json(`date/judete/${cheie}.json`);
                const r = dependente.reorganizare.calculeaza(date, vecini, ex);
                valori[cheie.replace("-", "_")] = randeazaExemplu(date, ex, r, document.getElementById("rezultat-" + cheie));
            }
            completeazaValori(valori);
            pregatesteNational(date, vecini, dependente.reorganizare);
        } catch (e) {
            console.error(`[e-ro-adp] Datele pentru metodologie nu au putut fi încărcate (${e.message}).`);
            document.querySelectorAll(".se-incarca").forEach(el => {
                el.textContent = "Datele nu au putut fi încărcate. Pagina trebuie servită prin HTTP.";
            });
        }
    }

    return {
        porneste: porneste
    };
}();
