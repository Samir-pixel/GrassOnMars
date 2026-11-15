// Кейс Езеро: карта Leaflet, рельеф, склоны, точки А и Б, маршрут.
(function (root) {
  // Цвет рельефа: от низин (ржавый) к возвышенностям (песочный)
  const RAMP = [[52, 30, 24], [104, 54, 36], [158, 88, 56], [200, 130, 88], [228, 184, 140]];
  function rampColor(t) {
    const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
    return RAMP[i].map((a, k) => a + (RAMP[i + 1][k] - a) * f);
  }

  function renderHillshade(t) {
    const { rows, cols, elev, dx, dy, hillshade } = t;
    let min = Infinity, max = -Infinity;
    for (const v of elev) if (v !== null && !Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
    const canvas = document.createElement("canvas");
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(cols, rows);
    if (hillshade && hillshade.length === rows * cols) {
      for (let i = 0; i < rows * cols; i++) {
        const hs = hillshade[i];
        if (!hs || elev[i] === null || Number.isNaN(elev[i])) continue; // preserve NoData as transparent
        const v = hs;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL();
    }
    const az = 315 * Math.PI / 180, alt = 40 * Math.PI / 180, zf = 2;
    const z = (r, c) => elev[Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c, e = elev[i];
        if (e === null || Number.isNaN(e)) continue;
        const gx = (z(r, c + 1) - z(r, c - 1)) / (2 * dx) * zf;
        const gy = (z(r + 1, c) - z(r - 1, c)) / (2 * dy) * zf;
        const slope = Math.atan(Math.hypot(gx, gy));
        const aspect = Math.atan2(gy, -gx);
        const shade = Math.max(0, Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect));
        const v = Math.min(255, Math.round(shade * 255));
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }

  function renderElevation(t) {
    const { rows, cols, elev } = t;
    let min = Infinity, max = -Infinity;
    for (const v of elev) if (v !== null && !Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
    const canvas = document.createElement("canvas");
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < rows * cols; i++) {
      const e = elev[i];
      if (e === null || Number.isNaN(e)) continue;
      const col = rampColor((e - min) / (max - min || 1));
      img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 225;
    }
    ctx.putImageData(img, 0, 0);
    return { url: canvas.toDataURL(), min, max };
  }

  // Elevation colours shaded by the server hillshade: the ground picture of the 3D view and the postcard (DERIVED from the DEM, not a photograph).
  function renderRelief(t) {
    const { rows, cols, elev, hillshade } = t;
    let min = Infinity, max = -Infinity;
    for (const v of elev) if (v !== null && !Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
    const canvas = document.createElement("canvas");
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < rows * cols; i++) {
      const e = elev[i];
      if (e === null || Number.isNaN(e)) continue; // NoData stays transparent
      const col = rampColor((e - min) / (max - min || 1)), light = 0.45 + 0.8 * ((hillshade && hillshade[i]) || 160) / 255;
      for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.min(255, col[k] * light);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  const reliefScale = (t) => Math.max(1, t.dy / 60); // same rule as terrain_analysis.relief_scale on the backend
  function renderRoughness(t) {
    const { rows, cols, roughness } = t;
    const top = 15 * reliefScale(t); // 15 m was set on the 60 m grid; TRI grows with cell size, as on the backend
    const canvas = document.createElement("canvas");
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(cols, rows);
    if (!roughness) return canvas.toDataURL();
    for (let i = 0; i < rows * cols; i++) {
      const v = roughness[i];
      if (v === null || Number.isNaN(v)) continue;
      const f = Math.max(0, Math.min(1, v / top));
      if (f < 0.08) continue;
      img.data[i * 4] = Math.round(45 + 210 * f);
      img.data[i * 4 + 1] = Math.round(212 - 140 * f);
      img.data[i * 4 + 2] = Math.round(191 - 60 * f);
      img.data[i * 4 + 3] = Math.round(70 + 145 * f);
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }

  // Билинейная выборка сетки — оверлеи без «пикселей»
  function sampler(arr, rows, cols) {
    return (fy, fx) => {
      const y = Math.max(0, Math.min(rows - 1.001, fy)), x = Math.max(0, Math.min(cols - 1.001, fx));
      const r = Math.floor(y), c = Math.floor(x), v = y - r, u = x - c;
      const a = arr[r * cols + c], b = arr[r * cols + c + 1], d = arr[(r + 1) * cols + c], e = arr[(r + 1) * cols + c + 1];
      if ([a, b, d, e].some((val) => val === null || Number.isNaN(val))) return Number.NaN;
      return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
    };
  }
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function renderSlope(t, maxSlope, k = 4) {
    const W = t.cols * k, H = t.rows * k;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const at = sampler(t.slope, t.rows, t.cols);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = at(y / k - 0.5 + 0.5 / k, x / k - 0.5 + 0.5 / k);
        if (Number.isNaN(s)) continue;
        const hard = smooth(maxSlope * 0.6, maxSlope * 0.75, s);
        const block = smooth(maxSlope * 0.92, maxSlope * 1.05, s);
        if (hard <= 0) continue;
        const i = (y * W + x) * 4;
        // тяжело — янтарный, непроходимо — коралловый; прозрачность мягкая, чтобы был виден снимок
        img.data[i] = 226 + (222 - 226) * block;
        img.data[i + 1] = 168 + (96 - 168) * block;
        img.data[i + 2] = 82 + (84 - 82) * block;
        img.data[i + 3] = 70 * hard + 80 * block;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }


  function pinIcon(name, cls) {
    return L.divIcon({
      className: "",
      html: `<div class="map-pin ${cls}">${window.icon(name)}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  // The backend's optimisation modes and how the page shows them.
  const VARIANTS = [
    { id: "short", mode: "SHORTEST", label: "Shortest", icon: "ruler", color: "var(--c-short)" },
    { id: "safe", mode: "LOWEST_TERRAIN_RISK", label: "Lowest terrain risk", icon: "shield-check", color: "var(--c-safe)" },
    { id: "sci", mode: "SCIENCE_PRIORITY", label: "Science priority", icon: "microscope", color: "var(--c-sci)" },
  ];

  function renderHazardsOverlay(grid) {
    const canvas = document.createElement("canvas");
    if (!grid || !grid.classes) return canvas.toDataURL();
    const { rows, cols, classes } = grid;
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < rows * cols; i++) {
      const c = classes[i];
      if (c === 1) continue; // LOW risk stays transparent so imagery remains clear
      const p = i * 4;
      if (c === 0) { img.data[p] = 167; img.data[p + 1] = 139; img.data[p + 2] = 250; img.data[p + 3] = 155; } // UNKNOWN: violet
      else if (c === 2) { img.data[p] = 245; img.data[p + 1] = 158; img.data[p + 2] = 11; img.data[p + 3] = 95; } // MODERATE: amber
      else if (c === 3) { img.data[p] = 239; img.data[p + 1] = 68; img.data[p + 2] = 68; img.data[p + 3] = 155; } // HIGH: crimson
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }

  function createMission(el, { terrainData, catalog = [], waypoints = [], scienceTargets = [], hazardGrid = null, hazards = [], habitat, targets, textureUrl, onPlan, onSelectHazard, onSelectScience, onTileError }) {
    const t = Router.createTerrain(terrainData);
    const b = t.bounds;
    const terrainBounds = [[b.south, b.west], [b.north, b.east]];
    const byId = Object.fromEntries(catalog.map((l) => [l.id, l]));
    const services = Object.fromEntries(catalog.filter((l) => l.service && l.service.type === "wmts").map((l) => [l.id, l.service]));
    const hit = (bbox) => bbox[0] < b.east && bbox[2] > b.west && bbox[1] < b.north && bbox[3] > b.south; // does a layer reach this region
    const dem = (t.meta && t.meta.dem) || "DEM";
    const local = /CTX/.test(dem); // Jezero on the CTX DTM; every other region is on MOLA 463 m

    const map = L.map(el, {
      crs: L.CRS.EPSG4326,
      zoomControl: false,
      minZoom: 2, maxZoom: 17, zoomSnap: 0.25,
      attributionControl: true,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    map.attributionControl.setPrefix(false);

    // Each managed layer gets its own pane so user layer ordering updates live z-index cleanly.
    map.createPane("base").style.zIndex = 100;
    L.imageOverlay(textureUrl, [[-90, -180], [90, 180]], { pane: "base", interactive: false, attribution: "Celestia (USGS Viking, MGS)" }).addTo(map);
    const paneFor = (id) => {
      const name = `ly-${id}`;
      if (!map.getPane(name)) map.createPane(name);
      return name;
    };

    // Tile layers of the Marswalk backend (NASA Mars Trek mosaics, cached there).
    const tiles = (id, pane, opacity = 1) => {
      const s = services[id];
      return s && hit(s.bbox) ? L.tileLayer(s.tile_url.replace("{row}", "{y}").replace("{col}", "{x}"), {
        tileSize: 256, maxNativeZoom: s.max_zoom, maxZoom: 17, noWrap: true, pane, opacity,
        bounds: [[s.bbox[1], s.bbox[0]], [s.bbox[3], s.bbox[2]]], attribution: s.attribution,
      }) : null;
    };
    const group = (...list) => L.layerGroup(list.filter(Boolean));
    const elVis = renderElevation(t);
    const crismMeta = byId.crism_hyd_jezero;
    const crismSvc = crismMeta && crismMeta.service && crismMeta.service.image_url && hit(crismMeta.service.bbox) ? crismMeta.service : null;
    const crismOverlay = crismSvc
      ? L.imageOverlay(crismSvc.image_url, [[crismSvc.bbox[1], crismSvc.bbox[0]], [crismSvc.bbox[3], crismSvc.bbox[2]]], {
          pane: paneFor("mineralogy"), interactive: false, opacity: 0.85, attribution: crismSvc.attribution,
        })
      : null;

    const geoGroup = L.layerGroup(waypoints.map((w) =>
      L.circleMarker([w.lat, w.lon], {
        pane: paneFor("geology"), radius: 3, weight: 1, color: "#0b0f17", fillColor: "#d4f25a", fillOpacity: 0.85, opacity: 0.85,
      }).bindPopup(`<b>Sol ${w.rover_sol ?? "–"}</b><br>${w.name}<br>Elev: ${w.elevation_m != null ? `${w.elevation_m.toFixed(1)} m` : "–"}<br><small>NASA M20_waypoints (REAL)</small>`)
    ));

    const hazardColor = { LOW: "#a3e635", MODERATE: "#f59e0b", HIGH: "#ef4444", UNKNOWN: "#a78bfa" };
    const hazardRaster = hazardGrid
      ? L.imageOverlay(renderHazardsOverlay(hazardGrid), terrainBounds, { pane: paneFor("hazards"), interactive: false, opacity: 0.85, attribution: "MARSWALK Risk Engine (DERIVED)" })
      : null;
    const hazardMarkers = L.layerGroup(hazards.filter((h) => h.lat != null && h.lon != null).map((h) =>
      L.circleMarker([h.lat, h.lon], {
        pane: paneFor("hazards"), radius: 6, weight: 1.5, color: "#0b0f17",
        fillColor: hazardColor[h.hazard_class] || "#a78bfa", fillOpacity: 0.92, opacity: 0.95,
      }).bindTooltip(`${h.hazard_class}: ${h.title_ru}`).on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        onSelectHazard && onSelectHazard({ feature: h });
      })
    ));
    const hazardGroup = L.layerGroup([hazardRaster, hazardMarkers].filter(Boolean));

    const sciColor = {
      sedimentary_formations: "#38bdf8", clay_minerals: "#34d399", carbonate_deposits: "#fbbf24",
      ancient_fluvial: "#60a5fa", rock_outcrops: "#fb7185", geological_layers: "#f472b6",
      potential_water_features: "#22d3ee", geological_contacts: "#c084fc",
    };
    const sciGroup = L.layerGroup();
    function drawScienceMarkers(list) {
      sciGroup.clearLayers();
      for (const s of list) {
        L.circleMarker([s.lat, s.lon], {
          pane: paneFor("science"), radius: 7, weight: 1.8, color: "#0b0f17",
          fillColor: sciColor[s.category] || "#a78bfa", fillOpacity: 0.92, opacity: 0.95,
        }).bindTooltip(`${s.name} (${s.classification || s.category})`).on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          onSelectScience && onSelectScience(s);
        }).addTo(sciGroup);
      }
    }
    drawScienceMarkers(scienceTargets);

    const layers = {
      // Outside the Jezero CTX/HiRISE mosaics the only imagery with global coverage is the MOLA shaded relief.
      imagery: local ? group(tiles("ctx_ortho_jezero", paneFor("imagery")), tiles("hirise_ortho_jezero", paneFor("imagery"))) : group(tiles("mola_shaded_relief", paneFor("imagery"))),
      elevation: L.imageOverlay(elVis.url, terrainBounds, { pane: paneFor("elevation"), interactive: false, opacity: 0.78, attribution: `${dem} (REAL)` }),
      terrain: L.imageOverlay(renderHillshade(t), terrainBounds, { pane: paneFor("terrain"), interactive: false, opacity: 0.85, className: "terrain-overlay", attribution: `DERIVED Hillshade · ${dem}` }),
      slope: L.imageOverlay(renderSlope(t, 15), terrainBounds, { pane: paneFor("slope"), interactive: false, opacity: 0.9, className: "slope-overlay", attribution: `DERIVED Slope · ${dem}` }),
      roughness: L.imageOverlay(renderRoughness(t), terrainBounds, { pane: paneFor("roughness"), interactive: false, opacity: 0.85, attribution: `DERIVED TRI Roughness · ${dem}` }),
      hazards: hazardGroup,
      science: sciGroup,
      mineralogy: crismOverlay || L.layerGroup(),
      thermal: group(tiles("themis_day_ir", paneFor("thermal"), 0.75)),
      geology: geoGroup,
    };

    const aMeta = (t.meta && t.meta.analysis) || {};
    const qRep = (t.meta && t.meta.quality) || {};
    const ctxDate = local ? (byId.ctx_dtm_jezero && byId.ctx_dtm_jezero.observed_at) || "2020-07-24" : "MGS MOLA altimetry, 1997–2001";
    const demId = (t.meta && t.meta.provenance && t.meta.provenance[0]) || "";
    const crismStatus = crismOverlay ? "integrated" : "Unavailable";
    const geoStatus = waypoints.length ? `${waypoints.length} waypoints` : "Empty (0 waypoints)";
    const hzCounts = (hazardGrid && hazardGrid.class_counts) || {};

    const layerSpecs = [
      {
        id: "science", name: "Scientific targets", sub: `${scienceTargets.length} verified NASA targets`, visible: true, opacity: 0.95,
        status: scienceTargets.length ? "REAL · integrated" : "Empty", dataClass: "REAL", units: "sol / elevation / evidence",
        source: "NASA Mars 2020 · CRISM · IAU Nomenclature", date: "2007–2024",
        resolution: "Rover & 18 m orbital", crs: "SRID 949900", nodata: "Excluded demo rows",
        legend: { type: "stops", stops: [["#38bdf8", "Sedimentary / fluvial"], ["#34d399", "Clay / water features"], ["#fbbf24", "Carbonates / outcrops / layers"]] },
      },
      {
        id: "hazards", name: "Hazard assessment", sub: `${hazards.length} hotspots · HIGH ${hzCounts.HIGH ?? 0}`, visible: false, opacity: 0.85,
        status: hazardGrid ? "DERIVED · Risk Engine" : "Unavailable", dataClass: "DERIVED", units: "risk index [0..1]",
        source: `MARSWALK Risk Engine (${dem} + IAU + coverage)`, date: ctxDate,
        resolution: `${aMeta.effective_spacing_m ? aMeta.effective_spacing_m[1] : 60} m`,
        crs: "SRID 949900", nodata: "UNKNOWN (violet) ≠ LOW",
        legend: { type: "stops", stops: [["#f59e0b", "MODERATE risk"], ["#ef4444", "HIGH risk"], ["#a78bfa", "UNKNOWN (NoData / gap)"]] },
      },
      {
        id: "imagery", name: local ? "Orbital imagery" : "Shaded relief (MOLA)", sub: local ? "HiRISE 25 cm · CTX 6 m" : "No CTX/HiRISE mosaic loaded here", visible: true, opacity: 1.0,
        status: layers.imagery.getLayers().length ? "integrated" : "Error (tiles offline)",
        dataClass: local ? "REAL" : "DERIVED", units: local ? "8-bit reflectance RGB/gray" : "8-bit shade", source: local ? "NASA Mars Trek (MRO HiRISE & CTX)" : "NASA Mars Trek (MGS MOLA shaded relief)",
        date: local ? "2020-08-03 (mosaic; scenes undated)" : ctxDate, resolution: local ? "0.25–6 m/px" : "463 m/px", crs: "SRID 949900 / EPSG:104905",
        nodata: "Transparent outside footprint",
        legend: { type: "note", text: local ? "Controlled ortho-mosaics (visual context; not radiometric albedo)." : "Shading computed from MOLA elevations (visual context; not a photograph)." },
      },
      {
        id: "slope", name: "Slope hazard", sub: `DERIVED · max ${qRep.slope_max_deg ?? "30"}°`, visible: true, opacity: 0.9,
        status: `server ${dem}`, dataClass: "DERIVED", units: "degrees (°)",
        source: `MARSWALK from ${dem} (${demId})`, date: ctxDate,
        resolution: `${aMeta.effective_spacing_m ? aMeta.effective_spacing_m[1] : 60} m (${aMeta.resampling || "step 3"})`,
        crs: "SRID 949900 (dx·cos lat)", nodata: "NaN preserved (transparent)",
        exportLayer: "slope",
        legend: { type: "stops", stops: [["rgba(233,180,76,.85)", "Steep (9°–14°)"], ["rgb(240,106,91)", "Hazard (≥ 15°)"]] },
      },
      {
        id: "elevation", name: "Elevation", sub: `${Math.round(elVis.min)}…${Math.round(elVis.max)} m`, visible: false, opacity: 0.78,
        status: `server ${dem}`, dataClass: "REAL", units: "metres (MOLA areoid)",
        source: `USGS Astrogeology (${demId})`, date: ctxDate,
        resolution: `${aMeta.effective_spacing_m ? aMeta.effective_spacing_m[1] : 60} m (${aMeta.resampling || "step 3"})`,
        crs: "SRID 949900 (Mars 2000)", nodata: "NaN preserved (transparent)",
        exportLayer: "elevation",
        legend: { type: "grad", css: "linear-gradient(90deg,#341e18,#683624,#9e5838,#c88258,#e4b88c)", min: `${Math.round(elVis.min)} m`, max: `${Math.round(elVis.max)} m` },
      },
      {
        id: "terrain", name: "Hillshade", sub: "Azimuth 315°, alt 40°", visible: false, opacity: 0.85,
        status: `server ${dem}`, dataClass: "DERIVED", units: "shade 1..255",
        source: `MARSWALK Horn hillshade from ${dem}`, date: ctxDate,
        resolution: `${aMeta.effective_spacing_m ? aMeta.effective_spacing_m[1] : 60} m`,
        crs: "SRID 949900 (dx·cos lat)", nodata: "0 = NoData (transparent)",
        exportLayer: "hillshade",
        legend: { type: "grad", css: "linear-gradient(90deg,#111,#888,#fff)", min: "Shadow", max: "Sunlit NW" },
      },
      {
        id: "roughness", name: "Surface roughness", sub: `TRI · p₉₀ ${qRep.roughness_p90_m ?? "–"} m`, visible: false, opacity: 0.85,
        status: `server ${dem}`, dataClass: "DERIVED", units: "metres (3×3 TRI)",
        source: `MARSWALK TRI from ${dem}`, date: ctxDate,
        resolution: `${aMeta.effective_spacing_m ? aMeta.effective_spacing_m[1] : 60} m`,
        crs: "SRID 949900", nodata: "NaN on gap/border (transparent)",
        exportLayer: "roughness",
        legend: { type: "grad", css: "linear-gradient(90deg,#2dd4bf,#f59e0b,#ec4899)", min: `${(1.2 * reliefScale(t)).toFixed(1)} m`, max: `≥ ${Math.round(15 * reliefScale(t))} m` },
      },
      {
        id: "mineralogy", name: "Mineralogy (CRISM)", sub: "Hydrated phases, 18 m", visible: false, opacity: 0.85,
        status: crismStatus, dataClass: "REAL", units: "spectral summary RGB",
        source: "NASA PDS Geosciences (MRO CRISM FRT00005C5E)", date: (crismMeta && crismMeta.observed_at) || "2007-05-19",
        resolution: "18 m/px", crs: "Planetocentric Equirectangular", nodata: "Alpha = 0 outside swath",
        legend: { type: "stops", stops: [["#ff32c8", "Magenta: polyhydrated sulfates"], ["#d6d632", "Yellow/green: clays / monohydrated"], ["#3898ff", "Blue: bound H₂O minerals"]] },
      },
      {
        id: "thermal", name: "Thermal (THEMIS)", sub: "Daytime IR, 100 m", visible: false, opacity: 0.75,
        status: layers.thermal.getLayers().length ? "integrated" : "Error (tiles offline)",
        dataClass: "REAL", units: "8-bit relative IR radiance", source: "NASA Mars Trek (Mars Odyssey THEMIS)",
        date: "2018-10 mosaic (individual scenes undated)", resolution: "100 m/px", crs: "SRID 949900 / EPSG:104905",
        nodata: "±65° lat global",
        legend: { type: "grad", css: "linear-gradient(90deg,#111,#777,#f5f5f5)", min: "Cool / shaded", max: "Warm / sunward" },
      },
      {
        id: "geology", name: "Geological features", sub: `Perseverance track (${waypoints.length})`, visible: false, opacity: 0.85,
        status: geoStatus, dataClass: "REAL", units: "sol / elevation (m)",
        source: "NASA Mars 2020 M20_waypoints", date: "Sols 13–2022 (2021–2026)",
        resolution: "Point localisations", crs: "SRID 949900", nodata: "Excluded demo rows",
        legend: { type: "stops", stops: [["#d4f25a", "Verified Perseverance science/drive waypoint"]] },
      },
    ];
    let layerOrder = ["science", "hazards", "geology", "slope", "roughness", "mineralogy", "elevation", "terrain", "thermal", "imagery"];
    const specMap = Object.fromEntries(layerSpecs.map((s) => [s.id, s]));

    function applyLayerStack() {
      // Top of layerOrder renders on top (higher zIndex).
      const n = layerOrder.length;
      layerOrder.forEach((id, idx) => {
        const z = 210 + (n - idx) * 10;
        const pane = map.getPane(`ly-${id}`);
        if (pane) pane.style.zIndex = z;
      });
    }

    let tileErrorSent = false;
    const onTileErr = () => {
      specMap.imagery.status = "Error (tile failed)";
      if (!tileErrorSent) { tileErrorSent = true; onTileError && onTileError(); }
    };
    layers.imagery.eachLayer((l) => l.on("tileerror", onTileErr));
    layers.thermal.eachLayer((l) => l.on("tileerror", () => { specMap.thermal.status = "Error (tile failed)"; }));
    if (crismOverlay) crismOverlay.on("error", () => { specMap.mineralogy.status = "Error (image failed)"; });

    applyLayerStack();
    for (const s of layerSpecs) {
      if (s.visible && (!layers[s.id].getLayers || layers[s.id].getLayers().length > 0)) layers[s.id].addTo(map);
    }

    // Карта не выходит за края рельефа: нельзя сдвинуть или отдалить так, чтобы появились обрезы
    const limit = L.latLngBounds(terrainBounds);
    map.setMaxBounds(limit);
    map.options.maxBoundsViscosity = 1;
    function clampZoom() {
      const z = map.getBoundsZoom(limit, true);
      map.setMinZoom(z);
      if (map.getZoom() < z) map.setZoom(z, { animate: false });
    }
    map.on("resize", clampZoom);

    const routeLayer = L.layerGroup().addTo(map);
    const pinLayer = L.layerGroup().addTo(map);
    const navLayer = L.layerGroup().addTo(map);

    const opts = { maxSlope: 15, suitHours: 8, startHour: 9, radiusM: 200, dustTau: 0.45 };
    let start = habitat;
    // A region without a named feature starts with B 0.1° east of the landing point (inside every 1° window); a map click moves it.
    let current = targets[0] || { id: "custom", name: "Custom point", icon: "map-pin", latlng: [habitat.latlng[0], habitat.latlng[1] + 0.1],
      minutes: 15, tag: "Your pick", source: "Map selection", why: "No named feature in this region: a default point 0.1° east of the landing point. Click the map to move it." };
    let routeWaypoints = [];
    let startMarker = null, customMarker = null;
    const wpLayer = L.layerGroup().addTo(pinLayer);
    let plan = null, selectedId = null;
    let status = "idle", error = "", mode = "", pickStart = false, reqSeq = 0;

    const habitatMarker = L.marker(habitat.latlng, { icon: pinIcon(habitat.icon, "home"), keyboard: false, title: habitat.name })
      .bindTooltip("A · Habitat", { permanent: true, direction: "right", offset: [18, 0], className: "pin-tip home" })
      .on("click", () => { if (pickStart) pick(habitat); })
      .addTo(pinLayer);

    const targetMarkers = new Map();
    for (const tg of targets) {
      const m = L.marker(tg.latlng, { icon: pinIcon(tg.icon, "target"), title: tg.name })
        .bindTooltip(tg.name, { permanent: true, direction: "right", offset: [18, 0], className: "pin-tip" })
        .on("click", () => { if (!api.navigating) pick(tg); })
        .addTo(pinLayer);
      targetMarkers.set(tg.id, m);
    }

    // A click sets the start while "Set on map" is armed, the destination otherwise.
    function pick(point) {
      if (pickStart) { pickStart = false; start = point; } else current = point;
      invalidate();
    }

    map.on("click", (e) => {
      if (api.navigating || t.cellOf(e.latlng.lat, e.latlng.lng) < 0) return;
      pick({ id: pickStart ? "custom-start" : "custom", name: pickStart ? "Landing point" : "Custom point", icon: "map-pin",
        latlng: [e.latlng.lat, e.latlng.lng], minutes: 15, tag: "Your pick", source: "Map selection", why: "A point picked on the map." });
    });

    function highlight() {
      for (const [id, m] of targetMarkers) {
        const node = m.getElement && m.getElement();
        if (node) node.querySelector(".map-pin").classList.toggle("active", id === current.id);
      }
    }

    // EVA walk check for a backend route: SIMULATED pace and suit assumptions, kept apart from the route metrics.
    function walkCheck(v) {
      const w = Router.walkSeconds(t, v.cells, { maxSlope: opts.maxSlope });
      v.sum.outS = w.outS; v.sum.backS = w.backS;
      v.eva = Router.evaluateEva({ ...w, stopMinutes: v.stopMinutes, suitHours: opts.suitHours, dustTau: opts.dustTau, startHour: opts.startHour });
    }

    const byMode = (m) => VARIANTS.find((x) => x.mode === m) || {};

    // A backend alternative in the shape the panel and the navigation use. Every route metric is the backend's.
    function toVariant(alt) {
      const near = (x) => alt.science_targets.some((s) => Router.metersBetween([s.lat, s.lon], x.latlng) < 30);
      const bonus = targets.filter((x) => x.id !== current.id && x.id !== start.id && near(x)); // a walk that starts at a target does not stop there
      const v = {
        ...byMode(alt.mode), alt, bonus, sameAs: byMode(alt.same_route_as).label,
        cells: alt.geometry.coordinates.map(([lon, lat]) => t.cellOf(lat, lon)),
        sum: { distance: alt.total_distance_m, ascent: alt.ascent_m, descent: alt.descent_m, maxSlope: alt.max_slope_deg },
        stopMinutes: (current.minutes || 0) + bonus.reduce((m, s) => m + (s.minutes || 0), 0),
        profile: alt.elevation_profile.map((p) => [p.distance_m, p.elevation_m]),
      };
      walkCheck(v);
      return v;
    }

    function drawRoutes() {
      routeLayer.clearLayers();
      if (!plan) return;
      const sel = plan.variants.find((v) => v.id === selectedId);
      for (const v of plan.variants) {
        if (v === sel) continue;
        const line = v.cells.map((i) => t.latLngOf(i));
        L.polyline(line, { weight: 4, opacity: 0.75, dashArray: "2 8", lineCap: "round", interactive: true, className: `alt-line alt-${v.id}` })
          .on("click", () => api.selectVariant(v.id))
          .addTo(routeLayer);
      }
      if (sel) {
        const line = sel.cells.map((i) => t.latLngOf(i));
        L.polyline(line, { className: "route-casing", weight: 10, interactive: false }).addTo(routeLayer);
        L.polyline(line, { className: `route-line sel-${sel.id}`, weight: 5, interactive: false }).addTo(routeLayer);
      }
    }

    const emit = () => { drawRoutes(); onPlan({ status, error, plan, selectedId, start, target: current, pickStart }); };

    // Start, destination or a route preference changed: the old routes no longer answer the question.
    function invalidate() {
      reqSeq++; plan = null; selectedId = null; status = "idle";
      if (startMarker) { pinLayer.removeLayer(startMarker); startMarker = null; }
      if (start !== habitat) startMarker = L.marker(start.latlng, { icon: pinIcon("map-pin", "home"), interactive: false, keyboard: false, title: "Start A" })
        .bindTooltip(`A · ${start.name}`, { permanent: true, direction: "right", offset: [18, 0], className: "pin-tip home" }).addTo(pinLayer);
      habitatMarker.setTooltipContent(start === habitat ? "A · Habitat" : "Habitat");
      if (customMarker) { pinLayer.removeLayer(customMarker); customMarker = null; }
      if (current.id === "custom") customMarker = L.marker(current.latlng, { icon: pinIcon("map-pin", "target active"), interactive: false, keyboard: false, title: "Destination B" }).addTo(pinLayer);
      wpLayer.clearLayers();
      routeWaypoints.forEach((w, idx) => {
        L.marker([w.lat, w.lon], { icon: pinIcon("microscope", "target active"), interactive: false })
          .bindTooltip(`WP ${idx + 1} · ${w.name}`, { permanent: true, direction: "right", offset: [18, 0], className: "pin-tip" }).addTo(wpLayer);
      });
      highlight();
      emit();
    }

    async function calculate() {
      const seq = ++reqSeq;
      plan = null; selectedId = null; status = "loading";
      emit();
      try {
        const res = await MarswalkApi.planRoute({
          start: { lat: start.latlng[0], lon: start.latlng[1] },
          destination: { lat: current.latlng[0], lon: current.latlng[1] },
          waypoints: routeWaypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
          modes: mode ? [mode] : undefined, max_slope_deg: opts.maxSlope, science_radius_m: opts.radiusM,
        });
        if (seq !== reqSeq) return; // an input changed or a newer request started while this one ran
        const variants = res.alternatives.filter((a) => a.status === "found").map(toVariant);
        plan = { start, target: current, variants, opts: { ...opts }, response: res,
          unreachable: res.alternatives.filter((a) => a.status !== "found").map((alt) => ({ ...byMode(alt.mode), alt })) };
        selectedId = variants.length ? variants[0].id : null;
        status = "ready";
      } catch (e) {
        if (seq !== reqSeq) return;
        status = "error"; error = e.message;
      }
      emit();
    }

    let relief = null;
    const api = {
      map, terrain: t, navigating: false, calculate,
      relief() { return relief || (relief = renderRelief(t)); },
      get plan() { return plan; },
      get selected() { return plan && plan.variants.find((v) => v.id === selectedId); },
      setTarget(idOrObj, fromMap) {
        const next = typeof idOrObj === "string" ? targets.find((x) => x.id === idOrObj) : idOrObj;
        if (!next) return current; // an id from another region (story, shared link)
        current = next;
        invalidate();
        if (!fromMap) map.flyToBounds(L.latLngBounds([start.latlng, current.latlng]).pad(0.6), { duration: 0.8, maxZoom: 13 });
        return current;
      },
      selectVariant(id) { selectedId = id; emit(); },
      setMode(m) { mode = m; invalidate(); },
      togglePickStart() { pickStart = !pickStart; emit(); },
      setStart(point) { pickStart = false; start = point; invalidate(); map.panTo(point.latlng); },
      setOpt(key, val) {
        opts[key] = val;
        if (key === "maxSlope") layers.slope.setUrl(renderSlope(t, val));
        if (key === "maxSlope" || key === "radiusM") return invalidate(); // route preferences: recalculate on the backend
        if (plan) { plan.opts = { ...opts }; plan.variants.forEach(walkCheck); } // walk settings only re-run the SIMULATED check
        emit();
      },
      setScienceTargets(list) {
        drawScienceMarkers(list);
        specMap.science.sub = `${list.length} shown`;
      },
      get routeWaypoints() { return routeWaypoints.slice(); },
      toggleWaypoint(tg) {
        const idx = routeWaypoints.findIndex((w) => w.id === tg.id);
        if (idx >= 0) routeWaypoints.splice(idx, 1);
        else if (routeWaypoints.length < 5) routeWaypoints.push(tg);
        invalidate();
        calculate();
      },
      setHazardGrid(newGrid) {
        if (!hazardRaster || !newGrid) return;
        hazardRaster.setUrl(renderHazardsOverlay(newGrid));
        const hc = newGrid.class_counts || {};
        specMap.hazards.sub = `${hazards.length} hotspots · HIGH ${hc.HIGH ?? 0}`;
      },
      // Layer management API
      available(name) { const l = layers[name]; return l && (!l.getLayers || l.getLayers().length > 0); },
      shown(name) { return !!layers[name] && map.hasLayer(layers[name]); },
      getLayerSpecs() { return layerOrder.map((id) => ({ ...specMap[id], visible: map.hasLayer(layers[id]) })); },
      toggleLayer(name, on) {
        const l = layers[name];
        if (!l) return;
        specMap[name].visible = !!on;
        if (on) l.addTo(map); else map.removeLayer(l);
        applyLayerStack();
      },
      setLayerOpacity(name, opacity) {
        const l = layers[name];
        if (!l) return;
        specMap[name].opacity = opacity;
        if (l.setOpacity) l.setOpacity(opacity);
        else if (l.eachLayer) l.eachLayer((c) => {
          if (c.setOpacity) c.setOpacity(opacity);
          else if (c.setStyle) c.setStyle({ opacity, fillOpacity: opacity });
        });
      },
      moveLayer(name, delta) {
        const i = layerOrder.indexOf(name);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= layerOrder.length) return;
        [layerOrder[i], layerOrder[j]] = [layerOrder[j], layerOrder[i]];
        applyLayerStack();
      },
      fit() { map.fitBounds(limit); clampZoom(); },
      destroy() { reqSeq++; map.remove(); }, // a route answer still on its way is dropped by the reqSeq check
      invalidate() { map.invalidateSize(); clampZoom(); },
      get current() { return current; },
      get start() { return start; },

      // ----- Навигация -----
      walker: null,
      startNav() {
        api.navigating = true;
        el.classList.add("nav-on");
        layers.slope.setOpacity(0.35);
        api.walker = L.marker(start.latlng, { icon: pinIcon("user-round", "walker"), interactive: false, zIndexOffset: 1000 }).addTo(navLayer);
        map.flyTo(start.latlng, 14.5, { duration: 1.2 });
      },
      moveWalker(ll, follow) {
        if (!api.walker) return;
        api.walker.setLatLng(ll);
        if (follow) map.panTo(ll, { animate: false });
      },
      showDone(cellsDone) {
        navLayer.eachLayer((l) => { if (l instanceof L.Polyline) navLayer.removeLayer(l); });
        if (cellsDone && cellsDone.length > 1) {
          L.polyline(cellsDone, { className: "done-line", weight: 6, interactive: false }).addTo(navLayer);
        }
      },
      endNav() {
        api.navigating = false;
        el.classList.remove("nav-on");
        layers.slope.setOpacity(specMap.slope.opacity);
        navLayer.clearLayers();
        api.walker = null;
        if (current) map.flyToBounds(L.latLngBounds([start.latlng, current.latlng]).pad(0.6), { duration: 0.8, maxZoom: 13 });
      },
    };

    api.fit();
    setTimeout(() => { invalidate(); calculate(); }, 0); // invalidate() draws the A/B markers of the initial pair
    return api;
  }

  root.createMission = createMission;
})(window);
