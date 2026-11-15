// Кейс Езеро: карта Leaflet, рельеф, склоны, точки А и Б, маршрут.
(function (root) {
  const TREK = (id, ext = "jpg") => `https://trek.nasa.gov/tiles/Mars/EQ/${id}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
  const TREK_URL = TREK("Viking_MDIM21_ClrMosaic_global_232m");
  // Слои NASA Mars Trek (загружаются онлайн; в закрытом предпросмотре недоступны)
  const TREK_THEMIS_DAY = TREK("Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12");
  const TREK_THEMIS_NIGHT = TREK("Mars_MO_THEMIS-IR-Night_mosaic_global_100m_v14");

  // Цвет рельефа: от низин (ржавый) к возвышенностям (песочный)
  const RAMP = [[52, 30, 24], [104, 54, 36], [158, 88, 56], [200, 130, 88], [228, 184, 140]];
  function rampColor(t) {
    const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
    return RAMP[i].map((a, k) => a + (RAMP[i + 1][k] - a) * f);
  }

  function renderHillshade(t) {
    const { rows, cols, elev, dx, dy } = t;
    let min = Infinity, max = -Infinity;
    for (const v of elev) if (v !== null && !Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
    const canvas = document.createElement("canvas");
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(cols, rows);
    const az = 315 * Math.PI / 180, alt = 40 * Math.PI / 180, zf = 3; // вертикальное преувеличение
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
        const col = rampColor((e - min) / (max - min || 1));
        const k = 0.45 + shade * 0.75;
        img.data[i * 4] = Math.min(255, col[0] * k);
        img.data[i * 4 + 1] = Math.min(255, col[1] * k);
        img.data[i * 4 + 2] = Math.min(255, col[2] * k);
        img.data[i * 4 + 3] = 255;
      }
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

  const VARIANTS = [
    { id: "fast", label: "Fastest", icon: "zap", color: "var(--c-fast)", mode: "time", note: "Least time, may cross steeper ground." },
    { id: "safe", label: "Safest", icon: "shield-check", color: "var(--c-safe)", mode: "safe", note: "Avoids steep slopes, even if it takes longer." },
    { id: "short", label: "Shortest", icon: "ruler", color: "var(--c-short)", mode: "distance", note: "Fewest meters, ignores effort." },
    { id: "sci", label: "Science detour", icon: "microscope", color: "var(--c-sci)", mode: "time", note: "Adds one more science target on the way." },
  ];

  function difficulty(maxSlope) {
    if (maxSlope < 7) return { label: "Easy", level: 1 };
    if (maxSlope < 12) return { label: "Medium", level: 2 };
    return { label: "Hard", level: 3 };
  }

  // ---------- Поля для слоёв и оценки опасности (из настоящей сетки высот) ----------
  function computeFields(t) {
    const { rows, cols, elev } = t, n = rows * cols;
    const tri = new Float32Array(n), drop = new Float32Array(n);
    const z = (r, c) => elev[Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))];
    let min = Infinity, max = -Infinity;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const e = z(r, c); let s = 0, d = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const q = Math.abs(z(r + dr, c + dc) - e); s += q; if (q > d) d = q;
      }
      tri[r * cols + c] = s / 8; drop[r * cols + c] = d;
      if (e < min) min = e; if (e > max) max = e;
    }
    const sorted = Array.from(tri).sort((a, b) => a - b);
    return { tri, drop, min, max, triP95: sorted[Math.floor(sorted.length * 0.95)], slopeMax: Math.max(...t.slope) };
  }
  // Внутри коридора HiRISE рельеф точнее (≈1 м), снаружи — HRSC ≈50 м: выше неопределённость
  function uncertaintyAt(lat, lng) {
    const IM = window.JEZERO_IMAGERY, b = IM && IM.inner.bounds;
    if (!b) return 0.5;
    return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east ? 0.25 : 0.5;
  }
  function hazardParts(t, F, i, w) {
    const [lat, lng] = t.latLngOf(i);
    const S = Math.min(1, t.slope[i] / w.thr);
    const T = Math.min(1, F.tri[i] / 10);            // TRI 10 м и больше — очень неровно
    const O = Math.min(1, Math.max(0, (F.drop[i] - 8) / 25)); // уступ выше ~8 м между соседними ячейками
    const U = uncertaintyAt(lat, lng);
    const R = w.w1 * S + w.w2 * T + w.w3 * O + w.w4 * U;
    return { S, T, O, U, R, lat, lng, slope: t.slope[i], tri: F.tri[i], drop: F.drop[i], level: R >= 0.5 ? "HIGH" : R >= 0.3 ? "MEDIUM" : "LOW" };
  }
  function rasterize(t, valueAt, colorOf, k = 3) {
    const W = t.cols * k, H = t.rows * k;
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d"), img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = Math.min(t.rows - 1, Math.floor(y / k)), c = Math.min(t.cols - 1, Math.floor(x / k));
      const col = colorOf(valueAt(r * t.cols + c));
      if (!col) continue;
      const o = (y * W + x) * 4; img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = col[3];
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }
  const lerp = (a, b, f) => a + (b - a) * f;
  const ramp = (stops, f) => {
    f = Math.max(0, Math.min(1, f));
    for (let i = 0; i < stops.length - 1; i++) if (f <= stops[i + 1][0]) {
      const [f0, c0] = stops[i], [f1, c1] = stops[i + 1], u = (f - f0) / (f1 - f0 || 1);
      return [lerp(c0[0], c1[0], u), lerp(c0[1], c1[1], u), lerp(c0[2], c1[2], u)];
    }
    return stops[stops.length - 1][1];
  };

  function createMission(el, { terrainData, habitat, targets, textureUrl, onPlan, onTileError }) {
    const t = Router.createTerrain(terrainData);
    const b = t.bounds;
    const terrainBounds = [[b.south, b.west], [b.north, b.east]];

    const map = L.map(el, {
      crs: L.CRS.EPSG4326,
      zoomControl: false,
      minZoom: 2, maxZoom: 17, zoomSnap: 0.25,
      attributionControl: true,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    map.attributionControl.setPrefix(false);

    // Отдельная «панель» Leaflet на каждый слой — так их можно переставлять по высоте
    const PANES = ["viking", "imagery", "themisDay", "themisNight", "elevation", "hillshade", "roughness", "slope", "hazard"];
    PANES.forEach((id) => { map.createPane(`sl-${id}`); });
    L.imageOverlay(textureUrl, [[-90, -180], [90, 180]], { interactive: false, attribution: "Celestia (USGS Viking, MGS)" }).addTo(map);
    const IM = window.JEZERO_IMAGERY;
    const bb = (x) => [[x.south, x.west], [x.north, x.east]];
    const imagery = L.layerGroup(IM ? [
      L.imageOverlay(IM.outer.url, bb(IM.outer.bounds), { pane: "sl-imagery", interactive: false, className: "imagery-overlay", attribution: "CTX: NASA/JPL-Caltech/MSSS" }),
      L.imageOverlay(IM.inner.url, bb(IM.inner.bounds), { pane: "sl-imagery", interactive: false, className: "imagery-overlay imagery-inner", attribution: "HiRISE: NASA/JPL-Caltech/UArizona · tiles: Jez Explore" }),
    ] : []);

    const F = computeFields(t);
    const hz = { w1: 0.40, w2: 0.25, w3: 0.15, w4: 0.20, thr: 18 };
    let Rarr = new Float32Array(t.rows * t.cols);
    const computeR = () => { for (let i = 0; i < Rarr.length; i++) Rarr[i] = hazardParts(t, F, i, hz).R; };
    computeR();
    const renderHazard = () => rasterize(t, (i) => Rarr[i], (R) => {
      if (R < 0.2) return null;
      const c = ramp([[0.2, [120, 190, 90]], [0.4, [230, 180, 70]], [0.6, [225, 90, 70]], [1, [190, 40, 60]]], R);
      return [c[0], c[1], c[2], Math.round(60 + R * 140)];
    }, 1);
    const trekOpts = { tileSize: 256, maxNativeZoom: 7, maxZoom: 17, noWrap: true, attribution: "NASA/JPL-Caltech Mars Trek" };
    const layers = {
      imagery,
      trek: L.tileLayer(TREK_URL, { ...trekOpts, pane: "sl-viking" }),
      themisDay: L.tileLayer(TREK_THEMIS_DAY, { ...trekOpts, pane: "sl-themisDay", attribution: "THEMIS day IR: NASA/JPL-Caltech/ASU via Mars Trek" }),
      themisNight: L.tileLayer(TREK_THEMIS_NIGHT, { ...trekOpts, pane: "sl-themisNight", attribution: "THEMIS night IR: NASA/JPL-Caltech/ASU via Mars Trek" }),
      terrain: L.imageOverlay(renderHillshade(t), terrainBounds, { pane: "sl-hillshade", interactive: false, className: "terrain-overlay",
        attribution: t.meta && t.meta.demo ? "Demo terrain" : (t.meta && t.meta.source) || "DTM" }),
      elevation: L.imageOverlay(rasterize(t, (i) => (t.elev[i] - F.min) / (F.max - F.min || 1), (f) => {
        const c = ramp([[0, [40, 60, 160]], [0.25, [40, 150, 170]], [0.5, [120, 190, 90]], [0.75, [230, 190, 80]], [1, [230, 110, 70]]], f);
        return [c[0], c[1], c[2], 170];
      }, 1), terrainBounds, { pane: "sl-elevation", interactive: false, className: "smooth-overlay" }),
      roughness: L.imageOverlay(rasterize(t, (i) => F.tri[i], (v) => {
        const f = Math.min(1, v / Math.max(1, F.triP95)); if (f < 0.4) return null;
        const c = ramp([[0.4, [250, 220, 140]], [0.7, [240, 150, 60]], [1, [170, 50, 120]]], f);
        return [c[0], c[1], c[2], Math.round((f - 0.4) / 0.6 * 170 + 30)];
      }, 1), terrainBounds, { pane: "sl-roughness", interactive: false, className: "smooth-overlay" }),
      slope: L.imageOverlay(renderSlope(t, 15), terrainBounds, { pane: "sl-slope", interactive: false, className: "slope-overlay" }),
      hazard: L.imageOverlay(renderHazard(), terrainBounds, { pane: "sl-hazard", interactive: false, className: "smooth-overlay" }),
      hotspots: L.layerGroup(),
    };
    // 10 самых опасных точек (не ближе ~500 м друг к другу)
    function buildHotspots() {
      layers.hotspots.clearLayers();
      const idx = Array.from({ length: Rarr.length }, (_, i) => i).sort((a, b) => Rarr[b] - Rarr[a]);
      const picked = [];
      for (const i of idx) {
        if (picked.length >= 10) break;
        const [la, ln] = t.latLngOf(i);
        if (picked.every(([pa, pl]) => Math.hypot((pa - la) * 59, (pl - ln) * 56) > 0.5)) picked.push([la, ln, i]);
      }
      picked.forEach(([la, ln, i]) => {
        const p = hazardParts(t, F, i, hz);
        L.circleMarker([la, ln], { pane: "sl-hazard", radius: 7, weight: 2, color: "#fff", fillColor: "#e0485a", fillOpacity: 0.85 })
          .bindTooltip(`Hazard hotspot · R ${p.R.toFixed(2)} · slope ${p.slope.toFixed(0)}°`, { direction: "top" }).addTo(layers.hotspots);
      });
      return picked.length;
    }
    let hotspotCount = buildHotspots();
    let tileErrorSent = false;
    [layers.trek, layers.themisDay, layers.themisNight].forEach((l) => l.on("tileerror", () => { if (!tileErrorSent) { tileErrorSent = true; onTileError && onTileError(); } }));
    if (IM) layers.imagery.addTo(map); else layers.terrain.addTo(map);
    layers.slope.addTo(map);

    // Карта не выходит за края снимков: нельзя сдвинуть или отдалить так, чтобы появились обрезы
    const limit = L.latLngBounds(IM ? bb(IM.outer.bounds) : terrainBounds);
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

    const opts = { maxSlope: 15, suitHours: 8, startHour: 9, radiusM: 400, dustTau: 0.6 };
    let current = targets[0];
    let customMarker = null;
    let plan = null;
    let selectedId = null;

    L.marker(habitat.latlng, { icon: pinIcon(habitat.icon, "home"), keyboard: false, title: habitat.name })
      .bindTooltip("A · Habitat", { permanent: true, direction: "right", offset: [18, 0], className: "pin-tip home" }).addTo(pinLayer);

    const targetMarkers = new Map();
    for (const tg of targets) {
      const m = L.marker(tg.latlng, { icon: pinIcon(tg.icon, "target"), title: tg.name })
        .bindTooltip(tg.name, { permanent: true, direction: "right", offset: [18, 0], className: "pin-tip" })
        .on("click", () => { if (!api.navigating) api.setTarget(tg.id, true); })
        .addTo(pinLayer);
      targetMarkers.set(tg.id, m);
    }

    map.on("click", (e) => {
      if (api.navigating) return;
      const cell = t.cellOf(e.latlng.lat, e.latlng.lng);
      if (cell < 0) return;
      api.setTarget({ id: "custom", name: "Custom point", icon: "map-pin", latlng: [e.latlng.lat, e.latlng.lng],
        minutes: 15, tag: "Your pick", source: "Map selection", why: "A point picked on the map." }, true);
    });

    function highlight() {
      for (const [id, m] of targetMarkers) {
        const node = m.getElement && m.getElement();
        if (node) node.querySelector(".map-pin").classList.toggle("active", id === current.id);
      }
    }

    // Один вариант маршрута: путь, сводка, остановки, вердикт
    function buildVariant(v, start, goal) {
      let cells = null, waypoint = null;
      const base = { maxSlope: opts.maxSlope };
      if (v.id === "safe") {
        cells = Router.findPath(t, start, goal, { ...base, mode: "safe", maxSlope: Math.max(6, opts.maxSlope * 0.6) })
          || Router.findPath(t, start, goal, { ...base, mode: "safe" });
      } else if (v.id === "sci") {
        // ближайшая по «крюку» цель, которая не дальше 60% от прямого пути
        const direct = Router.metersBetween(habitat.latlng, current.latlng);
        const cands = targets.filter((x) => x.id !== current.id)
          .map((x) => ({ x, extra: Router.metersBetween(habitat.latlng, x.latlng) + Router.metersBetween(x.latlng, current.latlng) - direct }))
          .filter((c) => c.extra < direct * 0.6)
          .sort((a, b2) => a.extra - b2.extra);
        if (!cands.length) return null;
        waypoint = cands[0].x;
        const mid = t.cellOf(waypoint.latlng[0], waypoint.latlng[1]);
        const p1 = Router.findPath(t, start, mid, { ...base, mode: "time" });
        const p2 = p1 && Router.findPath(t, mid, goal, { ...base, mode: "time" });
        if (!p2) return null;
        cells = p1.concat(p2.slice(1));
      } else {
        cells = Router.findPath(t, start, goal, { ...base, mode: v.mode });
      }
      if (!cells) return null;

      const sum = Router.summarize(t, cells, { maxSlope: opts.maxSlope });
      const others = targets.filter((x) => x.id !== current.id && (!waypoint || x.id !== waypoint.id));
      const bonus = (waypoint ? [waypoint] : []).concat(Router.stopsNearRoute(t, cells, others, opts.radiusM));
      const stopMinutes = (current.minutes || 0) + bonus.reduce((m, s) => m + (s.minutes || 0), 0);
      const eva = Router.evaluateEva({
        outS: sum.outS, backS: sum.backS, stopMinutes, suitHours: opts.suitHours,
        dustTau: opts.dustTau, startHour: opts.startHour,
      });
      const profile = [];
      let d = 0;
      for (let k = 0; k < cells.length; k++) {
        if (k) d += Router.metersBetween(t.latLngOf(cells[k - 1]), t.latLngOf(cells[k]));
        profile.push([d, t.elev[cells[k]]]);
      }
      const diff = difficulty(sum.maxSlope);
      // Оценка для ранжирования: время с поправкой на риск склонов; NO GO уходит вниз
      const score = (eva.totalS / 60) * (1 + 1.5 * Math.pow(sum.maxSlope / opts.maxSlope, 2)) + (eva.go ? 0 : 100000);
      return { ...v, cells, waypoint, sum, bonus, stopMinutes, eva, profile, difficulty: diff, score, key: cells.join(",") };
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

    function replan() {
      if (customMarker && current.id !== "custom") { pinLayer.removeLayer(customMarker); customMarker = null; }
      if (current.id === "custom") {
        if (customMarker) pinLayer.removeLayer(customMarker);
        customMarker = L.marker(current.latlng, { icon: pinIcon("map-pin", "target active"), interactive: false }).addTo(pinLayer);
      }
      highlight();

      const start = t.cellOf(habitat.latlng[0], habitat.latlng[1]);
      const goal = t.cellOf(current.latlng[0], current.latlng[1]);
      const variants = [];
      const seen = new Map();
      for (const v of VARIANTS) {
        const built = goal >= 0 ? buildVariant(v, start, goal) : null;
        if (!built) continue;
        if (seen.has(built.key)) { seen.get(built.key).alsoLabels.push(built.label); continue; }
        built.alsoLabels = [];
        seen.set(built.key, built);
        variants.push(built);
      }
      variants.sort((a, b2) => a.score - b2.score);
      variants.forEach((v, i) => { v.rank = i + 1; v.pick = i === 0 && v.eva.go; });
      plan = { target: current, variants, opts: { ...opts } };
      if (!variants.find((v) => v.id === selectedId)) selectedId = variants.length ? variants[0].id : null;
      drawRoutes();
      onPlan(plan, selectedId);
    }

    const api = {
      map, terrain: t, navigating: false,
      get plan() { return plan; },
      get selected() { return plan && plan.variants.find((v) => v.id === selectedId); },
      setTarget(idOrObj, fromMap) {
        current = typeof idOrObj === "string" ? targets.find((x) => x.id === idOrObj) : idOrObj;
        selectedId = null;
        replan();
        if (!fromMap) map.flyToBounds(L.latLngBounds([habitat.latlng, current.latlng]).pad(0.6), { duration: 0.8, maxZoom: 13 });
        return current;
      },
      selectVariant(id) {
        selectedId = id;
        drawRoutes();
        onPlan(plan, selectedId);
      },
      setOpt(key, val) {
        opts[key] = val;
        if (key === "maxSlope") layers.slope.setUrl(renderSlope(t, val));
        replan();
      },
      toggleLayer(name, on) {
        const l = layers[name];
        if (on) l.addTo(map); else map.removeLayer(l);
        if (name === "trek") layers.terrain.setOpacity(on ? 0.55 : 1);
        layers.slope.bringToFront();
      },
      fit() { map.fitBounds(limit); clampZoom(); },
      // ----- Научные слои -----
      layers, fields: F, hazardWeights: hz, get opts() { return opts; },
      get hotspotCount() { return hotspotCount; },
      setLayer(id, on) {
        if (id === "targets") { targetMarkers.forEach((m) => m.setOpacity(on ? 1 : 0)); return; }
        const l = layers[id];
        if (!l) return;
        if (on) l.addTo(map); else map.removeLayer(l);
        if (id === "hazard") { if (on) layers.hotspots.addTo(map); else map.removeLayer(layers.hotspots); }
      },
      setLayerOpacity(id, v) {
        if (id === "targets") { targetMarkers.forEach((m) => { if (m.options.opacity !== 0) m.setOpacity(v); }); return; }
        const l = layers[id];
        if (!l) return;
        if (l.setOpacity) l.setOpacity(v); else if (l.eachLayer) l.eachLayer((x) => x.setOpacity && x.setOpacity(v));
      },
      setOrder(ids) { // первый в списке — сверху
        ids.forEach((id, k) => { const p = map.getPane(`sl-${id === "trek" ? "viking" : id === "terrain" ? "hillshade" : id}`); if (p) p.style.zIndex = String(480 - k * 5); });
      },
      setHazard(key, val) {
        hz[key] = val;
        computeR();
        layers.hazard.setUrl(renderHazard());
        hotspotCount = buildHotspots();
      },
      hazardAt(lat, lng) {
        const cell = t.cellOf(lat, lng);
        if (cell < 0) return null;
        return hazardParts(t, F, cell, hz);
      },
      routeHazard(cells) {
        let worst = null;
        for (const i of cells) { const p = hazardParts(t, F, i, hz); if (!worst || p.R > worst.R) worst = p; }
        return worst;
      },
      invalidate() { map.invalidateSize(); clampZoom(); },
      get current() { return current; },

      // ----- Навигация -----
      walker: null,
      startNav() {
        api.navigating = true;
        el.classList.add("nav-on");
        layers.slope.setOpacity(0.35);
        api.walker = L.marker(habitat.latlng, { icon: pinIcon("user-round", "walker"), interactive: false, zIndexOffset: 1000 }).addTo(navLayer);
        map.flyTo(habitat.latlng, 14.5, { duration: 1.2 });
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
        layers.slope.setOpacity(1);
        navLayer.clearLayers();
        api.walker = null;
        if (current) map.flyToBounds(L.latLngBounds([habitat.latlng, current.latlng]).pad(0.6), { duration: 0.8, maxZoom: 13 });
      },
    };

    api.fit();
    setTimeout(replan, 0);
    return api;
  }

  root.createMission = createMission;
})(window);
