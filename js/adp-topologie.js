/* ============================================================================
   e-ro-adp — decodarea topologiei UAT (date/romania-uat.json)

   Fișierul de date ține fiecare graniță o singură dată („arc”), cuantizată
   și codificată delta; un UAT e o listă de inele, fiecare inel o listă de
   referințe la arce (index negativ ~i = arcul i parcurs invers). Așa, limitele
   de județ / regiune se obțin fără geometrie suplimentară: sunt arcele ale
   căror două UAT-uri vecine au chei diferite (plasa, „mesh”).

   Folosit de: adp-aplicatie.js (pregătește inelele și plasele pentru hartă),
   extensiile hărții (contururi, vecinătăți) și adp-metodologie.js — toate îl
   primesc prin parametri. Modul independent: calcul pur, fără DOM, fără Leaflet.
   ========================================================================== */
window.AdpTopologie = function() {
    "use strict";

    const ZECIMALE = 5;

    /** Decodifică arcele în liste de [lat, lng] și indexează folosirea lor. */
    function decodeaza(date) {
        const q = date.cuanta;
        const [x0, y0] = date.origine;
        const factor = Math.pow(10, ZECIMALE);
        const arce = date.arce.map(cod => {
            const puncte = [];
            let x = 0;
            let y = 0;
            for (let k = 0; k < cod.length; k += 2) {
                x += cod[k];
                y += cod[k + 1];
                puncte.push([
                    Math.round((y0 + y) * q * factor) / factor,
                    Math.round((x0 + x) * q * factor) / factor
                ]);
            }
            return puncte;
        });
        // arc -> UAT-urile care îl folosesc (1 = contur de țară, 2 = graniță internă)
        const folosire = new Array(arce.length);
        date.uat.forEach((u, idx) => {
            u.i.forEach(inel => inel.forEach(ref => {
                const a = ref < 0 ? ~ref : ref;
                (folosire[a] || (folosire[a] = [])).push(idx);
            }));
        });
        return { arce: arce, folosire: folosire, uat: date.uat };
    }

    /** Inelele unui UAT ca liste de [lat, lng] (pentru L.polygon, regula even-odd). */
    function inele(topo, u) {
        return u.i.map(inel => {
            const puncte = [];
            inel.forEach((ref, k) => {
                const arc = ref < 0 ? topo.arce[~ref].slice().reverse() : topo.arce[ref];
                // capătul unui arc e începutul următorului — nu se dublează
                for (let j = k === 0 ? 0 : 1; j < arc.length; j++) puncte.push(arc[j]);
            });
            return puncte;
        });
    }

    /**
     * Plasa de limite pentru o împărțire: arcele unde cheia diferă de o parte
     * și de alta. `exterior` adaugă și conturul țării.
     */
    function plasa(topo, cheie, exterior) {
        const rez = [];
        topo.folosire.forEach((uatUri, a) => {
            if (!uatUri) return;
            if (uatUri.length === 1) {
                if (exterior) rez.push(topo.arce[a]);
                return;
            }
            if (cheie(topo.uat[uatUri[0]]) !== cheie(topo.uat[uatUri[1]])) rez.push(topo.arce[a]);
        });
        return rez;
    }

    /**
     * Conturul unei mulțimi de UAT-uri (ex. o regiune tematică): arcele cu un
     * membru de o parte și un nemembru (sau granița țării) de cealaltă.
     * Spre deosebire de `plasa`, mulțimile se pot suprapune — fiecare are conturul ei.
     */
    function contur(topo, esteMembru) {
        const rez = [];
        topo.folosire.forEach((uatUri, a) => {
            if (!uatUri) return;
            const m0 = esteMembru(uatUri[0]);
            const m1 = uatUri.length === 2 ? esteMembru(uatUri[1]) : false;
            if (m0 !== m1) rez.push(topo.arce[a]);
        });
        return rez;
    }

    /** Lista de vecini (indecși) pentru fiecare UAT, prin granițe comune. */
    function vecini(topo) {
        const v = topo.uat.map(() => new Set());
        topo.folosire.forEach(uatUri => {
            if (uatUri && uatUri.length === 2 && uatUri[0] !== uatUri[1]) {
                v[uatUri[0]].add(uatUri[1]);
                v[uatUri[1]].add(uatUri[0]);
            }
        });
        return v.map(s => Array.from(s));
    }

    /**
     * Colorarea hărții: fiecare nod primește un slot de culoare, astfel încât doi
     * vecini să nu aibă același slot și, pe cât posibil, nici o pereche greu de
     * distins. Ordinea e de tip DSATUR (Brélaz 1979) — întâi nodul cu cei mai mulți
     * vecini deja colorați — ca să meargă și pe mia de unități a unui scenariu național.
     *
     * @param noduri       lista nodurilor de colorat
     * @param vecinii      fn(nod) -> [noduri vecine]
     * @param perecheBuna  fn(slotA, slotB) -> dacă cele două culori pot sta alături
     * @param nrSloturi    câte culori sunt disponibile (implicit 8)
     * @return Map nod -> slot
     */
    function coloreaza(noduri, vecinii, perecheBuna, nrSloturi) {
        const n = nrSloturi || 8;
        const bune = perecheBuna || ((a, b) => a !== b);
        const ad = new Map(noduri.map(x => [x, new Set()]));
        noduri.forEach(x => vecinii(x).forEach(y => {
            if (ad.has(y) && y !== x) {
                ad.get(x).add(y);
                ad.get(y).add(x);
            }
        }));
        const col = new Map();
        const folosite = new Array(n).fill(0);
        const ramase = noduri.slice().sort((a, b) => ad.get(b).size - ad.get(a).size);
        const saturatie = new Map(ramase.map(x => [x, 0]));
        while (ramase.length) {
            let k = 0;
            for (let i = 1; i < ramase.length; i++) {
                if (saturatie.get(ramase[i]) > saturatie.get(ramase[k])) k = i;
            }
            const x = ramase.splice(k, 1)[0];
            const vecineColorate = Array.from(ad.get(x)).filter(y => col.has(y)).map(y => col.get(y));
            const sloturi = Array.from({ length: n }, (_, i) => i).sort((a, b) => folosite[a] - folosite[b]);
            let ales = sloturi.find(s => vecineColorate.every(c => bune(s, c)));
            if (ales === undefined) ales = sloturi.find(s => !vecineColorate.includes(s));
            if (ales === undefined) ales = sloturi[0];
            col.set(x, ales);
            folosite[ales]++;
            ad.get(x).forEach(y => { if (!col.has(y)) saturatie.set(y, saturatie.get(y) + 1); });
        }
        return col;
    }

    return {
        decodeaza: decodeaza,
        inele: inele,
        plasa: plasa,
        contur: contur,
        vecini: vecini,
        coloreaza: coloreaza
    };
}();
