/* ============================================================================
   cifre.js — cifrele din sinteză care motivează regulile de comasare

   Rulează scenariul național implicit și variantele lui (fără o regulă, cu alt
   prag) cu aceleași module ca pagina (js/adp-*.js) și scrie cifrele pe care
   sinteza.html le citează la fiecare regulă și decizie. Restul cifrelor
   (aleși, oameni, derogările din fișele de județ, planul regional) se calculează
   pe loc în raport.html.

   Rulare:  node unelte/cifre.js         (din rădăcina proiectului)
            node unelte/cifre.js --v1    (parametrii regulilor v1, pentru comparație)
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const RADACINA = path.resolve(__dirname, "..");
const json = p => JSON.parse(fs.readFileSync(path.join(RADACINA, p), "utf8"));

// modulele paginii sunt scrise pentru browser: se încarcă pe un `window` fals (eval doar pe
// fișierele proiectului, ca în unelte/rezumat.js)
global.window = {};
["js/adp-topologie.js", "js/adp-reorganizare.js"]
    .forEach(f => eval(fs.readFileSync(path.join(RADACINA, f), "utf8")));
const { AdpTopologie, AdpReorganizare } = global.window;

// regulile v1 (19 octombrie 2026), pentru comparație
const V1 = {
    pMin: 5000, pTinta: 7000, pMinOras: 7000, pTintaOras: 9000,
    absorbtieUrbana: false, praguriLegale: true
};
const PRAG_LEADER = 20000;
const PRAG_FINANCIAR = AdpReorganizare.REGULA_FINANCIARA.prag;
const TINTA_LEI = AdpReorganizare.REGULA_FINANCIARA.tinta;

const date = json("date/romania-uat.json");
const vecini = AdpTopologie.vecini(AdpTopologie.decodeaza(date));
const exemple = json("date/judete/index.json").judete.map(j => json("date/" + j.fisier));
const alegeri = json("date/corectii-districte.json");
const judecatorii = json("date/judecatorii-uat.json");
const finante = json("date/finante-uat.json");
// farmaciile și oficiile poștale din registrele oficiale: intră în scorul de centralitate, ca pe hartă
const dotari = json("date/dotari-uat.json").localitati;

/** Execuția bugetară pe UAT, potrivită după nume, ca în raport (adp-raport.js). */
function indexeazaExecutia() {
    // potrivirea pe SIRUTA e făcută o singură dată, în unelte/finante.py
    const index = new Map();
    date.uat.forEach((u, i) => {
        if (finante.executieUat[u.s]) index.set(i, finante.executieUat[u.s]);
    });
    return index;
}
const executie = indexeazaExecutia();

const baza = process.argv.includes("--v1") ? V1 : {};
function ruleaza(extra) {
    return AdpReorganizare.calculeazaNational(date, vecini, exemple, Object.assign({
        districte: true, executie: executie, dotari: dotari,
        corectii: AdpReorganizare.alegeriCuCircumscriptii(judecatorii, alegeri.corectii || []),
        comasari: alegeri.comasari || [],
        transferuri: alegeri.transferuri || []
    }, baza, extra || {}));
}

const urban = i => date.uat[i].t !== "comună";
const satePeste = (r, min) => r.sate.filter(s => s.tNou > min && (s.p || 0) >= 50).length;

/** Costul aparatului după comasare, cu o cotă dată din aparatul primăriei desființate. */
function aparatDupa(r, cota) {
    let total = 0;
    r.grupuri.forEach(g => {
        const c = AdpReorganizare.aparatUnitate(g.membri, g.sediu, i => executie.get(i), cota);
        if (c) total += c.dupa;
    });
    return total;
}
const aparatAzi = Array.from(executie.values()).reduce((a, e) => a + (e.cheltuieliAparat || 0), 0);
const mld = v => Math.round(v / 1e8) / 10;

