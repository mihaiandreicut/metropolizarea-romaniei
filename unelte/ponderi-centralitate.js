/* ============================================================================
   ponderi-centralitate.js — cât de mult contează ponderile scorului de centralitate

   Scorul de centralitate al unei reședințe de azi (adp-reorganizare.js) adună
   patru lucruri: locuitorii la sub 15 minute, nivelul școlii, tipurile de
   servicii (OpenStreetMap + farmacii și oficii poștale din registrele oficiale)
   și statutul de oraș. El hotărăște ordinea în care se nasc nucleele rurale.

   Scriptul rulează scenariul pe toată țara pentru fiecare combinație de ponderi
   (fiecare la jumătate, la fel, dublă) și măsoară ce iese: unitățile, drumul
   mediu, satele la peste 30 de minute, derogările, economia și câte UAT-uri
   ajung în altă unitate decât cu ponderile de bază. Scrie rezultatul în
   date/ponderi-centralitate.json; metodologia citează de aici.

   Rulare:  node unelte/ponderi-centralitate.js      (din rădăcina proiectului; câteva minute)
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const RADACINA = path.resolve(__dirname, "..");
const json = p => JSON.parse(fs.readFileSync(path.join(RADACINA, p), "utf8"));

// modulele paginii sunt scrise pentru browser: se încarcă pe un `window` fals (doar fișierele proiectului)
global.window = {};
["js/adp-topologie.js", "js/adp-reorganizare.js"]
    .forEach(f => eval(fs.readFileSync(path.join(RADACINA, f), "utf8")));
const { AdpTopologie, AdpReorganizare } = global.window;

const date = json("date/romania-uat.json");
const vecini = AdpTopologie.vecini(AdpTopologie.decodeaza(date));
const exemple = json("date/judete/index.json").judete.map(j => json("date/" + j.fisier));
const alegeri = json("date/corectii-districte.json");
const judecatorii = json("date/judecatorii-uat.json");
const finante = json("date/finante-uat.json");
const dotari = json("date/dotari-uat.json").localitati;
const executie = new Map();
date.uat.forEach((u, i) => { if (finante.executieUat[u.s]) executie.set(i, finante.executieUat[u.s]); });
const aparatAzi = Array.from(executie.values()).reduce((a, e) => a + (e.cheltuieliAparat || 0), 0);

const BAZA = AdpReorganizare.PARAMETRI_IMPLICITI.ponderiCentralitate;
const FACTORI = [0.5, 1, 2];

function ruleaza(ponderi) {
    const r = AdpReorganizare.calculeazaNational(date, vecini, exemple, {
        executie: executie, dotari: dotari, ponderiCentralitate: ponderi,
        corectii: AdpReorganizare.alegeriCuCircumscriptii(judecatorii, alegeri.corectii || []),
        comasari: alegeri.comasari || [],
        transferuri: alegeri.transferuri || []
    });
    const aparatDupa = r.grupuri.reduce((a, g) => {
        const c = AdpReorganizare.aparatUnitate(g.membri, g.sediu, i => executie.get(i));
        return a + (c ? c.dupa : 0);
    }, 0);
    return {
        r: r,
        unitati: r.dupa.unitati,
        subPrag: r.dupa.subPrag,
        timpMediu: Math.round(r.dupa.timpMediu * 100) / 100,
        pesteTMax: r.dupa.pesteTMax,
        derogari: r.grupuri.filter(g => g.derogari.length).length,
        economie: Math.round((aparatAzi - aparatDupa) / 1e6)
    };
}

/** Câte UAT-uri ajung în altă unitate decât în varianta de bază (aceeași unitate = aceiași colegi). */
function diferite(r, baza) {
    const colegi = rez => {
        const m = new Map();
        rez.grupuri.forEach(g => { const cheie = g.membri.slice().sort((a, b) => a - b).join(","); g.membri.forEach(i => m.set(i, cheie)); });
        return m;
    };
    const a = colegi(baza), b = colegi(r);
    let n = 0;
    a.forEach((cheie, i) => { if (b.get(i) !== cheie) n++; });
    return n;
}

