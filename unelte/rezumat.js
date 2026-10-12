/* ============================================================================
   rezumat.js — cifrele proiectului, scrise în date/rezumat.json

   Rulează scenariul național cu parametrii impliciți, nivelul intermediar și
   simularea regională, folosind exact aceleași module ca pagina (js/adp-*.js),
   ca să nu existe două implementări ale aceluiași calcul. Rezultatul e citit de
   panoul live din Claude Code și de oricine vrea cifrele fără să deschidă harta.

   Rulare:  node unelte/rezumat.js        (din rădăcina proiectului)
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const RADACINA = path.resolve(__dirname, "..");
const cale = (...p) => path.join(RADACINA, ...p);
const json = p => JSON.parse(fs.readFileSync(cale(p), "utf8"));

// modulele paginii sunt scrise pentru browser: se încarcă pe un `window` fals
global.window = {};
["js/adp-topologie.js", "js/adp-reorganizare.js", "js/adp-regionalizare.js"]
    .forEach(f => eval(fs.readFileSync(cale(f), "utf8")));
const { AdpTopologie, AdpReorganizare, AdpRegionalizare } = global.window;

function scenariuNational(date, vecini) {
    const index = json("date/judete/index.json");
    const exemple = index.judete.map(j => json("date/" + j.fisier));
    // alegerile voluntare făcute pe hartă intră și în cifrele panoului
    const fisierAlegeri = fs.existsSync(cale("date/corectii-districte.json"))
        ? json("date/corectii-districte.json") : {};
    const alegeri = fisierAlegeri.corectii || [];
    const judecatorii = fs.existsSync(cale("date/judecatorii-uat.json")) ? json("date/judecatorii-uat.json") : null;
    const r = AdpReorganizare.calculeazaNational(date, vecini, exemple, {
        districte: true, corectii: AdpReorganizare.alegeriCuCircumscriptii(judecatorii, alegeri),
        comasari: fisierAlegeri.comasari || []
    });
    const birouri = r.grupuri.reduce((a, g) => a + g.birouri.length, 0);
    return {
        judete: r.judete.length,
        parametri: {
            pMin: r.parametri.pMin, pTinta: r.parametri.pTinta,
            pMinOras: r.parametri.pMinOras, tMax: r.parametri.tMax
        },
        unitati: { inainte: r.inainte.unitati, dupa: r.dupa.unitati },
        subPrag: { inainte: r.inainte.subPrag, dupa: r.dupa.subPrag },
        mediana: { inainte: r.inainte.mediana, dupa: r.dupa.mediana },
        timpMediu: { inainte: r.inainte.timpMediu, dupa: r.dupa.timpMediu },
        pesteTMax: { inainte: r.inainte.pesteTMax, dupa: r.dupa.pesteTMax },
        sate: r.sate.length,
        birouri: birouri,
        // cheile rămân „plasi”, cum le citește panoul live; conținutul sunt districtele
        plasi: r.districte ? r.districte.length : null,
        plasiSubRegula: r.districte ? r.districte.filter(p => !p.respectaRegula).length : null
    };
}

function scenariuRegional(date, vecini) {
    if (!fs.existsSync(cale("date/regiuni-institutii.json"))) return null;
    const inst = json("date/regiuni-institutii.json");
    const ecoJud = new Map(inst.judete.map(j => [j.c, j]));
    const dupaNuts = new Map(inst.regiuni.map(r => [r.cod, r]));
    const judete = date.judete.map(j => {
        const uats = date.uat.filter(u => u.j === j.c);
        const resedinta = uats.find(u => u.r) || uats[0];
        const e = ecoJud.get(j.c) || {};
        const nuts2 = dupaNuts.get((e.nuts || "").slice(0, 4));
        return {
            c: j.c, nume: j.n, auto: j.auto, adr: j.adr, ist: uats[0].ist,
            populatie: uats.reduce((a, u) => a + (u.p21 || 0), 0),
            suprafata: uats.reduce((a, u) => a + (u.a || 0), 0),
            centru: e.centru, pibTotal: e.pibTotal, pibLoc: e.pibLoc,
            euroPeOra: nuts2 ? nuts2.euroPeOra : null,
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
    const veciniJudet = new Map(Array.from(seturi, ([k, v]) => [k, Array.from(v)]));
    const r = AdpRegionalizare.calculeaza(judete, veciniJudet, inst.sisteme, {});
    const I = r.indicatori;
    return {
        regiuni: I.nrRegiuni,
        populatieMedie: Math.round(I.populatieMedie),
        raportPopulatie: I.raportPopulatie,
        raportPibLoc: I.raportPibLoc,
        minuteMediu: I.minuteMediu,
        capitaleCuCurteDeApel: I.capitaleCuCurteDeApel,
        oficiiJudetene: I.oficiiJudetene
    };
}

function stareaDatelor() {
    const fisiere = {
        "harta UAT": "date/romania-uat.json",
        "localități": "date/localitati.json",
        "regiuni tematice": "date/regiuni-tematice.json",
        "instituții regionale": "date/regiuni-institutii.json",
        "finanțe (MF)": "date/finante-uat.json",
        "infrastructură (INS)": "date/infrastructura-uat.json"
    };
    const stare = {};
    Object.entries(fisiere).forEach(([nume, f]) => {
        const p = cale(f);
        stare[nume] = fs.existsSync(p)
            ? { octeti: fs.statSync(p).size, actualizat: fs.statSync(p).mtime.toISOString().slice(0, 10) }
            : null;
    });
    const dirJudete = cale("date/judete");
    stare["județe cu timpi OSRM"] = fs.existsSync(dirJudete)
        ? { numar: fs.readdirSync(dirJudete).filter(f => f.endsWith(".json") && f !== "index.json").length }
        : null;
    return stare;
}

function status() {
    const p = cale("STATUS.md");
    if (!fs.existsSync(p)) return null;
    const text = fs.readFileSync(p, "utf8");
    const camp = nume => (text.match(new RegExp("^" + nume + ":\\s*(.+)$", "m")) || [])[1] || null;
    const noutati = text.split("## Ce e nou")[1] || "";
    return {
        stare: camp("status"),
        progres: Number(camp("progres")) || null,
        urmeaza: camp("next"),
        ultima: (noutati.match(/^- (.+)$/m) || [])[1] || null
    };
}

function principal() {
    const t0 = Date.now();
    const date = json("date/romania-uat.json");
    const vecini = AdpTopologie.vecini(AdpTopologie.decodeaza(date));
    const rezumat = {
        generat: new Date().toISOString(),
        secunde: null,
        status: status(),
        date: stareaDatelor(),
        national: scenariuNational(date, vecini),
        regional: scenariuRegional(date, vecini)
    };
    rezumat.secunde = Math.round((Date.now() - t0) / 100) / 10;
    fs.writeFileSync(cale("date/rezumat.json"), JSON.stringify(rezumat, null, 1), "utf8");
    console.log(`scris date/rezumat.json în ${rezumat.secunde} s: ` +
        `${rezumat.national.unitati.inainte} → ${rezumat.national.unitati.dupa} unități, ` +
        `${rezumat.national.plasi} districte, ${rezumat.regional ? rezumat.regional.regiuni : "—"} regiuni`);
}

principal();
