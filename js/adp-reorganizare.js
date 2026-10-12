/* ============================================================================
   e-ro-adp — algoritmul de reorganizare (calcul pur, fără DOM, fără Leaflet)

   Unitatea care se comasează e UAT-ul actual (limitele lui sunt cunoscute);
   unitatea de ANALIZĂ e localitatea componentă: accesibilitatea, dotările și
   populația fiecărui sat decid unde merge UAT-ul și unde stă reședința, iar
   satele care ar sta mai bine în altă unitate nouă sunt semnalate pentru
   transfer (Legea 351/2001 permite mutarea satelor între comune).

   Ordinea etapelor — comuna întâi cu comuna, orașul abia la urmă:
     A. nuclee rurale: comunele care trec singure pragul durabil își alipesc
        vecinele rurale (cel mai mic timp mediu de la satele lor, fără sate noi
        peste tMax, fără coborârea unei minorități sub pragul de 20%);
     B. comunele rămase fără nucleu formează nuclee noi, după scorul de centralitate;
     C. orașele și municipiile pornesc ca unități de sine stătătoare;
     D. grupurile rurale rămase sub prag se comasează între ele;
     E. abia apoi un rest rural se alipește de un oraș — numai dacă orașul e mic
        (sub pragul de autonomie) sau dacă grupul rural nu mai are niciun vecin
        rural cu care să se poată comasa;
     F. rafinare prin mutări locale (tip AZP, Openshaw 1977): o comună trece în
        grupul vecin dacă scade timpul total de deplasare plus penalizarea
        grupurilor sub prag;
     G. forțare: nicio unitate nu rămâne sub prag. Satele ajunse peste tMax
        primesc birou local obligatoriu; singura unitate care poate rămâne sub
        prag e cea unde comasarea ar coborî o minoritate sub 20% (derogare).

   Pragul e DURABIL: se compară cu populația de azi ȘI cu proiecția la 2050
   (ritmul 2011→2024 pe populația de domiciliu, plafonat și corectat cu
   îmbătrânirea). O unitate nouă trebuie să treacă pragul în ambele.

   Fiecare unitate propusă își păstrează jurnalul deciziilor (`dosar`) și lista
   de condiții verificate (`conditii`), ca alegerea să fie explicabilă la clic.

   Folosit de: adp-scenariu.js (harta), adp-metodologie.js (tabelele din
   metodologie.html). Primește datele prin parametri.
   ========================================================================== */
