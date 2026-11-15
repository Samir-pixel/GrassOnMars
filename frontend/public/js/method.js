// Вкладка «Method»: откуда данные NASA, как считаем (с пошаговыми вычислениями) и простое объяснение.
(function (root) {
  const $ = (id) => document.getElementById(id);
  const ic = (n) => root.icon(n);
  const f1 = (x, d = 1) => Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

  // Константы с источниками (NASA Mars Fact Sheet, миссии)
  const K = {
    P0: 610, H: 11.1,                 // Па на нулевом уровне MOLA; шкала высот 11,1 км (Mars Fact Sheet)
    Pmean: 636,                        // средн. давление у поверхности, 6,36 мбар (Mars Fact Sheet)
    S0: 1361, au: 1.524, peri: 1.381, aph: 1.666,
    medaLo: 754, medaHi: 771,          // Pa, lowest and highest MEDA pressure of sol 100 (NASA PDS, served by /api/v1/environment)
    sol: 88775.244,                    // с, длина солнечных суток
    suitH: 8, reserve: 1.3,
    dose: 0.67, cruise: 1.84,          // мЗв/сут (Curiosity RAD)
  };

  const LINKS = {
    factsheet: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html",
    pdsgeo: "https://pds-geosciences.wustl.edu/",
    mola: "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m",
    ctxdtm: "https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic",
    waypoints: "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json",
    iau: "https://planetarynames.wr.usgs.gov/",
    pdsatm: "https://pds-atmospheres.nmsu.edu/",
    pdsppi: "https://pds-ppi.igpp.ucla.edu/",
    m2020: "https://science.nasa.gov/mission/mars-2020-perseverance/",
    mars24: "https://www.giss.nasa.gov/tools/mars24/",
    trek: "https://trek.nasa.gov/mars/",
    pj: "https://science.nasa.gov/photojournal/",
    heasarc: "https://heasarc.gsfc.nasa.gov/",
    n3d: "https://github.com/nasa/NASA-3D-Resources",
  };

  const DATA = [
    { name: "MOLA elevation", by: "Mars Global Surveyor", measures: "Height of the whole planet by laser", res: "463 m per pixel (128 px/degree)", use: "Site elevation and slopes → air pressure, exploration limits; terrain, hazards and routes in the 13 regions outside Jezero", link: LINKS.mola, host: "USGS Astrogeology", st: "live" },
    { name: "CTX elevation model", by: "Mars Reconnaissance Orbiter", measures: "3D terrain of Jezero from stereo photos", res: "20 m grid, read every 60 m", use: "Jezero slopes, hazard grid, walking routes, 3D view", link: LINKS.ctxdtm, host: "USGS Astrogeology", st: "live" },
    { name: "HiRISE and CTX images", by: "Mars Reconnaissance Orbiter", measures: "Close-up and context photos", res: "0.25 m and 6 m per pixel", use: "Imagery layers of the Jezero map", link: LINKS.trek, host: "NASA Mars Trek", st: "live" },
    { name: "THEMIS infrared", by: "Mars Odyssey", measures: "Heat given off by the ground, day and night", res: "100 m per pixel", use: "Thermal map on the Environment tab and the Marswalk map", link: LINKS.trek, host: "NASA Mars Trek", st: "live" },
    { name: "CRISM minerals", by: "Mars Reconnaissance Orbiter", measures: "Infrared spectra of minerals", res: "18 m per pixel (targeted)", use: "Hydrated-mineral layer of the Jezero map; water evidence, science targets", link: LINKS.pdsgeo, host: "PDS Geosciences", st: "live" },
    { name: "SHARAD radar", by: "Mars Reconnaissance Orbiter", measures: "Echoes from buried ice layers", res: "Sounds hundreds of metres down", use: "Buried ice → water score", link: LINKS.pdsgeo, host: "PDS Geosciences", st: "cited" },
    { name: "MEDA weather", by: "Perseverance", measures: "Pressure, temperature, humidity, wind", res: "Sol tables from the PDS archive", use: "Environment charts, Jezero weather, pressure model check", link: LINKS.pdsatm, host: "PDS Atmospheres", st: "live" },
    { name: "Rover waypoints", by: "Perseverance", measures: "Where the rover stopped, sol by sol", res: "One position per stop", use: "Walk destinations and science targets in Jezero", link: LINKS.waypoints, host: "NASA Mars 2020", st: "live" },
    { name: "IAU place names", by: "USGS / IAU Gazetteer", measures: "Official names of craters, valleys and plains", res: "Centre point and size of each feature", use: "Walk destinations outside Jezero", link: LINKS.iau, host: "USGS Gazetteer", st: "live" },
    { name: "RAD radiation", by: "Curiosity", measures: "Radiation dose on the way and on the surface", res: "0.67 mSv/day surface, 1.84 mSv/day cruise", use: "Dose per walk and per mission", link: LINKS.pdsppi, host: "PDS PPI", st: "value" },
    { name: "MOXIE oxygen", by: "Perseverance", measures: "Oxygen made from Martian CO₂", res: "122 g total, up to 12 g/h", use: "Oxygen plant scale in the mission concept", link: LINKS.m2020, host: "NASA Science", st: "value" },
    { name: "Mars24 time", by: "NASA GISS", measures: "Local Mars time and sol count", res: "Allison & McEwen (2000)", use: "Mars clock, back-before-dark rule", link: LINKS.mars24, host: "NASA GISS", st: "live" },
    { name: "Mars Fact Sheet", by: "NASA NSSDCA", measures: "Physical constants of Mars", res: "Scale height 11.1 km, sunlight 586 W/m²", use: "Constants in every formula", link: LINKS.factsheet, host: "NASA NSSDCA", st: "value" },
    { name: "Photojournal", by: "NASA / JPL", measures: "Official mission images", res: "20+ images, PIA numbers", use: "Site photos", link: LINKS.pj, host: "NASA Photojournal", st: "live" },
  ];
  // "Published value": a number quoted from the source; the measurement series itself is not loaded.
  const ST = { live: ["In the product", "ok"], cited: ["Cited in ratings", "mid"], value: ["Published value", "mid"] };

  // ---------- Вычисления: формула, шаги с числами NASA, результат, простое объяснение ----------
  function standardAtmosphere(pa) {
    const t = [[25, 2549.2], [30, 1197.0], [32, 868.0], [35, 574.6], [40, 287.1], [45, 149.1], [47, 110.9], [50, 79.8], [55, 42.5]];
    for (let i = 0; i < t.length - 1; i++) if (pa <= t[i][1] && pa >= t[i + 1][1]) return { lo: t[i], hi: t[i + 1] };
    return null;
  }
  const CALCS = [
    { id: "pressure", icon: "gauge", title: "Air pressure at a site", site: true,
      formula: "P = P₀ · e<sup>−h / H</sup>",
      calc(s) {
        const x = -s.elevKm / K.H, e = Math.exp(x), P = K.P0 * e;
        return { steps: [
          ["Elevation h (MOLA)", `${f1(s.elevKm, 1)} km`],
          ["Scale height H (Mars Fact Sheet)", `${K.H} km`],
          ["Datum pressure P₀", `${K.P0} Pa`],
          ["−h / H", f1(x, 3)], ["e^(−h/H)", f1(e, 3)],
        ], result: `${Math.round(P)} Pa`, note: s.id === "jezero" ? `Perseverance MEDA measured ${K.medaLo}–${K.medaHi} Pa at Jezero on sol 100 (NASA PDS): the model is within ${Math.ceil((P / K.medaLo - 1) * 100)}% of that range.` : `NASA’s planet-wide average is ${K.Pmean} Pa; Earth at sea level has 101,325 Pa.` };
      },
      simple: "Air gets thinner as you go up. Low places on Mars, like deep craters and basins, have more air above them, which helps a spacecraft slow down for landing and blocks a bit more radiation." },
    { id: "earthalt", icon: "plane", title: "Same air on Earth", site: true,
      formula: "h<sub>Earth</sub>: P<sub>Earth</sub>(h) = P<sub>Mars</sub>",
      calc(s) {
        const P = K.P0 * Math.exp(-s.elevKm / K.H), b = standardAtmosphere(P), h = root.earthAltitudeForPressure(P);
        return { steps: [
          ["Mars pressure at the site", `${Math.round(P)} Pa`],
          ["Bracket (US Standard Atmosphere)", b ? `${b.lo[0]} km = ${b.lo[1]} Pa … ${b.hi[0]} km = ${b.hi[1]} Pa` : "outside table"],
          ["Log-interpolate between them", "ln P is linear in height"],
        ], result: `${f1(h, 0)} km above Earth`, note: "Passenger jets fly at about 11 km; weather balloons usually burst around 30–35 km." };
      },
      simple: "We find how high above Earth you would have to fly to breathe air this thin. For most of Mars that is higher than any plane flies, so a spacesuit is always needed." },
    { id: "sun", icon: "sun", title: "Sunlight for solar power", site: true,
      formula: "S = S<sub>Earth</sub> / d² · cos φ",
      calc(s) {
        const mean = K.S0 / (K.au * K.au), peri = K.S0 / (K.peri * K.peri), aph = K.S0 / (K.aph * K.aph), lat = Math.cos(s.lat * Math.PI / 180);
        return { steps: [
          ["Sunlight at Earth S_Earth", `${K.S0} W/m²`],
          ["Mean distance d (Mars Fact Sheet)", `${K.au} AU → ${Math.round(mean)} W/m²`],
          ["Closest / farthest from the Sun", `${K.peri} AU → ${Math.round(peri)}; ${K.aph} AU → ${Math.round(aph)} W/m²`],
          [`Latitude factor cos(${f1(s.lat, 1)}°)`, f1(lat, 3)],
        ], result: `≈ ${Math.round(mean * lat)} W/m² (yearly proxy)`, note: "Dust in the air lowers this further; a global dust storm can block most of it for weeks." };
      },
      simple: "Mars is about one and a half times farther from the Sun than Earth, so sunlight there is less than half as strong. Places near the equator get the most." },
    { id: "walk", icon: "footprints", title: "Walking speed in a spacesuit", slider: { label: "Slope", min: -20, max: 20, step: 1, value: 5, unit: "°" },
      formula: "v = 0.6 · 6 · e<sup>−3.5 |tan θ + 0.05|</sup> km/h",
      calc(_, deg) {
        const s = Math.tan(deg * Math.PI / 180), inner = Math.abs(s + 0.05), tob = 6 * Math.exp(-3.5 * inner), v = 0.6 * tob;
        return { steps: [
          ["Slope θ", `${deg}° → tan θ = ${f1(s, 3)}`],
          ["Tobler’s hiking function", `6 · e^(−3.5 × ${f1(inner, 3)}) = ${f1(tob, 2)} km/h`],
          ["Suit factor (our assumption)", "× 0.6"],
        ], result: `${f1(v, 2)} km/h · 1 km takes ${Math.round(60 / v)} min`, note: "Tobler’s function is fitted to human hikers on Earth; the suit factor will be checked against real Marswalks." };
      },
      simple: "People walk fastest on a gentle downhill and slower uphill. A spacesuit is heavy and stiff, so we slow everything down to about 60% of a normal hiker." },
    { id: "o2", icon: "wind", title: "Oxygen: go or no go", slider: { label: "Walk + science time", min: 1, max: 9, step: 0.5, value: 4, unit: " h" },
      formula: "t<sub>walk</sub> + t<sub>science</sub> ≤ t<sub>suit</sub> / 1.3",
      calc(_, hours) {
        const limit = K.suitH / K.reserve, used = hours / K.suitH, ok = hours <= limit;
        return { steps: [
          ["Suit life support", `${K.suitH} h`],
          ["Keep 30% in reserve", `${K.suitH} / ${K.reserve} = ${f1(limit, 2)} h usable`],
          ["Planned walk + science", `${f1(hours, 1)} h = ${Math.round(used * 100)}% of the suit`],
        ], result: ok ? `GO · ${f1(limit - hours, 1)} h to spare` : `NO GO · ${f1(hours - limit, 1)} h over the limit`, ok, note: "Marswalk also cancels a walk if dust optical depth reaches 2, or if the crew would return after 17:30 local time." };
      },
      simple: "A spacesuit carries air for about eight hours. We only plan walks that leave almost a third of it unused, so the crew can always get home even if something goes wrong." },
    { id: "dose", icon: "radiation", title: "Radiation on a walk", slider: { label: "Walk length", min: 1, max: 8, step: 0.5, value: 4, unit: " h" },
      formula: "D = 0.67 mSv/day · t",
      calc(_, hours) {
        const d = K.dose * hours / 24, trip = 203 * K.cruise * 2 + 500 * 1.0275 * K.dose;
        return { steps: [
          ["Surface dose rate (Curiosity RAD)", `${K.dose} mSv per day`],
          ["Walk time", `${f1(hours, 1)} h = ${f1(hours / 24, 3)} day`],
          ["Whole mission, no extra shielding", `${Math.round(trip)} mSv`],
        ], result: `${f1(d, 2)} mSv for this walk`, note: "A chest X-ray is about 0.02–0.1 mSv. The real radiation problem is months in space, not hours outside." };
      },
      simple: "Mars has no thick air or magnetic field to block space radiation. One walk adds about as much as a few chest X-rays; the long trip to Mars matters much more." },
    { id: "index", icon: "scale", title: "Suitability index", site: true,
      formula: "S = 100 · Σ w<sub>i</sub> · x<sub>i</sub>",
      calc(s, _, C) {
        const r = C.ranking().all.find((x) => x.s.id === s.id), P = C.PARAMS;
        const terms = P.map((p) => [p.label, r.f.x[p.id], C.state.w[p.id]]);
        const sum = terms.reduce((a, [, x, w]) => a + x * w, 0);
        return { steps: terms.map(([n, x, w]) => [`${n}: x = ${f1(x, 2)}, w = ${f1(w, 2)}`, f1(x * w * 100, 1)]),
          result: `${f1(sum * 100, 1)} of 100${r.excluded.length ? " · excluded by limits" : ` · rank ${r.rank}`}`, note: "Weights come from the mission profile on the Compare tab and can be changed there." };
      },
      simple: "Like a school report: each subject gets a mark from 0 to 1, important subjects count more, and we add everything up to a score out of 100." },
    { id: "clock", icon: "clock", title: "Mars time at Jezero", live: true,
      formula: "LMST from Mars24 (Allison &amp; McEwen 2000)",
      calc() {
        const now = Date.now(), msd = root.MarsClock.marsSolDate(now), t = root.MarsClock.lmst(now, 77.45);
        return { steps: [
          ["One sol", `${f1(K.sol, 0)} s = 24 h 39 min 35 s`],
          ["Mars Sol Date now", f1(msd, 4)],
          ["Perseverance mission sol", String(root.MarsClock.perseveranceSol(now, 77.45))],
        ], result: `${root.MarsClock.fmtHours(t)} LMST at Jezero`, note: "Walks must end before 17:30 local mean solar time to avoid the cold and dark." };
      },
      simple: "A day on Mars, called a sol, is 39 minutes longer than on Earth. We keep our own Mars clock so walks finish before sunset." },
  ];

  let simple = false, site = "jezero", C = null;
  function renderData() {
    $("data-table").innerHTML = `<thead><tr><th>NASA dataset</th><th>Mission</th><th>What it measures</th><th>Resolution / value</th><th>How Marswalk uses it</th><th>Status</th><th>Source</th></tr></thead>
      <tbody>${DATA.map((d) => `<tr><td class="strong">${d.name}</td><td>${d.by}</td><td>${d.measures}</td><td class="mono small">${d.res}</td><td>${d.use}</td>
        <td><span class="st st-${ST[d.st][1]}">${ST[d.st][0]}</span></td>
        <td><a class="src-link" href="${d.link}" target="_blank" rel="noopener">${d.host}${ic("arrow-up-right")}</a></td></tr>`).join("")}</tbody>`;
  }
  function renderCalc(c) {
    const el = $(`calc-${c.id}`), s = root.SITES.find((x) => x.id === site);
    const sl = el.querySelector("input[type=range]");
    const val = sl ? Number(sl.value) : null;
    const r = c.calc(s, val, C);
    el.querySelector(".calc-steps").innerHTML = r.steps.map(([k, v]) => `<li><span>${k}</span><b class="mono">${v}</b></li>`).join("");
    const res = el.querySelector(".calc-result");
    res.textContent = r.result;
    res.classList.toggle("bad", r.ok === false);
    res.classList.toggle("good", r.ok === true);
    el.querySelector(".calc-note").textContent = r.note || "";
    if (sl) el.querySelector(".sl-val").textContent = `${val}${c.slider.unit}`;
    const sub = el.querySelector(".calc-site");
    if (sub) sub.textContent = s.name;
  }
  function renderCalcs() {
    $("calc-grid").innerHTML = CALCS.map((c, i) => `<article class="card calc" id="calc-${c.id}">
      <div class="calc-head"><span class="calc-ico">${ic(c.icon)}</span><div><span class="eyebrow">Calculation ${i + 1}${c.site ? ` · <span class="calc-site"></span>` : c.live ? " · live" : ""}</span><h3>${c.title}</h3></div>
        <button type="button" class="btn sm calc-say" data-id="${c.id}" title="Zyro explains this in plain words">${ic("message-circle")}Explain simply</button></div>
      <p class="calc-formula">${c.formula}</p>
      <p class="simple-note">${ic("sparkles")}<span>${c.simple}</span></p>
      ${c.slider ? `<label class="calc-slider"><span>${c.slider.label}</span><input type="range" min="${c.slider.min}" max="${c.slider.max}" step="${c.slider.step}" value="${c.slider.value}"><b class="sl-val mono"></b></label>` : ""}
      <ol class="calc-steps expert"></ol>
      <div class="calc-result"></div>
      <p class="calc-note muted"></p></article>`).join("");
    CALCS.forEach((c) => {
      const el = $(`calc-${c.id}`);
      const sl = el.querySelector("input[type=range]");
      if (sl) sl.addEventListener("input", () => renderCalc(c));
      renderCalc(c);
    });
    $("calc-grid").addEventListener("click", (e) => {
      const b = e.target.closest(".calc-say");
      if (!b) return;
      const c = CALCS.find((x) => x.id === b.dataset.id);
      const res = $(`calc-${c.id}`).querySelector(".calc-result").textContent;
      const text = `${c.simple} For this example the answer is ${res.replace(/·/g, ",")}.`;
      root.Buddy && root.Buddy.say(text, { mood: "cool", tag: c.title, speak: false });
      root.Zyro && root.Zyro.speak(text);
    });
    setInterval(() => { const c = CALCS.find((x) => x.live); if (c && $(`calc-${c.id}`)) renderCalc(c); }, 10000);
  }
  function setSimple(on) {
    simple = on;
    $("view-method").classList.toggle("simple", on);
    $("simple-toggle").setAttribute("aria-pressed", String(on));
    $("simple-toggle").innerHTML = on ? `${ic("graduation-cap")}Show expert view` : `${ic("sparkles")}Explain simply`;
    if (on && root.Zyro) {
      const t = "Here is how Marswalk decides, in simple words. First, we collect measurements from NASA spacecraft: how high the ground is, where the ice is, how strong the sunlight and radiation are. Second, we turn them into simple numbers with a few formulas you can check on this page. Third, we add them up to rank places on Mars, and we test every walk so the crew always has enough air to come home.";
      root.Buddy && root.Buddy.say(t, { mood: "wink", tag: "In simple words", speak: false });
      root.Zyro.speak(t);
    }
  }

  function init(ctx) {
    C = ctx;
    renderData();
    $("calc-site-select").innerHTML = root.SITES.map((s) => `<option value="${s.id}"${s.id === site ? " selected" : ""}>${s.name}</option>`).join("");
    $("calc-site-select").addEventListener("change", (e) => { site = e.target.value; CALCS.filter((c) => c.site).forEach(renderCalc); });
    renderCalcs();
    $("simple-toggle").addEventListener("click", () => setSimple(!simple));
    document.querySelectorAll(".m-toc a").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const t = document.getElementById(a.dataset.to);
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    if (root.lucide) root.lucide.createIcons();
  }
  function refresh() { CALCS.filter((c) => c.id === "index").forEach(renderCalc); }

  root.Method = { init, refresh, setSimple };
})(window);
