/* ============================================================================
   fise-localitati.js — fișa fiecărei localități, scrisă în date/fise-localitati.json

   Pagina „Localitatea mea” (localitatea.html) trebuie să răspundă pe loc la
   întrebarea „ce se schimbă pentru satul meu?”, fără să ruleze în browser
   scenariul pe toată țara. Scriptul îl rulează o dată, cu aceleași module ca
   harta și raportul (js/adp-*.js), și păstrează, compact:
     * unitățile noi: cine cu cine, reședința, aparatul azi și după, economia,
       districtul, aleșii, golul de apă și canalizare;
     * fiecare UAT de azi: unitatea în care ajunge, costul primăriei lui,
       drumul mediu până la primărie, azi și după;
     * fiecare sat: drumul lui până la primărie, azi și după, și coordonatele
       (pentru „caută după locul în care sunt”);
     * cifrele pe țară și standardele de cost cu care economia se traduce în
       apă, canalizare și drumuri.

   Rulare:  node unelte/fise-localitati.js     (din rădăcina proiectului)
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const RADACINA = path.resolve(__dirname, "..");
const json = p => JSON.parse(fs.readFileSync(path.join(RADACINA, p), "utf8"));

// modulele paginii sunt scrise pentru browser: se încarcă pe un `window` fals (doar fișierele proiectului)
global.window = {};
["js/adp-topologie.js", "js/adp-reorganizare.js", "js/adp-institutii.js"]
    .forEach(f => eval(fs.readFileSync(path.join(RADACINA, f), "utf8")));
const { AdpTopologie, AdpReorganizare, AdpInstitutii } = global.window;

// Standardele de cost ale Programului „Anghel Saligny” (Ordinul MDLPA nr. 1321/2021): valori maxime,
// fără TVA. Sunt din 2021, deci dau un ordin de mărime, nu un deviz.
const STANDARDE = {
    apa: 1250,            // euro pe locuitor care beneficiază
    canalizare: 2500,     // euro pe locuitor echivalent
    drumComunal: 330000,  // euro pe kilometru
    sursa: "Ordinul MDLPA nr. 1321/2021, standardele de cost ale Programului „Anghel Saligny” (valori maxime, fără TVA)"
};
const CURS = 5.1;   // lei pe euro, orientativ

const date = json("date/romania-uat.json");
const vecini = AdpTopologie.vecini(AdpTopologie.decodeaza(date));
const index = json("date/judete/index.json").judete;
const exemple = index.map(j => json("date/" + j.fisier));
const alegeri = json("date/corectii-districte.json");
const judecatorii = json("date/judecatorii-uat.json");
const finante = json("date/finante-uat.json");
const personal = json("date/personal-judete.json");
const infra = json("date/infrastructura-uat.json");

const executie = new Map();
date.uat.forEach((u, i) => { if (finante.executieUat[u.s]) executie.set(i, finante.executieUat[u.s]); });

const r = AdpReorganizare.calculeazaNational(date, vecini, exemple, {
    districte: true, executie: executie,
    corectii: AdpReorganizare.alegeriCuCircumscriptii(judecatorii, alegeri.corectii || []),
    comasari: alegeri.comasari || [],
    transferuri: alegeri.transferuri || []
});
const P = r.parametri;
const rot = (v, z) => { const m = Math.pow(10, z || 0); return Math.round(v * m) / m; };
const pop = i => date.uat[i].pop || 0;
const areRetea = (i, camp) => ((infra.uat[date.uat[i].s] || {})[camp] || 0) > 0;
const aparat = i => (executie.get(i) || {}).cheltuieliAparat || 0;

// --- unitățile noi
const districtDupaSediu = new Map((r.districte || []).map(d => [d.sediu, d]));
const indexUnitate = new Map();
const unitati = r.grupuri.map((g, k) => {
    indexUnitate.set(g.sediu, k);
    const c = AdpReorganizare.aparatUnitate(g.membri, g.sediu, i => executie.get(i)) || { acum: 0, dupa: 0 };
    const d = districtDupaSediu.get(r.unitateDistrict.get(g.sediu));
    const al = AdpInstitutii.alesiLocali(date, g.membri, [g]);
    const micro = r.unitateMicro ? r.unitateMicro.get(g.sediu) : undefined;
    return {
        s: date.uat[g.sediu].s,                    // SIRUTA reședinței
        p: g.populatie,
        m: g.membri.map(i => date.uat[i].s),
        o: g.urban ? 1 : 0,                        // unitate cu oraș
        a: [Math.round(c.acum), Math.round(c.dupa)],
        d: d ? [d.nume, d.tip === "metropolitan" ? 1 : 0, d.numeResedinta] : null,
        g: micro === undefined ? null : date.uat[micro].n,   // orașul-pol al microregiunii (grupul LEADER)
        c: al.consilieriLocali,
        v: al.viceprimari,
        b: (g.birouri || []).map(i => date.uat[i].s),        // foste reședințe care păstrează birou permanent
        // locuitorii din UAT-urile fără nicio rețea
        fc: g.membri.filter(i => !areRetea(i, "canal")).reduce((a, i) => a + pop(i), 0),
        fa: g.membri.filter(i => !areRetea(i, "apa")).reduce((a, i) => a + pop(i), 0),
        t: rot(g.timpMediu, 1),
        x: (g.derogari || []).length,
        f: g.financiar && g.financiar.pondere !== null ? rot(g.financiar.pondere, 0) : null
    };
});

// --- UAT-urile de azi: drumul mediu până la primărie, ponderat cu populația satelor
const timpUat = new Map();
r.sate.forEach(x => {
    const t = timpUat.get(x.uat) || { g: 0, a: 0, n: 0 };
    const g = Math.max(1, x.p || 0);
    t.g += g; t.a += x.tAcum * g; t.n += x.tNou * g;
    timpUat.set(x.uat, t);
});
const tipScurt = { "comună": "c", "oraș": "o", "municipiu": "m" };
const uat = {};
date.uat.forEach((u, i) => {
    const g = r.grup.get(i);
    const t = timpUat.get(i);
    uat[u.s] = [
        u.n, tipScurt[u.t], u.j, pop(i),
        g === undefined ? -1 : indexUnitate.get(g),
        Math.round(aparat(i)),
        t ? rot(t.a / t.g, 1) : null, t ? rot(t.n / t.g, 1) : null,
        areRetea(i, "apa") ? 1 : 0, areRetea(i, "canal") ? 1 : 0,
        AdpReorganizare.consilieriLocali(AdpInstitutii.popAlegeri(u))
    ];
});

// --- satele: [SIRUTA, nume, SIRUTA UAT, locuitori (2021), lat, lng, min. azi, min. după]
const sate = r.sate.map(x => [x.s, x.n, date.uat[x.uat].s, x.p || 0,
    x.e ? rot(x.e[0], 4) : null, x.e ? rot(x.e[1], 4) : null, rot(x.tAcum, 1), rot(x.tNou, 1)]);

// --- județele: ce se economisește deasupra primăriilor (consiliul județean, serviciile statului)
const judete = {};
date.judete.forEach(j => {
    const sus = AdpInstitutii.economiiJudete(date, [j.c], finante, personal);
    const ale = date.uat.filter(u => u.j === j.c);
    judete[j.c] = [j.n, j.auto, ale.reduce((a, u) => a + (u.pop || 0), 0),
        Math.round(sus.economieCJ), Math.round(sus.economieStat),
        (date.adr.find(a => a.c === (ale[0] || {}).adr) || {}).n || ""];
});

// --- țara
const aparatAzi = Array.from(executie.values()).reduce((a, e) => a + (e.cheltuieliAparat || 0), 0);
const aparatDupa = unitati.reduce((a, x) => a + x.a[1], 0);
const sus = AdpInstitutii.economiiJudete(date, date.judete.map(j => j.c), finante, personal);
const faraCanal = date.uat.map((u, i) => i).filter(i => !areRetea(i, "canal"));
const faraApa = date.uat.map((u, i) => i).filter(i => !areRetea(i, "apa"));
const suma = lista => lista.reduce((a, i) => a + pop(i), 0);
const national = {
    uat: date.uat.length, unitati: r.dupa.unitati,
    economiePrimarii: Math.round(aparatAzi - aparatDupa),
    economieCJ: Math.round(sus.economieCJ),
    economieStat: Math.round(sus.economieStat),
    faraCanal: [faraCanal.length, suma(faraCanal)],
    faraApa: [faraApa.length, suma(faraApa)],
    sate: sate.length
};

const iesire = {
    versiune: 1,
    generat: new Date().toISOString().slice(0, 10),
    nota: "Fișa fiecărei localități, calculată cu regulile implicite (v2) de unelte/fise-localitati.js. " +
        "Câmpurile sunt poziționale, ca fișierul să rămână mic; ordinea lor e în `campuri`.",
    campuri: {
        unitati: "s: SIRUTA reședinței · p: locuitori · m: SIRUTA membrilor · o: unitate cu oraș · a: [aparat azi, după] lei/an · " +
            "d: [district, e zonă metropolitană, reședința districtului] · g: orașul-pol al microregiunii · c: consilieri [azi, propus] · " +
            "v: viceprimari [azi, propus] · b: foste reședințe cu birou permanent · fc / fa: locuitori în UAT-uri fără canalizare / fără apă · " +
            "t: drum mediu până la reședință, min · x: derogări · f: aparatul, % din veniturile proprii",
        uat: "[nume, tip (c/o/m), județ, locuitori, indexul unității (-1: nu intră în comasare), aparat lei/an, drum mediu azi, drum mediu după, are apă, are canalizare, consilieri azi]",
        sate: "[SIRUTA, nume, SIRUTA UAT, locuitori 2021, lat, lng, minute până la primărie azi, după]",
        judete: "[nume, auto, locuitori, economie consiliu județean lei/an, economie servicii ale statului lei/an, regiunea]"
    },
    parametri: { pMin: P.pMin, pTinta: P.pTinta, pMinOras: P.pMinOras, tMax: P.tMax, tBirou: P.tBirou,
        cotaBirouri: AdpReorganizare.REGULA_FINANCIARA.cotaBirouri },
    standarde: STANDARDE,
    curs: CURS,
    national: national,
    judete: judete,
    unitati: unitati,
    uat: uat,
    sate: sate
};
const cale = path.join(RADACINA, "date", "fise-localitati.json");
fs.writeFileSync(cale, JSON.stringify(iesire));
const mld = v => (v / 1e9).toFixed(2);
console.log(`scris date/fise-localitati.json (${Math.round(fs.statSync(cale).size / 1024)} KB): ${unitati.length} unități, ` +
    `${Object.keys(uat).length} UAT-uri, ${sate.length} sate`);
console.log(`economie pe an: primării ${mld(national.economiePrimarii)} + consilii județene ${mld(national.economieCJ)} + ` +
    `servicii ale statului ${mld(national.economieStat)} = ${mld(national.economiePrimarii + national.economieCJ + national.economieStat)} mld. lei`);
const costApa = national.faraApa[1] * STANDARDE.apa * CURS, costCanal = national.faraCanal[1] * STANDARDE.canalizare * CURS;
console.log(`fără apă: ${national.faraApa[1]} loc. → ${mld(costApa)} mld. lei; fără canalizare: ${national.faraCanal[1]} loc. → ${mld(costCanal)} mld. lei; ` +
    `împreună ${mld(costApa + costCanal)} mld. lei`);