const t0 = Date.now();
const baza = ruleaza(BAZA);
const variante = [];
const chei = Object.keys(BAZA);
// toate combinațiile: fiecare pondere la jumătate, la fel sau dublă (3^4 = 81)
const combinatii = [[]];
chei.forEach(() => {
    const noi = [];
    combinatii.forEach(c => FACTORI.forEach(f => noi.push(c.concat([f]))));
    combinatii.length = 0;
    noi.forEach(c => combinatii.push(c));
});
combinatii.forEach((factori, k) => {
    const ponderi = {};
    chei.forEach((c, j) => { ponderi[c] = BAZA[c] * factori[j]; });
    const x = factori.every(f => f === 1) ? baza : ruleaza(ponderi);
    variante.push(Object.assign({ factori: Object.fromEntries(chei.map((c, j) => [c, factori[j]])) },
        { unitati: x.unitati, subPrag: x.subPrag, timpMediu: x.timpMediu, pesteTMax: x.pesteTMax,
            derogari: x.derogari, economie: x.economie, uatDiferite: x === baza ? 0 : diferite(x.r, baza.r) }));
    if ((k + 1) % 9 === 0) process.stderr.write(`${k + 1}/${combinatii.length} variante, ${Math.round((Date.now() - t0) / 1000)} s\n`);
});
// fiecare pondere scoasă de tot: cât contează componenta
const fara = chei.map(c => {
    const ponderi = Object.assign({}, BAZA, { [c]: 0 });
    const x = ruleaza(ponderi);
    return { fara: c, unitati: x.unitati, timpMediu: x.timpMediu, pesteTMax: x.pesteTMax, derogari: x.derogari,
        economie: x.economie, uatDiferite: diferite(x.r, baza.r) };
});

const plaja = camp => [Math.min(...variante.map(v => v[camp])), Math.max(...variante.map(v => v[camp]))];
const iesire = {
    versiune: 1,
    generat: new Date().toISOString().slice(0, 10),
    nota: "Sensibilitatea scenariului național la ponderile scorului de centralitate: fiecare pondere la 0,5×, 1× și 2× " +
        "din valoarea de bază (81 de combinații), plus fiecare componentă scoasă de tot. „uatDiferite” = câte UAT-uri " +
        "ajung în altă unitate decât cu ponderile de bază.",
    ponderiBaza: BAZA,
    baza: { unitati: baza.unitati, subPrag: baza.subPrag, timpMediu: baza.timpMediu, pesteTMax: baza.pesteTMax,
        derogari: baza.derogari, economie: baza.economie },
    plaja: { unitati: plaja("unitati"), timpMediu: plaja("timpMediu"), pesteTMax: plaja("pesteTMax"),
        derogari: plaja("derogari"), economie: plaja("economie"), uatDiferite: plaja("uatDiferite") },
    fara: fara,
    variante: variante
};
fs.writeFileSync(path.join(RADACINA, "date", "ponderi-centralitate.json"), JSON.stringify(iesire, null, 1));
console.log(`baza: ${JSON.stringify(iesire.baza)}`);
console.log(`plaja pe 81 de combinații: ${JSON.stringify(iesire.plaja)}`);
fara.forEach(x => console.log(`fără ${x.fara}: ${JSON.stringify(x)}`));
const bune = variante.slice().sort((a, b) => a.pesteTMax - b.pesteTMax || a.timpMediu - b.timpMediu || b.economie - a.economie).slice(0, 5);
console.log("cele mai bune 5 (sate peste 30 min, apoi drum mediu, apoi economie):");
bune.forEach(v => console.log("  " + JSON.stringify(v)));
console.log(`scris date/ponderi-centralitate.json în ${Math.round((Date.now() - t0) / 1000)} s`);
