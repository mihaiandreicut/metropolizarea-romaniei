/* ============================================================================
   panou.js — datele panoului de pe prima pagină, scrise în date/panou.json

   Panoul (index.html) arată pe loc cifrele mari ale propunerii, fără să ruleze
   în browser scenariul pe toată țara. Scriptul îl rulează o dată, cu aceleași
   module ca harta și raportul (js/adp-*.js), și păstrează, compact:
     * cifrele naționale: unități, aleși, oameni, bani, drumul până la primărie;
     * de unde vin banii (primării, consilii județene, serviciile statului) și
       plaja lor, cu ipotezele la capete;
     * curba costului: aparatul primăriei pe locuitor, pe clase de mărime;
     * fiecare județ și fiecare regiune: UAT-uri azi, unități după, economie;
     * variantele de regiuni (azi, 8 de dezvoltare, curțile de apel, calculate);
     * apa și canalizarea care lipsesc și cât costă.

   Rulare:  node unelte/panou.js     (din rădăcina proiectului)
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const RADACINA = path.resolve(__dirname, "..");
const json = p => JSON.parse(fs.readFileSync(path.join(RADACINA, p), "utf8"));

// modulele paginii sunt scrise pentru browser: se încarcă pe un `window` fals (doar fișierele proiectului)
global.window = {};
["js/adp-topologie.js", "js/adp-reorganizare.js", "js/adp-institutii.js", "js/adp-infrastructura.js", "js/adp-regionalizare.js"]
    .forEach(f => eval(fs.readFileSync(path.join(RADACINA, f), "utf8")));
const { AdpTopologie, AdpReorganizare: R, AdpInstitutii: I, AdpInfrastructura, AdpRegionalizare: G } = global.window;

const date = json("date/romania-uat.json");
const vecini = AdpTopologie.vecini(AdpTopologie.decodeaza(date));
const exemple = json("date/judete/index.json").judete.map(j => json("date/" + j.fisier));
const alegeri = json("date/corectii-districte.json");
const judecatorii = json("date/judecatorii-uat.json");
const finante = json("date/finante-uat.json");
const personal = json("date/personal-judete.json");
const infra = json("date/infrastructura-uat.json");
const dotari = json("date/dotari-uat.json").localitati;
const institutiiRegionale = json("date/regiuni-institutii.json");

const executie = new Map();
date.uat.forEach((u, i) => { if (finante.executieUat[u.s]) executie.set(i, finante.executieUat[u.s]); });

const r = R.calculeazaNational(date, vecini, exemple, {
    districte: true, executie: executie, dotari: dotari,
    corectii: R.alegeriCuCircumscriptii(judecatorii, alegeri.corectii || []),
    comasari: alegeri.comasari || [],
    transferuri: alegeri.transferuri || []
});
const rot = (v, z) => { const m = Math.pow(10, z || 0); return Math.round(v * m) / m; };
const pop = i => date.uat[i].pop || 0;
const COTA = R.REGULA_FINANCIARA.cotaBirouri;
const aparatUnitati = (grupuri, cota) => grupuri.reduce((a, g) => {
    const c = R.aparatUnitate(g.membri, g.sediu, i => executie.get(i), cota);
    return { acum: a.acum + (c ? c.acum : 0), dupa: a.dupa + (c ? c.dupa : 0) };
}, { acum: 0, dupa: 0 });
const judetulUnitatii = g => R.judetulUnitatii(date, g);

// --- banii, cu plaja ipotezelor
const aparatAzi = Array.from(executie.values()).reduce((a, e) => a + (e.cheltuieliAparat || 0), 0);
const economiePrimarii = cota => aparatAzi - aparatUnitati(r.grupuri, cota).dupa;
const sus = I.economiiJudete(date, date.judete.map(j => j.c), finante, personal);
const bani = {
    aparatAzi: Math.round(aparatAzi),
    aparatDupa: Math.round(aparatAzi - economiePrimarii(COTA)),
    primarii: Math.round(economiePrimarii(COTA)),
    cj: Math.round(sus.economieCJ),
    stat: Math.round(sus.economieStat),
    aparatCJ: Math.round(sus.aparatCJ),
    personalStat: Math.round(sus.personalStat),
    cota: COTA
};
bani.total = bani.primarii + bani.cj + bani.stat;
// ipotezele la capete: biroul din sat 35% / 15%, din aparatul CJ dispare 30% / 70%, personalul statului −10% / −30%
bani.plaja = [
    Math.round(economiePrimarii(0.35) + 0.3 * sus.aparatCJ + 0.1 * sus.personalStat),
    Math.round(economiePrimarii(0.15) + 0.7 * sus.aparatCJ + 0.3 * sus.personalStat)
];
bani.primariiPeCota = [0.15, 0.25, 0.35].map(c => [c, Math.round(economiePrimarii(c))]);

// --- aleșii (Codul administrativ; fără București, care are regulile lui)
const al = I.alesiLocali(date, date.uat.map((u, i) => i), r.grupuri);
let judeteni = 0;
I.consilieriJudeteni(date).forEach(n => { judeteni += n + 1; });
const regionali = I.consiliiRegionale(date, R.FACTOR_CONSILIERI).reduce((a, x) => a + x.locuri + 1, 0);
const alesi = {
    primari: al.primari, consilieriLocali: al.consilieriLocali,
    judeteni: [judeteni, regionali],
    total: [al.primari[0] + al.consilieriLocali[0] + judeteni, al.primari[1] + al.consilieriLocali[1] + regionali]
};

// --- oamenii din administrația publică, ca în raport (fără București)
let oameniAzi = 0, oameniDupa = 0;
date.judete.forEach(j => {
    const p = personal.judete[j.c];
    const grupuri = r.grupuri.filter(g => judetulUnitatii(g) === j.c);
    if (!p || !p.salariati || !p.castigBrut || !grupuri.length) return;
    const cost = p.castigBrut.O * 12 * I.COST_ANGAJATOR;
    const leiPrimarii = date.uat.filter(u => u.j === j.c)
        .reduce((a, u) => a + ((finante.executieUat[u.s] || {}).personalAparat || 0), 0);
    const ap = aparatUnitati(grupuri, COTA);
    const raport = ap.acum ? ap.dupa / ap.acum : 1;
    const leiCJ = ((finante.consiliiJudetene || {})[j.c] || {}).personalAparat || 0;
    const primarii = leiPrimarii / cost, cj = leiCJ / cost;
    const stat = Math.max(0, p.salariati.O - primarii - cj);
    oameniAzi += primarii + cj + stat;
    oameniDupa += primarii * raport + cj * I.COTA_CJ_PASTRATA + stat * (1 - I.REDUCERE_STAT);
});

// --- apa și canalizarea care lipsesc (UAT-uri fără niciun kilometru de rețea)
const S = AdpInfrastructura.STANDARDE;
const areRetea = (i, camp) => ((infra.uat[date.uat[i].s] || {})[camp] || 0) > 0;
const fara = camp => date.uat.map((u, i) => i).filter(i => !areRetea(i, camp));
const faraApa = fara("apa"), faraCanal = fara("canal");
const suma = l => l.reduce((a, i) => a + pop(i), 0);
const retele = {
    apa: { uat: faraApa.length, locuitori: suma(faraApa), cost: Math.round(suma(faraApa) * S.apa * S.curs) },
    canal: { uat: faraCanal.length, locuitori: suma(faraCanal), cost: Math.round(suma(faraCanal) * S.canalizare * S.curs) },
    standarde: { apa: S.apa, canalizare: S.canalizare, curs: S.curs, sursa: S.sursa }
};
retele.total = retele.apa.cost + retele.canal.cost;

// --- curba costului: aparatul pe locuitor, pe clase de mărime (doar execuțiile reale)
const reale = Array.from(executie.entries()).filter(([, e]) => !e.estimat);
const curba = [[0, 1500], [1500, 3000], [3000, 5000], [5000, 7000], [7000, 10000], [10000, 20000],
    [20000, 50000], [50000, Infinity]].map(([de, pana]) => {
    const x = reale.filter(([i]) => pop(i) >= de && pop(i) < pana);
    const s = f => x.reduce((a, [i, e]) => a + f(i, e), 0);
    return {
        de: de, pana: pana === Infinity ? null : pana, primarii: x.length,
        lei: Math.round(s((i, e) => e.cheltuieliAparat) / s(i => pop(i))),
        dinVenituri: Math.round(100 * s((i, e) => e.cheltuieliAparat) / s((i, e) => e.venituriProprii))
    };
});

// --- județele și regiunile
const judete = date.judete.filter(j => r.judete.some(x => x.judet === j.c)).map(j => {
    const ind = r.judete.find(x => x.judet === j.c);
    const uat = date.uat.map((u, i) => i).filter(i => date.uat[i].j === j.c);
    const grupuri = r.grupuri.filter(g => judetulUnitatii(g) === j.c);
    const ap = aparatUnitati(grupuri, COTA);
    const susJ = I.economiiJudete(date, [j.c], finante, personal);
    return {
        c: j.c, n: j.n, auto: j.auto, adr: date.uat[uat[0]].adr,
        populatie: suma(uat), uat: uat.length, unitati: grupuri.length,
        subPrag: [uat.filter(i => pop(i) < r.parametri.pMin).length, grupuri.filter(g => g.populatie < r.parametri.pMin).length],
        timp: [rot(ind.inainte.timpMediu, 1), rot(ind.dupa.timpMediu, 1)],
        pesteTMax: ind.dupa.pesteTMax,
        districte: (r.districte || []).filter(d => date.uat[d.sediu].j === j.c).length,
        economie: [Math.round(ap.acum - ap.dupa), Math.round(susJ.economieCJ), Math.round(susJ.economieStat)],
        capitala: grupuri.some(g => g.capitala) ? 1 : 0
    };
});
const regiuni = date.adr.map(a => {
    const ale = judete.filter(j => j.adr === a.c);
    const adun = f => ale.reduce((s, j) => s + f(j), 0);
    // Bucureștiul nu e un județ calculat: populația lui intră în unitatea Capitalei, la Ilfov
    const popBuc = a.n === "București-Ilfov" ? date.uat.filter(u => u.j === 40).reduce((s, u) => s + (u.pop || 0), 0) : 0;
    return {
        c: a.c, n: a.n === "București-Ilfov" ? "București–Ilfov (Metropola)" : a.n,
        judete: ale.length, populatie: adun(j => j.populatie) + popBuc,
        uat: adun(j => j.uat) + (popBuc ? 1 : 0), unitati: adun(j => j.unitati),
        economie: adun(j => j.economie[0] + j.economie[1] + j.economie[2])
    };
});

// --- variantele de regiuni, cu situația de azi ca punct de plecare
const pj = G.pregatesteJudete(date, vecini, institutiiRegionale);
const consilieriVarianta = v => {
    if (v.azi) return judeteni;
    return I.consiliiRegionale(date, R.FACTOR_CONSILIERI, v.regiuni.map(x => ({ cod: x.capitala, nume: x.nume, judete: x.judete })))
        .reduce((a, x) => a + x.locuri + 1, 0);
};
const variante = [
    ["judete", "Azi: 41 de județe și București", G.judeteAzi(pj.judete, institutiiRegionale.sisteme)],
    ["adr", "8 regiuni de dezvoltare (propunerea)", G.dinCircumscriptii(pj.judete, pj.vecini, institutiiRegionale.sisteme, "adr")],
    ["curte-apel", "Curțile de apel, cu Metropola", G.dinCircumscriptii(pj.judete, pj.vecini, institutiiRegionale.sisteme, "curte-apel")],
    ["calculata", "8 regiuni calculate", G.calculeaza(pj.judete, pj.vecini, institutiiRegionale.sisteme, { nrRegiuni: 8 })],
    ["calculata", "12 regiuni calculate", G.calculeaza(pj.judete, pj.vecini, institutiiRegionale.sisteme, { nrRegiuni: 12 })],
    ["calculata", "16 regiuni calculate", G.calculeaza(pj.judete, pj.vecini, institutiiRegionale.sisteme, { nrRegiuni: 16 })]
].map(([cod, nume, v]) => ({
    cod: cod, nume: nume, regiuni: v.indicatori.nrRegiuni,
    populatieMedie: Math.round(v.indicatori.populatieMedie),
    raportPopulatie: rot(v.indicatori.raportPopulatie, 1),
    raportPib: v.indicatori.raportPibLoc ? rot(v.indicatori.raportPibLoc, 1) : null,
    minute: Math.round(v.indicatori.minuteMediu),
    consilieri: consilieriVarianta(v)
}));

// --- variantele de comasare: aceleași date, alte reguli (fiecare rulează toată țara)
const optiuniBaza = {
    executie: executie, dotari: dotari,
    corectii: R.alegeriCuCircumscriptii(judecatorii, alegeri.corectii || []),
    comasari: alegeri.comasari || [],
    transferuri: alegeri.transferuri || []
};
const sate30 = rez => rez.sate.filter(s => s.tNou > 30 && (s.p || 0) >= rez.parametri.pSatMin).length;
const scenarii = [
    ["p2000", "Prag 2.000", { pMin: 2000, pTinta: 3000 }],
    ["propus", "Propunerea: 3.000", {}],
    ["p5000", "Prag 5.000", { pMin: 5000, pTinta: 7000 }],
    ["t45", "3.000, până la 45 de minute", { tMax: 45 }],
    ["faraOras", "3.000, fără preluarea de către oraș", { absorbtieUrbana: false }],
    ["faraCapitala", "3.000, fără regula Capitalei", { capitala: false }]
].map(([cod, nume, opt]) => {
    const x = cod === "propus" ? r : R.calculeazaNational(date, vecini, exemple, Object.assign({}, optiuniBaza, opt));
    const ap = aparatUnitati(x.grupuri, COTA);
    return {
        cod: cod, nume: nume,
        unitati: x.dupa.unitati,
        sub3000: x.grupuri.filter(g => g.populatie < 3000).length,
        economie: Math.round(ap.acum - ap.dupa),
        timp: rot(x.dupa.timpMediu, 2),
        sate30: sate30(x)
    };
});
scenarii.unshift({ cod: "azi", nume: "Azi, fără comasare", unitati: date.uat.length,
    sub3000: date.uat.filter(u => (u.pop || 0) < 3000).length, economie: 0,
    timp: rot(r.inainte.timpMediu, 2), sate30: r.sate.filter(s => s.tAcum > 30 && (s.p || 0) >= r.parametri.pSatMin).length });

// --- ipoteza biroului din sat: economia la primării pentru fiecare cotă, de la 0 la 50%
const cote = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map(c => [c, Math.round(economiePrimarii(c))]);

const iesire = {
    versiune: 1,
    generat: new Date().toISOString().slice(0, 10),
    nota: "Datele panoului de pe prima pagină, calculate cu regulile implicite (v2) de unelte/panou.js.",
    parametri: { pMin: r.parametri.pMin, pMinOras: r.parametri.pMinOras, tMax: r.parametri.tMax },
    national: {
        uat: [date.uat.length, r.dupa.unitati],
        subPrag: [r.inainte.subPrag, r.dupa.subPrag],
        mediana: [r.inainte.mediana, r.dupa.mediana],
        timp: [rot(r.inainte.timpMediu, 1), rot(r.dupa.timpMediu, 1)],
        pesteTMax: [r.inainte.pesteTMax, r.dupa.pesteTMax],
        sate: r.sate.length,
        districte: (r.districte || []).length,
        regiuni: date.adr.length,
        capitala: r.grupuri.filter(g => g.capitala).map(g => ({ preluate: g.membri.length - 1, populatie: g.populatie }))[0] || null,
        oameni: [Math.round(oameniAzi), Math.round(oameniDupa)]
    },
    alesi: alesi,
    bani: bani,
    retele: retele,
    curba: curba,
    judete: judete,
    regiuni: regiuni,
    variante: variante,
    scenarii: scenarii,
    cote: cote
};
const cale = path.join(RADACINA, "date", "panou.json");
fs.writeFileSync(cale, JSON.stringify(iesire));
const mld = v => (v / 1e9).toFixed(2);
console.log(`scris date/panou.json (${Math.round(fs.statSync(cale).size / 1024)} KB): ${iesire.national.uat.join(" → ")} unități, ` +
    `${judete.length} județe, ${regiuni.length} regiuni, ${variante.length} variante de regiuni`);
console.log(`bani: primării ${mld(bani.primarii)} + CJ ${mld(bani.cj)} + stat ${mld(bani.stat)} = ${mld(bani.total)} mld. lei ` +
    `(plaja ${mld(bani.plaja[0])}–${mld(bani.plaja[1])}); aleși ${alesi.total.join(" → ")}; oameni ${iesire.national.oameni.join(" → ")}`);
