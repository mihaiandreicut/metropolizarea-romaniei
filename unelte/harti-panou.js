/* ============================================================================
   harti-panou.js — hărțile mici din zona „Simulări” a panoului (img/panou/)

   Câte o hartă pentru fiecare simulare de pe prima pagină, desenată din
   aceleași date și cu aceleași module ca harta (js/adp-*.js):
     * regiunile: azi (41 de județe și București), cele 8 de dezvoltare,
       curțile de apel cu Metropola, 12 regiuni calculate;
     * comasarea: toată țara (1.441 de unități), un județ (Brașov), Capitala
       cu UAT-urile pe care le preia.
   Imaginile se randează cu Playwright (Chromium), deci scriptul îl cere instalat.

   Rulare:  node unelte/harti-panou.js     (din rădăcina proiectului)
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const R = path.resolve(__dirname, "..");
const json = p => JSON.parse(fs.readFileSync(path.join(R, p), "utf8"));

// modulele paginii sunt scrise pentru browser: se încarcă pe un `window` fals (doar fișierele proiectului)
global.window = {};
["js/adp-topologie.js", "js/adp-reorganizare.js", "js/adp-regionalizare.js"]
    .forEach(f => eval(fs.readFileSync(path.join(R, f), "utf8")));
const { AdpTopologie: T, AdpReorganizare: A, AdpRegionalizare: G } = global.window;

const date = json("date/romania-uat.json");
const topo = T.decodeaza(date);
const vecini = T.vecini(topo);
const exemple = json("date/judete/index.json").judete.map(j => json("date/" + j.fisier));
const alegeri = json("date/corectii-districte.json"), jud = json("date/judecatorii-uat.json");
const fin = json("date/finante-uat.json"), dotari = json("date/dotari-uat.json").localitati;
const inst = json("date/regiuni-institutii.json");
const ex = new Map();
date.uat.forEach((u, i) => { if (fin.executieUat[u.s]) ex.set(i, fin.executieUat[u.s]); });
const r = A.calculeazaNational(date, vecini, exemple, { executie: ex, dotari,
    corectii: A.alegeriCuCircumscriptii(jud, alegeri.corectii || []), comasari: alegeri.comasari || [], transferuri: alegeri.transferuri || [] });
const grup = i => r.grup.has(i) ? r.grup.get(i) : i;

// paleta categorială a site-ului (css/adp-tema.css, --serie-1…8), în ordinea fixă
const PALETA = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const FUNDAL = "#fcfcfb", NEUTRU = "#dcdad3", CONTUR = "#0b0b0b";

/** Colorează o împărțire: cheie(i) dă grupul UAT-ului i; vecinii din grupuri diferite primesc culori diferite. */
function culori(indecsi, cheie) {
    const grupuri = Array.from(new Set(indecsi.map(cheie)));
    const vec = new Map(grupuri.map(g => [g, new Set()]));
    indecsi.forEach(i => vecini[i].forEach(j => { const a = cheie(i), b = cheie(j); if (a !== b && vec.has(b)) vec.get(a).add(b); }));
    return T.coloreaza(grupuri, g => Array.from(vec.get(g)), (a, b) => a !== b, PALETA.length);
}

/**
 * O hartă SVG: `indecsi` — UAT-urile desenate (restul nu apar), `culoare(i)` — umplerea,
 * `cheie(i)` — granițele groase (între grupuri), `cheieFina(i)` — granițele subțiri.
 */
