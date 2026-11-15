// Вкладка «Environment»: только измеренные значения с источниками, загрузка рядов MEDA из CSV,
// тепловая карта THEMIS (Mars Trek, онлайн) и честная таблица, что загружено, а что нет.
(function (root) {
  const $ = (id) => document.getElementById(id);
  const ic = (n) => root.icon(n);

  const STATIONS = [
    { where: "Jezero crater", who: "Perseverance · MEDA", kind: "Historical observation", icon: "thermometer",
      rows: [["Air temperature", "−83 °C at night to −22 °C by day (spring 2021); nights can reach −90 °C"], ["Air pressure", "718 Pa"]],
      src: "NASA, first Jezero weather report (2021)" },
    { where: "Gale crater", who: "Curiosity · REMS", kind: "Historical observation", icon: "thermometer-snowflake",
      rows: [["Air temperature", "Winter nights below −120 °C"]], src: "Curiosity REMS reports" },
    { where: "Chryse and Utopia Planitia", who: "Viking Landers 1 and 2", kind: "Historical observation", icon: "satellite-dish",
      rows: [["Air temperature", "−107 °C to −17 °C, 1.5 m above the ground"]], src: "Viking meteorology" },
    { where: "Gale crater surface", who: "Curiosity · RAD", kind: "Historical observation", icon: "radiation",
      rows: [["Radiation dose", "0.67 mSv per day on the surface"], ["In cruise", "1.84 mSv per day"]], src: "Hassler et al. 2014; Zeitlin et al. 2013" },
  ];

  const AVAIL = [
    ["Air temperature", "MEDA ATS · Perseverance", "Jezero, at the rover", "Historical observation", ["Published values", "mid"], "Spring 2021 range", "Load a MEDA CSV above for full sols."],
    ["Air pressure", "MEDA PS · Perseverance", "Jezero, at the rover", "Historical observation", ["Published value", "mid"], "718 Pa", "Used to check our pressure model (+7%)."],
    ["Wind speed and direction", "MEDA WS · Perseverance", "Jezero, at the rover", "Historical observation", ["Via CSV", "warn"], "Not bundled", "Charts appear when a MEDA CSV is loaded."],
    ["Surface brightness temperature", "THEMIS · Mars Odyssey", "Whole region, from orbit", "Processed observation", ["Map layer, online", "ok"], "Day and night IR 100 m", "Relative warmth only; not calibrated temperature."],
    ["Dust optical depth", "MEDA RDS, SkyCam · Perseverance", "Jezero, at the rover", "Historical observation", ["Not integrated", "off"], "Nothing", "The dust value in a Marswalk plan is a slider: an assumption to test storm scenarios."],
    ["Radiation", "RAD · Curiosity", "Gale crater", "Historical observation", ["Published rate", "mid"], "0.67 mSv/day", "Used for dose per walk and per mission."],
    ["Elevation and slope", "HiRISE + HRSC DTMs", "Jezero walk area", "Processed observation", ["Loaded", "ok"], "~51 m grid", "Routes, slope and hazard layers."],
    ["Orbital imagery", "HiRISE, CTX · MRO", "Jezero walk area", "Historical observation", ["Loaded", "ok"], "~1.2 m and ~5 m", "Base map; works offline."],
  ];

  function renderStations() {
    $("env-stations").innerHTML = STATIONS.map((s) => `<article class="card env-st">
      <div class="env-st-top"><span class="env-ic">${ic(s.icon)}</span><div><b>${s.where}</b><small>${s.who}</small></div><span class="kd-tag kd-hist">${s.kind}</span></div>
      <dl>${s.rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <p class="muted">Source: ${s.src}</p></article>`).join("");
  }
  function renderAvail() {
    $("env-avail").innerHTML = `<thead><tr><th>Parameter</th><th>Instrument and mission</th><th>Where</th><th>Kind</th><th>Status</th><th>In Marswalk</th><th>Notes</th></tr></thead>
      <tbody>${AVAIL.map(([p, i, w, k, [st, cls], loaded, n]) => `<tr><td class="strong">${p}</td><td>${i}</td><td>${w}</td><td>${k}</td>
        <td><span class="st st-${cls}">${st}</span></td><td>${loaded}</td><td>${n}</td></tr>`).join("")}</tbody>`;
  }

  // ---------- Графики MEDA из CSV ----------
  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const head = lines.shift().split(",").map((h) => h.trim().toLowerCase());
    const col = (n) => head.indexOf(n);
    const need = ["sol", "lmst_hour"];
    if (need.some((n) => col(n) < 0)) throw new Error("The CSV needs at least the columns sol and lmst_hour.");
    return lines.map((l) => { const c = l.split(","); const o = {}; head.forEach((h, k) => { o[h] = c[k] === "" || c[k] === undefined ? null : Number(c[k]); }); return o; })
      .filter((r) => Number.isFinite(r.sol) && Number.isFinite(r.lmst_hour));
  }
  function chart(rows, key, title, unit, dots) {
    const pts = rows.filter((r) => Number.isFinite(r[key]));
    if (!pts.length) return "";
    const W = 520, H = 200, L = 44, B = 24, T = 10;
    let lo = Math.min(...pts.map((r) => r[key])), hi = Math.max(...pts.map((r) => r[key]));
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const X = (h) => L + (h / 24) * (W - L - 8), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const sols = [...new Set(pts.map((r) => r.sol))];
    const colors = ["#8fb6ff", "#cfe26a", "#f0a64d"];
    const series = sols.map((sol, k) => {
      const s = pts.filter((r) => r.sol === sol).sort((a, b) => a.lmst_hour - b.lmst_hour);
      if (dots) return s.map((r) => `<circle cx="${X(r.lmst_hour).toFixed(1)}" cy="${Y(r[key]).toFixed(1)}" r="2.2" fill="${colors[k % 3]}"/>`).join("");
      let d = "", prev = null;
      s.forEach((r) => { const gap = prev && r.lmst_hour - prev > 0.6; d += `${!prev || gap ? "M" : "L"}${X(r.lmst_hour).toFixed(1)},${Y(r[key]).toFixed(1)}`; prev = r.lmst_hour; });
      return `<path d="${d}" fill="none" stroke="${colors[k % 3]}" stroke-width="1.6"/>`;
    }).join("");
    let grid = "";
    for (let h = 0; h <= 24; h += 6) grid += `<line x1="${X(h)}" x2="${X(h)}" y1="${T}" y2="${H - B}" class="g-grid"/><text x="${X(h)}" y="${H - 6}" class="g-txt" text-anchor="middle">${String(h).padStart(2, "0")}:00</text>`;
    [lo, (lo + hi) / 2, hi].forEach((v) => { grid += `<text x="${L - 6}" y="${Y(v) + 4}" class="g-txt" text-anchor="end">${Math.round(v)}</text>`; });
    return `<article class="card env-chart"><div class="card-head"><h3>${title}, ${unit}</h3><span class="kd-tag kd-proc">Processed observation</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title} by local time">${grid}${series}</svg>
      <p class="muted">${sols.map((s, k) => `<span class="sol-key" style="background:${colors[k % 3]}"></span>Sol ${s}`).join(" &nbsp; ")} · local mean solar time · ${pts.length} points</p></article>`;
  }
  function renderCharts(rows) {
    $("env-charts").innerHTML = [
      chart(rows, "temp_c", "Air temperature", "°C"), chart(rows, "pressure_pa", "Atmospheric pressure", "Pa"),
      chart(rows, "wind_ms", "Wind speed", "m/s"), chart(rows, "wind_dir_deg", "Wind direction", "°", true),
    ].join("") || `<p class="muted">The file has no temperature, pressure or wind columns.</p>`;
  }

  // ---------- Тепловая карта THEMIS ----------
  let map = null, layer = null;
  const THEMIS = {
    day: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
    night: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MO_THEMIS-IR-Night_mosaic_global_100m_v14/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
  };
  function initMap() {
    if (map || typeof L === "undefined") return;
    map = L.map("env-map", { crs: L.CRS.EPSG4326, zoomControl: true, attributionControl: true, minZoom: 5, maxZoom: 12 }).setView([18.44, 77.45], 8);
    map.attributionControl.setPrefix(false);
    L.imageOverlay(root.ASSETS.marsTexture, [[-90, -180], [90, 180]], { interactive: false }).addTo(map);
    setThermal("day");
    L.circleMarker(root.HABITAT.latlng, { radius: 6, color: "#fff", weight: 2, fillColor: "#cfe26a", fillOpacity: 1 })
      .bindTooltip("Perseverance landing site (MEDA)", { permanent: true, direction: "right", offset: [8, 0], className: "pin-tip" }).addTo(map);
  }
  function setThermal(which) {
    if (layer) map.removeLayer(layer);
    layer = L.tileLayer(THEMIS[which], { tileSize: 256, maxNativeZoom: 7, maxZoom: 12, noWrap: true, attribution: `THEMIS ${which} IR: NASA/JPL-Caltech/ASU via Mars Trek` }).addTo(map);
    let warned = false;
    layer.on("tileerror", () => { if (!warned) { warned = true; $("env-map").classList.add("offline"); } });
    document.querySelectorAll("[data-th]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.th === which)));
  }

  function init() {
    renderStations(); renderAvail();
    $("meda-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { renderCharts(parseCsv(await f.text())); }
      catch (err) { $("env-charts").innerHTML = `<p class="muted">${err.message}</p>`; }
    });
    document.querySelectorAll("[data-th]").forEach((b) => b.addEventListener("click", () => { initMap(); setThermal(b.dataset.th); }));
    if (root.lucide) root.lucide.createIcons();
  }
  function show() { initMap(); if (map) setTimeout(() => map.invalidateSize(), 50); }

  root.Environment = { init, show };
})(window);
