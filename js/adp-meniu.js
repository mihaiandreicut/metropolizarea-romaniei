/* ============================================================================
   adp-meniu.js — meniul site-ului, același pe toate paginile

   Legăturile paginilor stau în HTML (<header class="antet"><nav>), ca să fie
   citite și fără JavaScript și de motoarele de căutare. Scriptul doar le
   îmbogățește:
     * „Simulări” devine un meniu derulant, cu legături directe la fiecare
       simulare (deschis la trecerea mouse-ului, la clic pe săgeată sau din
       tastatură; se închide cu Escape sau cu un clic în afara lui);
     * pe ecranele înguste, meniul se strânge sub un buton „Meniu” și se
       deschide pe verticală, cu simulările la vedere.
   ========================================================================== */
(function () {
    "use strict";

    const SIMULARI = [
        { grup: "Comasarea comunelor", legaturi: [
            ["Pe un județ, pas cu pas", "index.html#judet=8"],
            ["Pe o regiune", "index.html#regiune=7"],
            ["Toată țara", "index.html#tara"],
            ["Harta finală", "index.html#final"],
            ["Capitala și Ilfovul", "index.html#judet=23"]
        ] },
        { grup: "Regiunile", legaturi: [
            ["Azi: 41 de județe și București", "index.html#regiuni=judete"],
            ["8 regiuni de dezvoltare (propunerea)", "index.html#regiuni=adr"],
            ["Curțile de apel, cu Metropola", "index.html#regiuni=curte-apel"],
            ["Regiuni calculate", "index.html#regiuni=calculata"]
        ] },
        { grup: "Banii și localitatea", legaturi: [
            ["Cât lasă în urmă primăria desființată", "raport.html#tablou"],
            ["Ce se schimbă pentru satul tău", "localitatea.html"]
        ] }
    ];

    function porneste() {
        const antet = document.querySelector("header.antet");
        const nav = antet && antet.querySelector("nav");
        if (!nav || nav.dataset.meniu) return;
        nav.dataset.meniu = "1";
        nav.id = nav.id || "meniu-pagini";
        document.documentElement.classList.add("cu-meniu");

        // --- „Simulări”, meniu derulant
        const sim = nav.querySelector('a[href="simulari.html"]');
        let grup = null;
        if (sim) {
            grup = document.createElement("div");
            grup.className = "meniu-grup";
            sim.replaceWith(grup);
            grup.appendChild(sim);
            const sageata = document.createElement("button");
            sageata.type = "button";
            sageata.className = "meniu-sageata";
            sageata.setAttribute("aria-expanded", "false");
            sageata.setAttribute("aria-controls", "meniu-simulari");
            sageata.setAttribute("aria-label", "Arată simulările");
            sageata.innerHTML = '<span aria-hidden="true">▾</span>';
            grup.appendChild(sageata);
            const sub = document.createElement("div");
            sub.id = "meniu-simulari";
            sub.className = "meniu-sub";
            sub.innerHTML = SIMULARI.map(g => `<p class="meniu-titlu">${g.grup}</p>` +
                g.legaturi.map(([text, href]) => `<a href="${href}">${text}</a>`).join("")).join("") +
                '<a class="meniu-toate" href="simulari.html">Toate simulările →</a>';
            grup.appendChild(sub);
            const seteaza = deschis => {
                grup.classList.toggle("deschis", deschis);
                sageata.setAttribute("aria-expanded", String(deschis));
            };
            sageata.addEventListener("click", e => {
                e.stopPropagation();
                seteaza(!grup.classList.contains("deschis"));
            });
            document.addEventListener("click", e => { if (!grup.contains(e.target)) seteaza(false); });
            grup.addEventListener("keydown", e => {
                if (e.key === "Escape") { seteaza(false); grup.classList.add("fara-hover"); sageata.focus(); }
            });
            // din tastatură: meniul se deschide când focusul intră în el și se închide când iese
            grup.addEventListener("focusin", e => { if (sub.contains(e.target)) seteaza(true); });
            grup.addEventListener("focusout", e => { if (!grup.contains(e.relatedTarget)) seteaza(false); });
            grup.addEventListener("mouseleave", () => grup.classList.remove("fara-hover"));
            // o legătură spre aceeași pagină (doar ancora se schimbă) închide meniul
            sub.addEventListener("click", e => {
                const a = e.target.closest("a");
                if (!a) return;
                seteaza(false);
                grup.classList.add("fara-hover");
                a.blur();
                inchideMeniul();
            });
        }

        // --- butonul „Meniu” pentru ecranele înguste
        const buton = document.createElement("button");
        buton.type = "button";
        buton.className = "meniu-buton";
        buton.setAttribute("aria-expanded", "false");
        buton.setAttribute("aria-controls", nav.id);
        buton.innerHTML = '<span class="meniu-icon" aria-hidden="true"></span>Meniu';
        antet.insertBefore(buton, nav);
        function inchideMeniul() {
            antet.classList.remove("meniu-deschis");
            buton.setAttribute("aria-expanded", "false");
        }
        buton.addEventListener("click", () => {
            const deschis = !antet.classList.contains("meniu-deschis");
            antet.classList.toggle("meniu-deschis", deschis);
            buton.setAttribute("aria-expanded", String(deschis));
        });
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && antet.classList.contains("meniu-deschis")) { inchideMeniul(); buton.focus(); }
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", porneste);
    else porneste();
})();