function harta({ indecsi, culoare, cheie, cheieFina, L, H, eticheta, grosime }) {
    const set = new Set(indecsi);
    let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
    indecsi.forEach(i => T.inele(topo, date.uat[i]).forEach(inel => inel.forEach(([la, lo]) => {
        if (la < la0) la0 = la; if (la > la1) la1 = la; if (lo < lo0) lo0 = lo; if (lo > lo1) lo1 = lo;
    })));
    const k = Math.cos((la0 + la1) / 2 * Math.PI / 180);
    const m = 10;
    const scara = Math.min((L - 2 * m) / ((lo1 - lo0) * k), (H - 2 * m) / (la1 - la0));
    const ox = (L - (lo1 - lo0) * k * scara) / 2, oy = (H - (la1 - la0) * scara) / 2;
    const p = ([la, lo]) => [ox + (lo - lo0) * k * scara, oy + (la1 - la) * scara];
    const rot = v => Math.round(v * 10) / 10;
    const cale = pts => {
        let s = "", ult = "";
        pts.forEach((pt, j) => { const [x, y] = p(pt); const c = rot(x) + " " + rot(y); if (c === ult) return; s += (j ? "L" : "M") + c; ult = c; });
        return s;
    };
    const peCuloare = new Map();
    indecsi.forEach(i => {
        const c = culoare(i);
        if (!peCuloare.has(c)) peCuloare.set(c, []);
        peCuloare.get(c).push(T.inele(topo, date.uat[i]).map(inel => cale(inel) + "Z").join(""));
    });
    let svg = "";
    peCuloare.forEach((d, c) => { svg += `<path d="${d.join("")}" fill="${c}" stroke="${c}" stroke-width="0.4" stroke-linejoin="round"/>`; });
    const groase = [], fine = [], exterior = [];
    topo.folosire.forEach((f, a) => {
        if (!f) return;
        const inauntru = f.filter(i => set.has(i));
        if (!inauntru.length) return;
        if (inauntru.length === 1) { exterior.push(cale(topo.arce[a])); return; }
        if (cheie(f[0]) !== cheie(f[1])) groase.push(cale(topo.arce[a]));
        else if (cheieFina && cheieFina(f[0]) !== cheieFina(f[1])) fine.push(cale(topo.arce[a]));
    });
    svg += `<path d="${fine.join("")}" fill="none" stroke="${FUNDAL}" stroke-width="0.5" stroke-opacity="0.8" stroke-linejoin="round"/>`;
    svg += `<path d="${groase.join("")}" fill="none" stroke="${FUNDAL}" stroke-width="${grosime || 1.6}" stroke-linejoin="round"/>`;
    svg += `<path d="${exterior.join("")}" fill="none" stroke="${CONTUR}" stroke-width="1" stroke-linejoin="round"/>`;
    const text = (eticheta || []).map(e => {
        const [x, y] = p(e.e);
        return `<text x="${rot(x)}" y="${rot(y)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${e.marime || 13}"
            font-weight="700" fill="${CONTUR}" stroke="${FUNDAL}" stroke-width="3" paint-order="stroke">${e.text}</text>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${H}" viewBox="0 0 ${L} ${H}"><rect width="${L}" height="${H}" fill="${FUNDAL}"/>${svg}${text}</svg>`;
}

const toate = date.uat.map((u, i) => i);
const harti = {};

// --- regiunile: din aceleași variante ca pe hartă și în panou
const pj = G.pregatesteJudete(date, vecini, inst);
const variante = {
    "regiuni-judete": G.judeteAzi(pj.judete, inst.sisteme),
    "regiuni-adr": G.dinCircumscriptii(pj.judete, pj.vecini, inst.sisteme, "adr"),
    "regiuni-curti-apel": G.dinCircumscriptii(pj.judete, pj.vecini, inst.sisteme, "curte-apel"),
    "regiuni-calculate": G.calculeaza(pj.judete, pj.vecini, inst.sisteme, { nrRegiuni: 12 })
};
Object.entries(variante).forEach(([nume, v]) => {
    const reg = i => { const c = v.judetRegiune.get(date.uat[i].j); return c === undefined ? -1 : c; };
    const sloturi = culori(toate, reg);
    harti[nume] = harta({ indecsi: toate, L: 480, H: 340, cheie: reg, cheieFina: i => date.uat[i].j,
        culoare: i => reg(i) < 0 ? NEUTRU : PALETA[sloturi.get(reg(i))] });
});

// --- comasarea: toată țara, un județ, Capitala
{
    const sloturi = culori(toate, grup);
    harti["comasare-tara"] = harta({ indecsi: toate, L: 480, H: 340, cheie: grup, grosime: 0.6, culoare: i => PALETA[sloturi.get(grup(i))] });
}
{
    const brasov = toate.filter(i => date.uat[i].j === 8);
    const sloturi = culori(brasov, grup);
    harti["comasare-judet"] = harta({ indecsi: brasov, L: 480, H: 340, cheie: grup, cheieFina: i => i,
        culoare: i => PALETA[sloturi.get(grup(i))] });
}
{
    const cap = r.grupuri.find(g => g.capitala);
    const zona = toate.filter(i => date.uat[i].j === 23 || date.uat[i].j === 40);
    const inCap = new Set(cap ? cap.membri : []);
    const sloturi = culori(zona.filter(i => !inCap.has(i)), grup);
    harti["capitala"] = harta({ indecsi: zona, L: 480, H: 340, cheie: grup, cheieFina: i => i,
        culoare: i => inCap.has(i) ? (i === cap.sediu ? "#1c5cab" : "#2a78d6") : ["#cde2fb", "#e8f1fc", "#dfeaf7", "#d3e2f5"][sloturi.get(grup(i)) % 4],
        eticheta: cap ? [{ e: date.uat[cap.sediu].e, text: `București + ${cap.membri.length - 1}`, marime: 16 }] : [] });
}

// --- randarea
(async () => {
    const { chromium } = require("playwright");
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 480, height: 340 }, deviceScaleFactor: 2 });
    const dir = path.join(R, "img", "panou");
    fs.mkdirSync(dir, { recursive: true });
    for (const [nume, svg] of Object.entries(harti)) {
        await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
        const iesire = path.join(dir, nume + ".jpg");
        await p.screenshot({ path: iesire, type: "jpeg", quality: 84, clip: { x: 0, y: 0, width: 480, height: 340 } });
        console.log(`scris img/panou/${nume}.jpg (${Math.round(fs.statSync(iesire).size / 1024)} KB)`);
    }
    await b.close();
})();
