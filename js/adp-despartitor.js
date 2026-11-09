/* ============================================================================
   e-ro-adp — despărțitorul dintre hartă și panou (index.html), cu Split.js
   (vendor/split, licență MIT).

   Lățimea panoului se trage cu mouse-ul sau se mută cu săgețile, cu
   despărțitorul în focus; rămâne ținută minte în browser, iar dublul clic o
   readuce la cea inițială. Pe ecranele înguste panoul stă sub hartă, fără
   despărțitor. Harta își reface singură mărimea (ResizeObserver în adp-harta.js).
   ========================================================================== */
(function() {
    "use strict";

    const CHEIE = "ro-adp.latime-panou";
    const LATIME_MOBIL = 860;      // aceeași limită ca în css/adp-tema.css
    const PANOU_IMPLICIT = 380;    // px, lățimea de dinainte
    const PAS_TASTATURA = 2;       // procente, la o apăsare de săgeată
    let split = null;

    function citeste() {
        try {
            const v = JSON.parse(localStorage.getItem(CHEIE));
            return Array.isArray(v) && v.length === 2 && v.every(x => typeof x === "number") ? v : null;
        } catch (e) {
            return null;
        }
    }

    function scrie(v) {
        try {
            if (v) localStorage.setItem(CHEIE, JSON.stringify(v));
            else localStorage.removeItem(CHEIE);
        } catch (e) { /* fără stocare: lățimea nu se ține minte */ }
    }

    function implicit() {
        const latime = document.querySelector(".aplicatie").clientWidth || window.innerWidth;
        const panou = Math.min(60, Math.max(20, 100 * PANOU_IMPLICIT / latime));
        return [100 - panou, panou];
    }

    function porneste() {
        const ingust = window.innerWidth <= LATIME_MOBIL;
        if (ingust && split) {
            split.destroy();
            split = null;
        }
        if (ingust || split || !window.Split || !document.querySelector(".aplicatie")) return;
        split = window.Split([".zona-harta", "#panou"], {
            sizes: citeste() || implicit(),
            minSize: [320, 300],
            gutterSize: 8,
            snapOffset: 0,
            elementStyle: (dim, marime, despartitor) => ({ "flex-basis": `calc(${marime}% - ${despartitor}px)` }),
            gutterStyle: (dim, despartitor) => ({ "flex-basis": `${despartitor}px` }),
            onDragEnd: marimi => scrie(marimi)
        });
        const g = document.querySelector(".aplicatie > .gutter");
        if (!g) return;
        g.setAttribute("role", "separator");
        g.setAttribute("aria-orientation", "vertical");
        g.setAttribute("aria-label", "Lățimea panoului: trage, sau săgețile stânga și dreapta");
        g.title = "Trage ca să schimbi lățimea panoului; dublu clic: lățimea inițială";
        g.tabIndex = 0;
        g.addEventListener("dblclick", () => {
            split.setSizes(implicit());
            scrie(null);
        });
        g.addEventListener("keydown", e => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const [harta] = split.getSizes();
            const nou = Math.min(80, Math.max(30, harta + (e.key === "ArrowLeft" ? -PAS_TASTATURA : PAS_TASTATURA)));
            split.setSizes([nou, 100 - nou]);
            scrie(split.getSizes());
        });
    }

    document.addEventListener("DOMContentLoaded", porneste);
    window.addEventListener("resize", porneste);
})();
