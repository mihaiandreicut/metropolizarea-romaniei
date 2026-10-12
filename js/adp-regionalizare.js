/* ============================================================================
   e-ro-adp — nivelul al doilea: gruparea județelor în regiuni (calcul pur,
   fără DOM, fără Leaflet)

   Aceeași logică ca la comune, dar cu alte unități și alte criterii: nucleele
   sunt orașele care au deja funcții regionale (curte de apel, cameră a
   notarilor, direcție regională a finanțelor, agenție de dezvoltare), județele
   se alipesc la capitala cea mai apropiată, iar rafinarea mută județe dintr-o
   regiune în alta cât timp scade funcția-obiectiv:

     F = distanța medie a unui locuitor până la capitala regiunii
       + λpop × dezechilibrul de populație
       + λeco × dezechilibrul de PIB pe locuitor

   Regiunile rezultate sunt teritorii continue. Regiunea e nivelul ales: la ea se
   asimilează consiliul județean și prefectura. Județul nu se desființează, dar se
   subțiază până la un singur oficiu, bine organizat, care ține serviciile
   deconcentrate și controlul de legalitate — de aceea fiecare regiune raportează
   câte astfel de oficii ar avea (unul pe județ).

   Folosit de: adp-regiuni.js (stratul de hartă). Primește datele prin parametri.
   ========================================================================== */
