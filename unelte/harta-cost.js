/* ============================================================================
   harta-cost.js — imaginea „Harta costului” de pe panou (img/harta-cost.jpg)

   Două hărți ale României, colorate după cât costă primăria pe fiecare
   locuitor, pe an: azi (pe UAT) și după comasare (pe unitate), cu media pe
   țară și legenda. Calculul e același ca pe hartă (js/adp-*.js); imaginea se
   randează cu Playwright (Chromium), deci scriptul îl cere instalat.

   Rulare:  node unelte/harta-cost.js     (din rădăcina proiectului)
   ========================================================================== */
"use strict";
const fs = require("fs"), path = require("path");
const R = path.resolve(__dirname, "..");
const json = p => JSON.parse(fs.readFileSync(path.join(R, p), "utf8"));
global.window = {};
["js/adp-topologie.js", "js/adp-reorganizare.js"].forEach(f => eval(fs.readFileSync(path.join(R, f), "utf8")));
const { AdpTopologie: T, AdpReorganizare: A } = global.window;
const date = json("date/romania-uat.json");
const topo = T.decodeaza(date);
const vecini = T.vecini(topo);
const exemple = json("date/judete/index.json").judete.map(j => json("date/" + j.fisier));
const alegeri = json("date/corectii-districte.json"), jud = json("date/judecatorii-uat.json"), fin = json("date/finante-uat.json");
const dotari = json("date/dotari-uat.json").localitati;
const ex = new Map(); date.uat.forEach((u, i) => { if (fin.executieUat[u.s]) ex.set(i, fin.executieUat[u.s]); });
const r = A.calculeazaNational(date, vecini, exemple, { executie: ex, dotari,
    corectii: A.alegeriCuCircumscriptii(jud, alegeri.corectii || []), comasari: alegeri.comasari || [], transferuri: alegeri.transferuri || [] });
const grup = i => r.grup.has(i) ? r.grup.get(i) : i;

// --- proiecția: echirectangulară, cu longitudinea scurtată la latitudinea medie
const [[la0, lo0], [la1, lo1]] = date.limite;
const k = Math.cos((la0 + la1) / 2 * Math.PI / 180);
const W = 620, H = W * (la1 - la0) / ((lo1 - lo0) * k);
const pr = (ox, oy) => ([la, lo]) => [ox + (lo - lo0) * k / ((lo1 - lo0) * k) * W, oy + (la1 - la) / (la1 - la0) * H];
const rot = v => Math.round(v * 10) / 10;
function cale(puncte, p) {
    let s = "", ult = "";
    puncte.forEach((pt, j) => { const [x, y] = p(pt); const c = rot(x) + " " + rot(y); if (c === ult) return; s += (j ? "L" : "M") + c; ult = c; });
    return s;
}

// --- culoarea: costul aparatului primăriei pe locuitor (lei pe an), azi pe UAT și după, pe unitate
const PRAGURI = [600, 800, 1000, 1300, 1700];
const PALETA = ["#80b2ee", "#5598e7", "#3480dc", "#2466b8", "#184f95", "#0d366b"];   // validată: ordinală, monotonă
const FARA = "#c9c7c1";
const clasa = v => v === null ? -1 : PRAGURI.filter(x => v >= x).length;
const costAzi = i => { const e = ex.get(i), p = date.uat[i].pop; return e && p ? e.cheltuieliAparat / p : null; };
const costUnitate = new Map();
r.grupuri.forEach(g => {
    // Capitala: aparatul Bucureștiului nu e în date, deci nici costul unității
    if (g.capitala) { costUnitate.set(g.sediu, null); return; }
    const c = A.aparatUnitate(g.membri, g.sediu, i => ex.get(i));
    const p = g.membri.filter(i => ex.get(i)).reduce((a, i) => a + (date.uat[i].pop || 0), 0);
    costUnitate.set(g.sediu, c && p ? c.dupa / p : null);
});
// media pe țară: aparatul tuturor primăriilor cu date, împărțit la locuitorii lor (azi și după comasare)
const cuDate = date.uat.map((u, i) => i).filter(i => ex.get(i));
const popCuDate = cuDate.reduce((a, i) => a + (date.uat[i].pop || 0), 0);
const medieAzi = cuDate.reduce((a, i) => a + ex.get(i).cheltuieliAparat, 0) / popCuDate;
const medieDupa = r.grupuri.reduce((a, g) => { const c = A.aparatUnitate(g.membri, g.sediu, i => ex.get(i)); return a + (c ? c.dupa : 0); }, 0) / popCuDate;
const culoareAzi = i => clasa(costAzi(i));
const culoareDupa = i => clasa(r.grup.has(i) ? costUnitate.get(r.grup.get(i)) : costAzi(i));

