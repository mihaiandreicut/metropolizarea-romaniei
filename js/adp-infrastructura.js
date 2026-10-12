/* ============================================================================
   ro-adp — indicatorii de infrastructură esențială ai unui teritoriu

   Pentru orice listă de UAT-uri (o comună comasată, un district, un județ, o
   regiune) însumează cele patru domenii urmărite: drumuri, apă și canalizare,
   educație, cultură. Stocul vine din INS TEMPO (date/infrastructura-uat.json),
   banii din execuția bugetară (date/finante-uat.json → executieUat.domenii).

   Ce nu se poate măsura azi se spune ca atare: INS nu publică starea drumurilor
   comunale pe UAT, iar „UAT cu rețea” nu înseamnă că toate gospodăriile sunt
   racordate.

   Folosit de: adp-scenariu.js (fișele de pe hartă), adp-raport.js (raportul).
   Modul independent: datele vin prin parametri.
   ========================================================================== */
window.AdpInfrastructura = function() {
    "use strict";

    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 });
    const RETELE = ["apa", "canal", "gaze"];
    // de unde se finanțează fiecare tip de acțiune, în programele 2021–2027
    const FONDURI = {
        apa: "Programul Dezvoltare Durabilă, prin operatorul regional",
        canal: "Programul Dezvoltare Durabilă, prin operatorul regional",
        strazi: "Programul Regional — dezvoltare urbană",
        drumuri: "Planul Strategic PAC — infrastructură rurală de bază",
        sanatate: "Programul Sănătate",
        educatie: "Programul Educație și Ocupare; Programul Regional",
        cultura: "LEADER, prin grupul de acțiune locală"
    };
    const PRAG_STRAZI = 75;      // % străzi orășenești modernizate sub care apare acțiunea
    const PRAG_CANALIZARE = 60;  // % canalizare față de rețeaua de apă, în km
    const DOMENII = ["drumuri", "apaCanal", "educatie", "cultura"];

    function esc(text) {
        if (text === null || text === undefined) return "";
        return String(text).replace(/[&<>"']/g, c =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
    }

    /**
     * Însumează indicatorii peste UAT-urile date (indecși în date.uat).
     * `infra` = date/infrastructura-uat.json, `finante` = date/finante-uat.json; oricare poate lipsi.
     */
    function agrega(date, infra, finante, indecsi) {
        const stoc = (infra && infra.uat) || {};
        const executie = (finante && finante.executieUat) || {};
        const a = {
            uat: indecsi.length, populatie: 0, popExecutie: 0,
            strazi: 0, straziModernizate: 0, uatCuStrazi: 0,
            elevi: 0, scoli: 0, licee: 0, biblioteci: 0, spitale: 0, spitalePublice: 0,
            bani: { drumuri: 0, apaCanal: 0, educatie: 0, cultura: 0 },
            fara: { apa: [], canal: [], gaze: [] },
            faraPop: { apa: 0, canal: 0, gaze: 0 }
        };
        RETELE.forEach(k => { a[k] = { uat: 0, populatie: 0, km: 0 }; });
        indecsi.forEach(i => {
            const u = date.uat[i];
            const p = u.p21 || 0;
            const s = stoc[u.s] || {};
            a.populatie += p;
            RETELE.forEach(k => {
                if (s[k] > 0) {
                    a[k].uat++;
                    a[k].populatie += p;
                    a[k].km += s[k];
                } else {
                    a.fara[k].push(i);
                    a.faraPop[k] += p;
                }
            });
            if (s.strazi > 0) {
                a.strazi += s.strazi;
                a.straziModernizate += s.straziModernizate || 0;
                a.uatCuStrazi++;
            }
            a.elevi += s.elevi || 0;
            a.scoli += s.scoli || 0;
            a.licee += s.licee || 0;
            a.biblioteci += s.biblioteci || 0;
            a.spitale += s.spitale || 0;
            a.spitalePublice += s.spitalePublice || 0;
            const e = executie[u.s];
            if (e && e.domenii) {
                a.popExecutie += p;
                DOMENII.forEach(d => { a.bani[d] += e.domenii[d] || 0; });
            }
        });
        a.peLocuitor = {};
        DOMENII.forEach(d => { a.peLocuitor[d] = a.popExecutie ? a.bani[d] / a.popExecutie : null; });
        return a;
    }

    const procent = (parte, intreg) => intreg ? 100 * parte / intreg : 0;
    const lei = v => v === null || v === undefined ? "—" : `${NF.format(Math.round(v))} lei/loc.`;

    /** O rețea: câți locuitori stau în UAT-uri care o au, câți km, câte UAT-uri n-au deloc. */
    function randRetea(a, cheie, eticheta, numeUat) {
        const r = a[cheie];
        const lipsa = a.fara[cheie];
        const nota = !lipsa.length ? `toate cele ${NF.format(a.uat)} UAT-uri au rețea`
            : a.uat === 1 ? "fără rețea publică raportată"
                : `fără rețea: ${lipsa.length <= 4 && numeUat
                    ? lipsa.map(numeUat).join(", ")
                    : `${NF.format(lipsa.length)} din ${NF.format(a.uat)} UAT-uri`}`;
        return {
            nume: eticheta,
            valoare: a.uat === 1
                ? (r.uat ? `${NF1.format(r.km)} km` : "—")
                : `${NF1.format(procent(r.populatie, a.populatie))}% din locuitori · ${NF.format(Math.round(r.km))} km`,
            nota: nota,
            stare: lipsa.length ? "atentie" : "ok"
        };
    }

    /**
     * Rândurile fișei: { nume, valoare, nota, stare }. `numeUat(i)` dă numele unui UAT,
     * pentru notele scurte („fără rețea: Bruiu, Chirpăr”).
     */
    function randuri(a, an, numeUat) {
        const lista = [
            randRetea(a, "apa", "Apă potabilă", numeUat),
            randRetea(a, "canal", "Canalizare", numeUat)
        ];
        if (a.apa.km > 0) {
            lista[1].nota += ` · ${NF.format(Math.round(procent(a.canal.km, a.apa.km)))}% din lungimea rețelei de apă`;
        }
        lista.push(randRetea(a, "gaze", "Gaze", numeUat));
        lista.push({
            nume: "Drumuri și străzi",
            valoare: a.strazi
                ? `${NF.format(Math.round(procent(a.straziModernizate, a.strazi)))}% străzi orășenești modernizate`
                : "stare nepublicată",
            nota: (a.strazi
                ? `${NF.format(Math.round(a.straziModernizate))} din ${NF.format(Math.round(a.strazi))} km, în ${a.uatCuStrazi === 1 ? "oraș" : `${NF.format(a.uatCuStrazi)} orașe`}; `
                : "INS nu publică starea drumurilor comunale pe UAT; ") +
                `cheltuit ${an || ""}: ${lei(a.peLocuitor.drumuri)}`,
            stare: a.strazi ? (procent(a.straziModernizate, a.strazi) >= 75 ? "ok" : "atentie") : "info"
        });
        lista.push({
            nume: "Educație",
            valoare: `${NF.format(a.elevi)} copii și elevi · ${NF.format(a.scoli)} unități`,
            nota: `${a.licee ? `${NF.format(a.licee)} ${a.licee === 1 ? "liceu" : "licee"}` : "fără liceu"}; ` +
                `cheltuit ${an || ""}: ${lei(a.peLocuitor.educatie)}`,
            stare: a.licee ? "ok" : "info"
        });
        lista.push({
            nume: "Cultură",
            valoare: `${NF.format(a.biblioteci)} ${a.biblioteci === 1 ? "bibliotecă" : "biblioteci"}`,
            nota: `cheltuit ${an || ""}: ${lei(a.peLocuitor.cultura)}`,
            stare: a.biblioteci ? "ok" : "atentie"
        });
        lista.push({
            nume: "Sănătate",
            valoare: a.spitale ? `${NF.format(a.spitale)} ${a.spitale === 1 ? "spital" : "spitale"}` : "fără spital",
            nota: a.spitale ? `din care ${NF.format(a.spitalePublice)} ${a.spitalePublice === 1 ? "public" : "publice"}`
                : "niciun spital pe acest teritoriu",
            stare: a.spitalePublice ? "ok" : a.spitale ? "info" : "info"
        });
        lista.splice(2, 0, {
            nume: "Apă și canalizare, bani",
            valoare: lei(a.peLocuitor.apaCanal),
            nota: `din bugetul local, ${an || ""}; investițiile mari trec prin operatorul regional`,
            stare: "info"
        });
        return lista;
    }

    /**
     * Ce e de făcut într-un teritoriu, dedus din golurile lui: fiecare acțiune cu tipul ei,
     * locuitorii vizați și sursa de finanțare. Ordinea e cea a urgenței: apă, canalizare,
     * sănătate, educație, drumuri, cultură.
     */
    function actiuni(a, numeUat) {
        const unde = lista => lista.length <= 4 && numeUat ? lista.map(numeUat).join(", ")
            : `${NF.format(lista.length)} UAT-uri`;
        const lista = [];
        if (a.fara.apa.length) {
            lista.push({
                tip: "apa", populatie: a.faraPop.apa, fond: FONDURI.apa,
                text: `Rețea publică de apă în ${unde(a.fara.apa)}`
            });
        }
        if (a.fara.canal.length) {
            lista.push({
                tip: "canal", populatie: a.faraPop.canal, fond: FONDURI.canal,
                text: `Canalizare în ${unde(a.fara.canal)}`
            });
        } else if (a.apa.km && 100 * a.canal.km / a.apa.km < PRAG_CANALIZARE) {
            lista.push({
                tip: "canal", populatie: a.populatie, fond: FONDURI.canal,
                text: `Extinderea canalizării: are ${NF.format(Math.round(100 * a.canal.km / a.apa.km))}% din lungimea rețelei de apă`
            });
        }
        if (!a.spitalePublice) {
            lista.push({
                tip: "sanatate", populatie: a.populatie, fond: FONDURI.sanatate,
                text: "Fără spital public: centru de permanență și transport cadențat la spitalul cel mai apropiat"
            });
        }
        if (!a.licee) {
            lista.push({
                tip: "educatie", populatie: a.populatie, fond: FONDURI.educatie,
                text: "Fără liceu: transport școlar spre liceul cel mai apropiat"
            });
        }
        if (a.strazi && 100 * a.straziModernizate / a.strazi < PRAG_STRAZI) {
            lista.push({
                tip: "strazi", populatie: a.populatie, fond: FONDURI.strazi,
                text: `Modernizarea străzilor orășenești: ${NF.format(Math.round(a.strazi - a.straziModernizate))} km rămași`
            });
        }
        if (a.uat > a.uatCuStrazi) {
            lista.push({
                tip: "drumuri", populatie: null, fond: FONDURI.drumuri,
                text: "Registrul drumurilor comunale: starea lor nu e publicată nicăieri pe UAT"
            });
        }
        if (!a.biblioteci) {
            lista.push({
                tip: "cultura", populatie: a.populatie, fond: FONDURI.cultura,
                text: "Fără bibliotecă publică"
            });
        }
        return lista;
    }

    /** Planul de acțiuni ca listă HTML. */
    function planActiuni(a, titlu, numeUat) {
        const lista = actiuni(a, numeUat);
        if (!lista.length) return "";
        return `<h4 class="subtitlu-sectiune">${esc(titlu)}</h4>
            <ol class="pasi-dosar">${lista.map(x => `<li><b>${esc(x.text)}</b>${x.populatie
                ? ` — ${NF.format(x.populatie)} loc.` : ""}<br><small>${esc(x.fond)}</small></li>`).join("")}</ol>`;
    }

    /** Fișa ca tabel HTML, cu aceleași clase ca dosarul unei unități. */
    function tabel(a, titlu, an, numeUat) {
        const linii = randuri(a, an, numeUat).map(r => `
            <tr class="${r.stare === "atentie" ? "c-derogare" : ""}">
                <th scope="row">${esc(r.nume)}</th>
                <td>${esc(r.valoare)}</td>
                <td><small>${esc(r.nota)}</small></td>
            </tr>`).join("");
        return `<h4 class="subtitlu-sectiune">${esc(titlu)}</h4>
            <table class="tabel-atribute tabel-dosar"><tbody>${linii}</tbody></table>`;
    }

    return {
        agrega: agrega,
        randuri: randuri,
        tabel: tabel,
        actiuni: actiuni,
        planActiuni: planActiuni,
        FONDURI: FONDURI
    };
}();