window.AdpRegionalizare = function() {
    "use strict";

    const PARAMETRI_IMPLICITI = {
        nrRegiuni: 8,             // câte regiuni se formează
        lambdaPopulatie: 150,     // km echivalenți pentru un dezechilibru de populație de 100%
        lambdaEconomic: 60,       // idem, pentru dezechilibrul de PIB pe locuitor
        echilibruEconomic: true,  // se urmărește și apropierea nivelului economic între regiuni
        capitalaInstitutionala: true, // capitala e orașul cu cele mai multe funcții regionale
        respectaIstorice: false,  // o regiune nu amestecă regiuni istorice diferite
        metropola: true,          // Bucureștiul și Ilfovul formează o regiune separată — Metropola
        ocol: 1.3,               // drumul real / linia dreaptă, pentru distanțele estimate
        vitezaMedie: 70          // km/h, pentru transformarea distanței în minute
    };
    // cât cântărește fiecare funcție regională a unui oraș, la alegerea capitalei
    const PONDERI_INSTITUTII = { "curte-apel": 3, "camera-notari": 1, "dgrfp": 2, "adr": 2 };

    const R_PAMANT = 6371;

    function distanta(a, b) {
        const rad = x => x * Math.PI / 180;
        const dlat = rad(b[0] - a[0]), dlon = rad(b[1] - a[1]);
        const h = Math.sin(dlat / 2) ** 2 +
            Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dlon / 2) ** 2;
        return 2 * R_PAMANT * Math.asin(Math.sqrt(h));
    }

    /** Scorul instituțional al fiecărui județ: funcțiile regionale găzduite azi de reședința lui. */
    function scoruriInstitutionale(judete, sisteme) {
        const scor = new Map(judete.map(j => [j.c, { total: 0, functii: [] }]));
        (sisteme || []).forEach(s => {
            const pondere = PONDERI_INSTITUTII[s.cod] || 1;
            s.sedii.forEach(sediu => {
                // sediul e în județul lui: primul din circumscripție, prin convenția datelor
                const gazda = sediu.judete[0];
                const sc = scor.get(gazda);
                if (!sc) return;
                sc.total += pondere;
                sc.functii.push({ sistem: s.cod, nume: s.nume, oras: sediu.nume });
            });
        });
        return scor;
    }

    /**
     * @param judete     [{ c, nume, populatie, pib, pibLoc, suprafata, centru:[lat,lon], ist, adr, auto, oras }]
     * @param vecini     Map cod județ -> [coduri județe vecine]
     * @param sisteme    rețelele de instituții din date/regiuni-institutii.json
     * @param optiuni    parametri (vezi PARAMETRI_IMPLICITI)
     */
    function calculeaza(judete, vecini, sisteme, optiuni) {
        const P = Object.assign({}, PARAMETRI_IMPLICITI, optiuni || {});
        // Metropola: Bucureștiul împreună cu Ilfovul sunt scoși din calcul și adăugați la
        // final ca regiune proprie. Restul țării se împarte în P.nrRegiuni − 1 regiuni.
        const toateJudetele = judete;   // scorul instituțional se calculează pe toate, inclusiv Metropola
        let metropola = null;
        if (P.metropola) {
            const capitala = judete.find(j => j.auto === "B");
            const ilfov = judete.find(j => j.auto === "IF");
            if (capitala && ilfov) {
                metropola = { capitala: capitala, judete: [capitala, ilfov] };
                judete = judete.filter(j => j !== capitala && j !== ilfov);
                // vecinătățile se taie la fel, altfel creșterea ar încerca să ajungă la județe scoase
                const ramase = new Set(judete.map(j => j.c));
                vecini = new Map(Array.from(vecini)
                    .filter(([cod]) => ramase.has(cod))
                    .map(([cod, lista]) => [cod, lista.filter(n => ramase.has(n))]));
                P.nrRegiuni = Math.max(1, P.nrRegiuni - 1);
            }
        }
        const dupaCod = new Map(judete.map(j => [j.c, j]));
        const scorInst = scoruriInstitutionale(toateJudetele, sisteme);
        const popTotala = judete.reduce((a, j) => a + j.populatie, 0);
        const pibTotal = judete.reduce((a, j) => a + (j.pibTotal || 0), 0);
        const pibLocMediu = pibTotal ? 1e6 * pibTotal / popTotala : 0;
        const tinta = popTotala / P.nrRegiuni;

        /** Distanța estimată pe drum (km) de la un județ la capitala unei regiuni. */
        const km = (j, capitala) => P.ocol * distanta(j.centru, dupaCod.get(capitala).oras.e);

        // --- 1. capitalele: orașele cu cele mai multe funcții regionale, depărtate între ele
        function alegeCapitale() {
            const candidati = judete.slice().sort((a, b) => {
                const sa = scorInst.get(a.c).total, sb = scorInst.get(b.c).total;
                if (P.capitalaInstitutionala && sa !== sb) return sb - sa;
                return b.oras.p - a.oras.p;
            });
            const alese = [candidati[0].c];
            while (alese.length < P.nrRegiuni && alese.length < judete.length) {
                let best = null;
                candidati.forEach(j => {
                    if (alese.includes(j.c)) return;
                    const d = Math.min(...alese.map(c => distanta(j.centru, dupaCod.get(c).centru)));
                    const scor = (P.capitalaInstitutionala ? 1 + scorInst.get(j.c).total : 1) *
                        Math.sqrt(j.oras.p) * d;
                    if (!best || scor > best.scor) best = { c: j.c, scor: scor };
                });
                alese.push(best.c);
            }
            return alese;
        }

        // --- 2. creșterea regiunilor: fiecare județ merge la capitala cea mai apropiată,
        // dar numai prin vecinătăți, ca regiunile să rămână continue
        function creste(capitale) {
            const regiune = new Map(capitale.map(c => [c, c]));
            const coada = [];
            const pune = (j, cap) => coada.push({ c: j, cap: cap, d: km(dupaCod.get(j), cap) });
            capitale.forEach(c => (vecini.get(c) || []).forEach(n => {
                if (!regiune.has(n)) pune(n, c);
            }));
            while (coada.length) {
                coada.sort((a, b) => a.d - b.d);
                const x = coada.shift();
                if (regiune.has(x.c)) continue;
                // cu regula istorică activă, un județ nu intră într-o regiune de altă regiune
                // istorică; dacă nicio capitală nu se potrivește, rămâne pentru pasul următor
                if (P.respectaIstorice && dupaCod.get(x.c).ist !== dupaCod.get(x.cap).ist) continue;
                regiune.set(x.c, x.cap);
                (vecini.get(x.c) || []).forEach(n => {
                    if (!regiune.has(n)) pune(n, x.cap);
                });
            }
            // județele rămase (regula istorică le-a blocat) merg la vecinul cel mai apropiat
            judete.forEach(j => {
                if (regiune.has(j.c)) return;
                const v = (vecini.get(j.c) || []).filter(n => regiune.has(n));
                if (!v.length) return;
                const ales = v.reduce((a, n) =>
                    !a || km(j, regiune.get(n)) < km(j, regiune.get(a)) ? n : a, null);
                regiune.set(j.c, regiune.get(ales));
            });
            return regiune;
        }

        // --- funcția-obiectiv
        function membri(regiune, cap) {
            return judete.filter(j => regiune.get(j.c) === cap);
        }
        function obiectiv(regiune, capitale) {
            let sumaDistante = 0;
            capitale.forEach(cap => {
                membri(regiune, cap).forEach(j => { sumaDistante += j.populatie * km(j, cap); });
            });
            let dezechilibru = 0, dezechilibruEco = 0;
            capitale.forEach(cap => {
                const m = membri(regiune, cap);
                const pop = m.reduce((a, j) => a + j.populatie, 0);
                dezechilibru += (pop / tinta - 1) ** 2;
                if (P.echilibruEconomic && pibLocMediu) {
                    const pib = m.reduce((a, j) => a + (j.pibTotal || 0), 0);
                    const pl = pop ? 1e6 * pib / pop : pibLocMediu;
                    dezechilibruEco += (pl / pibLocMediu - 1) ** 2;
                }
            });
            return sumaDistante / popTotala +
                P.lambdaPopulatie * dezechilibru / capitale.length +
                P.lambdaEconomic * dezechilibruEco / capitale.length;
        }

        /** Regiunea rămâne dintr-o bucată dacă i se scoate un județ? */
        function ramaneContinua(regiune, cap, fara) {
            const set = new Set(membri(regiune, cap).map(j => j.c).filter(c => c !== fara));
            if (!set.size) return false;
            const start = set.values().next().value;
            const vazut = new Set([start]);
            const stiva = [start];
            while (stiva.length) {
                const c = stiva.pop();
                (vecini.get(c) || []).forEach(n => {
                    if (set.has(n) && !vazut.has(n)) {
                        vazut.add(n);
                        stiva.push(n);
                    }
                });
            }
            return vazut.size === set.size;
        }

        // --- 3. rafinare: mutări de județe între regiuni vecine, cât timp scade obiectivul
        function rafineaza(regiune, capitale) {
            let f = obiectiv(regiune, capitale);
            for (let pas = 0; pas < 300; pas++) {
                let best = null;
                judete.forEach(j => {
                    const cap = regiune.get(j.c);
                    if (cap === j.c) return;   // capitala nu pleacă din regiunea ei
                    const tinteVecine = new Set((vecini.get(j.c) || [])
                        .map(n => regiune.get(n)).filter(c => c !== undefined && c !== cap));
                    tinteVecine.forEach(alta => {
                        if (P.respectaIstorice && dupaCod.get(j.c).ist !== dupaCod.get(alta).ist) return;
                        if (!ramaneContinua(regiune, cap, j.c)) return;
                        regiune.set(j.c, alta);
                        const nou = obiectiv(regiune, capitale);
                        regiune.set(j.c, cap);
                        if (nou < f - 1e-6 && (!best || nou < best.f)) best = { c: j.c, alta: alta, f: nou };
                    });
                });
                if (!best) break;
                regiune.set(best.c, best.alta);
                f = best.f;
            }
            return f;
        }

        /** Capitala fiecărei regiuni, recalculată după forma ei finală. */
        function asazaCapitale(regiune, capitale) {
            const noi = capitale.map(cap => {
                const m = membri(regiune, cap);
                let best = null;
                m.forEach(j => {
                    const medie = m.reduce((a, x) =>
                        a + x.populatie * P.ocol * distanta(x.centru, j.oras.e), 0) / Math.max(1, m.reduce((a, x) => a + x.populatie, 0));
                    const inst = scorInst.get(j.c).total;
                    // se preferă orașul cu funcții regionale, dacă nu e mult mai departe
                    const cost = medie * (P.capitalaInstitutionala ? 1 / (1 + 0.15 * inst) : 1);
                    if (!best || cost < best.cost) best = { c: j.c, cost: cost, medie: medie };
                });
                return { veche: cap, noua: best.c };
            });
            const schimbate = noi.filter(x => x.veche !== x.noua);
            const harta = new Map(noi.map(x => [x.veche, x.noua]));
            const rezultat = new Map();
            regiune.forEach((cap, c) => rezultat.set(c, harta.get(cap)));
            return { regiune: rezultat, capitale: noi.map(x => x.noua), schimbate: schimbate.length };
        }

        let capitale = alegeCapitale();
        let regiune = creste(capitale);
        rafineaza(regiune, capitale);
        for (let runda = 0; runda < 3; runda++) {
            const r = asazaCapitale(regiune, capitale);
            if (!r.schimbate) break;
            regiune = r.regiune;
            capitale = r.capitale;
            rafineaza(regiune, capitale);
        }

        // --- 4. rezultatul, cu indicatorii fiecărei regiuni
        const regiuni = capitale.map(cap => {
            const m = membri(regiune, cap);
            const pop = m.reduce((a, j) => a + j.populatie, 0);
            const pib = m.reduce((a, j) => a + (j.pibTotal || 0), 0);
            const capitalaJud = dupaCod.get(cap);
            const distante = m.map(j => ({ j: j, km: km(j, cap) }));
            const maxim = distante.reduce((a, x) => !a || x.km > a.km ? x : a, null);
            const salariu = pop ? m.reduce((a, j) => a + (j.euroPeOra || 0) * j.populatie, 0) / pop : null;
            const institutii = [];
            m.forEach(j => scorInst.get(j.c).functii.forEach(f => institutii.push(Object.assign({ judet: j.c }, f))));
            return {
                capitala: cap,
                nume: capitalaJud.oras.n,
                judete: m.map(j => j.c),
                populatie: pop,
                pibTotal: pib,
                pibLoc: pop ? Math.round(1e6 * pib / pop) : null,
                euroPeOra: salariu || null,
                suprafata: m.reduce((a, j) => a + (j.suprafata || 0), 0),
                kmMediu: pop ? distante.reduce((a, x) => a + x.j.populatie * x.km, 0) / pop : 0,
                kmMax: maxim ? maxim.km : 0,
                judetCelMaiDepartat: maxim ? maxim.j.c : null,
                minuteMax: maxim ? 60 * maxim.km / P.vitezaMedie : 0,
                oficiiJudetene: m.length,            // un singur oficiu în fiecare județ al regiunii
                institutii: institutii,
                scorCapitala: scorInst.get(cap).total,
                istorice: Array.from(new Set(m.map(j => j.ist))),
                adr: Array.from(new Set(m.map(j => j.adr)))
            };
        }).sort((a, b) => b.populatie - a.populatie);

        if (metropola) {
            const m = metropola.judete;
            const pop = m.reduce((a, j) => a + j.populatie, 0);
            const pib = m.reduce((a, j) => a + (j.pibTotal || 0), 0);
            regiuni.unshift({
                capitala: metropola.capitala.c,
                nume: "București — Metropola",
                metropola: true,
                judete: m.map(j => j.c),
                populatie: pop,
                pibTotal: pib,
                pibLoc: pop ? Math.round(1e6 * pib / pop) : null,
                euroPeOra: pop ? m.reduce((a, j) => a + (j.euroPeOra || 0) * j.populatie, 0) / pop : null,
                suprafata: m.reduce((a, j) => a + (j.suprafata || 0), 0),
                kmMediu: 0, kmMax: 0, judetCelMaiDepartat: null, minuteMax: 0,
                // Ilfovul intră în Metropolă, deci rămâne un singur oficiu, al Capitalei
                oficiiJudetene: 1,
                institutii: m.flatMap(j => scorInst.get(j.c).functii.map(f => Object.assign({ judet: j.c }, f))),
                scorCapitala: scorInst.get(metropola.capitala.c).total,
                istorice: Array.from(new Set(m.map(j => j.ist))),
                adr: Array.from(new Set(m.map(j => j.adr)))
            });
            m.forEach(j => regiune.set(j.c, metropola.capitala.c));
        }

        const pop = regiuni.map(r => r.populatie);
        const pibLoc = regiuni.map(r => r.pibLoc).filter(x => x);
        const indicatori = {
            nrRegiuni: regiuni.length,
            populatieMedie: regiuni.reduce((a, r) => a + r.populatie, 0) / regiuni.length,
            raportPopulatie: Math.max(...pop) / Math.min(...pop),
            raportPibLoc: pibLoc.length ? Math.max(...pibLoc) / Math.min(...pibLoc) : null,
            kmMediu: popTotala ? regiuni.reduce((a, r) => a + r.kmMediu * r.populatie, 0) / popTotala : 0,
            minuteMediu: popTotala ? 60 * regiuni.reduce((a, r) => a + r.kmMediu * r.populatie, 0) / popTotala / P.vitezaMedie : 0,
            kmMax: Math.max(...regiuni.map(r => r.kmMax)),
            capitaleCuCurteDeApel: regiuni.filter(r =>
                r.institutii.some(i => i.sistem === "curte-apel" && i.judet === r.capitala)).length,
            oficiiJudetene: regiuni.reduce((a, r) => a + r.oficiiJudetene, 0),
            obiectiv: obiectiv(regiune, capitale)
        };

        return { parametri: P, regiuni: regiuni, judetRegiune: regiune, indicatori: indicatori };
    }

    /**
     * Județele, pregătite pentru `calculeaza`: populație, suprafață, centru, economie și
     * reședință, plus vecinătățile la nivel de județ. Aceeași pregătire o folosesc stratul
     * de hartă, raportul și scenariul final, ca să nu existe trei variante ale ei.
     *
     * @param date        romania-uat.json
     * @param vecini      AdpTopologie.vecini(topo)
     * @param institutii  date/regiuni-institutii.json
     */
    function pregatesteJudete(date, vecini, institutii) {
        const eco = new Map((institutii.judete || []).map(j => [j.c, j]));
        const dupaNuts = new Map((institutii.regiuni || []).map(r => [r.cod, r]));
        const judete = date.judete.map(j => {
            const uats = date.uat.filter(u => u.j === j.c);
            const resedinta = uats.find(u => u.r) || uats[0];
            const e = eco.get(j.c) || {};
            const nuts2 = dupaNuts.get((e.nuts || "").slice(0, 4));
            const istPop = new Map();
            uats.forEach(u => istPop.set(u.ist, (istPop.get(u.ist) || 0) + (u.p21 || 0)));
            return {
                c: j.c, nume: j.n, auto: j.auto, adr: j.adr,
                ist: Array.from(istPop.entries()).sort((a, b) => b[1] - a[1])[0][0],
                populatie: uats.reduce((a, u) => a + (u.p21 || 0), 0),
                suprafata: uats.reduce((a, u) => a + (u.a || 0), 0),
                centru: e.centru, pibTotal: e.pibTotal, pibLoc: e.pibLoc,
                euroPeOra: nuts2 ? nuts2.euroPeOra : null,
                nuts2: nuts2 ? nuts2.nume : null,
                oras: { n: resedinta.n, e: resedinta.e, p: resedinta.p21, s: resedinta.s }
            };
        }).filter(j => j.centru);
        const seturi = new Map(judete.map(j => [j.c, new Set()]));
        date.uat.forEach((u, i) => {
            const set = seturi.get(u.j);
            if (!set) return;
            vecini[i].forEach(n => {
                const alt = date.uat[n].j;
                if (alt !== u.j && seturi.has(alt)) set.add(alt);
            });
        });
        return { judete: judete, vecini: new Map(Array.from(seturi, ([k, v]) => [k, Array.from(v)])) };
    }

    /** Compară mai multe variante (numere de regiuni) cu aceleași criterii. */
    function compara(judete, vecini, sisteme, numere, optiuni) {
        return numere.map(n => calculeaza(judete, vecini, sisteme, Object.assign({}, optiuni, { nrRegiuni: n })));
    }

    return {
        PARAMETRI_IMPLICITI: PARAMETRI_IMPLICITI,
        PONDERI_INSTITUTII: PONDERI_INSTITUTII,
        distanta: distanta,
        pregatesteJudete: pregatesteJudete,
        calculeaza: calculeaza,
        compara: compara
    };
}();
