/* ============================================================================
   ro-adp — instituțiile unui județ, azi și în model.

   O singură fișă, folosită de pasul 3 de pe hartă (index.html) și de fișele de
   județ din raport.html, ca amândouă să arate aceleași cifre:
     * aleșii și funcțiile, după Codul administrativ (OUG 57/2019): primari,
       viceprimari, consilieri locali, delegați sătești, consilieri județeni,
       președintele și vicepreședinții consiliului județean;
     * consiliul județean și unde se mută fiecare atribuție a lui, cu banii;
     * judecătoriile de azi și districtele propuse, cu piesele fiecăruia;
     * grupurile de acțiune locală (GAL) de azi și microregiunile propuse;
     * serviciile statului cu structură în județ și unde ar sta sediul regional.
   Aici stau și calculele comune ale raportului: scara consilierilor județeni,
   locurile din consiliul regional, atribuțiile consiliului județean, sediile
   regionale. Modul independent; datele vin ca argumente.
   ========================================================================== */
window.AdpInstitutii = function() {
    "use strict";
    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 });

    // Codul administrativ, art. 152 alin. (1): un viceprimar în fiecare comună, oraș și municipiu,
    // doi în municipiile reședință de județ. Propunerea guvernului din 2025 de a desființa funcția
    // în unitățile sub 1.500 de locuitori a fost scoasă din pachetul de măsuri: nu e lege.
    const viceprimari = u => u.t === "municipiu" && u.r ? 2 : 1;
    // consiliul județean își alege, dintre consilieri, doi vicepreședinți; președintele e ales direct
    const VICEPRESEDINTI_CJ = 2;
    // Codul administrativ, art. 171: consilieri județeni (plus președintele), după populația județului
    const CONSILIERI_JUDETENI = [[350000, 30], [500000, 32], [650000, 34], [Infinity, 36]];
    // costul unui salariat pentru angajator: câștigul brut plus contribuția asiguratorie pentru muncă
    const COST_ANGAJATOR = 1.0225;
    // din aparatul consiliului județean, jumătate trece la personalul tehnic al districtelor și al
    // regiunii; cealaltă jumătate dispare odată cu structura (aceeași ipoteză ca în raport)
    const COTA_CJ_PASTRATA = 0.5;
    // ipoteză pentru instituțiile statului din județ: conducerea și funcțiile de suport (economic,
    // resurse umane, juridic, achiziții, administrativ), circa 30% din personal, se strâng la
    // regiune într-o treime din mărimea lor — adică o reducere de 20% a personalului
    const REDUCERE_STAT = 0.2;
    // LEADER: grupul are între atâția locuitori eligibili (comunele și orașele de cel mult 20.000)
    const PRAG_GAL = { min: 10000, max: 150000 };

    const dupaScara = (scara, p) => (scara.find(([prag]) => p <= prag) || scara[scara.length - 1])[1];
    const scaraLargita = (scara, factor) => scara.map(([prag, nr]) => [prag * factor, nr]);
    const esc = text => text === null || text === undefined ? "" : String(text).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
    const lei = v => v === null || v === undefined ? "—"
        : Math.abs(v) >= 1e9 ? `${NF1.format(v / 1e9)} mld. lei`
            : Math.abs(v) >= 1e6 ? `${NF1.format(v / 1e6)} mil. lei` : `${NF.format(Math.round(v))} lei`;
    const cate = (n, unu, multe) => `${NF.format(n)} ${n === 1 ? unu : (n % 100 >= 20 || n % 100 === 0) && n >= 20 ? "de " + multe : multe}`;

    // ------------------------------------------------------------ calcule comune cu raportul

    /**
     * Consiliile regionale: scara consiliilor județene aplicată la populația regiunii, înmulțită cu
     * `factor` (mai puțini aleși), cu locurile împărțite pe județe după populație, cu regula celui
     * mai mare rest. Fiecare județ e o circumscripție.
     */
    function consiliiRegionale(date, factor) {
        const popJudet = new Map(), adrJudet = new Map(), popAdr = new Map();
        date.uat.forEach(u => {
            popJudet.set(u.j, (popJudet.get(u.j) || 0) + (u.pop || 0));
            popAdr.set(u.adr, (popAdr.get(u.adr) || 0) + (u.pop || 0));
            adrJudet.set(u.j, u.adr);
        });
        const scara = scaraLargita(CONSILIERI_JUDETENI, factor || 1);
        return date.adr.map(a => {
            const populatie = popAdr.get(a.c) || 0;
            const judete = date.judete.filter(j => adrJudet.get(j.c) === a.c)
                .map(j => ({ c: j.c, nume: j.n, populatie: popJudet.get(j.c) || 0 }));
            const locuri = dupaScara(scara, populatie);
            const cote = judete.map(j => locuri * j.populatie / (populatie || 1));
            const impartite = cote.map(Math.floor);
            cote.map((c, k) => ({ k: k, rest: c - Math.floor(c) })).sort((x, y) => y.rest - x.rest)
                .slice(0, locuri - impartite.reduce((s, v) => s + v, 0)).forEach(x => { impartite[x.k]++; });
            return {
                cod: a.c,
                nume: a.n === "București-Ilfov" ? "București–Ilfov (Metropola)" : a.n,
                populatie: populatie,
                locuri: locuri,
                judete: judete.map((j, k) => Object.assign(j, { locuri: impartite[k] })).sort((x, y) => y.locuri - x.locuri)
            };
        });
    }

    /**
     * Unde ar sta instituțiile regionale ale unei regiuni: fiecare grup de instituții într-o
     * reședință de județ, ca regiunea să nu aibă un singur oraș care adună tot. Trei grupuri au
     * ancoră — stau unde statul a pus deja structura regională; restul merg, pe rând, în reședința
     * cea mai puțin încărcată, la egalitate în cea mai mare.
     * `regional` = date/regiuni-institutii.json, `lista` = date/institutii-judetene.json.
     */
    function sediiRegionale(date, regional, lista, adr) {
        const resedinte = date.uat.filter(u => u.adr === adr.c && (u.r || u.t === "municipiu" && u.n === "București"))
            .sort((a, b) => (b.pop || 0) - (a.pop || 0));
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

    // Atribuțiile consiliului județean și unde se mută (pasul 4 din sinteza.html). Gruparea e o propunere,
    // așezată pe tabelul de mutări din sinteză; destinațiile (clasificația funcțională din execuția
    // bugetară) se potrivesc după început. `sector`: secțiunea din statistica de personal al cărei câștig
    // mediu dă numărul de oameni.
    const ATRIBUTII_CJ = [
        { cod: "aparat", nume: "Aparatul consiliului județean", merge: "aparat", sector: "O",
            prefixe: ["autoritati executive", "alte servicii publice generale"] },
        { cod: "evidenta", nume: "Evidența persoanelor", merge: "district", sector: "O",
            prefixe: ["servicii publice comunitare de evidenta"] },
        { cod: "drumuri", nume: "Drumuri județene și transport local", merge: "district", sector: "O",
            prefixe: ["drumuri si poduri", "alte cheltuieli in domeniul transporturilor", "transport in comun"] },
        { cod: "mediu", nume: "Mediu, utilități, protecție civilă, ordine publică", merge: "district", sector: "O",
            prefixe: ["colectarea, tratarea", "salubritate", "alimentare cu apa", "alimantare cu gaze", "canalizarea",
                "reducerea si controlul poluarii", "alte servicii in domeniul protectiei mediului", "protectia biosferei",
                "alte servicii in domeniile locuintelor", "intretinere gradini", "iluminat public",
                "dezvoltarea sistemului de locuinte", "protectie civila", "aparare nationala", "politie locala",
                "alte cheltuieli in domeniul ordinii publice", "prevenire si combatere inundatii"] },
        { cod: "sanatate", nume: "Spitale și sănătate", merge: "regiune", sector: "Q",
            prefixe: ["spitale", "alte institutii si actiuni sanitare", "servicii de sanatate publica",
                "unitati de asistenta medico-sociale", "unitati medico-sociale"] },
        { cod: "social", nume: "Asistență socială și protecția copilului", merge: "regiune", sector: "Q",
            prefixe: ["asistenta sociala", "asistenta acordata persoanelor in varsta",
                "alte cheltuieli in domeniul asigurarilor si asistentei sociale", "ajutor social",
                "transferuri din bugetele consiliilor judetene pentru finantarea centrelor pentru protectia copilului"] },
        { cod: "cultura", nume: "Cultură, sport, tineret, turism", merge: "regiune", sector: "O",
            prefixe: ["muzee", "institutii publice de spectacole", "biblioteci", "centre culturale",
                "centre pentru conservarea", "scoli populare de arta", "alte servicii culturale",
                "alte servicii in domeniile culturii", "consolidarea si restaurarea", "servicii religioase", "sport",
                "tineret", "turism", "edituri", "presa"] },
        { cod: "invatamant", nume: "Învățământ", merge: "regiune", sector: "P",
            prefixe: ["invatamant", "alte cheltuieli in domeniul invatamantului", "internate si cantine"] },
        { cod: "aeroporturi", nume: "Aeroporturi și aviație civilă", merge: "regiune", sector: "O",
            prefixe: ["aeroporturi", "aviatia civila"] },
        { cod: "dezvoltare", nume: "Dezvoltare economică și regională", merge: "regiune", sector: "O",
            prefixe: ["alte actiuni economice", "alte cheltuieli pentru actiuni generale economice",
                "programe de dezvoltare regionala", "proiecte de dezvoltare multifunctionale",
                "alte cheltuieli in domeniul agriculturii", "protectia plantelor", "zone libere"] },
        { cod: "datorie", nume: "Datoria publică și împrumuturile", merge: "regiune", sector: "O",
            prefixe: ["tranzactii privind datoria publica"] }
    ];
    const ATRIBUTIE_NEPLASATA = { cod: "alte", nume: "Alte destinații (de stabilit)", merge: "de stabilit", sector: "O" };

    /** Atribuția unei destinații bugetare, după începutul denumirii (fără diacritice în sursă). */
    function atributieDestinatiei(nume) {
        const t = nume.replace(/\s+/g, " ").trim().toLowerCase();
        return ATRIBUTII_CJ.find(a => a.prefixe.some(p => t.startsWith(p))) || ATRIBUTIE_NEPLASATA;
    }

    /**
     * Ce mută fiecare consiliu județean: pe atribuții, cu banii și oamenii (estimați din cheltuiala de personal,
     * la câștigul mediu al județului în sectorul atribuției). Banii se mută odată cu atribuția; economia
     * vine doar din aparat. `cj` = date/cj-destinatii.json, `personal` = date/personal-judete.json.
     */
    function mutariCJ(date, cj, personal) {
        return date.judete.map(j => {
            const c = cj.judete[j.c];
            if (!c) return null;
            const castig = ((personal && personal.judete && personal.judete[j.c]) || {}).castigBrut || {};
            const grupuri = new Map([...ATRIBUTII_CJ, ATRIBUTIE_NEPLASATA].map(a => [a.cod, { a: a, lei: 0, personal: 0, oameni: 0 }]));
            c.destinatii.forEach(d => {
                const g = grupuri.get(atributieDestinatiei(d.nume).cod);
                g.lei += d.total;
                g.personal += d.personal;
                const cost = castig[g.a.sector] ? castig[g.a.sector] * 12 * COST_ANGAJATOR : null;
                if (cost) g.oameni += d.personal / cost;
            });
            const dupaDestinatie = merge => Array.from(grupuri.values()).filter(g => g.a.merge === merge)
                .reduce((t, g) => ({ lei: t.lei + g.lei, oameni: t.oameni + g.oameni }), { lei: 0, oameni: 0 });
            return {
                cod: j.c, nume: j.n, adr: date.uat.find(u => u.j === j.c).adr, total: c.total, grupuri: grupuri,
                aparat: dupaDestinatie("aparat"), district: dupaDestinatie("district"),
                regiune: dupaDestinatie("regiune"), neplasat: dupaDestinatie("de stabilit")
            };
        }).filter(Boolean);
    }

    /**
     * Ce se economisește pe an deasupra primăriilor, în județele `coduri`: jumătate din aparatul
     * consiliului județean și 20% din personalul instituțiilor statului (salariații din administrația
     * publică, fără primării și consiliul județean, la câștigul mediu al județului — o estimare).
     * Bucureștiul nu are consiliu județean, iar salariații lui sunt mai ales ai ministerelor: nu intră.
     * `finante` = date/finante-uat.json, `personal` = date/personal-judete.json.
     */
    function economiiJudete(date, coduri, finante, personal) {
        const ex = (finante && finante.executieUat) || {};
        const bucuresti = (date.judete.find(j => j.n === "București") || {}).c;
        let aparatCJ = 0, personalStat = 0, oameniStat = 0;
        coduri.forEach(cod => {
            if (cod === bucuresti) return;
            const cj = finante && finante.consiliiJudetene && finante.consiliiJudetene[cod];
            if (cj) aparatCJ += cj.cheltuieliAparat || 0;
            const p = personal && personal.judete && personal.judete[cod];
            if (!p || !p.salariati || !p.castigBrut || !p.castigBrut.O) return;
            const cost = p.castigBrut.O * 12 * COST_ANGAJATOR;
            const primarii = date.uat.filter(u => u.j === cod).reduce((a, u) => a + ((ex[u.s] || {}).personalAparat || 0), 0);
            const oameni = Math.max(0, p.salariati.O - primarii / cost - (cj ? cj.personalAparat || 0 : 0) / cost);
            oameniStat += oameni;
            personalStat += oameni * cost;
        });
        return {
            aparatCJ: aparatCJ, economieCJ: aparatCJ * (1 - COTA_CJ_PASTRATA),
            personalStat: personalStat, oameniStat: oameniStat, economieStat: personalStat * REDUCERE_STAT
        };
    }

    // ------------------------------------------------------------ fișa județului

    /** „ASOCIAȚIA GRUPUL DE ACȚIUNE LOCALĂ ”VALEA MOSTIȘTEI”” → „Valea Mostiștei”. */
    function numeGal(nume) {
        let t = String(nume || "").replace(/[”“"„«»]/g, " ").replace(/\s+/g, " ").trim();
        const prefixe = [/^asocia[tțţ]ia\s*/i, /^grup(ul)?\s+de\s+ac[tțţ]iune\s+local[aă]\s*(\(gal\))?\s*[-–]?\s*/i, /^gal\s+/i];
        for (let k = 0; k < 3; k++) prefixe.forEach(p => { t = t.replace(p, ""); });
        t = t.replace(/^[-–\s]+/, "");
        if (/^(pentru|de)\s/i.test(t)) t = "Asociația " + t.charAt(0).toLowerCase() + t.slice(1);
        if (t && t === t.toUpperCase()) {
            const mici = new Set(["de", "și", "si", "din", "la", "pe", "cu", "a", "al", "ale", "lui", "pentru", "în", "cu"]);
            t = t.toLowerCase().split(" ").map((w, k) => k && mici.has(w) ? w
                : w.replace(/(^|[-(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())).join(" ");
        }
        return t || String(nume || "");
    }

    /**
     * Cifrele fișei unui județ. `r` e rezultatul reorganizării (al județului sau al țării: se iau doar
     * UAT-urile județului `cod`); `s` = { judecatorii, gal, institutii (regiuni-institutii.json),
     * lista (institutii-judetene.json), cj, personal, infra }, oricare poate lipsi.
     */
    function sumarJudet(date, r, cod, s) {
        s = s || {};
        const R = window.AdpReorganizare;
        const judet = date.judete.find(j => j.c === cod) || { c: cod, n: "" };
        const pop = i => date.uat[i].pop || 0;
        const toate = date.uat.map((u, i) => i).filter(i => date.uat[i].j === cod);
        const grupuri = r.grupuri.filter(g => date.uat[g.sediu].j === cod);
        const membri = new Map(r.grupuri.map(g => [g.sediu, g.membri]));
        const districte = (r.districte || []).filter(d => date.uat[d.sediu].j === cod);
        const indexSiruta = new Map(date.uat.map((u, i) => [u.s, i]));
        const districtUat = i => r.unitateDistrict && r.grup ? r.unitateDistrict.get(r.grup.get(i)) : undefined;
        const membriiDistrict = d => d.unitati.flatMap(u => membri.get(u) || []);
        const numeDistrict = new Map(districte.map(d => [d.sediu, d.nume]));
        const popJudet = toate.reduce((a, i) => a + pop(i), 0);

        // aleșii și funcțiile, după Codul administrativ
        const consiliuRegional = consiliiRegionale(date, R.FACTOR_CONSILIERI)
            .find(x => x.judete.some(j => j.c === cod)) || null;
        const locuriRegionale = consiliuRegional ? (consiliuRegional.judete.find(j => j.c === cod) || {}).locuri || 0 : 0;
        const viceDupa = g => g.membri.some(i => viceprimari(date.uat[i]) === 2) ? 2 : 1;
        const sate = (r.sate || []).filter(x => date.uat[x.uat].j === cod);
        const alesi = {
            primari: [toate.length, grupuri.length],
            viceprimari: [toate.reduce((a, i) => a + viceprimari(date.uat[i]), 0), grupuri.reduce((a, g) => a + viceDupa(g), 0)],
            consilieriLocali: [toate.reduce((a, i) => a + R.consilieriLocali(pop(i)), 0),
                grupuri.reduce((a, g) => a + R.consilieriLocali(g.populatie, R.FACTOR_CONSILIERI), 0)],
            delegati: [0, sate.length],
            secretari: [toate.length, grupuri.length],
            consilieriJudeteni: [dupaScara(CONSILIERI_JUDETENI, popJudet), locuriRegionale],
            conducereCJ: [1 + VICEPRESEDINTI_CJ, 0],
            sub1500: [toate.filter(i => pop(i) < 1500).length, grupuri.filter(g => g.populatie < 1500).length],
            consiliuRegional: consiliuRegional,
            districte: districte.length
        };

        // judecătoriile de azi și districtele propuse
        let judecatorii = null;
        if (s.judecatorii && s.judecatorii.uat) {
            const dupaId = new Map((s.judecatorii.judecatorii || []).map(j => [j.id, j]));
            const peJudecatorie = new Map();
            toate.forEach(i => {
                const id = s.judecatorii.uat[date.uat[i].s];
                if (id === undefined) return;
                if (!peJudecatorie.has(id)) peJudecatorie.set(id, { j: dupaId.get(id), uat: 0, populatie: 0, districte: new Set() });
                const x = peJudecatorie.get(id);
                x.uat++;
                x.populatie += pop(i);
                const d = districtUat(i);
                if (numeDistrict.has(d)) x.districte.add(numeDistrict.get(d));
            });
            const sedii = new Set((s.judecatorii.judecatorii || []).map(j => j.sediu));
            judecatorii = {
                lista: Array.from(peJudecatorie.values()).filter(x => x.j).map(x => {
                    const i = indexSiruta.get(x.j.sediu);
                    return Object.assign(x, { sediu: i, numeSediu: i === undefined ? x.j.nume : date.uat[i].n,
                        districte: Array.from(x.districte) });
                }).sort((a, b) => b.populatie - a.populatie),
                // judecătoria fiecărui district: cea a majorității locuitorilor lui; are sau nu sediu în district
                peDistrict: new Map(districte.map(d => {
                    const ale = membriiDistrict(d);
                    const cu = ale.filter(i => sedii.has(date.uat[i].s));
                    const pe = new Map();
                    ale.forEach(i => {
                        const id = s.judecatorii.uat[date.uat[i].s];
                        if (id !== undefined) pe.set(id, (pe.get(id) || 0) + pop(i));
                    });
                    const majoritara = Array.from(pe.entries()).sort((a, b) => b[1] - a[1])[0];
                    const jm = majoritara && dupaId.get(majoritara[0]);
                    const im = jm ? indexSiruta.get(jm.sediu) : undefined;
                    return [d.sediu, {
                        sediuInDistrict: cu.length ? date.uat[cu[0]].n : null,
                        majoritara: im === undefined ? (jm ? jm.nume : null) : date.uat[im].n
                    }];
                }))
            };
        }

        // spitalele publice și liceele, pe districte (INS și rețeaua școlară)
        const infraUat = i => (s.infra && s.infra.uat && s.infra.uat[date.uat[i].s]) || {};
        const suma = (lista, camp) => lista.reduce((a, i) => a + (infraUat(i)[camp] || 0), 0);
        const piese = new Map(districte.map(d => {
            const ale = membriiDistrict(d);
            return [d.sediu, { spitale: suma(ale, "spitalePublice"), licee: suma(ale, "licee") }];
        }));

        // grupurile de acțiune locală de azi
        let gal = null;
        if (s.gal && s.gal.uat) {
            const dupaId = new Map((s.gal.gal || []).map(g => [g.id, g]));
            const peGal = new Map();
            toate.forEach(i => {
                const id = s.gal.uat[date.uat[i].s];
                if (id === undefined) return;
                if (!peGal.has(id)) peGal.set(id, { g: dupaId.get(id), uat: 0, populatie: 0, districte: new Set() });
                const x = peGal.get(id);
                x.uat++;
                x.populatie += pop(i);
                const d = districtUat(i);
                if (d !== undefined) x.districte.add(d);
            });
            const inAfara = toate.filter(i => s.gal.uat[date.uat[i].s] === undefined);
            gal = {
                lista: Array.from(peGal.values()).filter(x => x.g).map(x => Object.assign(x, {
                    nume: numeGal(x.g.nume), total: x.g.uat, pesteJudet: (x.g.judete || []).length > 1,
                    nrDistricte: x.districte.size
                })).sort((a, b) => b.uat - a.uat),
                inAfara: inAfara.length,
                comuneInAfara: inAfara.filter(i => date.uat[i].t === "comună").length,
                popInAfara: inAfara.reduce((a, i) => a + pop(i), 0)
            };
        }
        const microregiuni = districte.flatMap(d => (d.microregiuni || []).map(m => Object.assign({ district: d.nume }, m)));

        // consiliul județean
        const cj = s.cj && s.cj.judete ? mutariCJ(date, s.cj, s.personal).find(x => x.cod === cod) || null : null;

        // serviciile statului: câte instituții au structură în județ și ce devin; unde ar sta sediile regionale
        let stat = null;
        if (s.lista && s.lista.institutii) {
            const inst = s.lista.institutii;
            const adr = date.adr.find(a => a.c === (date.uat[toate[0]] || {}).adr);
            const sedii = adr ? sediiRegionale(date, s.institutii, s.lista, adr) : [];
            stat = {
                total: inst.length,
                nrRegiune: inst.filter(i => i.destinatie.includes("regiune")).length,
                district: inst.filter(i => i.destinatie.includes("district")).length,
                ramane: inst.filter(i => i.destinatie === "rămâne").length,
                dispare: inst.filter(i => i.destinatie === "dispare").length,
                grupuri: s.lista.grupuri.map(g => {
                    const gazda = sedii.find(x => x.grupuri.includes(g.nume));
                    return {
                        g: g,
                        institutii: inst.filter(i => i.grup === g.cod),
                        oras: gazda ? gazda.uat.n : null,
                        inJudet: gazda ? gazda.uat.j === cod : false
                    };
                }),
                resedinta: (date.uat.find(u => u.j === cod && u.r) || {}).n || null,
                regiune: adr ? (adr.n === "București-Ilfov" ? "București–Ilfov" : adr.n) : ""
            };
        }
        const salariati = ((s.personal && s.personal.judete && s.personal.judete[cod]) || {}).salariati || null;

        return {
            judet: judet, populatie: popJudet, uat: toate.length, unitati: grupuri.length,
            alesi: alesi, districte: districte, judecatorii: judecatorii, piese: piese, gal: gal,
            microregiuni: microregiuni, cj: cj, stat: stat, salariati: salariati,
            spitaleAzi: suma(toate, "spitalePublice"),
            anPersonal: s.personal && s.personal.ani ? s.personal.ani.salariati : null,
            anCJ: s.cj ? s.cj.anExecutie : null
        };
    }

    /**
     * Fișa ca HTML. `optiuni.clasa`: clasa tabelelor (raportul: „tabel-doc”, panoul hărții:
     * „tabel-atribute tabel-pas”); `optiuni.titlu`: nivelul titlurilor („h3” sau „h4”).
     */
    function fisaJudet(date, r, cod, s, optiuni) {
        const o = Object.assign({ clasa: "tabel-doc", titlu: "h4" }, optiuni || {});
        const x = sumarJudet(date, r, cod, s);
        const a = x.alesi;
        const H = (text, mic) => `<${o.titlu}>${text}${mic ? ` <small class="nota">${mic}</small>` : ""}</${o.titlu}>`;
        const tabel = (cap, randuri) => `<div class="tabel-derulant"><table class="${o.clasa} tabel-institutii">
            <thead><tr>${cap.map(c => `<th scope="col">${c}</th>`).join("")}</tr></thead>
            <tbody>${randuri.join("")}</tbody></table></div>`;
        const dif = (azi, dupa) => azi === dupa ? "" : `<small class="pp-dif">${dupa > azi ? "+" : "−"}${NF.format(Math.abs(dupa - azi))}</small>`;
        const randAles = (functia, regula, azi, dupa, nota) => `<tr>
            <th scope="row">${functia}<br><small>${regula}</small></th>
            <td>${NF.format(azi)}</td><td><b>${NF.format(dupa)}</b> ${dif(azi, dupa)}</td>
            <td><small>${nota}</small></td></tr>`;
        const totalAzi = a.primari[0] + a.consilieriLocali[0] + a.consilieriJudeteni[0] + 1;
        const totalDupa = a.primari[1] + a.consilieriLocali[1] + a.consilieriJudeteni[1];
        const remAzi = a.primari[0] + a.viceprimari[0] + a.conducereCJ[0];
        const remDupa = a.primari[1] + a.viceprimari[1];
        const regiune = a.consiliuRegional;

        const sectiuneAlesi = `
            ${H("Aleși și funcții, după Codul administrativ", "— azi, după legea în vigoare; propus, după aceleași reguli aplicate unităților noi")}
            ${tabel(["Funcția", "Azi", "Propus", "Cum se schimbă"], [
                randAles("Primari", "unul în fiecare comună, oraș, municipiu", a.primari[0], a.primari[1],
                    "unul în fiecare unitate nouă; satele comasate își aleg delegatul"),
                randAles("Viceprimari", "art. 152: unul; doi în municipiul reședință de județ", a.viceprimari[0], a.viceprimari[1],
                    "aceeași regulă, pe unitățile noi; aleși dintre consilieri, deci nu se adaugă la aleși"),
                randAles("Consilieri locali", "art. 112: de la 9 (sub 1.500 loc.) la 31", a.consilieriLocali[0], a.consilieriLocali[1],
                    "aceeași scară, la dublul populației: un consilier la de două ori mai mulți locuitori"),
                randAles("Delegați sătești, cu fond propriu", "art. 142: doar în satele fără consilier", a.delegati[0], a.delegati[1],
                    "fiecare sat comasat își alege delegatul, care participă la consiliul local"),
                randAles("Secretari generali ai unității", "unul în fiecare UAT", a.secretari[0], a.secretari[1],
                    "unul în fiecare unitate; în fostele primării rămân birouri, nu secretariate"),
                randAles("Consilieri județeni → regionali", "art. 171: 30–36 pe județ, după populație",
                    a.consilieriJudeteni[0], a.consilieriJudeteni[1],
                    regiune ? `locurile județului în consiliul regional ${esc(regiune.nume)} (${NF.format(regiune.locuri)} în total), după populație` : ""),
                randAles("Președinte și vicepreședinți ai consiliului județean", "președinte ales direct, 2 vicepreședinți",
                    a.conducereCJ[0], a.conducereCJ[1],
                    "consiliul județean dispare; regiunea are un singur președinte și vicepreședinții ei"),
                `<tr class="rand-total"><th scope="row">Aleși, în total<br><small>primari, consilieri locali, consilieri județeni, președintele CJ</small></th>
                    <td>${NF.format(totalAzi)}</td><td><b>${NF.format(totalDupa)}</b> ${dif(totalAzi, totalDupa)}</td>
                    <td><small>viceprimarii și vicepreședinții sunt aleși dintre consilieri</small></td></tr>`,
                `<tr class="rand-total"><th scope="row">Funcții de demnitate publică, plătite<br><small>primari, viceprimari, conducerea CJ</small></th>
                    <td>${NF.format(remAzi)}</td><td><b>${NF.format(remDupa)}</b> ${dif(remAzi, remDupa)}</td>
                    <td><small>în ${cate(a.districte, "district", "districte")}, consiliul e format din primari, fără indemnizație în plus</small></td></tr>`
            ])}
            <p class="nota">Cifrele de azi urmează Codul administrativ în vigoare. Desființarea viceprimarului în unitățile
                sub 1.500 de locuitori, propusă de guvern în 2025, a fost scoasă din pachetul de măsuri; în județ ar fi
                atins ${cate(a.sub1500[0], "UAT", "UAT-uri")} azi și ${a.sub1500[1] ? cate(a.sub1500[1], "unitate", "unități") : "nicio unitate"} după comasare.</p>`;

        // instituțiile, pe scurt
        const j = x.judecatorii, g = x.gal, cj = x.cj, st = x.stat;
        const cuJudecatorie = j ? x.districte.filter(d => (j.peDistrict.get(d.sediu) || {}).sediuInDistrict).length : 0;
        const cuSpital = x.districte.filter(d => (x.piese.get(d.sediu) || {}).spitale).length;
        const microInPrag = x.microregiuni.filter(m => m.inBanda).length;
        const rand = (inst, azi, propus) => `<tr><th scope="row">${inst}</th><td>${azi}</td><td>${propus}</td></tr>`;
        const sectiuneSumar = `
            ${H("Instituțiile județului, azi și propus")}
            ${tabel(["Instituția", "Azi", "Propus"], [
                rand("Primăriile", `${NF.format(x.uat)} primării și consilii locale`,
                    `<b>${NF.format(x.unitati)}</b>; în fostele primării, birou cu program și delegat sătesc`),
                rand("Consiliul județean", cj ? `un consiliu, ${lei(cj.total)} pe an (${x.anCJ})` : "un consiliu",
                    cj ? `<b>dispare</b>: ${lei(cj.regiune.lei)} trec la regiune, ${lei(cj.district.lei)} la districte; aparatul, ${lei(cj.aparat.lei)} → ${lei(cj.aparat.lei * COTA_CJ_PASTRATA)}`
                        : "<b>dispare</b>; atribuțiile trec la regiune și la districte"),
                rand("Districte (nivelul dintre comună și regiune)", "—",
                    `<b>${NF.format(x.districte.length)}</b>: ${x.districte.map(d => esc(d.nume)).join(", ") || "—"}`),
                j ? rand("Judecătorii, parchete, notari", `${cate(j.lista.length, "judecătorie", "judecătorii")}: ${j.lista.map(y => esc(y.numeSediu)).join(", ")}`,
                    `câte una în fiecare district: <b>${NF.format(cuJudecatorie)}</b> din ${NF.format(x.districte.length)} au deja sediul în district` +
                    (x.districte.length - cuJudecatorie ? `; ${cate(x.districte.length - cuJudecatorie, "district primește", "districte primesc")} un punct de lucru sau se unesc cu vecinul` : "")) : "",
                g ? rand("Grupuri de acțiune locală (LEADER)", `${cate(g.lista.length, "grup", "grupuri")}` +
                    (g.lista.filter(y => y.pesteJudet).length ? `, ${NF.format(g.lista.filter(y => y.pesteJudet).length)} peste granița județului` : "") +
                    (g.inAfara ? `; ${cate(g.inAfara, "UAT", "UAT-uri")} în afara oricărui grup` : ""),
                    `<b>${cate(x.microregiuni.length, "microregiune", "microregiuni")}</b>, fiecare cu un oraș-pol și întreagă într-un district; ${NF.format(microInPrag)} în pragurile LEADER`) : "",
                rand("Spitale publice", `${NF.format(x.spitaleAzi)}`,
                    `spitalele județene trec la regiune; spital public în <b>${NF.format(cuSpital)}</b> din ${NF.format(x.districte.length)} districte`),
                st ? rand("Prefectura și serviciile statului", `${NF.format(st.total)} instituții cu structură în județ` +
                    (x.salariati && x.salariati.O ? `; ${NF.format(x.salariati.O)} de salariați în administrația publică (INS, ${x.anPersonal})` : ""),
                    `${NF.format(st.nrRegiune)} devin regionale (regiunea ${esc(st.regiune)}), ${NF.format(st.district)} au ghișeu în fiecare district; ` +
                    `în ${esc(st.resedinta || "fosta reședință")} rămâne oficiul județean unic` +
                    (st.grupuri.some(y => y.inJudet) ? ` și sediul regional pentru: ${st.grupuri.filter(y => y.inJudet).map(y => esc(y.g.nume.toLowerCase())).join("; ")}` : "")) : ""
            ].filter(Boolean))}`;

        // districtele, cu piesele lor
        const sectiuneDistricte = !x.districte.length ? "" : `
            <details class="fisa-detalii"><summary>Districtele propuse și instanțele lor</summary>
            ${tabel(["Districtul", "Judecătoria", "Spital public, licee", "Microregiuni LEADER"], x.districte.map(d => {
                const jd = j ? j.peDistrict.get(d.sediu) || {} : {};
                const p = x.piese.get(d.sediu) || {};
                const m = d.microregiuni || [];
                return `<tr><th scope="row">${esc(d.nume)}
                        <br><small>${d.tip === "metropolitan" ? "zonă metropolitană" : "district"} · ${NF.format(d.populatie)} loc. ·
                        ${cate(d.unitati.length, "unitate", "unități")}${d.numeResedinta !== d.nume ? ` · reședința: ${esc(d.numeResedinta)}` : ""}</small></th>
                    <td>${jd.sediuInDistrict ? `<span class="eticheta-stare bun">${esc(jd.sediuInDistrict)}</span>`
                        : `<span class="eticheta-stare atentie">fără sediu</span>${jd.majoritara ? `<br><small>azi ține de ${esc(jd.majoritara)}</small>` : ""}`}</td>
                    <td>${p.spitale ? `<span class="eticheta-stare bun">${cate(p.spitale, "spital", "spitale")}</span>` : `<span class="eticheta-stare atentie">fără spital</span>`}
                        <br><small>${p.licee ? cate(p.licee, "liceu", "licee") : "fără liceu"}</small></td>
                    <td>${NF.format(m.length)}<br><small>${NF.format(m.filter(y => y.inBanda).length)} în prag</small></td></tr>`;
            }))}
            ${j ? H("Judecătoriile de azi", "— circumscripțiile, pe UAT-uri, și districtele în care ajung") +
                tabel(["Judecătoria", "UAT-uri", "Locuitori", "Ajunge în"], j.lista.map(y => `<tr>
                    <th scope="row">${esc(y.numeSediu)}</th><td class="num">${NF.format(y.uat)}</td>
                    <td class="num">${NF.format(y.populatie)}</td><td>${y.districte.map(esc).join(", ") || "—"}</td></tr>`)) : ""}
            <p class="nota">Districtul pornește de la circumscripția judecătoriei: e singura împărțire sub județ pe care o
                folosesc deja mai multe instituții (instanța, parchetul, notarii). Unde lipsește o piesă, districtul o
                primește sau se unește cu vecinul — asta se hotărăște în etapa voluntară.</p>
            </details>`;

        // grupurile de acțiune locală și microregiunile
        const sectiuneGal = !g ? "" : `
            <details class="fisa-detalii"><summary>Grupurile de acțiune locală și microregiunile propuse</summary>
            ${H("Grupurile de azi")}
            ${tabel(["Grupul", "UAT-uri în județ", "Locuitori", "Districte atinse"], g.lista.map(y => `<tr>
                <th scope="row">${esc(y.nume)}${y.pesteJudet ? `<br><small>trece granița județului (${NF.format(y.total)} UAT-uri în total)</small>` : ""}</th>
                <td class="num">${NF.format(y.uat)}</td><td class="num">${NF.format(y.populatie)}</td>
                <td>${y.nrDistricte > 1 ? `<span class="eticheta-stare atentie">${NF.format(y.nrDistricte)}</span>` : NF.format(y.nrDistricte)}</td></tr>`).concat(
                g.inAfara ? [`<tr><th scope="row"><i>în afara oricărui grup</i></th><td class="num">${NF.format(g.inAfara)}</td>
                    <td class="num">${NF.format(g.popInAfara)}</td><td><small>${cate(g.comuneInAfara, "comună", "comune")}</small></td></tr>`] : []))}
            ${H("Microregiunile propuse", `— LEADER cere ${NF.format(PRAG_GAL.min)}–${NF.format(PRAG_GAL.max)} de locuitori eligibili`)}
            ${tabel(["Microregiunea (orașul-pol)", "Districtul", "Unități", "Locuitori", "Eligibili LEADER"], x.microregiuni.map(m => `<tr>
                <th scope="row">${esc(m.nume)}</th><td>${esc(m.district)}</td><td class="num">${NF.format(m.unitati.length)}</td>
                <td class="num">${NF.format(m.populatie)}</td>
                <td>${NF.format(m.popLeader)} ${m.inBanda ? `<span class="eticheta-stare bun">în prag</span>` : `<span class="eticheta-stare atentie">în afara pragului</span>`}</td></tr>`))}
            <p class="nota">Grupurile de azi s-au format voluntar și se întind adesea peste mai multe districte. În model,
                microregiunea e grupul de acțiune locală: comunele din jurul unui oraș-pol, întregi într-un district.
                Orașele de peste 20.000 de locuitori ies din LEADER și au strategia lor urbană.</p>
            </details>`;

        // consiliul județean, atribuție cu atribuție
        const sectiuneCJ = !cj ? "" : `
            <details class="fisa-detalii"><summary>Consiliul județean: unde merge fiecare atribuție</summary>
            ${tabel(["Atribuția", "Merge la", "Bani pe an", "Oameni (estimat)"], Array.from(cj.grupuri.values()).filter(y => y.lei > 0)
                .map(y => `<tr><th scope="row">${esc(y.a.nume)}</th>
                    <td>${y.a.merge === "aparat" ? "jumătate rămâne, jumătate dispare" : esc(y.a.merge)}</td>
                    <td class="num">${lei(y.lei)}</td><td class="num">${NF.format(Math.round(y.oameni))}</td></tr>`)
                .concat([`<tr class="rand-total"><th scope="row">Total</th><td></td><td class="num">${lei(cj.total)}</td>
                    <td class="num">${NF.format(Math.round(Array.from(cj.grupuri.values()).reduce((t, y) => t + y.oameni, 0)))}</td></tr>`]))}
            <p class="nota">Execuția bugetară ${esc(String(x.anCJ || ""))} a consiliului județean, pe destinații. Banii se mută
                odată cu atribuția; economia vine doar din aparat. Oamenii sunt deduși din cheltuiala de personal, la
                câștigul mediu al județului în sectorul fiecărei atribuții.</p>
            </details>`;

        // serviciile statului
        const sectiuneStat = !st ? "" : `
            <details class="fisa-detalii"><summary>Prefectura și serviciile statului: unde ar sta sediile</summary>
            ${tabel(["Grupul de instituții", "Sediul regional", "Instituții"], st.grupuri.map(y => `<tr>
                <th scope="row">${esc(y.g.nume)}<br><small>${esc(y.g.explicatie)}</small></th>
                <td>${y.oras ? (y.inJudet ? `<span class="eticheta-stare bun">${esc(y.oras)}</span>` : esc(y.oras)) : "—"}</td>
                <td><small>${y.institutii.map(i => esc(i.nume)).join("; ")}</small></td></tr>`))}
            <p class="nota">${NF.format(st.total)} instituții au azi câte o structură în fiecare județ. În model,
                ${NF.format(st.nrRegiune)} trec la regiune, ${NF.format(st.district)} au un ghișeu în fiecare district
                (tot ce are de-a face direct cu omul), iar în fosta reședință rămâne un oficiu județean unic. Așezarea pe
                orașe e o propunere de pornire, de negociat în regiune: nicio regiune cu un singur oraș care adună tot.</p>
            </details>`;

        return `<div class="fisa-institutii">${sectiuneAlesi}${sectiuneSumar}${sectiuneDistricte}${sectiuneGal}${sectiuneCJ}${sectiuneStat}</div>`;
    }

    return {
        CONSILIERI_JUDETENI: CONSILIERI_JUDETENI,
        VICEPRESEDINTI_CJ: VICEPRESEDINTI_CJ,
        COST_ANGAJATOR: COST_ANGAJATOR,
        COTA_CJ_PASTRATA: COTA_CJ_PASTRATA,
        REDUCERE_STAT: REDUCERE_STAT,
        economiiJudete: economiiJudete,
        ATRIBUTII_CJ: ATRIBUTII_CJ,
        ATRIBUTIE_NEPLASATA: ATRIBUTIE_NEPLASATA,
        viceprimari: viceprimari,
        consiliiRegionale: consiliiRegionale,
        sediiRegionale: sediiRegionale,
        atributieDestinatiei: atributieDestinatiei,
        mutariCJ: mutariCJ,
        numeGal: numeGal,
        sumarJudet: sumarJudet,
        fisaJudet: fisaJudet
    };
}();
