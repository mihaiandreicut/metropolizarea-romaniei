/* ============================================================================
   ro-adp — „Localitatea mea” (localitatea.html)

   Răspunde pe loc la „ce se schimbă pentru satul meu?”: caută după nume sau după
   locul în care ești, apoi arată cu cine se unește localitatea, drumul până la
   primărie, costul primăriei, banii eliberați și ce se poate face cu ei. Toate
   cifrele sunt precalculate de unelte/fise-localitati.js, cu aceleași module ca
   harta și raportul; pagina doar le caută și le așază.
   Modul independent: nu are nevoie de hartă și nici de algoritm. Rulează pe două
   pagini: pe localitatea.html, de sine stătător, și pe prima pagină (index.html),
   unde caseta de căutare stă peste hartă, fișa apare în panou, iar harta e
   anunțată prin evenimentul „ro-adp:localitate” ca să meargă la localitatea aleasă.
   ========================================================================== */
(function() {
    "use strict";
    const CALE = "date/fise-localitati.json";
    // sesizările publice: un issue nou pe GitHub, cu localitatea și cifrele deja completate
    const SESIZARI = "https://github.com/mihaiandreicut/metropolizarea-romaniei/issues/new";
    const NF = new Intl.NumberFormat("ro-RO");
    const NF1 = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 });
    const $ = sel => document.querySelector(sel);
    const esc = text => text === null || text === undefined ? "" : String(text).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
    const lei = v => Math.abs(v) >= 1e9 ? `${NF1.format(v / 1e9)} mld. lei`
        : Math.abs(v) >= 1e6 ? `${NF1.format(v / 1e6)} mil. lei` : `${NF.format(Math.round(v / 1000) * 1000)} lei`;
    const cate = (n, unu, multe) => `${NF.format(n)} ${n === 1 ? unu : (n % 100 >= 20 || n % 100 === 0) && n >= 20 ? "de " + multe : multe}`;
    const simplu = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[ş]/g, "s").replace(/[ţ]/g, "t").replace(/[^a-z0-9]+/g, " ").trim();
    const TIP = { c: "comuna", o: "orașul", m: "municipiul" };
    const TIP_SCURT = { c: "comună", o: "oraș", m: "municipiu" };
    const cuMajuscula = t => t.charAt(0).toUpperCase() + t.slice(1);
    const insira = lista => lista.length <= 1 ? lista.join("") : lista.slice(0, -1).join(", ") + " și " + lista[lista.length - 1];
    const ani = v => v < 1 ? "mai puțin de un an" : v < 1.5 ? "un an" : cate(Math.round(v), "an", "ani");

    // pe prima pagină: caseta stă peste hartă, iar adresa paginii e a simulării (#judet=N), nu a localității
    const PE_HARTA = !!document.getElementById("harta");
    const spune = text => { const el = $("#loc-stare"); if (el) el.textContent = text; };
    let D = null;        // date/fise-localitati.json
    let cautare = [];    // indexul de căutare: UAT-uri și sate
    let ales = null;     // { uat: SIRUTA, sat: rândul satului sau null }

    // câmpurile poziționale din fișier (vezi `campuri` în date/fise-localitati.json)
    const U = s => { const u = D.uat[s]; return u && { s: Number(s), n: u[0], t: u[1], j: u[2], p: u[3], g: u[4], ap: u[5], tA: u[6], tN: u[7], apa: u[8], canal: u[9], cons: u[10] }; };
    const SAT = x => ({ s: x[0], n: x[1], u: x[2], p: x[3], lat: x[4], lng: x[5], tA: x[6], tN: x[7] });
    const J = c => { const j = D.judete[c]; return { n: j[0], auto: j[1], p: j[2], cj: j[3], stat: j[4], adr: j[5] }; };

    // ------------------------------------------------------------ căutarea
    function construiesteIndexul() {
        cautare = [];
        Object.keys(D.uat).forEach(s => {
            const u = U(s);
            cautare.push({ k: simplu(u.n), nume: u.n, sub: `${TIP_SCURT[u.t]}, județul ${J(u.j).n}`, p: u.p, uat: u.s, sat: null, rang: 0 });
        });
        D.sate.forEach(x => {
            const s = SAT(x), u = U(s.u);
            // satul-reședință poartă de obicei numele comunei: rămâne în listă, sub comună
            cautare.push({ k: simplu(s.n), nume: s.n, sub: `${u.t === "c" ? "sat" : "localitate"} în ${TIP[u.t]} ${u.n}, județul ${J(u.j).n}`,
                p: s.p, uat: s.u, sat: x, rang: 1 });
        });
    }

    function sugestii(text) {
        const q = simplu(text);
        if (q.length < 2) return [];
        const scor = e => e.k === q ? 0 : e.k.startsWith(q) ? 1 : e.k.includes(" " + q) ? 2 : 3;
        return cautare.filter(e => e.k.includes(q))
            .sort((a, b) => scor(a) - scor(b) || a.rang - b.rang || b.p - a.p)
            .slice(0, 8);
    }

    let lista = [], activ = -1;
    function arataSugestii() {
        const cutie = $("#loc-sugestii"), camp = $("#loc-q");
        lista = sugestii(camp.value);
        activ = lista.length ? 0 : -1;
        cutie.innerHTML = lista.map((e, k) => `<li role="option" id="loc-s-${k}" data-k="${k}"${k === activ ? ` aria-selected="true"` : ""}>
            <b>${esc(e.nume)}</b><small>${esc(e.sub)}</small></li>`).join("") ||
            (simplu(camp.value).length >= 2 ? `<li class="gol">Nicio localitate cu acest nume.</li>` : "");
        cutie.hidden = !cutie.innerHTML;
        camp.setAttribute("aria-expanded", String(!cutie.hidden));
        if (activ >= 0) camp.setAttribute("aria-activedescendant", `loc-s-${activ}`);
        else camp.removeAttribute("aria-activedescendant");
    }
    function inchideSugestii() {
        $("#loc-sugestii").hidden = true;
        $("#loc-q").setAttribute("aria-expanded", "false");
    }
    function mutaActiv(pas) {
        if (!lista.length) return;
        activ = (activ + pas + lista.length) % lista.length;
        document.querySelectorAll("#loc-sugestii li[role=option]").forEach((li, k) => {
            if (k === activ) { li.setAttribute("aria-selected", "true"); li.scrollIntoView({ block: "nearest" }); }
            else li.removeAttribute("aria-selected");
        });
        $("#loc-q").setAttribute("aria-activedescendant", `loc-s-${activ}`);
    }
    function alege(e) {
        if (!e) return;
        $("#loc-q").value = e.nume;
        inchideSugestii();
        arata({ uat: e.uat, sat: e.sat }, true);
    }

    // ------------------------------------------------------------ locul în care ești
    function cautaAici() {
        if (!navigator.geolocation) {
            spune("Browserul nu știe unde ești. Scrie numele localității.");
            return;
        }
        spune("Caut localitatea în care ești…");
        navigator.geolocation.getCurrentPosition(poz => {
            const lat = poz.coords.latitude, lng = poz.coords.longitude, c = Math.cos(lat * Math.PI / 180);
            let best = null, dMin = Infinity;
            D.sate.forEach(x => {
                if (x[4] === null) return;
                const d = (x[4] - lat) * (x[4] - lat) + (x[5] - lng) * (x[5] - lng) * c * c;
                if (d < dMin) { dMin = d; best = x; }
            });
            // peste ~25 km de orice sat din date: nu ești în România
            if (!best || Math.sqrt(dMin) * 111 > 25) {
                spune("Nu ești lângă nicio localitate din date. Scrie numele ei.");
                return;
            }
            spune("");
            $("#loc-q").value = best[1];
            arata({ uat: best[2], sat: best }, true);
        }, () => {
            spune("Nu am primit locația. Scrie numele localității.");
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
    }

    // ------------------------------------------------------------ fișa localității
    /** Tot ce arată fișa, ca date: o folosesc și pagina, și imaginea de distribuit. */
    function fisa(sel) {
        const u = U(sel.uat);
        const sat = sel.sat ? SAT(sel.sat) : null;
        const j = J(u.j);
        const g = u.g >= 0 ? D.unitati[u.g] : null;
        const titlu = sat && simplu(sat.n) !== simplu(u.n) ? `${sat.n}, ${TIP[u.t]} ${u.n}` : `${cuMajuscula(TIP[u.t])} ${u.n}`;
        const baza = { u: u, sat: sat, j: j, g: g, titlu: titlu, subtitlu: `județul ${j.n}` };
        const sus = j.cj + j.stat;     // consiliul județean și serviciile statului, în județ
        if (!g) {
            return Object.assign(baza, { verdict: `${cuMajuscula(TIP[u.t])} ${u.n} rămâne cum e: nu intră în comasare.`,
                explicatie: "Capitala are organizarea ei, pe sectoare, și nu face parte din calcul.", economie: 0, sus: sus });
        }
        const resedinta = U(g.s);
        const altii = g.m.filter(s => s !== u.s).map(s => U(s).n);
        const unit = g.m.length > 1;
        const eResedinta = g.s === u.s;
        const tipUnitate = resedinta.t === "c" ? "comuna" : TIP[resedinta.t];
        const numeAltii = altii.length > 4 ? altii.slice(0, 3).join(", ") + ` și alte ${altii.length - 3}` : insira(altii);
        let verdict, explicatie;
        if (!unit) {
            verdict = `${cuMajuscula(TIP[u.t])} ${u.n} rămâne cum e.`;
            // pragul unității: al comunei sau, dacă are oraș, al orașului
            const prag = g.o ? D.parametri.pMinOras : D.parametri.pMin;
            explicatie = g.p >= prag
                ? "Are destui locuitori ca să-și țină primăria fără să se unească cu nimeni. Se schimbă doar ce e deasupra ei: consiliul județean și serviciile statului."
                : `Are mai puțin de ${NF.format(prag)} de locuitori, dar regulile nu-i găsesc un vecin potrivit cu care să se unească. Rămâne cum e, cu derogare scrisă în dosar.`;
        } else if (eResedinta) {
            verdict = `${u.n} devine reședința unei ${resedinta.t === "c" ? "comune" : "unități"} mai mari: i se alătură ${numeAltii}.`;
            explicatie = `Primăria rămâne în ${u.n}. Unitatea nouă are ${NF.format(g.p)} de locuitori.`;
        } else {
            verdict = `${cuMajuscula(TIP[u.t])} ${u.n} se unește cu ${numeAltii}. Primăria va fi la ${resedinta.n}.`;
            explicatie = `Unitatea nouă, ${tipUnitate} ${resedinta.n}, are ${NF.format(g.p)} de locuitori. În ${u.n} rămâne ` +
                (g.b.includes(u.s) ? "un birou permanent al primăriei" : "un birou al primăriei, cu program") +
                `, iar fiecare sat își alege delegatul și are un fond al lui.`;
        }
        const economie = Math.max(0, g.a[0] - g.a[1]);
        const leiEuro = D.curs, st = D.standarde;
        const lucrari = [];
        if (economie > 0) {
            if (g.fc) {
                const cost = g.fc * st.canalizare * leiEuro;
                lucrari.push({ ce: "Canalizare", text: `pentru cei ${NF.format(g.fc)} de locuitori care azi nu au deloc`, cost: cost, ani: cost / economie });
            }
            if (g.fa) {
                const cost = g.fa * st.apa * leiEuro;
                lucrari.push({ ce: "Apă curentă", text: `pentru cei ${NF.format(g.fa)} de locuitori care azi nu au rețea`, cost: cost, ani: cost / economie });
            }
        }
        // drumul: al satului ales; altfel media satelor din UAT
        const tA = sat ? sat.tA : u.tA, tN = sat ? sat.tN : u.tN;
        const aproape = sat ? "în localitate" : "sub 1 min";
        const drum = tA === null ? null
            : tN < 0.5 ? aproape
                : Math.round(tA) === Math.round(tN) ? `${NF.format(Math.round(tN))} min`
                    : `${tA < 0.5 ? aproape : NF.format(Math.round(tA))} → ${NF.format(Math.round(tN))} min`;
        const costAzi = u.p && u.ap ? u.ap / u.p : null, costDupa = g.p ? g.a[1] / g.p : null;
        const cost = costAzi === null ? null
            : Math.round(costAzi) === Math.round(costDupa) ? `${NF.format(Math.round(costAzi))} lei`
                : `${NF.format(Math.round(costAzi))} → ${NF.format(Math.round(costDupa))} lei`;
        return Object.assign(baza, {
            drum: drum, cost: cost,
            resedinta: resedinta, altii: altii, unit: unit, eResedinta: eResedinta, tipUnitate: tipUnitate,
            verdict: verdict, explicatie: explicatie, economie: economie, sus: sus, lucrari: lucrari,
            kmDrum: economie / (st.drumComunal * leiEuro),
            tA: tA, tN: tN, costAzi: costAzi, costDupa: costDupa
        });
    }

    function arata(sel, deruleaza) {
        ales = sel;
        const f = fisa(sel);
        const u = f.u, g = f.g, j = f.j;
        const cutie = $("#loc-fisa");
        const tile = (eticheta, valoare, nota, clasa) => `<div class="loc-cifra${clasa ? " " + clasa : ""}">
            <span class="card-eticheta">${eticheta}</span><strong>${valoare}</strong><small>${nota || ""}</small></div>`;
        const sageata = (a, b) => a === b ? a : `${a} <span class="loc-spre" aria-label="devine">→</span> ${b}`;
        const cuSageata = text => esc(text).replace(" → ", ` <span class="loc-spre" aria-label="devine">→</span> `);
        const tiles = [];
        if (g && f.drum) {
            const depaseste = f.tN > D.parametri.tMax;
            tiles.push(tile(f.sat ? `Drumul din ${esc(f.sat.n)} până la primărie` : "Drumul mediu până la primărie",
                cuSageata(f.drum),
                depaseste ? `peste limita de ${D.parametri.tMax} de minute: caz de derogare, scris în dosarul unității`
                    : f.unit && !f.eResedinta && Math.round(f.tN) > Math.round(f.tA) ? "cu mașina; actele curente se fac la biroul din sat și online"
                        : "cu mașina, pe drumul real", depaseste ? "atentie" : ""));
        }
        if (g && f.cost) {
            const scade = Math.round(f.costDupa) < Math.round(f.costAzi);
            tiles.push(tile("Primăria costă, pe locuitor", cuSageata(f.cost),
                f.unit ? "aparatul primăriei, pe an; execuția bugetară 2025" : "pe an; neschimbat, fiindcă primăria rămâne aceeași", scade ? "bun" : ""));
        }
        if (g && f.unit) {
            tiles.push(tile("Bani eliberați în fiecare an", lei(f.economie),
                `în unitatea nouă: ${NF.format(Math.round(f.economie / g.p))} lei pe locuitor`, "bun"));
            tiles.push(tile("Aleși", sageata(cate(g.m.length, "primar", "primari"), "1"),
                `consilieri locali: ${NF.format(g.c[0])} → ${NF.format(g.c[1])}; fiecare sat, cu delegatul lui`));
        }

        const lucrari = !g || !f.economie ? "" : `
            <h3>Ce se poate face cu banii aceștia</h3>
            <ul class="loc-lucrari">
                ${f.lucrari.map(x => `<li><b>${x.ce}</b> ${x.text}: costă cam ${lei(x.cost)}.
                    <span class="loc-ani">Economia o plătește în ${ani(x.ani)}.</span></li>`).join("")}
                <li><b>${f.lucrari.length ? "Sau drumuri" : "Drumuri"}:</b> ${f.kmDrum >= 1 ? `${NF1.format(f.kmDrum)} km` : `${NF.format(Math.round(f.kmDrum * 100) * 10)} m`}
                    de drum comunal modernizat în fiecare an.</li>
                <li><b>În zece ani:</b> ${lei(f.economie * 10)} pentru investiții, în loc să se ducă pe administrație.</li>
            </ul>`;
        const deSus = !g ? "" : `<p class="loc-sus">În plus, în județul ${esc(j.n)}, consiliul județean și serviciile statului costă cu
            <b>${lei(f.sus)}</b> mai puțin pe an — ${NF.format(Math.round(f.sus / j.p))} lei pentru fiecare locuitor.</p>`;
        const maiSus = !g || !g.d ? "" : `
            <h3>Mai sus de primărie</h3>
            <ul class="loc-trepte">
                <li><b>${g.d[1] ? "Zona metropolitană" : "Districtul"} ${esc(g.d[0])}</b>${g.d[2] !== g.d[0] ? `, cu reședința la ${esc(g.d[2])}` : ""}:
                    judecătoria, spitalul, liceul și ghișeul statului, la un loc.</li>
                ${g.g && !(g.o && g.p > 20000) ? `<li><b>Microregiunea ${esc(g.g)}</b>: grupul de acțiune locală prin care vin banii europeni pentru sate.</li>` : ""}
                <li><b>Regiunea ${esc(j.adr === "București-Ilfov" ? "București–Ilfov" : j.adr)}</b> preia ce face azi consiliul județean; județul
                    ${esc(j.n)} rămâne pe hartă, ca identitate și circumscripție electorală.</li>
            </ul>`;

        const ancora = sel.sat ? `sat=${sel.sat[0]}` : `uat=${sel.uat}`;
        f.adresa = new URL("localitatea.html#" + ancora, location.href).href;
        cutie.innerHTML = `
            <div class="loc-card">
                ${PE_HARTA ? `<button type="button" class="loc-inchide" id="loc-inchide" aria-label="Închide fișa localității">×</button>` : ""}
                <p class="loc-unde">${esc(f.subtitlu)} · ${NF.format(u.p)} de locuitori${f.sat && f.sat.p ? ` · ${esc(f.sat.n)}: ${NF.format(f.sat.p)} la recensământ` : ""}</p>
                <h2>${esc(f.titlu)}</h2>
                <p class="loc-verdict">${esc(f.verdict)}</p>
                <p class="loc-explicatie">${esc(f.explicatie)}</p>
                ${tiles.length ? `<div class="loc-cifre">${tiles.join("")}</div>` : ""}
                ${lucrari}
                ${deSus}
                ${maiSus}
                <div class="loc-actiuni">
                    <button type="button" class="buton principal" id="loc-distribuie">Distribuie</button>
                    <button type="button" class="buton" id="loc-imagine">Descarcă imaginea</button>
                    ${!g ? "" : PE_HARTA ? `<a class="buton" href="#judet=${u.j}">Simulează județul ${esc(j.n)}</a>`
                        : `<a class="buton" href="index.html#judet=${u.j}">Vezi pe hartă</a>`}
                    ${g ? `<a class="buton" href="raport.html#judet-${esc(j.auto)}">Fișa județului ${esc(j.n)}</a>` : ""}
                    <a class="buton" href="${esc(sesizare(f))}" target="_blank" rel="noopener">Semnalează o greșeală</a>
                </div>
                <p class="nota" id="loc-mesaj" role="status"></p>
            </div>`;
        cutie.hidden = false;
        spune("");
        $("#loc-distribuie").addEventListener("click", () => distribuie(f));
        $("#loc-imagine").addEventListener("click", () => descarcaImaginea(f));
        if (PE_HARTA) {
            $("#loc-inchide").addEventListener("click", inchideFisa);
            // pe hartă rămân doar comunele care se unesc, cu satele lor (js/adp-aplicatie.js)
            const membri = g ? g.m : [u.s];
            const inUnitate = new Set(membri);
            document.dispatchEvent(new CustomEvent("ro-adp:localitate", { detail: {
                uat: sel.uat, membri: membri, resedinta: g ? g.s : u.s,
                sate: D.sate.filter(x => inUnitate.has(x[2])), sat: sel.sat ? sel.sat[0] : null
            } }));
        } else {
            if (location.hash.slice(1) !== ancora) history.replaceState(null, "", "#" + ancora);
            document.title = `${f.titlu} — ce se schimbă`;
        }
        if (deruleaza) cutie.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    function inchideFisa() {
        const cutie = $("#loc-fisa");
        cutie.hidden = true;
        cutie.innerHTML = "";
        ales = null;
        $("#loc-q").value = "";
        document.dispatchEvent(new CustomEvent("ro-adp:localitate", { detail: { uat: null } }));
    }

    /** Adresa unei sesizări publice despre localitate, cu ce arată fișa deja completat. */
    function sesizare(f) {
        const randuri = [
            `Localitatea: ${f.titlu} (${f.subtitlu}), SIRUTA ${f.sat ? f.sat.s : f.u.s}`,
            `Fișa: ${f.adresa}`,
            "",
            `Ce arată fișa: ${f.verdict}`,
            f.drum ? `Drumul până la primărie: ${f.drum}` : "",
            f.cost ? `Primăria, pe locuitor, pe an: ${f.cost}` : "",
            "",
            "Ce e greșit, după ce știi tu (un drum care lipsește, un sat care merge în altă parte, o comună cu care v-ați asociat deja):",
            "",
            "Cine ești (opțional: locuitor, primar, consilier, funcționar):"
        ].filter((r, k, a) => r !== "" || a[k - 1] !== "");
        return `${SESIZARI}?title=${encodeURIComponent("Sesizare: " + f.titlu)}&body=${encodeURIComponent(randuri.join("\n"))}`;
    }

    // ------------------------------------------------------------ distribuirea
    const textDistribuire = f => `${f.titlu} (${f.subtitlu}): ${f.verdict}` +
        (f.economie ? ` Se eliberează ${lei(f.economie)} pe an.` : "");

    async function distribuie(f) {
        const mesaj = $("#loc-mesaj");
        const date = { title: `${f.titlu} — ce se schimbă`, text: textDistribuire(f), url: f.adresa };
        try {
            if (navigator.share) {
                await navigator.share(date);
                return;
            }
            await navigator.clipboard.writeText(`${date.text} ${date.url}`);
            mesaj.textContent = "Am copiat textul și linkul. Lipește-le unde vrei.";
        } catch (e) {
            if (e && e.name === "AbortError") return;
            mesaj.innerHTML = `Nu am putut copia. Linkul fișei: <a href="${esc(f.adresa)}">${esc(f.adresa)}</a>`;
        }
    }

    /** Textul, rupt pe rânduri care încap în lățime. */
    function randuri(ctx, text, latime, maxim) {
        const cuvinte = String(text).split(/\s+/), linii = [];
        let linie = "";
        cuvinte.forEach(c => {
            const proba = linie ? linie + " " + c : c;
            if (ctx.measureText(proba).width > latime && linie) { linii.push(linie); linie = c; }
            else linie = proba;
        });
        if (linie) linii.push(linie);
        if (maxim && linii.length > maxim) {
            linii.length = maxim;
            linii[maxim - 1] = linii[maxim - 1].replace(/[\s,.;:]+\S*$/, "") + "…";
        }
        return linii;
    }

    /** Fișa ca imagine de 1200 × 630, bună de pus pe rețele. */
    function deseneazaImaginea(f) {
        const L = 1200, H = 630, M = 64;
        const c = document.createElement("canvas");
        c.width = L; c.height = H;
        const x = c.getContext("2d");
        const font = (marime, gros) => { x.font = `${gros || 400} ${marime}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; };
        x.fillStyle = "#ffffff"; x.fillRect(0, 0, L, H);
        x.fillStyle = "#2a78d6"; x.fillRect(0, 0, L, 12);
        x.textBaseline = "top";
        font(24, 600); x.fillStyle = "#1c5cab";
        x.fillText("METROPOLIZAREA ROMÂNIEI · LOCALITATEA MEA", M, 44);
        font(26); x.fillStyle = "#52514e";
        x.fillText(`${f.subtitlu} · ${NF.format(f.u.p)} de locuitori`, M, 88);
        font(60, 700); x.fillStyle = "#0b0b0b";
        randuri(x, f.titlu, L - 2 * M, 1).forEach(l => x.fillText(l, M, 126));
        font(34, 500);
        let y = 212;
        randuri(x, f.verdict, L - 2 * M, 2).forEach(l => { x.fillText(l, M, y); y += 46; });

        // trei cifre
        const cifre = [];
        if (f.g && f.drum) cifre.push(["Drumul la primărie", f.drum]);
        if (f.g && f.cost) cifre.push(["Primăria, pe locuitor", f.cost]);
        if (f.economie) cifre.push(["Bani eliberați pe an", lei(f.economie)]);
        else if (f.g && f.sus) cifre.push(["Economie în județ, pe an", lei(f.sus)]);
        const yCifre = 340, latime = (L - 2 * M - (cifre.length - 1) * 24) / Math.max(1, cifre.length);
        cifre.forEach(([eticheta, valoare], k) => {
            const xc = M + k * (latime + 24);
            x.fillStyle = "#f3f6fb"; x.fillRect(xc, yCifre, latime, 150);
            x.fillStyle = k === 2 ? "#1baf7a" : "#2a78d6"; x.fillRect(xc, yCifre, latime, 6);
            let mic = 21;
            font(mic, 600);
            while (x.measureText(eticheta.toUpperCase()).width > latime - 44 && mic > 14) { mic -= 1; font(mic, 600); }
            x.fillStyle = "#52514e";
            x.fillText(eticheta.toUpperCase(), xc + 22, yCifre + 28);
            let marime = 46;
            font(marime, 700);
            while (x.measureText(valoare).width > latime - 44 && marime > 26) { marime -= 2; font(marime, 700); }
            x.fillStyle = "#0b0b0b";
            x.fillText(valoare, xc + 22, yCifre + 70);
        });

        // ce se poate face cu banii
        const prima = f.lucrari && f.lucrari[0];
        const rand = prima ? `${prima.ce} ${prima.text}: economia o plătește în ${ani(prima.ani)}.`
            : f.economie ? `Adică ${f.kmDrum >= 1 ? NF1.format(f.kmDrum) + " km" : NF.format(Math.round(f.kmDrum * 100) * 10) + " m"} de drum comunal modernizat în fiecare an.`
                : f.g && f.sus ? `Consiliul județean și serviciile statului din județul ${f.j.n} costă mai puțin; primăria rămâne aceeași.` : "";
        font(26, 500); x.fillStyle = "#006300";
        randuri(x, rand, L - 2 * M, 2).forEach((l, k) => x.fillText(l, M, 508 + k * 34));
        font(20); x.fillStyle = "#6b6a65";
        x.fillText(location.host + location.pathname.replace(/[^/]*$/, "") + "localitatea.html", M, H - 38);
        return c;
    }

    function descarcaImaginea(f) {
        const mesaj = $("#loc-mesaj");
        deseneazaImaginea(f).toBlob(async blob => {
            if (!blob) { mesaj.textContent = "Imaginea nu a putut fi făcută."; return; }
            const nume = "localitatea-mea-" + simplu(f.u.n).replace(/\s+/g, "-") + ".png";
            const fisier = new File([blob], nume, { type: "image/png" });
            // pe telefon, direct în foaia de distribuire; altfel, descărcare
            if (navigator.canShare && navigator.canShare({ files: [fisier] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
                try {
                    await navigator.share({ files: [fisier], title: f.titlu, text: textDistribuire(f), url: f.adresa });
                    return;
                } catch (e) {
                    if (e && e.name === "AbortError") return;
                }
            }
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = nume;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            mesaj.textContent = "Imaginea a fost descărcată.";
        }, "image/png");
    }

    // ------------------------------------------------------------ țara
    function randeazaTara() {
        if (!$("#loc-tara-cifre")) return;
        const n = D.national, st = D.standarde, curs = D.curs;
        const total = n.economiePrimarii + n.economieCJ + n.economieStat;
        const sigur = n.economiePrimarii + n.economieCJ;
        const costApa = n.faraApa[1] * st.apa * curs, costCanal = n.faraCanal[1] * st.canalizare * curs;
        const cost = costApa + costCanal;
        const aniTot = cost / total, aniSigur = cost / sigur;
        const kmAn = total / (st.drumComunal * curs);
        const mil = v => NF1.format(v / 1e6).replace(/,0$/, "");
        const parte = (v, din) => `${Math.max(2, 100 * v / din).toFixed(1)}%`;
        $("#loc-tara-cifre").innerHTML = `
            <p class="loc-teza">Apă și canalizare pentru <b>toți românii din localitățile care azi nu au nicio rețea</b>,
                plătite din economia reformei, în <b>${NF.format(Math.round(aniTot))} ani</b>.</p>
            <div class="loc-cifre loc-cifre-tara">
                <div class="loc-cifra bun"><span class="card-eticheta">Se eliberează în fiecare an</span>
                    <strong>${lei(total)}</strong>
                    <small>${lei(n.economiePrimarii)} din primării, ${lei(n.economieCJ)} din consiliile județene,
                        ${lei(n.economieStat)} din serviciile statului din județe</small></div>
                <div class="loc-cifra"><span class="card-eticheta">Fără apă curentă</span>
                    <strong>${mil(n.faraApa[1])} mil. oameni</strong>
                    <small>în ${NF.format(n.faraApa[0])} de comune și orașe fără nicio rețea; rețeaua costă cam ${lei(costApa)}</small></div>
                <div class="loc-cifra"><span class="card-eticheta">Fără canalizare</span>
                    <strong>${mil(n.faraCanal[1])} mil. oameni</strong>
                    <small>în ${NF.format(n.faraCanal[0])} de comune și orașe fără nicio rețea; rețeaua costă cam ${lei(costCanal)}</small></div>
            </div>
            <div class="loc-cale" role="img" aria-label="Economia plătește apa în ${ani(costApa / total)} și canalizarea în încă ${ani(costCanal / total)}">
                <div class="loc-cale-bara">
                    <span class="apa" style="width:${parte(costApa, cost)}"></span><span class="canal" style="width:${parte(costCanal, cost)}"></span>
                </div>
                <div class="loc-cale-legenda">
                    <span><i class="apa"></i> apa: ${ani(costApa / total)}</span>
                    <span><i class="canal"></i> canalizarea: încă ${ani(costCanal / total)}</span>
                    <span class="total">${lei(cost)} în total = ${NF1.format(aniTot)} ani de economie</span>
                </div>
            </div>
            <ul class="loc-lucrari">
                <li><b>Doar din partea sigură a economiei</b> — primăriile și consiliile județene, unde cifrele vin din
                    execuția bugetară — aceleași rețele se plătesc în ${NF.format(Math.round(aniSigur))} ani.</li>
                <li><b>Sau, în drumuri:</b> ${NF.format(Math.round(kmAn / 100) * 100)} km de drum comunal modernizat în fiecare an.</li>
                <li><b>De unde vin banii:</b> ${NF.format(n.uat)} de comune și orașe devin ${NF.format(n.unitati)}; consiliile
                    județene și prefecturile urcă la regiune. Aceiași oameni, mai puține birouri.</li>
            </ul>`;
        $("#loc-standarde").textContent = `${NF.format(st.apa)} de euro pe locuitor pentru apă, ${NF.format(st.canalizare)} pentru canalizare, ` +
            `${NF.format(st.drumComunal)} de euro pe kilometrul de drum comunal, la ${NF1.format(curs)} lei pentru un euro`;
    }

    // ------------------------------------------------------------ pornirea
    function dinAdresa() {
        const m = /^#(sat|uat)=(\d+)$/.exec(location.hash);
        if (!m || !D) return;
        const cod = Number(m[2]);
        if (m[1] === "uat" && D.uat[cod]) {
            arata({ uat: cod, sat: null }, false);
            $("#loc-q").value = D.uat[cod][0];
        } else if (m[1] === "sat") {
            const x = D.sate.find(s => s[0] === cod);
            if (x) {
                arata({ uat: x[2], sat: x }, false);
                $("#loc-q").value = x[1];
            }
        }
    }

    function leaga() {
        const camp = $("#loc-q"), cutie = $("#loc-sugestii");
        camp.addEventListener("input", arataSugestii);
        camp.addEventListener("focus", () => { if (camp.value) arataSugestii(); });
        camp.addEventListener("keydown", e => {
            if (e.key === "ArrowDown") { e.preventDefault(); if (cutie.hidden) arataSugestii(); else mutaActiv(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); mutaActiv(-1); }
            else if (e.key === "Enter") { e.preventDefault(); if (cutie.hidden) arataSugestii(); alege(lista[Math.max(0, activ)]); }
            else if (e.key === "Escape") inchideSugestii();
        });
        // mousedown, nu click: câmpul nu apucă să piardă focusul înainte de alegere
        cutie.addEventListener("mousedown", e => {
            const li = e.target.closest("li[role=option]");
            if (!li) return;
            e.preventDefault();
            alege(lista[Number(li.dataset.k)]);
        });
        document.addEventListener("click", e => { if (!e.target.closest(".loc-camp")) inchideSugestii(); });
        $("#loc-aici").addEventListener("click", cautaAici);
        if (!PE_HARTA) window.addEventListener("hashchange", dinAdresa);
    }

    fetch(CALE).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    }).then(date => {
        D = date;
        construiesteIndexul();
        leaga();
        randeazaTara();
        spune("");
        dinAdresa();
    }).catch(e => {
        console.error(`[ro-adp] Fișele localităților nu au putut fi încărcate (${e.message}).`);
        spune("Căutarea de localități nu a putut fi încărcată. Rulează „node unelte/fise-localitati.js”.");
        if ($("#loc-tara-cifre")) $("#loc-tara-cifre").innerHTML = "";
    });
})();