function urbane(r) {
    const cuComune = r.grupuri.filter(g => urban(g.sediu) && g.membri.some(i => !urban(i)));
    return {
        unitati: r.grupuri.filter(g => urban(g.sediu)).length,
        subPragOras: r.grupuri.filter(g => urban(g.sediu) && g.populatie < r.parametri.pMinOras).length,
        oraseCarePreiau: cuComune.length,
        comunePreluate: cuComune.reduce((a, g) => a + g.membri.filter(i => !urban(i)).length, 0),
        pesteLeader: cuComune.filter(g => g.populatie > PRAG_LEADER).length,
        comuneInAfaraLeader: cuComune.filter(g => g.populatie > PRAG_LEADER)
            .reduce((a, g) => a + g.membri.filter(i => !urban(i)).length, 0),
        oraseUnite: r.grupuri.filter(g => g.membri.filter(urban).length > 1)
            .map(g => g.membri.filter(urban).map(i => date.uat[i].n).join(" + "))
    };
}

const t0 = Date.now();
const r = ruleaza();
const P = r.parametri;
const fin = r.financiar;
// la testul de 30% și la curba costului intră doar execuțiile reale, nu estimările din curbă
const azi = Array.from(executie.entries()).filter(([, e]) => !e.estimat);
const cifre = {
    parametri: { pMin: P.pMin, pTinta: P.pTinta, pMinOras: P.pMinOras, pTintaOras: P.pTintaOras,
        pOrasAutonom: P.praguriLegale ? "pe rang" : P.pOrasAutonom, absorbtieUrbana: P.absorbtieUrbana, tMax: P.tMax },
    regula1: { unitati: [r.inainte.unitati, r.dupa.unitati], subPrag: [r.inainte.subPrag, r.dupa.subPrag],
        sub5000: [date.uat.filter(u => (u.pop || 0) < 5000).length, r.grupuri.filter(g => g.populatie < 5000).length],
        mediana: [r.inainte.mediana, r.dupa.mediana] },
    regula3: { pesteTMax: [r.inainte.pesteTMax, r.dupa.pesteTMax], peste20: satePeste(r, 20), peste45: satePeste(r, 45),
        timpMediu: [Math.round(r.inainte.timpMediu * 10) / 10, Math.round(r.dupa.timpMediu * 10) / 10] },
    regula5: urbane(r),
    regula6: { ruralePestePrag: r.grupuri.filter(g => !urban(g.sediu) && g.populatie > P.pMaxRural).length },
    regula7: {
        aziPeste: azi.filter(([, e]) => e.pondere !== null && e.pondere > PRAG_FINANCIAR).length, aziCuDate: azi.length,
        aziSubTinta: azi.filter(([i, e]) => date.uat[i].pop > 0 && e.cheltuieliAparat / date.uat[i].pop <= TINTA_LEI).length,
        dupa: fin
    },
    regula9: { cuDreptPastrat: r.grupuri.filter(g => g.riscMinoritate && g.riscMinoritate.length).length },
    regula12: { unitatiCuDerogare: r.grupuri.filter(g => g.derogari.length).length, unitati: r.grupuri.length },
    bani: { aparatAzi: mld(aparatAzi), dupa15: mld(aparatDupa(r, 0.15)), dupa25: mld(aparatDupa(r, 0.25)),
        dupa35: mld(aparatDupa(r, 0.35)) },
    districte: r.districte.length
};
cifre.bani.economie15 = mld(aparatAzi - aparatDupa(r, 0.15));
cifre.bani.economie25 = mld(aparatAzi - aparatDupa(r, 0.25));
cifre.bani.economie35 = mld(aparatAzi - aparatDupa(r, 0.35));

