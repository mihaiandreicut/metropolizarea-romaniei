/* ============================================================================
   ro-adp — raportul comparativ (raport.html): cifrele de azi și cele propuse,
   calculate pe loc cu aceleași module ca harta, ca să nu se desincronizeze.

   Patru lucruri se adaugă față de scenariul de pe hartă:
     * costul administrației, din execuția bugetară a fiecărei primării (2025);
     * testul moldovenesc: cheltuiala cu aparatul sub 30% din veniturile proprii;
     * numărul aleșilor, după scările din Codul administrativ (art. 112 și 171);
     * numărul de oficii, pe cele patru paliere ale modelului propus.

   Modul independent: topologia, algoritmul de reorganizare și cel de
   regionalizare vin prin porneste(dependente); legătura se face în raport.html.
   ========================================================================== */
window.AdpRaport = function() {
    "use strict";

    const CALE_UAT = "date/romania-uat.json";
    const CALE_INDEX = "date/judete/index.json";
    const CALE_FINANTE = "date/finante-uat.json";
    const CALE_DOTARI = "date/dotari-uat.json";
    const CALE_INSTITUTII = "date/regiuni-institutii.json";
    const CALE_INFRA = "date/infrastructura-uat.json";
    const CALE_CORECTII = "date/corectii-districte.json";
    const CALE_JUDECATORII = "date/judecatorii-uat.json";
    const CALE_GAL = "date/gal-uat.json";
    const CALE_INSTITUTII_JUDETENE = "date/institutii-judetene.json";
    const CALE_PERSONAL = "date/personal-judete.json";
    // costul unui salariat pentru angajator: câștigul brut plus contribuția asiguratorie pentru muncă
    const COST_ANGAJATOR = 1.0225;
    // ipoteză pentru instituțiile statului din județ: conducerea și funcțiile de suport (economic,
    // resurse umane, juridic, achiziții, administrativ), circa 30% din personal, se strâng la
    // regiune într-o treime din mărimea lor — adică o reducere de 20% a personalului
    const REDUCERE_STAT = 0.2;
    // ipoteză pentru numărul funcțiilor de conducere: un director și un adjunct la fiecare instituție
    const FUNCTII_PE_INSTITUTIE = 2;
    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 });
    // Codul administrativ, art. 112: consilieri locali, după populație
    const CONSILIERI_LOCALI = [[1500, 9], [3000, 11], [5000, 13], [10000, 15], [20000, 17],
        [50000, 19], [100000, 21], [200000, 23], [400000, 27], [Infinity, 31]];
    // Codul administrativ, art. 171: consilieri județeni (plus președintele)
    const CONSILIERI_JUDETENI = [[350000, 30], [500000, 32], [650000, 34], [Infinity, 36]];
    // ipoteza de cost: unitatea nouă păstrează aparatul reședinței, plus un sfert din
    // aparatul fiecărei primării desființate, pentru punctele de lucru din sate
    const COTA_BIROURI = 0.25;
    const PRAG_ADMINISTRATIE = 30;   // % din veniturile proprii (Republica Moldova)
    // propunerea de reducere a reprezentării: dublarea populației pentru un consilier
    const FACTOR_CONSILIERI = 2;
    // anul 1 se duce pe tranziție (alegeri, sedii, sisteme, plăți compensatorii)
    const COTA_TRANZITIE = 0.5;
    const ANI_PROIECTIE = [1, 3, 5, 9, 15, 25];
    // din aparatul consiliilor județene, jumătate se consideră preluat de personalul tehnic
    // al districtelor și al regiunii; cealaltă jumătate dispare odată cu structura
    const COTA_CJ_PASTRATA = 0.5;
    // economia cumulată din tabelele pe teritorii: aceleași ipoteze ca fișele de pe hartă
    const INFLATIE = 0.03;
    const ANI_ECONOMIE = 10;
    // LEADER 2023–2027: circa 425 mil. € din FEADR și 150 mil. € din FSE+ (cifre comunicate public în 2026)
    const BUGET_LEADER_MIL_EURO = 575;
    // LEADER acoperă comunele și orașele de cel mult atâția locuitori
    const PRAG_ORAS_LEADER = 20000;
    // zona rurală funcțională, în definiția Comisiei Europene: orașul-târg și împrejurimile, cel puțin atâția locuitori
    const PRAG_ZONA_RURALA = 25000;

    const $ = sel => document.querySelector(sel);

    function esc(text) {
        if (text === null || text === undefined) return "";
        return String(text).replace(/[&<>"']/g, c =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
    }

    async function json(cale, obligatoriu) {
        const r = await fetch(cale);
        if (!r.ok) {
            if (obligatoriu) throw new Error(`${cale}: HTTP ${r.status}`);
            return null;
        }
        return r.json();
    }

    const dupaScara = (scara, p) => (scara.find(([prag]) => p <= prag) || scara[scara.length - 1])[1];
    /** Aceeași scară, dar cu pragurile de populație înmulțite: mai puțini aleși. */
    const scaraLargita = (scara, factor) => scara.map(([prag, nr]) => [prag * factor, nr]);
    const lei = v => v === null || v === undefined ? "—"
        : Math.abs(v) >= 1e9 ? `${NF1.format(v / 1e9)} mld. lei`
            : Math.abs(v) >= 1e6 ? `${NF1.format(v / 1e6)} mil. lei` : `${NF.format(Math.round(v))} lei`;

    /** Execuția bugetară a unui UAT, potrivită după numele primăriei din județul lui. */
    function indexeazaExecutia(date, finante) {
        if (!finante || !finante.executie) return new Map();
        const tabel = str => str.toUpperCase()
            .replace(/[ĂÂ]/g, "A").replace(/Î/g, "I").replace(/[ȘŞ]/g, "S").replace(/[ȚŢ]/g, "T")
            .replace(/^(PRIMARIA|MUNICIPIUL|ORASUL|COMUNA)\s+/g, "").replace(/[\s-]+/g, " ").trim();
        const dupaJudet = new Map();
        date.judete.forEach(j => dupaJudet.set(j.auto, j.c));
        const cauta = new Map();
        Object.values(finante.executie).forEach(e => {
            const judet = dupaJudet.get(e.judet);
            if (judet === undefined) return;
            cauta.set(`${judet}|${tabel(e.nume)}`, e);
        });
        const index = new Map();
        date.uat.forEach((u, i) => {
            const e = cauta.get(`${u.j}|${tabel(u.n)}`);
            if (e) index.set(i, e);
        });
        return index;
    }

    /** Costul aparatului și veniturile proprii, azi și în scenariul propus. */
    function costuri(date, r, executie, finante) {
        let aparatAcum = 0, venituriAcum = 0, pesteAcum = 0, cuDate = 0;
        executie.forEach(e => {
            aparatAcum += e.cheltuieliAparat || 0;
            venituriAcum += e.venituriProprii || 0;
            if (e.pondere !== null && e.pondere > PRAG_ADMINISTRATIE) pesteAcum++;
            cuDate++;
        });
        let aparatDupa = 0, pesteDupa = 0, cuDateDupa = 0;
        r.grupuri.forEach(g => {
            const ale = g.membri.map(i => executie.get(i)).filter(Boolean);
            if (!ale.length) return;
            cuDateDupa++;
            const sediu = executie.get(g.sediu);
            const altele = ale.filter(e => e !== sediu);
            const cost = (sediu ? sediu.cheltuieliAparat : Math.max(...ale.map(e => e.cheltuieliAparat))) +
                COTA_BIROURI * altele.reduce((a, e) => a + (e.cheltuieliAparat || 0), 0);
            const venituri = ale.reduce((a, e) => a + (e.venituriProprii || 0), 0);
            aparatDupa += cost;
            if (venituri > 0 && 100 * cost / venituri > PRAG_ADMINISTRATIE) pesteDupa++;
        });
        let cheltuieliTotal = 0, investitii = 0;
        executie.forEach(e => {
            cheltuieliTotal += e.cheltuieliTotal || 0;
            investitii += e.investitii || 0;
        });
        const cj = Object.values((finante && finante.consiliiJudetene) || {});
        const aparatCJ = cj.reduce((a, x) => a + (x.cheltuieliAparat || 0), 0);
        const economieCJ = aparatCJ * (1 - COTA_CJ_PASTRATA);
        const economiePrimarii = aparatAcum - aparatDupa;
        const economie = economiePrimarii + economieCJ;
        const proiectie = ANI_PROIECTIE.map(ani => {
            // anul 1 se duce pe tranziție; din anul 2 economia e întreagă
            const cumulat = ani === 1 ? economie * (1 - COTA_TRANZITIE)
                : economie * (1 - COTA_TRANZITIE) + economie * (ani - 1);
            return {
                ani: ani,
                cumulat: cumulat,
                investitiiCuEconomie: investitii + economie,
                coteParte: cheltuieliTotal ? 100 * (investitii + economie) / cheltuieliTotal : null
            };
        });
        return {
            cuDate: cuDate, cuDateDupa: cuDateDupa,
            cheltuieliTotal: cheltuieliTotal,
            investitii: investitii,
            economie: economie,
            economiePrimarii: economiePrimarii,
            aparatCJ: aparatCJ,
            economieCJ: economieCJ,
            nrCJ: cj.length,
            proiectie: proiectie,
            aparat: { inainte: aparatAcum, dupa: aparatDupa },
            venituriProprii: venituriAcum,
            pondere: {
                inainte: venituriAcum ? 100 * aparatAcum / venituriAcum : null,
                dupa: venituriAcum ? 100 * aparatDupa / venituriAcum : null
            },
            pestePrag: { inainte: pesteAcum, dupa: pesteDupa }
        };
    }

    /** Aleșii și oficiile, pe cele două structuri. */
    /**
     * Regiunile proiectului sunt cele 8 regiuni de dezvoltare existente (Legea 315/2004),
     * cu București–Ilfov ca Metropolă. Nu se simulează alt desen: regiunile sunt date.
     */
    function regiuniDezvoltare(date) {
        const pop = new Map();
        date.uat.forEach(u => pop.set(u.adr, (pop.get(u.adr) || 0) + (u.p21 || 0)));
        return date.adr.map(a => ({
            cod: a.c,
            nume: a.n === "București-Ilfov" ? "București–Ilfov (Metropola)" : a.n,
            populatie: pop.get(a.c) || 0,
            metropola: a.n === "București-Ilfov"
        }));
    }

    function structura(date, r, regional) {
        const uatAcum = date.uat;
        const consilieriAcum = uatAcum.reduce((a, u) => a + dupaScara(CONSILIERI_LOCALI, u.p21 || 0), 0);
        const popJudet = new Map();
        uatAcum.forEach(u => popJudet.set(u.j, (popJudet.get(u.j) || 0) + (u.p21 || 0)));
        let judeteni = 0;
        popJudet.forEach(p => { judeteni += dupaScara(CONSILIERI_JUDETENI, p) + 1; });

        const scaraNoua = scaraLargita(CONSILIERI_LOCALI, FACTOR_CONSILIERI);
        const scaraRegionala = scaraLargita(CONSILIERI_JUDETENI, FACTOR_CONSILIERI);
        const consilieriDupa = r.grupuri.reduce((a, g) => a + dupaScara(scaraNoua, g.populatie), 0);
        const regiuni = regiuniDezvoltare(date);
        // Consiliul județean devine consiliu regional: consilieri aleși, pe scara județeană socotită
        // la dublul populației, cu locurile împărțite pe județe după populație. Districtul rămâne
        // condus de primarii deja aleși, fără mandate în plus.
        const adrJudet = new Map();
        uatAcum.forEach(u => adrJudet.set(u.j, u.adr));
        const consiliiRegionale = regiuni.map(reg => {
            const judete = date.judete.filter(j => adrJudet.get(j.c) === reg.cod)
                .map(j => ({ nume: j.n, populatie: popJudet.get(j.c) || 0 }));
            const locuri = dupaScara(scaraRegionala, reg.populatie);
            // împărțire proporțională, cu cel mai mare rest
            const cote = judete.map(j => locuri * j.populatie / (reg.populatie || 1));
            const impartite = cote.map(Math.floor);
            cote.map((c, k) => ({ k: k, rest: c - Math.floor(c) })).sort((a, b) => b.rest - a.rest)
                .slice(0, locuri - impartite.reduce((a, v) => a + v, 0)).forEach(x => { impartite[x.k]++; });
            return {
                nume: reg.nume, populatie: reg.populatie, locuri: locuri,
                judete: judete.map((j, k) => ({ nume: j.nume, populatie: j.populatie, locuri: impartite[k] }))
                    .sort((a, b) => b.locuri - a.locuri)
            };
        });
        // ca la județ: consilierii, plus președintele
        const regionali = consiliiRegionale.reduce((a, x) => a + x.locuri + 1, 0);

        return {
            unitati: { inainte: uatAcum.length, dupa: r.grupuri.length + r.neacoperite.length },
            primari: { inainte: uatAcum.length, dupa: r.grupuri.length + r.neacoperite.length },
            consilieriLocali: { inainte: consilieriAcum, dupa: consilieriDupa },
            consilieriSuperiori: { inainte: judeteni, dupa: regionali },
            alesi: {
                inainte: uatAcum.length + consilieriAcum + judeteni,
                dupa: r.grupuri.length + r.neacoperite.length + consilieriDupa + regionali
            },
            oficii: {
                // azi: o primărie în fiecare UAT, un consiliu județean și o prefectură în fiecare județ
                inainte: uatAcum.length + 2 * popJudet.size,
                // propus: o primărie în fiecare unitate, un oficiu de plasă, unul județean, unul regional
                dupa: r.grupuri.length + r.neacoperite.length + (r.districte ? r.districte.length : 0) +
                    popJudet.size + regiuni.length
            },
            mandateJudetene: judeteni,
            mandateRegionale: regionali,
            consiliiRegionale: consiliiRegionale,
            districte: r.districte ? r.districte.length : null,
            districteMetropolitane: r.districte ? r.districte.filter(x => x.tip === "metropolitan").length : null,
            districtePragUE: r.districte ? r.districte.filter(x => !x.praguriUE.potrivit).length : null,
            regiuni: regiuni.length
        };
    }

    // ------------------------------------------------------------ randare
    function randPereche(eticheta, inainte, dupa, nota) {
        return `<tr><th scope="row">${eticheta}</th><td>${inainte}</td><td>${dupa}</td>
            <td><small>${nota || ""}</small></td></tr>`;
    }

    function randeazaRezumat(r, c, s) {
        const scadere = (a, b) => a && b !== null ? `${b < a ? "−" : "+"}${NF1.format(Math.abs(100 * (b - a) / a))}%` : "—";
        $("#rezumat-cifre").innerHTML = `
            <table class="tabel-doc tabel-numeric">
                <thead><tr><th></th><th>azi</th><th>propus</th><th>diferență</th></tr></thead>
                <tbody>
                    ${randPereche("Unități administrative", NF.format(s.unitati.inainte), NF.format(s.unitati.dupa), scadere(s.unitati.inainte, s.unitati.dupa))}
                    ${randPereche("Populația mediană a unei unități", NF.format(r.inainte.mediana), NF.format(r.dupa.mediana), scadere(r.inainte.mediana, r.dupa.mediana))}
                    ${randPereche("Unități sub pragul de 5.000 loc.", NF.format(r.inainte.subPrag), NF.format(r.dupa.subPrag), scadere(r.inainte.subPrag, r.dupa.subPrag))}
                    ${randPereche("Costul aparatului administrativ (an)", lei(c.aparat.inainte), lei(c.aparat.dupa), scadere(c.aparat.inainte, c.aparat.dupa))}
                    ${randPereche("Aleși (primari + consilieri)", NF.format(s.alesi.inainte), NF.format(s.alesi.dupa), scadere(s.alesi.inainte, s.alesi.dupa))}
                    ${randPereche("Sedii administrative", NF.format(s.oficii.inainte), NF.format(s.oficii.dupa), scadere(s.oficii.inainte, s.oficii.dupa))}
                    ${randPereche("Drum mediu sat → reședință", NF1.format(r.inainte.timpMediu) + " min", NF1.format(r.dupa.timpMediu) + " min", scadere(r.inainte.timpMediu, r.dupa.timpMediu))}
                </tbody>
            </table>
            <p>Pe scurt: <b>${NF.format(s.unitati.inainte)}</b> de unități devin <b>${NF.format(s.unitati.dupa)}</b>,
                aparatul administrativ costă cu <b>${lei(c.aparat.inainte - c.aparat.dupa)}</b> pe an mai puțin
                (${NF1.format(100 * (c.aparat.inainte - c.aparat.dupa) / c.aparat.inainte)}% din cheltuiala de azi),
                iar numărul aleșilor scade de la ${NF.format(s.alesi.inainte)} la ${NF.format(s.alesi.dupa)}.
                În schimb, drumul mediu până la primărie crește de la ${NF1.format(r.inainte.timpMediu)} la
                ${NF1.format(r.dupa.timpMediu)} minute.</p>`;
    }

    function randeazaDiagnostic(c) {
        const procent = c.pestePrag.inainte / c.cuDate * 100;
        $("#diagnostic-cifre").innerHTML = `
            <table class="tabel-doc tabel-numeric">
                <thead><tr><th></th><th>azi</th><th>propus</th><th></th></tr></thead>
                <tbody>
                    ${randPereche("Primării cu date de execuție (2025)", NF.format(c.cuDate), NF.format(c.cuDateDupa), "unități comparabile")}
                    ${randPereche(`Peste pragul de ${PRAG_ADMINISTRATIE}%`, NF.format(c.pestePrag.inainte), NF.format(c.pestePrag.dupa), "aparatul administrativ raportat la veniturile proprii")}
                    ${randPereche("Aparatul administrativ, în total", lei(c.aparat.inainte), lei(c.aparat.dupa), "capitolele „Autorități executive” și „Alte servicii publice generale”")}
                    ${randPereche("Venituri proprii, în total", lei(c.venituriProprii), lei(c.venituriProprii), "neschimbate: aceleași impozite, alte unități")}
                    ${randPereche("Cât din veniturile proprii", NF1.format(c.pondere.inainte) + "%", NF1.format(c.pondere.dupa) + "%", `pragul moldovenesc: ${PRAG_ADMINISTRATIE}%`)}
                </tbody>
            </table>
            <p><b>${NF.format(c.pestePrag.inainte)} din ${NF.format(c.cuDate)} de primării</b>
                (${NF1.format(procent)}%) cheltuiesc astăzi pe propriul aparat mai mult decât pragul de
                ${PRAG_ADMINISTRATIE}% din veniturile proprii — testul pe care Republica Moldova îl folosește ca
                să stabilească dacă o unitate se poate întreține. La nivelul întregii țări, administrația locală
                consumă ${NF1.format(c.pondere.inainte)}% din veniturile proprii ale primăriilor. După comasare,
                cu ipoteza de cost de mai jos, raportul coboară la ${NF1.format(c.pondere.dupa)}%, iar numărul
                unităților peste prag scade la ${NF.format(c.pestePrag.dupa)}.</p>`;
    }

    function randeazaImpact(c) {
        const tinta = document.querySelector("#impact-financiar");
        if (!tinta) return;
        const randuri = c.proiectie.map(p => `<tr>
            <th scope="row">${p.ani} ${p.ani === 1 ? "an" : "ani"}</th>
            <td>${lei(p.cumulat)}</td>
            <td>${lei(p.investitiiCuEconomie)}</td>
            <td>${NF1.format(p.coteParte)}%</td>
        </tr>`).join("");
        tinta.innerHTML = `
            <table class="tabel-doc tabel-numeric" style="max-width:640px">
                <thead><tr><th>Bugetele locale, 2025</th><th>lei</th><th>din cheltuieli</th></tr></thead>
                <tbody>
                    <tr><th scope="row">Cheltuieli totale</th><td>${lei(c.cheltuieliTotal)}</td><td>100%</td></tr>
                    <tr><th scope="row">Aparat administrativ</th><td>${lei(c.aparat.inainte)}</td><td>${NF1.format(100 * c.aparat.inainte / c.cheltuieliTotal)}%</td></tr>
                    <tr><th scope="row">Investiții (capital și fonduri europene)</th><td>${lei(c.investitii)}</td><td>${NF1.format(100 * c.investitii / c.cheltuieliTotal)}%</td></tr>
                    <tr><th scope="row">Aparat administrativ, după reformă</th><td>${lei(c.aparat.dupa)}</td><td>${NF1.format(100 * c.aparat.dupa / c.cheltuieliTotal)}%</td></tr>
                    <tr><th scope="row"><b>Economie anuală</b></th><td><b>${lei(c.economie)}</b></td><td>${NF1.format(100 * c.economie / c.cheltuieliTotal)}%</td></tr>
                </tbody>
            </table>
            <h3>Proiecția, dacă economia se duce integral în investiții</h3>
            <table class="tabel-doc tabel-numeric" style="max-width:640px">
                <thead><tr><th>Orizont</th><th>economie cumulată</th><th>investiții anuale</th><th>din cheltuieli</th></tr></thead>
                <tbody>${randuri}</tbody>
            </table>
            <p class="nota">Primul an se duce pe tranziție — alegeri, comasarea aparatelor, sisteme informatice,
                plăți compensatorii —, estimat la jumătate din economia anuală; din al doilea an economia e
                întreagă. Cifrele sunt în lei de azi, fără inflație și fără creșterea economică, ca să rămână
                comparabile. Nu sunt incluse economiile din achiziții comune la nivel de district, nici
                veniturile din clădirile administrative eliberate.</p>`;
    }

    function randeazaGuvernanta(r, c, s) {
        const tinta = document.querySelector("#guvernanta-cifre");
        if (!tinta) return;
        tinta.innerHTML = `
            <table class="tabel-doc tabel-numeric" style="max-width:720px">
                <thead><tr><th></th><th>azi</th><th>în model</th></tr></thead>
                <tbody>
                    <tr><th scope="row">Scrutine locale</th><td>3 (primar, consiliu local, consiliu județean + președinte)</td><td>2 (primar și consiliu local; consiliu regional)</td></tr>
                    <tr><th scope="row">Primari</th><td>${NF.format(s.primari.inainte)}</td><td>${NF.format(s.primari.dupa)}</td></tr>
                    <tr><th scope="row">Consilieri locali</th><td>${NF.format(s.consilieriLocali.inainte)}</td><td>${NF.format(s.consilieriLocali.dupa)}</td></tr>
                    <tr><th scope="row">Consilieri județeni → regionali</th><td>${NF.format(s.mandateJudetene)}</td><td>${NF.format(s.mandateRegionale)}</td></tr>
                    <tr><th scope="row">Locuri în consiliile de district</th><td>—</td><td>${NF.format(s.primari.dupa)} (toți primarii, neremunerat)</td></tr>
                    <tr><th scope="row">Aparatul consiliilor județene</th><td>${lei(c.aparatCJ)} pe an</td><td>${lei(c.aparatCJ * COTA_CJ_PASTRATA)} pe an</td></tr>
                    <tr><th scope="row"><b>Economie totală pe an</b></th><td>—</td><td><b>${lei(c.economie)}</b>
                        <small>(${lei(c.economiePrimarii)} din primării, ${lei(c.economieCJ)} din consiliile județene)</small></td></tr>
                </tbody>
            </table>
            <h3>Consiliile regionale: locurile, pe județe</h3>
            <div class="tabel-derulant"><table class="tabel-doc">
                <thead><tr><th>Regiunea</th><th>Locuitori</th><th>Consilieri</th><th>Locurile fiecărui județ, după populație</th></tr></thead>
                <tbody>${s.consiliiRegionale.map(x => `<tr>
                    <th scope="row">${esc(x.nume)}</th>
                    <td class="num">${NF.format(x.populatie)}</td>
                    <td class="num"><b>${NF.format(x.locuri)}</b></td>
                    <td>${x.judete.map(j => `${esc(j.nume)} <b>${j.locuri}</b>`).join(" · ")}</td>
                </tr>`).join("")}</tbody>
            </table></div>
            <p class="nota">Numărul de consilieri vine din scara consiliilor județene de azi (Codul administrativ,
                art. 171), aplicată la dublul populației. Fiecare județ e o circumscripție; locurile se împart
                proporțional cu populația, cu regula celui mai mare rest. La total se adaugă câte un președinte.</p>`;
    }

    function randeazaComparatie(r, c, s, dotari) {
        const nrDotari = dotari ? Object.keys(dotari.localitati || {}).length : 0;
        $("#comparatie-tabel").innerHTML = `
            <div class="tabel-derulant"><table class="tabel-doc tabel-numeric">
                <thead><tr><th>Reper</th><th>azi</th><th>propus</th><th>sursa / ipoteza</th></tr></thead>
                <tbody>
                    ${randPereche("Unități de bază", NF.format(s.unitati.inainte), NF.format(s.unitati.dupa), "scenariul implicit, calculat în pagină")}
                    ${randPereche("Populația mediană", NF.format(r.inainte.mediana), NF.format(r.dupa.mediana), "RPL 2021")}
                    ${randPereche("Unități sub 3.000 loc.", NF.format(r.inainte.sub3000), NF.format(r.dupa.sub3000), "RPL 2021")}
                    ${randPereche(`Unități sub prag în ${r.parametri.anProiectie}`, NF.format(r.inainte.subPrag2050), NF.format(r.dupa.subPrag2050), "proiecție pe trendul 2011–2024")}
                    ${randPereche("Primari", NF.format(s.primari.inainte), NF.format(s.primari.dupa), "unul pe unitate")}
                    ${randPereche("Consilieri locali", NF.format(s.consilieriLocali.inainte), NF.format(s.consilieriLocali.dupa), "Codul administrativ, art. 112")}
                    ${randPereche("Consilieri județeni → regionali", NF.format(s.consilieriSuperiori.inainte), NF.format(s.consilieriSuperiori.dupa), "consilieri și președinți (art. 171); consiliul regional ia locul consiliilor județene, cu locuri pe județe după populație")}
                    ${randPereche("Consilii de administrare neremunerate", "—", NF.format(s.districte), `${NF.format(s.districte)} de districte, conduse de primarii în funcție`)}
                    ${randPereche("Aparatul consiliilor județene (an)", lei(c.aparatCJ), lei(c.aparatCJ * COTA_CJ_PASTRATA), `ipoteză: ${Math.round(COTA_CJ_PASTRATA * 100)}% trece la personalul tehnic al districtelor și regiunii`)}
                    ${randPereche("Nivel intermediar", "—", NF.format(s.districte) + " districte", "conduse de consiliul primarilor, cu vot ponderat; fără consilii alese separat")}
                    ${randPereche("Din care zone metropolitane", "—", NF.format(s.districteMetropolitane), "districtul cu municipiu în centru")}
                    ${randPereche("Districte în afara pragurilor europene", "—", NF.format(s.districtePragUE), "LEADER: 10.000–150.000 loc. în comune și orașe sub 20.000; orașele mai mari merg pe strategia lor urbană")}
                    ${randPereche("Nivel superior", "41 de consilii județene alese", s.regiuni + " consilii regionale alese", "cele 8 regiuni de dezvoltare de azi (Legea 315/2004), cu București–Ilfov ca Metropolă")}
                    ${randPereche("Sedii administrative", NF.format(s.oficii.inainte), NF.format(s.oficii.dupa), "primării + CJ + prefecturi → primării + districte + oficii județene + regiuni")}
                    ${randPereche("Costul aparatului (an)", lei(c.aparat.inainte), lei(c.aparat.dupa), `ipoteză: unitatea nouă păstrează aparatul reședinței + ${Math.round(COTA_BIROURI * 100)}% din al fiecărei primării desființate`)}
                    ${randPereche("Drum mediu la reședință", NF1.format(r.inainte.timpMediu) + " min", NF1.format(r.dupa.timpMediu) + " min", "timpi rutieri OSRM")}
                    ${randPereche(`Sate la peste ${r.parametri.tMax} min`, NF.format(r.inainte.pesteTMax), NF.format(r.dupa.pesteTMax), "sate cu cel puțin 50 de locuitori")}
                    ${randPereche("Sate cu delegat și fond propriu", "0", NF.format(r.sate.length), "Codul administrativ, art. 142 + fond sătesc")}
                    ${randPereche("Localități cu farmacie sau poștă", NF.format(nrDotari), NF.format(nrDotari), "registrele MS și Poșta Română — neschimbate de reformă")}
                </tbody>
            </table></div>`;
    }

    function randeazaRepere(r, s, c) {
        const pop = 19053815;
        const rand = (tara, unitati, medie, nota) => `<tr>
            <th scope="row">${esc(tara)}</th><td>${unitati}</td><td>${medie}</td><td><small>${esc(nota)}</small></td></tr>`;
        $("#repere-tabel").innerHTML = `
            <div class="tabel-derulant"><table class="tabel-doc tabel-numeric">
                <thead><tr><th>Țara</th><th>Unități de bază</th><th>Populația medie</th><th>Observații</th></tr></thead>
                <tbody>
                    ${rand("România, azi", NF.format(s.unitati.inainte), NF.format(Math.round(pop / s.unitati.inainte)),
            `${NF1.format(c.pondere.inainte)}% din veniturile proprii se duc pe aparatul administrativ`)}
                    ${rand("România, propus", NF.format(s.unitati.dupa), NF.format(Math.round(pop / s.unitati.dupa)),
                `${NF1.format(c.pondere.dupa)}% din veniturile proprii, cu ipoteza de cost din raport`)}
                    ${rand("Polonia", "2.478 de gmine", "15.174", "nu le-a comasat: erau deja mari din 1973; 380 de powiaturi și 16 voievodate deasupra")}
                    ${rand("Danemarca", "98 de comune", "61.000", "reforma din 2007: 271 → 98, prag 20.000 de locuitori")}
                    ${rand("Estonia", "79 de municipalități", "17.000", "reforma din 2017: 213 → 79, prag 5.000, întâi voluntar")}
                    ${rand("Republica Moldova", "893 de UAT-uri", "2.900", "peste 56% sub pragul legal de 1.500; amalgamare voluntară din 2023")}
                </tbody>
            </table></div>
            <p>Dacă România ar avea densitatea de unități a Poloniei, ar ieși circa
                ${NF.format(Math.round(pop / 15174))} de comune — foarte aproape de cele
                ${NF.format(s.unitati.dupa)} din scenariul propus. Dacă ar avea-o pe cea a Danemarcei, ar ieși
                circa ${NF.format(Math.round(pop / 61000))}, ceea ce ar însemna unități de mărimea unui județ mic.</p>`;
    }

    function randeazaIpoteze(r, c, s) {
        $("#ipoteze").innerHTML = `
            <ol>
                <li><b>Scenariul de comasare</b> e cel implicit din hartă: prag ${NF.format(r.parametri.pMin)}–${NF.format(r.parametri.pTinta)}
                    de locuitori (${NF.format(r.parametri.pMinOras)}–${NF.format(r.parametri.pTintaOras)} cu oraș),
                    maximum ${r.parametri.tMax} de minute până la reședință, limită absolută ${r.parametri.tMaxFortat} de minute,
                    praguri legale pe rang, prag durabil verificat și în proiecția la ${r.parametri.anProiectie}.
                    ${NF.format(r.judete.length)} de județe calculate.</li>
                <li><b>Costul aparatului administrativ</b> = capitolele „Autorități executive” și „Alte servicii
                    publice generale” din execuția bugetară ${NF.format(c.cuDate)} de primării, anul 2025.
                    Veniturile proprii = toate capitolele de venituri, mai puțin sumele defalcate din TVA,
                    subvențiile, fondurile europene și operațiunile financiare.</li>
                <li><b>Ipoteza de după comasare</b>: unitatea nouă păstrează aparatul primăriei-reședință și
                    ${Math.round(COTA_BIROURI * 100)}% din aparatul fiecărei primării desființate, pentru punctele
                    de lucru din sate. E o ipoteză prudentă: reformele din Danemarca și Estonia au arătat economii
                    mai mari pe funcțiile administrative, dar și costuri de tranziție în primii ani, care nu sunt
                    estimate aici.</li>
                <li><b>Aleșii</b>: primar în fiecare unitate, consilieri locali după scara din art. 112 aplicată
                    populației unității noi, consilii regionale după scara din art. 171 aplicată populației
                    regiunii. Nu sunt numărați viceprimarii, administratorii publici și personalul contractual.</li>
                <li><b>Sediile</b>: azi o primărie pe UAT, plus un consiliu județean și o prefectură pe județ;
                    după reformă, o primărie pe unitate, un oficiu de plasă, un oficiu județean și o capitală
                    regională. Punctele de lucru din sate nu sunt numărate ca sedii.</li>
                <li><b>Ce nu e calculat</b>: costurile de tranziție, patrimoniul clădirilor rămase libere,
                    efectul asupra investițiilor și al absorbției de fonduri europene, și salariile — care depind
                    de legea salarizării, nu de numărul de unități.</li>
            </ol>`;
    }

    // ------------------------------------------------------------ pornire
    // ------------------------------------------------------------ infrastructura esențială
    /**
     * Aceiași indicatori, pe fiecare formă administrativă: UAT-ul de azi, comuna sau orașul
     * propus, districtul, regiunea. Arată ce capătă fiecare formă nouă: o unitate comasată
     * rar rămâne fără nicio rețea de canalizare, un district niciodată fără liceu.
     */
    function formeInfrastructura(date, r, infra, finante, I) {
        const toate = date.uat.map((u, i) => i);
        const membri = new Map(r.grupuri.map(g => [g.sediu, g.membri]));
        const forme = [
            { nume: "UAT-ul de azi", liste: toate.map(i => [i]) },
            { nume: "Comuna sau orașul propus", liste: r.grupuri.map(g => g.membri).concat(r.neacoperite.map(i => [i])) },
            {
                nume: "Districtul sau zona metropolitană",
                liste: (r.districte || []).map(d => d.unitati.flatMap(u => membri.get(u) || []))
            },
            { nume: "Regiunea", liste: date.adr.map(a => toate.filter(i => date.uat[i].adr === a.c)) }
        ];
        const executie = (finante && finante.executieUat) || {};
        return forme.map(f => {
            const agregate = f.liste.map(l => I.agrega(date, infra, finante, l));
            const investitii = f.liste.map(l => l.reduce((a, i) => a + ((executie[date.uat[i].s] || {}).investitii || 0), 0));
            const n = f.liste.length;
            return {
                nume: f.nume,
                numar: n,
                populatieMedie: n ? agregate.reduce((a, x) => a + x.populatie, 0) / n : 0,
                faraApa: agregate.filter(x => !x.apa.uat).length,
                faraCanal: agregate.filter(x => !x.canal.uat).length,
                faraGaze: agregate.filter(x => !x.gaze.uat).length,
                faraLiceu: agregate.filter(x => !x.licee).length,
                faraSpital: agregate.filter(x => !x.spitalePublice).length,
                faraBiblioteca: agregate.filter(x => !x.biblioteci).length,
                investitiiMedii: n ? investitii.reduce((a, v) => a + v, 0) / n : 0
            };
        });
    }

    function randeazaInfrastructura(date, r, infra, finante, I) {
        const cont = $("#infrastructura-cifre");
        if (!cont) return;
        if (!infra || !I) {
            cont.innerHTML = `<p class="nota">Lipsesc indicatorii de infrastructură. Rulează
                <code>python unelte/infrastructura.py</code>.</p>`;
            return;
        }
        const an = finante && finante.anExecutie;
        const toate = date.uat.map((u, i) => i);
        const tara = I.agrega(date, infra, finante, toate);
        const pct = (parte, intreg) => intreg ? `${NF1.format(100 * parte / intreg)}%` : "—";
        const cuProcent = (n, din) => `${NF.format(n)} <small>(${pct(n, din)})</small>`;
        const leiLoc = v => v === null || v === undefined ? "—" : NF.format(Math.round(v));
        const forme = formeInfrastructura(date, r, infra, finante, I);

        const randuriForme = forme.map(f => `<tr>
            <th scope="row">${esc(f.nume)}</th>
            <td>${NF.format(f.numar)}</td>
            <td>${NF.format(Math.round(f.populatieMedie))}</td>
            <td>${cuProcent(f.faraApa, f.numar)}</td>
            <td>${cuProcent(f.faraCanal, f.numar)}</td>
            <td>${cuProcent(f.faraGaze, f.numar)}</td>
            <td>${cuProcent(f.faraLiceu, f.numar)}</td>
            <td>${cuProcent(f.faraSpital, f.numar)}</td>
            <td>${cuProcent(f.faraBiblioteca, f.numar)}</td>
            <td>${lei(f.investitiiMedii)}</td>
        </tr>`).join("");

        const randuriRegiuni = date.adr.map(a => {
            const x = I.agrega(date, infra, finante, toate.filter(i => date.uat[i].adr === a.c));
            return `<tr>
                <th scope="row">${esc(a.n === "București-Ilfov" ? "București–Ilfov" : a.n)}</th>
                <td>${pct(x.apa.populatie, x.populatie)}</td>
                <td>${pct(x.canal.populatie, x.populatie)}</td>
                <td>${pct(x.canal.km, x.apa.km)}</td>
                <td>${pct(x.gaze.populatie, x.populatie)}</td>
                <td>${pct(x.straziModernizate, x.strazi)}</td>
                <td>${leiLoc(x.peLocuitor.drumuri)}</td>
                <td>${leiLoc(x.peLocuitor.apaCanal)}</td>
                <td>${leiLoc(x.peLocuitor.educatie)}</td>
                <td>${leiLoc(x.peLocuitor.cultura)}</td>
            </tr>`;
        }).join("");

        // unde e golul cel mai mare: districtele cu cei mai mulți locuitori în UAT-uri fără canalizare
        const membri = new Map(r.grupuri.map(g => [g.sediu, g.membri]));
        const numeJudet = cod => (date.judete.find(j => j.c === cod) || {}).n || "";
        const goluri = (r.districte || []).map(d => {
            const lista = d.unitati.flatMap(u => membri.get(u) || []);
            const x = I.agrega(date, infra, finante, lista);
            const fara = x.fara.canal.reduce((s, i) => s + (date.uat[i].p21 || 0), 0);
            return { d: d, x: x, fara: fara, judet: numeJudet(date.uat[d.sediu].j) };
        }).sort((p, q) => q.fara - p.fara).slice(0, 10);
        const randuriGoluri = goluri.map(g => `<tr>
            <th scope="row">${esc(g.d.nume)} <small>(${esc(g.judet)})</small></th>
            <td>${NF.format(g.d.populatie)}</td>
            <td>${NF.format(g.fara)} <small>(${pct(g.fara, g.x.populatie)})</small></td>
            <td>${NF.format(g.x.fara.canal.length)} din ${NF.format(g.x.uat)}</td>
            <td>${pct(g.x.canal.km, g.x.apa.km)}</td>
        </tr>`).join("");

        // planul de acțiuni, adunat pe țară: câte districte au nevoie de fiecare tip de acțiune
        const TIPURI = [["apa", "Rețea publică de apă"], ["canal", "Canalizare"], ["sanatate", "Spital sau centru de permanență"],
            ["educatie", "Acces la liceu"], ["strazi", "Străzi orășenești de modernizat"],
            ["drumuri", "Registrul drumurilor comunale"], ["cultura", "Bibliotecă publică"]];
        const peDistrict = (r.districte || []).map(d => I.actiuni(
            I.agrega(date, infra, finante, d.unitati.flatMap(u => membri.get(u) || [])), null));
        const randuriActiuni = TIPURI.map(([tip, eticheta]) => {
            const ale = peDistrict.map(l => l.find(x => x.tip === tip)).filter(Boolean);
            const populatie = ale.reduce((s, x) => s + (x.populatie || 0), 0);
            return `<tr>
                <th scope="row">${esc(eticheta)}</th>
                <td>${NF.format(ale.length)} <small>din ${NF.format(peDistrict.length)}</small></td>
                <td>${populatie ? NF.format(populatie) : "—"}</td>
                <td><small>${esc(I.FONDURI[tip])}</small></td>
            </tr>`;
        }).join("");

        const azi = forme[0], unit = forme[1], dist = forme[2];
        cont.innerHTML = `
            <p>Azi, <b>${NF.format(tara.fara.canal.length)}</b> din ${NF.format(tara.uat)} de UAT-uri nu au nicio rețea
                de canalizare raportată la INS — acolo locuiesc ${pct(tara.populatie - tara.canal.populatie, tara.populatie)}
                din oameni — iar <b>${NF.format(tara.fara.apa.length)}</b> nu au rețea publică de apă. Rețeaua de
                canalizare a țării are ${NF.format(Math.round(tara.canal.km))} km, față de
                ${NF.format(Math.round(tara.apa.km))} km de apă: ${pct(tara.canal.km, tara.apa.km)}. În orașe,
                ${pct(tara.straziModernizate, tara.strazi)} din străzi sunt modernizate; pentru drumurile comunale
                statul nu publică nimic pe UAT.</p>

            <h3>Aceiași indicatori, pe fiecare formă</h3>
            <div class="tabel-derulant"><table class="tabel-doc tabel-numeric">
                <thead><tr><th>Forma</th><th>Câte</th><th>Locuitori, în medie</th><th>Fără nicio rețea de apă</th>
                    <th>Fără canalizare</th><th>Fără gaze</th><th>Fără liceu</th><th>Fără spital public</th><th>Fără bibliotecă</th>
                    <th>Investiții pe an, în medie</th></tr></thead>
                <tbody>${randuriForme}</tbody>
            </table></div>
            <p>Citirea tabelului: din ${NF.format(azi.faraCanal)} de UAT-uri fără nicio canalizare rămân
                <b>${NF.format(unit.faraCanal)}</b> de comune comasate în aceeași situație și
                <b>${NF.format(dist.faraCanal)}</b> ${dist.faraCanal === 1 ? "district" : "districte"}. Oamenii fără
                canalizare sunt aceiași — comasarea nu sapă șanțuri — dar unitatea care răspunde de ei are acum o
                rețea de la care să pornească, un buget mediu de investiții de ${lei(unit.investitiiMedii)} pe an
                (față de ${lei(azi.investitiiMedii)}) și oameni care pot scrie proiectul. Tot așa, din
                ${NF.format(azi.faraLiceu)} de UAT-uri fără liceu rămân ${NF.format(dist.faraLiceu)}
                ${dist.faraLiceu === 1 ? "district" : "districte"} fără liceu: rețeaua școlară se poate gândi, în
                sfârșit, la scara la care are sens.</p>

            <h3>Pe regiuni</h3>
            <div class="tabel-derulant"><table class="tabel-doc tabel-numeric">
                <thead><tr><th rowspan="2">Regiunea</th><th colspan="5">Stocul (INS, ${esc(String((infra.ani || {}).canal || ""))})</th>
                    <th colspan="4">Cheltuit din bugetele locale, lei pe locuitor (${esc(String(an || ""))})</th></tr>
                    <tr><th>Locuitori în UAT-uri cu apă</th><th>… cu canalizare</th><th>Canalizare față de apă, km</th>
                    <th>… cu gaze</th><th>Străzi orășenești modernizate</th>
                    <th>Drumuri</th><th>Apă-canal</th><th>Educație</th><th>Cultură</th></tr></thead>
                <tbody>${randuriRegiuni}</tbody>
            </table></div>

            <h3>Planul de acțiuni, pe districte</h3>
            <p>Fiecare district își primește lista din propriile goluri — se vede în fișa lui de pe hartă și în
                <a href="#harta-tabele">tabelele hărții</a>. Adunate pe țară:</p>
            <div class="tabel-derulant"><table class="tabel-doc tabel-numeric">
                <thead><tr><th>Acțiunea</th><th>Districte care au nevoie de ea</th><th>Locuitori vizați</th>
                    <th>De unde se finanțează</th></tr></thead>
                <tbody>${randuriActiuni}</tbody>
            </table></div>
            <p class="nota">Rețelele de gaze nu apar în plan: politica de coeziune nu mai finanțează, cu puține
                excepții, infrastructură pentru combustibili fosili. Sursele de finanțare sunt programele
                2021–2027; din 2028 devin capitole ale planului național și regional.</p>

            <h3>Unde e golul cel mai mare</h3>
            <p class="nota">Districtele cu cei mai mulți locuitori în UAT-uri fără nicio rețea de canalizare: lista de
                priorități a primei perioade de programare.</p>
            <div class="tabel-derulant"><table class="tabel-doc tabel-numeric">
                <thead><tr><th>Districtul</th><th>Locuitori</th><th>În UAT-uri fără canalizare</th>
                    <th>UAT-uri fără rețea</th><th>Canalizare față de apă, km</th></tr></thead>
                <tbody>${randuriGoluri}</tbody>
            </table></div>
            <p class="nota">Ce înseamnă cifrele: „cu rețea” înseamnă că UAT-ul raportează la INS cel puțin un
                kilometru de rețea publică — nu că toate gospodăriile sunt racordate. Banii sunt doar cei din
                bugetul local; investițiile mari în apă și canalizare trec prin operatorii regionali și nu se văd
                aici. Fiecare fișă de pe hartă — comună, district, județ, regiune — arată aceiași indicatori.</p>`;
    }

    // ------------------------------------------------------------ harta, în tabele
    /** Aparatul administrativ al unor unități noi, azi și după comasare (aceeași ipoteză ca `costuri`). */
    function costUnitati(grupuri, executie) {
        let acum = 0, dupa = 0;
        grupuri.forEach(g => {
            const ale = g.membri.map(i => executie.get(i)).filter(Boolean);
            if (!ale.length) return;
            acum += ale.reduce((a, e) => a + (e.cheltuieliAparat || 0), 0);
            const sediu = executie.get(g.sediu);
            const altele = ale.filter(e => e !== sediu);
            dupa += (sediu ? sediu.cheltuieliAparat || 0 : Math.max(...ale.map(e => e.cheltuieliAparat || 0))) +
                COTA_BIROURI * altele.reduce((a, e) => a + (e.cheltuieliAparat || 0), 0);
        });
        return { acum: acum, dupa: dupa, economie: acum - dupa };
    }

    /**
     * Rândurile tabloului interactiv (adp-explorator.js): câte unul pentru fiecare district, cu
     * tot ce se filtrează, se sortează și se arată în fișa lui.
     */
    function dateExplorator(date, r, executie, infra, finante, I, gal) {
        const dupaSediu = new Map(r.grupuri.map(g => [g.sediu, g]));
        const numeGal = new Map(((gal && gal.gal) || []).map(g => [g.id, g.nume]));
        const numeUat = i => date.uat[i].n;
        const agrega = lista => infra && I ? I.agrega(date, infra, finante, lista) : null;
        const retea = (x, cheie) => x ? [x[cheie].uat, x.uat] : null;
        const districte = (r.districte || []).map(d => {
            const unitati = d.unitati.map(u => dupaSediu.get(u)).filter(Boolean);
            const indecsi = unitati.flatMap(g => g.membri);
            const a = agrega(indecsi);
            const cost = costUnitati(unitati, executie);
            const galuri = new Map();
            indecsi.forEach(i => {
                const g = gal && gal.uat ? gal.uat[date.uat[i].s] : undefined;
                if (g !== undefined) galuri.set(g, (galuri.get(g) || 0) + 1);
            });
            return {
                id: d.sediu, nume: d.nume, resedinta: d.numeResedinta, tip: d.tip,
                judet: date.uat[d.sediu].j, adr: date.uat[d.sediu].adr,
                populatie: d.populatie,
                suprafata: indecsi.reduce((x, i) => x + (date.uat[i].a || 0), 0),
                nrUat: indecsi.length, nrUnitati: unitati.length,
                criteriiOk: d.respectaRegula, criterii: d.criterii, ue: d.praguriUE, manual: d.manual,
                costAcum: cost.acum, costDupa: cost.dupa,
                canalPop: a ? a.canal.populatie : null,
                faraCanal: a ? a.faraPop.canal : 0,
                spitale: a ? a.spitalePublice : null,
                actiuni: a ? I.actiuni(a, numeUat) : [],
                gal: Array.from(galuri).sort((x, y) => y[1] - x[1])
                    .map(([g, n]) => ({ nume: numeGal.get(g) || String(g), uat: n })),
                faraGal: gal && gal.uat ? indecsi.filter(i => gal.uat[date.uat[i].s] === undefined).length : 0,
                microregiuni: (d.microregiuni || []).map(m => ({
                    nume: m.nume, tipPol: m.tipPol, populatie: m.populatie, popLeader: m.popLeader, inBanda: m.inBanda,
                    unitati: m.unitati.map(u => (dupaSediu.get(u) || {}).nume).filter(Boolean)
                })),
                subPrag: unitati.filter(g => g.subPrag).length,
                unitati: unitati.map(g => {
                    const x = agrega(g.membri);
                    return {
                        nume: g.nume, tip: g.urban ? date.uat[g.sediu].t : "comună", populatie: g.populatie,
                        uat: g.membri.map(numeUat), subPrag: g.subPrag, derogari: g.derogari.length,
                        apa: retea(x, "apa"), canal: retea(x, "canal"), gaze: retea(x, "gaze")
                    };
                }),
                cautare: [d.nume, d.numeResedinta].concat(indecsi.map(numeUat)).join(" ")
            };
        });
        const adrJudet = new Map();
        date.uat.forEach(u => adrJudet.set(u.j, u.adr));
        return {
            regiuni: date.adr.map(a => ({ cod: a.c, nume: a.n === "București-Ilfov" ? "București–Ilfov (Metropola)" : a.n })),
            judete: date.judete.map(j => ({ cod: j.c, nume: j.n, adr: adrJudet.get(j.c) })),
            districte: districte,
            aniEconomie: ANI_ECONOMIE,
            inflatie: INFLATIE
        };
    }

    /**
     * Harta de azi a fondurilor (grupurile de acțiune locală 2023–2027) față de districtele
     * propuse, și ce devine ea: microregiunile din interiorul fiecărui district.
     */
    function randeazaGal(date, r, gal) {
        const cont = $("#gal-cifre");
        if (!cont) return;
        if (!gal || !gal.uat || !r.districte) {
            cont.innerHTML = `<p class="nota">Lipsește lista grupurilor de acțiune locală. Rulează <code>python unelte/gal.py</code>.</p>`;
            return;
        }
        const districtUat = new Map();   // UAT (index) -> reședința districtului lui
        r.uat.forEach(i => districtUat.set(i, r.unitateDistrict.get(r.grup.get(i))));
        const indexSiruta = new Map(date.uat.map((u, i) => [u.s, i]));
        // fiecare grup: în câte districte și în câte județe stă
        const districteGal = new Map(), judeteGal = new Map();
        Object.keys(gal.uat).forEach(cod => {
            const i = indexSiruta.get(Number(cod));
            const g = gal.uat[cod];
            if (i === undefined || !districtUat.has(i)) return;
            if (!districteGal.has(g)) districteGal.set(g, new Map());
            const pe = districteGal.get(g);
            pe.set(districtUat.get(i), (pe.get(districtUat.get(i)) || 0) + 1);
            if (!judeteGal.has(g)) judeteGal.set(g, new Set());
            judeteGal.get(g).add(date.uat[i].j);
        });
        const nrGal = districteGal.size;
        const intrUnul = Array.from(districteGal.values()).filter(pe => pe.size === 1).length;
        const pesteJudet = Array.from(judeteGal.values()).filter(x => x.size > 1).length;
        // cât din fiecare grup stă în districtul lui principal
        let inPrincipal = 0, total = 0;
        districteGal.forEach(pe => {
            const valori = Array.from(pe.values());
            inPrincipal += Math.max(...valori);
            total += valori.reduce((a, v) => a + v, 0);
        });
        // fiecare district: câte grupuri îl împart azi
        const galuriDistrict = new Map();
        districteGal.forEach((pe, g) => pe.forEach((n, d) => {
            if (!galuriDistrict.has(d)) galuriDistrict.set(d, new Set());
            galuriDistrict.get(d).add(g);
        }));
        const nrPe = d => (galuriDistrict.get(d.sediu) || new Set()).size;
        const clasa = (lista, f) => [1, 2, 3].map(n => lista.filter(x => n < 3 ? f(x) === n : f(x) >= 3).length);
        const peGal = clasa(r.districte, nrPe);
        const micro = r.districte.flatMap(d => d.microregiuni || []);
        const peMicro = clasa(r.districte, d => (d.microregiuni || []).length);
        const popMicro = micro.map(m => m.populatie).sort((a, b) => a - b);
        const membri = Object.keys(gal.uat).length;
        const inAfara = date.uat.filter(u => gal.uat[u.s] === undefined);
        const alocare = n => n ? `${NF1.format(BUGET_LEADER_MIL_EURO / n)} mil. €` : "—";
        const rand = (et, azi, propus, nota) => `<tr><th scope="row">${et}</th><td>${azi}</td><td>${propus}</td>
            <td><small>${nota || ""}</small></td></tr>`;
        cont.innerHTML = `
            <div class="tabel-derulant"><table class="tabel-doc tabel-numeric">
                <thead><tr><th></th><th>Grupurile de azi</th><th>Microregiunile propuse</th><th></th></tr></thead>
                <tbody>
                    ${rand("Câte sunt", NF.format(nrGal), `<b>${NF.format(micro.length)}</b>`, `în ${NF.format(r.districte.length)} districte`)}
                    ${rand("UAT-uri cuprinse", `${NF.format(membri)} din ${NF.format(date.uat.length)}`, "toate",
                        `azi rămân pe dinafară ${NF.format(inAfara.length)}, din care ${NF.format(inAfara.filter(u => u.t === "comună").length)} comune`)}
                    ${rand("Stau într-un singur district", `${NF.format(intrUnul)} din ${NF.format(nrGal)}`, "toate, prin construcție",
                        `azi, ${NF1.format(100 * inPrincipal / (total || 1))}% din UAT-urile unui grup sunt în districtul lui principal`)}
                    ${rand("Trec peste limita de județ", NF.format(pesteJudet), "0", "")}
                    ${rand("Districte cu un singur grup", NF.format(peGal[0]), NF.format(peMicro[0]), "")}
                    ${rand("… cu două", NF.format(peGal[1]), NF.format(peMicro[1]), "")}
                    ${rand("… cu trei sau mai multe", NF.format(peGal[2]), NF.format(peMicro[2]), "")}
                    ${rand("În pragurile LEADER", "toate, la selecție", `${NF.format(micro.filter(m => m.inBanda).length)} din ${NF.format(micro.length)}`,
                        "10.000–150.000 de locuitori eligibili")}
                    ${rand("Populația mediană", "—", NF.format(popMicro[Math.floor(popMicro.length / 2)] || 0),
                        `între ${NF.format(popMicro[0] || 0)} și ${NF.format(popMicro[popMicro.length - 1] || 0)}`)}
                    ${rand("Bani pe grup, în medie", alocare(nrGal), alocare(micro.length),
                        `din ${NF.format(BUGET_LEADER_MIL_EURO)} mil. € pe perioadă, dacă suma rămâne aceeași`)}
                </tbody>
            </table></div>
            ${(() => {
                // orașele sub 25.000 de locuitori care au preluat UAT-uri mici din jur
                const cuOras = r.grupuri.filter(g => g.urban && g.membri.length > 1);
                const preluate = g => g.membri.filter(i => date.uat[i].t === "comună");
                const peste = cuOras.filter(g => g.populatie > PRAG_ORAS_LEADER);
                const numar = lista => lista.reduce((a, g) => a + preluate(g).length, 0);
                return `<p><b>Orașele mici care preiau comune:</b> ${NF.format(cuOras.length)} de orașe sub
                    ${NF.format(r.parametri.pOrasMic)} de locuitori au preluat ${NF.format(numar(cuOras))} de UAT-uri mici din
                    jurul lor. Dintre ele, ${NF.format(peste.length)} trec de ${NF.format(PRAG_ORAS_LEADER)} de locuitori
                    (${peste.map(g => esc(g.nume)).join(", ")}): cele ${NF.format(numar(peste))} comune ale lor,
                    cu ${NF.format(peste.reduce((a, g) => a + preluate(g).reduce((x, i) => x + (date.uat[i].p21 || 0), 0), 0))}
                    de locuitori, ies din aria LEADER și trec pe strategia urbană a orașului.</p>`;
            })()}
            <p>Pe scurt: azi, un district al judecătoriei e împărțit în medie între
                <b>${NF1.format(r.districte.reduce((a, d) => a + nrPe(d), 0) / r.districte.length)}</b> grupuri, iar
                ${NF.format(nrGal - intrUnul)} din cele ${NF.format(nrGal)} de grupuri se întind peste două sau mai multe
                districte. După reorganizare, fiecare grup stă într-un singur district și are un oraș ca pol.</p>`;
    }

        /**
     * O singură zonare: districtul e circumscripția judecătoriei, iar pe același teritoriu stau
     * notarii, grupul de acțiune locală, asociația comunelor și spitalul. Tabelul numără câte
     * districte au deja fiecare piesă a pachetului.
     */
    function randeazaZonare(date, r, infra, finante, I, judecatorii) {
        const cont = $("#zonare-cifre");
        if (!cont) return;
        const d = r.districte || [];
        if (!d.length) {
            cont.innerHTML = "";
            return;
        }
        const membri = new Map(r.grupuri.map(g => [g.sediu, g.membri]));
        const numeJudet = cod => (date.judete.find(j => j.c === cod) || {}).n || "";
        const fise = d.map(x => ({
            d: x,
            a: infra && I ? I.agrega(date, infra, finante, x.unitati.flatMap(u => membri.get(u) || [])) : null
        }));
        const sediiJudecatorie = new Set(((judecatorii && judecatorii.judecatorii) || []).map(j => j.sediu));
        const cuJudecatorie = fise.filter(f => (membri.get(f.d.sediu) || []).some(i => sediiJudecatorie.has(date.uat[i].s)));
        const cate = lista => `<b>${NF.format(lista.length)}</b> din ${NF.format(d.length)}`;
        const lipsa = lista => {
            const fara = fise.filter(f => !lista.includes(f));
            if (!fara.length) return "toate";
            // districtul poartă numele celui mai mare UAT; unde reședința e alta, se spune
            const eticheta = f => f.d.numeResedinta === f.d.nume ? esc(f.d.nume)
                : `${esc(f.d.nume)}, cu reședința la ${esc(f.d.numeResedinta)}`;
            return `lipsește în: ${fara.slice(0, 8).map(f => `${eticheta(f)} (${esc(numeJudet(date.uat[f.d.sediu].j))})`).join(", ")}${fara.length > 8 ? ` și alte ${NF.format(fara.length - 8)}` : ""}`;
        };
        const cuSpital = fise.filter(f => f.a && f.a.spitalePublice);
        const cuLiceu = fise.filter(f => f.a && f.a.licee);
        const cuOras = fise.filter(f => date.uat[f.d.sediu].t !== "comună");
        const inBanda = fise.filter(f => f.d.praguriUE.potrivit);
        const indeplinit = (f, nume) => (f.d.criterii.find(c => c.nume === nume) || {}).stare === "ok";
        const aproape = fise.filter(f => indeplinit(f, "Drumul până la reședință"));
        const pop = d.map(x => x.populatie).sort((p, q) => p - q);
        const rand = (piesa, lista, nota) => `<tr><th scope="row">${piesa}</th><td>${cate(lista)}</td>
            <td><small>${nota}</small></td></tr>`;
        cont.innerHTML = `
            <div class="tabel-derulant"><table class="tabel-doc">
                <thead><tr><th>Piesa pachetului</th><th>Districte care o au</th><th>Unde lipsește</th></tr></thead>
                <tbody>
                    ${rand("Judecătorie, parchet și notari", cuJudecatorie, lipsa(cuJudecatorie))}
                    ${rand("Oraș-reședință", cuOras, lipsa(cuOras))}
                    ${rand("Spital public", cuSpital, lipsa(cuSpital))}
                    ${rand("Liceu", cuLiceu, lipsa(cuLiceu))}
                    ${rand("Reședința la cel mult o oră de orice comună", aproape, lipsa(aproape))}
                    ${rand("Populație în pragurile LEADER, pentru grupul de acțiune locală", inBanda, lipsa(inBanda))}
                </tbody>
            </table></div>
            <p class="nota">${NF.format(d.length)} districte, între ${NF.format(pop[0])} și
                ${NF.format(pop[pop.length - 1])} de locuitori, cu mediana de ${NF.format(pop[Math.floor(pop.length / 2)])}.
                Unde lipsește o piesă, districtul o primește — sau se unește cu vecinul care o are: asta se
                hotărăște în etapa voluntară, nu din birou.</p>`;
    }

    /**
     * Unde ar sta instituțiile regionale ale unei regiuni: fiecare grup de instituții într-o
     * reședință de județ, ca regiunea să nu aibă un singur oraș care adună tot. Trei grupuri au
     * ancoră — stau unde statul a pus deja structura regională; restul merg, pe rând, în reședința
     * cea mai puțin încărcată, la egalitate în cea mai mare.
     */
    function sediiRegionale(date, regional, lista, adr) {
        const resedinte = date.uat.filter(u => u.adr === adr.c && (u.r || u.t === "municipiu" && u.n === "București"))
            .sort((a, b) => (b.p21 || 0) - (a.p21 || 0));
        const gazduieste = new Map(resedinte.map(u => [u.s, []]));
        const sistem = cod => ((regional && regional.sisteme) || []).find(s => s.cod === cod);
        const sediul = cod => ((sistem(cod) || {}).sedii || []).map(x => x.siruta).find(s => gazduieste.has(s));
        const celMaiLiber = () => resedinte.reduce((a, u) =>
            gazduieste.get(u.s).length < gazduieste.get(a.s).length ? u : a).s;
        lista.grupuri.forEach(g => {
            let unde;
            if (g.ancora === "medical") unde = (resedinte.find(u => lista.centreMedicale.includes(u.n)) || {}).s;
            else if (g.ancora) unde = sediul(g.ancora);
            if (unde === undefined) unde = celMaiLiber();
            gazduieste.get(unde).push(g.nume);
        });
        const curti = new Set(((sistem("curte-apel") || {}).sedii || []).map(x => x.siruta));
        return resedinte.map(u => ({
            uat: u,
            grupuri: gazduieste.get(u.s),
            azi: [
                sediul("adr") === u.s ? "agenția de dezvoltare regională" : "",
                sediul("dgrfp") === u.s ? "direcția regională a finanțelor" : "",
                curti.has(u.s) ? "curte de apel" : ""
            ].filter(Boolean)
        }));
    }

    /**
     * Județ cu județ: câți oameni lucrează în administrația publică și cât costă, azi și după.
     * Salariații și câștigul vin din INS; cheltuiala de personal a primăriilor și a consiliului
     * județean, din execuția bugetară. Numărul de oameni al primăriilor și al consiliului județean
     * e dedus din bani, la câștigul mediu al județului.
     */
    function pregatestePersonal(date, r, executie, finante, personal) {
        if (!personal || !personal.judete || !finante) return null;
        const executieUat = finante.executieUat || {};
        return date.judete.map(j => {
            const p = personal.judete[j.c];
            const indecsi = date.uat.map((u, i) => i).filter(i => date.uat[i].j === j.c);
            const grupuri = r.grupuri.filter(g => date.uat[g.sediu].j === j.c);
            // Bucureștiul nu intră în comasare și nu are execuția potrivită pe sectoare
            if (!p || !p.salariati || !p.castigBrut || !grupuri.length) return null;
            const cost = p.castigBrut.O * 12 * COST_ANGAJATOR;
            const leiPrimarii = indecsi.reduce((a, i) => a + ((executieUat[date.uat[i].s] || {}).personalAparat || 0), 0);
            const aparat = costUnitati(grupuri, executie);
            const raport = aparat.acum ? aparat.dupa / aparat.acum : 1;
            const leiCJ = ((finante.consiliiJudetene || {})[j.c] || {}).personalAparat || 0;
            const oameniPrimarii = leiPrimarii / cost, oameniCJ = leiCJ / cost;
            const oameniStat = Math.max(0, p.salariati.O - oameniPrimarii - oameniCJ);
            const acum = {
                primarii: { oameni: oameniPrimarii, lei: leiPrimarii },
                cj: { oameni: oameniCJ, lei: leiCJ },
                stat: { oameni: oameniStat, lei: oameniStat * cost }
            };
            const dupa = {
                primarii: { oameni: oameniPrimarii * raport, lei: leiPrimarii * raport },
                cj: { oameni: oameniCJ * COTA_CJ_PASTRATA, lei: leiCJ * COTA_CJ_PASTRATA },
                stat: { oameni: oameniStat * (1 - REDUCERE_STAT), lei: oameniStat * cost * (1 - REDUCERE_STAT) }
            };
            return {
                cod: j.c, nume: j.n, adr: date.uat[indecsi[0]].adr,
                castig: p.castigBrut.O, salariati: p.salariati, acum: acum, dupa: dupa
            };
        }).filter(Boolean);
    }

    function randeazaPersonal(date, r, executie, finante, personal) {
        const cont = $("#personal-cifre");
        if (!cont) return;
        const judete = pregatestePersonal(date, r, executie, finante, personal);
        if (!judete) {
            cont.innerHTML = `<p class="nota">Lipsesc datele de personal. Rulează <code>python unelte/personal.py</code>
                și <code>python unelte/finante.py</code>.</p>`;
            return;
        }
        const PARTI = ["primarii", "cj", "stat"];
        const aduna = lista => {
            const t = { acum: {}, dupa: {} };
            ["acum", "dupa"].forEach(cand => PARTI.forEach(parte => {
                t[cand][parte] = {
                    oameni: lista.reduce((a, x) => a + x[cand][parte].oameni, 0),
                    lei: lista.reduce((a, x) => a + x[cand][parte].lei, 0)
                };
            }));
            return t;
        };
        const total = (x, cand, camp) => PARTI.reduce((a, parte) => a + x[cand][parte][camp], 0);
        const oameni = v => NF.format(Math.round(v));
        const celule = x => PARTI.map(parte => `
                <td>${oameni(x.acum[parte].oameni)} → <b>${oameni(x.dupa[parte].oameni)}</b></td>
                <td>${lei(x.acum[parte].lei)} → <b>${lei(x.dupa[parte].lei)}</b></td>`).join("") + `
                <td>${oameni(total(x, "acum", "oameni"))} → <b>${oameni(total(x, "dupa", "oameni"))}</b></td>
                <td><b>${lei(total(x, "acum", "lei") - total(x, "dupa", "lei"))}</b></td>`;
        const randuri = date.adr.map(a => {
            const ale = judete.filter(x => x.adr === a.c).sort((p, q) => p.nume.localeCompare(q.nume, "ro"));
            if (!ale.length) return "";
            return `<tr class="rand-district"><th scope="row">${esc(a.n === "București-Ilfov" ? "București–Ilfov" : a.n)}</th>
                    ${celule(aduna(ale))}</tr>` +
                ale.map(x => `<tr><th scope="row">${esc(x.nume)}</th>${celule(x)}</tr>`).join("");
        }).join("");
        const tara = aduna(judete);
        const scoli = judete.reduce((a, x) => a + (x.salariati.P || 0), 0);
        const sanatate = judete.reduce((a, x) => a + (x.salariati.Q || 0), 0);
        cont.innerHTML = `
            <div class="tabel-derulant"><table class="tabel-doc tabel-numeric tabel-harta">
                <thead>
                    <tr><th rowspan="2">Județul</th><th colspan="2">Aparatul primăriilor</th>
                        <th colspan="2">Aparatul consiliului județean</th>
                        <th colspan="2">Instituțiile statului și celelalte servicii</th>
                        <th colspan="2">Total</th></tr>
                    <tr><th>oameni</th><th>lei pe an</th><th>oameni</th><th>lei pe an</th><th>oameni</th><th>lei pe an</th>
                        <th>oameni</th><th>economie pe an</th></tr>
                </thead>
                <tbody>${randuri}
                    <tr class="rand-total"><th scope="row">Total, fără București</th>${celule(tara)}</tr>
                </tbody>
            </table></div>
            <p class="nota"><b>Cum se citește.</b> Fiecare celulă: azi → după. Salariații din administrația publică
                și câștigul mediu brut sunt cele din statistica INS pe ${esc(String((personal.ani || {}).salariati || ""))};
                cheltuiala de personal a primăriilor și a consiliului județean e cea din execuția bugetară pe
                ${esc(String(finante.anExecutie || ""))}. Numărul de oameni al primăriilor și al consiliului județean e
                dedus din bani, la câștigul mediu al județului, deci e o estimare. A treia coloană e restul
                administrației publice din județ: prefectura, instituțiile statului și serviciile locale din afara
                aparatului propriu; statistica nu cuprinde armata și poliția.</p>
            <p class="nota"><b>Ipotezele pentru „după”.</b> Primăriile: reședința își păstrează aparatul, fiecare
                primărie desființată lasă un sfert. Consiliul județean: jumătate din aparat trece la district și la
                regiune, jumătate dispare. Instituțiile statului: conducerea și funcțiile de suport, circa 30% din
                personal, se strâng la regiune într-o treime din mărimea lor — o reducere de
                ${Math.round(REDUCERE_STAT * 100)}%. Nu se ating cei ${NF.format(scoli)} de salariați din învățământ și
                ${NF.format(sanatate)} din sănătate: acolo se regionalizează doar conducerea județeană, nu profesorii
                și medicii.</p>`;
    }

    /** Instituțiile județene: ce sunt, ce devin și unde ar sta, regiune cu regiune. */
    function randeazaInstitutii(date, r, regional, lista) {
        const cont = $("#institutii-cifre");
        if (!cont) return;
        if (!lista || !lista.institutii) {
            cont.innerHTML = `<p class="nota">Lipsește lista instituțiilor județene (date/institutii-judetene.json).</p>`;
            return;
        }
        const inst = lista.institutii;
        const nrJudete = date.judete.length;
        const cuRegiune = inst.filter(i => i.destinatie.includes("regiune"));
        const cuDistrict = inst.filter(i => i.destinatie.includes("district"));
        const dejaRegionale = inst.filter(i => i.regionalAzi);
        const nrDistricte = (r.districte || []).length;
        const conducereAzi = inst.length * nrJudete * FUNCTII_PE_INSTITUTIE;
        const conducereDupa = cuRegiune.length * date.adr.length * FUNCTII_PE_INSTITUTIE + nrJudete + nrDistricte;
        const eticheta = d => `<span class="eticheta-stare ${d === "dispare" ? "critic" : d === "rămâne" ? "" : d.includes("district") ? "bun" : "plin"}">${esc(d)}</span>`;

        const peGrupuri = lista.grupuri.map(g => {
            const ale = inst.filter(i => i.grup === g.cod);
            return `<tr class="rand-district"><th scope="rowgroup" colspan="4">${esc(g.nume)}
                    <small> · ${NF.format(ale.length)} instituții · sediul regional ${esc(g.explicatie)}</small></th></tr>` +
                ale.map(i => `<tr>
                    <th scope="row">${esc(i.nume)}<br><small>${esc(i.tutela)}</small></th>
                    <td>${esc(i.face)}</td>
                    <td>${i.regionalAzi ? `<span class="eticheta-stare bun">da</span> <small>${esc(i.regionalAzi)}</small>` : "—"}</td>
                    <td>${eticheta(i.destinatie)}<br>${esc(i.devine)}</td>
                </tr>`).join("");
        }).join("");

        const regiuni = date.adr.map(a => {
            const judete = new Set(date.uat.filter(u => u.adr === a.c).map(u => u.j));
            const districte = (r.districte || []).filter(d => date.uat[d.sediu].adr === a.c).length;
            const sedii = sediiRegionale(date, regional, lista, a);
            const numeJudet = cod => (date.judete.find(j => j.c === cod) || {}).n || "";
            return `<details class="strat serie-${((a.c - 1) % 8) + 1}">
                <summary>${esc(a.n === "București-Ilfov" ? "București–Ilfov (Metropola)" : a.n)}
                    <small>${NF.format(inst.length * judete.size)} de structuri județene azi →
                    ${NF.format(cuRegiune.length)} instituții regionale, ${NF.format(judete.size)}
                    ${judete.size === 1 ? "oficiu județean" : "oficii județene"}, ${NF.format(districte)} ghișee de district</small></summary>
                <div class="strat-continut"><div class="tabel-derulant"><table class="tabel-doc tabel-harta">
                    <thead><tr><th>Reședința</th><th>Județul</th><th>Locuitori</th><th>Are deja</th>
                        <th>Ar găzdui sediul regional pentru</th></tr></thead>
                    <tbody>${sedii.map(x => `<tr>
                        <th scope="row">${esc(x.uat.n)}</th>
                        <td>${esc(numeJudet(x.uat.j))}</td>
                        <td class="num">${NF.format(x.uat.p21 || 0)}</td>
                        <td>${x.azi.length ? esc(x.azi.join(", ")) : "—"}</td>
                        <td>${x.grupuri.length ? x.grupuri.map(g => `<span class="eticheta-stare plin">${esc(g)}</span>`).join(" ")
                            : "<small>doar oficiul județean</small>"}</td>
                    </tr>`).join("")}</tbody>
                </table></div></div>
            </details>`;
        }).join("");

        cont.innerHTML = `
            <div class="carduri">
                <div class="card-cifra"><span class="card-eticheta">Instituții cu structură în fiecare județ</span>
                    <strong>${NF.format(inst.length)}</strong><small>${NF.format(inst.length * nrJudete)} de structuri în toată țara</small></div>
                <div class="card-cifra bun"><span class="card-eticheta">Au deja nivel regional</span>
                    <strong>${NF.format(dejaRegionale.length)}</strong><small>statul a făcut singur pasul, pe bucăți</small></div>
                <div class="card-cifra"><span class="card-eticheta">Devin regionale</span>
                    <strong>${NF.format(cuRegiune.length)}</strong><small>${NF.format(cuRegiune.length * date.adr.length)} de structuri, în loc de ${NF.format(cuRegiune.length * nrJudete)}</small></div>
                <div class="card-cifra"><span class="card-eticheta">Coboară la ghișeul districtului</span>
                    <strong>${NF.format(cuDistrict.length)}</strong><small>tot ce are de-a face direct cu omul</small></div>
                <div class="card-cifra bun"><span class="card-eticheta">Funcții de conducere</span>
                    <strong>${NF.format(conducereAzi)} → ${NF.format(conducereDupa)}</strong>
                    <small>estimare: ${FUNCTII_PE_INSTITUTIE} la fiecare instituție, un șef de oficiu județean, un șef de ghișeu</small></div>
            </div>

            <h3>Instituție cu instituție</h3>
            <div class="tabel-derulant"><table class="tabel-doc tabel-harta">
                <thead><tr><th>Instituția</th><th>Ce face</th><th>Are deja nivel regional</th><th>Ce devine</th></tr></thead>
                <tbody>${peGrupuri}</tbody>
            </table></div>

            <h3>Regiune cu regiune: unde ar sta sediile</h3>
            <p>Regula: <b>nicio regiune cu un singur oraș care adună tot</b>. Instituțiile regionale se așază pe
                grupuri, câte un grup într-o reședință de județ. Trei grupuri stau unde statul a pus deja structura
                regională — agenția de dezvoltare, direcția finanțelor, centrul universitar medical; restul merg, pe
                rând, în reședința cea mai puțin încărcată. Curțile de apel rămân unde sunt. În fiecare fostă
                reședință rămâne oficiul județean unic, iar în fiecare district, ghișeul.</p>
            ${regiuni}
            <p class="nota">Lista instituțiilor e întocmită din legile lor de organizare și nu cuprinde structurile
                militare, vamale și de frontieră, care au deja altă împărțire. Numărul funcțiilor de conducere e o
                estimare de ordin de mărime, nu o numărătoare din statele de funcții. Așezarea pe orașe e o
                propunere de pornire, de negociat în fiecare regiune.</p>`;
    }

    /**
     * Organizarea administrativă și cea funcțională, treaptă cu treaptă, cu numărul fiecăreia și cu
     * verificarea încastrării: nicio treaptă nu taie una de deasupra ei.
     */
    function randeazaOrganizare(date, r, s, gal) {
        const cont = $("#organizare-cifre");
        if (!cont) return;
        const d = r.districte || [];
        const micro = d.reduce((a, x) => a + (x.microregiuni || []).length, 0);
        const membri = new Map(r.grupuri.map(g => [g.sediu, g.membri]));
        // încastrarea: câte districte au UAT-uri în două județe
        const districteRupte = d.filter(x =>
            new Set(x.unitati.flatMap(u => membri.get(u) || []).map(i => date.uat[i].j)).size > 1).length;
        const judeteRupte = date.judete.filter(j =>
            new Set(date.uat.filter(u => u.j === j.c).map(u => u.adr)).size > 1).length;
        // pentru contrast: grupurile de acțiune locală de azi care trec peste limita de județ
        const galPesteJudet = (() => {
            if (!gal || !gal.uat) return null;
            const pe = new Map();
            date.uat.forEach(u => {
                const g = gal.uat[u.s];
                if (g === undefined) return;
                if (!pe.has(g)) pe.set(g, new Set());
                pe.get(g).add(u.j);
            });
            return Array.from(pe.values()).filter(x => x.size > 1).length;
        })();
        const da = n => n ? `<span class="eticheta-stare atentie">${NF.format(n)} taie limita</span>`
            : `<span class="eticheta-stare bun">nicio limită tăiată</span>`;
        const adm = text => `<span class="eticheta-stare plin">administrativ</span> ${text}`;
        const fun = text => `<span class="eticheta-stare bun">funcțional</span> ${text}`;
        const rand = (treapta, cate, administrativ, functional, corelare) => `<tr>
            <th scope="row">${treapta}</th><td class="num">${cate}</td>
            <td>${administrativ}</td><td>${functional}</td><td><small>${corelare}</small></td></tr>`;
        cont.innerHTML = `<div class="tabel-derulant"><table class="tabel-doc">
            <thead><tr><th>Treapta</th><th>Câte</th><th>Organizarea administrativă</th>
                <th>Organizarea funcțională</th><th>Cum se leagă</th></tr></thead>
            <tbody>
                ${rand("Regiunea", NF.format(s.regiuni),
                    adm(`Consiliu regional ales, buget propriu`),
                    fun(`Instituțiile regionale, planul regional de fonduri, spitalele regionale`),
                    "aceeași limită pentru amândouă")}
                ${rand("Județul", NF.format(date.judete.length),
                    adm(`Circumscripția în care se aleg consilierii regionali; fără aparat propriu`),
                    fun(`Oficiul județean unic; unitatea statistică`),
                    `fiecare județ, întreg într-o regiune: ${da(judeteRupte)}`)}
                ${rand("Districtul", NF.format(d.length),
                    `— nu e unitate administrativă: nu are alegeri și nici impozite; îl conduc primarii`,
                    fun(`Judecătoria, notarii, ghișeul de documente, spitalul, liceul, transportul; asocierea primăriilor`),
                    `fiecare district, întreg într-un județ: ${da(districteRupte)}`)}
                ${rand("Microregiunea", NF.format(micro),
                    `—`,
                    fun(`Grupul de acțiune locală și strategia lui, în jurul unui oraș`),
                    `fiecare microregiune, întreagă într-un district, prin construcție${galPesteJudet === null ? ""
                        : `; azi, ${NF.format(galPesteJudet)} de grupuri trec peste limita de județ`}`)}
                ${rand("Comuna sau orașul", NF.format(s.unitati.dupa),
                    adm(`Primar și consiliu local aleși, buget și impozite proprii`),
                    `serviciile de zi cu zi`,
                    "fiecare comună, întreagă într-o microregiune")}
                ${rand("Satul", NF.format(r.sate.length),
                    `— delegat sătesc și fond propriu, fără personalitate juridică`,
                    fun(`Oficiul de 2–3 oameni din fosta comună`),
                    "fiecare sat, într-o singură comună")}
            </tbody>
        </table></div>`;
    }

    /** Zonele metropolitane și districtele rurale, față în față: câte sunt și cât cântăresc. */
    function randeazaStatut(r) {
        const cont = $("#statut-cifre");
        if (!cont) return;
        const d = r.districte || [];
        const parte = tip => {
            const ale = d.filter(x => (x.tip === "metropolitan") === (tip === "metropolitan"));
            return {
                numar: ale.length,
                populatie: ale.reduce((a, x) => a + x.populatie, 0),
                eligibili: ale.reduce((a, x) => a + (x.praguriUE.popLeader || 0), 0),
                micro: ale.reduce((a, x) => a + (x.microregiuni || []).length, 0),
                subPrag: ale.filter(x => x.populatie < PRAG_ZONA_RURALA).length
            };
        };
        const m = parte("metropolitan"), ru = parte("rural");
        const rand = (et, a, b, nota) => `<tr><th scope="row">${et}</th><td>${a}</td><td>${b}</td>
            <td><small>${nota || ""}</small></td></tr>`;
        cont.innerHTML = `<div class="tabel-derulant"><table class="tabel-doc tabel-numeric">
            <thead><tr><th></th><th>Zone metropolitane</th><th>Districte rurale</th><th></th></tr></thead>
            <tbody>
                ${rand("Câte sunt", NF.format(m.numar), NF.format(ru.numar), "după cum polul e municipiu sau oraș")}
                ${rand("Locuitori", NF.format(m.populatie), NF.format(ru.populatie), "")}
                ${rand("Din care eligibili la LEADER", NF.format(m.eligibili), NF.format(ru.eligibili), "comunele și orașele de cel mult 20.000 de locuitori")}
                ${rand("Microregiuni", NF.format(m.micro), NF.format(ru.micro), "câte un grup de acțiune locală")}
                ${rand(`Sub ${NF.format(PRAG_ZONA_RURALA)} de locuitori`, NF.format(m.subPrag), NF.format(ru.subPrag),
                    "pragul din definiția europeană a zonei rurale funcționale")}
            </tbody>
        </table></div>`;
    }

    /** Sumarul hărții: cum arată țara după reorganizare și ce se schimbă, cu cifrele scenariului. */
    function randeazaSumarHarta(date, r, c, s, forme) {
        const cont = $("#sumar-harta-cifre");
        if (!cont) return;
        const d = r.districte || [];
        const voluntare = d.filter(x => x.manual).length;
        const inBanda = d.filter(x => x.praguriUE.potrivit).length;
        const peCriterii = d.filter(x => x.respectaRegula).length;
        const popMedie = d.length ? d.reduce((a, x) => a + x.populatie, 0) / d.length : 0;
        const unit = forme ? forme[1] : null, azi = forme ? forme[0] : null, dist = forme ? forme[2] : null;
        cont.innerHTML = `
            <table class="tabel-doc">
                <thead><tr><th>Stratul hărții</th><th>Ce se vede</th><th>Ce se schimbă față de azi</th></tr></thead>
                <tbody>
                    <tr><th scope="row">Regiuni</th>
                        <td><b>${NF.format(s.regiuni)}</b>: cele de dezvoltare de azi, cu București–Ilfov ca Metropolă</td>
                        <td>Aceleași limite; capătă consiliu ales și agențiile azi județene</td></tr>
                    <tr><th scope="row">Județe</th>
                        <td><b>${NF.format(date.judete.length)}</b>, cu limitele de azi</td>
                        <td>Rămân teritoriu, identitate, statistică (NUTS 3) și circumscripție electorală; consiliile
                            județene devin consilii regionale: ${NF.format(s.mandateRegionale)} de mandate în loc de
                            ${NF.format(s.mandateJudetene)}</td></tr>
                    <tr><th scope="row">Zone metropolitane și districte</th>
                        <td><b>${NF.format(d.length)}</b>, din care ${NF.format(s.districteMetropolitane)} zone metropolitane;
                            ${NF.format(Math.round(popMedie))} de locuitori în medie</td>
                        <td>Nivel nou, fără alegeri: circumscripția judecătoriei, adică orașul cu localitățile arondate lui.
                            ${NF.format(peCriterii)} îndeplinesc toate criteriile, ${NF.format(inBanda)} intră în banda
                            LEADER${voluntare ? `, ${NF.format(voluntare)} sunt constituite și prin alegere voluntară` : ""}</td></tr>
                    <tr><th scope="row">Comune și orașe</th>
                        <td><b>${NF.format(s.unitati.dupa)}</b>, cu populația mediană de ${NF.format(r.dupa.mediana)} loc.</td>
                        <td>Din ${NF.format(s.unitati.inainte)}; sub pragul de 5.000 de locuitori rămân
                            ${NF.format(r.dupa.subPrag)}, față de ${NF.format(r.inainte.subPrag)}</td></tr>
                    <tr><th scope="row">Sate</th>
                        <td><b>${NF.format(r.sate.length)}</b>, fiecare cu delegat sătesc și fond propriu</td>
                        <td>Un oficiu de 2–3 oameni în fiecare fostă reședință de comună</td></tr>
                </tbody>
            </table>
            <h3>Ce îmbunătățește</h3>
            <ul>
                <li><b>Bani:</b> aparatul primăriilor scade de la ${lei(c.aparat.inainte)} la ${lei(c.aparat.dupa)} pe an,
                    iar cel al consiliilor județene se înjumătățește — banii se mută din salarii în investiții.</li>
                <li><b>Capacitate:</b> bugetul mediu de investiții al unei unități crește de la
                    ${azi ? lei(azi.investitiiMedii) : "—"} la ${unit ? lei(unit.investitiiMedii) : "—"} pe an — de la
                    „nu putem cofinanța” la „putem duce un proiect”.</li>
                <li><b>Infrastructură:</b> unitățile fără nicio rețea de canalizare scad de la
                    ${azi ? NF.format(azi.faraCanal) : "—"} la ${unit ? NF.format(unit.faraCanal) : "—"}, iar la nivel de
                    district rămân ${dist ? NF.format(dist.faraCanal) : "—"}; fiecare formă are indicatorii ei, publici.</li>
                <li><b>Fonduri europene:</b> în fiecare district, câte un grup de acțiune locală în jurul
                    fiecărui oraș — ${NF.format(d.reduce((a, x) => a + (x.microregiuni || []).length, 0))} de microregiuni
                    în total — și un birou de proiecte; harta e desenată din start pe pragurile de eligibilitate.</li>
                <li><b>Reprezentare:</b> aleșii scad de la ${NF.format(s.alesi.inainte)} la ${NF.format(s.alesi.dupa)};
                    deasupra comunei rămân doar consilierii regionali.</li>
                <li><b>Prețul:</b> drumul mediu până la primărie crește de la ${NF1.format(r.inainte.timpMediu)} la
                    ${NF1.format(r.dupa.timpMediu)} minute — compensat de oficiul din sat și de transportul de district.</li>
            </ul>`;
    }

    /** Tabelele late se derulează în fișa lor, nu împing toată pagina în lateral. */
    function infasoaraTabele() {
        document.querySelectorAll(".continut-document .tabel-doc").forEach(tabel => {
            if (tabel.parentElement.classList.contains("tabel-derulant")) return;
            const cutie = document.createElement("div");
            cutie.className = "tabel-derulant";
            tabel.parentNode.insertBefore(cutie, tabel);
            cutie.appendChild(tabel);
        });
    }

    /** Cuprinsul arată capitolul la care s-a ajuns cu cititul. */
    function urmaresteCuprinsul() {
        const capitole = [];
        document.querySelectorAll(".cuprins a[href^='#']").forEach(a => {
            const capitol = document.getElementById(a.getAttribute("href").slice(1));
            if (capitol) capitole.push({ capitol: capitol, legatura: a });
        });
        if (!capitole.length) return;
        let activ = null;
        const actualizeaza = () => {
            // capitolul curent: ultimul al cărui început a trecut de treimea de sus a ecranului
            const prag = window.innerHeight / 3;
            const cuPozitie = capitole.map(c => ({ c: c, sus: c.capitol.getBoundingClientRect().top }));
            const maiJos = lista => lista.reduce((a, x) => !a || x.sus > a.sus ? x : a, null);
            // la capătul paginii, ultimul capitol nu mai are cum să urce până la prag
            const laCapat = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
            const curent = (maiJos(laCapat ? cuPozitie : cuPozitie.filter(x => x.sus <= prag)) || { c: capitole[0] }).c;
            if (curent === activ) return;
            activ = curent;
            capitole.forEach(c => c.legatura.removeAttribute("aria-current"));
            curent.legatura.setAttribute("aria-current", "true");
            // în șirul de etichete, cea activă se aduce la vedere fără să miște pagina
            const sir = curent.legatura.closest("ol");
            if (sir && sir.scrollWidth > sir.clientWidth) {
                sir.scrollLeft = curent.legatura.offsetLeft - sir.offsetLeft - 12;
            }
        };
        window.addEventListener("scroll", actualizeaza, { passive: true });
        window.addEventListener("resize", actualizeaza);
        actualizeaza();
    }

    async function porneste(dependente) {
        infasoaraTabele();
        urmaresteCuprinsul();
        try {
            const [date, index, finante, dotari, institutii, infra, alegeri, judecatorii, gal, institutiiJudetene, personal] = await Promise.all([
                json(CALE_UAT, true), json(CALE_INDEX, true),
                json(CALE_FINANTE), json(CALE_DOTARI), json(CALE_INSTITUTII),
                json(CALE_INFRA), json(CALE_CORECTII), json(CALE_JUDECATORII), json(CALE_GAL),
                json(CALE_INSTITUTII_JUDETENE), json(CALE_PERSONAL)
            ]);
            const topo = dependente.topologie.decodeaza(date);
            const vecini = dependente.topologie.vecini(topo);
            const exemple = await Promise.all(index.judete.map(j => json("date/" + j.fisier, true)));
            const r = dependente.reorganizare.calculeazaNational(date, vecini, exemple, {
                districte: true, dotari: dotari && dotari.localitati,
                // districtele pornesc de la circumscripțiile judecătoriilor; alegerile voluntare
                // făcute pe hartă trec înaintea lor și intră și în cifrele raportului
                corectii: dependente.reorganizare.alegeriCuCircumscriptii(judecatorii, (alegeri && alegeri.corectii) || []),
                comasari: (alegeri && alegeri.comasari) || []
            });
            const executie = indexeazaExecutia(date, finante);
            const c = costuri(date, r, executie, finante);
            const regional = institutii ? regionalizeaza(date, vecini, institutii, dependente) : null;
            const s = structura(date, r, regional);

            randeazaRezumat(r, c, s);
            randeazaDiagnostic(c);
            randeazaImpact(c);
            randeazaGuvernanta(r, c, s);
            randeazaComparatie(r, c, s, dotari);
            randeazaRepere(r, s, c);
            randeazaIpoteze(r, c, s);
            const I = dependente.infrastructura;
            randeazaInfrastructura(date, r, infra, finante, I);
            randeazaZonare(date, r, infra, finante, I, judecatorii);
            randeazaGal(date, r, gal);
            randeazaOrganizare(date, r, s, gal);
            randeazaStatut(r);
            randeazaInstitutii(date, r, institutii, institutiiJudetene);
            randeazaPersonal(date, r, executie, finante, personal);
            if (dependente.explorator) {
                dependente.explorator.porneste(dateExplorator(date, r, executie, infra, finante, I, gal));
            }
            randeazaSumarHarta(date, r, c, s, infra && I ? formeInfrastructura(date, r, infra, finante, I) : null);
            infasoaraTabele();
        } catch (e) {
            console.error(`[ro-adp] Raportul nu a putut fi calculat (${e.message}).`);
            document.querySelectorAll("#rezumat-cifre, #diagnostic-cifre, #comparatie-tabel, #repere-tabel, #ipoteze, #infrastructura-cifre, #sumar-harta-cifre, #tabel-districte, #gal-cifre, #institutii-cifre, #organizare-cifre, #statut-cifre, #personal-cifre")
                .forEach(el => {
                    el.innerHTML = `<p class="nota">Cifrele nu au putut fi calculate: ${esc(e.message)}.
                        Pagina trebuie servită prin HTTP, iar datele generate cu scripturile din <code>unelte/</code>.</p>`;
                });
        }
    }

    /** Simularea regională, pe aceleași date ca stratul de pe hartă. */
    function regionalizeaza(date, vecini, institutii, dependente) {
        const pregatit = dependente.regionalizare.pregatesteJudete(date, vecini, institutii);
        return dependente.regionalizare.calculeaza(pregatit.judete, pregatit.vecini, institutii.sisteme, {});
    }

    return {
        porneste: porneste
    };
}();
