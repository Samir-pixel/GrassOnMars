// Client for the Marswalk backend (FastAPI under /api/v1; Vite proxies it in development).
(function (root) {
  const BASE = "/api/v1";
  // Window and sampling step of the region open in Marswalk; Jezero on the CTX DTM until setRegion() is called.
  let region = { west: 77.3, south: 18.3, east: 77.6, north: 18.55, step: 3 };
  const win = (r = region) => ({ west: r.west, south: r.south, east: r.east, north: r.north, step: r.step });

  async function get(path) {
    const res = await fetch(BASE + path, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error && body.error.code) || `HTTP ${res.status}`);
    return body;
  }

  function decodeF32(b64) {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return Array.from(new Float32Array(bytes.buffer));
  }

  function decodeU8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  root.MarswalkApi = {
    elevationAt: (lat, lon) => get(`/terrain/point?lat=${lat}&lon=${lon}`),
    pointSlope: (lat, lon) => get(`/terrain/slope?lat=${lat}&lon=${lon}`),
    setRegion(r) { region = win(r); },
    regions: () => get("/terrain/regions"),
    // Landing-point check; `r` is a region other than the open one when looking for a suitable neighbour.
    assessLanding: (lat, lon, r) => get(`/landing/assess?${new URLSearchParams({ lat, lon, ...win(r) })}`),
    exportTerrainUrl: (layer) => `${BASE}/terrain/export?${new URLSearchParams({ layer, ...win() })}`,

    // Server-derived terrain layers (REAL elevations + DERIVED slope, roughness TRI, hillshade) of the open region, or of `r`.
    async terrain(r) {
      const g = await get(`/terrain/analysis?${new URLSearchParams(win(r))}`);
      return {
        meta: {
          demo: false,
          dem: g.metadata.dem,
          source: `${g.metadata.dem}, sampled every ${g.cell_m.map(Math.round).join(" × ")} m (NASA, USGS)`,
          provenance: g.provenance_ids,
          analysis: g.metadata,
          quality: g.quality_report,
        },
        bounds: { west: g.west, south: g.south, east: g.east, north: g.north },
        rows: g.rows,
        cols: g.cols,
        cell_m: g.cell_m,
        elev: decodeF32(g.elevation_f32_b64),
        slope: decodeF32(g.slope_deg_f32_b64),
        roughness: decodeF32(g.roughness_m_f32_b64),
        hillshade: decodeU8(g.hillshade_u8_b64),
        terrainClass: decodeU8(g.terrain_class_u8_b64),
      };
    },

    async layerCatalog() {
      const page = await get("/layers?limit=100");
      return page.items;
    },

    async tileServices() {
      const items = await this.layerCatalog();
      return Object.fromEntries(items.filter((l) => l.service.type === "wmts").map((l) => [l.id, l.service]));
    },

    async roverWaypoints() {
      const out = [];
      let offset = 0;
      for (;;) {
        const page = await get(`/targets?limit=100&offset=${offset}`);
        out.push(...page.items.filter((t) => !t.is_demonstration));
        offset += page.items.length;
        if (offset >= page.total || !page.items.length) break;
      }
      return out;
    },

    async scienceTargets(params = {}) {
      const q = new URLSearchParams({ include_demo: "false", limit: "100" });
      for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, String(v));
      const page = await get(`/targets?${q}`);
      return page.items.filter((t) => t.id.startsWith("sci_") || (params.category && params.category !== "rover_waypoint"));
    },

    health: () => get("/health"),
    environment: (sol) => get(sol == null ? "/environment" : `/environment?sol=${sol}`),
    environmentRegistry: () => get("/environment/registry"),
    observations: (params) => get(`/environment/observations?${new URLSearchParams(params)}`),
    hazards: () => get("/hazards?include_demo=false&limit=100").then((p) => p.items),
    async hazardGrid(cfg = {}) {
      const g = await get(`/hazards/grid?${new URLSearchParams({ ...win(), ...cfg })}`);
      return {
        ...g,
        risk: decodeU8(g.risk_u8_b64),
        classes: decodeU8(g.class_u8_b64),
        uncertainty: decodeU8(g.uncertainty_u8_b64),
      };
    },
    assessHazard: (lat, lon, cfg = {}) => get(`/hazards/assess?${new URLSearchParams({ lat, lon, ...cfg })}`),

    // Route alternatives computed by the backend on the same grid as terrain(): same window, same step.
    async planRoute(body, r) {
      const res = await fetch(BASE + "/routes/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...body, ...win(r) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error && data.error.code) || `HTTP ${res.status}`);
      return data;
    },

    // Stage 12: the backend runs read-only MARSWALK tools and returns the answer with sources and uncertainty.
    async chat(messages, context = {}) {
      const res = await fetch(BASE + "/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ messages, context }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error && body.error.code) || `HTTP ${res.status}`);
      return body;
    },
  };
})(window);