function harta(ox, oy, culoare, cheie) {
    const p = pr(ox, oy);
    const peCuloare = new Map();
    date.uat.forEach((u, i) => {
        const c = culoare(i);
        if (!peCuloare.has(c)) peCuloare.set(c, []);
        peCuloare.get(c).push(T.inele(topo, u).map(inel => cale(inel, p) + "Z").join(""));
    });
    let svg = "";
    peCuloare.forEach((d, c) => {
        const f = c < 0 ? FARA : PALETA[c];
        svg += `<path d="${d.join("")}" fill="${f}" stroke="${f}" stroke-width="0.4" stroke-linejoin="round"/>`;
    });
    const interior = [], exterior = [];
    topo.folosire.forEach((f, a) => {
        if (!f) return;
        if (f.length === 1) exterior.push(cale(topo.arce[a], p));
        else if (cheie(f[0]) !== cheie(f[1])) interior.push(cale(topo.arce[a], p));
    });
    svg += `<path d="${interior.join("")}" fill="none" stroke="#fcfcfb" stroke-width="${cheie === grup ? 0.8 : 0.4}" stroke-opacity="0.85" stroke-linejoin="round"/>`;
    svg += `<path d="${exterior.join("")}" fill="none" stroke="#0d366b" stroke-width="1.2" stroke-linejoin="round"/>`;
    return svg;
}

const L = 1400, IN = 590, MX = 40, OY = 84;
const nf = n => n.toLocaleString("ro-RO");
const ET = ["sub 600", "600–800", "800–1.000", "1.000–1.300", "1.300–1.700", "peste 1.700"];
// legenda: fiecare element e un <g class="leg">; se așază la randare, după lățimea reală a textului
const legenda = PALETA.map((c, k) => `<g class="leg"><rect x="0" y="${IN - 34}" width="20" height="20" rx="4" fill="${c}"/><text x="28" y="${IN - 18}" font-size="17">${ET[k]}</text></g>`).join("") +
    `<g class="leg"><rect x="0" y="${IN - 34}" width="20" height="20" rx="4" fill="${FARA}"/><text x="28" y="${IN - 18}" font-size="17" fill="#5f5e5a">fără date (București)</text></g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${IN}" viewBox="0 0 ${L} ${IN}">
<rect width="${L}" height="${IN}" fill="#fcfcfb"/>
<g font-family="Inter, system-ui, sans-serif" fill="#0b0b0b">
  <text x="${MX}" y="34" font-size="22" font-weight="600">Azi: <tspan font-weight="800">${nf(date.uat.length)}</tspan> de comune și orașe</text>
  <text x="${MX}" y="60" font-size="16" fill="#5f5e5a">primăria costă, în medie, ${nf(Math.round(medieAzi))} de lei pe locuitor pe an</text>
  <text x="${L - MX - W}" y="34" font-size="22" font-weight="600">Propus: <tspan font-weight="800">${nf(r.dupa.unitati)}</tspan> de unități</text>
  <text x="${L - MX - W}" y="60" font-size="16" fill="#5f5e5a">primăria costă, în medie, ${nf(Math.round(medieDupa))} de lei pe locuitor pe an</text>
</g>
${harta(MX, OY, culoareAzi, i => i)}
${harta(L - MX - W, OY, culoareDupa, grup)}
<g font-family="Inter, system-ui, sans-serif" fill="#0b0b0b">
  <text x="${L / 2}" y="${OY + H / 2 + 14}" font-size="40" text-anchor="middle" fill="#3480dc">→</text>
  <text id="leg-titlu" x="${MX}" y="${IN - 18}" font-size="17" font-weight="700">Cât costă primăria, lei pe locuitor pe an:</text>
  ${legenda}
</g>
</svg>`;

// randarea: Playwright așază legenda după lățimea textului și scrie imaginea
(async () => {
    const { chromium } = require("playwright");
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: L, height: IN }, deviceScaleFactor: 1.5 });
    await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await p.evaluate(() => {
        let x = document.getElementById("leg-titlu").getBBox();
        x = x.x + x.width + 18;
        document.querySelectorAll("g.leg").forEach(g => { g.setAttribute("transform", `translate(${x},0)`); x += g.getBBox().width + 16; });
    });
    const iesire = path.join(R, "img", "harta-cost.jpg");
    await p.screenshot({ path: iesire, type: "jpeg", quality: 84, clip: { x: 0, y: 0, width: L, height: IN } });
    await b.close();
    console.log(`scris img/harta-cost.jpg (${Math.round(fs.statSync(iesire).size / 1024)} KB): ${r.dupa.unitati} unități, ` +
        `${nf(Math.round(medieAzi))} → ${nf(Math.round(medieDupa))} lei pe locuitor`);
})();
