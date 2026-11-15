// Environment tab. Every value shown comes from /api/v1/environment/*; this file only draws it.
(function (root) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const BIN_MINUTES = 15;
  const JEZERO = [[18.3, 77.3], [18.55, 77.6]];
  const ERRORS = {
    DATASET_NOT_ACQUIRED: "MEDA tables are not loaded on the backend.",
    MEDA_SOL_NOT_FOUND: "This sol is not loaded.",
    STATION_NOT_INTEGRATED: "No data is loaded for this station.",
    EMPTY_TIME_RANGE: "The start of the time range must be earlier than its end.",
  };
  const KIND = { HISTORICAL_OBSERVATION: "Historical observation", PROCESSED_OBSERVATION: "Processed observation", MODEL_ESTIMATE: "Model estimate", SIMULATION: "Simulation" };
  const AVAILABILITY = { series: "Time series loaded", map: "Map layer only", not_acquired: "Not downloaded", not_integrated: "Not integrated" };
  const UNIT = { deg: "°" };
  const num = (v, digits = 1) => v.toFixed(digits).replace("-", "−");
  const withUnit = (v, unit) => `${num(v)}${unit === "deg" ? "°" : ` ${unit}`}`;
  const utc = (iso) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
  const clock = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  const place = (p) => `${Math.abs(p.lat).toFixed(4)}°${p.lat >= 0 ? "N" : "S"} ${p.lon.toFixed(4)}°E`;

  let registry = null, map = null, markers = null, seq = 0;
  const layers = {};

  // Consecutive bins that hold a value. A missing or empty bin ends the run: gaps are never bridged.
  function runs(points, step) {
    const out = [];
    let prev = null;
    for (const p of points) {
      if (p.value == null) { prev = null; continue; }
      if (prev == null || p.lmst_h - prev > step * 1.5) out.push([]);
      out[out.length - 1].push(p);
      prev = p.lmst_h;
    }
    return out;
  }

  function chart(list, from, to) {
    const W = 560, H = 204, L = 52, R = 20, T = 10, B = 30;
    const { unit, parameter, label } = list[0].series;
    const dots = parameter === "wind_direction"; // a direction wraps at 360/0: joining bins would draw swings that never happened
    const shown = list.flatMap((s) => s.series.points).filter((p) => p.value != null);
    if (!shown.length) return `<p class="env-empty">No usable readings in this time range.</p>`;
    let lo = dots ? 0 : Math.min(...shown.map((p) => p.min ?? p.value));
    let hi = dots ? 360 : Math.max(...shown.map((p) => p.max ?? p.value));
    if (hi === lo) { hi += 1; lo -= 1; }
    const step = list[0].series.bin_minutes / 60;
    const X = (h) => L + ((h - from) / (to - from)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const xy = (p, v) => `${X(p.lmst_h + step / 2).toFixed(1)},${Y(v).toFixed(1)}`;
    const digits = hi - lo < 10 ? 1 : 0;

    let grid = "";
    const every = to - from > 12 ? 6 : to - from > 4 ? 2 : 1;
    for (let h = Math.ceil(from / every) * every; h <= to; h += every)
      grid += `<line class="pf-grid" x1="${X(h)}" x2="${X(h)}" y1="${T}" y2="${H - B}"/><text class="pf-text" x="${X(h)}" y="${H - 4}" text-anchor="middle">${clock(h)}</text>`;
    for (const v of [lo, (lo + hi) / 2, hi])
      grid += `<line class="pf-grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="pf-text" x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${num(v, digits)}</text>`;

    let body = "";
    const hover = new Map(); // bin start -> one line per sol, so each drawn value can be traced to its time and sample count
    list.forEach(({ series, cls }, row) => {
      for (const run of runs(series.points, step)) {
        const last = run[run.length - 1];
        // Availability strip under the axis: where this sol has usable readings.
        body += `<rect class="env-fill ${cls}" x="${X(run[0].lmst_h).toFixed(1)}" y="${H - B + 3 + row * 4}" width="${(X(last.lmst_h + step) - X(run[0].lmst_h)).toFixed(1)}" height="3"/>`;
        if (!dots && run[0].min != null)
          body += `<polygon class="env-band ${cls}" points="${run.map((p) => xy(p, p.max)).join(" ")} ${run.slice().reverse().map((p) => xy(p, p.min)).join(" ")}"/>`;
        body += !dots && run.length > 1
          ? `<polyline class="env-line ${cls}" points="${run.map((p) => xy(p, p.value)).join(" ")}"/>`
          : run.map((p) => `<circle class="env-fill ${cls}" cx="${X(p.lmst_h + step / 2).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="2.2"/>`).join("");
      }
      for (const p of series.points) {
        const value = p.value == null ? "no usable readings"
          : `${withUnit(p.value, unit)}${p.min == null ? "" : ` (${num(p.min)} to ${num(p.max)})`}, ${p.samples} readings`;
        hover.set(p.lmst_h, [...(hover.get(p.lmst_h) || []), `Sol ${series.sol}, ${utc(p.time_utc)}: ${value}`]);
      }
    });
    for (const [h, lines] of hover)
      body += `<rect class="env-hit" x="${X(h).toFixed(1)}" y="${T}" width="${(X(h + step) - X(h)).toFixed(1)}" height="${H - T - B}"><title>Local time ${clock(h)} to ${clock(h + step)}\n${esc(lines.join("\n"))}</title></rect>`;

    const range = list.map(({ series }) => {
      const values = series.points.filter((p) => p.value != null).map((p) => p.value);
      return values.length ? `sol ${series.sol} bin means from ${withUnit(Math.min(...values), unit)} to ${withUnit(Math.max(...values), unit)}` : `sol ${series.sol} has no usable readings`;
    }).join("; ");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} by local mean solar time: ${esc(range)}">${grid}${body}</svg>`;
  }

  function chartCard(list, from, to) {
    const s = list[0].series;
    const expected = Math.round(((to - from) * 60) / s.bin_minutes);
    const sources = list.map(({ series }) => {
      const q = series.quality;
      return `<p class="env-src">Sol ${series.sol}: ${esc(series.instrument)}, ${esc(series.mission)}. Dataset ${esc(series.source_dataset)}, level ${esc(series.product.processing_level)}.
        ${q.samples.toLocaleString("en-US")} usable readings in ${q.bins - q.empty_bins} of ${expected} bins.
        <a href="${esc(series.product.label_url)}" target="_blank" rel="noopener">PDS label</a> <span class="mono">${esc(series.product.lidvid)}</span></p>`;
    }).join("");
    return `<article class="card env-chart">
      <div class="card-head"><h3>${esc(s.label)}, ${esc(UNIT[s.unit] || s.unit)}</h3><span class="kind-badge">${KIND[s.kind]}</span></div>
      ${chart(list, from, to)}
      <div class="env-legend">${list.map(({ series, cls }) => `<span><i class="env-key ${cls}"></i>Sol ${series.sol}</span>`).join("")}
        <span>${s.parameter === "wind_direction" ? "Dots: bin means" : "Line: bin mean. Band: lowest to highest reading"}. Strip under the axis: where readings exist</span></div>
      <p class="env-src">${esc(s.method)} ${s.bin_minutes}-minute bins of local mean solar time.</p>
      ${sources}
    </article>`;
  }

  // Date and place of one sol's observations, from the series themselves.
  function observation(list, cls) {
    const s = list[0], loc = s.location;
    const start = list.map((x) => x.observed_at_start).sort()[0];
    const end = list.map((x) => x.observed_at_end).sort().pop();
    return `<article class="card">
      <div class="card-head"><h3><i class="env-key ${cls}"></i>Sol ${s.sol}</h3><span class="kind-badge">Archived, not current</span></div>
      <p><b>When</b> ${utc(start)} to ${utc(end)}</p>
      <p><b>Where</b> ${loc
        ? `${place(loc)}, Perseverance rover, Jezero crater. Rover localisation ${esc(loc.waypoint_id)} of sol ${loc.waypoint_sol}; the rover may also drive during a sol.`
        : "The rover position for this sol is not loaded."}</p>
      <p><b>Source</b> ${esc(s.mission)} MEDA, NASA PDS Atmospheres Node. Charts are processed observations: means over ${s.bin_minutes}-minute bins.</p>
    </article>`;
  }

  function drawMarkers(sol, other) {
    if (!markers) return;
    markers.clearLayers();
    const spots = new Map(); // one marker per rover position; consecutive sols often share one
    for (const p of registry.positions) spots.set(p.waypoint_id, { ...p, sols: [...((spots.get(p.waypoint_id) || {}).sols || []), p.sol] });
    for (const spot of spots.values()) {
      const cls = spot.sols.includes(sol) ? "env-a" : spot.sols.includes(other) ? "env-b" : "";
      L.circleMarker([spot.lat, spot.lon], { radius: cls ? 7 : 4, className: `env-pin ${cls}` })
        .bindTooltip(`MEDA, sol ${spot.sols.join(", ")}`, { permanent: true, direction: "right", offset: [8, 0], className: "pin-tip" })
        .addTo(markers);
    }
  }

  function setMapLayer(name) {
    for (const [id, layer] of Object.entries(layers)) (id === name ? map.addLayer(layer) : map.removeLayer(layer));
    for (const b of document.querySelectorAll("[data-env-layer]")) b.setAttribute("aria-pressed", String(b.dataset.envLayer === name));
  }

  async function initMap() {
    const services = await root.MarswalkApi.tileServices();
    map = L.map($("env-map"), { crs: L.CRS.EPSG4326, minZoom: 4, maxZoom: 12, zoomSnap: 0.25 });
    map.attributionControl.setPrefix(false);
    for (const name of ["day", "night"]) {
      const s = services[`themis_${name}_ir`];
      if (!s) continue;
      layers[name] = L.tileLayer(s.tile_url.replace("{row}", "{y}").replace("{col}", "{x}"), {
        tileSize: 256, maxNativeZoom: s.max_zoom, maxZoom: 12, noWrap: true,
        bounds: [[s.bbox[1], s.bbox[0]], [s.bbox[3], s.bbox[2]]], attribution: s.attribution,
      }).on("tileerror", () => { $("env-map-state").textContent = "Some THEMIS tiles failed to load."; });
    }
    if (!Object.keys(layers).length) $("env-map-state").textContent = "THEMIS tile layers are not available on the backend.";
    markers = L.layerGroup().addTo(map);
    map.fitBounds(JEZERO);
    setMapLayer(layers.day ? "day" : "night");
    for (const b of document.querySelectorAll("[data-env-layer]")) {
      b.disabled = !layers[b.dataset.envLayer];
      b.addEventListener("click", () => setMapLayer(b.dataset.envLayer));
    }
  }

  function renderRegistry() {
    const label = Object.fromEntries(registry.parameters.map((p) => [p.id, p.label]));
    const sols = [...new Set(registry.sources.flatMap((s) => s.available_sols))].sort((a, b) => a - b);
    $("env-notice").textContent = registry.notice;
    $("env-station").innerHTML = registry.stations.map((s) => `<option value="${esc(s.id)}"${s.available ? "" : " disabled"}>${esc(s.name)}${s.available ? "" : " (not integrated)"}</option>`).join("");
    $("env-parameter").innerHTML = `<option value="">All measured parameters</option>` +
      registry.parameters.map((p) => `<option value="${esc(p.id)}"${p.series ? "" : " disabled"}>${esc(p.label)}${p.series ? "" : " (no time series)"}</option>`).join("");
    $("env-sol").innerHTML = sols.map((s) => `<option value="${s}">Sol ${s}</option>`).join("");
    $("env-compare").innerHTML = `<option value="">No comparison</option>` + sols.map((s) => `<option value="${s}">Sol ${s}</option>`).join("");
    $("env-kinds").innerHTML = Object.entries(registry.kinds).map(([k, text]) => `<dt>${KIND[k]}</dt><dd>${esc(text)}</dd>`).join("");
    $("env-map-note").textContent = `${registry.sources.find((s) => s.id === "themis_ir").note} Markers show where MEDA measured on the loaded sols: THEMIS gives relative warmth across the crater, MEDA gives air conditions at one point, and the two are not merged.`;
    $("env-sources").innerHTML = `<thead><tr><th>Parameter</th><th>Instrument and mission</th><th>Where</th><th>Kind</th><th>Status</th><th>Loaded</th><th>Notes and source</th></tr></thead><tbody>${
      registry.sources.map((s) => `<tr>
        <td>${s.parameters.map((p) => esc(label[p])).join(", ")}</td>
        <td>${esc(s.instrument)}<br><span class="muted">${esc(s.mission)}</span></td>
        <td>${esc(s.location.name)}${s.location.lat == null ? "" : `<br><span class="muted mono">${place(s.location)}</span>`}</td>
        <td>${KIND[s.kind]}</td>
        <td><span class="env-avail ${s.availability}">${AVAILABILITY[s.availability]}</span></td>
        <td>${s.available_sols.length ? `Sols ${s.available_sols.join(", ")}<br><span class="muted">${utc(s.observed_at_start)} to ${utc(s.observed_at_end)}</span>` : s.availability === "map" ? "Whole crater" : "Nothing"}</td>
        <td>${esc(s.note)}${s.source_url ? ` <a href="${esc(s.source_url)}" target="_blank" rel="noopener">Source</a>` : ""}${s.dataset_ids.length ? `<br><span class="muted mono">${esc(s.dataset_ids.join(", "))}</span>` : ""}</td>
      </tr>`).join("")}</tbody>`;
  }

  async function load() {
    const id = ++seq;
    const status = $("env-status");
    const sol = +$("env-sol").value, other = $("env-compare").value === "" ? null : +$("env-compare").value;
    const from = +$("env-from").value, to = +$("env-to").value;
    const wanted = $("env-parameter").value ? [$("env-parameter").value] : registry.parameters.filter((p) => p.series).map((p) => p.id);
    const sols = other == null || other === sol ? [sol] : [sol, other];
    drawMarkers(sol, sols[1]);
    if (!(from < to)) {
      status.dataset.state = "error";
      status.textContent = ERRORS.EMPTY_TIME_RANGE;
      return;
    }
    status.dataset.state = "loading";
    status.textContent = "Loading archived measurements…";
    try {
      const fetched = await Promise.all(sols.map((s) => Promise.all(wanted.map((parameter) =>
        root.MarswalkApi.observations({ station: $("env-station").value, parameter, sol: s, lmst_from: from, lmst_to: to, bin_minutes: BIN_MINUTES })))));
      if (id !== seq) return; // a newer filter change is already loading
      const apart = sols.length > 1 && (fetched[0][0].location || {}).waypoint_id !== (fetched[1][0].location || {}).waypoint_id;
      $("env-obs").innerHTML = fetched.map((list, i) => observation(list, i ? "env-b" : "env-a")).join("") + (sols.length < 2 ? "" : `<p class="env-warn">${apart
        ? `Sols ${sols[0]} and ${sols[1]} were measured at different rover positions and on different dates. The curves are two separate local records laid over one local-time axis. They do not describe one place.`
        : `Sols ${sols[0]} and ${sols[1]} were measured from the same rover localisation, on different dates.`}</p>`);
      $("env-charts").innerHTML = wanted.map((_, p) => chartCard(fetched.map((list, i) => ({ series: list[p], cls: i ? "env-b" : "env-a" })), from, to)).join("");
      status.dataset.state = "ready";
      status.textContent = `${sols.map((s) => `Sol ${s}`).join(" and ")}, local time ${clock(from)} to ${clock(to)}. Hover a chart for the UTC time and sample count of each bin.`;
    } catch (e) {
      if (id !== seq) return;
      $("env-obs").innerHTML = $("env-charts").innerHTML = "";
      status.dataset.state = "error";
      status.textContent = ERRORS[e.message] || "The Marswalk backend did not answer. No measurements are shown.";
    }
  }

  // Surface readings with their sources. Only the Jezero card is data the backend loads (STATIONS.jezero is filled from /environment); the rest are published values.
  function renderStations() {
    const S = root.STATIONS;
    const cards = [
      ["thermometer", "Jezero crater", S.jezero.station, "Air temperature, pressure, wind", S.jezero.text, "Loaded from NASA PDS", "NASA PDS Atmospheres Node, Mars 2020 MEDA"],
      ["thermometer-snowflake", "Gale crater", S.gale.station, "Air temperature", S.gale.text, "Published value", "NASA JPL, Curiosity’s second Martian year of weather (2016)"],
      ["satellite-dish", "Chryse and Utopia Planitia", S.utopia.station, "Air temperature", S.utopia.text, "Published value", "NASA NSSDCA, Viking fact sheet"],
      ["radiation", "Gale crater and cruise", "Curiosity RAD", "Radiation dose", "0.67 mSv per day on the surface, 1.84 mSv per day in cruise", "Published value", "Hassler et al. 2014; Zeitlin et al. 2013"],
    ];
    $("env-stations").innerHTML = cards.map(([ico, where, who, what, text, tag, src]) => `<article class="card env-st">
      <div class="env-st-top"><span class="env-ic">${root.icon(ico)}</span><div><b>${where}</b><small>${esc(who)}</small></div><span class="kd-tag kd-hist">${tag}</span></div>
      <dl><div><dt>${what}</dt><dd>${esc(text)}</dd></div></dl>
      <p class="muted">Source: ${src}</p></article>`).join("");
  }

  let started = null;
  root.MarswalkEnvironment = {
    // Called whenever the tab is shown; loads once.
    show() {
      if (map) setTimeout(() => map.invalidateSize(), 30);
      renderStations();
      started ||= (async () => {
        try {
          registry = await root.MarswalkApi.environmentRegistry();
        } catch (_) {
          started = null; // retry on the next visit
          $("env-status").dataset.state = "error";
          $("env-status").textContent = "The Marswalk backend did not answer. No measurements are shown.";
          return;
        }
        renderRegistry();
        for (const el of $("env-filters").querySelectorAll("select, input")) el.addEventListener("change", load);
        initMap().then(() => drawMarkers(+$("env-sol").value, +$("env-compare").value || null)).catch(() => { $("env-map-state").textContent = "The thermal map could not be loaded."; });
        await load();
      })();
    },
  };
})(window);
