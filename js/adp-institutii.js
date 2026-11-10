/* ============================================================================
   ro-adp — instituțiile unui județ, azi și în model.

   O singură fișă, folosită de pasul 3 de pe hartă (index.html) și de fișele de
   județ din raport.html, ca amândouă să arate aceleași cifre:
     * aleșii și funcțiile, după Codul administrativ (OUG 57/2019): primari și
       viceprimari (art. 148), consilieri locali (art. 112), delegați sătești
       (art. 142), consilieri județeni (art. 171), președintele și vicepreședinții
       consiliului județean (art. 188). Consilierii se numără, ca în lege, pe
       populația după domiciliu din anul alegerilor; Bucureștiul, care rămâne
       cum e, nu intră în numărătoare;
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

    // Codul administrativ, art. 148 alin. (1): un viceprimar în fiecare comună, oraș și municipiu,
    // doi în municipiile reședință de județ. Propunerea guvernului din 2025 de a desființa funcția
    // în unitățile sub 1.500 de locuitori a fost scoasă din pachetul de măsuri: nu e lege.
    const viceprimari = u => u.t === "municipiu" && u.r ? 2 : 1;
    // art. 188: consiliul județean își alege, dintre consilieri, doi vicepreședinți; președintele e ales direct
    const VICEPRESEDINTI_CJ = 2;
    // art. 171: consilieri județeni (plus președintele), după populația județului
    const CONSILIERI_JUDETENI = [[350000, 30], [500000, 32], [650000, 34], [Infinity, 36]];
    // art. 112 și 171: numărul consilierilor se stabilește pe populația după domiciliu de la 1 ianuarie
    // a anului alegerilor — pentru consiliile de azi, 2024 (câmpul p24). E altă cifră decât populația
    // rezidentă pe care se judecă pragurile de comasare.
    const AN_ALEGERI = 2024;
    const popAlegeri = u => u.p24 || u.pd || u.pop || 0;
    // Bucureștiul are regulile lui (primar general, sectoare, Consiliul General cu 55 de membri, art. 112
    // și 164) și rămâne cum e: nu intră în numărătoarea aleșilor, nici azi, nici în propunere
    const esteBucuresti = u => u.t === "municipiu" && u.n === "București";
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
        const popJudet = new Map(), adrJudet = new Map(), popAdr = new Map(), legalJudet = new Map();
        date.uat.forEach(u => {
            popJudet.set(u.j, (popJudet.get(u.j) || 0) + (u.pop || 0));
            legalJudet.set(u.j, (legalJudet.get(u.j) || 0) + popAlegeri(u));
            popAdr.set(u.adr, (popAdr.get(u.adr) || 0) + (u.pop || 0));
            adrJudet.set(u.j, u.adr);
        });
        const scara = scaraLargita(CONSILIERI_JUDETENI, factor || 1);
        return date.adr.map(a => {
            const populatie = popAdr.get(a.c) || 0;
            // locurile se socotesc, ca în art. 171, pe populația după domiciliu; cea afișată e rezidentă
            const judete = date.judete.filter(j => adrJudet.get(j.c) === a.c)
                .map(j => ({ c: j.c, nume: j.n, populatie: popJudet.get(j.c) || 0, legal: legalJudet.get(j.c) || 0 }));
            const legal = judete.reduce((s, j) => s + j.legal, 0);
            const locuri = dupaScara(scara, legal);
            const cote = judete.map(j => locuri * j.legal / (legal || 1));
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
     * Aleșii locali ai unui teritoriu, azi și în propunere, după Codul administrativ: primari și
     * viceprimari (art. 148), consilieri locali (art. 112, pe populația după domiciliu din anul
     * alegerilor; în propunere, aceeași scară la `FACTOR_CONSILIERI` ori populația). `uat` = indecșii
     * UAT-urilor de azi, `grupuri` = unitățile noi. Bucureștiul nu se numără.
     */
    function alesiLocali(date, uat, grupuri) {
        const R = window.AdpReorganizare;
        const ale = uat.filter(i => !esteBucuresti(date.uat[i]));
        const noi = grupuri.filter(g => !g.membri.some(i => esteBucuresti(date.uat[i])));
        const popUnitate = g => g.membri.reduce((a, i) => a + popAlegeri(date.uat[i]), 0);
        const viceDupa = g => g.membri.some(i => viceprimari(date.uat[i]) === 2) ? 2 : 1;
        return {
            primari: [ale.length, noi.length],
            viceprimari: [ale.reduce((a, i) => a + viceprimari(date.uat[i]), 0), noi.reduce((a, g) => a + viceDupa(g), 0)],
            consilieriLocali: [ale.reduce((a, i) => a + R.consilieriLocali(popAlegeri(date.uat[i])), 0),
                noi.reduce((a, g) => a + R.consilieriLocali(popUnitate(g), R.FACTOR_CONSILIERI), 0)]
        };
    }

    /** Consilierii fiecărui consiliu județean de azi (art. 171, fără președinte): Map cod județ → număr. */
    function consilieriJudeteni(date) {
        const legal = new Map();
        date.uat.forEach(u => { if (!esteBucuresti(u)) legal.set(u.j, (legal.get(u.j) || 0) + popAlegeri(u)); });
        return new Map(Array.from(legal.entries()).map(([cod, p]) => [cod, dupaScara(CONSILIERI_JUDETENI, p)]));
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
        const sate = (r.sate || []).filter(x => date.uat[x.uat].j === cod);
        const alesi = Object.assign(alesiLocali(date, toate, grupuri), {
            // în model, fiecare sat își alege delegatul și are un fond al lui; azi delegatul există doar
            // în satele fără consilier (art. 142), fără buget — câți sunt nu se știe din date
            delegati: [null, sate.length],
            secretari: [toate.length, grupuri.length],
            consilieriJudeteni: [consilieriJudeteni(date).get(cod) || 0, locuriRegionale],
            conducereCJ: [1 + VICEPRESEDINTI_CJ, 0],
            sub1500: [toate.filter(i => pop(i) < 1500).length, grupuri.filter(g => g.populatie < 1500).length],
            consiliuRegional: consiliuRegional,
            districte: districte.length
        });

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
     * „tabel-atribute tabel-pas”); `optiuni.titlu`: nivelul titlurilor („h3” sau „h4”);
     * `optiuni.ingust`: varianta pentru panoul îngust al hărții — cel mult trei coloane, cu
     * explicațiile sub numele rândului, nu într-o coloană a lor.
     */
    function fisaJudet(date, r, cod, s, optiuni) {
        const o = Object.assign({ clasa: "tabel-doc", titlu: "h4", ingust: false }, optiuni || {});
        const ingust = o.ingust;
        const x = sumarJudet(date, r, cod, s);
        const a = x.alesi;
        const H = (text, mic) => `<${o.titlu}>${text}${mic ? ` <small class="nota">${mic}</small>` : ""}</${o.titlu}>`;
        const tabel = (cap, randuri) => `<div class="tabel-derulant"><table class="${o.clasa} tabel-institutii">
            <thead><tr>${cap.map(c => c.charAt(0) === "#" ? `<th scope="col" class="num">${c.slice(1)}</th>` : `<th scope="col">${c}</th>`).join("")}</tr></thead>
            <tbody>${randuri.join("")}</tbody></table></div>`;
        // un rând: capul lui (cu explicații mărunte dedesubt) și celulele; în varianta îngustă,
        // coloanele `inCap` coboară sub nume
        const mic = lista => { const ce = lista.filter(Boolean); return ce.length ? `<br><small>${ce.join(" · ")}</small>` : ""; };
        const rand = (nume, sub, celule, inCap, clasa) => `<tr${clasa ? ` class="${clasa}"` : ""}>
            <th scope="row">${nume}${mic(sub || [])}${ingust ? (inCap || []).filter(Boolean).map(c => `<small class="fisa-schimbare">${c}</small>`).join("") : ""}</th>
            ${celule.join("")}${ingust ? "" : (inCap || []).map(c => `<td><small>${c}</small></td>`).join("")}</tr>`;
        const num = v => `<td class="num">${v}</td>`;
        const dif = (azi, dupa) => azi === null || azi === dupa ? "" : ` <small class="pp-dif">${dupa > azi ? "+" : "−"}${NF.format(Math.abs(dupa - azi))}</small>`;
        const randAles = (functia, regula, [azi, dupa], nota, clasa) => rand(functia, [regula],
            [num(azi === null ? "—" : NF.format(azi)), num(`<b>${NF.format(dupa)}</b>${dif(azi, dupa)}`)],
            [nota && ingust ? `→ ${nota}` : nota], clasa);

        const totalAzi = a.primari[0] + a.consilieriLocali[0] + a.consilieriJudeteni[0] + 1;
        const totalDupa = a.primari[1] + a.consilieriLocali[1] + a.consilieriJudeteni[1];
        const demnAzi = a.primari[0] + a.viceprimari[0] + a.conducereCJ[0];
        const demnDupa = a.primari[1] + a.viceprimari[1];
        const regiune = a.consiliuRegional;

        const sectiuneAlesi = `
            ${H("Aleși și funcții, după Codul administrativ")}
            ${tabel(["Funcția", "#Azi", "#Propus"].concat(ingust ? [] : ["Cum se schimbă"]), [
                randAles("Primari", "art. 148: unul în fiecare comună, oraș și municipiu", a.primari,
                    "unul în fiecare unitate nouă"),
                randAles("Viceprimari", "art. 148: unul; doi în municipiul reședință de județ", a.viceprimari,
                    "aceeași regulă, pe unitățile noi; sunt aleși dintre consilieri"),
                randAles("Consilieri locali", `art. 112: de la 9 la 31, după populația cu domiciliul în localitate`, a.consilieriLocali,
                    "aceeași scară, la dublul populației: un consilier la de două ori mai mulți locuitori"),
                randAles("Delegați sătești cu fond propriu", "art. 142: azi, doar în satele fără consilier, fără buget", a.delegati,
                    "fiecare sat își alege delegatul, care are un fond al satului și vine la consiliul local"),
                randAles("Secretari generali ai unității", "funcționar public de conducere, unul în fiecare UAT", a.secretari,
                    "unul în fiecare unitate; în fostele primării rămân birouri, nu secretariate"),
                randAles("Consilieri județeni → regionali", "art. 171: 30–36 pe județ, după populație", a.consilieriJudeteni,
                    regiune ? `locurile județului în consiliul regional ${esc(regiune.nume)}, care are ${NF.format(regiune.locuri)} în total` : ""),
                randAles("Președinte și vicepreședinți ai consiliului județean", "președinte ales direct; art. 188: doi vicepreședinți", a.conducereCJ,
                    "consiliul județean dispare; regiunea are un singur președinte, cu vicepreședinții lui"),
                randAles("Aleși, în total", "primari, consilieri locali, consilieri județeni, președintele consiliului județean",
                    [totalAzi, totalDupa], "viceprimarii și vicepreședinții nu se adună: sunt aleși dintre consilieri", "rand-total"),
                randAles("Funcții de demnitate publică", "primari, viceprimari, președintele și vicepreședinții consiliului județean",
                    [demnAzi, demnDupa], `în ${cate(a.districte, "district", "districte")}, consiliul e format din primari, fără indemnizație în plus`, "rand-total")
            ])}
            <p class="nota">„Azi” urmează Codul administrativ în vigoare. Consilierii se numără, cum cere legea, pe populația
                după domiciliu de la 1 ianuarie ${AN_ALEGERI}, anul alegerilor — nu pe cea rezidentă, pe care se judecă pragurile
                de comasare. Desființarea viceprimarului în unitățile sub 1.500 de locuitori, propusă de guvern în 2025, nu a
                devenit lege; în județ ar fi atins ${cate(a.sub1500[0], "UAT", "UAT-uri")} azi și
                ${a.sub1500[1] ? cate(a.sub1500[1], "unitate", "unități") : "nicio unitate"} după comasare.</p>`;

        // instituțiile, pe scurt: tabel în raport, listă în panoul îngust
        const j = x.judecatorii, g = x.gal, cj = x.cj, st = x.stat;
        const cuJudecatorie = j ? x.districte.filter(d => (j.peDistrict.get(d.sediu) || {}).sediuInDistrict).length : 0;
        const cuSpital = x.districte.filter(d => (x.piese.get(d.sediu) || {}).spitale).length;
        const microInPrag = x.microregiuni.filter(m => m.inBanda).length;
        const pesteJudet = g ? g.lista.filter(y => y.pesteJudet).length : 0;
        const institutii = [
            ["Primăriile", `${NF.format(x.uat)} primării și consilii locale`,
                `<b>${NF.format(x.unitati)}</b>; în fostele primării, birou cu program și delegat sătesc`],
            ["Consiliul județean", cj ? `un consiliu, ${lei(cj.total)} pe an (${x.anCJ})` : "un consiliu",
                cj ? `<b>dispare</b>: ${lei(cj.regiune.lei)} trec la regiune, ${lei(cj.district.lei)} la districte; aparatul, ${lei(cj.aparat.lei)} → ${lei(cj.aparat.lei * COTA_CJ_PASTRATA)}`
                    : "<b>dispare</b>; atribuțiile trec la regiune și la districte"],
            ["Districte (nivelul dintre comună și regiune)", "—",
                `<b>${NF.format(x.districte.length)}</b>: ${x.districte.map(d => esc(d.nume)).join(", ") || "—"}`],
            j && ["Judecătorii, parchete, notari", `${cate(j.lista.length, "judecătorie", "judecătorii")}: ${j.lista.map(y => esc(y.numeSediu)).join(", ")}`,
                `câte una în fiecare district: <b>${NF.format(cuJudecatorie)}</b> din ${NF.format(x.districte.length)} au deja sediul în district` +
                (x.districte.length - cuJudecatorie ? `; ${cate(x.districte.length - cuJudecatorie, "district primește", "districte primesc")} un punct de lucru sau se unesc cu vecinul` : "")],
            g && ["Grupuri de acțiune locală (LEADER)", cate(g.lista.length, "grup", "grupuri") +
                (pesteJudet ? `, ${NF.format(pesteJudet)} peste granița județului` : "") +
                (g.inAfara ? `; ${cate(g.inAfara, "UAT", "UAT-uri")} în afara oricărui grup` : ""),
                `<b>${cate(x.microregiuni.length, "microregiune", "microregiuni")}</b>, fiecare cu un oraș-pol și întreagă într-un district; ${NF.format(microInPrag)} în pragurile LEADER`],
            ["Spitale publice", NF.format(x.spitaleAzi),
                `spitalele județene trec la regiune; spital public în <b>${NF.format(cuSpital)}</b> din ${NF.format(x.districte.length)} districte`],
            st && ["Prefectura și serviciile statului", `${NF.format(st.total)} instituții cu structură în județ` +
                (x.salariati && x.salariati.O ? `; ${NF.format(x.salariati.O)} de salariați în administrația publică (INS, ${x.anPersonal})` : ""),
                `${NF.format(st.nrRegiune)} devin regionale (regiunea ${esc(st.regiune)}), ${NF.format(st.district)} au ghișeu în fiecare district; ` +
                `în ${esc(st.resedinta || "fosta reședință")} rămâne oficiul județean unic` +
                (st.grupuri.some(y => y.inJudet) ? ` și sediul regional pentru: ${st.grupuri.filter(y => y.inJudet).map(y => esc(y.g.nume.toLowerCase())).join("; ")}` : "")]
        ].filter(Boolean);
        const sectiuneSumar = `
            ${H("Instituțiile județului, azi și propus")}
            ${ingust ? `<dl class="fisa-lista">${institutii.map(([nume, azi, propus]) => `<div>
                    <dt>${nume}</dt>
                    <dd><span class="fisa-cand">azi</span> ${azi}</dd>
                    <dd><span class="fisa-cand propus">propus</span> ${propus}</dd></div>`).join("")}</dl>`
                : tabel(["Instituția", "Azi", "Propus"], institutii.map(([nume, azi, propus]) =>
                    `<tr><th scope="row">${nume}</th><td>${azi}</td><td>${propus}</td></tr>`))}`;

        // districtele, cu piesele lor
        const stare = (bun, text) => `<span class="eticheta-stare ${bun ? "bun" : "atentie"}">${text}</span>`;
        const sectiuneDistricte = !x.districte.length ? "" : `
            <details class="fisa-detalii"><summary>Districtele propuse și instanțele lor</summary>
            ${tabel(["Districtul", "Judecătoria", "Spital public, licee"].concat(ingust ? [] : ["Microregiuni LEADER"]), x.districte.map(d => {
                const jd = j ? j.peDistrict.get(d.sediu) || {} : {};
                const p = x.piese.get(d.sediu) || {};
                const m = d.microregiuni || [];
                const micro = `${cate(m.length, "microregiune", "microregiuni")}, ${NF.format(m.filter(y => y.inBanda).length)} în pragul LEADER`;
                return rand(esc(d.nume), [d.tip === "metropolitan" ? "zonă metropolitană" : "district", `${NF.format(d.populatie)} loc.`,
                    cate(d.unitati.length, "unitate", "unități"), d.numeResedinta !== d.nume ? `reședința: ${esc(d.numeResedinta)}` : ""],
                    [`<td>${jd.sediuInDistrict ? stare(true, esc(jd.sediuInDistrict))
                        : stare(false, "fără sediu") + (jd.majoritara ? `<br><small>azi ține de ${esc(jd.majoritara)}</small>` : "")}</td>`,
                    `<td>${p.spitale ? stare(true, cate(p.spitale, "spital", "spitale")) : stare(false, "fără spital")}
                        <br><small>${p.licee ? cate(p.licee, "liceu", "licee") : "fără liceu"}</small></td>`], [micro]);
            }))}
            ${j ? H("Judecătoriile de azi", "— circumscripțiile, pe UAT-uri, și districtele în care ajung") +
                tabel(["Judecătoria", "#UAT‑uri", "#Locuitori"].concat(ingust ? [] : ["Ajunge în"]), j.lista.map(y =>
                    rand(esc(y.numeSediu), [], [num(NF.format(y.uat)), num(NF.format(y.populatie))],
                        [(ingust ? "ajunge în: " : "") + (y.districte.map(esc).join(", ") || "—")]))) : ""}
            <p class="nota">Districtul pornește de la circumscripția judecătoriei: e singura împărțire sub județ pe care o
                folosesc deja mai multe instituții (instanța, parchetul, notarii). Unde lipsește o piesă, districtul o
                primește sau se unește cu vecinul — asta se hotărăște în etapa voluntară.</p>
            </details>`;

        // grupurile de acțiune locală și microregiunile
        const sectiuneGal = !g ? "" : `
            <details class="fisa-detalii"><summary>Grupurile de acțiune locală și microregiunile propuse</summary>
            ${H("Grupurile de azi")}
            ${tabel(["Grupul", ingust ? "#UAT‑uri" : "#UAT‑uri în județ", "#Locuitori"].concat(ingust ? [] : ["Districte atinse"]), g.lista.map(y =>
                rand(esc(y.nume), [y.pesteJudet ? `trece granița județului (${NF.format(y.total)} UAT-uri în total)` : ""],
                    [num(NF.format(y.uat)), num(NF.format(y.populatie))],
                    [ingust ? (y.nrDistricte > 1 ? `împărțit între ${NF.format(y.nrDistricte)} districte` : "într-un singur district")
                        : y.nrDistricte > 1 ? stare(false, NF.format(y.nrDistricte)) : NF.format(y.nrDistricte)])).concat(
                g.inAfara ? [rand("<i>în afara oricărui grup</i>", [], [num(NF.format(g.inAfara)), num(NF.format(g.popInAfara))],
                    [[g.comuneInAfara ? cate(g.comuneInAfara, "comună", "comune") : "",
                        g.inAfara - g.comuneInAfara ? cate(g.inAfara - g.comuneInAfara, "oraș", "orașe") + ", cu strategia lor urbană" : ""]
                        .filter(Boolean).join("; ")])] : []))}
            ${H("Microregiunile propuse", `— LEADER cere ${NF.format(PRAG_GAL.min)}–${NF.format(PRAG_GAL.max)} de locuitori eligibili`)}
            ${tabel(["Microregiunea (orașul-pol)"].concat(ingust ? [] : ["Districtul", "#Unități"]).concat(["#Locuitori", "Eligibili LEADER"]), x.microregiuni.map(m => `<tr>
                <th scope="row">${esc(m.nume)}${ingust ? mic([`districtul ${esc(m.district)}`, cate(m.unitati.length, "unitate", "unități")]) : ""}</th>
                ${ingust ? "" : `<td>${esc(m.district)}</td>${num(NF.format(m.unitati.length))}`}
                ${num(NF.format(m.populatie))}
                <td>${NF.format(m.popLeader)} ${stare(m.inBanda, m.inBanda ? "în prag" : "în afara pragului")}</td></tr>`))}
            <p class="nota">Grupurile de azi s-au format voluntar și se întind adesea peste mai multe districte. În model,
                microregiunea e grupul de acțiune locală: comunele din jurul unui oraș-pol, întregi într-un district.
                Orașele de peste 20.000 de locuitori ies din LEADER și au strategia lor urbană.</p>
            </details>`;

        // consiliul județean, atribuție cu atribuție
        const mergeLa = y => y.a.merge === "aparat" ? "jumătate rămâne, jumătate dispare" : esc(y.a.merge);
        const sectiuneCJ = !cj ? "" : `
            <details class="fisa-detalii"><summary>Consiliul județean: unde merge fiecare atribuție</summary>
            ${tabel(["Atribuția"].concat(ingust ? [] : ["Merge la"]).concat(["#Bani pe an", ingust ? "#Oameni" : "#Oameni (estimat)"]), Array.from(cj.grupuri.values()).filter(y => y.lei > 0)
                .map(y => `<tr><th scope="row">${esc(y.a.nume)}${ingust ? mic([`merge la: ${mergeLa(y)}`]) : ""}</th>
                    ${ingust ? "" : `<td>${mergeLa(y)}</td>`}${num(lei(y.lei))}${num(NF.format(Math.round(y.oameni)))}</tr>`)
                .concat([`<tr class="rand-total"><th scope="row">Total</th>${ingust ? "" : "<td></td>"}${num(lei(cj.total))}
                    ${num(NF.format(Math.round(Array.from(cj.grupuri.values()).reduce((t, y) => t + y.oameni, 0))))}</tr>`]))}
            <p class="nota">Execuția bugetară ${esc(String(x.anCJ || ""))} a consiliului județean, pe destinații. Banii se mută
                odată cu atribuția; economia vine doar din aparat. Oamenii sunt deduși din cheltuiala de personal, la
                câștigul mediu al județului în sectorul fiecărei atribuții.</p>
            </details>`;

        // serviciile statului
        const sectiuneStat = !st ? "" : `
            <details class="fisa-detalii"><summary>Prefectura și serviciile statului: unde ar sta sediile</summary>
            ${tabel(["Grupul de instituții", "Sediul regional"].concat(ingust ? [] : ["Instituții"]), st.grupuri.map(y =>
                rand(esc(y.g.nume), [esc(y.g.explicatie)],
                    [`<td>${y.oras ? (y.inJudet ? stare(true, esc(y.oras)) : esc(y.oras)) : "—"}</td>`],
                    [y.institutii.map(i => esc(i.nume)).join("; ")]))) }
            <p class="nota">${NF.format(st.total)} instituții au azi câte o structură în fiecare județ. În model,
                ${NF.format(st.nrRegiune)} trec la regiune, ${NF.format(st.district)} au un ghișeu în fiecare district
                (tot ce are de-a face direct cu omul), iar în fosta reședință rămâne un oficiu județean unic. Așezarea pe
                orașe e o propunere de pornire, de negociat în regiune: nicio regiune cu un singur oraș care adună tot.</p>
            </details>`;

        return `<div class="fisa-institutii${ingust ? " ingusta" : ""}">${sectiuneAlesi}${sectiuneSumar}${sectiuneDistricte}${sectiuneGal}${sectiuneCJ}${sectiuneStat}</div>`;
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
        AN_ALEGERI: AN_ALEGERI,
        popAlegeri: popAlegeri,
        esteBucuresti: esteBucuresti,
        alesiLocali: alesiLocali,
        consilieriJudeteni: consilieriJudeteni,
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
