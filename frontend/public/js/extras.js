// Усиление под номинации Space Apps: язык (EN/RU/TJ), проверка устойчивости рейтинга,
// открытые данные, ссылки на план, «звук маршрута», открытка, 3D-рельеф и режим истории.
(function (root) {
  const $ = (id) => document.getElementById(id);

  // ---------- Язык ----------
  // Интерфейс и голос — только на английском
  const STR = {
    en: {
      story: "Story", tab_overview: "Overview", tab_compare: "Compare sites", tab_concept: "Mission concept", tab_mission: "Marswalk", tab_env: "Environment", tab_method: "Method",
      hero_eyebrow: "Site selection", hero_title: "Where to work on Mars",
      welcome: "Greetings, Earthling. I’m Zyro, your mission assistant. Want a one-minute tour of how we pick a place to land and plan a safe Marswalk?",
      pc_kicker: "POSTCARD FROM MARS", pc_from: "From", pc_back: "Back at", pc_dist: "Distance", pc_time: "Total time", pc_slope: "Max slope", pc_o2: "Oxygen used",
      story_label: "Story",
    },
  };
  const lang = "en";
  const t = (k) => STR.en[k] || k;
  const ttsLang = () => "en";
  function applyLang() {
    document.documentElement.lang = lang === "tg" ? "tg" : lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  }

  // ---------- Сохранение файлов: на claude.ai через downloads, иначе обычной ссылкой ----------
  let dl = null;
  if (root.claude && root.claude.use) root.claude.use("downloads").then((x) => { dl = x; }).catch(() => {});
  async function saveFile(filename, data, mime, toast) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    if (dl) {
      try { await dl.save({ filename, data: blob }); return; } catch (e) {
        if (e && e.code === "declined") return;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (toast && root.self !== root.top) toast(`If the download didn’t start, open the site on GitHub Pages: ${filename}`);
  }

  // Детерминированный генератор случайных чисел — результат повторяем
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  function initExtras(C) {
    applyLang();
    // ---------- Проверка устойчивости рейтинга (Монте-Карло) ----------
    function renderRobust() {
      const box = $("robust");
      if (!box) return;
      const R = C.ranking(), ok = R.ok, P = C.PARAMS, w0 = C.state.w;
      const N = 1000, rand = rng(2026);
      const first = new Map(), top3 = new Map();
      ok.forEach((r) => { first.set(r.s.id, 0); top3.set(r.s.id, 0); });
      for (let k = 0; k < N; k++) {
        const w = {};
        let sum = 0;
        P.forEach((p) => { w[p.id] = w0[p.id] * (0.5 + rand()); sum += w[p.id]; });
        P.forEach((p) => { w[p.id] /= sum || 1; });
        const scores = ok.map((r) => {
          const x = r.f.x;
          const nx = {
            water: Math.min(1, Math.max(0, x.water + (rand() - 0.5) * 0.2)),       // ±0.1 on each 0..1 input
            sunlight: x.sunlight,
            pressure: Math.min(1, Math.max(0, x.pressure * (0.85 + rand() * 0.3))), // ±15%: сезонные колебания давления
            terrain: Math.min(1, Math.max(0, x.terrain + (rand() - 0.5) * 0.2)),
            science: Math.min(1, Math.max(0, x.science + (rand() - 0.5) * 0.2)),
          };
          return { id: r.s.id, sc: P.reduce((a, p) => a + w[p.id] * nx[p.id], 0) };
        }).sort((a, b) => b.sc - a.sc);
        first.set(scores[0].id, first.get(scores[0].id) + 1);
        scores.slice(0, 3).forEach((x) => top3.set(x.id, top3.get(x.id) + 1));
      }
      const rows = ok.map((r) => ({ r, p1: first.get(r.s.id) / N, p3: top3.get(r.s.id) / N }))
        .filter((x) => x.p3 > 0).sort((a, b) => b.p1 - a.p1 || b.p3 - a.p3).slice(0, 6);
      const lead = rows[0], second = rows[1];
      const verdict = lead.p1 >= 0.75 ? `Stable: ${lead.r.s.name} stays #1 in ${Math.round(lead.p1 * 100)}% of trials.`
        : lead.p1 >= 0.45 ? `Likely: ${lead.r.s.name} is #1 in ${Math.round(lead.p1 * 100)}% of trials; ${second ? second.r.s.name : "the next site"} in ${second ? Math.round(second.p1 * 100) : 0}%.`
        : `Close race: no site is #1 in more than half of the trials. The choice depends on your priorities.`;
      box.innerHTML = `
        <div class="card-head"><h3><i data-lucide="flask-conical"></i>How robust is the ranking?</h3><span class="muted">1,000 random trials · seed 2026</span></div>
        <p class="robust-verdict">${verdict}</p>
        <div class="robust-rows">${rows.map((x) => `
          <div class="rb-row"><span class="rb-name"><span class="s-ico">${C.icon(x.r.s.icon)}</span>${x.r.s.name}</span>
            <div class="rb-bars"><div class="rb-bar"><span style="width:${(x.p1 * 100).toFixed(1)}%"></span></div><div class="rb-bar t3"><span style="width:${(x.p3 * 100).toFixed(1)}%"></span></div></div>
            <span class="mono rb-num">${Math.round(x.p1 * 100)}%<small>${Math.round(x.p3 * 100)}%</small></span></div>`).join("")}</div>
        <div class="rb-legend"><span><i class="k1"></i>#1</span><span><i class="k3"></i>Top 3</span></div>
        <p class="muted">Each trial changes every weight by up to ±50% and adds input uncertainty: water, terrain and science ±0.1 on their 0 to 1 scales, air pressure ±15% for the seasonal cycle. Then we rank again.</p>`;
      C.icons();
    }

    // ---------- Открытые данные ----------
    function routeGeoJSON() {
      const m = C.mission(), v = m && m.selected;
      if (!v) return null;
      const T = m.terrain, tg = m.plan.target, A = m.plan.start;
      const coords = v.cells.map((i) => { const [la, ln] = T.latLngOf(i); return [+ln.toFixed(6), +la.toFixed(6), Math.round(T.elev[i])]; });
      return {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "LineString", coordinates: coords },
            properties: { name: `${A.name} → ${tg.name}`, variant: v.label, distance_m: Math.round(v.sum.distance), ascent_m: Math.round(v.sum.ascent),
              max_slope_deg: +v.sum.maxSlope.toFixed(1), total_time_s: Math.round(v.eva.totalS), oxygen_used: +v.eva.o2Used.toFixed(2), go: v.eva.go,
              walk_check: "SIMULATED (Tobler pace x 0.6 suit factor)", terrain: T.meta.source, provenance: T.meta.provenance, body: "Mars", crs_note: "planetocentric latitude, east longitude, degrees" } },
          { type: "Feature", geometry: { type: "Point", coordinates: [A.latlng[1], A.latlng[0]] }, properties: { name: `A · ${A.name}`, note: A.why } },
          { type: "Feature", geometry: { type: "Point", coordinates: [tg.latlng[1], tg.latlng[0]] }, properties: { name: tg.name } },
        ],
      };
    }
    function downloadRoute() {
      const g = routeGeoJSON();
      if (!g) { C.toast("Open the Marswalk tab and choose a route first."); C.enterMission(); return; }
      saveFile(`marswalk-${C.mission().plan.target.id}-${C.mission().selected.id}.geojson.json`, JSON.stringify(g, null, 2), "application/json", C.toast);
    }
    function sitesRows() {
      return C.ranking().all.map((r) => ({
        rank: r.excluded.length ? "" : r.rank, site: r.s.name, lat: r.s.lat, lon: r.s.lon, elevation_km: r.s.elevKm,
        pressure_pa: Math.round(r.f.P), water: +r.f.x.water.toFixed(2), sunlight: +r.f.x.sunlight.toFixed(2), pressure_scaled: +r.f.x.pressure.toFixed(2),
        terrain: +r.f.x.terrain.toFixed(2), science: +r.f.x.science.toFixed(2), mola_p90_slope_deg: r.s.molaP90Deg, water_class: r.s.waterClass,
        index: +r.score.toFixed(1), excluded: r.excluded.join("; "),
        ice: r.s.ice, water_source: r.s.waterSrc,
      }));
    }
    $("dl-sites-csv").addEventListener("click", () => {
      const rows = sitesRows(), keys = Object.keys(rows[0]);
      const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const csv = [keys.join(",")].concat(rows.map((r) => keys.map((k) => esc(r[k])).join(","))).join("\n");
      saveFile("marswalk-sites.csv", csv, "text/csv", C.toast);
    });
    $("dl-sites-json").addEventListener("click", () => {
      const out = {
        generated: new Date().toISOString(), profile: C.profileLabel(), weights: C.state.w,
        constraints: root.CONSTRAINTS, models: { pressure: "P = 610 Pa * exp(-h / 11.1 km)", index: "S = sum(w_i * x_i)" },
        sites: C.ranking().all.map((r) => ({ ...sitesRows().find((x) => x.site === r.s.name), nasa_data: r.s.data,
          photos: (root.PHOTOS[r.s.id] || []).map((p) => ({ pia: p.pia, title: p.title, url: root.PJ_PAGE(p.pia) })),
          expedition: root.EXPEDITIONS[r.s.id] || null })),
      };
      saveFile("marswalk-sites.json", JSON.stringify(out, null, 2), "application/json", C.toast);
    });
    $("dl-route").addEventListener("click", downloadRoute);
    $("btn-geojson").addEventListener("click", downloadRoute);

    // ---------- Ссылка на план (#plan-цель-вариант) ----------
    function planLink() {
      const m = C.mission(), v = m && m.selected;
      const base = location.href.split("#")[0];
      // shortcut: a link carries a named Jezero target and a route only; other regions and custom points open the Marswalk tab. Add region and coordinates to the hash when links must restore them.
      if (!v || !root.TARGETS.includes(m.plan.target) || m.plan.start.id !== "habitat") return `${base}#mission`;
      return `${base}#plan-${m.plan.target.id}-${v.id}`;
    }
    async function copyPlan() {
      const url = planLink();
      try { await navigator.clipboard.writeText(url); C.toast("Plan link copied. Anyone who opens it sees the same walk."); }
      catch (_) { C.toast(url); }
    }
    $("btn-share").addEventListener("click", copyPlan);
    $("pc-share").addEventListener("click", copyPlan);
    async function openFromHash() {
      const h = (location.hash || "").slice(1);
      const mPlan = /^plan-([a-z]+)-([a-z]+)$/.exec(h);
      const mSite = /^site-([a-z]+)$/.exec(h);
      if (mSite && root.SITES.find((x) => x.id === mSite[1])) { $("intro").hidden = true; C.showTab("overview"); C.selectSite(mSite[1], true); return; }
      if (!mPlan) return;
      $("intro").hidden = true;
      const m = await C.planJezero(mPlan[1]);
      if (m && m.plan && m.plan.variants.find((v) => v.id === mPlan[2])) m.selectVariant(mPlan[2]);
    }
    openFromHash();

    // ---------- Звук маршрута: высота → высота тона ----------
    let audio = null;
    $("btn-listen").addEventListener("click", () => {
      const m = C.mission(), v = m && m.selected;
      if (!v) return;
      if (audio) { audio.stop(); return; }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) { C.toast("Audio isn’t available in this browser."); return; }
      const ac = new AC();
      const T = m.terrain, el = v.cells.map((i) => T.elev[i]);
      const lo = Math.min(...el), hi = Math.max(...el), span = Math.max(5, hi - lo);
      const dur = Math.min(9, Math.max(5, v.cells.length / 25));
      const osc = ac.createOscillator(), gain = ac.createGain(), lp = ac.createBiquadFilter();
      osc.type = "triangle"; lp.type = "lowpass"; lp.frequency.value = 1800;
      osc.connect(lp); lp.connect(gain); gain.connect(ac.destination);
      const t0 = ac.currentTime + 0.05;
      gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(0.18, t0 + 0.15);
      el.forEach((z, k) => {
        const f = 196 * Math.pow(2, ((z - lo) / span) * 2); // две октавы от соль малой
        osc.frequency.linearRampToValueAtTime(f, t0 + (k / (el.length - 1)) * dur);
      });
      // щелчки на крутых участках
      const slope = v.cells.map((i) => T.slope[i]);
      slope.forEach((s, k) => {
        if (s < C.maxSlope() * 0.6) return;
        const ck = ac.createOscillator(), cg = ac.createGain();
        ck.frequency.value = 1400; ck.connect(cg); cg.connect(ac.destination);
        const tk = t0 + (k / (el.length - 1)) * dur;
        cg.gain.setValueAtTime(0.0001, tk); cg.gain.exponentialRampToValueAtTime(0.12, tk + 0.005); cg.gain.exponentialRampToValueAtTime(0.0001, tk + 0.06);
        ck.start(tk); ck.stop(tk + 0.07);
      });
      gain.gain.setValueAtTime(0.18, t0 + dur - 0.2); gain.gain.linearRampToValueAtTime(0, t0 + dur);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
      // бегунок по профилю
      const svg = $("profile").querySelector("svg");
      let head = null;
      if (svg) {
        head = document.createElementNS("http://www.w3.org/2000/svg", "line");
        head.setAttribute("class", "pf-head"); head.setAttribute("y1", "0"); head.setAttribute("y2", "100");
        svg.appendChild(head);
      }
      const start = performance.now();
      let raf = 0;
      const tick = () => {
        const p = Math.min(1, (performance.now() - start) / 1000 / dur);
        if (head) { const x = 44 + p * (360 - 44); head.setAttribute("x1", x); head.setAttribute("x2", x); }
        if (p < 1) raf = requestAnimationFrame(tick); else audio && audio.stop();
      };
      tick();
      $("btn-listen").classList.add("on");
      audio = { stop() { cancelAnimationFrame(raf); try { osc.stop(); } catch (_) { /* уже остановлен */ } ac.close(); if (head) head.remove(); $("btn-listen").classList.remove("on"); audio = null; } };
      C.toast("Pitch follows elevation; clicks mark steep stretches.");
    });

    // ---------- Открытка с Марса ----------
    const imgCache = {};
    const loadImg = (src) => imgCache[src] || (imgCache[src] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));
    async function drawPostcard() {
      const m = C.mission(), v = m && m.selected;
      if (!v) return false;
      const T = m.terrain, tg = m.plan.target, A = m.plan.start;
      const cv = $("pc-canvas"), g = cv.getContext("2d");
      const W = cv.width, H = cv.height;
      const line = v.cells.map((i) => T.latLngOf(i));
      const lats = line.map((p) => p[0]).concat([A.latlng[0]]), lngs = line.map((p) => p[1]).concat([A.latlng[1]]);
      let s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lngs), e = Math.max(...lngs);
      const cosL = Math.cos((s + n) / 2 * Math.PI / 180);
      const padLat = (n - s) * 0.35 + 0.004, padLng = (e - w) * 0.35 + 0.004;
      s -= padLat; n += padLat; w -= padLng; e += padLng;
      // соотношение сторон кадра по реальным расстояниям
      const want = W / H;
      const cur = ((e - w) * cosL) / (n - s);
      if (cur < want) { const d = ((n - s) * want / cosL - (e - w)) / 2; w -= d; e += d; } else { const d = ((e - w) * cosL / want - (n - s)) / 2; s -= d; n += d; }
      const img = m.relief(), B = T.bounds; // relief drawn from the region's elevation grid; outside the grid the card stays dark
      const sx = (w - B.west) / (B.east - B.west) * img.width, sw = (e - w) / (B.east - B.west) * img.width;
      const sy = (B.north - n) / (B.north - B.south) * img.height, sh = (n - s) / (B.north - B.south) * img.height;
      g.fillStyle = "#1a1512"; g.fillRect(0, 0, W, H);
      g.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
      // мягкое затемнение для текста
      let gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, "rgba(10,10,14,.55)"); gr.addColorStop(0.35, "rgba(10,10,14,0)"); gr.addColorStop(0.62, "rgba(10,10,14,0)"); gr.addColorStop(1, "rgba(10,10,14,.82)");
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      const P = (la, ln) => [(ln - w) / (e - w) * W, (n - la) / (n - s) * H];
      // маршрут
      g.lineJoin = "round"; g.lineCap = "round";
      g.beginPath(); line.forEach(([la, ln], k) => { const [x, y] = P(la, ln); k ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = "rgba(10,10,14,.75)"; g.lineWidth = 12; g.stroke();
      g.strokeStyle = "#cfe26a"; g.lineWidth = 6; g.stroke();
      const dot = (la, ln, fill, label) => {
        const [x, y] = P(la, ln);
        g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 3; g.strokeStyle = "#12141b"; g.stroke();
        g.font = "600 22px 'Inter Tight', system-ui, sans-serif"; g.fillStyle = "#fff"; g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 6;
        g.fillText(label, x + 20, y + 7); g.shadowBlur = 0;
      };
      dot(A.latlng[0], A.latlng[1], "#f3f2ee", `A · ${A.name}`);
      dot(tg.latlng[0], tg.latlng[1], "#cfe26a", `B · ${tg.name}`);
      // заголовок
      g.fillStyle = "#cfe26a"; g.font = "700 20px 'Inter Tight', system-ui, sans-serif";
      g.fillText(t("pc_kicker"), 48, 64);
      g.fillStyle = "#fff"; g.font = "800 64px 'Archivo', 'Inter Tight', system-ui, sans-serif";
      try { g.fontStretch = "condensed"; } catch (_) { /* не поддерживается */ }
      g.fillText(`${C.region().name.toUpperCase()} · ${tg.name.toUpperCase()}`, 46, 128, W - 92);
      try { g.fontStretch = "normal"; } catch (_) { /* не поддерживается */ }
      // the sol count is Perseverance's, so it is printed at Jezero only
      const sol = C.region().id === "jezero" && root.MarsClock ? `Sol ${root.MarsClock.perseveranceSol(Date.now(), 77.45)} · ` : "";
      g.font = "500 22px 'JetBrains Mono', ui-monospace, monospace"; g.fillStyle = "rgba(255,255,255,.85)";
      g.fillText(`${sol}${Math.abs(A.latlng[0]).toFixed(2)}°${A.latlng[0] >= 0 ? "N" : "S"} ${A.latlng[1].toFixed(2)}°E · ${v.label}`, 48, 164);
      // показатели
      const stats = [[t("pc_dist"), C.fmtKm(v.sum.distance)], [t("pc_time"), C.fmtDur(v.eva.totalS)], [t("pc_slope"), `${v.sum.maxSlope.toFixed(0)}°`], [t("pc_o2"), `${Math.round(v.eva.o2Used * 100)}%`]];
      stats.forEach(([k, val], i) => {
        const x = 48 + i * 160, y = H - 92;
        g.font = "500 18px 'Inter Tight', system-ui, sans-serif"; g.fillStyle = "rgba(255,255,255,.7)"; g.fillText(k, x, y);
        g.font = "600 36px 'Inter Tight', system-ui, sans-serif"; g.fillStyle = "#fff"; g.fillText(val, x, y + 42);
      });
      // подпись и Zyro
      const name = ($("pc-name").value || "").trim() || "A Marswalker";
      g.font = "italic 500 22px 'Inter Tight', system-ui, sans-serif"; g.fillStyle = "#fff"; g.textAlign = "right";
      g.fillText(`${t("pc_from")}: ${name}`, W - 150, H - 72);
      g.textAlign = "left";
      g.font = "500 14px 'Inter Tight', system-ui, sans-serif"; g.fillStyle = "rgba(255,255,255,.55)";
      g.fillText(`Relief: ${T.meta.dem} (NASA, USGS) · Marswalk by Grass on Mars, NASA Space Apps 2026`, 48, H - 18);
      try {
        const face = await loadImg(root.ASSETS.nova.cool);
        g.save(); g.beginPath(); g.arc(W - 86, H - 80, 48, 0, Math.PI * 2); g.closePath(); g.clip();
        g.drawImage(face, W - 134, H - 128, 96, 96); g.restore();
        g.beginPath(); g.arc(W - 86, H - 80, 48, 0, Math.PI * 2); g.lineWidth = 4; g.strokeStyle = "#cfe26a"; g.stroke();
      } catch (_) { /* без портрета */ }
      return true;
    }
    async function openPostcard() {
      if (!(C.mission() && C.mission().selected)) { C.toast("Plan a route first."); C.enterMission(); return; }
      const d = $("pc-modal");
      if (d.showModal) d.showModal(); else d.setAttribute("open", "");
      await drawPostcard();
    }
    $("btn-postcard").addEventListener("click", openPostcard);
    $("pc-name").addEventListener("input", () => drawPostcard());
    $("pc-close").addEventListener("click", () => $("pc-modal").close());
    $("pc-modal").addEventListener("click", (e) => { if (e.target === $("pc-modal")) $("pc-modal").close(); });
    $("pc-save").addEventListener("click", () => {
      $("pc-canvas").toBlob((b) => b && saveFile(`postcard-from-mars-${C.mission().plan.target.id}.png`, b, "image/png", C.toast), "image/png");
    });

    // ---------- 3D-рельеф ----------
    function open3D() {
      const m = C.mission();
      if (!m) return;
      const v = m.selected;
      const box = $("terrain3d");
      box.hidden = false;
      $("t3d-src").textContent = `3D terrain · ${m.terrain.meta.dem}, relief colours`;
      const ok = root.Terrain3D.open(box, {
        terrain: m.terrain, imageUrl: m.relief().toDataURL(),
        route: v ? v.cells.map((i) => m.terrain.latLngOf(i)) : null,
        habitat: m.start.latlng, target: m.current.latlng, exaggeration: Number($("t3d-ex").value),
      });
      if (!ok) { box.hidden = true; C.toast("3D needs WebGL, which this browser doesn’t offer."); }
    }
    function close3D() { root.Terrain3D.close(); $("terrain3d").hidden = true; }
    $("btn-3d").addEventListener("click", () => { if (!C.mission()) { C.enterMission(); return; } open3D(); });
    $("t3d-close").addEventListener("click", close3D);
    $("t3d-ex").addEventListener("input", (e) => { $("t3d-ex-o").textContent = e.target.value; root.Terrain3D.setExaggeration(Number(e.target.value)); });

    // ---------- Режим истории ----------
    const STORY = {
      en: [
        "Sol 1. Somewhere between Earth and Mars, a crew asks one question: where do we land, and where can we walk? We are Grass on Mars, three friends from Dushanbe, and this is our answer.",
        "Water comes first. It is drinking water, oxygen and rocket fuel. NASA radar and cameras found ice under these northern plains.",
        "For a long-term base with a greenhouse, Arcadia Planitia wins: ice about a metre down, smooth ground, thicker air.",
        "Science means testing ourselves. We shake the weights and add measurement error a thousand times and see who stays on top. Every number can be downloaded and checked.",
        "But the first walk goes to Jezero, an ancient lake where a river built a delta. Perseverance is already there, collecting samples.",
        "This is real terrain from NASA’s orbital elevation model of Jezero. I plan up to three routes from the landing site to the delta front: the shortest, the lowest terrain risk and the science route.",
        "Here is the same walk in 3D, built from the same elevation data. The steep scarps are where the delta ends.",
        "__verdict__",
        "Every walk ends with a postcard from Mars, signed with your name, that you can share with anyone on Earth.",
        "From Dushanbe to Jezero. Today we map the way. One day, even grass could grow on Mars.",
      ],
    };
    const VERDICT = {
      en: (go) => go ? "Go or no go? The walk fits in suit time with a 30% oxygen reserve, and the crew is back before dark. On the way, I guide every turn."
        : "Go or no go? Today it is no go: the safety check fails, so the crew stays in. Safety rules come before science.",
    };
    function startStory() {
      const L = STORY.en, V = VERDICT.en;
      if (C.stopNav) C.stopNav();
      if (root.Zyro && !root.Zyro.voiceOn) root.Zyro.setVoice(true); // нажатие — разрешение на голос
      const clickFilter = (id) => { const b = document.querySelector(`.filter[data-f="${id}"]`); if (b && b.getAttribute("aria-pressed") !== "true") b.click(); };
      const resetFilters = () => { const b = document.querySelector('.filter[data-f="all"]'); if (b) b.click(); };
      const steps = [
        { before: () => { $("intro").hidden = true; close3D(); C.showTab("overview"); resetFilters(); C.setProfile("base"); }, wait: 900, el: () => $("globe-stage"), text: L[0], mood: "cool" },
        { before: () => clickFilter("ice"), el: () => $("filters"), text: L[1], mood: "smug" },
        { before: () => C.selectSite("arcadia", false), el: () => document.querySelector(".brief"), text: L[2], mood: "cool" },
        { before: () => C.showTab("compare"), wait: 700, el: () => $("robust"), text: L[3], mood: "smug" },
        { before: () => { C.showTab("overview"); resetFilters(); C.selectSite("jezero", false); }, wait: 700, el: () => document.querySelector(".globe-pins .pin.playable") || $("globe-stage"), text: L[4], mood: "wink" },
        { before: () => { C.planJezero("delta"); }, wait: 2200, el: () => $("variants"), text: L[5], mood: "cool" },
        { before: () => open3D(), wait: 900, el: null, text: L[6], mood: "smug", ms: 9000 },
        { before: () => close3D(), el: () => $("verdict"), text: () => V(!!(C.mission() && C.mission().selected && C.mission().selected.eva.go)), mood: "cool" },
        { before: () => openPostcard(), wait: 900, el: null, text: L[8], mood: "wink" },
        { before: () => { $("pc-modal").close(); C.showTab("overview"); }, wait: 700, el: () => document.querySelector(".hero h1"), text: L[9], mood: "wink", ms: 8000 },
      ];
      root.Buddy.tour(steps, 0, { auto: true, label: t("story_label"), lang: ttsLang(), onEnd: () => { close3D(); } });
    }
    $("story-btn").addEventListener("click", startStory);
    $("intro-story").addEventListener("click", () => { $("intro").classList.add("out"); setTimeout(() => { $("intro").hidden = true; }, 400); startStory(); });


    // ---------- Меню разделов ----------
    const MENU = [
      { tab: "overview", title: "Overview", img: "mars", color: "c-blue", hint: "3D Mars with 14 candidate sites. Tap a site for its score, risks, weather twin on Earth, NASA photos and past missions." },
      { tab: "compare", title: "Compare sites", img: "insight", color: "c-teal", hint: "Rank every site for a mission profile, tune the weights and stress-test the ranking with 1,000 trials." },
      { tab: "concept", title: "Mission concept", img: "hab", color: "c-violet", hint: "Grass on Mars I: mission pipeline, real NASA hardware, radiation, oxygen and power budgets, expected results." },
      { tab: "mission", title: "Marswalk", img: "astro", color: "c-lime", hint: "Pick a region and a landing point, plan a walk on NASA terrain, compare routes, check oxygen and daylight, then navigate turn by turn." },
      { tab: "env", title: "Environment", img: "m2020", color: "c-teal", hint: "What NASA instruments measured: MEDA temperature, pressure and wind by sol, the THEMIS thermal map, and what data is loaded." },
      { tab: "method", title: "Method", img: "mro", color: "c-amber", hint: "The NASA data, the models, how we tested them, and open data you can download and check." },
    ];
    const IMG = root.SYSTEM_IMG || {};
    $("menu-grid").innerHTML = MENU.map((m, i) => `<button type="button" class="menu-card ${m.color}" data-tab="${m.tab}" style="--d:${i * 45}ms">
      <span class="mc-art">${IMG[m.img] ? `<img src="${IMG[m.img]}" alt="">` : ""}</span>
      <span class="mc-text"><span class="mc-num mono">0${i + 1}</span><b>${m.title}</b><small>${m.hint}</small></span>
      <span class="mc-go">${C.icon("arrow-up-right")}</span></button>`).join("");
    function openMenu() {
      const cur = C.currentTab();
      document.querySelectorAll(".menu-card").forEach((b) => b.classList.toggle("on", b.dataset.tab === cur));
      $("menu").hidden = false;
      requestAnimationFrame(() => $("menu").classList.add("open"));
      $("menu-btn").setAttribute("aria-expanded", "true");
      setTimeout(() => { const f = document.querySelector(".menu-card.on") || document.querySelector(".menu-card"); if (f) f.focus(); }, 60);
    }
    function closeMenu() {
      $("menu").classList.remove("open");
      $("menu-btn").setAttribute("aria-expanded", "false");
      setTimeout(() => { $("menu").hidden = true; }, 220);
    }
    $("menu-btn").addEventListener("click", openMenu);
    $("menu-close").addEventListener("click", closeMenu);
    $("menu").addEventListener("click", (e) => { if (e.target === $("menu")) closeMenu(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("menu").hidden) closeMenu(); });
    $("menu-grid").addEventListener("click", (e) => {
      const b = e.target.closest(".menu-card");
      if (!b) return;
      closeMenu();
      C.showTab(b.dataset.tab);
    });
    $("menu-home").addEventListener("click", () => {
      closeMenu();
      if (root.Zyro) root.Zyro.stopSpeaking();
      root.Buddy && root.Buddy.hide();
      const intro = $("intro");
      intro.hidden = false;
      intro.classList.remove("out");
    });

    // ---------- Эквалайзер: реагирует на слова, которые произносит синтезатор ----------
    const NB = 16;
    $("eq-bars").innerHTML = Array.from({ length: NB }, () => "<i></i>").join("");
    const bars = [...$("eq-bars").children];
    const level = new Float32Array(NB), target = new Float32Array(NB);
    let eqHide = null, eqRaf = 0, eqPaused = false, lastWordAt = 0, speakingSince = 0, eqText = "", fallback = true;
    // профиль слова: гласные — громче, согласные — тише; так столбики «читают» само слово
    function pulse(word, strength) {
      const w = (word || "a").toLowerCase();
      for (let k = 0; k < NB; k++) {
        const ch = w[k % w.length] || "a";
        const vowel = "aeiouy".includes(ch) ? 1 : /[a-z]/.test(ch) ? 0.6 : 0.3;
        const centre = 1 - Math.abs(k - (NB - 1) / 2) / (NB / 2) * 0.4;
        target[k] = Math.min(1, strength * (0.6 + 0.4 * vowel) * centre * (0.8 + Math.random() * 0.4));
      }
    }
    let lastFrame = performance.now();
    function eqLoop() {
      const now = performance.now();
      const dt = Math.min(100, now - lastFrame) / 16.7; lastFrame = now;
      // если синтезатор не присылает слова, держим ритм речи сами (~3 слова в секунду)
      if (!eqPaused && fallback && now - speakingSince > 700 && now - lastWordAt > 330) { lastWordAt = now; pulse("speech", 0.8); }
      for (let k = 0; k < NB; k++) {
        if (eqPaused) target[k] *= Math.pow(0.8, dt);
        level[k] += (target[k] - level[k]) * Math.min(1, 0.55 * dt);
        target[k] *= Math.pow(0.93, dt); // затухание между словами, не зависит от частоты кадров
        bars[k].style.transform = `scaleY(${(0.12 + level[k] * 0.88).toFixed(3)})`;
      }
      eqRaf = requestAnimationFrame(eqLoop);
    }
    function setPauseBtn(p) {
      $("eq-pause").innerHTML = C.icon(p ? "play" : "pause");
      $("eq-pause").setAttribute("aria-label", p ? "Resume" : "Pause");
      $("eq").classList.toggle("paused", p);
    }
    function showWord(index, length) {
      const back = 16;
      const before = eqText.slice(Math.max(0, index - back), index), word = eqText.substr(index, length), after = eqText.slice(index + length, index + length + 60);
      const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      $("eq-text").innerHTML = `${index > back ? "…" : ""}${esc(before)}<mark>${esc(word)}</mark>${esc(after)}`;
      $("eq-prog").style.width = `${Math.min(100, ((index + length) / eqText.length) * 100).toFixed(1)}%`;
    }
    root.addEventListener("zyro-speech", (e) => {
      const d = e.detail, eq = $("eq");
      if (d.state === "start") {
        clearTimeout(eqHide);
        eqText = d.text || ""; eqPaused = false; fallback = true; speakingSince = performance.now(); lastWordAt = 0;
        $("eq-text").textContent = eqText || "Zyro is speaking";
        $("eq-prog").style.width = "0%";
        setPauseBtn(false);
        eq.hidden = false;
        requestAnimationFrame(() => eq.classList.add("on"));
        cancelAnimationFrame(eqRaf); eqLoop();
      } else if (d.state === "word") {
        fallback = false; lastWordAt = performance.now();
        pulse(d.word, Math.min(1, 0.75 + d.length / 12));
        showWord(d.index, d.length);
      } else if (d.state === "tick") {
        // голос Claude сообщает, сколько миллисекунд прозвучало: двигаем прогресс по оценке длины фразы
        const est = Math.max(1500, eqText.length * 62);
        $("eq-prog").style.width = `${Math.min(100, d.ms / est * 100).toFixed(1)}%`;
      } else if (d.state === "pause") {
        eqPaused = true; setPauseBtn(true);
      } else if (d.state === "resume") {
        eqPaused = false; setPauseBtn(false);
      } else if (d.state === "end") {
        eq.classList.remove("on");
        eqHide = setTimeout(() => { eq.hidden = true; cancelAnimationFrame(eqRaf); }, 300);
      }
    });
    $("eq-pause").addEventListener("click", () => {
      if (!root.Zyro) return;
      if (root.Zyro.paused) root.Zyro.resumeSpeaking(); else root.Zyro.pauseSpeaking();
    });
    $("eq-stop").addEventListener("click", () => root.Zyro && root.Zyro.stopSpeaking());
    $("eq-mute").addEventListener("click", () => { if (root.Zyro) { root.Zyro.setVoice(false); C.toast("Zyro is muted. Turn the voice back on with the speaker button in the chat."); } });
    document.querySelectorAll("[data-zyro-face]").forEach((el) => { if (!el.src) el.src = root.ASSETS.nova.cool; });

    // ---------- Близнец на Земле: фото и сведения ----------
    function earthMap(latlng) {
      if (!latlng) return `<div class="tw-sky">${C.icon("cloud")}<span>No place on the ground: this is the sky 50 km up.</span></div>`;
      const x = (latlng[1] + 180) / 360 * 100, y = (90 - latlng[0]) / 180 * 100;
      return `<div class="tw-earth"><img src="${root.EARTH_MAP}" alt="Map of Earth"><span class="tw-pin" style="left:${x}%;top:${y}%"></span></div>
        <small class="mono">${Math.abs(latlng[0]).toFixed(2)}°${latlng[0] >= 0 ? "N" : "S"} ${Math.abs(latlng[1]).toFixed(2)}°${latlng[1] >= 0 ? "E" : "W"} · Earth texture: NASA</small>`;
    }
    async function loadPhotos(twin) {
      const box = $("tw-photos");
      const wikiUrl = `https://en.wikipedia.org/wiki/${twin.wiki}`;
      box.innerHTML = `<div class="tw-loading">${C.icon("loader")}Loading photos from Wikipedia…</div>`;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        const [media, sum] = await Promise.all([
          fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${twin.wiki}`, { signal: ctrl.signal }).then((r) => r.json()),
          fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${twin.wiki}`, { signal: ctrl.signal }).then((r) => r.json()).catch(() => null),
        ]);
        clearTimeout(to);
        const pics = (media.items || []).filter((it) => it.type === "image" && /\.(jpe?g)$/i.test(it.title || "") && it.srcset && it.srcset.length)
          .slice(0, 4).map((it) => ({ src: (it.srcset[it.srcset.length - 1].src || "").replace(/^\/\//, "https://"), cap: (it.caption && it.caption.text) || "" }));
        if (!pics.length) throw new Error("no photos");
        box.innerHTML = `<div class="tw-grid">${pics.map((p, i) => `<figure class="${i === 0 ? "big" : ""}"><img src="${p.src}" alt="${p.cap.replace(/"/g, "&quot;")}" loading="lazy"><figcaption>${p.cap}</figcaption></figure>`).join("")}</div>
          ${sum && sum.extract ? `<p class="tw-extract">${sum.extract}</p>` : ""}
          <a class="tw-link" href="${wikiUrl}" target="_blank" rel="noopener">${C.icon("external-link")}Photos and text: Wikipedia / Wikimedia Commons</a>`;
      } catch (_) {
        box.innerHTML = `<div class="tw-offline">${C.icon("image-off")}<b>Photos load on the published site</b>
          <span>This preview can’t reach Wikipedia. On GitHub Pages the photos of ${twin.place} appear here automatically.</span>
          <a class="btn" href="${wikiUrl}" target="_blank" rel="noopener">${C.icon("external-link")}Open photos on Wikipedia</a></div>`;
      }
      C.icons();
    }
    function openTwin(siteId) {
      const twin = root.EARTH_TWINS[siteId], site = root.SITES.find((x) => x.id === siteId);
      if (!twin) return;
      const st = root.STATIONS[siteId];
      $("tw-eyebrow").textContent = `Weather twin of ${site.name}`;
      $("tw-title").textContent = twin.place;
      $("tw-country").textContent = twin.country;
      $("tw-flag").innerHTML = twin.flag && root.FLAGS[twin.flag] ? root.FLAGS[twin.flag] : C.icon(twin.latlng ? "globe" : "cloud");
      $("tw-flag").classList.toggle("none", !(twin.flag && root.FLAGS[twin.flag]));
      $("tw-map").innerHTML = earthMap(twin.latlng);
      const r = C.ranking().all.find((x) => x.s.id === siteId);
      $("tw-facts").innerHTML = `<ul class="tw-list">
        <li>${C.icon(twin.icon)}<div><b>Why it matches</b><span>${twin.why}</span></div></li>
        <li>${C.icon("gauge")}<div><b>Air on ${site.name}</b><span>${Math.round(r.f.P)} Pa, like Earth’s sky ${Math.round(root.earthAltitudeForPressure(r.f.P))} km up</span></div></li>
        ${st ? `<li>${C.icon("thermometer")}<div><b>Measured on Mars</b><span>${st.text} (${st.station})</span></div></li>` : ""}
      </ul>`;
      const d = $("twin-modal");
      if (d.showModal) d.showModal(); else d.setAttribute("open", "");
      C.icons();
      loadPhotos(twin);

    }
    $("tw-close").addEventListener("click", () => $("twin-modal").close());
    $("twin-modal").addEventListener("click", (e) => { if (e.target === $("twin-modal")) $("twin-modal").close(); });
    root.Extras.openTwin = openTwin;


    // ---------- Справка по вкладке: при первом открытии и по кнопке «?» ----------
    const HELP = {
      overview: { title: "Overview", badge: "globe",
        lead: "Hi, I’m Zyro! This is the map of Mars where we choose where a crew should work.",
        items: [["globe", "Spin the 3D Mars and tap any pin. The icon shows what is there: ice, ancient water, minerals, a volcano."],
          ["sliders-horizontal", "Filters at the bottom show only one theme; Layers adds names, landers and photo sites."],
          ["panel-right", "The right panel shows the site’s score, my analysis, its weather twin on Earth, NASA photos and past missions."],
          ["layout-grid", "Use Menu or the tabs to move around. Story plays a 2-minute guided tour."]],
        why: "Why it matters: a wrong landing site can waste the whole mission." },
      compare: { title: "Compare sites", badge: "scale",
        lead: "Here I rank all 14 sites for the kind of mission you want.",
        items: [["list-ordered", "Pick a mission profile at the top: greenhouse base, safe first landing or astrobiology."],
          ["sliders-horizontal", "Move the weight sliders to say what matters most to you; the ranking updates instantly."],
          ["flask-conical", "The robustness test shakes the numbers 1,000 times to show how sure the winner is."],
          ["table", "The table shows every site, its parameters and whether it is inside NASA’s limits."]],
        why: "Why it matters: the choice is open and explainable, not a black box." },
      concept: { title: "Mission concept", badge: "rocket",
        lead: "This is our full mission plan, Grass on Mars I.",
        items: [["clapperboard", "Watch the mission film at the top."],
          ["play", "Press Play on the pipeline and I’ll walk you through 8 phases, from site choice to the trip home."],
          ["box", "Systems shows real NASA hardware we would use; Budgets checks radiation, oxygen and power."],
          ["target", "At the bottom: science goals, risks and what the mission brings back."]],
        why: "Why it matters: it shows the mission can actually close, with numbers from NASA." },
      mission: { title: "Marswalk", badge: "footprints",
        lead: "Let’s plan a walk on NASA terrain: Jezero crater in detail, or 13 other regions of Mars.",
        items: [["map-pin", "Choose a region and a landing point A. I check it against NASA’s landing limits and offer the nearest suitable point if it fails."],
          ["route", "Choose a destination B and press Calculate route: the shortest, the lowest terrain risk and the science route."],
          ["shield-check", "Each route gets a walk check for oxygen, daylight and dust: GO or NO GO."],
          ["mountain-snow", "Open the 3D terrain, make a postcard, share the plan or download it as GeoJSON."],
          ["navigation", "Press Start navigation for turn-by-turn guidance; try the suit-leak drill."]],
        why: "Why it matters: on Mars there is no rescue, so every walk must have a safe way home." },
      env: { title: "Environment", badge: "thermometer",
        lead: "These are real measurements from NASA instruments on Mars, not a forecast.",
        items: [["thermometer", "Measured on the surface: Perseverance, Curiosity and Viking readings with their sources."],
          ["chart-line", "Charts draw Perseverance MEDA temperature, pressure and wind from NASA’s PDS archive; pick a sol or compare two."],
          ["flame", "The THEMIS map shows which ground is warmer by day or night (online)."],
          ["table", "Data availability says honestly what is loaded and what is only an assumption."]],
        why: "Why it matters: a walk plan must rest on measured conditions, and we show which numbers are measured." },
      method: { title: "Method", badge: "book-open",
        lead: "Here you can check every number Marswalk uses.",
        items: [["route", "Three steps: collect NASA data, calculate, decide and check."],
          ["database", "The NASA data table links each dataset to the archive it comes from."],
          ["calculator", "Calculations show the formulas step by step; move the sliders and pick a site."],
          ["sparkles", "Press “Explain simply” for plain words, and download the open data at the bottom."]],
        why: "Why it matters: good science can be checked by anyone." },
    };
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem("mw-help-seen") || "{}"); } catch (_) { seen = {}; }
    let helpTab = "overview", helpSpeaking = false;
    function helpText(h) { return `${h.lead} ${h.items.map((x) => x[1]).join(" ")} ${h.why}`; }
    function setHelpVoice(on) {
      helpSpeaking = on;
      $("help-voice").innerHTML = C.icon(on ? "volume-x" : "volume-2");
      $("help-voice").setAttribute("aria-label", on ? "Stop reading" : "Read aloud");
      $("help-voice").classList.toggle("on", on);
    }
    function openHelp(tab) {
      const h = HELP[tab];
      if (!h) return;
      helpTab = tab;
      $("help-title").textContent = h.title;
      $("help-badge").innerHTML = C.icon(h.badge);
      $("help-lead").textContent = h.lead;
      $("help-list").innerHTML = h.items.map(([i, t]) => `<li><span>${C.icon(i)}</span><p>${t}</p></li>`).join("");
      $("help-why").textContent = h.why;
      $("help-tour").hidden = tab !== "overview";
      setHelpVoice(false);
      root.Buddy && root.Buddy.hide();
      const d = $("help-modal");
      if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
      seen[tab] = 1;
      try { localStorage.setItem("mw-help-seen", JSON.stringify(seen)); } catch (_) { /* хранилище недоступно */ }
    }
    function closeHelp() {
      if (helpSpeaking && root.Zyro) root.Zyro.stopSpeaking();
      setHelpVoice(false);
      $("help-modal").close();
    }
    const art = document.querySelector("[data-zyro-body-help]");
    if (art) art.src = root.INTRO_PHOTO || root.ASSETS.nova.body;
    $("help-ok").addEventListener("click", closeHelp);
    $("help-tour").addEventListener("click", () => { closeHelp(); if (root.startTour) root.startTour(); });
    $("help-modal").addEventListener("click", (e) => { if (e.target === $("help-modal")) closeHelp(); });
    $("help-modal").addEventListener("close", () => { if (helpSpeaking && root.Zyro) root.Zyro.stopSpeaking(); setHelpVoice(false); });
    $("help-voice").addEventListener("click", () => {
      if (!root.Zyro) return;
      if (helpSpeaking) { root.Zyro.stopSpeaking(); setHelpVoice(false); return; }
      if (!root.Zyro.voiceOn) root.Zyro.setVoice(true);
      setHelpVoice(true);
      Promise.resolve(root.Zyro.speak(helpText(HELP[helpTab]))).then(() => setHelpVoice(false));
    });
    $("help-fab").addEventListener("click", () => openHelp(C.currentTab()));
    // вызывается при каждом открытии вкладки: попап только в первый раз
    function onTab(tab) {
      if ((root.Buddy && root.Buddy.touring) || !$("intro").hidden) return;
      if (!seen[tab] && HELP[tab]) setTimeout(() => { if (C.currentTab() === tab && !(root.Buddy && root.Buddy.touring)) openHelp(tab); }, 350);
    }
    root.Extras.onTab = onTab;
    root.Extras.openHelp = openHelp;

    return { renderRobust, t, lang: () => lang, startStory };
  }

  root.Extras = { init: initExtras, t: (k) => t(k), lang: () => lang, ttsLang };
})(window);