window.AdpReorganizare = function() {
    "use strict";

    const PARAMETRI_IMPLICITI = {
        pMin: 5000,            // populația minimă a unei comune noi
        pTinta: 7000,          // ținta: comasările cresc spre ea, nu se opresc la minim
        pMinOras: 7000,        // populația minimă a unei unități cu reședința în oraș
        pTintaOras: 9000,      // ținta pentru unitățile urbane
        pMaxOras: 100000,      // un oraș care nu e reședință de județ nu crește peste atât
        tMax: 30,              // minute cu mașina, sat → reședință
        pSatMin: 50,           // satele sub acest prag nu blochează o comasare (doar se semnalează)
        // orașul nu înghite comune: rămâne oraș, iar comunele din jur i se asociază în district
        absorbtieUrbana: false,
        // excepția: orașul mic (sub pOrasMic) preia, ca ultimă soluție, UAT-urile mici din jur,
        // care altfel ar rămâne sub prag — rămâne oraș și centru de district pentru celelalte
        orasMicPreia: true,
        pOrasMic: 25000,       // de la câți locuitori în sus un oraș nu mai preia comune
        // un oraș de cel mult 20.000 de locuitori nu trece, prin comasare, peste acest prag: altfel
        // el și comunele preluate ar ieși din aria LEADER
        pastreazaLeader: true,
        pOrasAutonom: 10000,   // prag unic de autonomie urbană, când praguriLegale e oprit
        praguriLegale: true,   // Legea 351/2001: pragul de autonomie e cel al rangului
        pragOras: 5000,        // populația minimă a unui oraș (Legea 351/2001, anexa II)
        pragMunicipiu: 25000,  // populația minimă a unui municipiu
        pMaxRural: 15000,      // o unitate rurală nu crește peste atât: altfel ar trebui să fie oraș
        respectaIstorice: false, // unitățile noi nu trec peste granițele regiunilor istorice
        tBirou: 15,            // fosta reședință peste acest timp de noua reședință păstrează un birou local
        tAccesibil: 15,        // raza (minute) pentru populația accesibilă din scorul de centralitate
        pragMinoritate: 20,    // % — Codul administrativ: folosirea limbii materne în administrație
        // ce se întâmplă când o comasare ar coborî o minoritate de peste 20% sub prag:
        //   "blocheaza"  — comasarea nu se face (litera art. 94 de azi, aplicat la nivel de UAT);
        //   "localitate" — comasarea se face, dar dreptul la limba maternă se păstrează la nivelul
        //                  localității componente, ca derogare scrisă în dosar;
        //   "ignora"     — pragul nu e luat în seamă.
        regimMinoritati: "localitate",
        proiectie: true,       // pragul se verifică și pe populația proiectată
        anProiectie: 2050,     // orizontul proiecției demografice
        forteaza: true,        // nicio unitate sub prag în final, în afara derogărilor
        tMaxFortat: 45,        // nici forțarea nu duce un sat mai departe de atât de reședință
        // alegerile voluntare: [{ uat, district }], coduri SIRUTA — UAT-ul intră în districtul
        // cu reședința în UAT-ul `district`. Două UAT-uri cu alegeri diferite nu se comasează.
        corectii: null,
        // comasările alese de mână: [{ uat, cu }], coduri SIRUTA — cele două UAT-uri ajung în
        // aceeași unitate, oricum ar fi ieșit din calcul; criteriile se verifică la fel
        comasari: null
    };
    const TIP_RESEDINTA = [9, 17, 22];
    const AN_BAZA = 2021;          // anul recensământului folosit ca bază a proiecției
    const RITM_MIN = -0.03;        // declinul anual nu se extrapolează sub -3%
    const RITM_MAX = 0.01;         // nici creșterea peste +1%: 30 de ani de creștere mare nu se presupun
    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 });

    /** Coadă cu priorități minimă (heap binar) pe [cost, ...]. */
    function Coada() {
        const a = [];
        return {
            gol: () => a.length === 0,
            pune(x) {
                a.push(x);
                let i = a.length - 1;
                while (i > 0) {
                    const p = (i - 1) >> 1;
                    if (a[p][0] <= a[i][0]) break;
                    [a[p], a[i]] = [a[i], a[p]];
                    i = p;
                }
            },
            scoate() {
                const v = a[0];
                const u = a.pop();
                if (a.length) {
                    a[0] = u;
                    let i = 0;
                    for (;;) {
                        const s = 2 * i + 1, d = s + 1;
                        let m = i;
                        if (s < a.length && a[s][0] < a[m][0]) m = s;
                        if (d < a.length && a[d][0] < a[m][0]) m = d;
                        if (m === i) break;
                        [a[m], a[i]] = [a[i], a[m]];
                        i = m;
                    }
                }
                return v;
            }
        };
    }

    function nivelScoala(sc) {
        if (!sc) return 0;
        return sc[3] ? 3 : sc[2] ? 2 : sc[1] ? 1 : sc[0] ? 0.5 : 0;
    }

    /**
     * Ritmul anual de schimbare a populației unui UAT: tendința 2011 → 2024 pe
     * populația cu domiciliul, plafonată, la care se adaugă declinul natural
     * acolo unde vârstnicii sunt de peste 1,5 ori mai mulți decât copiii.
     * E un model simplu și declarat, nu proiecția oficială a INS — dar e
     * suficient ca pragul să nu fie trecut azi și ratat peste 25 de ani.
     */
    function ritmAnual(u) {
        if (!u.p11d || !u.p24) return 0;
        let r = Math.pow(u.p24 / u.p11d, 1 / 13) - 1;
        const imbatranire = u.v014 > 0 ? u.v65 / u.v014 : 3;
        r -= 0.002 * Math.max(0, imbatranire - 1.5);
        return Math.max(RITM_MIN, Math.min(RITM_MAX, r));
    }

    /** Populația unui UAT proiectată la un an, pornind de la recensământul 2021. */
    function proiecteaza(u, an) {
        return Math.round((u.p21 || 0) * Math.pow(1 + ritmAnual(u), Math.max(0, an - AN_BAZA)));
    }

    /**
     * @param date     romania-uat.json (obiectul întreg)
     * @param vecini   AdpTopologie.vecini(topo) — vecinii fiecărui UAT (indecși)
     * @param ex       date/judete/<judet>.json (accesibilitatea localităților)
     * @param optiuni  parametri (vezi PARAMETRI_IMPLICITI)
     */
    function calculeaza(date, vecini, ex, optiuni) {
        const P = Object.assign({}, PARAMETRI_IMPLICITI, optiuni || {});
        const uatJud = [];
        date.uat.forEach((u, i) => { if (u.j === ex.judet) uatJud.push(i); });
        const inJud = new Set(uatJud);
        const coloana = new Map(ex.resedinte.map((s, k) => [s, k]));

        // --- localitățile fiecărui UAT și reședința actuală
        const sateUat = new Map(uatJud.map(i => [i, []]));
        const idxDupaSiruta = new Map(uatJud.map(i => [date.uat[i].s, i]));
        const col = new Map();          // UAT -> coloana reședinței lui în matricea de timpi
        const satResedinta = new Map(); // UAT -> indexul satului-reședință
        ex.sate.forEach((s, k) => {
            const i = idxDupaSiruta.get(s.u);
            if (i === undefined) return;
            sateUat.get(i).push(k);
            if (TIP_RESEDINTA.includes(s.t)) {
                col.set(i, coloana.get(s.s));
                satResedinta.set(i, k);
            }
        });
        const timp = (k, c) => {
            const v = ex.timp[k][c];
            return v === null || v === undefined ? Infinity : v;
        };
        const pop = k => Math.max(1, ex.sate[k].p || 0);
        const urban = i => date.uat[i].t !== "comună";
        const nume = i => date.uat[i].n;

        // --- alegerile voluntare: districtul cerut de fiecare UAT (reședința lui ține de el)
        const cerut = new Map();
        (P.corectii || []).forEach(c => {
            const i = idxDupaSiruta.get(c.uat);
            if (i !== undefined && idxDupaSiruta.has(c.district)) cerut.set(i, c.district);
        });
        Array.from(cerut.values()).forEach(d => {
            const i = idxDupaSiruta.get(d);
            if (!cerut.has(i)) cerut.set(i, d);
        });
        /** Într-o unitate nu ajung UAT-uri care au cerut districte diferite. */
        const aceeasiAlegere = lista => new Set(lista.map(i => cerut.get(i)).filter(d => d !== undefined)).size <= 1;
        /** UAT-uri cu alegere, laolaltă cu UAT-uri fără: se admite doar ca ultimă soluție. */
        const amestec = lista => lista.some(i => cerut.has(i)) && lista.some(i => !cerut.has(i));
        // Când un UAT cu alegere trebuie totuși comasat cu vecini care n-au ales, îi trage după
        // el în districtul cerut. Se numără câți dintre ei țin, după drum, de alt oraș: se
        // preferă comasarea care mută cei mai puțini.
        const orase = uatJud.filter(urban);
        const orasApropiat = new Map(uatJud.map(i => [i, orase.reduce((a, o) =>
            a === null || timp(satResedinta.get(i), col.get(o)) < timp(satResedinta.get(i), col.get(a)) ? o : a, null)]));
        const trasi = lista => {
            const d = lista.map(i => cerut.get(i)).find(x => x !== undefined);
            if (d === undefined) return 0;
            return lista.filter(i => !cerut.has(i) && orasApropiat.get(i) !== null &&
                date.uat[orasApropiat.get(i)].s !== d).length;
        };

        // --- pragul durabil: populația de azi și proiecția la anProiectie
        const proiectat = new Map(uatJud.map(i => [i, proiecteaza(date.uat[i], P.anProiectie)]));
        const pAzi = lista => lista.reduce((a, i) => a + date.uat[i].p21, 0);
        const pViitor = lista => lista.reduce((a, i) => a + proiectat.get(i), 0);
        /** Populația de referință a unui grup: cea mai mică dintre azi și proiecție. */
        const pRef = lista => P.proiectie ? Math.min(pAzi(lista), pViitor(lista)) : pAzi(lista);
        /** Pragurile unei unități: altele pentru comune, altele pentru cele cu oraș. */
        const areOras = lista => lista.some(urban);
        const pragUnitate = lista => areOras(lista) ? P.pMinOras : P.pMin;
        const tintaUnitate = lista => areOras(lista) ? P.pTintaOras : P.pTinta;
        const viabil = lista => pRef(lista) >= pragUnitate(lista);
        // deficitul se măsoară față de țintă, ca rafinarea să împingă unitățile spre ea
        const deficit = lista => Math.max(0, tintaUnitate(lista) - pRef(lista));
        const estePol = i => viabil([i]);
        /**
         * Pragul de la care un oraș se descurcă singur. Cu praguri legale, e chiar
         * pragul rangului (Legea 351/2001): un municipiu sub 25.000 sau un oraș sub
         * 5.000 nu-și susține statutul, deci are voie să preia comune din jur.
         */
        const pragAutonomie = i => P.praguriLegale
            ? (date.uat[i].t === "municipiu" ? P.pragMunicipiu : P.pragOras)
            : P.pOrasAutonom;
        const orasMic = i => pRef([i]) < pragAutonomie(i);

        // --- scor de centralitate al fiecărei reședințe actuale
        const scor = new Map();
        uatJud.forEach(i => {
            const c = col.get(i);
            let accesibil = 0;
            ex.sate.forEach((s, k) => { if (timp(k, c) <= P.tAccesibil) accesibil += s.p || 0; });
            const satR = ex.sate[satResedinta.get(i)];
            const servicii = Object.keys(satR.serv || {}).length;
            scor.set(i, {
                total: accesibil / 1000 + nivelScoala(satR.sc) + Math.min(servicii, 8) / 4 + (urban(i) ? 3 : 0),
                accesibil: accesibil,
                scoala: nivelScoala(satR.sc),
                servicii: servicii
            });
        });

        /** Cost de alipire a UAT-ului i la o reședință (coloana c). */
        function cost(i, c) {
            let suma = 0, greutate = 0, max = 0, maxToate = 0, depasiri = 0;
            sateUat.get(i).forEach(k => {
                const t = timp(k, c);
                suma += t * pop(k);
                greutate += pop(k);
                if (t > maxToate) maxToate = t;
                if ((ex.sate[k].p || 0) >= P.pSatMin) {
                    if (t > max) max = t;
                    if (t > P.tMax) depasiri++;
                }
            });
            return { mediu: suma / greutate, max: max || maxToate, depasiri: depasiri };
        }
        // depășirile de acum (sate deja peste tMax față de reședința lor actuală): o comasare
        // nu are voie să adauge depășiri noi, dar nici nu e blocată de cele existente
        const depasiriAcum = new Map(uatJud.map(i => [i, cost(i, col.get(i)).depasiri]));
        const accesibil = (i, c) => cost(i, c).depasiri <= depasiriAcum.get(i);

        // --- grupuri: fiecare are un id stabil, o reședință și un jurnal de decizii
        let idUrmator = 1;
        let contorJurnal = 0;      // ordinea deciziilor: jurnalele fuzionate se reașază cronologic
        const gid = new Map();     // UAT -> id grup
        const sediu = new Map();   // id grup -> UAT reședință
        const jurnal = new Map();  // id grup -> [{ nr, regula, text }]
        const membri = id => uatJud.filter(i => gid.get(i) === id);
        const colG = id => col.get(sediu.get(id));
        const greutateUat = new Map(uatJud.map(i => [i, sateUat.get(i).reduce((a, k) => a + pop(k), 0)]));

        function grupNou(i, regula, text) {
            const id = idUrmator++;
            gid.set(i, id);
            sediu.set(id, i);
            jurnal.set(id, [{ nr: contorJurnal++, regula: regula, text: text }]);
            return id;
        }
        function noteaza(id, regula, text) {
            jurnal.get(id).push({ nr: contorJurnal++, regula: regula, text: text });
        }
        function idGrupuri() {
            return Array.from(new Set(uatJud.map(i => gid.get(i))));
        }
        function vecineleGrupului(m, id) {
            const s = new Set();
            m.forEach(i => vecini[i].forEach(n => {
                if (inJud.has(n) && gid.get(n) !== id) s.add(gid.get(n));
            }));
            return Array.from(s);
        }

        /**
         * Niciun UAT cu o minoritate ≥ prag nu ajunge, în grup, sub prag (Codul administrativ).
         * Blochează comasarea doar în regimul „blocheaza”; în regimul „localitate” pierderea
         * pragului se acceptă, dar se scrie ca derogare (dreptul rămâne la localitate).
         */
        function respectaMinoritati(lista) {
            if (P.regimMinoritati !== "blocheaza") return true;
            const tot = pAzi(lista);
            return lista.every(i => {
                const et = date.uat[i].et;
                if (!et || !et.min || et.pmin < P.pragMinoritate) return true;
                const n = lista.reduce((a, j) => {
                    const e = date.uat[j].et;
                    return a + (e && e.min === et.min ? date.uat[j].p21 * e.pmin / 100 : 0);
                }, 0);
                return 100 * n / tot >= P.pragMinoritate;
            });
        }

        /**
         * Regula urbană: comunele se grupează întâi între ele. Un oraș primește
         * comune doar dacă e sub pragul de autonomie; două orașe nu se comasează.
         * `ultima` = ultimă soluție (forțare, sau grup rural fără vecin rural bun).
         */
        function permisUrban(lista, ultima, ruralMic) {
            const orase = lista.filter(urban);
            if (!orase.length || lista.length === 1) return true;
            // `ruralMic`: grupul rural care intră e el însuși sub prag (îl știe cine face comasarea);
            // fără el, se cere ca tot ruralul unității să fie sub prag
            const mic = ruralMic === undefined ? !viabil(lista.filter(i => !urban(i))) : ruralMic;
            if (ultima && P.orasMicPreia && orase.length === 1 && pRef(orase) < P.pOrasMic && mic &&
                (!P.pastreazaLeader || pAzi(orase) > PRAG_ORAS_LEADER || pAzi(lista) <= PRAG_ORAS_LEADER)) return true;
            if (!P.absorbtieUrbana) return false;
            if (orase.length > 1) return !!ultima;
            return !!ultima || orasMic(orase[0]);
        }

        /**
         * O unitate fără oraș nu crește oricât: peste pMaxRural ar trebui oricum
         * declarată oraș, deci se oprește creșterea (în afara forțării). Tot aici
         * stă și regula opțională de a nu trece peste granițele regiunilor istorice.
         */
        function permisMarime(lista, ultima) {
            if (!aceeasiAlegere(lista)) return false;
            // cele care au ales același district se grupează întâi între ele
            if (!ultima && amestec(lista)) return false;
            if (P.respectaIstorice && new Set(lista.map(i => date.uat[i].ist)).size > 1) return false;
            // un oraș care nu e reședință de județ nu trece de plafon prin comasare
            if (lista.some(i => urban(i) && !date.uat[i].r) && !lista.some(i => date.uat[i].r) &&
                pAzi(lista) > P.pMaxOras) return false;
            if (ultima || lista.some(urban)) return true;
            return pAzi(lista) <= P.pMaxRural;
        }

        /**
         * Evaluează fiecare candidat la reședința unui grup. Ordinea criteriilor:
         *   1. dacă grupul are un oraș, reședința e obligatoriu orașul;
         *   2. niciun UAT nu capătă sate peste tMax pe care nu le avea deja („respectă”);
         *   3. cât mai puține sate peste tMax, în total;
         *   4. reședință bine dotată (scor de centralitate ≥ 60% din maximul grupului);
         *   5. cel mai mic timp mediu de deplasare, ponderat cu populația.
         * Primul candidat e cel ales; restul rămân pentru justificare.
         */
        function evalueazaSedii(lista) {
            const areUrban = lista.some(urban);
            const maxScor = Math.max(...lista.map(i => scor.get(i).total));
            const candidati = lista.map(s => {
                let suma = 0, g = 0, max = 0, dep = 0, respecta = true;
                lista.forEach(i => {
                    const c = cost(i, col.get(s));
                    suma += c.mediu * greutateUat.get(i);
                    g += greutateUat.get(i);
                    if (c.max > max) max = c.max;
                    dep += c.depasiri;
                    if (c.depasiri > depasiriAcum.get(i)) respecta = false;
                });
                return {
                    sediu: s, mediu: suma / g, max: max, depasiri: dep, respecta: respecta,
                    scor: scor.get(s).total,
                    eligibil: areUrban ? urban(s) : true,
                    preferat: areUrban ? urban(s) : scor.get(s).total >= 0.6 * maxScor
                };
            });
            const cheie = x => [x.eligibil ? 0 : 1, x.respecta ? 0 : 1, x.depasiri, x.preferat ? 0 : 1, x.mediu];
            candidati.sort((a, b) => {
                const ka = cheie(a), kb = cheie(b);
                for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
                return 0;
            });
            return { ales: candidati[0], candidati: candidati, maxScor: maxScor, areUrban: areUrban };
        }
        const celMaiBunSediu = lista => evalueazaSedii(lista).ales;
        function asazaSediu(id) {
            sediu.set(id, celMaiBunSediu(membri(id)).sediu);
        }

        // --- A–B. nuclee rurale și creștere pe vecinătăți (doar între comune)
        const setRural = new Set(uatJud.filter(i => !urban(i)));
        function creste(poli, univers) {
            const coada = Coada();
            const adauga = (n, id) => {
                if (univers.has(n) && !gid.has(n)) coada.pune([cost(n, colG(id)).mediu, n, id]);
            };
            poli.forEach(id => membri(id).forEach(i => vecini[i].forEach(n => adauga(n, id))));
            while (!coada.gol()) {
                const [c, n, id] = coada.scoate();
                if (gid.has(n) || estePol(n)) continue;
                if (!accesibil(n, colG(id))) continue;
                const lista = membri(id).concat([n]);
                if (!permisUrban(lista) || !permisMarime(lista) || !respectaMinoritati(lista)) continue;
                gid.set(n, id);
                noteaza(id, "Alipire", `${nume(n)} s-a alipit la ${nume(sediu.get(id))}: ` +
                    `${NF1.format(c)} min în medie de la satele ei, fără sate noi peste ${P.tMax} min ` +
                    `și fără să coboare o minoritate sub ${P.pragMinoritate}%.`);
                vecini[n].forEach(m => adauga(m, id));
            }
        }

        // --- 0. comasările alese de mână: UAT-urile cerute împreună pornesc ca un singur grup,
        // din care niciun pas de mai jos nu le mai scoate
        const fixat = new Set();
        (() => {
            const parinte = new Map();
            const radacina = i => {
                while (parinte.has(i) && parinte.get(i) !== i) i = parinte.get(i);
                return i;
            };
            (P.comasari || []).forEach(c => {
                const a = idxDupaSiruta.get(c.uat), b = idxDupaSiruta.get(c.cu);
                if (a === undefined || b === undefined || a === b) return;
                [a, b].forEach(i => { if (!parinte.has(i)) parinte.set(i, i); });
                parinte.set(radacina(a), radacina(b));
            });
            const clustere = new Map();
            parinte.forEach((p, i) => {
                const r = radacina(i);
                if (!clustere.has(r)) clustere.set(r, []);
                clustere.get(r).push(i);
            });
            clustere.forEach(lista => {
                // capul grupului: orașul, dacă e unul; altfel reședința cu cel mai bun scor
                const cap = lista.find(urban) !== undefined ? lista.find(urban)
                    : lista.reduce((a, i) => scor.get(i).total > scor.get(a).total ? i : a);
                const id = grupNou(cap, "Comasare aleasă",
                    `${lista.map(nume).join(", ")} au ales să se comaseze: împreună ${NF.format(pAzi(lista))} loc. azi ` +
                    `și ${NF.format(pViitor(lista))} la ${P.anProiectie}.`);
                // unitatea aleasă ține de un singur district: al capului ei
                const districtCap = cerut.get(cap);
                lista.forEach(i => {
                    gid.set(i, id);
                    fixat.add(i);
                    if (districtCap === undefined) cerut.delete(i);
                    else cerut.set(i, districtCap);
                });
                asazaSediu(id);
            });
        })();

        const poliRurali = Array.from(setRural).filter(i => !gid.has(i)).filter(estePol).map(i => grupNou(i, "Nucleu",
            `${nume(i)} trece singură pragul: ${NF.format(pAzi([i]))} loc. azi, ` +
            `${NF.format(pViitor([i]))} proiectat ${P.anProiectie} (prag ${NF.format(P.pMin)}).`));
        creste(poliRurali, setRural);
        for (let pas = 0; pas < uatJud.length; pas++) {
            const ramase = Array.from(setRural).filter(i => !gid.has(i));
            if (!ramase.length) break;
            ramase.sort((a, b) => scor.get(b).total - scor.get(a).total);
            const i = ramase[0];
            const s = scor.get(i);
            creste([grupNou(i, "Nucleu de centralitate",
                `${nume(i)} a devenit nucleu: cel mai bun scor de centralitate dintre comunele rămase ` +
                `(${NF.format(s.accesibil)} loc. la sub ${P.tAccesibil} min, ` +
                `${cate(s.servicii, "serviciu public", "servicii publice")} în reședință` +
                `${s.farmacii ? ", farmacie" : ""}${s.posta ? ", poștă" : ""}).`)],
                setRural);
        }
        // --- C. orașele și municipiile pornesc ca unități de sine stătătoare
        uatJud.filter(i => urban(i) && !gid.has(i)).forEach(i => grupNou(i, "Oraș",
            `${nume(i)} (${date.uat[i].t}) pornește ca unitate de sine stătătoare: ` +
            `${NF.format(pAzi([i]))} loc. azi, ${NF.format(pViitor([i]))} proiectat ${P.anProiectie}` +
            `${orasMic(i)
                ? `, sub pragul rangului (${NF.format(pragAutonomie(i))}) — poate prelua comune ca să-l atingă`
                : ` — peste pragul rangului (${NF.format(pragAutonomie(i))}), nu preia comune`}.`));

        // --- D–E–G. comasarea grupurilor sub prag, pe faze
        const depasiriActuale = lista => lista.reduce((a, i) => a + cost(i, colG(gid.get(i))).depasiri, 0);
        function comaseaza(faza) {
            for (let schimbat = true, pas = 0; schimbat && pas < 400; pas++) {
                schimbat = false;
                const mici = idGrupuri()
                    .map(id => ({ id: id, m: membri(id) }))
                    .filter(x => !viabil(x.m))
                    .sort((a, b) => pRef(a.m) - pRef(b.m));
                for (const { id, m } of mici) {
                    const partenere = vecineleGrupului(m, id);
                    if (!partenere.length) continue;
                    // orașul e ultimă soluție: se verifică întâi dacă există un vecin rural cu care merge
                    const areRuralBun = partenere.some(h => {
                        const u = m.concat(membri(h));
                        return !u.some(urban) && permisMarime(u) && respectaMinoritati(u) &&
                            celMaiBunSediu(u).respecta;
                    });
                    const ultima = faza === "fortat" || (faza === "urban" && !areRuralBun);
                    let best = null;
                    partenere.forEach(h => {
                        const mh = membri(h);
                        const uniune = m.concat(mh);
                        if (faza === "rural" && uniune.some(urban)) return;
                        // orașul preia doar grupuri rurale care nu stau singure în picioare
                        const ruralMic = [m, mh].filter(g => !g.some(urban)).every(g => !viabil(g));
                        if (!permisUrban(uniune, ultima, ruralMic)) return;
                        if (!permisMarime(uniune, faza === "fortat")) return;
                        if (!respectaMinoritati(uniune)) return;
                        const r = celMaiBunSediu(uniune);
                        if (faza !== "fortat" && !r.respecta) return;
                        // forțarea are și ea o limită: peste tMaxFortat, unitatea rămâne sub prag
                        if (faza === "fortat" && r.max > P.tMaxFortat) return;
                        const noi = Math.max(0, r.depasiri - depasiriActuale(uniune));
                        // la forțare: întâi cele mai puține sate noi peste tMax, apoi partenerul
                        // rural (un oraș peste pragul de autonomie rămâne ultima variantă), apoi timpul
                        const cheie = faza === "fortat"
                            ? [trasi(uniune), uniune.some(urban) ? 1 : 0,
                                mh.some(i => urban(i) && !orasMic(i)) ? 1 : 0, noi, r.mediu]
                            : [0, 0, 0, 0, r.mediu];
                        if (best && !maiBun(cheie, best.cheie)) return;
                        best = { h: h, r: r, cheie: cheie, noi: noi, mh: mh };
                    });
                    if (!best) continue;
                    uneste(id, best.h, faza, best);
                    schimbat = true;
                    break;
                }
            }
        }

        /** Comasează două grupuri; supraviețuiește id-ul grupului mai mare, cu jurnalul lui. */
        function uneste(a, b, faza, best) {
            const ma = membri(a), mb = membri(b);
            const [pastrat, inghitit] = pRef(ma) >= pRef(mb) ? [a, b] : [b, a];
            const uniune = ma.concat(mb);
            const text = `${nume(sediu.get(inghitit))} (${cate(membri(inghitit).length, "UAT", "UAT-uri")}, ` +
                `${NF.format(pAzi(membri(inghitit)))} loc.) s-a comasat cu ${nume(sediu.get(pastrat))}: ` +
                `împreună ${NF.format(pAzi(uniune))} loc. azi și ${NF.format(pViitor(uniune))} la ${P.anProiectie}` +
                `${best.noi ? `, cu ${cate(best.noi, "sat nou", "sate noi")} peste ${P.tMax} min` : ""}.`;
            const regula = faza === "fortat" ? "Comasare forțată"
                : faza === "urban" ? "Alipire la oraș" : "Comasare sub prag";
            const deLa = jurnal.get(inghitit);
            membri(inghitit).forEach(i => gid.set(i, pastrat));
            noteaza(pastrat, regula, faza === "fortat"
                ? text + ` Forțată: grupul rămânea altfel sub pragul de ${NF.format(P.pMin)} de locuitori.`
                : text);
            deLa.forEach(e => jurnal.get(pastrat).push(e));
            jurnal.delete(inghitit);
            sediu.delete(inghitit);
            asazaSediu(pastrat);
        }

        // --- F. rafinare prin mutări locale (AZP, Openshaw 1977)
        const LAMBDA = 30; // „minute-om” per locuitor care lipsește până la prag
        function ramaneContiguu(id, fara) {
            const lista = membri(id).filter(i => i !== fara);
            if (!lista.length) return false;
            const set = new Set(lista);
            const vazut = new Set([lista[0]]);
            const stiva = [lista[0]];
            while (stiva.length) {
                const i = stiva.pop();
                vecini[i].forEach(n => {
                    if (set.has(n) && !vazut.has(n)) {
                        vazut.add(n);
                        stiva.push(n);
                    }
                });
            }
            return vazut.size === lista.length;
        }
        function rafineaza() {
            for (let pas = 0; pas < 500; pas++) {
                let best = null;
                uatJud.forEach(u => {
                    const g = gid.get(u);
                    if (urban(u) || sediu.get(g) === u || estePol(u) || fixat.has(u)) return;
                    const mg = membri(g);
                    const cg = cost(u, colG(g)).mediu;
                    new Set(vecini[u].filter(n => inJud.has(n)).map(n => gid.get(n))).forEach(h => {
                        if (h === g) return;
                        const ch = cost(u, colG(h));
                        if (ch.depasiri > depasiriAcum.get(u)) return;
                        const mh = membri(h);
                        const nouH = mh.concat([u]);
                        const nouG = mg.filter(i => i !== u);
                        const delta = (ch.mediu - cg) * greutateUat.get(u) +
                            LAMBDA * (deficit(nouG) - deficit(mg) + deficit(nouH) - deficit(mh));
                        if (delta >= -1 || (best && delta >= best.delta)) return;
                        if (!permisUrban(nouH) || !permisUrban(nouG)) return;
                        if (!permisMarime(nouH) || !permisMarime(nouG)) return;
                        if (!respectaMinoritati(nouH) || !respectaMinoritati(nouG)) return;
                        if (!ramaneContiguu(g, u)) return;
                        // mutarea schimbă ambele grupuri, deci și reședințele lor: se verifică
                        // pe grupurile rezultate, nu doar pe UAT-ul mutat
                        if (!celMaiBunSediu(nouH).respecta || !celMaiBunSediu(nouG).respecta) return;
                        best = { u: u, g: g, h: h, delta: delta, mediu: ch.mediu, vechi: cg };
                    });
                });
                if (!best) break;
                gid.set(best.u, best.h);
                // mutarea poate înrăutăți puțin timpul, dacă în schimb scoate un grup de sub prag
                const cumpana = best.mediu <= best.vechi
                    ? `${NF1.format(best.mediu)} min în loc de ${NF1.format(best.vechi)} min de la satele ei`
                    : `${NF1.format(best.mediu)} min de la satele ei față de ${NF1.format(best.vechi)}, ` +
                      `în schimb apropie ambele grupuri de prag`;
                noteaza(best.h, "Rafinare", `${nume(best.u)} a trecut de la grupul ${nume(sediu.get(best.g))}: ${cumpana}.`);
                // și în jurnalul grupului părăsit, ca dosarul lui să nu rămână cu un membru plecat
                noteaza(best.g, "Rafinare", `${nume(best.u)} a plecat la grupul ${nume(sediu.get(best.h))}: ${cumpana}.`);
                asazaSediu(best.g);
                asazaSediu(best.h);
            }
        }

        function asazaSedii() {
            idGrupuri().forEach(asazaSediu);
        }
        for (let runda = 0; runda < 3; runda++) {
            comaseaza("rural");
            rafineaza();
            asazaSedii();
        }
        comaseaza("urban");
        rafineaza();
        asazaSedii();
        if (P.forteaza) {
            comaseaza("fortat");
            rafineaza();
            asazaSedii();
        }
        const grup = new Map(uatJud.map(i => [i, sediu.get(gid.get(i))]));

        // --- diagnostic pe localități
        const sate = ex.sate.map((s, k) => {
            const i = idxDupaSiruta.get(s.u);
            const tAcum = timp(k, col.get(i));
            const tNou = timp(k, col.get(grup.get(i)));
            // alternativa: reședința unui grup vecin cu UAT-ul satului
            let alt = null;
            new Set(vecini[i].filter(n => inJud.has(n)).map(n => grup.get(n))).forEach(g => {
                if (g === grup.get(i)) return;
                const t = timp(k, col.get(g));
                if (!alt || t < alt.t) alt = { g: g, t: t };
            });
            const transfer = alt && (alt.t + Math.max(5, 0.25 * tNou) < tNou) ? alt : null;
            return {
                k: k, s: s.s, n: s.n, p: s.p, e: s.e, uat: i, grup: grup.get(i),
                tAcum: tAcum, tNou: tNou,
                depasire: tNou > P.tMax && (s.p || 0) >= P.pSatMin,
                transfer: transfer
            };
        });

        /** De ce rămâne un grup sub prag: ce anume blochează comasarea cu fiecare vecin. */
        function motiveSubPrag(id, lista) {
            const partenere = vecineleGrupului(lista, id);
            if (!partenere.length) return ["fără vecini"];
            const motive = new Set();
            partenere.forEach(h => {
                const uniune = lista.concat(membri(h));
                if (!respectaMinoritati(uniune)) motive.add("minoritate");
                else if (!aceeasiAlegere(uniune)) motive.add("vecinii au ales alt district");
                else if (P.respectaIstorice && new Set(uniune.map(i => date.uat[i].ist)).size > 1) motive.add("regiune istorică");
                else if (!permisUrban(uniune, P.forteaza,
                    [lista, membri(h)].filter(g => !g.some(urban)).every(g => !viabil(g)))) motive.add("oraș");
                else if (!permisMarime(uniune, P.forteaza)) motive.add("ar depăși maximul rural");
                else if (P.forteaza
                    ? celMaiBunSediu(uniune).max > P.tMaxFortat
                    : !celMaiBunSediu(uniune).respecta) motive.add("accesibilitate");
                else motive.add("posibilă");
            });
            return Array.from(motive);
        }

        /** Motivul pentru care un candidat la reședință a fost respins. */
        function motivRespingere(c, ales, maxScor) {
            if (!c.eligibil) return "grupul are oraș, reședința trebuie să fie orașul";
            if (!c.respecta) return `ar fi lăsat sate peste ${P.tMax} min care acum nu sunt`;
            if (c.depasiri > ales.depasiri) return `${cate(c.depasiri, "sat", "sate")} peste ${P.tMax} min, față de ${ales.depasiri}`;
            if (!c.preferat) return `scor de centralitate ${NF1.format(c.scor)}, sub 60% din ${NF1.format(maxScor)}`;
            return `timp mediu mai mare: ${NF1.format(c.mediu)} vs ${NF1.format(ales.mediu)} min`;
        }

        const grupuri = idGrupuri().map(id => {
            const s = sediu.get(id);
            const lista = membri(id);
            const sateGrup = sate.filter(x => grup.get(x.uat) === s);
            const pTot = pAzi(lista);
            const pProiectat = pViitor(lista);
            const mediu = sateGrup.reduce((a, x) => a + x.tNou * pop(x.k), 0) / sateGrup.reduce((a, x) => a + pop(x.k), 0);
            const birouri = lista.filter(i => i !== s && timp(satResedinta.get(i), col.get(s)) > P.tBirou);
            const depasiri = sateGrup.filter(x => x.depasire);
            const celMaiDepartat = sateGrup.filter(x => (x.p || 0) >= P.pSatMin)
                .reduce((a, x) => !a || x.tNou > a.tNou ? x : a, null);
            // minorități: pragul de 20% pierdut prin comasare (aproximare pe minoritatea principală a fiecărui UAT)
            const etnii = new Map();
            lista.forEach(i => {
                const et = date.uat[i].et;
                if (et && et.min) etnii.set(et.min, (etnii.get(et.min) || 0) + date.uat[i].p21 * et.pmin / 100);
            });
            const riscMinoritate = [];
            lista.forEach(i => {
                const et = date.uat[i].et;
                if (et && et.min && et.pmin >= P.pragMinoritate) {
                    const pondere = 100 * etnii.get(et.min) / pTot;
                    if (pondere < P.pragMinoritate) riscMinoritate.push({ uat: i, etnie: et.min, inainte: et.pmin, dupa: pondere });
                }
            });
            const subPrag = pRef(lista) < pragUnitate(lista);
            const motive = subPrag ? motiveSubPrag(id, lista) : [];

            // --- dosarul: jurnalul deciziilor + reședința aleasă + derogările
            const ev = evalueazaSedii(lista);
            const dosar = jurnal.get(id).slice().sort((a, b) => a.nr - b.nr);
            const respinse = ev.candidati.slice(1, 4).map(c => ({
                uat: c.sediu, nume: nume(c.sediu), motiv: motivRespingere(c, ev.ales, ev.maxScor)
            }));
            dosar.push({
                regula: "Reședință",
                text: `${nume(s)}: ${NF1.format(ev.ales.mediu)} min în medie pentru locuitorii unității, ` +
                    `scor de centralitate ${NF1.format(scor.get(s).total)} (maximul grupului: ${NF1.format(ev.maxScor)})` +
                    (ev.areUrban ? ", singurul oraș al grupului" : "") + "." +
                    (respinse.length ? " Respinse: " + respinse.map(r => `${r.nume} (${r.motiv})`).join("; ") + "." : "")
            });
            // alegerile voluntare ale membrilor, scrise în dosar
            (P.corectii || []).forEach(c => {
                const i = idxDupaSiruta.get(c.uat);
                if (c.implicit || i === undefined || !lista.includes(i) || !idxDupaSiruta.has(c.district)) return;
                dosar.push({
                    regula: "Alegere voluntară",
                    text: `${nume(i)} a cerut districtul ${nume(idxDupaSiruta.get(c.district))}; ` +
                        (lista.length > 1 ? "unitatea întreagă îl urmează, fiindcă nu se poate împărți între două districte."
                            : "unitatea intră în el.")
                });
            });
            const derogari = [];
            if (depasiri.length) {
                derogari.push(`${cate(depasiri.length, "sat", "sate")} la peste ${P.tMax} min de reședință ` +
                    `(${depasiri.slice(0, 3).map(x => `${x.n} ${NF1.format(x.tNou)} min`).join(", ")}` +
                    `${depasiri.length > 3 ? " ș.a." : ""}) — birou local obligatoriu.`);
            }
            if (!urban(s) && pTot > P.pMaxRural) {
                derogari.push(`Unitate rurală de ${NF.format(pTot)} loc., peste maximul de ${NF.format(P.pMaxRural)}: ` +
                    `ar trebui declarată oraș (Legea 351/2001).`);
            }
            if (urban(s) && pTot < pragAutonomie(s)) {
                derogari.push(`${nume(s)} rămâne sub pragul rangului de ${date.uat[s].t} ` +
                    `(${NF.format(pTot)} din ${NF.format(pragAutonomie(s))} loc.), chiar și cu comunele preluate.`);
            }
            if (urban(s) && lista.length > 1 && pTot > PRAG_ORAS_LEADER) {
                derogari.push(`Unitate cu oraș, de ${NF.format(pTot)} loc.: peste ${NF.format(PRAG_ORAS_LEADER)} de locuitori, ` +
                    `comunele preluate ies din aria LEADER și se finanțează prin strategia urbană a orașului.`);
            }
            if (riscMinoritate.length) {
                derogari.push(riscMinoritate.map(r => `${nume(r.uat)}: minoritatea ${r.etnie.toLowerCase()} scade de la ` +
                    `${NF1.format(r.inainte)}% la ${NF1.format(r.dupa)}% — sub pragul de ${P.pragMinoritate}% din Codul administrativ.`).join(" ") +
                    (P.regimMinoritati === "localitate"
                        ? ` Dreptul la limba maternă se păstrează la nivelul ${riscMinoritate.length === 1
                            ? "localității componente" : "localităților componente"}, unde ponderea rămâne peste prag ` +
                          `— ar cere o modificare a art. 94 din Codul administrativ.`
                        : ""));
            }
            if (subPrag) {
                derogari.push(`Unitatea rămâne sub prag (${NF.format(pRef(lista))} loc. de referință): ` +
                    (motive.includes("minoritate")
                        ? "orice comasare ar coborî o minoritate sub pragul de 20%."
                        : motive.includes("fără vecini") ? "nu are vecini disponibili în județ."
                            : "comasarea e blocată de regulile active."));
            }
            derogari.forEach(t => dosar.push({ regula: "Derogare", text: t }));

            const conditii = [
                {
                    nume: "Populație (RPL 2021)", valoare: NF.format(pTot),
                    prag: `≥ ${NF.format(pragUnitate(lista))}, țintă ${NF.format(tintaUnitate(lista))}`,
                    stare: pTot >= pragUnitate(lista) ? "ok" : "derogare"
                },
                {
                    nume: `Proiecție ${P.anProiectie}`, valoare: NF.format(pProiectat),
                    prag: P.proiectie ? `≥ ${NF.format(pragUnitate(lista))}` : "informativ",
                    stare: !P.proiectie ? "info" : pProiectat >= pragUnitate(lista) ? "ok" : "derogare"
                },
                {
                    nume: "Satul cel mai departe",
                    valoare: celMaiDepartat
                        ? `${NF1.format(celMaiDepartat.tNou)} min (${celMaiDepartat.n})` : "—",
                    prag: `≤ ${P.tMax} min, sate ≥ ${P.pSatMin} loc.`,
                    stare: depasiri.length ? "derogare" : "ok"
                },
                {
                    nume: "Statut și prag legal",
                    valoare: `${urban(s) ? date.uat[s].t : "comună"}, ${NF.format(pTot)} loc.`,
                    prag: urban(s)
                        ? `${date.uat[s].t} ≥ ${NF.format(pragAutonomie(s))} (Legea 351/2001)`
                        : `unitate rurală ≤ ${NF.format(P.pMaxRural)}`,
                    stare: urban(s)
                        ? (pTot >= pragAutonomie(s) ? "ok" : "derogare")
                        : (pTot <= P.pMaxRural ? "ok" : "derogare")
                },
                {
                    nume: "Minorități ≥ 20%", valoare: riscMinoritate.length
                        ? riscMinoritate.map(r => `${r.etnie} ${NF1.format(r.dupa)}%`).join(", ")
                        : (Array.from(etnii.keys()).length && Math.max(...Array.from(etnii.values())) / pTot * 100 >= P.pragMinoritate
                            ? "păstrat" : "nu e cazul"),
                    prag: `≥ ${P.pragMinoritate}%`, stare: riscMinoritate.length ? "derogare" : "ok"
                },
                {
                    nume: "Birouri locale", valoare: NF.format(birouri.length),
                    prag: `fosta reședință la peste ${P.tBirou} min`, stare: "info"
                }
            ];

            return {
                id: id,
                sediu: s,
                nume: date.uat[s].n,
                urban: urban(s),
                membri: lista,
                populatie: pTot,
                populatieProiectata: pProiectat,
                populatieReferinta: pRef(lista),
                suprafata: lista.reduce((a, i) => a + date.uat[i].a, 0),
                nrSate: sateGrup.length,
                timpMediu: mediu,
                timpMax: Math.max(...sateGrup.filter(x => (x.p || 0) >= P.pSatMin).map(x => x.tNou), 0),
                depasiri: depasiri.length,
                transferuri: sateGrup.filter(x => x.transfer).length,
                birouri: birouri,
                subPrag: subPrag,
                motive: motive,
                riscMinoritate: riscMinoritate,
                istorice: Array.from(new Set(lista.map(i => date.uat[i].ist))),
                dosar: dosar,
                conditii: conditii,
                derogari: derogari
            };
        }).sort((a, b) => b.populatie - a.populatie);

        // --- indicatori înainte / după
        function indicatori(lista, tCamp) {
            const nr = lista.length;
            const pops = lista.map(x => x.populatie).sort((a, b) => a - b);
            const proiectii = lista.map(x => x.populatieProiectata).sort((a, b) => a - b);
            const greutate = sate.reduce((a, x) => a + pop(x.k), 0);
            return {
                unitati: nr,
                subPrag: pops.filter(p => p < P.pMin).length,
                subPrag2050: proiectii.filter(p => p < P.pMin).length,
                sub3000: pops.filter(p => p < 3000).length,
                mediana: pops[Math.floor(nr / 2)],
                timpMediu: sate.reduce((a, x) => a + x[tCamp] * pop(x.k), 0) / greutate,
                pesteTMax: sate.filter(x => x[tCamp] > P.tMax && (x.p || 0) >= P.pSatMin).length,
                popPesteTMax: sate.filter(x => x[tCamp] > P.tMax).reduce((a, x) => a + (x.p || 0), 0)
            };
        }
        const inainte = indicatori(uatJud.map(i =>
            ({ populatie: date.uat[i].p21, populatieProiectata: proiectat.get(i) })), "tAcum");
        const dupa = indicatori(grupuri, "tNou");

        return {
            parametri: P,
            judet: ex.judet,
            uat: uatJud,
            grup: grup,            // Map UAT -> UAT-reședință a grupului
            grupuri: grupuri,
            sate: sate,
            scor: scor,
            col: col,              // Map UAT -> coloana reședinței lui în matricea de timpi
            satResedinta: satResedinta, // Map UAT -> indexul satului-reședință
            proiectat: proiectat,  // Map UAT -> populația proiectată la anProiectie
            inainte: inainte,
            dupa: dupa,
            populatieJudet: pAzi(uatJud)
        };
    }

    /** Comparație lexicografică pe chei numerice: e `a` mai bună (mai mică) decât `b`? */
    function maiBun(a, b) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return a[i] < b[i];
        }
        return false;
    }

    /** Acord simplu de număr, pentru textele generate („2 sate”, „21 de sate”). */
    function cate(n, sg, pl) {
        if (n === 1) return `1 ${sg}`;
        const rest = n % 100;
        return `${NF.format(n)} ${n && (rest === 0 || rest >= 20) ? "de " : ""}${pl}`;
    }

    // --- nivelul intermediar: districtul -------------------------------------------
    // pragurile europene care contează pentru un district: un grup de acțiune locală
    // (LEADER / DLRC) se finanțează între 10.000 și 150.000 de locuitori
    const PRAG_GAL = { min: 10000, max: 150000 };
    // LEADER acoperă comunele și orașele mici; un oraș peste 20.000 de locuitori se finanțează
    // prin strategia lui urbană (Programul Regional), nu prin grupul de acțiune locală
    const PRAG_ORAS_LEADER = 20000;
    const PARAMETRI_DISTRICT = {
        // pragul zonei rurale funcționale din definiția Comisiei Europene: orașul-târg cu
        // împrejurimile lui, cel puțin 25.000 de locuitori
        pMin: 25000,
        nrMinUnitati: 2,    // orașul și cel puțin o comună asociată
        sediuUrban: true,   // reședința de district e oraș sau municipiu (Legea 351/2001)
        // districtele rămân independente de zona metropolitană a municipiului: legătura dintre
        // ele se face prin transport, nu prin absorbție administrativă
        preferaMetropolitan: false,
        pSediu: 0,          // orice oraș poate fi centru de district, oricât de mic
        tMax: 60            // minute, de la reședința unei unități la reședința districtului
    };

    /**
     * Gruparea unităților propuse în districte — nivelul care lipsește azi în România:
     * între comuna comasată (~16.000 de locuitori) și județ (~465.000) nu e nimic.
     *
     * Ideea vine din reforma poloneză din 1999 (regula „5–10–50” a powiatului), dar
     * pragurile sunt românești: reședința trebuie să fie oraș sau municipiu, adică
     * să treacă pragul din Legea 351/2001, iar populația minimă e apropiată de media
     * districtelor interbelice (429 de districte la 18 milioane de locuitori, în 1930).
     *
     * Districtul nu e un nivel nou de autonomie — Constituția, art. 3 alin. (3), cunoaște
     * doar comune, orașe și județe. E o circumscripție administrativă a județului,
     * cum era plasa condusă de pretor în Legea de unificare administrativă din 1925:
     * acolo se duc serviciile deconcentrate, nu un consiliu ales în plus.
     *
     * Lucrează peste rezultatul unui județ (`calculeaza`), cu aceiași timpi rutieri.
     */
    function calculeazaDistrict(date, vecini, ex, r, optiuni) {
        // pragurile districtei vin separat (`optiuni.district`): altfel pragul comunei,
        // cu același nume, le-ar suprascrie
        const P = Object.assign({}, PARAMETRI_DISTRICT, (optiuni || {}).district || {});
        const unitati = r.grupuri;
        const indexUnitate = new Map(unitati.map((g, k) => [g.sediu, k]));
        const timp = (a, b) => {
            const v = ex.timp[r.satResedinta.get(unitati[a].sediu)][r.col.get(unitati[b].sediu)];
            return v === null || v === undefined ? Infinity : v;
        };
        const popSediu = g => ex.sate[r.satResedinta.get(g.sediu)].p || 0;

        // vecinătățile dintre unitățile noi, din vecinătățile UAT-urilor componente
        const vecine = unitati.map(() => new Set());
        unitati.forEach((g, k) => g.membri.forEach(i => vecini[i].forEach(n => {
            const alt = indexUnitate.get(r.grup.get(n));
            if (alt !== undefined && alt !== k) vecine[k].add(alt);
        })));

        // 1. reședințe candidate: orașele și municipiile, ca în toate împărțirile
        // românești pe districte — reședința de plasă era prin definiție târgul zonei
        const esteOras = k => date.uat[unitati[k].sediu].t !== "comună";
        const candidati = unitati.map((g, k) => k)
            .filter(k => (P.sediuUrban ? esteOras(k) : true) && popSediu(unitati[k]) >= P.pSediu)
            .sort((a, b) => popSediu(unitati[b]) - popSediu(unitati[a]));
        // dacă niciuna nu trece pragul (județ fără oraș mare), se ia cea mai mare localitate
        if (!candidati.length && unitati.length) {
            candidati.push(unitati.map((g, k) => k).sort((a, b) => popSediu(unitati[b]) - popSediu(unitati[a]))[0]);
        }

        // 2. creștere pe vecinătăți, de la reședințe spre unitățile din jur
        const plasa = new Map(candidati.map(k => [k, k]));
        const coada = Coada();
        const adauga = (k, s) => { if (!plasa.has(k)) coada.pune([timp(k, s), k, s]); };
        candidati.forEach(s => vecine[s].forEach(k => adauga(k, s)));
        while (!coada.gol()) {
            const [t, k, s] = coada.scoate();
            if (plasa.has(k) || t > P.tMax) continue;
            plasa.set(k, s);
            vecine[k].forEach(m => adauga(m, s));
        }
        // Ce a rămas peste tMax de orice reședință devine plasa propriu: mai bine o
        // reședință mică decât un drum de o oră și jumătate. Excepție, unitățile fără
        // nicio legătură rutieră (Delta): acolo singura soluție e vecinul cel mai mare.
        const faraDrum = k => !unitati.some((g, m) => m !== k && isFinite(timp(k, m)));
        unitati.forEach((g, k) => {
            if (plasa.has(k)) return;
            const vecineAsezate = Array.from(vecine[k]).filter(n => plasa.has(n));
            if (faraDrum(k) && vecineAsezate.length) {
                plasa.set(k, plasa.get(vecineAsezate.reduce((a, n) =>
                    unitati[plasa.get(n)].populatie > unitati[plasa.get(a)].populatie ? n : a)));
            } else {
                plasa.set(k, k);
            }
        });

        const membri = s => unitati.map((g, k) => k).filter(k => plasa.get(k) === s);
        const populatia = lista => lista.reduce((a, k) => a + unitati[k].populatie, 0);
        const sedii = () => Array.from(new Set(plasa.values()));

        // 2b. niciun oraș fără comune asociate: districtul format doar din oraș ia unitatea
        // rurală vecină cea mai apropiată, de la un district care rămâne cu cel puțin două
        for (let pas = 0; pas < 200; pas++) {
            let facut = false;
            for (const s of sedii()) {
                if (membri(s).length > 1) continue;
                let best = null;
                vecine[s].forEach(k => {
                    const donator = plasa.get(k);
                    if (donator === s || k === donator || esteOras(k)) return;
                    if (membri(donator).length < 3) return;
                    const t = timp(k, s);
                    if (t > P.tMax) return;
                    if (!best || t < best.t) best = { k: k, t: t };
                });
                if (!best) continue;
                plasa.set(best.k, s);
                facut = true;
                break;
            }
            if (!facut) break;
        }

        // 3. plasile sub regulă se comasează cu vecinul cel mai apropiat, dar numai
        // dacă noua reședință rămâne la cel mult tMax de unitățile preluate
        for (let pas = 0; pas < 200; pas++) {
            const mici = sedii().map(s => ({ s: s, m: membri(s) }))
                .filter(x => populatia(x.m) < P.pMin || x.m.length < P.nrMinUnitati)
                .sort((a, b) => populatia(a.m) - populatia(b.m));
            let facut = false;
            for (const { s, m } of mici) {
                const partenere = new Set();
                m.forEach(k => vecine[k].forEach(n => {
                    if (plasa.get(n) !== s) partenere.add(plasa.get(n));
                }));
                let best = null;
                partenere.forEach(h => {
                    const uniune = m.concat(membri(h));
                    // reședința plasaului rezultat: localitatea cea mai mare
                    const sediuNou = uniune.reduce((a, k) => popSediu(unitati[k]) > popSediu(unitati[a]) ? k : a);
                    // unitățile fără drum (Delta) nu blochează comasarea: n-au altă variantă
                    const timpi = uniune.map(k => timp(k, sediuNou)).filter(isFinite);
                    const tMaxim = timpi.length ? Math.max(...timpi) : 0;
                    if (tMaxim > P.tMax) return;
                    if (!best || tMaxim < best.t) best = { uniune: uniune, sediu: sediuNou, t: tMaxim };
                });
                if (!best) continue;
                best.uniune.forEach(k => plasa.set(k, best.sediu));
                facut = true;
                break;
            }
            if (!facut) break;
        }

        // 4. ce a rămas mult sub prag (Delta, zonele fără drum) se alipește oricum de
        // vecinul cel mai mare: un plasa de 500 de locuitori n-ar avea sens, dar
        // drumul peste limită se trece la derogări
        const fortate = new Set();
        for (let pas = 0; pas < 100; pas++) {
            const mici = sedii().map(s => ({ s: s, m: membri(s) }))
                .filter(x => populatia(x.m) < P.pMin / 2)
                .sort((a, b) => populatia(a.m) - populatia(b.m));
            let facut = false;
            for (const { s, m } of mici) {
                const partenere = new Set();
                m.forEach(k => vecine[k].forEach(n => {
                    if (plasa.get(n) !== s) partenere.add(plasa.get(n));
                }));
                if (!partenere.size) continue;
                const h = Array.from(partenere).reduce((a, b) =>
                    populatia(membri(b)) > populatia(membri(a)) ? b : a);
                const uniune = m.concat(membri(h));
                const sediuNou = uniune.reduce((a, k) => popSediu(unitati[k]) > popSediu(unitati[a]) ? k : a);
                uniune.forEach(k => plasa.set(k, sediuNou));
                fortate.add(unitati[sediuNou].sediu);
                facut = true;
                break;
            }
            if (!facut) break;
        }

        // 5. opțional: districtele fără municipiu se pot alipi la zona metropolitană vecină.
        // Implicit nu se face — districtul din jurul unui oraș rămâne de sine stătător, iar
        // legătura cu zona metropolitană a municipiului e una de transport, nu administrativă.
        const esteMunicipiu = k => date.uat[unitati[k].sediu].t === "municipiu";
        if (P.preferaMetropolitan) {
            for (let pas = 0; pas < 100; pas++) {
                let facut = false;
                for (const s of sedii()) {
                    if (esteMunicipiu(s)) continue;
                    const m = membri(s);
                    const vecineMetro = new Set();
                    m.forEach(k => vecine[k].forEach(n => {
                        const alt = plasa.get(n);
                        if (alt !== s && esteMunicipiu(alt)) vecineMetro.add(alt);
                    }));
                    let best = null;
                    vecineMetro.forEach(h => {
                        const uniune = m.concat(membri(h));
                        const timpi = uniune.map(k => timp(k, h)).filter(isFinite);
                        const tMaxim = timpi.length ? Math.max(...timpi) : Infinity;
                        if (tMaxim > P.tMax) return;
                        if (!best || tMaxim < best.t) best = { h: h, t: tMaxim, uniune: uniune };
                    });
                    if (!best) continue;
                    best.uniune.forEach(k => plasa.set(k, best.h));
                    facut = true;
                    break;
                }
                if (!facut) break;
            }
        }

        // 6. alegerile voluntare: unitatea care conține UAT-ul trece la districtul cu reședința
        // în unitatea UAT-ului cerut; aceea devine reședință de district, dacă nu era
        const manuale = new Set();
        const dupaSiruta = new Map(r.uat.map(i => [date.uat[i].s, i]));
        const unitateaLui = siruta => {
            const i = dupaSiruta.get(siruta);
            return i === undefined ? undefined : indexUnitate.get(r.grup.get(i));
        };
        const muta = (k, s) => {
            const vechi = plasa.get(k);
            if (vechi === s) return;
            plasa.set(k, s);
            if (vechi !== k) return;
            // a plecat reședința: restul districtului își ia ca reședință cea mai mare localitate
            const rest = membri(k);
            if (!rest.length) return;
            const nou = rest.reduce((a, n) => popSediu(unitati[n]) > popSediu(unitati[a]) ? n : a);
            rest.forEach(n => plasa.set(n, nou));
        };
        const toateAlegerile = (optiuni || {}).corectii || [];
        const eResedinta = c => {
            const i = dupaSiruta.get(c.uat);
            return i !== undefined && r.grup.get(i) === i;
        };
        // ultima scrisă hotărăște: întâi alegerile implicite ale UAT-urilor obișnuite, apoi ale
        // reședințelor de unitate, la urmă cele făcute de mână
        toateAlegerile.filter(c => c.implicit && !eResedinta(c))
            .concat(toateAlegerile.filter(c => c.implicit && eResedinta(c)), toateAlegerile.filter(c => !c.implicit))
            .forEach(c => {
            const k = unitateaLui(c.uat), s = unitateaLui(c.district);
            if (k === undefined || s === undefined) return;
            muta(s, s);
            muta(k, s);
            if (!c.implicit) manuale.add(k);
        });

        // 6b. niciun district sub prag. Districtul prea mic nu e înghițit de vecin: își păstrează
        // orașul ca pol și primește, de la districtul vecin mai mare, comuna care ajunge cel mai
        // repede la el. Doar dacă nimeni nu poate da se unește cu vecinul cel mai apropiat.
        const primite = new Map();    // reședința districtului -> unitățile primite
        const cuprinse = new Map();   // reședința districtului -> reședințele districtelor unite cu el
        for (let pas = 0; pas < 400; pas++) {
            const mici = sedii().map(s => ({ s: s, m: membri(s) }))
                .filter(x => populatia(x.m) < P.pMin && !x.m.some(k => manuale.has(k)))
                .sort((a, b) => populatia(a.m) - populatia(b.m));
            let facut = false;
            for (const { s, m } of mici) {
                // comuna vecină cea mai apropiată, de la un district care rămâne peste prag fără ea
                let dar = null;
                m.forEach(k => vecine[k].forEach(n => {
                    const donator = plasa.get(n);
                    if (donator === s || n === donator || esteOras(n) || manuale.has(n)) return;
                    const ramase = membri(donator).filter(x => x !== n);
                    if (ramase.length < P.nrMinUnitati || populatia(ramase) < P.pMin) return;
                    const t = timp(n, s);
                    if (t > P.tMax) return;
                    if (!dar || t < dar.t) dar = { k: n, t: t };
                }));
                if (dar) {
                    plasa.set(dar.k, s);
                    primite.set(s, (primite.get(s) || []).concat([dar.k]));
                    facut = true;
                    break;
                }
                // nimeni nu poate da: districtul se unește cu vecinul cel mai apropiat
                const vecini = new Set();
                m.forEach(k => vecine[k].forEach(n => { if (plasa.get(n) !== s) vecini.add(plasa.get(n)); }));
                if (!vecini.size) continue;
                const h = Array.from(vecini).reduce((a, b) => timp(s, b) < timp(s, a) ? b : a);
                const cap = popSediu(unitati[s]) > popSediu(unitati[h]) ? s : h;
                const inghitit = cap === s ? h : s;
                cuprinse.set(cap, (cuprinse.get(cap) || []).concat(cuprinse.get(inghitit) || [], [inghitit]));
                primite.set(cap, (primite.get(cap) || []).concat(primite.get(inghitit) || []));
                m.concat(membri(h)).forEach(k => plasa.set(k, cap));
                facut = true;
                break;
            }
            if (!facut) break;
        }

        // eligibilă la LEADER e comuna, sau unitatea cu oraș de cel mult 20.000 de locuitori cu tot
        // ce a preluat; se socotește pe unitatea nouă, nu pe UAT-urile de azi
        const eligibilaLeader = k => !esteOras(k) || unitati[k].populatie <= PRAG_ORAS_LEADER;

        // 7. microregiunile: în interiorul fiecărui district, fiecare oraș e un pol de dezvoltare,
        // cu comunele care ajung cel mai repede la el. Districtul rămâne cadrul administrativ;
        // microregiunea e treapta la care se scriu proiectele și se împart fondurile de dezvoltare
        // locală — așa orașul mare nu le înghite pe cele mici din jurul lui.
        const pol = new Map();
        sedii().forEach(s => {
            const m = membri(s);
            const inDistrict = new Set(m);
            let poli = m.filter(esteOras);
            if (!poli.length) poli = [s];
            poli.forEach(p => pol.set(p, p));
            const coadaPoli = Coada();
            const pune = (k, p) => { if (inDistrict.has(k) && !pol.has(k)) coadaPoli.pune([timp(k, p), k, p]); };
            poli.forEach(p => vecine[p].forEach(k => pune(k, p)));
            while (!coadaPoli.gol()) {
                const [, k, p] = coadaPoli.scoate();
                if (pol.has(k)) continue;
                pol.set(k, p);
                vecine[k].forEach(n => pune(n, p));
            }
            // ce n-a fost atins prin vecinătăți merge la polul cel mai apropiat pe drum
            m.forEach(k => {
                if (!pol.has(k)) pol.set(k, poli.reduce((a, p) => timp(k, p) < timp(k, a) ? p : a));
            });
            // Fiecare microregiune trebuie să încapă în pragurile LEADER, socotite pe locuitorii
            // eligibili. Polul care nu strânge minimul se unește cu polul cel mai apropiat; rămâne
            // pol orașul mai mare dintre cele două.
            const eligibili = lista => populatia(lista.filter(eligibilaLeader));
            for (let pas = 0; pas < m.length; pas++) {
                const activi = Array.from(new Set(m.map(k => pol.get(k))));
                if (activi.length < 2) break;
                const mic = activi.map(p => ({ p: p, ale: m.filter(k => pol.get(k) === p) }))
                    .filter(x => eligibili(x.ale) < PRAG_GAL.min)
                    .sort((a, b) => eligibili(a.ale) - eligibili(b.ale))[0];
                if (!mic) break;
                const tinta = activi.filter(p => p !== mic.p)
                    .reduce((a, p) => timp(mic.p, p) < timp(mic.p, a) ? p : a);
                const cap = popSediu(unitati[mic.p]) > popSediu(unitati[tinta]) ? mic.p : tinta;
                m.forEach(k => { if (pol.get(k) === mic.p || pol.get(k) === tinta) pol.set(k, cap); });
            }
            // Microregiunea care trece de maxim se împarte: cea mai mare unitate a ei, alta decât
            // polul — un oraș, dacă există — devine pol, iar unitățile merg la polul mai apropiat.
            for (let pas = 0; pas < m.length; pas++) {
                const mare = Array.from(new Set(m.map(k => pol.get(k))))
                    .map(p => ({ p: p, ale: m.filter(k => pol.get(k) === p) }))
                    .find(x => eligibili(x.ale) > PRAG_GAL.max);
                if (!mare) break;
                const candidati = mare.ale.filter(k => k !== mare.p)
                    .sort((a, b) => (esteOras(b) - esteOras(a)) || popSediu(unitati[b]) - popSediu(unitati[a]));
                let impartita = false;
                for (const nou of candidati) {
                    const laNou = mare.ale.filter(k => k !== mare.p && timp(k, nou) < timp(k, mare.p));
                    const ramase = mare.ale.filter(k => !laNou.includes(k));
                    // împărțirea se face doar dacă ambele părți rămân peste minim
                    if (eligibili(laNou) < PRAG_GAL.min || eligibili(ramase) < PRAG_GAL.min) continue;
                    laNou.forEach(k => pol.set(k, nou));
                    impartita = true;
                    break;
                }
                if (!impartita) break;
            }
        });
        const microregiunile = s => {
            const m = membri(s);
            return Array.from(new Set(m.map(k => pol.get(k)))).map(p => {
                const ale = m.filter(k => pol.get(k) === p);
                const eligibili = populatia(ale.filter(eligibilaLeader));
                return {
                    pol: unitati[p].sediu,
                    nume: unitati[p].nume,
                    tipPol: date.uat[unitati[p].sediu].t,
                    populatie: populatia(ale),
                    popLeader: eligibili,
                    inBanda: eligibili >= PRAG_GAL.min && eligibili <= PRAG_GAL.max,
                    unitati: ale.map(k => unitati[k].sediu),
                    timpMax: Math.max(...ale.map(k => timp(k, p)).filter(isFinite), 0)
                };
            }).sort((a, b) => b.populatie - a.populatie);
        };

        /** Districtul e dintr-o bucată: de la orice unitate se ajunge la oricare, prin vecine. */
        const continuu = m => {
            const set = new Set(m), vazut = new Set([m[0]]), stiva = [m[0]];
            while (stiva.length) {
                vecine[stiva.pop()].forEach(n => {
                    if (set.has(n) && !vazut.has(n)) {
                        vazut.add(n);
                        stiva.push(n);
                    }
                });
            }
            return vazut.size === m.length;
        };

        const districte = sedii().map(s => {
            const m = membri(s);
            const pop = populatia(m);
            const dintrOBucata = continuu(m);
            // pragurile europene: comunele și orașele mici intră la LEADER, orașul mare are
            // strategia lui urbană — un district poate avea nevoie de amândouă
            const popLeader = populatia(m.filter(eligibilaLeader));
            const popUrban = pop - popLeader;
            // banii de dezvoltare locală se împart pe microregiuni: districtul e în prag când toate
            // grupurile lui de acțiune locală sunt
            const micro = microregiunile(s);
            const inAfara = micro.filter(x => !x.inBanda);
            const inBanda = !inAfara.length;
            const praguriUE = {
                instrument: popUrban ? "mixt" : "leader",
                potrivit: inBanda,
                popLeader: popLeader,
                popUrban: popUrban,
                nota: (popUrban ? `orașul (${NF.format(popUrban)} loc.) pe strategia urbană; ` : "") +
                    (inBanda
                        ? `${micro.length === 1 ? "un grup LEADER" : `${micro.length} grupuri LEADER`}, pe ${NF.format(popLeader)} loc.`
                        : `${inAfara.map(x => `${x.nume}: ${NF.format(x.popLeader)} loc. eligibili`).join("; ")} — în afara pragului LEADER`)
            };
            const tMaxim = Math.max(...m.map(k => timp(k, s)).filter(t => isFinite(t)), 0);
            // districtul poartă numele celui mai mare UAT din el, nu neapărat al reședinței
            const celMaiMare = m.flatMap(k => unitati[k].membri)
                .reduce((a, i) => !a || date.uat[i].p21 > date.uat[a].p21 ? i : a, null);
            return {
                sediu: unitati[s].sediu,
                nume: celMaiMare === null ? unitati[s].nume : date.uat[celMaiMare].n,
                numeResedinta: unitati[s].nume,
                popSediu: popSediu(unitati[s]),
                unitati: m.map(k => unitati[k].sediu),
                nrUnitati: m.length,
                populatie: pop,
                timpMax: tMaxim,
                respectaRegula: dintrOBucata && pop >= P.pMin && m.length >= P.nrMinUnitati &&
                    popSediu(unitati[s]) >= P.pSediu && (!P.sediuUrban || esteOras(s)),
                // districtul cu municipiu e zonă metropolitană; cel fără, district rural
                tip: date.uat[unitati[s].sediu].t === "municipiu" ? "metropolitan" : "rural",
                praguriUE: praguriUE,
                // polii de dezvoltare din district, fiecare cu comunele lui: grupurile de acțiune locală propuse
                microregiuni: micro,
                continuu: dintrOBucata,
                // constituit (și) prin alegerea voluntară a cel puțin unei unități
                manual: m.some(k => manuale.has(k)),
                // ce a primit ca să treacă pragul: comune de la districtul vecin, sau un district întreg
                primite: (primite.get(s) || []).filter(k => plasa.get(k) === s).map(k => unitati[k].nume),
                cuprinde: (cuprinse.get(s) || []).map(k => unitati[k].nume),
                // criteriile pe care le trece orice district, fie că iese din calcul, fie din
                // alegerea voluntară a comunelor
                criterii: [
                    {
                        nume: "Reședința", valoare: `${unitati[s].nume} (${date.uat[unitati[s].sediu].t})`,
                        prag: "oraș sau municipiu", stare: !P.sediuUrban || esteOras(s) ? "ok" : "derogare"
                    },
                    {
                        nume: "Unități asociate", valoare: NF.format(m.length),
                        prag: `≥ ${P.nrMinUnitati}: orașul și cel puțin o comună`,
                        stare: m.length >= P.nrMinUnitati ? "ok" : "derogare"
                    },
                    {
                        nume: "Populație", valoare: NF.format(pop),
                        prag: `≥ ${NF.format(P.pMin)}`, stare: pop >= P.pMin ? "ok" : "derogare"
                    },
                    {
                        nume: "Teritoriu", valoare: dintrOBucata ? "dintr-o bucată" : "întrerupt",
                        prag: "continuu", stare: dintrOBucata ? "ok" : "derogare"
                    },
                    {
                        nume: "Drumul până la reședință", valoare: `${NF1.format(tMaxim)} min`,
                        prag: `≤ ${P.tMax} min`, stare: tMaxim <= P.tMax ? "ok" : "derogare"
                    },
                    {
                        nume: "Finanțare europeană", valoare: praguriUE.nota,
                        prag: `fiecare grup LEADER: ${NF.format(PRAG_GAL.min)}–${NF.format(PRAG_GAL.max)} loc. eligibili, orașe ≤ ${NF.format(PRAG_ORAS_LEADER)}`,
                        stare: inBanda ? "ok" : "derogare"
                    }
                ],
                fortat: fortate.has(unitati[s].sediu),
                motive: [
                    pop < P.pMin ? `sub ${NF.format(P.pMin)} loc.` : "",
                    m.length < P.nrMinUnitati ? `sub ${P.nrMinUnitati} unități` : "",
                    P.sediuUrban && !esteOras(s) ? "reședința nu e oraș" : "",
                    popSediu(unitati[s]) < P.pSediu ? `reședință sub ${NF.format(P.pSediu)} loc.` : "",
                    dintrOBucata ? "" : "teritoriu întrerupt",
                    tMaxim > P.tMax ? `${NF1.format(tMaxim)} min până la reședință` : ""
                ].filter(Boolean)
            };
        }).sort((a, b) => b.populatie - a.populatie);

        const unitateDistrict = new Map();
        plasa.forEach((s, k) => unitateDistrict.set(unitati[k].sediu, unitati[s].sediu));
        const unitateMicro = new Map();
        pol.forEach((p, k) => unitateMicro.set(unitati[k].sediu, unitati[p].sediu));
        return { parametri: P, districte: districte, unitateDistrict: unitateDistrict, unitateMicro: unitateMicro };
    }

    /**
     * Desenul de pornire al districtelor: circumscripțiile judecătoriilor. E singura împărțire
     * sub județ folosită deja de mai multe instituții — instanța, parchetul și, prin Legea
     * 36/1995, birourile notariale — deci oamenii știu deja de cine țin. Fiecare UAT intră în
     * districtul orașului în care are judecătoria; alegerile făcute de mână trec înaintea lor.
     *
     * `judecatorii` = date/judecatorii-uat.json. Întoarce lista de alegeri pentru `corectii`.
     */
    function alegeriCuCircumscriptii(judecatorii, corectii) {
        const manuale = corectii || [];
        if (!judecatorii || !judecatorii.uat) return manuale;
        const sediu = new Map((judecatorii.judecatorii || []).map(j => [j.id, j.sediu]));
        const alese = new Set(manuale.map(c => c.uat));
        const implicite = [];
        Object.keys(judecatorii.uat).forEach(cod => {
            const uat = Number(cod);
            const district = sediu.get(judecatorii.uat[cod]);
            if (alese.has(uat) || district === null || district === undefined) return;
            implicite.push({ uat: uat, district: district, implicit: true });
        });
        return implicite.concat(manuale);
    }

    /**
     * Varianta mai fărâmițată a desenului de pornire: teritoriile grupurilor de acțiune locală,
     * adică harta pe care se împart deja banii europeni de dezvoltare locală. Un grup care trece
     * peste limita de județ dă câte un district în fiecare județ; UAT-urile din afara oricărui
     * grup (orașele mari, mai ales) intră în districtul grupului de lângă ele. Reședința e
     * cel mai mare UAT al districtului.
     *
     * `gal` = date/gal-uat.json. Întoarce lista de alegeri pentru `corectii`.
     */
    function alegeriCuGal(date, gal, corectii) {
        const manuale = corectii || [];
        if (!gal || !gal.uat) return manuale;
        const grupul = u => gal.uat[u.s] !== undefined ? gal.uat[u.s] : (gal.alaturate || {})[u.s];
        // bucata dintr-un grup aflată într-un județ: cheia districtului
        const bucati = new Map();
        date.uat.forEach(u => {
            const g = grupul(u);
            if (g === undefined) return;
            const cheie = `${g}|${u.j}`;
            if (!bucati.has(cheie)) bucati.set(cheie, []);
            bucati.get(cheie).push(u);
        });
        const alese = new Set(manuale.map(c => c.uat));
        const implicite = [];
        bucati.forEach(lista => {
            const resedinta = lista.reduce((a, u) => (u.p21 || 0) > (a.p21 || 0) ? u : a);
            lista.forEach(u => {
                if (!alese.has(u.s)) implicite.push({ uat: u.s, district: resedinta.s, implicit: true });
            });
        });
        return implicite.concat(manuale);
    }

    /**
     * Rulează calculul pe mai multe județe și le unește într-un singur rezultat, cu
     * aceeași formă ca `calculeaza`, plus `judete` (indicatorii fiecărui județ).
     * UAT-urile din afara județelor calculate (București) rămân unități neschimbate
     * și intră în totaluri așa cum sunt.
     */
    function calculeazaNational(date, vecini, exemple, optiuni) {
        const o = Object.assign({}, optiuni || {});
        // `zona`: UAT-urile care intră în indicatori (ex. o regiune ADR). Implicit, toată țara.
        const zona = o.zona ? new Set(o.zona) : null;
        delete o.zona;
        const cuDistrict = !!o.districte;   // și nivelul intermediar, județ cu județ
        delete o.districte;
        const P = Object.assign({}, PARAMETRI_IMPLICITI, o);
        const rezultate = exemple.map(ex => calculeaza(date, vecini, ex, P));
        const districte = [];
        const unitateDistrict = new Map();
        const unitateMicro = new Map();
        if (cuDistrict) {
            rezultate.forEach((r, k) => {
                const p = calculeazaDistrict(date, vecini, exemple[k], r, o);
                districte.push(...p.districte);
                p.unitateDistrict.forEach((v, u) => unitateDistrict.set(u, v));
                p.unitateMicro.forEach((v, u) => unitateMicro.set(u, v));
            });
        }
        const grup = new Map();
        const grupuri = [];
        const sate = [];
        const uat = [];
        rezultate.forEach(r => {
            r.grup.forEach((v, k) => grup.set(k, v));
            grupuri.push(...r.grupuri);
            sate.push(...r.sate);
            uat.push(...r.uat);
        });
        const acoperite = new Set(uat);
        const neacoperite = [];
        date.uat.forEach((u, i) => {
            if (!acoperite.has(i) && (!zona || zona.has(i))) neacoperite.push(i);
        });

        function indicatori(unitati, tCamp) {
            const pops = unitati.map(x => x.populatie).sort((a, b) => a - b);
            const proiectii = unitati.map(x => x.populatieProiectata);
            const greutate = sate.reduce((a, s) => a + Math.max(1, s.p || 0), 0);
            return {
                unitati: pops.length,
                subPrag: pops.filter(p => p < P.pMin).length,
                subPrag2050: proiectii.filter(p => p < P.pMin).length,
                sub3000: pops.filter(p => p < 3000).length,
                mediana: pops[Math.floor(pops.length / 2)],
                timpMediu: sate.reduce((a, s) => a + s[tCamp] * Math.max(1, s.p || 0), 0) / greutate,
                pesteTMax: sate.filter(s => s[tCamp] > P.tMax && (s.p || 0) >= P.pSatMin).length,
                popPesteTMax: sate.filter(s => s[tCamp] > P.tMax).reduce((a, s) => a + (s.p || 0), 0)
            };
        }
        const rest = neacoperite.map(i => ({
            populatie: date.uat[i].p21 || 0,
            populatieProiectata: proiecteaza(date.uat[i], P.anProiectie)
        }));
        return {
            parametri: P,
            judet: null,
            uat: uat,
            grup: grup,
            grupuri: grupuri.sort((a, b) => b.populatie - a.populatie),
            sate: sate,
            neacoperite: neacoperite,
            districte: cuDistrict ? districte.sort((a, b) => b.populatie - a.populatie) : null,
            unitateDistrict: cuDistrict ? unitateDistrict : null,
            unitateMicro: cuDistrict ? unitateMicro : null,
            inainte: indicatori(date.uat.filter((u, i) => !zona || zona.has(i)).map(u =>
                ({ populatie: u.p21 || 0, populatieProiectata: proiecteaza(u, P.anProiectie) })), "tAcum"),
            dupa: indicatori(grupuri.concat(rest), "tNou"),
            judete: rezultate.map(r => ({ judet: r.judet, inainte: r.inainte, dupa: r.dupa, grupuri: r.grupuri.length }))
        };
    }

    return {
        PARAMETRI_IMPLICITI: PARAMETRI_IMPLICITI,
        ritmAnual: ritmAnual,
        PARAMETRI_DISTRICT: PARAMETRI_DISTRICT,
        calculeaza: calculeaza,
        calculeazaDistrict: calculeazaDistrict,
        calculeazaNational: calculeazaNational,
        alegeriCuCircumscriptii: alegeriCuCircumscriptii,
        alegeriCuGal: alegeriCuGal
    };
}();
