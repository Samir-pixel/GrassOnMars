// Научные слои карты Marswalk, карточка опасности точки и «научные находки».
(function (root) {
  const $ = (id) => document.getElementById(id);
  const ic = (n) => root.icon(n);
  let M = null, opts = null;

  const LAYERS = [
    { id: "targets", name: "Scientific targets", on: true, op: 1, sub: () => `${root.TARGETS.length} targets on HiRISE/CTX imagery`,
      info: "Walk destinations placed on HiRISE and CTX imagery; positions are approximate. Evidence level is shown in Scientific discovery." },
    { id: "hazard", name: "Hazard assessment", on: false, op: 0.85, sub: () => `${M.hotspotCount} hotspots · R = w₁S + w₂T + w₃O + w₄U`,
      info: "Our combined risk model per terrain cell: slope S, roughness T, obstacle (drop to a neighbour) O and data uncertainty U, weighted in Mission parameters. Red dots are the 10 highest-risk spots." },
    { id: "slope", name: "Slope hazard", on: true, op: 0.9, sub: () => `Derived · max ${M.fields.slopeMax.toFixed(1)}°`,
      info: "Slope from the HiRISE + HRSC elevation grid (~51 m cells), central differences. Amber is steep and slow, red is above your slope limit." },
    { id: "roughness", name: "Surface roughness", on: false, op: 0.85, sub: () => `TRI · p95 ${M.fields.triP95.toFixed(1)} m`,
      info: "Terrain Ruggedness Index: mean height difference to the 8 neighbouring cells. Shows broken ground at the ~51 m scale, not single boulders." },
    { id: "elevation", name: "Elevation", on: false, op: 0.7, sub: () => `${Math.round(M.fields.min)} … ${Math.round(M.fields.max)} m`,
      info: "Height relative to the Mars datum from HiRISE DTMs blended with HRSC (USGS Astrogeology), shown as a colour ramp." },
    { id: "terrain", name: "Hillshade", on: false, op: 0.85, sub: () => "Azimuth 315°, altitude 40°",
      info: "Relief shading computed from the elevation grid with light from the north-west." },
    { id: "themisDay", name: "Thermal day (THEMIS)", on: false, op: 0.75, online: true, sub: () => "Day IR 100 m · Mars Trek, online",
      info: "Mars Odyssey THEMIS daytime infrared mosaic, 100 m per pixel, from NASA Mars Trek. Brightness is relative warmth, not a calibrated temperature." },
    { id: "themisNight", name: "Thermal night (THEMIS)", on: false, op: 0.75, online: true, sub: () => "Night IR 100 m · Mars Trek, online",
      info: "THEMIS nighttime infrared mosaic. Rocky ground stays warmer at night than dust, so bright areas hint at rock and coarse material." },
    { id: "imagery", name: "Orbital imagery", on: true, op: 1, sub: () => "HiRISE ~1.2 m · CTX ~5 m",
      info: "HiRISE (NASA/JPL-Caltech/UArizona) and CTX (NASA/JPL-Caltech/MSSS) mosaics of Jezero, embedded so they work offline." },
    { id: "trek", name: "Global mosaic (Viking)", on: false, op: 1, online: true, sub: () => "NASA Mars Trek, online",
      info: "Viking colour mosaic of the whole planet from NASA Mars Trek, used around the Jezero area." },
  ];

  function renderLayers() {
    const active = LAYERS.filter((l) => l.on).length;
    $("sl-count").textContent = `${active}/${LAYERS.length} active`;
    $("sl-list").innerHTML = LAYERS.map((l, k) => `<li class="sl-item${l.on ? " on" : ""}" data-id="${l.id}">
      <div class="sl-row">
        <label class="sl-name"><input type="checkbox" ${l.on ? "checked" : ""} data-act="toggle"><span><b>${l.name}</b><small>${l.sub()}</small></span></label>
        <span class="sl-btns">
          <button type="button" data-act="up" aria-label="Move up" ${k === 0 ? "disabled" : ""}>${ic("arrow-up")}</button>
          <button type="button" data-act="down" aria-label="Move down" ${k === LAYERS.length - 1 ? "disabled" : ""}>${ic("arrow-down")}</button>
          <button type="button" data-act="info" aria-label="About this layer">${ic("info")}</button>
        </span>
      </div>
      <div class="sl-op"><input type="range" min="0" max="100" value="${Math.round(l.op * 100)}" data-act="op" aria-label="${l.name} opacity"><span class="mono">${Math.round(l.op * 100)}%</span></div>
      <p class="sl-info" hidden>${l.info}${l.online ? " <em>Needs the internet: tiles load on the published site.</em>" : ""}</p></li>`).join("");
  }
  function applyOrder() { M.setOrder(LAYERS.filter((l) => l.id !== "targets").map((l) => l.id)); }

  function hazardCard(title, p, note) {
    const pct = (x) => `${Math.round(x * 100)}%`;
    const reasons = [], recs = [];
    if (p.slope < 5) reasons.push(`Gentle slope at the ~51 m scale (${p.slope.toFixed(1)}°).`);
    else if (p.slope < M.hazardWeights.thr) reasons.push(`Moderate slope (${p.slope.toFixed(1)}°) under the ${M.hazardWeights.thr}° threshold.`);
    else reasons.push(`Steep slope (${p.slope.toFixed(1)}°) above the ${M.hazardWeights.thr}° high-risk threshold.`);
    reasons.push(`Roughness TRI ${p.tri.toFixed(1)} m; largest step to a neighbouring cell ${p.drop.toFixed(1)} m.`);
    reasons.push(p.U <= 0.25 ? "Inside the HiRISE corridor: imagery at ~1 m detail." : "Outside the HiRISE corridor: terrain from coarser HRSC data, more uncertain.");
    if (p.level === "HIGH") recs.push("Avoid or approach only with a rover; pick the Safest route.");
    if (p.drop > 8) recs.push("Check for a scarp or crater wall in HiRISE before walking here.");
    recs.push("Verify boulders and ripples smaller than ~50 m on HiRISE images along the planned corridor.");
    return `<div class="hz-top"><div><span class="eyebrow">Mission safety · hazard</span><h3>${title}</h3>
        <span class="mono hz-coord">${p.lat.toFixed(4)}°N ${p.lng.toFixed(4)}°E</span></div>
        <span class="hz-badge hz-${p.level.toLowerCase()}">${p.level} · R=${p.R.toFixed(2)}</span></div>
      <div class="hz-bars">${[["Slope S", p.S], ["Terrain T", p.T], ["Obstacle O", p.O], ["Uncertainty U", p.U]].map(([k, v]) =>
        `<div><span>${k} <b>${pct(v)}</b></span><i><em style="width:${pct(v)}"></em></i></div>`).join("")}</div>
      <p class="hz-src"><b>Data:</b> HiRISE + HRSC elevation (USGS Astrogeology), HiRISE/CTX imagery. <b>Method:</b> central-difference slope, 3×3 TRI and max neighbour drop, weighted sum.</p>
      <div class="hz-cols"><div><b>Reasons</b><ul>${reasons.map((r) => `<li>${r}</li>`).join("")}</ul></div>
        <div><b>Recommendations</b><ul>${recs.map((r) => `<li>${r}</li>`).join("")}</ul></div></div>
      ${note ? `<p class="hz-note">${note}</p>` : ""}
      <p class="hz-warn">${ic("triangle-alert")}<span>Planning aid from a ~51 m elevation grid and orbital data, not a certified astronaut safety system. Small boulders and soft ground need HiRISE 1 m terrain and checks on site.</span></p>`;
  }

  let lastPlan = null, lastSel = null;
  function renderHazard() {
    if (!lastPlan) return;
    const tg = lastPlan.target, p = M.hazardAt(tg.latlng[0], tg.latlng[1]);
    const v = lastPlan.variants.find((x) => x.id === lastSel);
    const worst = v ? M.routeHazard(v.cells) : null;
    $("hazard-card").innerHTML = p ? hazardCard(`Point B · ${tg.name}`, p,
      worst ? `Worst point on the ${v.label.toLowerCase()} route: ${worst.level} (R=${worst.R.toFixed(2)}, slope ${worst.slope.toFixed(1)}°) at ${worst.lat.toFixed(3)}°N ${worst.lng.toFixed(3)}°E.` : "") : "";
  }

  // ---------- Научные находки ----------
  function distKm(a, b) { const k = Math.PI / 180, R = 3389.5; return R * Math.acos(Math.min(1, Math.sin(a[0] * k) * Math.sin(b[0] * k) + Math.cos(a[0] * k) * Math.cos(b[0] * k) * Math.cos((a[1] - b[1]) * k))); }
  let detailId = null;
  function renderSci() {
    const T = root.TARGETS, cat = $("sci-cat").value, ev = $("sci-ev").value, near = $("sci-near").checked;
    const B = lastPlan ? lastPlan.target.latlng : root.HABITAT.latlng, rKm = (opts.radiusM || 400) / 1000;
    const list = T.filter((t) => (!cat || t.category === cat) && (!ev || t.evidence === ev) && (!near || distKm(B, t.latlng) <= rKm));
    $("sci-count").textContent = `${list.length} of ${T.length} targets`;
    $("sci-list").innerHTML = list.length ? list.map((t) => `<li><button type="button" data-id="${t.id}" class="${t.id === detailId ? "on" : ""}">
      <span class="s-ico">${ic(t.icon)}</span><span><b>${t.name}</b><small>${t.category} · ${t.evidence}</small></span>
      <span class="mono">${distKm(root.HABITAT.latlng, t.latlng).toFixed(1)} km</span></button></li>`).join("")
      : `<li class="sci-empty">No targets match. Widen the search radius or clear the filters.</li>`;
    const d = T.find((t) => t.id === detailId);
    $("sci-detail").innerHTML = d ? `<span class="ev-badge">${d.evidence}</span><h4>${d.name}</h4><p>${d.why || ""}</p>
      <p class="muted mono">${d.latlng[0].toFixed(4)}°N ${d.latlng[1].toFixed(4)}°E · ${distKm(root.HABITAT.latlng, d.latlng).toFixed(1)} km from the habitat</p>
      <button type="button" class="btn sm" data-go="${d.id}">${ic("route")}Plan a walk here</button>` : "";
  }

  function init(mission, missionOpts) {
    M = mission; opts = missionOpts;
    LAYERS.forEach((l) => { M.setLayer(l.id, l.on); M.setLayerOpacity(l.id, l.op); });
    applyOrder();
    renderLayers();
    $("sl-list").addEventListener("input", (e) => {
      const li = e.target.closest(".sl-item"); if (!li) return;
      const l = LAYERS.find((x) => x.id === li.dataset.id);
      if (e.target.dataset.act === "op") { l.op = e.target.value / 100; M.setLayerOpacity(l.id, l.op); li.querySelector(".sl-op span").textContent = `${e.target.value}%`; }
    });
    $("sl-list").addEventListener("change", (e) => {
      const li = e.target.closest(".sl-item"); if (!li || e.target.dataset.act !== "toggle") return;
      const l = LAYERS.find((x) => x.id === li.dataset.id);
      l.on = e.target.checked; M.setLayer(l.id, l.on); M.setLayerOpacity(l.id, l.op);
      li.classList.toggle("on", l.on);
      $("sl-count").textContent = `${LAYERS.filter((x) => x.on).length}/${LAYERS.length} active`;
    });
    $("sl-list").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const li = b.closest(".sl-item"), k = LAYERS.findIndex((x) => x.id === li.dataset.id);
      if (b.dataset.act === "info") { const p = li.querySelector(".sl-info"); p.hidden = !p.hidden; return; }
      const j = b.dataset.act === "up" ? k - 1 : k + 1;
      if (j < 0 || j >= LAYERS.length) return;
      [LAYERS[k], LAYERS[j]] = [LAYERS[j], LAYERS[k]];
      applyOrder(); renderLayers();
    });
    $("sl-collapse").addEventListener("click", () => {
      const box = $("sl-list").closest(".sci-layers");
      box.classList.toggle("collapsed");
      $("sl-collapse").innerHTML = ic(box.classList.contains("collapsed") ? "chevron-down" : "chevron-up");
    });

    // параметры опасности
    [["s-w1", "o-w1", "w1"], ["s-w2", "o-w2", "w2"], ["s-w3", "o-w3", "w3"], ["s-w4", "o-w4", "w4"], ["s-thr", "o-thr", "thr"]].forEach(([id, out, key]) => {
      $(id).addEventListener("change", () => { M.setHazard(key, Number($(id).value)); renderLayers(); renderHazard(); });
      $(id).addEventListener("input", () => { $(out).textContent = key === "thr" ? `${$(id).value}°` : Number($(id).value).toFixed(2); });
    });

    // параметры маршрута
    $("s-radius").addEventListener("input", () => { $("o-radius").textContent = `${$("s-radius").value} m`; });
    $("s-radius").addEventListener("change", () => { M.setOpt("radiusM", Number($("s-radius").value)); renderSci(); });
    $("opt-mode").addEventListener("change", () => {
      const m = $("opt-mode").value;
      document.querySelector(".variants").dataset.mode = m;
      if (m !== "all" && lastPlan && lastPlan.variants.find((v) => v.id === m)) M.selectVariant(m);
    });

    // находки
    const uniq = (k) => [...new Set(root.TARGETS.map((t) => t[k]))];
    $("sci-cat").innerHTML += uniq("category").map((c) => `<option>${c}</option>`).join("");
    $("sci-ev").innerHTML += uniq("evidence").map((c) => `<option>${c}</option>`).join("");
    ["sci-cat", "sci-ev", "sci-near"].forEach((id) => $(id).addEventListener("change", renderSci));
    $("sci-list").addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (b) { detailId = b.dataset.id; renderSci(); } });
    $("sci-detail").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) { M.setTarget(b.dataset.go); } });
    renderSci();
    // на телефоне панель слоёв свёрнута, чтобы не закрывать карту
    if (root.innerWidth < 900) $("sl-collapse").click();
    if (root.lucide) root.lucide.createIcons();
  }
  function onPlan(plan, sel) {
    lastPlan = plan; lastSel = sel;
    if (!M) return;
    renderHazard();
    if (!detailId && plan.target.id !== "custom") detailId = plan.target.id;
    renderSci();
    const m = $("opt-mode") && $("opt-mode").value;
    const list = document.querySelector(".variants");
    if (list) list.dataset.mode = m || "all";
  }

  root.SciLayers = { init, onPlan };
})(window);