// regula 3: cu altă limită de drum, câte sate rămân dincolo de ea
cifre.regula3.cuLimita20 = ruleaza({ tMax: 20 }).dupa.pesteTMax;
cifre.regula3.cuLimita45 = ruleaza({ tMax: 45 }).dupa.pesteTMax;
// regula 2: fără pragul pe populația proiectată
const fara2 = ruleaza({ proiectie: false });
cifre.regula2 = { subPrag2050: [fara2.dupa.subPrag2050, r.dupa.subPrag2050], unitati: [fara2.dupa.unitati, r.dupa.unitati] };
// regula 6: fără plafonul unității rurale
const fara6 = ruleaza({ pMaxRural: 1e9 });
cifre.regula6.faraPlafon = fara6.grupuri.filter(g => !urban(g.sediu) && g.populatie > P.pMaxRural).length;
cifre.regula6.unitatiFaraPlafon = fara6.dupa.unitati;
// regula 9: dacă pragul minorităților ar bloca comasarea
const bloc = ruleaza({ regimMinoritati: "blocheaza" });
cifre.regula9.subPragDacaBlocheaza = bloc.dupa.subPrag;
// regula 5: ce schimbă preluarea comunelor de către orașele mici
const faraPreluare = ruleaza({ absorbtieUrbana: !P.absorbtieUrbana });
cifre.regula5.altaVarianta = {
    absorbtieUrbana: !P.absorbtieUrbana, unitati: faraPreluare.dupa.unitati,
    economie25: mld(aparatAzi - aparatDupa(faraPreluare, 0.25)),
    timpMediu: Math.round(faraPreluare.dupa.timpMediu * 10) / 10, pesteTMax: faraPreluare.dupa.pesteTMax,
    ...urbane(faraPreluare), unitatiTotal: faraPreluare.dupa.unitati
};
// regula 5: cu varianta cealaltă pentru unirea orașelor între ele, la forțare
const faraUniri = ruleaza({ uniriUrbane: !P.uniriUrbane });
cifre.regula5.altaUnire = {
    uniriUrbane: !P.uniriUrbane, ...urbane(faraUniri), unitatiTotal: faraUniri.dupa.unitati,
    subPrag: faraUniri.dupa.subPrag, economie25: mld(aparatAzi - aparatDupa(faraUniri, 0.25)),
    timpMediu: Math.round(faraUniri.dupa.timpMediu * 10) / 10, pesteTMax: faraUniri.dupa.pesteTMax };
cifre.regula5.altaUnire.exempleUniri = cifre.regula5.altaUnire.oraseUnite.slice(0, 6);
cifre.regula5.altaUnire.oraseUnite = cifre.regula5.altaUnire.oraseUnite.length;
if (P.pastreazaLeader) {
    const faraLeader = ruleaza({ pastreazaLeader: false });
    cifre.regula5.faraPlafonLeader = urbane(faraLeader);
    cifre.regula5.faraPlafonLeader.economie25 = mld(aparatAzi - aparatDupa(faraLeader, 0.25));
}
// curba costului: aparatul pe locuitor și din veniturile proprii, pe clase de mărime (sumă / sumă)
cifre.curba = [[0, 1500], [1500, 3000], [3000, 5000], [5000, 7000], [7000, 10000], [10000, 20000],
    [20000, 50000], [50000, Infinity]].map(([de, pana]) => {
    const x = azi.filter(([i]) => date.uat[i].pop >= de && date.uat[i].pop < pana);
    const suma = f => x.reduce((a, [i, e]) => a + f(i, e), 0);
    return {
        clasa: [de, pana === Infinity ? null : pana], primarii: x.length,
        leiPeLocuitor: Math.round(suma((i, e) => e.cheltuieliAparat) / suma(i => date.uat[i].pop)),
        dinVenituri: Math.round(100 * suma((i, e) => e.cheltuieliAparat) / suma((i, e) => e.venituriProprii)),
        pestePrag: Math.round(100 * x.filter(([, e]) => e.pondere > PRAG_FINANCIAR).length / x.length)
    };
});
// districtele: cele sub pragul de 25.000, înainte și după ajustare
cifre.districteDetalii = {
    numar: r.districte.length,
    cuPrimite: r.districte.filter(d => d.primite && d.primite.length).map(d => `${d.numeResedinta}: ${d.primite.join(", ")}`),
    celMaiMic: r.districte.reduce((a, d) => !a || d.populatie < a.populatie ? d : a, null)
};
cifre.districteDetalii.celMaiMic = { nume: cifre.districteDetalii.celMaiMic.nume, populatie: cifre.districteDetalii.celMaiMic.populatie };
cifre.secunde = Math.round((Date.now() - t0) / 100) / 10;
console.log(JSON.stringify(cifre, null, 1));
