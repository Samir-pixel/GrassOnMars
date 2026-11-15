// Вкладка «Mission concept»: конвейер миссии с Zyro, график, цели, системы, бюджеты,
// живой расчёт прогулок на реальном рельефе и ожидаемые результаты.
(function (root) {
  const $ = (id) => document.getElementById(id);
  const ic = (n) => root.icon(n);

  // ---------- Основные числа (с источниками) ----------
  const N = {
    crew: 4,
    surfaceSols: 500,                 // DRA 5.0: ~500 суток на поверхности (оппозиция–соединение)
    solDays: 1.0275,                  // сол в земных сутках
    transitDays: 203,                 // перелёт Perseverance: 30.07.2020 → 18.02.2021
    cruiseDose: 1.84,                 // мЗв/сут в перелёте, Curiosity RAD (Zeitlin et al. 2013)
    surfaceDose: 0.67,                // мЗв/сут на поверхности (Hassler et al. 2014)
    careerLimit: 600,                 // мЗв, NASA-STD-3001
    breatheTonPerYear: 1,             // ~1 т O₂ на 4 человек в год (NASA, MOXIE)
    ascentO2: 25,                     // ~25 т O₂ для взлётной ступени (NASA, MOXIE)
    moxieBest: 12,                    // г/ч, лучший режим MOXIE
    windowDays: 790,                  // ~26 месяцев между окнами запуска
    fissionKw: 40,                    // NASA Fission Surface Power
    sunEarth: 1361, sunMars: 586,     // Вт/м², средняя солнечная постоянная
  };

  const PHASES = [
    { id: "select", icon: "globe", title: "Site selection", when: "Years before launch",
      say: "First we choose where to go, with orbital data and a ranking you can check.",
      what: "Rank candidate sites from MOLA elevation, SHARAD and HiRISE ice evidence and CRISM minerals; exclude sites outside the exploration limits; stress-test the ranking.",
      basis: "NASA’s 2015 Human Landing Sites workshop studied exploration zones about 100 km in radius around a landing site.",
      app: "Overview and Compare sites tabs, robustness test", out: "Jezero chosen for science; landing point and walk targets fixed" },
    { id: "cargo", icon: "package", title: "Cargo pre-deploy", when: "One launch window early (~26 months)",
      say: "Cargo goes first. The oxygen plant has two years to fill the ascent tanks before anyone launches.",
      what: "Habitat, fission power unit, oxygen plant and the ascent vehicle land and start working on their own. The crew launches only if the tanks are full.",
      basis: "Split mission with pre-deployed cargo and propellant made on Mars, as in NASA’s Mars Design Reference Architecture 5.0.",
      app: "Budgets section: oxygen plant rate", out: "A working, fuelled base waiting for the crew" },
    { id: "transit", icon: "orbit", title: "Crew transit", when: "About 7 months",
      say: "Seven months in deep space. Radiation is the biggest health risk of the whole mission.",
      what: "Four astronauts fly a conjunction-class trajectory. The habitat uses water and stores as radiation shielding and has a storm shelter for solar particle events.",
      basis: "Perseverance took 203 days. Curiosity’s RAD measured about 1.84 mSv per day during cruise.",
      app: "Budgets section: radiation dose", out: "Crew arrives healthy, dose tracked" },
    { id: "edl", icon: "plane-landing", title: "Entry, descent, landing", when: "Minutes",
      say: "Landing a crew needs rockets from supersonic speed, and a smart eye to dodge rocks.",
      what: "A heavy lander slows with a heat shield and supersonic retropropulsion, then uses terrain-relative navigation to land near the base on safe ground.",
      basis: "Perseverance’s Terrain-Relative Navigation steered it to a safe spot in Jezero; NASA studies show human-class landers need supersonic retropropulsion.",
      app: "HiRISE imagery and slope map of the landing area", out: "Crew on the surface next to the base" },
    { id: "setup", icon: "house", title: "Base setup", when: "Sols 1–30",
      say: "After months in zero-g, legs need time. We start with short walks around the habitat.",
      what: "Readapt to 0.38 g, connect the habitat, check suits and the oxygen plant, start the greenhouse, walk short test routes.",
      basis: "Crews return from long spaceflight with weaker muscles and balance; short, close walks come first.",
      app: "Marswalk: the shortest walk in the traverse table below", out: "Base and suits certified for longer walks" },
    { id: "walks", icon: "footprints", title: "Marswalk campaign", when: "Sols 30–470",
      say: "The heart of the mission: two-person walks, planned each sol on real terrain.",
      what: "Field geology on foot to the delta front, Séítah, Belva crater and the margin carbonates; samples chosen by trained eyes, every walk checked for oxygen, daylight and slope.",
      basis: "Walk plans use NASA’s 20 m CTX elevation model of Jezero, Tobler’s hiking function slowed for suits and an 8-hour suit with a 30% reserve.",
      app: "Marswalk tab: routes, navigation, return check", out: "Samples with field context, measured walking performance" },
    { id: "green", icon: "sprout", title: "Greenhouse pilot", when: "From sol 60",
      say: "And then our favourite part: the first plants grown with Martian water.",
      what: "A pressurised hydroponic greenhouse with LEDs and sunlight, CO₂ from the air and water cleaned of perchlorate salts.",
      basis: "Astronauts have grown and eaten lettuce on the ISS in NASA’s Veggie system; Phoenix found perchlorate in Martian soil.",
      app: "Mission concept: greenhouse system", out: "First harvest grown on another planet" },
    { id: "return", icon: "rocket", title: "Ascent and return", when: "Next window, ~sol 500",
      say: "We fly home on oxygen made from the Martian air, with the samples on board.",
      what: "The crew launches with propellant oxygen made on Mars, meets the return vehicle in orbit and flies about 7 months back to Earth.",
      basis: "Making ~25 t of oxygen on Mars removes it from the mass that must be launched from Earth.",
      app: "Expected results", out: "Crew and samples home, data open to everyone" },
  ];

  const OBJECTIVES = [
    { goal: "Goal I · Life", icon: "microscope", title: "Look for signs of ancient life", where: "Delta front, Belva crater rim, margin carbonates",
      how: "Crew field geology, hand lens and portable spectrometers, cores from the finest mud layers", expected: "Context-rich samples from the layers most likely to keep biosignatures",
      value: "A direct test of whether life ever existed beyond Earth" },
    { goal: "Goal II · Climate", icon: "cloud-sun", title: "Read the lake’s climate history", where: "Delta layers, Belva crater wall, weather station at the base",
      how: "Measured sections layer by layer, samples dated on Earth, continuous weather records", expected: "A timeline of wet and dry periods in Jezero",
      value: "Shows how a planet loses water and habitability, a reference for Earth’s climate" },
    { goal: "Goal III · Geology", icon: "gem", title: "Understand the crater floor", where: "Séítah, crater floor, crater rim lookout",
      how: "Sampling olivine-rich rocks, mapping contacts between units", expected: "The origin and age of the rocks under the lake",
      value: "Dated samples anchor crater-count ages used across the whole planet" },
    { goal: "Goal IV · Humans", icon: "person-standing", title: "Prepare for the next crews", where: "Every walk and every sol at the base",
      how: "Measure walking speed and energy on slopes, dust on suits, radiation inside and outside, oxygen plant and greenhouse output",
      expected: "Planning models checked against real human data", value: "Safer, cheaper missions; better walk planning on Earth too" },
  ];

  // ---------- Объёмные иллюстрации систем (изометрия) ----------
  const G = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  const ground = `<ellipse cx="80" cy="128" rx="62" ry="14" fill="rgba(0,0,0,.28)"/>`;
  const ART = {
    habitat: `<svg viewBox="0 0 160 150"><defs>${G("hb1", "#f1efe8", "#b9b5aa")}${G("hb2", "#d8d4c9", "#8e8a80")}${G("hbg", "#c7764a", "#8a4a2c")}</defs>${ground}
      <path d="M18 112 L80 140 L142 112 L80 84 Z" fill="url(#hbg)"/>
      <path d="M36 104 Q36 52 80 44 Q124 52 124 104 L80 124 Z" fill="url(#hb1)"/>
      <path d="M80 44 Q124 52 124 104 L80 124 Z" fill="url(#hb2)" opacity=".75"/>
      <path d="M48 84 Q80 70 112 84" stroke="#9a968c" stroke-width="2" fill="none"/>
      <rect x="70" y="96" width="20" height="22" rx="10" fill="#39429e"/><circle cx="80" cy="104" r="4" fill="#cfe26a"/>
      <path d="M36 104 L80 124 L124 104" stroke="#6d6a62" stroke-width="2" fill="none"/></svg>`,
    suit: `<svg viewBox="0 0 160 150"><defs>${G("su1", "#ffffff", "#c9c6bd")}${G("su2", "#2b3a8f", "#151a3d")}</defs>${ground}
      <rect x="52" y="78" width="56" height="48" rx="16" fill="url(#su1)"/><rect x="58" y="96" width="44" height="10" rx="3" fill="#39429e"/>
      <circle cx="80" cy="58" r="30" fill="url(#su1)"/><ellipse cx="80" cy="60" rx="21" ry="17" fill="url(#su2)"/>
      <path d="M66 52 Q76 44 90 48" stroke="#cfe26a" stroke-width="2.5" fill="none" opacity=".8"/>
      <rect x="64" y="62" width="32" height="5" rx="2" fill="#cfe26a" opacity=".55"/><circle cx="112" cy="94" r="6" fill="#cfe26a"/></svg>`,
    power: `<svg viewBox="0 0 160 150"><defs>${G("pw1", "#4b5bd0", "#202a6e")}${G("pw2", "#e9e6dc", "#a9a598")}</defs>${ground}
      <path d="M14 96 L58 76 L92 92 L48 112 Z" fill="url(#pw1)"/><path d="M14 96 L48 112 L48 116 L14 100 Z" fill="#141a45"/>
      <path d="M26 92 L60 108 M38 86 L72 102 M50 81 L84 97" stroke="#8ea0ff" stroke-width="1" opacity=".6"/>
      <line x1="52" y1="112" x2="52" y2="124" stroke="#6d6a62" stroke-width="3"/>
      <rect x="102" y="58" width="34" height="62" rx="8" fill="url(#pw2)"/><ellipse cx="119" cy="58" rx="17" ry="6" fill="#f5f3ec"/>
      <path d="M106 70 H132 M106 80 H132 M106 90 H132" stroke="#8a867b" stroke-width="2"/>
      <circle cx="119" cy="104" r="7" fill="#cfe26a"/><path d="M119 99 L116 105 H122 L119 110" stroke="#1d2408" stroke-width="1.6" fill="none"/></svg>`,
    oxygen: `<svg viewBox="0 0 160 150"><defs>${G("ox1", "#d7d3c8", "#8f8b80")}${G("ox2", "#5aa0a6", "#2d6468")}</defs>${ground}
      <path d="M24 98 L70 78 L104 94 L58 114 Z" fill="#cfcabd"/><path d="M24 98 L58 114 L58 126 L24 110 Z" fill="#8f8b80"/><path d="M58 114 L104 94 L104 106 L58 126 Z" fill="#a9a598"/>
      <rect x="36" y="64" width="30" height="34" rx="4" fill="url(#ox1)"/><circle cx="51" cy="80" r="8" fill="#e07a6c"/>
      <path d="M66 76 H86 V60" stroke="#6d6a62" stroke-width="4" fill="none"/>
      <rect x="84" y="38" width="30" height="62" rx="15" fill="url(#ox2)"/><text x="99" y="76" text-anchor="middle" font-size="15" font-weight="700" fill="#fff" font-family="Inter Tight, sans-serif">O₂</text>
      <path d="M128 52 q6 -6 0 -12 M136 56 q8 -10 0 -20" stroke="#cfe26a" stroke-width="2" fill="none"/></svg>`,
    water: `<svg viewBox="0 0 160 150"><defs>${G("wa1", "#7fb2ff", "#2f4fa8")}${G("wa2", "#e3e0d6", "#9d998e")}</defs>${ground}
      <path d="M30 100 L80 78 L130 100 L80 122 Z" fill="url(#wa2)"/>
      <path d="M80 30 C80 30 52 64 52 82 A28 28 0 0 0 108 82 C108 64 80 30 80 30 Z" fill="url(#wa1)"/>
      <path d="M68 78 a12 12 0 0 0 10 14" stroke="#fff" stroke-width="3" fill="none" opacity=".7"/>
      <path d="M118 66 a26 26 0 0 1 -8 34" stroke="#cfe26a" stroke-width="3" fill="none"/><path d="M110 100 l-1 -9 l8 4 z" fill="#cfe26a"/>
      <path d="M42 98 a26 26 0 0 1 8 -34" stroke="#cfe26a" stroke-width="3" fill="none"/><path d="M50 64 l1 9 l-8 -4 z" fill="#cfe26a"/></svg>`,
    green: `<svg viewBox="0 0 160 150"><defs>${G("gr1", "rgba(220,240,255,.55)", "rgba(160,200,230,.25)")}${G("grg", "#c7764a", "#8a4a2c")}</defs>${ground}
      <path d="M18 112 L80 140 L142 112 L80 84 Z" fill="url(#grg)"/>
      <path d="M34 106 Q34 48 80 40 Q126 48 126 106 L80 126 Z" fill="url(#gr1)" stroke="#e9f2f7" stroke-width="2"/>
      <path d="M56 54 Q58 92 60 118 M80 40 V126 M104 54 Q102 92 100 118" stroke="#e9f2f7" stroke-width="1.2" opacity=".7"/>
      <g fill="#7fbf4a"><path d="M52 110 q-8 -18 2 -26 q4 14 -2 26z"/><path d="M66 114 q-6 -22 6 -30 q2 18 -6 30z"/><path d="M92 114 q-4 -22 8 -28 q0 18 -8 28z"/><path d="M106 108 q-2 -16 8 -22 q0 14 -8 22z"/></g>
      <g fill="#a6d86a"><path d="M78 116 q-10 -26 4 -36 q6 20 -4 36z"/></g>
      <rect x="46" y="112" width="68" height="6" rx="2" fill="#39429e" opacity=".8"/></svg>`,
    comms: `<svg viewBox="0 0 160 150"><defs>${G("cm1", "#f1efe8", "#a9a598")}</defs>${ground}
      <path d="M80 126 L80 86" stroke="#8a867b" stroke-width="5"/><path d="M66 128 L80 120 L94 128" stroke="#8a867b" stroke-width="4" fill="none"/>
      <path d="M44 72 Q80 112 116 72 Z" fill="url(#cm1)"/><path d="M80 92 L96 58" stroke="#6d6a62" stroke-width="3"/><circle cx="97" cy="56" r="5" fill="#cfe26a"/>
      <path d="M108 40 q14 -8 22 4 M112 30 q22 -12 34 6" stroke="#cfe26a" stroke-width="2.5" fill="none"/>
      <g transform="translate(118 12)"><rect x="8" y="6" width="14" height="10" rx="2" fill="#e3e0d6"/><rect x="-6" y="8" width="12" height="6" fill="#39429e"/><rect x="24" y="8" width="12" height="6" fill="#39429e"/></g></svg>`,
    nav: `<svg viewBox="0 0 160 150"><defs>${G("nv1", "#2a2e3b", "#12141b")}${G("nv2", "#c7764a", "#6b3a22")}</defs>${ground}
      <rect x="30" y="34" width="100" height="84" rx="14" fill="url(#nv1)" transform="skewY(-6) translate(0 14)"/>
      <g transform="skewY(-6) translate(0 14)">
        <rect x="38" y="42" width="84" height="56" rx="8" fill="url(#nv2)"/>
        <path d="M48 88 L64 70 L84 76 L108 52" stroke="#cfe26a" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="48" cy="88" r="5" fill="#f3f2ee"/><circle cx="108" cy="52" r="5" fill="#cfe26a"/>
        <rect x="38" y="104" width="40" height="6" rx="3" fill="#39429e"/><rect x="82" y="104" width="40" height="6" rx="3" fill="#cfe26a" opacity=".7"/>
      </g></svg>`,
  };
  const SYSTEMS = [
    { id: "hab", title: "Surface habitat", model: "NASA Habitat Demonstration Unit, field-tested in the Arizona desert",
      rows: [["Role", "Home and lab for 4 crew for ~500 sols"], ["Design", "Pressurised core, airlocks, storm shelter; water walls and a regolith cover for radiation"], ["Evidence", "Habitat class from NASA Mars Design Reference Architecture 5.0"]] },
    { id: "astro", title: "Exploration suit", model: "NASA spacesuit model (EVA suit with life-support backpack)",
      rows: [["Role", "Every Marswalk"], ["Design", "8 h life support, rear entry, Marswalk on the visor, always two crew"], ["Evidence", "8-hour EVA class like the ISS spacesuit; 30% oxygen reserve is our mission rule"]] },
    { id: "insight", title: "Solar power", model: "InSight lander with its solar arrays deployed",
      rows: [["Role", "Greenhouse lighting and backup power"], ["Design", "Large round arrays, cleaned by crew; a 40 kW fission unit carries the base"], ["Evidence", `Mars gets ~${Math.round(N.sunMars / N.sunEarth * 100)}% of Earth’s sunlight; dust ended InSight in 2022 and Opportunity in 2018. NASA Fission Surface Power targets ${N.fissionKw} kW`]] },
    { id: "m2020", title: "Oxygen plant", model: "Perseverance rover, which carried the MOXIE oxygen experiment",
      rows: [["Role", "Breathing oxygen and ascent propellant"], ["Design", "Splits CO₂ from the air; ~1.3 kg per hour, running a full launch window before the crew"], ["Evidence", `MOXIE made 122 g of oxygen in Jezero, up to ${N.moxieBest} g per hour; we need ~110× that`]] },
    { id: "rassor", title: "Regolith miner", model: "NASA RASSOR excavation robot",
      rows: [["Role", "Water from the ground"], ["Design", "Digs clay- and sulfate-rich soil and feeds an oven that bakes out water"], ["Evidence", "Jezero has hydrated clays and sulfates but no shallow ice; NASA built RASSOR to dig in low gravity"]] },
    { id: "iss", title: "Life support and greenhouse", model: "International Space Station, where both were proven",
      rows: [["Role", "Recycled water and fresh food"], ["Design", "98% water recycling; pressurised hydroponic greenhouse with LEDs and perchlorate-free water"], ["Evidence", "The ISS reached 98% water recovery; NASA’s Veggie grew lettuce astronauts ate in orbit"]] },
    { id: "sev", title: "Pressurised rover", model: "NASA Space Exploration Vehicle prototype",
      rows: [["Role", "Reach targets beyond walking range"], ["Design", "Carries two crew in shirt-sleeves, suits dock to the back; doubles as a safe haven"], ["Evidence", "Our live traverse finds no low-risk walking route to the crater rim lookout"]] },
    { id: "mro", title: "Communications relay", model: "Mars Reconnaissance Orbiter",
      rows: [["Role", "Link between the base and Earth"], ["Design", "Orbiters relay data; the crew plans and decides locally with Marswalk"], ["Evidence", "Radio takes about 3 to 22 minutes one way; MRO already relays rover data"]] },
  ];

  const RESULTS = [
    { icon: "test-tube", title: "Samples that can answer the life question", measure: "Field notes, images and position for every sample", success: "≥ 20 samples (minimum), ≥ 60 (full)", value: ["Science"], why: "Labs on Earth can look for biosignatures with instruments no rover can carry." },
    { icon: "layers", title: "Climate timeline of an ancient lake", measure: "Measured layer sections, dated samples, weather records", success: "Sections logged at the delta front and Belva", value: ["Science", "Earth"], why: "Shows how a habitable planet dried out, a natural experiment for climate science." },
    { icon: "activity", title: "Walking models checked on real people", measure: "Walk times, heart rate and oxygen use vs Marswalk predictions", success: "Prediction error under 15%", value: ["Exploration", "Earth"], why: "Later crews plan safer walks; the same models help mountain rescue on Earth." },
    { icon: "wind", title: "Oxygen made on Mars at scale", measure: "Plant output over ~26 months", success: "Ascent tanks full before the crew launches", value: ["Exploration"], why: "Every kilogram made on Mars never has to be launched from Earth." },
    { icon: "sprout", title: "First harvest on another planet", measure: "Growth, yield and water use per plant", success: "Seeds germinate (minimum), one harvest (full)", value: ["Exploration", "Earth"], why: "Food for long stays; water-efficient growing for dry regions such as Central Asia." },
    { icon: "heart-pulse", title: "Human health data from Mars", measure: "Dose inside and outside, dust exposure, adaptation to 0.38 g", success: "Complete records for all four crew", value: ["Exploration"], why: "Sets the medical rules for longer stays and future bases." },
  ];

  // ---------- Отрисовка ----------
  function heroArt() {
    $("cx-hero-art").innerHTML = `
      <svg viewBox="0 0 520 300" preserveAspectRatio="xMidYMid slice" class="cx-scene" role="img" aria-label="Base at Jezero with habitat, greenhouse and power">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1430"/><stop offset=".55" stop-color="#6a3a2c"/><stop offset="1" stop-color="#c47a4f"/></linearGradient>
          <linearGradient id="gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a95f3b"/><stop offset="1" stop-color="#5a2f1d"/></linearGradient>
          <radialGradient id="sunG"><stop offset="0" stop-color="#fff6e0"/><stop offset="1" stop-color="rgba(255,240,210,0)"/></radialGradient>
        </defs>
        <rect width="520" height="300" fill="url(#sky)"/>
        <circle cx="400" cy="70" r="40" fill="url(#sunG)"/><circle cx="400" cy="70" r="7" fill="#fffaf0"/>
        <path d="M0 170 Q80 140 160 160 T320 150 T520 158 V300 H0 Z" fill="#7c4430" opacity=".7"/>
        <path d="M0 190 Q120 170 260 186 T520 182 V300 H0 Z" fill="url(#gnd)"/>
        <g transform="translate(120 150)"><path d="M0 60 Q0 8 50 0 Q100 8 100 60 Z" fill="#e9e6dc"/><path d="M50 0 Q100 8 100 60 H50 Z" fill="#b9b5aa"/><rect x="40" y="38" width="20" height="22" rx="10" fill="#39429e"/></g>
        <g transform="translate(240 162)"><path d="M0 48 Q0 4 45 0 Q90 4 90 48 Z" fill="rgba(210,240,255,.45)" stroke="#e9f2f7" stroke-width="1.5"/>
          <g fill="#7fbf4a"><path d="M18 48 q-6 -14 2 -20 q3 10 -2 20z"/><path d="M34 48 q-6 -18 4 -24 q2 14 -4 24z"/><path d="M52 48 q-4 -18 6 -22 q0 12 -6 22z"/><path d="M68 48 q-2 -12 6 -16 q0 10 -6 16z"/></g>
          <ellipse cx="45" cy="30" rx="40" ry="18" fill="rgba(207,226,106,.15)"/></g>
        <g transform="translate(360 186)"><path d="M0 24 L40 10 L66 22 L26 36 Z" fill="#3b49b8"/><path d="M0 24 L26 36 L26 39 L0 27 Z" fill="#141a45"/><line x1="30" y1="36" x2="30" y2="48" stroke="#6d6a62" stroke-width="3"/></g>
        <g transform="translate(60 196)"><rect x="0" y="0" width="22" height="34" rx="6" fill="#e9e6dc"/><ellipse cx="11" cy="0" rx="11" ry="4" fill="#f5f3ec"/></g>
        <path d="M150 238 C200 230 260 252 330 236 S440 226 500 232" stroke="#cfe26a" stroke-width="3" fill="none" stroke-dasharray="6 7" opacity=".9"/>
        <g transform="translate(440 216)"><circle cx="0" cy="0" r="4" fill="#f3f2ee"/><rect x="-3" y="4" width="6" height="10" rx="2" fill="#f3f2ee"/></g>
        <g transform="translate(456 220)"><circle cx="0" cy="0" r="4" fill="#f3f2ee"/><rect x="-3" y="4" width="6" height="10" rx="2" fill="#f3f2ee"/></g>
      </svg>
      <img class="cx-zyro" data-zyro-body alt="">`;
  }

  let phase = 0, playTimer = null;
  function renderPipe() {
    $("pipe-nodes").innerHTML = PHASES.map((p, i) => `<button type="button" class="pnode" data-i="${i}" aria-label="${p.title}">
      <span class="pn-ico">${ic(p.icon)}</span><b>${p.title}</b><small>${p.when}</small></button>`).join("");
    $("pipe-nodes").addEventListener("click", (e) => { const b = e.target.closest(".pnode"); if (b) { stopPlay(); go(Number(b.dataset.i)); } });
    $("pipe-prev").addEventListener("click", () => { stopPlay(); go(Math.max(0, phase - 1)); });
    $("pipe-next").addEventListener("click", () => { stopPlay(); go(Math.min(PHASES.length - 1, phase + 1)); });
    $("pipe-play").addEventListener("click", () => { if (playTimer) { stopPlay(); if (root.Zyro) root.Zyro.stopSpeaking(); } else startPlay(); });
    root.addEventListener("resize", () => go(phase, true));
  }
  function go(i, silent) {
    phase = i;
    const p = PHASES[i];
    const nodes = [...document.querySelectorAll(".pnode")];
    nodes.forEach((n, k) => { n.classList.toggle("on", k === i); n.classList.toggle("done", k < i); });
    const host = $("pipe"), node = nodes[i];
    if (host && node) {
      const hr = host.getBoundingClientRect(), nr = node.getBoundingClientRect();
      const x = nr.left - hr.left + host.scrollLeft + nr.width / 2;
      const z = $("pipe-zyro");
      z.style.transform = `translateX(${x}px)`;
      z.classList.toggle("flip", x > host.scrollWidth * 0.6);
      z.classList.remove("hop"); void z.offsetWidth; z.classList.add("hop");
      $("pipe-fill").style.width = `${(i / (PHASES.length - 1)) * 100}%`;
      if (!silent && node.scrollIntoView && host.scrollWidth > host.clientWidth) node.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
    $("pipe-say").textContent = p.say;
    $("pipe-detail").innerHTML = `
      <div class="pd-head"><span class="pd-ico">${ic(p.icon)}</span><div><span class="eyebrow">Phase ${i + 1} of ${PHASES.length} · ${p.when}</span><h3>${p.title}</h3></div></div>
      <div class="pd-grid">
        <div><small>What happens</small><p>${p.what}</p></div>
        <div><small>Scientific basis</small><p>${p.basis}</p></div>
        <div><small>In Marswalk</small><p>${p.app}</p></div>
        <div><small>Output</small><p><b>${p.out}</b></p></div>
      </div>`;
    // Zyro озвучивает всё, что пишет в пузыре
    if (!silent && root.Zyro) return root.Zyro.speak(p.say);
    return Promise.resolve(false);
  }
  // Проигрывание: следующая фаза — после того как Zyro договорит (или через 6,5 с без голоса)
  let playId = 0;
  function startPlay() {
    $("pipe-play").innerHTML = `${ic("pause")}Pause`;
    if (phase >= PHASES.length - 1) phase = 0;
    const id = ++playId;
    playTimer = 1;
    const step = async () => {
      if (id !== playId) return;
      if (root.Buddy) root.Buddy.hide();
      const t0 = Date.now();
      const spoke = await go(phase);
      if (id !== playId) return;
      const wait = spoke ? 900 : Math.max(0, 6500 - (Date.now() - t0));
      playTimer = setTimeout(() => {
        if (id !== playId) return;
        if (phase < PHASES.length - 1) { phase++; step(); } else stopPlay();
      }, wait);
    };
    step();
  }
  function stopPlay() {
    playId++;
    clearTimeout(playTimer); playTimer = null;
    $("pipe-play").innerHTML = `${ic("play")}Play`;
  }

  function renderGantt() {
    // Месяцы от старта экипажа (0). Отрицательные — подготовка.
    const surfaceMonths = N.surfaceSols * N.solDays / 30.44, transit = N.transitDays / 30.44;
    const rows = [
      ["Site selection and design", -60, -30, "#5b5f69"],
      ["Cargo launch and transit", -26, -26 + transit, "#8f6b22"],
      ["Oxygen plant fills ascent tanks", -26 + transit, 7 + surfaceMonths, "#2d6468"],
      ["Crew transit to Mars", 0, transit, "#39429e"],
      ["Surface campaign (~500 sols)", transit, transit + surfaceMonths, "#cfe26a"],
      ["Marswalks", transit + 1, transit + surfaceMonths - 1, "#a8bd4a"],
      ["Greenhouse pilot", transit + 2, transit + surfaceMonths, "#6aa84f"],
      ["Return to Earth", transit + surfaceMonths, 2 * transit + surfaceMonths, "#39429e"],
    ];
    const lo = -62, hi = 34, W = 760, L = 210, rowH = 26, H = rows.length * rowH + 30;
    const X = (m) => L + ((m - lo) / (hi - lo)) * (W - L - 10);
    let ticks = "";
    for (let m = -60; m <= 30; m += 10) ticks += `<line x1="${X(m)}" x2="${X(m)}" y1="0" y2="${H - 22}" class="g-grid"/><text x="${X(m)}" y="${H - 6}" class="g-txt" text-anchor="middle">${m > 0 ? "+" : ""}${m}</text>`;
    $("gantt").innerHTML = `<div class="table-scroll"><svg viewBox="0 0 ${W} ${H}" class="gantt" role="img" aria-label="Mission timeline in months from crew launch">
      ${ticks}<line x1="${X(0)}" x2="${X(0)}" y1="0" y2="${H - 22}" class="g-zero"/><text x="${X(0) + 4}" y="12" class="g-txt strong">Crew launch</text>
      ${rows.map(([name, a, b, c], k) => `<text x="0" y="${k * rowH + 30}" class="g-label">${name}</text>
        <rect x="${X(a)}" y="${k * rowH + 18}" width="${Math.max(3, X(b) - X(a))}" height="16" rx="4" fill="${c}"/>`).join("")}
      <text x="${W - 10}" y="${H - 6}" class="g-txt" text-anchor="end">months</text></svg></div>`;
  }

  function renderObjectives() {
    $("obj-table").innerHTML = `<thead><tr><th>MEPAG goal</th><th>Objective</th><th>Where in Jezero</th><th>Method</th><th>Expected result</th><th>Value</th></tr></thead>
      <tbody>${OBJECTIVES.map((o) => `<tr>
        <td><span class="goal-cell"><span class="obj-ico">${ic(o.icon)}</span><span>${o.goal.replace(" · ", "<br><b>")}</b></span></span></td>
        <td class="strong">${o.title}</td><td>${o.where}</td><td>${o.how}</td><td>${o.expected}</td><td class="val">${o.value}</td></tr>`).join("")}</tbody>`;
  }

  function renderSystems() {
    const IMG = root.SYSTEM_IMG || {};
    $("sys-grid").innerHTML = SYSTEMS.map((s, i) => `<article class="card sys">
      <div class="sys-photo">${IMG[s.id] ? `<img src="${IMG[s.id]}" alt="${s.model}" loading="lazy">` : ""}<span class="sys-n mono">${String(i + 1).padStart(2, "0")}</span></div>
      <div class="sys-body"><h3>${s.title}</h3><p class="sys-model">${ic("box")}<span>${s.model}</span></p>
        <dl>${s.rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl></div></article>`).join("");
  }

  function hbar(rows, max, opts = {}) {
    const W = 360, rowH = 34, H = rows.length * rowH + (opts.limit ? 26 : 8);
    const X = (v) => 8 + (v / max) * (W - 16);
    return `<svg viewBox="0 0 ${W} ${H}" class="hbar" role="img" aria-label="${opts.label || ""}">
      ${rows.map(([name, v, color, txt], k) => `<text x="8" y="${k * rowH + 12}" class="hb-label">${name}</text>
        <rect x="8" y="${k * rowH + 17}" width="${W - 16}" height="9" rx="4.5" class="hb-track"/>
        <rect x="8" y="${k * rowH + 17}" width="${Math.max(3, X(v) - 8)}" height="9" rx="4.5" fill="${color}"/>
        <text x="${W - 8}" y="${k * rowH + 12}" class="hb-val" text-anchor="end">${txt}</text>`).join("")}
      ${opts.limit ? `<line x1="${X(opts.limit)}" x2="${X(opts.limit)}" y1="12" y2="${H - 14}" class="hb-limit"/><text x="${X(opts.limit)}" y="${H - 2}" class="hb-lt" text-anchor="middle">${opts.limitLabel}</text>` : ""}
    </svg>`;
  }

  function renderBudgets() {
    const out = N.transitDays * N.cruiseDose, surf = N.surfaceSols * N.solDays * N.surfaceDose, total = 2 * out + surf;
    $("chart-rad").innerHTML = hbar([
      ["Transit to Mars", out, "#39429e", `${Math.round(out)} mSv`],
      ["~500 sols on the surface", surf, "#8f6b22", `${Math.round(surf)} mSv`],
      ["Transit home", out, "#39429e", `${Math.round(out)} mSv`],
      ["Total, no extra shielding", total, "#b5473a", `${Math.round(total)} mSv`],
    ], Math.max(total, N.careerLimit) * 1.05, { limit: N.careerLimit, limitLabel: `NASA career limit ${N.careerLimit} mSv`, label: "Radiation dose budget" });
    $("big-rad").innerHTML = `<b>${(total / 1000).toFixed(1)} Sv</b><span>mission dose without extra shielding, vs a <b>${(N.careerLimit / 1000).toFixed(1)} Sv</b> career limit</span>`;
    $("rad-note").textContent = `Using RAD’s ${N.cruiseDose} mSv/day in cruise and ${N.surfaceDose} mSv/day on the surface, the mission dose is ~${(total / 1000).toFixed(1)} Sv, about ${(total / N.careerLimit).toFixed(1)}× the limit. Shielding must cut it by ~${Math.round((1 - N.careerLimit / total) * 100)}%, mostly in transit. A 4-hour Marswalk adds only ~${(4 / 24 * N.surfaceDose).toFixed(2)} mSv: time on Mars matters, not walk length.`;

    const yearsOnMars = N.surfaceSols * N.solDays / 365.25, breathe = N.breatheTonPerYear * yearsOnMars;
    const rateKgH = N.ascentO2 * 1000 / N.windowDays / 24;
    $("chart-o2").innerHTML = `<small class="ch-cap">Oxygen needed (tonnes)</small>` + hbar([
      ["Ascent propellant oxygen", N.ascentO2, "#2d6468", `${N.ascentO2} t`],
      ["Crew breathing, ~500 sols", breathe, "#5aa0a6", `${breathe.toFixed(1)} t`],
    ], N.ascentO2 * 1.05, { label: "Oxygen mass budget" }) + `<small class="ch-cap">Production rate (kg per hour)</small>` + hbar([
      ["Needed: ascent oxygen in one window", rateKgH, "#cfe26a", `${rateKgH.toFixed(1)} kg/h`],
      ["MOXIE on Perseverance, best", N.moxieBest / 1000, "#8d919b", `${N.moxieBest} g/h`],
    ], rateKgH * 1.05, { label: "Oxygen production rate" });
    $("big-o2").innerHTML = `<b>${Math.round(rateKgH * 1000 / N.moxieBest)}×</b><span>MOXIE’s best rate is needed to fill the ascent tanks in one launch window</span>`;
    $("o2-note").textContent = `NASA estimates ~${N.ascentO2} t of oxygen (plus ~7 t of fuel) to launch four astronauts off Mars, and ~1 t per year for them to breathe. Making the ascent oxygen in one launch window (~26 months) needs ~${rateKgH.toFixed(1)} kg/h, about ${Math.round(rateKgH * 1000 / N.moxieBest)}× MOXIE’s best ${N.moxieBest} g/h.`;

    const jezero = N.sunMars * Math.cos(18.44 * Math.PI / 180);
    $("chart-power").innerHTML = hbar([
      ["Sunlight at Earth (W/m²)", N.sunEarth, "#8d919b", `${N.sunEarth}`],
      ["Sunlight at Mars, average", N.sunMars, "#8f6b22", `${N.sunMars}`],
      ["Jezero, latitude factor", jezero, "#cfe26a", `${Math.round(jezero)}`],
    ], N.sunEarth * 1.05, { label: "Sunlight comparison" });
    $("big-power").innerHTML = `<b>${N.fissionKw} kW</b><span>fission power that keeps running through dust storms</span>`;
    $("power-note").textContent = `Mars receives ~${Math.round(N.sunMars / N.sunEarth * 100)}% of Earth’s sunlight at the top of the atmosphere, and dust lowers it further. A ${N.fissionKw} kW fission unit (NASA Fission Surface Power) keeps the base running through dust storms; solar arrays feed the greenhouse and act as backup.`;
  }

  // Walk campaign: the backend's lowest-terrain-risk route to every Jezero target, then the same SIMULATED walk check as the Marswalk tab.
  async function renderTraverse() {
    const tbl = $("traverse"), api = root.MarswalkApi, R = root.Router;
    let rows;
    try {
      const jez = (await api.regions()).find((r) => r.id === "jezero");
      const t = R.createTerrain(await api.terrain(jez));
      const start = { lat: jez.landing.lat, lon: jez.landing.lon };
      rows = await Promise.all(root.TARGETS.map(async (tg) => {
        const res = await api.planRoute({ start, destination: { lat: tg.latlng[0], lon: tg.latlng[1] }, modes: ["LOWEST_TERRAIN_RISK"], max_slope_deg: 15 }, jez);
        const alt = res.alternatives[0]; // one mode asked, one alternative answered
        if (alt.status !== "found") return { tg, none: alt.reason || "No route was found." };
        const w = R.walkSeconds(t, alt.geometry.coordinates.map(([lon, lat]) => t.cellOf(lat, lon)), { maxSlope: 15 });
        return { tg, sum: { distance: alt.total_distance_m, maxSlope: alt.max_slope_deg },
          eva: R.evaluateEva({ ...w, stopMinutes: tg.minutes || 0, suitHours: 8, dustTau: 0.45, startHour: 9 }) };
      }));
    } catch (_) {
      tbl.innerHTML = "<tr><td>The Marswalk backend did not answer, so no walks are calculated.</td></tr>";
      $("traverse-note").textContent = "";
      return;
    }
    rows.sort((a, b) => (a.none ? 1e9 : a.sum.distance) - (b.none ? 1e9 : b.sum.distance));
    const fmt = (sec) => { const m = Math.round(sec / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
    tbl.innerHTML = `<thead><tr><th>Target</th><th>One way</th><th>Walk + science</th><th>Max slope</th><th>Suit O₂</th><th>Verdict</th><th>Why go there</th></tr></thead>
      <tbody>${rows.map((r) => r.none ? `<tr><td>${r.tg.name}</td><td colspan="6">No lowest-risk walking route. ${r.none}</td></tr>` : `<tr>
        <td><span class="tv-name"><span class="s-ico">${ic(r.tg.icon)}</span>${r.tg.name}</span></td>
        <td class="mono">${(r.sum.distance / 1000).toFixed(1)} km</td><td class="mono">${fmt(r.eva.totalS)}</td>
        <td class="mono">${r.sum.maxSlope.toFixed(0)}°</td>
        <td><div class="tv-o2"><i style="width:${Math.min(100, Math.round(r.eva.o2Used * 100))}%" class="${r.eva.o2Used > 0.7 ? "hi" : ""}"></i></div><span class="mono">${Math.round(r.eva.o2Used * 100)}%</span></td>
        <td>${r.eva.go ? `<span class="tag ok">${ic("check")}Walkable</span>` : `<span class="tag bad">${ic("x")}${r.eva.reasons.includes("suit") ? "Beyond suit range" : "No go"}</span>`}</td>
        <td class="tv-why">${r.tg.why || ""}</td></tr>`).join("")}</tbody>`;
    const ok = rows.filter((r) => !r.none && r.eva.go), far = rows.filter((r) => !r.none && !r.eva.go);
    $("traverse-note").textContent = `${ok.length} of ${rows.length} targets pass the walk check from the habitat on the lowest-terrain-risk route.${far.length ? ` ${far.map((r) => r.tg.name).join(", ")} ${far.length > 1 ? "need" : "needs"} a small rover or a supply cache halfway: ${(far[0].sum.distance / 1000).toFixed(1)} km one way would use ${Math.round(far[0].eva.o2Used * 100)}% of the suit’s oxygen.` : ""}`;
  }

  function renderResults() {
    $("res-table").innerHTML = `<thead><tr><th>Expected result</th><th>Measured by</th><th>Success criterion</th><th>Value for</th><th>Why it matters</th></tr></thead>
      <tbody>${RESULTS.map((r) => `<tr>
        <td><span class="goal-cell"><span class="obj-ico">${ic(r.icon)}</span><b>${r.title}</b></span></td>
        <td>${r.measure}</td><td class="strong">${r.success}</td>
        <td>${r.value.map((v) => `<span class="val-tag v-${v.toLowerCase()}">${v}</span>`).join("")}</td><td>${r.why}</td></tr>`).join("")}</tbody>`;
  }

  // Фильм миссии: при открытии вкладки играет со звуком (переход по вкладке — это нажатие,
  // поэтому браузер разрешает звук). Если браузер всё же запретит, играет без звука с кнопкой «Sound on».
  // Уход со вкладки — пауза; пока говорит Zyro, звук фильма приглушается.
  let videoReady = false, userVolume = 0.9, ducked = false;
  function playWithSound() {
    const v = $("cx-video");
    if (!v) return;
    v.muted = false;
    v.volume = ducked ? Math.min(userVolume, 0.15) : userVolume;
    const p = v.play();
    if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); });
  }
  function initVideo() {
    const v = $("cx-video"), b = $("cx-unmute");
    if (!v || videoReady) return;
    videoReady = true;
    const sync = () => { b.hidden = !v.muted; };
    v.addEventListener("volumechange", () => { if (!ducked && !v.muted) userVolume = v.volume || userVolume; sync(); });
    b.addEventListener("click", () => {
      if (root.Zyro) root.Zyro.stopSpeaking();
      playWithSound();
    });
    // уход со вкладки — пауза (и видео, и звук)
    const obs = new MutationObserver(() => { if (!$("view-concept").hasAttribute("data-active")) v.pause(); });
    obs.observe($("view-concept"), { attributes: true, attributeFilter: ["data-active"] });
    // голос Zyro поверх фильма: приглушаем фильм, потом возвращаем громкость
    root.addEventListener("zyro-speech", (e) => {
      if (e.detail.state === "start") { ducked = true; if (!v.muted) v.volume = Math.min(userVolume, 0.15); }
      else if (e.detail.state === "end") { ducked = false; if (!v.muted) v.volume = userVolume; }
    });
    sync();
  }

  let built = false;
  function show() {
    if (!built) {
      built = true;
      initVideo(); renderPipe(); renderGantt(); renderObjectives(); renderSystems(); renderBudgets(); renderResults();
      if (root.Zyro && root.ASSETS) document.querySelectorAll("#view-concept [data-zyro-face]").forEach((el) => { el.src = root.ASSETS.nova.cool; });
      document.querySelectorAll("#view-concept [data-zyro-body]").forEach((el) => { el.src = root.ASSETS.nova.body; });
      setTimeout(renderTraverse, 50);
      if (root.lucide) root.lucide.createIcons();
    }
    requestAnimationFrame(() => go(phase, true));
    playWithSound(); // каждое открытие вкладки — фильм со звуком
  }

  root.Concept = { show, go: (i) => go(i), play: startPlay, stop: stopPlay, PHASES };
})(window);
