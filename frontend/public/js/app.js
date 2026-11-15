// Marswalk: глобус → выбор точки → анализ данных → рекомендация → маршрут → результат выхода.
(function () {
  const $ = (id) => document.getElementById(id);
  const icons = () => { if (window.lucide) lucide.createIcons(); };
  const JEZERO_LON = 77.45;
  const SOL_HOUR_S = 3699;   // час местного марсианского времени в земных секундах
  const SUNSET = 17.5;       // условный конец светового дня (LMST)
  const RAD_PER_DAY = 0.67;  // мЗв в сутки на поверхности, Curiosity RAD

  const fmtDur = (s) => { const m = Math.max(0, Math.round(s / 60)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const fmtKm = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
  const fmtCoord = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // ---------- Модель пригодности территории ----------
  const PARAMS = [
    { id: "water", label: "Water access", icon: "droplets" },
    { id: "sunlight", label: "Sunlight", icon: "sun" },
    { id: "pressure", label: "Air pressure", icon: "gauge" },
    { id: "terrain", label: "Terrain safety", icon: "shield-check" },
    { id: "science", label: "Science value", icon: "microscope" },
  ];
  const PARAM_COLOR = { water: "#3d4fa3", sunlight: "#8f6b22", pressure: "#2d6468", terrain: "#53691f", science: "#62489a" };
  const pressurePa = (hKm) => 610 * Math.exp(-hKm / 11.1);

  const sciCount = (s) => s.scienceC.reduce((a, b) => a + b, 0);
  const fmtElevKm = (km) => `${km > 0 ? "+" : ""}${km.toFixed(2)} km`;

  function features(s) {
    const P = pressurePa(s.elevKm);
    return {
      P,
      x: {
        water: WATER_CLASS_SCORE[s.waterClass],
        sunlight: Math.cos(s.lat * Math.PI / 180),
        pressure: clamp01((P - 300) / 900),
        terrain: clamp01(1 - s.molaP90Deg / 8.0),
        science: sciCount(s) / 5,
      },
    };
  }
  function paramValue(id, s, f) {
    return {
      water: `${s.ice}`,
      sunlight: `${Math.round(f.x.sunlight * 100)}% of equator`,
      pressure: `${Math.round(f.P)} Pa`,
      terrain: `p₉₀ ${s.molaP90Deg.toFixed(2)}° (${Math.round(f.x.terrain * 100)}%)`,
      science: `${sciCount(s)} / 5 criteria`,
    }[id];
  }
  function paramShort(id, r) {
    return {
      water: `${Math.round(r.f.x.water * 100)}%`,
      sunlight: `${Math.round(r.f.x.sunlight * 100)}%`,
      pressure: `${Math.round(r.f.P)} Pa`,
      terrain: `${r.s.molaP90Deg.toFixed(1)}°`,
      science: `${sciCount(r.s)}/5`,
    }[id];
  }
  function paramSource(id, s) {
    return {
      water: `DERIVED from ${s.waterSrc}. ${s.waterWhy}`,
      sunlight: "DERIVED · cos(latitude), annual insolation proxy",
      pressure: `DERIVED · MGS MOLA ${Math.round(s.elevKm * 1000)} m, barometric P = 610·e^(−h/11.1)`,
      terrain: `DERIVED · MGS MOLA 463 m DEM (1 − p₉₀/8°). ${s.safetyWhy}`,
      science: `DERIVED · ${sciCount(s)}/5 NASA observables (${s.data.slice(0, 2).join(", ")})`,
    }[id];
  }
  function exclusions(s) {
    const r = [];
    if (Math.abs(s.lat) > CONSTRAINTS.maxAbsLat) r.push(`latitude ${Math.abs(s.lat).toFixed(0)}° is beyond ±${CONSTRAINTS.maxAbsLat}°`);
    if (s.elevKm > CONSTRAINTS.maxElevKm) r.push(`elevation ${fmtElevKm(s.elevKm)} is above +${CONSTRAINTS.maxElevKm} km`);
    return r;
  }

  const state = { profile: PROFILES[0].id, w: { ...PROFILES[0].w }, custom: false };
  const profileObj = () => PROFILES.find((p) => p.id === state.profile);

  function rank() {
    const rows = SITES.map((s) => {
      const f = features(s);
      const score = PARAMS.reduce((sum, p) => sum + state.w[p.id] * f.x[p.id], 0) * 100;
      return { s, f, score, excluded: exclusions(s) };
    });
    const ok = rows.filter((r) => !r.excluded.length).sort((a, b) => b.score - a.score);
    ok.forEach((r, i) => { r.rank = i + 1; });
    const out = rows.filter((r) => r.excluded.length).sort((a, b) => b.score - a.score);
    return { all: ok.concat(out), ok, out };
  }
  let ranking = rank();
  const rowOf = (id) => ranking.all.find((r) => r.s.id === id);

  // Почему A выше B: вклад каждого параметра с учётом весов (в пунктах индекса)
  function contributions(a, b) {
    return PARAMS.filter((p) => state.w[p.id] > 0).map((p) => ({ p, d: state.w[p.id] * (a.f.x[p.id] - b.f.x[p.id]) * 100 }));
  }
  function explain(a, b) {
    const c = contributions(a, b).sort((x, y) => y.d - x.d);
    const wins = c.filter((x) => x.d > 0.5).slice(0, 2);
    const loss = c.filter((x) => x.d < -0.5).sort((x, y) => x.d - y.d)[0];
    const gap = a.score - b.score;
    let t = gap < 1
      ? `${a.s.name} and ${b.s.name} are almost tied (${Math.round(a.score)} vs ${Math.round(b.score)}).`
      : `${a.s.name} scores ${Math.round(a.score)}, ${Math.round(gap)} point${Math.round(gap) === 1 ? "" : "s"} above ${b.s.name}.`;
    if (wins.length) t += ` ${a.s.name.split(" ")[0]} is stronger on ${wins.map((w) => `${w.p.label.toLowerCase()} (${paramShort(w.p.id, a)} vs ${paramShort(w.p.id, b)})`).join(" and ")}.`;
    if (loss) t += ` ${b.s.name} is better on ${loss.p.label.toLowerCase()} (${paramShort(loss.p.id, b)} vs ${paramShort(loss.p.id, a)}), but not by enough to change the order.`;
    return t;
  }


  // ---------- Структурированный разбор места от Zyro ----------
  function rankUnder(w, id) {
    const rows = ranking.ok.map((x) => ({ id: x.s.id, sc: PARAMS.reduce((a, p) => a + w[p.id] * x.f.x[p.id], 0) * 100 }))
      .sort((a, b) => b.sc - a.sc);
    return rows.findIndex((x) => x.id === id) + 1;
  }
  function siteBrief(r) {
    const s = r.s, ok = ranking.ok, n = ok.length;
    const avg = {};
    PARAMS.forEach((p) => { avg[p.id] = ok.reduce((a, x) => a + x.f.x[p.id], 0) / n; });
    const diffs = PARAMS.map((p) => ({ p, d: r.f.x[p.id] - avg[p.id], w: state.w[p.id] }));
    const strengths = diffs.filter((x) => x.d > 0.05).sort((a, b) => b.d * (b.w + 0.1) - a.d * (a.w + 0.1)).slice(0, 2);
    const weaks = diffs.filter((x) => x.d < -0.05).sort((a, b) => a.d * (a.w + 0.1) - b.d * (b.w + 0.1)).slice(0, 2);
    const ex = r.excluded.length > 0;

    let verdict, tone;
    if (ex) { verdict = "Outside NASA’s exploration limits"; tone = "bad"; }
    else if (r.rank === 1) { verdict = `Best site for ${state.custom ? "your weights" : profileObj().label.toLowerCase()}`; tone = "good"; }
    else if (r.rank <= Math.ceil(n / 3)) { verdict = "Strong candidate"; tone = "good"; }
    else if (r.rank <= Math.ceil(2 * n / 3)) { verdict = "Middle of the field"; tone = "mid"; }
    else { verdict = "Weak fit for this profile"; tone = "bad"; }

    // Соперник: тот, кто стоит на ступень выше (или ниже, если место первое)
    let rival = null;
    if (!ex && n > 1) {
      const other = r.rank === 1 ? ok[1] : ok[r.rank - 2];
      const c = contributions(r, other).sort((a, b) => a.d - b.d);
      const gap = Math.abs(r.score - other.score);
      rival = r.rank === 1
        ? { text: `Leads ${other.s.name} by ${gap.toFixed(1)} points`, key: c[c.length - 1] }
        : { text: `${gap.toFixed(1)} points behind ${other.s.name}`, key: c[0] };
      rival.keyText = rival.key && Math.abs(rival.key.d) > 0.3
        ? `${r.rank === 1 ? "Main edge" : "Biggest gap"}: ${rival.key.p.label.toLowerCase()} (${paramShort(rival.key.p.id, r)} vs ${paramShort(rival.key.p.id, other)})` : "";
    }

    // Лучший профиль миссии для этого места
    const byProfile = PROFILES.map((p) => ({ p, rank: rankUnder(p.w, s.id) })).sort((a, b) => a.rank - b.rank);
    const best = byProfile[0];

    // Рекомендации из данных
    const recs = [];
    const add = (icon, text, action) => { if (recs.length < (ex ? 3 : 4)) recs.push({ icon, text, action }); };
    if (ex) {
      add("compass", `Pick a site within the limits instead. Best now: ${ok[0].s.name} (${Math.round(ok[0].score)}).`, { label: `Open ${ok[0].s.name}`, site: ok[0].s.id });
    }
    const w = (id) => r.f.x[id];
    if (w("water") < 0.45) {
      const better = ok.filter((x) => x.f.x.water >= 0.7 && !(ex && x === ok[0]) && x.s.id !== s.id)[0];
      add("droplets", `Water is scarce here. Budget for water from hydrated minerals or the air${better ? `, or look at ${better.s.name}, which has buried ice` : ""}.`, better ? { label: `Open ${better.s.name}`, site: better.s.id } : null);
    }
    if (w("sunlight") < 0.8) {
      add("sun", `At ${Math.abs(s.lat).toFixed(0)}° latitude, solar arrays need about ${(1 / w("sunlight")).toFixed(1)}× the area of an equatorial array, or plan a fission power unit.`);
    }
    if (r.f.P < 650) {
      add("gauge", `Thin air (${Math.round(r.f.P)} Pa) gives less braking on landing and less radiation shielding. Add margin to the descent and habitat shielding.`);
    }
    if (r.f.x.terrain <= 0.65) {
      add("shield-alert", `Rough regional terrain (MOLA 10 km p₉₀ slope ${s.molaP90Deg.toFixed(1)}°). Choose a landing ellipse on a smoother unit and check slopes in a HiRISE DTM.`);
    }
    if (sciCount(s) >= 4 && state.w.science < 0.1 && best.p.id === "science") {
      add("microscope", `Science observables (${sciCount(s)}/5) are not weighted in this profile. Under Astrobiology it ranks #${byProfile.find((x) => x.p.id === "science").rank}.`, { label: "Switch to Astrobiology", profile: "science" });
    } else if (!state.custom && best.p.id !== state.profile && best.rank < (r.rank || 99)) {
      add("repeat", `This site fits a different mission better: #${best.rank} as ${best.p.label}.`, { label: `Switch to ${best.p.label}`, profile: best.p.id });
    }
    if (s.playable) add("footprints", "Route data is ready. Test a Marswalk from the habitat to see if a crew can return safely.", { label: "Plan a Marswalk", mission: true });
    if (!ex && r.rank === 1) add("check-check", "Top pick. Before committing, confirm the ice depth with SHARAD radar and landing-ellipse slopes with HiRISE.");
    if (!recs.length) add("check-check", "No major weak spots for this profile. Confirm the water evidence with SHARAD radar before committing.");

    return { verdict, tone, strengths, weaks, rival, best, recs, ex };
  }

  function runRecAction(a) {
    if (a.site) selectSite(a.site, true);
    else if (a.mission) enterMission();
    else if (a.profile) { const pb = document.querySelector(`#profile-seg [data-p="${a.profile}"]`); if (pb) pb.click(); }
  }

  function renderBrief(r) {
    const b = siteBrief(r);
    const item = (x, good) => `<li>${icon(good ? "trending-up" : "trending-down")}<span><b>${x.p.label}</b> ${paramShort(x.p.id, r)}
      <small>${good ? "above" : "below"} average${x.w > 0 ? `, weight ${Math.round(x.w * 100)}%` : ", not weighted"}</small></span></li>`;
    return `
      <div class="brief-head">
        <img src="${ASSETS.nova.smug}" alt="">
        <div><span class="eyebrow-dark">Zyro’s analysis</span><h3 class="brief-verdict tone-${b.tone}">${b.verdict}</h3></div>
      </div>
      ${b.ex ? `<p class="brief-note">${icon("ban")}Excluded: ${r.excluded.join("; ")}.</p>` : ""}
      <div class="brief-cols">
        <div><span class="brief-label">Strengths</span><ul class="brief-list good">${b.strengths.length ? b.strengths.map((x) => item(x, true)).join("") : `<li class="none">No standout strengths</li>`}</ul></div>
        <div><span class="brief-label">Watch out</span><ul class="brief-list warn">${b.weaks.length ? b.weaks.map((x) => item(x, false)).join("") : `<li class="none">No weak spots</li>`}</ul></div>
      </div>
      ${b.rival ? `<div class="brief-rival">${icon("scale")}<span><b>${b.rival.text}.</b> ${b.rival.keyText}</span></div>` : ""}
      <span class="brief-label">Recommendations</span>
      <ol class="brief-recs">${b.recs.map((x, i) => `<li><span class="rec-ico">${icon(x.icon)}</span><div><p>${x.text}</p>${x.action ? `<button type="button" class="link-btn dark rec-act" data-i="${i}">${x.action.label} ${icon("arrow-right")}</button>` : ""}</div></li>`).join("")}</ol>
      <button type="button" class="link-btn dark" id="ask-site">Ask Zyro about ${r.s.name} ${icon("arrow-right")}</button>`;
  }

  // ---------- Часы ----------
  function tickClock() {
    const now = Date.now();
    const h = MarsClock.lmst(now, JEZERO_LON);
    $("clock-text").textContent = MarsClock.fmtHours(h);
    $("sol-text").textContent = `Sol ${MarsClock.perseveranceSol(now, JEZERO_LON)}`;
    // Время суток наглядно: цвет неба (марсианское: днём желтовато-коричневое, на закате голубое),
    // солнце или Фобос на дуге над горизонтом и подпись фазы
    const RISE = 6, SET = 18;
    const phase = h < 5.5 || h >= 18.5 ? "night" : h < 8 ? "morning" : h < 16.5 ? "day" : "evening";
    const label = { night: "Night", morning: "Morning", day: "Day", evening: "Evening" }[phase];
    const chip = $("sky-chip");
    chip.dataset.phase = phase;
    $("clock-phase").textContent = `${label} · Jezero`;
    const up = h >= RISE && h < SET;
    const f = up ? (h - RISE) / (SET - RISE) : ((h >= SET ? h - SET : h + 24 - SET) / (24 - (SET - RISE)));
    const ang = Math.PI * (1 - f);              // слева (восход) направо (закат) по дуге
    const body = $("sky-body");
    body.setAttribute("cx", (20 + 16 * Math.cos(ang)).toFixed(2));
    body.setAttribute("cy", (19.5 - 16 * Math.sin(ang)).toFixed(2));
    body.setAttribute("r", up ? "3.4" : "2.6");
    chip.title = `${label} at Jezero · ${MarsClock.fmtHours(h)} local mean solar time (Mars24). ${up ? "The dot shows the Sun on its path across the sky" : "The Sun is below the horizon"}; walks must end by 17:30.`;
  }

  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  for (const img of document.querySelectorAll("[data-zyro-face]")) img.src = ASSETS.nova.smug;
  for (const img of document.querySelectorAll("[data-zyro-body]")) img.src = ASSETS.nova.body;
  if (window.INTRO_PHOTO) $("intro-photo").src = window.INTRO_PHOTO;

  // ---------- Вкладки ----------
  let mission = null;
  let currentTab = "overview";
  const TABS = ["overview", "compare", "concept", "mission", "env", "method"];
  function showTab(name) {
    currentTab = name;
    for (const tab of document.querySelectorAll(".tab")) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    for (const v of document.querySelectorAll(".view")) v.toggleAttribute("data-active", v.id === `view-${name}`);
    if (name === "mission") initMission();
    if (name === "compare") renderCompare();
    if (name === "concept") Concept.show();
    if (name === "method" && window.Method) Method.refresh();
    if (name === "env") MarswalkEnvironment.show();
    // При первом открытии вкладки Zyro показывает справку; потом — по кнопке «?»
    if (window.Extras && Extras.onTab) Extras.onTab(name);
    if (mission) setTimeout(() => mission.invalidate(), 30);
    try { history.replaceState(null, "", `#${name}`); } catch (_) { /* песочница */ }
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    if (nav && t.dataset.tab !== "mission") stopNav(true);
    showTab(t.dataset.tab);
  }));

  function closeIntro(tab) {
    $("intro").classList.add("out");
    setTimeout(() => { $("intro").hidden = true; }, 400);
    if (tab) showTab(tab);
    if (tab === "__story") return;
    if (Extras.onTab) { setTimeout(() => Extras.onTab(currentTab), 450); return; }
    setTimeout(() => Buddy.say(Extras.t("welcome"), {
      mood: "wink", tag: "Welcome", duration: 14000,
      actions: [{ label: "Take the tour", icon: "play", primary: true, onClick: () => startTour() }, { label: "Later", onClick: () => {} }],
    }), 900);
  }
  $("intro-go").addEventListener("click", () => closeIntro());
  $("intro-method").addEventListener("click", () => closeIntro("method"));

  // ---------- 1. Обзор ----------
  const POINTS = SITES.map((x) => ({ ...x, kind: "site" }))
    .concat(MISSIONS.map((m) => ({ ...m, kind: "mission" })));
  const globe = createGlobe($("globe-stage"), {
    textureUrl: ASSETS.marsTexture, normalUrl: ASSETS.marsNormal, sites: POINTS,
    onSelect: (id, kind) => {
      if (kind !== "mission") return selectSite(id, true);
      const m = MISSIONS.find((x) => x.id === id);
      globe.select(m.id);
      const recordId = m.site || m.id;
      if (EXPEDITIONS[recordId] && EXPEDITION_DETAILS[recordId]) openExpedition(recordId);
      else toast(`${m.name}: ${m.summary}`);
    },
  });
  const segBtns = () => document.querySelectorAll("#globe-stage .seg button");
  segBtns().forEach((b) => b.addEventListener("click", () => {
    globe.setMode(b.dataset.mode);
    segBtns().forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.mode === globe.mode)));
  }));
  if (!globe.hasWebGL) segBtns().forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.mode === "2d")));
  $("zoom-in").addEventListener("click", () => globe.zoom(-1));
  $("zoom-out").addEventListener("click", () => globe.zoom(1));

  // Фильтры: несколько тем сразу + слои (подписи, аппараты, исключённые, только с фото)
  const FILTER_ICONS = { all: "globe", ice: "snowflake", lake: "droplets", rover: "bot", human: "user-round", extreme: "triangle" };
  const view = { tags: new Set(), labels: true, missions: true, excluded: true, photos: false };
  $("filters").innerHTML = FILTERS.map((f) => `<button type="button" class="filter" data-f="${f.id}" aria-pressed="${f.id === "all"}">${icon(FILTER_ICONS[f.id] || "circle")}${f.label}</button>`).join("");
  function applyView() {
    const outIds = new Set(ranking.out.map((r) => r.s.id));
    const visible = new Set();
    for (const p of POINTS) {
      if (p.kind === "mission") { if (view.missions) visible.add(p.id); continue; }
      if (view.tags.size && !p.tags.some((t) => view.tags.has(t))) continue;
      if (!view.excluded && outIds.has(p.id)) continue;
      if (view.photos && !(PHOTOS[p.id] && PHOTOS[p.id].length)) continue;
      visible.add(p.id);
    }
    $("globe-stage").classList.toggle("no-labels", !view.labels);
    $("globe-stage").classList.toggle("no-landers", !view.missions);
    globe.filter(visible);
    document.querySelectorAll(".filter").forEach((b) => {
      const on = b.dataset.f === "all" ? view.tags.size === 0 : view.tags.has(b.dataset.f);
      b.setAttribute("aria-pressed", String(on));
    });
  }
  $("filters").addEventListener("click", (e) => {
    const b = e.target.closest(".filter");
    if (!b) return;
    if (b.dataset.f === "all") view.tags.clear();
    else if (view.tags.has(b.dataset.f)) view.tags.delete(b.dataset.f);
    else view.tags.add(b.dataset.f);
    applyView();
  });
  $("layers-btn").addEventListener("click", () => {
    const pop = $("layers-pop");
    pop.hidden = !pop.hidden;
    $("layers-btn").setAttribute("aria-expanded", String(!pop.hidden));
  });
  document.querySelectorAll("[data-show]").forEach((c) => c.addEventListener("change", () => { view[c.dataset.show] = c.checked; applyView(); }));
  document.addEventListener("click", (e) => {
    if ($("layers-pop").hidden || e.target.closest("#layers-pop, #layers-btn")) return;
    $("layers-pop").hidden = true;
    $("layers-btn").setAttribute("aria-expanded", "false");
  });

  // Просмотр фото
  function openPhoto(p) {
    $("lb-pia").textContent = `${p.pia}, NASA Photojournal`;
    $("lb-title").textContent = p.title;
    $("lb-note").textContent = p.note;
    $("lb-by").textContent = `${p.by}. Credit: NASA/JPL-Caltech and instrument teams.`;
    $("lb-link").href = PJ_PAGE(p.pia);
    $("lb-media").innerHTML = `<img alt="${p.title}" src="${PJ_IMG(p.pia)}"><div class="ph-fallback">${icon("image")}<b>${p.pia}</b><span>The preview loads when the site is hosted online. Open it on NASA Photojournal.</span></div>`;
    const img = $("lb-media").querySelector("img");
    img.addEventListener("load", () => $("lb-media").classList.add("loaded"));
    img.addEventListener("error", () => $("lb-media").classList.remove("loaded"));
    $("lb-media").classList.remove("loaded");
    const d = $("lightbox");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }
  $("lb-close").addEventListener("click", () => $("lightbox").close());

  function openExpedition(id) {
    const e = EXPEDITIONS[id], d = EXPEDITION_DETAILS[id], site = SITES.find((x) => x.id === id);
    const photos = PHOTOS[id] || [];
    $("exp-eyebrow").textContent = `Expedition record · ${site ? site.name : e.place}`;
    $("exp-title").textContent = e.mission;
    $("exp-body").innerHTML = `
      <p class="exp-story">${d.story}</p>
      <div class="exp-facts">${d.facts.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join("")}</div>
      <div class="exp-cols">
        <section><h3 class="display sm">Key results</h3>
          <ul class="results dark">${e.results.concat(d.more).map((x) => `<li>${icon("check")}<span>${x}</span></li>`).join("")}</ul></section>
        <section><h3 class="display sm">Instruments</h3>
          <div class="chips">${d.instruments.map((x) => `<span class="chip">${icon("scan-line")}${x}</span>`).join("")}</div>
          ${photos.length ? `<h3 class="display sm gap">Photos</h3><div class="exp-photos">${photos.map((p, i) => `<button type="button" class="ph" data-i="${i}">
            <span class="ph-img"><img alt="" loading="lazy" src="${PJ_IMG(p.pia)}" onload="this.parentNode.classList.add('ok')" onerror="this.remove()">${icon("image")}</span>
            <span class="ph-cap"><b>${p.title}</b><small>${p.pia}</small></span></button>`).join("")}</div>` : ""}
        </section>
      </div>
      <div class="exp-actions">
        <a class="btn primary" href="${d.link}" target="_blank" rel="noopener">${icon("external-link")}NASA mission page</a>
        <button type="button" class="btn" id="exp-ask">${icon("message-circle")}Ask Zyro about this mission</button>
      </div>`;
    $("exp-body").querySelectorAll(".ph").forEach((b) => b.addEventListener("click", () => { $("exp-modal").close(); openPhoto(photos[Number(b.dataset.i)]); }));
    $("exp-ask").addEventListener("click", () => { $("exp-modal").close(); Zyro.open(); Zyro.ask(`What did the ${e.mission} mission learn that matters for a human Marswalk?`); });
    const dlg = $("exp-modal");
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  $("exp-close").addEventListener("click", () => $("exp-modal").close());
  $("exp-modal").addEventListener("click", (e) => { if (e.target === $("exp-modal")) $("exp-modal").close(); });
  $("lightbox").addEventListener("click", (e) => { if (e.target === $("lightbox")) $("lightbox").close(); });

  function renderKpis() {
    const top = ranking.ok[0];
    // Компактная сводка под заголовком: одна строка вместо трёх больших плиток
    $("kpis").innerHTML = `
      <span class="kpi">${icon("globe")}<b>${SITES.length}</b> sites</span>
      <button type="button" class="kpi" data-kpi="limits" title="Open the ranking">${icon("shield-check")}<b>${ranking.ok.length}</b> within NASA limits</button>
      <button type="button" class="kpi kpi-lead" data-kpi="lead" title="Open ${top.s.name}">${icon("trophy")}<span class="kl-text"><small>#1 for ${state.custom ? "your weights" : profileObj().label.toLowerCase()}</small><b>${top.s.name}</b></span><span class="mono">${Math.round(top.score)}</span>${icon("arrow-right")}</button>`;
    globe.mark("excluded", new Set(ranking.out.map((r) => r.s.id)));
    if (typeof applyView === "function") applyView();
  }

  $("kpis").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kpi]");
    if (!b) return;
    if (b.dataset.kpi === "lead") selectSite(ranking.ok[0].s.id, true);
    else showTab("compare");
  });

  let selectedSite = null;
  function selectSite(id, byUser) {
    const r = rowOf(id);
    if (!r) return;
    selectedSite = r.s;
    globe.select(id);
    renderSitePanel();
    if (byUser) $("site-panel").scrollTo({ top: 0, behavior: "smooth" });
    if (byUser && !Buddy.touring && Date.now() - (selectSite.lastSay || 0) > 6000) {
      selectSite.lastSay = Date.now();
      const b = siteBrief(r);
      const rec = b.recs[0];
      const acts = [];
      if (rec && rec.action) acts.push({ label: rec.action.label, icon: "arrow-right", primary: true, onClick: () => runRecAction(rec.action) });
      acts.push({ label: "Why?", icon: "message-circle", onClick: () => { Zyro.open(); Zyro.ask(`What makes ${r.s.name} a good or bad site for this mission profile?`); } });
      Buddy.say(`${r.s.name}: ${b.verdict.toLowerCase()}.${rec ? ` ${rec.text}` : ""}`, { mood: b.tone === "bad" ? "shock" : b.tone === "good" ? "cool" : "smug", tag: b.ex ? "Outside limits" : `Rank ${r.rank} of ${ranking.ok.length}`, actions: acts });
    }
    if (byUser) {
      Zyro.post(r.excluded.length
        ? `${r.s.name} is outside the exploration-zone limits (${r.excluded.join("; ")}). I show it for reference but leave it out of the ranking.`
        : `${r.s.name} ranks ${r.rank} of ${ranking.ok.length} for this profile, index ${Math.round(r.score)}. ${r.s.waterWhy}`, { mood: r.excluded.length ? "shock" : "smug" });
    }
  }

  function renderSitePanel() {
    const s = selectedSite;
    const r = rowOf(s.id);
    const C = 2 * Math.PI * 40;
    const ex = r.excluded.length > 0;
    const checks = [
      { ok: Math.abs(s.lat) <= CONSTRAINTS.maxAbsLat, t: `Latitude within ±${CONSTRAINTS.maxAbsLat}°`, v: `${s.lat.toFixed(1)}°`, i: "compass" },
      { ok: s.elevKm <= CONSTRAINTS.maxElevKm, t: `Elevation below +${CONSTRAINTS.maxElevKm} km`, v: fmtElevKm(s.elevKm), i: "mountain" },
    ];
    const photos = PHOTOS[s.id] || [];
    const exp = EXPEDITIONS[s.id];
    const twin = EARTH_TWINS[s.id];
    const st = STATIONS[s.id];
    const alt = earthAltitudeForPressure(r.f.P);

    $("site-panel").innerHTML = `
      <section class="blk blk-blue">
        <div class="blk-top"><span class="tagline">${icon(s.icon)}Site analysis</span><span class="mono small">${fmtCoord(s.lat, s.lon)}</span></div>
        <h2 class="display">${s.name}</h2>
        <div class="hero-row">
          <div class="ring ring-light"><svg viewBox="0 0 96 96"><circle class="track" cx="48" cy="48" r="40" fill="none" stroke-width="6"/>
            <circle class="val" cx="48" cy="48" r="40" fill="none" stroke-width="6" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - r.score / 100)}"/></svg>
            <b>${Math.round(r.score)}</b></div>
          <div><small>Suitability index</small>
            <p>${state.custom ? "Custom weights" : profileObj().label}</p>
            <span class="pill-solid">${ex ? `${icon("ban")}Excluded` : `${icon("list-ordered")}Rank ${r.rank} of ${ranking.ok.length}`}</span></div>
        </div>
        <p class="blk-text">${s.blurb}</p>
      </section>

      <section class="blk blk-white brief">${renderBrief(r)}</section>

      <section class="blk blk-dark">
        <h3 class="display sm">Parameters</h3>
        <div class="params">${PARAMS.map((p) => `
          <div class="param">
            <span class="p-ico" style="background:${PARAM_COLOR[p.id]}">${icon(p.icon)}</span>
            <div class="p-body">
              <div class="p-row"><span class="pn">${p.label}</span><span class="pv mono">${paramValue(p.id, s, r.f)}</span></div>
              <div class="bar"><span style="width:${Math.round(r.f.x[p.id] * 100)}%"></span></div>
              <span class="src">${paramSource(p.id, s)}</span>
            </div>
            <span class="p-w mono" title="Weight in this profile">${Math.round(state.w[p.id] * 100)}%</span>
          </div>`).join("")}</div>
        <h3 class="display sm gap">Constraints</h3>
        <ul class="checks">${checks.map((c) => `<li class="${c.ok ? "" : "fail"}">${icon(c.ok ? "circle-check" : "circle-x")}<span>${c.t}</span><span class="mono">${c.v}</span></li>`).join("")}</ul>
      </section>

      <section class="blk blk-white">
        <div class="blk-top"><span class="tagline dark">${icon("earth")}Weather twin on Earth</span>${twin ? (twin.flag && window.FLAGS[twin.flag] ? `<span class="twin-flag" title="${twin.country}">${window.FLAGS[twin.flag]}</span>` : `<span class="twin-flag none" title="${twin.country}">${icon(twin.latlng ? "globe" : "cloud")}</span>`) : ""}</div>
        <h3 class="display sm dark">${twin ? twin.place : "No close match"}</h3>
        ${twin ? `<span class="twin-country">${twin.country}</span>` : ""}
        <ul class="twin">
          <li><span class="t-ico">${icon("gauge")}</span><div><b>Air like ${alt.toFixed(0)} km above Earth</b><span>${Math.round(r.f.P)} Pa here equals the pressure of Earth’s sky at that height (US Standard Atmosphere).</span></div></li>
          <li><span class="t-ico">${icon("thermometer")}</span><div><b>${st ? st.text : "No surface weather station yet"}</b><span>${st ? `Measured by ${st.station}.` : "Values would come from orbiters or a future station."}</span></div></li>
          ${twin ? `<li><span class="t-ico">${icon(twin.icon)}</span><div><b>Why it matches</b><span>${twin.why}</span></div></li>` : ""}
        </ul>
        ${twin ? `<button type="button" class="btn twin-btn" id="twin-more">${icon("images")}See photos of ${twin.place.split(",")[0]}</button>` : ""}
      </section>

      ${photos.length ? `<section class="blk blk-dark">
        <div class="blk-top"><h3 class="display sm">Photos</h3><span class="muted">${icon("camera")}NASA Photojournal</span></div>
        <div class="photos">${photos.map((p, i) => `<button type="button" class="ph" data-i="${i}">
          <span class="ph-img"><img alt="" loading="lazy" src="${PJ_IMG(p.pia)}" onload="this.parentNode.classList.add('ok')" onerror="this.remove()">${icon("image")}</span>
          <span class="ph-cap"><b>${p.title}</b><small>${p.by} · ${p.pia}</small></span></button>`).join("")}</div>
      </section>` : ""}

      ${exp ? `<section class="blk blk-blue">
        <div class="blk-top"><span class="tagline">${icon(exp.icon)}Expedition record</span><span class="mono small">${exp.years}</span></div>
        <h3 class="display sm">${exp.mission}</h3>
        <ul class="results">${exp.results.map((x) => `<li>${icon("check")}<span>${x}</span></li>`).join("")}</ul>
        ${EXPEDITION_DETAILS[s.id] ? `<button type="button" class="btn on-blue" id="exp-more">${icon("book-open")}More about the mission</button>` : ""}
      </section>` : ""}

      <div class="actions">
        ${s.playable
          ? `<button type="button" class="btn primary wide" id="plan-btn">${icon("footprints")}Plan a Marswalk here</button>`
          : `<button type="button" class="btn wide" disabled>${icon("lock")}Route planning needs an elevation model here</button>`}
        <button type="button" class="btn wide" id="cmp-btn">${icon("scale")}Compare all sites</button>
      </div>

      <section class="blk blk-dark">
        <div class="blk-top"><h3 class="display sm">All sites</h3><span class="muted">by index</span></div>
        <div class="site-list">${ranking.all.map((x) => `
          <button type="button" class="srow ${x.excluded.length ? "dim" : ""}" data-id="${x.s.id}" aria-current="${x.s.id === s.id}">
            <span class="s-ico">${icon(x.s.icon)}</span>
            <span><b>${x.s.name}</b><small>${x.excluded.length ? "Outside limits" : `#${x.rank} · ${x.s.ice}`}${PHOTOS[x.s.id] ? " · photos" : ""}</small></span>
            <span class="sc mono">${Math.round(x.score)}</span></button>`).join("")}</div>
      </section>`;
    $("ask-site").addEventListener("click", () => Zyro.ask(`What makes ${s.name} a good or bad site for this mission profile?`));
    const brief = siteBrief(r);
    $("site-panel").querySelectorAll(".rec-act").forEach((btn) => btn.addEventListener("click", () => runRecAction(brief.recs[Number(btn.dataset.i)].action)));
    const plan = $("plan-btn");
    if (plan) plan.addEventListener("click", enterMission);
    $("cmp-btn").addEventListener("click", () => showTab("compare"));
    const tm = $("twin-more");
    if (tm) tm.addEventListener("click", () => Extras.openTwin(s.id));
    const em = $("exp-more");
    if (em) em.addEventListener("click", () => openExpedition(s.id));
    $("site-panel").querySelectorAll(".ph").forEach((b) => b.addEventListener("click", () => openPhoto(photos[Number(b.dataset.i)])));
    $("site-panel").querySelector(".site-list").addEventListener("click", (e) => {
      const b = e.target.closest(".srow");
      if (b) selectSite(b.dataset.id, true);
    });
  }

  function enterMission() {
    globe.select("jezero");
    globe.zoomTo(0.5);
    $("globe-stage").classList.add("diving");
    setTimeout(() => {
      $("globe-stage").classList.remove("diving");
      globe.zoomTo(1);
      showTab("mission");
    }, 900);
  }

  // ---------- 2. Сравнение ----------
  $("profile-seg").innerHTML = PROFILES.map((p) => `<button type="button" data-p="${p.id}" aria-pressed="${p.id === state.profile}">${p.label}</button>`).join("");
  $("profile-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const prev = ranking.ok[0].s.name;
    state.profile = b.dataset.p;
    state.w = { ...profileObj().w };
    state.custom = false;
    refreshRanking();
    const top = ranking.ok[0];
    Zyro.post(`Profile “${profileObj().label}”: ${top.s.name} leads with ${Math.round(top.score)}${prev !== top.s.name ? `, replacing ${prev}` : ""}. ${explain(top, ranking.ok[1])}`, { mood: "smug" });
    Buddy.say(prev !== top.s.name ? `New leader for ${profileObj().label.toLowerCase()}: ${top.s.name} takes #1 from ${prev}.` : `${top.s.name} stays #1 for ${profileObj().label.toLowerCase()}.`,
      { mood: prev !== top.s.name ? "shock" : "smug", tag: "Ranking changed", actions: [{ label: `Open ${top.s.name}`, icon: "map-pin", primary: true, onClick: () => { showTab("overview"); selectSite(top.s.id, true); } }] });
  });

  function refreshRanking() {
    ranking = rank();
    document.querySelectorAll("#profile-seg button").forEach((x) => x.setAttribute("aria-pressed", String(!state.custom && x.dataset.p === state.profile)));
    renderKpis();
    renderCompare();
    if (selectedSite) renderSitePanel();
  }

  function renderWeights() {
    $("weights-note").textContent = state.custom ? "Custom, normalised to 100%" : "Preset";
    $("weights").innerHTML = PARAMS.map((p) => `<label><span class="w-name"><span class="p-ico sm" style="background:${PARAM_COLOR[p.id]}">${icon(p.icon)}</span>${p.label}</span>
      <input type="range" min="0" max="100" step="5" value="${Math.round(state.w[p.id] * 100)}" data-w="${p.id}" aria-label="${p.label} weight">
      <output class="mono">${Math.round(state.w[p.id] * 100)}%</output></label>`).join("");
  }
  $("weights").addEventListener("input", (e) => {
    const inp = e.target.closest("input[data-w]");
    if (!inp) return;
    const raw = {};
    document.querySelectorAll("#weights input[data-w]").forEach((x) => { raw[x.dataset.w] = Number(x.value); });
    const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
    for (const p of PARAMS) state.w[p.id] = raw[p.id] / total;
    state.custom = true;
    ranking = rank();
    document.querySelectorAll("#profile-seg button").forEach((x) => x.setAttribute("aria-pressed", "false"));
    $("weights-note").textContent = "Custom, normalised to 100%";
    document.querySelectorAll("#weights output").forEach((o, i) => { o.textContent = `${Math.round(state.w[PARAMS[i].id] * 100)}%`; });
    renderKpis(); renderReco(); renderTable();
    if (selectedSite) renderSitePanel();
  });
  $("weights").addEventListener("change", () => {
    const top = ranking.ok[0];
    Zyro.post(`With your weights ${top.s.name} leads (${Math.round(top.score)}). ${explain(top, ranking.ok[1])}`, { mood: "smug" });
  });

  $("constraints").innerHTML = `
    <li>${icon("compass")}<div>Latitude within ±${CONSTRAINTS.maxAbsLat}°<small>Sunlight, temperature and access from orbit</small></div></li>
    <li>${icon("mountain")}<div>Elevation below +${CONSTRAINTS.maxElevKm} km<small>Enough air to slow down during landing</small></div></li>
    <li>${icon("book-open")}<div>Source<small>${CONSTRAINTS.source}</small></div></li>`;

  function renderReco() {
    const a = ranking.ok[0], b = ranking.ok[1];
    const c = contributions(a, b);
    const max = Math.max(4, ...c.map((x) => Math.abs(x.d)));
    $("reco").innerHTML = `
      <div class="reco-top"><img src="${ASSETS.nova.cool}" alt=""><div><small>Zyro’s recommendation</small><h3><span class="s-ico lg">${icon(a.s.icon)}</span>${a.s.name}</h3></div></div>
      <p>${explain(a, b)}</p>
      <div class="diff">${c.map((x) => {
        const w = Math.abs(x.d) / max * 50;
        const left = x.d >= 0 ? 50 : 50 - w;
        return `<div class="diff-row"><span>${x.p.label}</span><div class="diff-bar"><span style="left:${left}%;width:${w}%;background:${x.d >= 0 ? "var(--accent)" : "var(--rust)"}"></span></div><span class="mono">${x.d >= 0 ? "+" : "−"}${Math.abs(x.d).toFixed(1)}</span></div>`;
      }).join("")}</div>
      <p class="muted">Each bar is a parameter’s weighted contribution to the gap between #1 ${a.s.name} and #2 ${b.s.name}, in index points. Lime favours #1, rust favours #2.</p>
      <button type="button" class="link-btn" id="ask-reco">Ask Zyro what would change the ranking ${icon("arrow-right")}</button>`;
    $("ask-reco").addEventListener("click", () => Zyro.ask(`Why is ${a.s.name} ranked above ${b.s.name}, and what would change the ranking?`));
  }

  function siteCell(r) {
    const lander = MISSIONS.find((m) => m.site === r.s.id);
    return `<div class="site-cell"><span class="s-ico">${icon(r.s.icon)}</span><span><b>${r.s.name}</b>
      <small>${lander ? `${icon(lander.icon)}${lander.name} · ` : ""}${r.s.ice}</small></span></div>`;
  }
  function renderPodium() {
    const top = ranking.ok.slice(0, 3);
    $("podium").innerHTML = top.map((r, i) => `
      <button type="button" class="pod pod-${i + 1}" data-id="${r.s.id}">
        <span class="pod-rank">#${i + 1}</span>
        <span class="pod-ico">${icon(r.s.icon)}</span>
        <b>${r.s.name}</b>
        <span class="pod-score mono">${Math.round(r.score)}</span>
        <small>${PARAMS.filter((p) => state.w[p.id] > 0).sort((a, b) => state.w[b.id] * r.f.x[b.id] - state.w[a.id] * r.f.x[a.id]).slice(0, 2).map((p) => `${icon(p.icon)}${p.label}`).join("")}</small>
      </button>`).join("");
  }
  $("podium").addEventListener("click", (e) => {
    const b = e.target.closest(".pod");
    if (!b) return;
    showTab("overview");
    selectSite(b.dataset.id, true);
  });

  function renderTable() {
    renderPodium();
    if (ext) ext.renderRobust();
    $("rank-table").innerHTML = `<thead><tr><th>#</th><th>Site</th><th>Index</th>${PARAMS.map((p) => `<th><span class="th-p"><span class="p-ico xs" style="background:${PARAM_COLOR[p.id]}">${icon(p.icon)}</span>${p.label}<small class="mono">${Math.round(state.w[p.id] * 100)}%</small></span></th>`).join("")}<th>Status</th></tr></thead>
      <tbody>${ranking.all.map((r) => `<tr class="${r.excluded.length ? "excluded" : r.rank === 1 ? "is-top" : ""}" data-id="${r.s.id}">
        <td class="mono">${r.excluded.length ? "–" : r.rank}</td><td>${siteCell(r)}</td>
        <td><div class="score-cell"><span class="mono">${Math.round(r.score)}</span><div class="bar"><span style="width:${Math.round(r.score)}%"></span></div></div></td>
        ${PARAMS.map((p) => `<td><div class="cell-p"><span class="mono">${paramShort(p.id, r)}</span><i style="width:${Math.round(r.f.x[p.id] * 100)}%;background:${PARAM_COLOR[p.id]}"></i></div></td>`).join("")}
        <td>${r.excluded.length ? `<span class="tag bad">${icon("ban")}Outside limits</span>` : r.s.playable ? `<span class="tag ok">${icon("footprints")}Route ready</span>` : `<span class="tag">${icon("hourglass")}Needs DTM</span>`}</td></tr>`).join("")}</tbody>`;
  }
  $("rank-table").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    showTab("overview");
    selectSite(tr.dataset.id, true);
  });

  function renderCompare() { renderWeights(); renderReco(); renderTable(); }
  var ext = null; // var: renderTable может вызваться раньше этой строки

  // ---------- 3. Marswalk ----------
  // Elevations, imagery and MEDA weather come from the Marswalk backend; no synthetic terrain fallback is used.
  // Sol 100 is the reference sol the site texts quote; the backend's default is its latest loaded sol.
  MarswalkApi.environment(100).then((env) => {
    STATIONS.jezero = {
      station: `Perseverance MEDA (PDS sol ${env.sol})`,
      text: `${env.air_temp_min_c.toFixed(1).replace("-", "−")} °C to ${env.air_temp_max_c.toFixed(1).replace("-", "−")} °C · ${Math.round(env.pressure_min_pa)}–${Math.round(env.pressure_max_pa)} Pa · wind ≤ ${env.wind_max_m_s.toFixed(1)} m/s`,
      min: env.air_temp_min_c, max: env.air_temp_max_c,
    };
    const note = $("meda-note");
    if (note) note.textContent = `MEDA PDS sol ${env.sol} (DERIVED): ${STATIONS.jezero.text}. Baseline τ = 0.45 is MEDA SkyCam clear-season mean; slider tests storm contingencies.`;
    if (selectedSite && selectedSite.id === "jezero") renderSitePanel();
  }).catch(() => {});

  const EVIDENCE_LABEL = {
    direct_observation: "Direct observation",
    scientific_interpretation: "Scientific interpretation",
    candidate_target: "Candidate target",
    hypothesis: "Hypothesis",
  };
  let allScienceTargets = [];
  let selectedScience = null;
  let sciNearbyOn = false;

  function renderScienceChips() {
    if (!mission) return;
    const wps = mission.routeWaypoints;
    $("sci-route-wps").innerHTML = wps.map((w) => `<span class="sci-chip">${w.name}<button type="button" data-rm-wp="${w.id}" aria-label="Remove waypoint">×</button></span>`).join("");
  }

  function renderScienceDetail(t) {
    selectedScience = t;
    const box = $("sci-detail");
    if (!t || !box) { if (box) box.hidden = true; return; }
    const inRoute = mission && mission.routeWaypoints.some((w) => w.id === t.id);
    const ev = t.evidence_level || "direct_observation";
    const evLbl = EVIDENCE_LABEL[ev] || ev;
    box.hidden = false;
    box.innerHTML = `
      <div class="hz-top">
        <div><span class="eyebrow">${t.classification || t.category}</span><h4 style="margin:2px 0 0;font-size:14px">${t.name}</h4></div>
        <span class="sci-ev ${ev}">${evLbl}</span>
      </div>
      ${t.image_url ? `<img src="${t.image_url}" alt="${t.name}" loading="lazy">` : ""}
      <p style="margin:0;font-size:12px;line-height:1.45">${t.description_ru}</p>
      <div class="hz-meta">
        <span><b>Coords:</b> ${fmtCoord(t.lat, t.lon)} · <b>Elev:</b> ${t.elevation_m != null ? `${Math.round(t.elevation_m)} m` : "–"}</span>
        <span><b>Instrument:</b> ${t.instrument || "–"}</span>
        <span><b>Observed:</b> ${t.observed_at || (t.rover_sol != null ? `Sol ${t.rover_sol}` : "–")} · <b>Confidence:</b> ${t.confidence != null ? Math.round(t.confidence * 100) + "%" : "–"}</span>
        <span><b>Source:</b> ${t.source_citation || t.dataset_id || "NASA"}${t.image_credit ? ` · <b>Image:</b> ${t.image_credit}` : ""}</span>
      </div>
      <button type="button" class="btn ${inRoute ? "" : "primary"} wide" id="sci-add-wp">${icon(inRoute ? "check" : "plus")}${inRoute ? "Remove from route" : "Add to route"}</button>`;
    $("sci-add-wp").addEventListener("click", () => {
      if (!mission) return;
      mission.toggleWaypoint(t);
      renderScienceChips();
      renderScienceDetail(t);
    });
  }

  async function refreshScienceDiscovery() {
    const cat = $("sci-cat").value;
    const ev = $("sci-ev").value;
    const params = { category: cat, evidence_level: ev };
    if (sciNearbyOn && mission) {
      const b = mission.plan ? mission.plan.target.latlng : mission.start.latlng;
      params.lat = b[0]; params.lon = b[1]; params.radius_m = 1500;
    }
    const list = (await MarswalkApi.scienceTargets(params).catch(() => [])).filter(inRegion);
    allScienceTargets = list;
    $("sci-count").textContent = `${list.length} targets`;
    if (mission) { mission.setScienceTargets(list); renderLayerManager(); }
    $("sci-discovery-list").innerHTML = list.length
      ? list.map((s) => `<button type="button" class="sci-pick" data-sci-id="${s.id}" aria-current="${selectedScience && selectedScience.id === s.id}"><span><b>${s.name}</b><br><small style="color:var(--muted)">${EVIDENCE_LABEL[s.evidence_level] || s.evidence_level}</small></span><span class="mono" style="font-size:11px">${s.rover_sol != null ? `Sol ${s.rover_sol}` : "MRO"}</span></button>`).join("")
      : `<p class="fine">No scientific targets match these filters.</p>`;
    if (list.length && (!selectedScience || !list.some((x) => x.id === selectedScience.id))) renderScienceDetail(list[0]);
    else if (!list.length) renderScienceDetail(null);
  }

  const riskCfg = { w_slope: 0.40, w_terrain: 0.25, w_obstacle: 0.15, w_uncertainty: 0.20, slope_mod_deg: 10.0, slope_high_deg: 18.0 };

  function renderHazardCard({ feature = null, assess = null } = {}) {
    const card = $("hazard-card");
    if (!card) return;
    const f = feature && feature.factors ? feature.factors : null;
    const cls = (feature && feature.hazard_class) || (assess && assess.hazard_class) || "LOW";
    const title = (feature && feature.title_ru) || (assess ? `Point ${fmtCoord(assess.lat, assess.lon)}` : "Target");
    const hType = (f && f.hazard_type) || (assess && assess.hazard_type) || "–";
    const lat = (feature && feature.lat) ?? (assess && assess.lat);
    const lon = (feature && feature.lon) ?? (assess && assess.lon);
    const score = (f && f.risk_score) ?? (assess && assess.risk_score);
    const conf = (f && f.confidence) ?? (assess && assess.confidence);
    const comp = (f && f.components) || (assess && assess.components) || {};
    const reasons = (f && f.reasons && f.reasons.length ? f.reasons : null) || (assess && assess.reasons) || (feature ? [feature.description_ru] : []);
    const recs = (f && f.recommendations) || (assess && assess.recommendations) || [];
    const src = (f && f.source_dataset) || (assess && assess.sources && assess.sources.join(", ")) || (feature && feature.dataset_id) || "CTX DTM";
    const obsDate = (f && f.observation_date) || (assess && assess.observation_dates && Object.values(assess.observation_dates).join(", ")) || "2020-07-24";
    const method = (f && f.detection_method) || (assess && assess.detection_method) || "MARSWALK Risk Engine";
    const disc = (f && f.disclaimer) || (assess && assess.disclaimer) || "Preliminary research & planning aid, not a certified astronaut safety system.";
    const bar = (lbl, val) => `<div><span>${lbl} <b class="mono">${val == null ? "–" : Math.round(val * 100) + "%"}</b></span><div class="bar"><span style="width:${val == null ? 0 : Math.round(val * 100)}%"></span></div></div>`;

    card.innerHTML = `
      <div class="hz-top">
        <div><span class="eyebrow">Mission safety · hazard</span><h3 style="margin:2px 0 0;font-size:15px">${title}</h3></div>
        <span class="hz-badge ${cls}">${cls}${score != null ? ` · R=${score.toFixed(2)}` : ""}</span>
      </div>
      <div class="hz-meta">
        <span><b>Type:</b> ${hType} · <b>Coords:</b> ${lat != null ? fmtCoord(lat, lon) : "–"}</span>
        <span><b>Source:</b> ${src}</span>
        <span><b>Observed:</b> ${obsDate} · <b>Confidence:</b> ${conf != null ? Math.round(conf * 100) + "%" : "–"}</span>
        <span><b>Method:</b> ${method}</span>
      </div>
      <div class="hz-bars">
        ${bar("Slope S", comp.slope_risk)}
        ${bar("Terrain T", comp.terrain_risk)}
        ${bar("Obstacle O", comp.obstacle_risk)}
        ${bar("Uncertainty U", comp.uncertainty)}
      </div>
      ${reasons.length ? `<div><b style="font-size:12px">Reasons</b><ul class="hz-list">${reasons.map((r) => `<li>${r}</li>`).join("")}</ul></div>` : ""}
      ${recs.length ? `<div><b style="font-size:12px">Recommendations</b><ul class="hz-list">${recs.map((r) => `<li>${r}</li>`).join("")}</ul></div>` : ""}
      <p class="hz-disc">${disc}</p>`;
  }

  // Elevation & hazard assessment of point B as the backend computes them on the full grid.
  const MAP_HINT = "Click the map to set a custom point B";
  let hintFor = "";
  async function showElevation(target) {
    const key = `${target.latlng.join()}|${riskCfg.w_slope}|${riskCfg.w_terrain}|${riskCfg.w_obstacle}|${riskCfg.w_uncertainty}|${riskCfg.slope_high_deg}`;
    if (key === hintFor) return;
    hintFor = key;
    let text = MAP_HINT;
    try {
      const [p, hz] = await Promise.all([
        MarswalkApi.pointSlope(target.latlng[0], target.latlng[1]),
        MarswalkApi.assessHazard(target.latlng[0], target.latlng[1], riskCfg).catch(() => null),
      ]);
      if (p.elevation_m !== null) {
        const el = p.elevation_m.toFixed(1).replace("-", "−");
        const sl = p.slope_deg != null ? ` · slope ${p.slope_deg.toFixed(1)}°` : "";
        const tr = p.roughness_m != null ? ` · TRI ${p.roughness_m.toFixed(1)} m` : "";
        const src = p.provenance_ids[0].includes("ctx") ? "CTX 20 m" : "MOLA 463 m";
        text = `B at ${el} m${sl}${tr} (${hz ? hz.hazard_class : p.terrain_class}, ${p.data_class} ${src}). Click map to move`;
      }
      if (hz && key === hintFor) renderHazardCard({ assess: hz });
    } catch (_) { /* backend offline or point outside its grids: plain hint */ }
    if (key === hintFor) $("map-hint-text").textContent = text; // a slower, older answer must not win
  }

  function renderTargets(selectedId) {
    const opts = missionTargets.map((t) => `<option value="${t.id}">${t.name}</option>`);
    opts.push(`<option value="custom" ${selectedId === "custom" ? "" : "disabled"}>Custom point (click the map)</option>`);
    $("target-select").innerHTML = opts.join("");
    $("target-select").value = selectedId;
    $("target-list").innerHTML = missionTargets.map((t) => `<button type="button" class="tcard" role="radio" data-id="${t.id}" aria-checked="${t.id === selectedId}">${icon(t.icon)}${t.name}</button>`).join("");
  }

  const openMeta = new Set();
  function renderLayerManager() {
    if (!mission) return;
    const specs = mission.getLayerSpecs();
    $("layers-status").textContent = `${specs.filter((s) => s.visible).length}/${specs.length} active`;
    $("layers-list").innerHTML = specs.map((s, idx) => {
      const avail = mission.available(s.id);
      const isErr = /Error|Unavailable/i.test(s.status);
      const isOpen = openMeta.has(s.id);
      const lg = s.legend;
      const legendHtml = lg.type === "grad"
        ? `<div class="lgrad" style="background:${lg.css}"></div><div class="lgrad-labels"><span>${lg.min}</span><span>${lg.max}</span></div>`
        : lg.type === "stops"
        ? `<div class="lstops">${lg.stops.map(([c, l]) => `<span><i class="sw" style="background:${c}"></i>${l}</span>`).join("")}</div>`
        : `<span>${lg.text}</span>`;
      const exportUrl = s.exportLayer ? MarswalkApi.exportTerrainUrl(s.exportLayer) : "";
      return `<div class="lrow" data-lid="${s.id}">
        <div class="lrow-top">
          <label><input type="checkbox" data-layer="${s.id}" ${s.visible && avail ? "checked" : ""} ${avail ? "" : "disabled"}>
            <span><b>${s.name}</b><small>${s.sub}</small></span></label>
          <div class="lrow-acts">
            <button type="button" class="lbtn" data-act="up" title="Move up" ${idx === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="lbtn" data-act="down" title="Move down" ${idx === specs.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" class="lbtn" data-act="info" aria-expanded="${isOpen}" title="Layer metadata">i</button>
          </div>
        </div>
        <div class="lrow-op"><input type="range" data-op="${s.id}" min="0" max="1" step="0.05" value="${s.opacity}" ${avail ? "" : "disabled"} aria-label="${s.name} opacity"><span class="mono">${Math.round(s.opacity * 100)}%</span></div>
        ${isOpen ? `<div class="lrow-meta">
          <div><span class="lbadge ${isErr ? "err" : s.dataClass === "REAL" ? "real" : ""}">${s.dataClass}</span><span>${s.status}</span></div>
          ${legendHtml}
          <div><b>Units:</b> ${s.units}</div>
          <div><b>Source:</b> ${s.source}</div>
          <div><b>Date:</b> ${s.date} · <b>Res:</b> ${s.resolution}</div>
          <div><b>CRS:</b> ${s.crs} · <b>NoData:</b> ${s.nodata}</div>
          ${exportUrl ? `<a class="lexport" href="${exportUrl}" download>Export GeoTIFF (${s.id})</a>` : ""}
        </div>` : ""}
      </div>`;
    }).join("");
  }

  // ---------- Regions a Marswalk can be planned in, and the landing check of start A ----------
  let regions = [], region = null, missionTargets = [], landing = null, landingFor = "";
  const inRegion = (p) => p.lat >= region.south && p.lat <= region.north && p.lon >= region.west && p.lon <= region.east;
  const RAD = Math.PI / 180;
  const greatCircleKm = (a, b) => 3389.5 * Math.acos(Math.min(1, Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((a.lon - b.lon) * RAD)));

  const CRITERION = {
    latitude: (c) => `Latitude ${c.value.toFixed(1)}° (limit ±${c.limit}°)`,
    elevation: (c) => c.value == null ? "Elevation: no data" : `Elevation ${Math.round(c.value)} m (limit +${c.limit} m)`,
    slope: (c) => c.value == null ? "Slope: no data" : `Slope ${c.value.toFixed(1)}° (limit ${c.limit}°)`,
    hazard: (c) => `Hazard class ${c.value} (needs ${c.limit})`,
  };
  // Start A is where the crew lands: the backend checks it against the NASA 2015 workshop limits and the hazard grid.
  async function showLanding(start) {
    const key = `${region.id}|${start.latlng.join()}`, box = $("landing-check");
    if (key === landingFor) return;
    landingFor = key; landing = null;
    box.innerHTML = `<span>Checking the landing point…</span>`;
    let a;
    try { a = await MarswalkApi.assessLanding(start.latlng[0], start.latlng[1]); }
    catch (e) { if (key === landingFor) box.innerHTML = `<span>Landing check unavailable (${e.message}).</span>`; return; }
    if (key !== landingFor) return; // a slower, older answer must not win
    landing = a;
    const n = a.nearest_suitable;
    box.innerHTML = `<b data-ok="${a.suitable}">${a.suitable ? "Meets the landing criteria" : "Does not meet the landing criteria"}</b>
      <ul>${a.criteria.map((c) => `<li data-ok="${c.ok}">${c.ok ? "✓" : "✗"} ${CRITERION[c.id](c)}</li>`).join("")}</ul>
      ${a.suitable ? "" : n
        ? `<button type="button" class="tcard" id="landing-move">${icon("navigation")}Move to the nearest suitable point, ${fmtKm(n.distance_m)} away</button>`
        : `<span>No cell of this region meets the criteria.</span><button type="button" class="tcard" id="landing-region">${icon("search")}Find the nearest suitable region</button>`}
      <small>${a.data_class} · ${a.criteria_source}. ${a.limitations.join(" ")}</small>`;
    if (!a.suitable) Zyro.post(n
      ? `The landing point fails ${a.criteria.filter((c) => !c.ok).map((c) => c.id).join(", ")}. The nearest cell that passes is ${fmtKm(n.distance_m)} away: slope ${n.slope_deg.toFixed(1)}°, elevation ${Math.round(n.elevation_m)} m.`
      : `No cell of ${region.name} meets the landing criteria. I can look for the nearest region that has one.`, { mood: "shock", level: "warn" });
  }

  // No cell of the open region passes: ask the backend about the other regions, nearest first, and offer the first with a suitable point.
  async function findSuitableRegion() {
    const box = $("landing-check"), km = (r) => greatCircleKm(region.landing, r.landing);
    box.querySelector("#landing-region").disabled = true;
    for (const r of regions.filter((x) => x !== region).sort((x, y) => km(x) - km(y))) {
      const a = await MarswalkApi.assessLanding(r.landing.lat, r.landing.lon, r).catch(() => null);
      if (!a || !(a.suitable || a.nearest_suitable)) continue;
      box.innerHTML = `<span>Nearest region with a point that meets the criteria: <b>${r.name}</b>, ${Math.round(km(r))} km from here (great circle).</span>
        <button type="button" class="tcard" data-region="${r.id}">${icon("globe")}Open ${r.name}</button>
        <small>${a.data_class} · ${a.criteria_source}. ${a.limitations.join(" ")}</small>`;
      return;
    }
    box.innerHTML = `<span>No loaded region has a cell that meets the criteria.</span>`;
  }

  let missionStarting = false, missionBound = false;
  function initMission() { if (!mission) loadRegion(); }

  // Story and shared plan links: the Jezero walk from the habitat to a named target, calculated.
  async function planJezero(targetId) {
    showTab("mission");
    for (let k = 0; missionStarting && k < 200; k++) await new Promise((r) => setTimeout(r, 100)); // a region is loading
    if (!mission || region.id !== "jezero" || mission.start.id !== "habitat") await loadRegion("jezero");
    if (!mission || region.id !== "jezero") return null; // the backend did not answer
    await new Promise((r) => setTimeout(r)); // a new map starts its first calculation on the next tick
    if (mission.current.id !== targetId) mission.setTarget(targetId);
    if (!mission.plan) await mission.calculate();
    return mission;
  }

  // Loads one region (terrain, hazard grid, layers) and rebuilds the map for it; the first region listed opens by default.
  async function loadRegion(id) {
    if (missionStarting) return;
    missionStarting = true;
    $("layers-status").textContent = "Loading…";
    $("region-select").disabled = true;
    let next, terrainData, catalog, waypoints, scienceTargets, hazardGrid, hazards;
    try {
      if (!regions.length) {
        regions = (await MarswalkApi.regions()).map((r) => ({ ...r, name: (SITES.find((x) => x.id === r.id) || { name: r.id }).name }));
        $("region-select").innerHTML = regions.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");
      }
      next = regions.find((r) => r.id === id) || regions[0];
      if (!next) throw new Error("NO_REGION");
      MarswalkApi.setRegion(next);
      [terrainData, catalog, waypoints, scienceTargets, hazardGrid, hazards] = await Promise.all([
        MarswalkApi.terrain(),
        MarswalkApi.layerCatalog().catch(() => []),
        MarswalkApi.roverWaypoints().catch(() => []),
        MarswalkApi.scienceTargets().catch(() => []),
        MarswalkApi.hazardGrid(riskCfg).catch(() => null),
        MarswalkApi.hazards().catch(() => []),
      ]);
    } catch (_) {
      missionStarting = false;
      $("region-select").disabled = false;
      if (mission) { // the region on the map stays; only the switch failed
        MarswalkApi.setRegion(region);
        $("region-select").value = region.id;
        renderLayerManager();
        toast(`Terrain for ${next ? next.name : "this region"} did not load. Staying in ${region.name}.`);
        return;
      }
      $("layers-status").textContent = "Error";
      $("layers-list").innerHTML = `<p class="fine">Failed to load backend terrain/layers. Check API server.</p>`;
      $("demo-flag").hidden = false;
      $("verdict").dataset.state = "nogo";
      $("verdict-status").textContent = "Backend offline";
      $("verdict-why").textContent = "NASA elevation grid (/api/v1/terrain/analysis) is unreachable. Synthetic terrain is disabled.";
      $("start-nav").disabled = true;
      $("calc-route").disabled = true;
      return;
    }
    region = next;
    waypoints = waypoints.filter(inRegion);
    scienceTargets = scienceTargets.filter(inRegion);
    missionHazards = hazards.filter((h) => h.lat != null && h.lon != null && inRegion(h));
    const local = region.id === "jezero", cell = terrainData.cell_m.map(Math.round).join(" × ");
    const habitat = { id: "habitat", name: "Habitat", icon: "house", latlng: [region.landing.lat, region.landing.lon], why: region.landing.name };
    // B outside Jezero: IAU-named features inside the region window (the backend lists the nearest six).
    missionTargets = local ? TARGETS : region.destinations.map((d, k) => ({
      id: `iau-${k}`, name: d.name, icon: "circle-dot", latlng: [d.lat, d.lon], minutes: 15, tag: d.feature_type,
      source: "IAU Gazetteer of Planetary Nomenclature (USGS)", why: `${d.feature_type} named by the IAU${d.diameter_km ? `, about ${d.diameter_km} km across` : ""}.`,
    }));
    $("region-select").value = region.id;
    $("region-select").disabled = false;
    $("region-sub").textContent = local ? `${terrainData.meta.dem}, ${cell} m cells`
      : `${terrainData.meta.dem}, ${cell} m cells: regional planning only. Clock, daylight and MEDA weather are Jezero values.`;
    $("route-grid-note").textContent = `A* on the ${terrainData.meta.dem} grid, server-side`;
    $("mission-map").setAttribute("aria-label", `Map of ${region.name}`);
    $("demo-flag").hidden = true;
    $("calc-route").disabled = false;
    hintFor = ""; landingFor = ""; selectedScience = null;
    if (mission) mission.destroy();
    mission = createMission($("mission-map"), {
      terrainData, catalog, waypoints, scienceTargets, hazardGrid, hazards: missionHazards, habitat, targets: missionTargets, textureUrl: ASSETS.marsTexture,
      onPlan: renderPlan,
      onSelectHazard: (sel) => renderHazardCard(sel),
      onSelectScience: (s) => renderScienceDetail(s),
      onTileError: () => { toast("Some Mars Trek imagery tiles didn’t load. The map keeps what it has."); renderLayerManager(); },
    });
    missionStarting = false;
    allScienceTargets = scienceTargets;
    $("sci-count").textContent = `${scienceTargets.length} targets`;
    $("sci-discovery-list").innerHTML = scienceTargets.length
      ? scienceTargets.map((s) => `<button type="button" class="sci-pick" data-sci-id="${s.id}" aria-current="false"><span><b>${s.name}</b><br><small style="color:var(--muted)">${EVIDENCE_LABEL[s.evidence_level] || s.evidence_level}</small></span><span class="mono" style="font-size:11px">${s.rover_sol != null ? `Sol ${s.rover_sol}` : "MRO"}</span></button>`).join("")
      : `<p class="fine">No verified scientific targets are loaded for this region.</p>`;
    renderScienceDetail(scienceTargets[0] || null);
    if (missionHazards[0]) renderHazardCard({ feature: missionHazards[0] });
    renderLayerManager();
    setTimeout(() => mission.map.flyToBounds(L.latLngBounds([habitat.latlng, mission.current.latlng]).pad(0.7), { duration: 1.4, maxZoom: 13 }), 250);
    if (missionBound) return;
    missionBound = true; // the listeners below read the `mission` variable, so they are bound once and serve every region
    $("region-select").addEventListener("change", (e) => loadRegion(e.target.value));
    $("landing-check").addEventListener("click", (e) => {
      const open = e.target.closest("[data-region]");
      if (open) loadRegion(open.dataset.region);
      else if (e.target.closest("#landing-region")) findSuitableRegion();
      else if (e.target.closest("#landing-move") && landing && landing.nearest_suitable) {
        const n = landing.nearest_suitable;
        mission.setStart({ id: "custom-start", name: "Landing point", icon: "map-pin", latlng: [n.lat, n.lon] });
      }
    });
    $("sci-cat").addEventListener("change", refreshScienceDiscovery);
    $("sci-ev").addEventListener("change", refreshScienceDiscovery);
    $("sci-nearby").addEventListener("click", () => {
      sciNearbyOn = !sciNearbyOn;
      $("sci-nearby").setAttribute("aria-pressed", String(sciNearbyOn));
      refreshScienceDiscovery();
    });
    $("sci-discovery-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sci-id]");
      if (!b) return;
      const obj = allScienceTargets.find((x) => x.id === b.dataset.sciId);
      if (obj) { renderScienceDetail(obj); mission.map.panTo([obj.lat, obj.lon]); }
    });
    $("sci-route-wps").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rm-wp]");
      if (!b) return;
      const obj = mission.routeWaypoints.find((w) => w.id === b.dataset.rmWp);
      if (obj) { mission.toggleWaypoint(obj); renderScienceChips(); if (selectedScience && selectedScience.id === obj.id) renderScienceDetail(obj); }
    });
    $("layers-list").addEventListener("change", (e) => {
      if (e.target.matches("[data-layer]")) { mission.toggleLayer(e.target.dataset.layer, e.target.checked); renderLayerManager(); }
    });
    $("layers-list").addEventListener("input", (e) => {
      if (e.target.matches("[data-op]")) {
        const v = Number(e.target.value);
        mission.setLayerOpacity(e.target.dataset.op, v);
        e.target.nextElementSibling.textContent = `${Math.round(v * 100)}%`;
      }
    });
    $("layers-list").addEventListener("click", (e) => {
      const btn = e.target.closest(".lbtn");
      if (!btn) return;
      const id = btn.closest(".lrow").dataset.lid;
      if (btn.dataset.act === "up") { mission.moveLayer(id, -1); renderLayerManager(); }
      else if (btn.dataset.act === "down") { mission.moveLayer(id, 1); renderLayerManager(); }
      else if (btn.dataset.act === "info") { if (openMeta.has(id)) openMeta.delete(id); else openMeta.add(id); renderLayerManager(); }
    });
    $("target-select").addEventListener("change", (e) => mission.setTarget(e.target.value));
    $("target-list").addEventListener("click", (e) => { const c = e.target.closest(".tcard"); if (c) mission.setTarget(c.dataset.id); });
    $("variants").addEventListener("click", (e) => { const v = e.target.closest(".variant"); if (v) mission.selectVariant(v.dataset.id); });
    $("route-compare").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) mission.selectVariant(b.dataset.id); });
    $("calc-route").addEventListener("click", () => mission.calculate());
    $("route-mode").addEventListener("change", (e) => mission.setMode(e.target.value));
    $("pick-start").addEventListener("click", () => mission.togglePickStart());
    $("export-route").addEventListener("click", exportRoute);
    const sliders = [
      ["s-start", "o-start", "startHour", (v) => MarsClock.fmtHours(v)],
      ["s-slope", "o-slope", "maxSlope", (v) => `${v}°`],
      ["s-radius", "o-radius", "radiusM", (v) => `${v} m`],
      ["s-suit", "o-suit", "suitHours", (v) => `${v} h`],
      ["s-dust", "o-dust", "dustTau", (v) => v.toFixed(2)],
    ];
    for (const [id, out, key, fmt] of sliders) {
      $(id).addEventListener("input", () => { const v = Number($(id).value); $(out).textContent = fmt(v); mission.setOpt(key, v); });
    }
    const riskSliders = [
      ["s-ws", "o-ws", "w_slope", (v) => v.toFixed(2)],
      ["s-wt", "o-wt", "w_terrain", (v) => v.toFixed(2)],
      ["s-wo", "o-wo", "w_obstacle", (v) => v.toFixed(2)],
      ["s-wu", "o-wu", "w_uncertainty", (v) => v.toFixed(2)],
      ["s-sh", "o-sh", "slope_high_deg", (v) => `${v}°`],
    ];
    let riskTimer = null;
    for (const [id, out, key, fmt] of riskSliders) {
      $(id).addEventListener("input", () => {
        const v = Number($(id).value);
        $(out).textContent = fmt(v);
        riskCfg[key] = v;
        clearTimeout(riskTimer);
        riskTimer = setTimeout(async () => {
          const g = await MarswalkApi.hazardGrid(riskCfg).catch(() => null);
          if (g) { mission.setHazardGrid(g); renderLayerManager(); }
          if (mission.plan) showElevation(mission.plan.target);
        }, 180);
      });
    }
    $("start-nav").addEventListener("click", startNav);
  }

  function verdictFor(v, opts) {
    const eva = v.eva, endTxt = MarsClock.fmtHours(eva.endHour);
    if (!eva.go) {
      if (eva.reasons.includes("dust")) return ["nogo", "No go", `Dust optical depth ${opts.dustTau.toFixed(1)} is 2 or more: poor visibility and weak solar power. Wait for clearer air.`];
      if (eva.reasons.includes("suit")) return ["nogo", "No go", `The walk needs ${fmtDur(eva.totalS)}; the suit allows ${fmtDur(eva.limitS)} after the 30% reserve.`];
      return ["nogo", "No go", `Return at ${endTxt} LMST is after the 17:30 daylight limit. Start earlier.`];
    }
    if (eva.caution) return ["care", "Go with caution", `Back at ${endTxt} LMST. Dust τ ${opts.dustTau.toFixed(1)} is elevated; keep line of sight to the habitat.`];
    return ["go", "Go", `Back at ${endTxt} LMST with the 30% oxygen reserve intact.`];
  }

  function renderTimeline(v, opts) {
    const W = 360, H = 40, t0 = 5, t1 = 19;
    const x = (h) => ((Math.max(t0, Math.min(t1, h)) - t0) / (t1 - t0)) * W;
    const start = opts.startHour, out = start + v.sum.outS / SOL_HOUR_S, stop = out + v.stopMinutes * 60 / SOL_HOUR_S, back = stop + v.sum.backS / SOL_HOUR_S;
    let ticks = "";
    for (let h = 6; h <= 18; h += 3) ticks += `<text class="tl-text" x="${x(h)}" y="${H + 13}" text-anchor="middle">${String(h).padStart(2, "0")}:00</text>`;
    $("timeline").innerHTML = `<svg viewBox="0 -2 ${W} ${H + 18}" role="img" aria-label="Walk from ${MarsClock.fmtHours(start)} to ${MarsClock.fmtHours(back)}">
      <rect class="tl-night" x="0.5" y="0.5" width="${W - 1}" height="${H}" rx="8"/>
      <rect class="tl-day" x="${x(6.5)}" y="0.5" width="${x(SUNSET) - x(6.5)}" height="${H}"/>
      <rect class="tl-out" x="${x(start)}" y="14" width="${Math.max(2, x(out) - x(start))}" height="13" rx="3"/>
      <rect class="tl-stop" x="${x(out)}" y="14" width="${Math.max(2, x(stop) - x(out))}" height="13" rx="3"/>
      <rect class="tl-back" x="${x(stop)}" y="14" width="${Math.max(2, x(back) - x(stop))}" height="13" rx="3"/>
      <line class="tl-end" x1="${x(back)}" x2="${x(back)}" y1="2" y2="${H}"/>${ticks}</svg>
      <div class="tl-legend"><span><i style="background:var(--c-fast)"></i>Outbound</span><span><i style="background:var(--c-sci)"></i>Science</span><span><i style="background:var(--accent)"></i>Return</span><span class="mono">Back ${MarsClock.fmtHours(back)}</span></div>`;
  }

  function renderProfile(profile, el = $("profile"), extra = () => "") {
    const W = 360, H = 100, pad = 44;
    const dMax = profile[profile.length - 1][0] || 1;
    const zs = profile.map((p) => p[1]);
    const zMin = Math.min(...zs), zMax = Math.max(...zs), span = Math.max(10, zMax - zMin);
    const X = (d) => pad + (d / dMax) * (W - pad);
    const Y = (z) => 6 + (1 - (z - zMin) / span) * (H - 20);
    const pts = profile.map(([d, z]) => `${X(d).toFixed(1)},${Y(z).toFixed(1)}`).join(" ");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H + 12}" role="img" aria-label="Elevation from ${Math.round(zs[0])} m to ${Math.round(zs[zs.length - 1])} m">
      <line class="pf-grid" x1="${pad}" x2="${W}" y1="${Y(zMax)}" y2="${Y(zMax)}"/><line class="pf-grid" x1="${pad}" x2="${W}" y1="${Y(zMin)}" y2="${Y(zMin)}"/>
      <polygon class="pf-area" points="${X(0)},${H - 14} ${pts} ${X(dMax)},${H - 14}"/><polyline class="pf-line" points="${pts}"/>
      <text class="pf-text" x="0" y="${Y(zMax) + 3}">${Math.round(zMax)} m</text><text class="pf-text" x="0" y="${Y(zMin) + 3}">${Math.round(zMin)} m</text>
      <text class="pf-text" x="${pad}" y="${H + 8}">A 0 km</text><text class="pf-text" x="${W}" y="${H + 8}" text-anchor="end">B ${(dMax / 1000).toFixed(1)} km</text>${extra(X, Y, H)}</svg>`;
    return { X, Y };
  }

  const ROUTE_ERRORS = {
    OUTSIDE_COVERAGE: "Start or destination is outside the terrain grid of this region.",
    SAME_CELL: "Start and destination fall into the same terrain cell. Pick points further apart.",
    DATASET_NOT_ACQUIRED: "The terrain of this region is not loaded on the backend.",
  };
  const share = (o, keys) => keys.map((k) => `${Math.round(o[k] * 100)}%`).join(" / ");
  // Comparison panel: every value is read from the backend response; the page only formats it.
  const COMPARE_ROWS = [
    ["Total distance", (a) => fmtKm(a.total_distance_m)],
    ["Longer than shortest", (a) => `${Math.round(a.extra_distance_vs_shortest_m)} m`],
    ["Elevation gain / loss", (a) => `${Math.round(a.ascent_m)} / ${Math.round(a.descent_m)} m`],
    ["Slope max / mean", (a) => `${a.max_slope_deg.toFixed(1)}° / ${a.mean_slope_deg.toFixed(1)}°`],
    ["Terrain smooth / moderate / steep / hazard", (a) => share(a.terrain.class_share, ["smooth", "moderate", "steep", "hazard"])],
    ["Roughness TRI mean / max", (a) => `${a.terrain.roughness_mean_m.toFixed(1)} / ${a.terrain.roughness_max_m.toFixed(1)} m`],
    ["Hazard low / moderate / high", (a) => share(a.hazard.class_share, ["LOW", "MODERATE", "HIGH"])],
    ["Risk score mean / max", (a) => `${a.hazard.mean_risk.toFixed(2)} / ${a.hazard.max_risk.toFixed(2)}`],
    ["Data uncertainty mean / max", (a) => `${a.data_quality.mean_uncertainty.toFixed(2)} / ${a.data_quality.max_uncertainty.toFixed(2)}`],
    ["Science targets nearby", (a) => a.science_targets.length],
    ["Weighted cost", (a) => Math.round(a.cost.total)],
  ];

  function exportRoute() {
    if (!mission.plan) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(mission.plan.response, null, 2)], { type: "application/json" }));
    a.download = `marswalk-routes-${mission.plan.target.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  let lastPlan = null;
  function renderPlan(s) {
    const { plan, selectedId, status } = s, tg = s.target, busy = status === "loading";
    renderTargets(tg.id);
    showElevation(tg);
    showLanding(s.start);
    $("start-name").textContent = s.start.name;
    $("start-sub").textContent = s.start.id === "habitat" ? region.landing.name : fmtCoord(s.start.latlng[0], s.start.latlng[1]);
    $("pick-start").setAttribute("aria-checked", String(s.pickStart));
    if (s.pickStart) { hintFor = ""; $("map-hint-text").textContent = "Click the map, a target or the habitat to set the landing point A"; }
    $("calc-route").disabled = busy;
    $("calc-route").querySelector("span").textContent = busy ? "Calculating…" : "Calculate route";
    $("route-status").dataset.state = status;
    $("route-status").textContent = busy ? "Analysing terrain and searching the grid on the backend…"
      : status === "error" ? `${ROUTE_ERRORS[s.error] || `Route calculation failed (${s.error}).`} Press Calculate route to try again.`
      : status === "idle" ? "Start, destination or preferences changed. Press Calculate route."
      : `${plan.variants.length} of ${plan.response.alternatives.length} routes found · ${plan.response.grid.cell_m.map(Math.round).join(" × ")} m cells · ${plan.response.data_class}`;
    $("variants").innerHTML = !plan ? "" : plan.variants.map((v) => `
      <li><button type="button" class="variant" data-id="${v.id}" aria-pressed="${v.id === selectedId}" style="--vc:${v.color}">
        <span class="v-rank">${icon(v.icon)}</span>
        <span class="v-main"><b>${v.label}</b>
          <small>${v.sameAs ? `Same line as ${v.sameAs}` : v.alt.mode === "SHORTEST" ? "Baseline: minimum ground distance" : `${Math.round(v.alt.extra_distance_vs_shortest_m)} m longer than shortest`}</small>
          <span class="v-meta mono"><span>↑ ${Math.round(v.sum.ascent)} m</span><span>max ${v.sum.maxSlope.toFixed(1)}°</span><span>risk ${v.alt.hazard.mean_risk.toFixed(2)}</span><span>${v.alt.science_targets.length} targets</span></span></span>
        <span class="v-side"><span class="mono">${fmtKm(v.sum.distance)}</span></span></button></li>`)
      .concat(plan.unreachable.map((u) => `<li><button type="button" class="variant" disabled style="--vc:var(--bad)">
        <span class="v-rank">${icon("ban")}</span><span class="v-main"><b>${u.label}: no route</b><small>${u.alt.reason}</small></span><span></span></button></li>`)).join("");

    const v = plan && plan.variants.find((x) => x.id === selectedId);
    $("route-why").textContent = v ? v.alt.explanation : "";
    $("compare-card").hidden = !v;
    $("start-nav").disabled = !v || !v.eva.go;
    if (plan && plan.response !== lastPlan) {
      lastPlan = plan.response;
      if (!v) Zyro.post(`No route to ${tg.name}. ${plan.unreachable[0].alt.reason}`, { mood: "shock", level: "warn" });
      else {
        Zyro.post(`${plan.variants.length} routes to ${tg.name}, calculated on the backend: ${plan.variants.map((x) => `${x.label} ${fmtKm(x.sum.distance)}, max slope ${x.sum.maxSlope.toFixed(1)}°`).join("; ")}. ${v.alt.explanation}`, { mood: "cool" });
        if (currentTab === "mission" && !Buddy.touring) Buddy.say(`Routes to ${tg.name} are ready: ${plan.variants.map((x) => `${x.label.toLowerCase()} ${fmtKm(x.sum.distance)}`).join(", ")}. Compare them in the panel.`, { mood: "cool", tag: "Route plan" });
      }
    }
    if (!v) {
      $("verdict").dataset.state = status === "ready" ? "nogo" : "idle";
      $("verdict-status").textContent = busy ? "Planning" : status === "ready" ? "No route" : status === "error" ? "No data" : "Not calculated";
      $("verdict-route").textContent = "";
      $("verdict-why").textContent = status === "ready" ? plan.unreachable.map((u) => `${u.label}: ${u.alt.reason}`).join(" ") : "";
      $("o2-fill").style.width = "0%"; $("o2-text").textContent = "–";
      $("stats").innerHTML = ""; $("timeline").innerHTML = ""; $("profile").innerHTML = ""; $("sci").innerHTML = "";
      return;
    }
    const opts = plan.opts, res = plan.response, cost = v.alt.cost;
    $("route-compare").innerHTML = `<thead><tr><th scope="col">Metric</th>${plan.variants.map((x) => `<th scope="col"><button type="button" data-id="${x.id}" aria-pressed="${x === v}">${x.label}</button></th>`).join("")}</tr></thead>
      <tbody>${COMPARE_ROWS.map(([name, f]) => `<tr><th scope="row">${name}</th>${plan.variants.map((x) => `<td class="mono${x === v ? " is-sel" : ""}">${f(x.alt)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    $("route-warnings").innerHTML = res.warnings.map((w) => `<li>${w}</li>`).join("");
    $("route-model").innerHTML = `<summary>Cost model and limitations</summary>
      <p class="mono">${res.cost_model.formula}</p>
      <p>${v.label}: weights ${Object.entries(v.alt.weights).map(([k, w]) => `${k} ${w}`).join(", ")}. Cost ${Math.round(cost.total)} = distance ${Math.round(cost.distance)} + slope ${Math.round(cost.slope)} + roughness ${Math.round(cost.roughness)} + hazard ${Math.round(cost.hazard)} + uncertainty ${Math.round(cost.uncertainty)} − science ${Math.round(cost.science_discount)} (${res.cost_model.units}). ${v.alt.algorithm === "astar" ? "A*" : "Dijkstra"} expanded ${v.alt.nodes_expanded} cells.</p>
      <ul>${Object.entries(res.cost_model.terms).map(([k, d]) => `<li><b>${k}</b>: ${d}</li>`).join("")}</ul>
      <ul>${[...v.alt.constraints, ...res.limitations].map((x) => `<li>${x}</li>`).join("")}</ul>`;
    const [st, label, why] = verdictFor(v, opts);
    $("verdict").dataset.state = st;
    $("verdict-status").textContent = label;
    $("verdict-route").textContent = `${v.label} route`;
    $("verdict-why").textContent = why;

    const pct = Math.round(v.eva.o2Used * 100);
    $("o2-fill").style.width = `${Math.min(100, pct)}%`;
    $("o2-fill").classList.toggle("warn", pct > 60 && pct <= 77);
    $("o2-fill").classList.toggle("bad", pct > 77);
    $("o2-text").textContent = `${pct}% of tank`;

    const stat = (ic, l, val) => `<div class="stat"><small>${icon(ic)}${l}</small><span class="num mono">${val}</span></div>`;
    $("stats").innerHTML = [
      stat("route", "Distance", fmtKm(v.sum.distance)),
      stat("mountain", "Climb", `${Math.round(v.sum.ascent)} m`),
      stat("trending-down", "Descent", `${Math.round(v.sum.descent)} m`),
      stat("triangle-alert", "Max slope", `${v.sum.maxSlope.toFixed(1)}°`),
      stat("footprints", "Out (simulated)", fmtDur(v.sum.outS)),
      stat("undo-2", "Back (simulated)", fmtDur(v.sum.backS)),
    ].join("");
    renderTimeline(v, opts);
    renderProfile(v.profile);
    const wp = v.alt.science_targets;
    $("sci").innerHTML = [{ ...tg, main: true }, ...v.bonus].map((s) => `<li><span class="si">${icon(s.icon || "map-pin")}</span>
      <div><b>${s.name}${s.main ? "" : " (on the way)"}</b><span>${s.why}</span><span class="src">${s.tag}. Source: ${s.source}. ${s.minutes} min on site.</span></div></li>`).join("")
      + `<li><span class="si">${icon("map-pinned")}</span><div><b>${wp.length} Perseverance waypoints within ${opts.radiusM} m</b>
        <span>${wp.length ? `Nearest: ${wp.slice(0, 3).map((w) => `sol ${w.rover_sol} at ${Math.round(w.distance_to_route_m)} m`).join(", ")}.` : "None near this route."}</span>
        <span class="src">REAL positions, NASA M20 waypoints. Distances measured by the backend.</span></div></li>`;
  }

  // ---------- Навигация и контроль ресурсов ----------
  let nav = null;
  const SPEEDS = [60, 300, 900];
  let missionHazards = [];   // backend hazard hotspots, set when the mission map loads
  const SIM_STEP_S = 1;      // fixed step: one route and one set of settings always give the same result
  const HAZARD_NEAR_M = 150; // a hotspot counts as encountered within this distance of the route
  const RUNS_KEY = "marswalk-sim-runs";

  // Mission event log: shown in the panel and saved with the run
  function ev(ic, text) {
    nav.events.push({ t: nav.simT, text });
    $("nav-events").insertAdjacentHTML("beforeend", `<li><span class="si">${icon(ic)}</span><span>${text}</span><small>${fmtDur(nav.simT)}</small></li>`);
    $("nav-events").lastElementChild.scrollIntoView({ block: "nearest" });
  }
  // Distance along the outbound route (m) of the vertex nearest to a point, plus how far the point is from it
  function nearestAlong(route, p) {
    let best = { d: Infinity, atM: 0 };
    route.ll.forEach((q, k) => { const d = Router.metersBetween(q, p); if (d < best.d) best = { d, atM: route.cum[k] }; });
    return best;
  }
  // Position on the outbound route in metres, also while walking back
  const atOut = () => nav.phase === "back" ? nav.backRoute.cum[nav.backRoute.cum.length - 1] - nav.traveled : nav.phase === "home" ? 0 : nav.traveled || 0;
  const walkedM = () => (nav.phase === "back" || nav.phase === "home" ? nav.outDone : 0) + (nav.traveled || 0);
  function elevAt(d) {
    const c = nav.outRoute.cum, e = nav.elev;
    let k = 0;
    while (k < c.length - 2 && c[k + 1] < d) k++;
    return e[k] + (e[k + 1] - e[k]) * clamp01((d - c[k]) / ((c[k + 1] - c[k]) || 1));
  }
  function checkHazards() {
    const d = atOut(), back = nav.phase === "back", lim = back ? nav.backRoute.cum[nav.backRoute.cum.length - 1] : Infinity;
    nav.hz.forEach((h, i) => {
      const key = `hz${nav.phase}${i}`;
      if (nav.warned[key] || h.atM > lim || (back ? d > h.atM : d < h.atM)) return;
      nav.warned[key] = true; nav.hazSeen.add(i);
      const msg = `Hazard ${h.cls}: ${h.name}, ${Math.round(h.d)} m from the route`;
      ev("triangle-alert", msg);
      toast(msg);
    });
  }
  function setArrow(el, dir, bearing) {
    el.innerHTML = icon(Nav.ARROWS[dir] || "arrow-up");
    el.style.transform = dir === "depart" || dir === "straight" ? `rotate(${bearing || 0}deg)` : "";
  }
  const stepsFor = (cells, dest) => Nav.buildSteps(mission.terrain, cells, dest, mission.plan.opts.maxSlope);
  function renderStepsList() {
    const st = nav.phase === "back" ? nav.backRoute.steps : nav.outRoute.steps;
    $("steps-list").innerHTML = st.map((s, i) => `<li data-i="${i}">
      <span class="si">${icon(Nav.ARROWS[s.kind === "depart" ? "depart" : s.dir] || "arrow-up")}</span>
      <span>${s.text}${s.kind !== "arrive" ? ` for ${fmtKm(s.dist)}` : ""}${s.steepWarn ? `<span class="steep">Slope up to ${s.steep.toFixed(0)}°</span>` : ""}</span>
      <small>${fmtKm(s.atM)}</small></li>`).join("");
  }

  function startNav() {
    const v = mission.selected;
    if (!v || !v.eva.go) return;
    const t = mission.terrain, plan = mission.plan, opts = plan.opts;
    nav = {
      v, t, opts, target: plan.target,
      outRoute: stepsFor(v.cells, plan.target.name), times: Nav.timeline(t, v.cells, { maxSlope: opts.maxSlope }),
      backRoute: null, backLL: null, backTimes: null,
      phase: "out", phaseT: 0, simT: 0, o2Used: 0, leak: 1, speed: 300, playing: true, lastTs: null, step: -1, warned: {},
      aborted: false, abortReason: "", tank: opts.suitHours * 3600, reserve: opts.suitHours * 3600 * 0.3 / 1.3, sciT: v.stopMinutes * 60, passed: new Set(),
      acc: 0, outDone: 0, events: [], hazSeen: new Set(), targetDone: false, elev: v.cells.map((c) => t.elev[c]),
    };
    nav.ll = nav.outRoute.ll[0];
    nav.hz = missionHazards.filter((h) => h.lat != null && h.lon != null)
      .map((h) => ({ ...nearestAlong(nav.outRoute, [h.lat, h.lon]), name: h.title_en || h.title_ru || h.hazard_type || "Hazard", cls: h.hazard_class || "UNKNOWN" }))
      .filter((h) => h.d <= HAZARD_NEAR_M).sort((a, b) => a.atM - b.atM);
    nav.stops = [...v.bonus, plan.target].map((s) => ({ name: s.name, atM: nearestAlong(nav.outRoute, s.latlng).atM }));
    const tick = (x, y2, stroke, w, title) => `<line x1="${x}" x2="${x}" y1="6" y2="${y2}" stroke="${stroke}" stroke-width="${w}"><title>${title}</title></line>`;
    nav.px = renderProfile(nav.outRoute.cum.map((d, k) => [d, nav.elev[k]]), $("nav-profile"), (X, Y, H) =>
      nav.hz.map((h) => tick(X(h.atM), H - 14, "var(--warn)", 1.5, `${h.cls}: ${h.name}`)).join("")
      + nav.stops.map((s) => tick(X(s.atM), H - 14, "var(--accent)", 2.5, s.name)).join("")
      + `<line id="nav-cur" x1="${X(0)}" x2="${X(0)}" y1="6" y2="${H - 14}" stroke="#fff" stroke-width="1.5"/><circle id="nav-dot" cx="${X(0)}" cy="${Y(nav.elev[0])}" r="4" fill="var(--accent)" stroke="#fff"/>`);
    $("nav-events").innerHTML = "";
    $("plan-panel").hidden = true; $("nav-panel").hidden = false; $("nav-summary").hidden = true; $("visor").hidden = false;
    $("nav-speed").textContent = `${nav.speed}×`;
    $("nav-leak").setAttribute("aria-pressed", "false");
    $("nav-play").innerHTML = icon("pause");
    const stage = document.querySelector(".mission-stage");
    stage.classList.add("nav-mode");
    if (window.matchMedia("(max-width: 900px)").matches) stage.scrollIntoView({ behavior: "smooth", block: "start" });
    mission.startNav();
    renderStepsList();
    const first = nav.outRoute.steps[0];
    ev("play", `Mission start at the habitat: ${v.label} route to ${plan.target.name}, ${fmtKm(v.sum.distance)}, ${nav.hz.length} hazard hotspot${nav.hz.length === 1 ? "" : "s"} within ${HAZARD_NEAR_M} m`);
    Zyro.post(`Navigation started on the ${v.label} route. ${first.text} for ${fmtKm(first.dist)}. I’ll keep checking oxygen, daylight and the way back.`, { mood: "cool" });
    requestAnimationFrame(loop);
  }

  function beginBack(fromK) {
    const cells = nav.v.cells.slice(0, fromK + 1).reverse();
    nav.backRoute = stepsFor(cells, "Habitat");
    nav.backLL = nav.backRoute.ll;
    nav.backTimes = Nav.timeline(nav.t, cells, { maxSlope: nav.opts.maxSlope }).out;
    nav.outDone = nav.traveled || 0;
    nav.phase = "back"; nav.phaseT = 0; nav.step = -1; nav.traveled = 0;
    ev("undo-2", `Return to the habitat started after ${fmtKm(nav.outDone)}`);
    renderStepsList();
  }
  function returnSeconds() {
    if (nav.phase === "out") return nav.times.back[nav.k || 0];
    if (nav.phase === "science") return nav.times.back[nav.times.back.length - 1];
    if (nav.phase === "back") return Math.max(0, nav.backTimes[nav.backTimes.length - 1] - nav.phaseT);
    return 0;
  }
  function loop(ts) {
    if (!nav) return;
    if (nav.lastTs === null) nav.lastTs = ts;
    const dtReal = Math.min(0.1, (ts - nav.lastTs) / 1000);
    nav.lastTs = ts;
    if (nav.playing && nav.phase !== "home") {
      nav.acc += dtReal * nav.speed;
      while (nav.acc >= SIM_STEP_S && nav.playing && nav.phase !== "home") {
        nav.acc -= SIM_STEP_S;
        nav.simT += SIM_STEP_S; nav.phaseT += SIM_STEP_S; nav.o2Used += SIM_STEP_S * nav.leak;
        advance();
      }
      mission.moveWalker(nav.ll, true);
    }
    if (nav) updateHud();
    if (nav) requestAnimationFrame(loop);
  }
  const along = (route, pos) => route.cum[pos.k] + (pos.f || 0) * ((route.cum[pos.k + 1] || route.cum[pos.k]) - route.cum[pos.k]);
  function advance() {
    const outLL = nav.outRoute.ll;
    if (nav.phase === "out") {
      const total = nav.times.out[nav.times.out.length - 1];
      const pos = Nav.positionAt(outLL, nav.times.out, nav.phaseT);
      nav.k = pos.k; nav.ll = pos.ll; nav.traveled = along(nav.outRoute, pos);
      checkHazards();
      for (const b of nav.v.bonus) {
        if (!nav.passed.has(b.id) && Router.metersBetween(nav.ll, b.latlng) < Math.max(250, nav.opts.radiusM * 0.8)) {
          nav.passed.add(b.id);
          ev("microscope", `Science stop on the way: ${b.name}, ${b.minutes} min planned`);
          Zyro.post(`Passing ${b.name}: ${b.tag.toLowerCase()}. ${b.minutes} min planned here for samples.`, { mood: "smug" });
        }
      }
      if (nav.phaseT >= total) {
        nav.phase = "science"; nav.phaseT = 0; nav.ll = outLL[outLL.length - 1]; nav.targetDone = true;
        ev("flag", `Arrived at ${nav.target.name}, ${fmtKm(nav.traveled)} walked. Science window ${Math.round(nav.sciT / 60)} min`);
        Zyro.post(`Arrived at ${nav.target.name}. Science window: ${Math.round(nav.sciT / 60)} min. ${nav.target.why}`, { mood: "cool" });
      }
    } else if (nav.phase === "science") {
      if (nav.phaseT >= nav.sciT) {
        ev("test-tube", `Study finished and sample collected at ${nav.target.name} (scenario step)`);
        Zyro.post(`Science done. Returning to the habitat, about ${fmtDur(returnSeconds())} of walking.`, { mood: "smug" });
        beginBack(nav.v.cells.length - 1);
      }
    } else if (nav.phase === "back") {
      const pos = Nav.positionAt(nav.backLL, nav.backTimes, nav.phaseT);
      nav.ll = pos.ll; nav.traveled = along(nav.backRoute, pos);
      checkHazards();
      if (nav.phaseT >= nav.backTimes[nav.backTimes.length - 1]) { nav.ll = nav.backLL[nav.backLL.length - 1]; finishNav(); }
    }
  }
  function currentStep() {
    const route = nav.phase === "back" ? nav.backRoute : nav.outRoute;
    if (nav.phase === "science" || nav.phase === "home") return { step: route.steps[route.steps.length - 1], next: null, toNext: 0, idx: route.steps.length - 1 };
    let idx = 0;
    for (let i = 0; i < route.steps.length; i++) if (route.steps[i].atM <= (nav.traveled || 0) + 1) idx = i;
    const next = route.steps[idx + 1] || null;
    return { step: route.steps[idx], next, toNext: next ? next.atM - nav.traveled : 0, idx };
  }
  function updateHud() {
    const ret = returnSeconds();
    const remaining = nav.tank - nav.o2Used;
    const marginS = (remaining - nav.reserve - ret * nav.leak) / nav.leak;
    let finishNeed = ret * nav.leak;
    if (nav.phase === "out") finishNeed = ((nav.times.out[nav.times.out.length - 1] - nav.phaseT) + nav.sciT + nav.times.back[nav.times.back.length - 1]) * nav.leak;
    if (nav.phase === "science") finishNeed = ((nav.sciT - nav.phaseT) + ret) * nav.leak;
    const canFinish = remaining - nav.reserve >= finishNeed;
    const lmstNow = nav.opts.startHour + nav.simT / SOL_HOUR_S;
    const daylightS = (SUNSET - lmstNow) * SOL_HOUR_S;

    const cs = currentStep();
    const showing = nav.phase === "science" ? { text: `Science at ${nav.target.name}`, dir: "arrive" }
      : nav.phase === "home" ? { text: "At the habitat", dir: "arrive" } : cs.next || cs.step;
    const toNextTxt = nav.phase === "science" ? `${fmtDur(nav.sciT - nav.phaseT)} left` : nav.phase === "home" ? "Complete" : cs.next ? `in ${fmtKm(Math.max(0, cs.toNext))}` : "Here";
    if (cs.idx !== nav.step) {
      nav.step = cs.idx;
      document.querySelectorAll("#steps-list li").forEach((li, i) => { li.classList.toggle("done", i < cs.idx); li.classList.toggle("now", i === cs.idx); });
      const nowLi = document.querySelector("#steps-list li.now");
      if (nowLi) nowLi.scrollIntoView({ block: "nearest" });
      if (cs.step.steepWarn && nav.phase !== "science" && nav.phase !== "home" && !nav.warned[`steep${nav.phase}${cs.idx}`]) {
        nav.warned[`steep${nav.phase}${cs.idx}`] = true;
        ev("mountain", `Steep stretch ahead: slope up to ${cs.step.steep.toFixed(0)}°`);
        Zyro.post(`This stretch has slopes up to ${cs.step.steep.toFixed(0)}°. Shorter steps on loose ground.`, { mood: "shock" });
      }
    }
    const arrowDir = nav.phase === "science" || nav.phase === "home" ? "arrive" : showing.kind === "depart" ? "depart" : showing.dir;
    const key = `${arrowDir}|${Math.round((showing.bearing || 0) / 10)}`;
    if (nav.arrowKey !== key) { nav.arrowKey = key; setArrow($("vt-arrow"), arrowDir, showing.bearing); setArrow($("np-arrow"), arrowDir, showing.bearing); }
    $("vt-text").textContent = showing.text; $("np-text").textContent = showing.text;
    $("vt-dist").textContent = toNextTxt; $("np-dist").textContent = toNextTxt;
    const phaseName = { out: "Outbound", science: "Science", back: "Return", home: "Complete" }[nav.phase];
    $("np-phase").textContent = phaseName; $("vb-phase").textContent = phaseName;

    const o2pct = Math.max(0, Math.round(remaining / nav.tank * 100));
    $("ng-o2").textContent = `${o2pct}%`; $("vg-o2-t").textContent = `${o2pct}%`;
    $("vg-o2").style.height = `${o2pct}%`;
    $("vg-o2").className = o2pct < 30 ? "bad" : o2pct < 50 ? "warn" : "";
    $("ng-margin").textContent = `${marginS >= 0 ? "+" : "−"}${fmtDur(Math.abs(marginS))}`;
    $("ng-home").textContent = fmtDur(ret);
    $("ng-day").textContent = daylightS > 0 ? fmtDur(daylightS) : "Dark";
    $("vb-clock").textContent = `${MarsClock.fmtHours(lmstNow)} LMST`;
    const d0 = atOut(), z = elevAt(d0);
    $("nr-pos").textContent = fmtCoord(nav.ll[0], nav.ll[1]);
    $("nr-dist").textContent = fmtKm(walkedM());
    $("nr-elev").textContent = `${Math.round(z)} m`;
    $("nr-time").textContent = fmtDur(nav.simT);
    $("nr-hz").textContent = `${nav.hazSeen.size}/${nav.hz.length} · ${nav.passed.size + (nav.targetDone ? 1 : 0)}/${nav.stops.length}`;
    const cx = nav.px.X(d0);
    $("nav-cur").setAttribute("x1", cx); $("nav-cur").setAttribute("x2", cx);
    $("nav-dot").setAttribute("cx", cx); $("nav-dot").setAttribute("cy", nav.px.Y(z));
    const homeM = nav.phase === "back" ? Math.max(0, nav.backRoute.cum[nav.backRoute.cum.length - 1] - (nav.traveled || 0))
      : nav.phase === "science" ? nav.outRoute.cum[nav.outRoute.cum.length - 1] : nav.phase === "home" ? 0 : (nav.traveled || 0);
    $("vb-home").textContent = fmtKm(homeM);
    $("vb-dose").textContent = `${(nav.simT / 86400 * RAD_PER_DAY).toFixed(2)} mSv`;
    $("vg-ret").style.height = `${Math.max(4, clamp01(marginS / (nav.tank * 0.5)) * 100)}%`;

    let st = "ok", text = `Return possible with ${fmtDur(Math.max(0, marginS))} of spare oxygen.`;
    if (nav.phase === "home") text = "At the habitat. Airlock closed.";
    else if (marginS < 0) { st = "bad"; text = `Turn back now. The return needs ${fmtDur(ret * nav.leak)} of oxygen; ${fmtDur(Math.max(0, remaining - nav.reserve))} is left before the reserve.`; }
    else if (!canFinish && nav.phase !== "back") { st = "tight"; text = "Not enough oxygen to finish the plan. Turning back now still gets you home."; }
    else if (marginS < 20 * 60) { st = "tight"; text = `Only ${fmtDur(marginS)} of spare oxygen.`; }
    else if (daylightS < ret) { st = "tight"; text = "The return would end after sunset. Turn back or move faster."; }
    $("return-check").dataset.state = st;
    $("rc-text").textContent = text;
    $("vg-ret-t").textContent = st === "ok" ? "OK" : st === "tight" ? "Tight" : "Back";
    $("vg-ret").className = st === "ok" ? "" : st === "tight" ? "warn" : "bad";
    document.querySelector(".visor-top").classList.toggle("warn", st === "bad");
    if (st === "tight" && !canFinish && !nav.warned.finish && nav.phase !== "back") {
      nav.warned.finish = true;
      ev("triangle-alert", "Oxygen will not last for the full plan (simulation assumption)");
      Zyro.post("At the current oxygen rate the plan can’t be finished. Turn back now and you reach the habitat with the reserve intact.", { mood: "shock", level: "warn" });
      toast("Zyro: oxygen won’t last for the full plan. Turn back recommended.");
    }
    if (st === "bad" && !nav.warned.bad) {
      nav.warned.bad = true;
      ev("triangle-alert", "Return margin exhausted: turn back now (simulation assumption)");
      Zyro.post("Turn back now. The return is eating into the oxygen reserve.", { mood: "shock", level: "warn" });
      toast("Zyro: turn back now.");
    }
  }

  let lastReport = "";
  function finishNav() {
    nav.phase = "home"; nav.playing = false;
    const v = nav.v;
    const o2Left = Math.max(0, Math.round((nav.tank - nav.o2Used) / nav.tank * 100));
    const dose = (nav.simT / 86400 * RAD_PER_DAY).toFixed(2);
    const sciDone = nav.aborted ? [] : [nav.target.name, ...v.bonus.map((b) => b.name)];
    ev("flag", `Back at the habitat after ${fmtKm(walkedM())} and ${fmtDur(nav.simT)}`);
    saveRun(nav.aborted ? "returned early" : "completed");
    lastReport = [
      `Marswalk report, ${region.name}`,
      `Route: Habitat to ${nav.target.name} (${v.label}), ${fmtKm(v.sum.distance)} one way`,
      `Status: ${nav.aborted ? `returned early (${nav.abortReason})` : "completed"}`,
      `Duration: ${fmtDur(nav.simT)}, start ${MarsClock.fmtHours(nav.opts.startHour)} LMST; distance walked ${fmtKm(walkedM())}`,
      `Hazard hotspots encountered: ${nav.hazSeen.size} of ${nav.hz.length} within ${HAZARD_NEAR_M} m of the route`,
      `Oxygen left: ${o2Left}% (simulation assumption; reserve: 23% of the tank, a 30% margin on the walk)`,
      `Radiation dose: ${dose} mSv (Curiosity RAD rate)`,
      `Science stops: ${sciDone.length ? sciDone.join(", ") : "none"}`,
      `Data: ${nav.t.meta.source}; dust τ ${nav.opts.dustTau.toFixed(2)} (MEDA SkyCam baseline 0.45)`,
    ].join("\n");
    $("nav-summary").hidden = false;
    $("nav-summary").innerHTML = `<span class="eyebrow">Mission result</span><h3>${nav.aborted ? "Returned early, crew safe" : "Marswalk completed"}</h3>
      <dl><div><dt>Duration</dt><dd class="mono">${fmtDur(nav.simT)}</dd></div><div><dt>Oxygen left</dt><dd class="mono">${o2Left}%</dd></div>
      <div><dt>Radiation dose</dt><dd class="mono">${dose} mSv</dd></div><div><dt>Science stops</dt><dd class="mono">${sciDone.length}</dd></div>
      <div><dt>Distance walked</dt><dd class="mono">${fmtKm(walkedM())}</dd></div><div><dt>Hazards encountered</dt><dd class="mono">${nav.hazSeen.size} / ${nav.hz.length}</dd></div></dl>
      <p class="fine">Oxygen, time and dose are simulation assumptions. Saved on this device with the mission settings.</p>
      <div class="actions"><button type="button" class="btn" id="nav-copy">${icon("copy")}Copy report</button>
      <button type="button" class="btn" id="nav-export">${icon("download")}Export JSON</button>
      <button type="button" class="btn" id="nav-again">${icon("rotate-ccw")}Restart mission</button>
      <button type="button" class="btn primary" id="nav-done">${icon("map")}Back to planning</button></div>`;
    $("nav-done").addEventListener("click", () => stopNav(false));
    $("nav-again").addEventListener("click", restartNav);
    $("nav-export").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(nav.lastRun, null, 2)], { type: "application/json" }));
      a.download = `marswalk-run-${nav.lastRun.saved.slice(0, 19).replace(/[:T]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $("nav-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(lastReport); toast("Report copied."); }
      catch (_) { Zyro.post(lastReport, { mood: "smug" }); Zyro.open(); toast("Clipboard is blocked here. The report is in the Zyro panel."); }
    });
    Zyro.post(nav.aborted
      ? "Back at the habitat with oxygen to spare. Turning back early was the right call."
      : `Back at the habitat. ${o2Left}% oxygen left, ${dose} mSv dose, ${sciDone.length} science stop${sciDone.length === 1 ? "" : "s"} done.`, { mood: "cool" });
  }
  // Settings and results of a run, kept in localStorage (last 20) so a mission can be compared and repeated
  function saveRun(status) {
    const rec = {
      saved: new Date().toISOString(), status,
      params: { ...nav.opts, route: nav.v.label, target: nav.target.name, targetLatLng: nav.target.latlng, stepS: SIM_STEP_S, hazardNearM: HAZARD_NEAR_M, oxygenReservePct: 23, finalOxygenUseFactor: nav.leak },
      result: { elapsedS: nav.simT, walkedM: Math.round(walkedM()), oxygenLeftPct: Math.max(0, Math.round((nav.tank - nav.o2Used) / nav.tank * 100)),
        doseMSv: +(nav.simT / 86400 * RAD_PER_DAY).toFixed(3), hazardsEncountered: [...nav.hazSeen].map((i) => nav.hz[i].name),
        targetsVisited: [...nav.v.bonus.filter((b) => nav.passed.has(b.id)).map((b) => b.name), ...(nav.targetDone ? [nav.target.name] : [])], events: nav.events },
      note: "Oxygen, time and dose are simulation assumptions, not measurements.",
    };
    nav.lastRun = rec;
    try {
      const all = JSON.parse(localStorage.getItem(RUNS_KEY) || "[]");
      all.push(rec);
      localStorage.setItem(RUNS_KEY, JSON.stringify(all.slice(-20)));
    } catch (_) { /* хранилище недоступно */ }
  }
  function restartNav() {
    if (!nav) return;
    const speed = nav.speed;
    stopNav(true);
    startNav();
    if (nav) { nav.speed = speed; $("nav-speed").textContent = `${speed}×`; }
  }
  function stopNav(silent) {
    if (!nav) return;
    if (nav.phase !== "home" && nav.simT > 0) saveRun("ended early");
    nav = null;
    $("visor").hidden = true; $("nav-panel").hidden = true; $("plan-panel").hidden = false;
    document.querySelector(".mission-stage").classList.remove("nav-mode");
    mission.endNav();
    if (!silent) Zyro.post("Back to planning.", { mood: "smug" });
  }
  $("nav-play").addEventListener("click", () => {
    if (!nav) return;
    nav.playing = !nav.playing;
    $("nav-play").innerHTML = icon(nav.playing ? "pause" : "play");
    $("nav-play").setAttribute("aria-label", nav.playing ? "Pause" : "Play");
  });
  $("nav-speed").addEventListener("click", () => {
    if (!nav) return;
    nav.speed = SPEEDS[(SPEEDS.indexOf(nav.speed) + 1) % SPEEDS.length];
    $("nav-speed").textContent = `${nav.speed}×`;
  });
  $("nav-leak").addEventListener("click", () => {
    if (!nav || nav.phase === "home") return;
    nav.leak = nav.leak === 1 ? 4 : 1;
    ev("triangle-alert", nav.leak > 1 ? "Contingency test: suit leak, oxygen use ×4" : "Contingency cleared, oxygen use back to normal");
    $("nav-leak").setAttribute("aria-pressed", String(nav.leak > 1));
    Zyro.post(nav.leak > 1 ? "Contingency test: suit leak, oxygen use ×4. Watch the return margin." : "Leak cleared. Oxygen use is back to normal.",
      { mood: nav.leak > 1 ? "shock" : "smug", level: nav.leak > 1 ? "warn" : "" });
  });
  $("nav-back").addEventListener("click", () => {
    if (!nav || nav.phase === "back" || nav.phase === "home") return;
    const k = nav.phase === "out" ? (nav.k || 0) : nav.v.cells.length - 1;
    nav.aborted = true;
    nav.abortReason = $("return-check").dataset.state !== "ok" ? "oxygen margin" : "crew decision";
    beginBack(Math.max(1, k));
    Zyro.post("Turning back. I’ll guide you to the habitat.", { mood: "cool" });
  });
  $("nav-end").addEventListener("click", () => stopNav(false));
  $("nav-restart").addEventListener("click", restartNav);

  // ---------- Zyro: контекст для ИИ и готовые ответы ----------
  function context() {
    const ctx = { screen: currentTab };
    ctx.site_ranking = {
      profile: state.custom ? "custom" : profileObj().label,
      weights_pct: Object.fromEntries(PARAMS.map((p) => [p.id, Math.round(state.w[p.id] * 100)])),
      constraints: `|latitude| <= ${CONSTRAINTS.maxAbsLat} deg and elevation <= +${CONSTRAINTS.maxElevKm} km (${CONSTRAINTS.source})`,
      ranked: ranking.ok.slice(0, 6).map((r) => ({ rank: r.rank, site: r.s.name, index: Math.round(r.score), water_pct: Math.round(r.f.x.water * 100), ice: r.s.ice,
        sunlight_pct: Math.round(r.f.x.sunlight * 100), pressure_pa: Math.round(r.f.P), mola_p90_slope_deg: r.s.molaP90Deg, science_of_5: sciCount(r.s) })),
      excluded: ranking.out.map((r) => ({ site: r.s.name, reason: r.excluded.join("; ") })),
    };
    if (selectedSite) {
      const r = rowOf(selectedSite.id);
      ctx.selected_site = { name: selectedSite.name, rank: r.rank || null, index: Math.round(r.score), excluded: r.excluded,
        about: selectedSite.blurb, water_evidence: selectedSite.waterWhy, water_sources: selectedSite.waterSrc, safety_note: selectedSite.safetyWhy, nasa_data: selectedSite.data,
        air_like_earth_altitude_km: Math.round(earthAltitudeForPressure(r.f.P)), weather_station: STATIONS[selectedSite.id] || null,
        earth_weather_twin: EARTH_TWINS[selectedSite.id] || null, expedition: EXPEDITIONS[selectedSite.id] || null,
        photos: (PHOTOS[selectedSite.id] || []).map((p) => `${p.pia}: ${p.title}`) };
    }
    if (mission && mission.current) {
      const pt = (x) => x && { lat: x.latlng[0], lon: x.latlng[1] };
      ctx.selection = { start: pt(mission.start), target: pt(mission.current), region: { west: region.west, south: region.south, east: region.east, north: region.north, step: region.step } };
    }
    if (mission && mission.plan) {
      const p = mission.plan;
      ctx.marswalk = {
        region: region.name, landing_check: landing && { suitable: landing.suitable, criteria: landing.criteria, nearest_suitable: landing.nearest_suitable, source: landing.criteria_source },
        start: p.start.id === "habitat" ? `Habitat, ${region.landing.name}, ${region.name}` : `${p.start.name}, ${fmtCoord(p.start.latlng[0], p.start.latlng[1])}`,
        destination: p.target.name, destination_science: p.target.why,
        settings: { start_lmst: MarsClock.fmtHours(p.opts.startHour), max_slope_deg: p.opts.maxSlope, science_radius_m: p.opts.radiusM, suit_oxygen_h: p.opts.suitHours, dust_tau: p.opts.dustTau },
        // Route metrics are the backend's (DERIVED); the walk time, oxygen and verdict are the page's SIMULATED check.
        routes: p.variants.map((v) => ({ route: v.label, selected: v === mission.selected, km: +(v.sum.distance / 1000).toFixed(2), ascent_m: v.sum.ascent,
          max_slope_deg: v.sum.maxSlope, mean_hazard_risk: v.alt.hazard.mean_risk, high_hazard_cells: v.alt.hazard.high_cells, science_targets_nearby: v.alt.science_targets.length,
          why: v.alt.explanation, total_time: fmtDur(v.eva.totalS), oxygen_used_pct: Math.round(v.eva.o2Used * 100), verdict: v.eva.go ? "GO" : "NO GO" })),
        no_route: p.unreachable.map((u) => `${u.label}: ${u.alt.reason}`), route_cost_model: p.response.cost_model.formula, route_warnings: p.response.warnings,
        terrain_data: mission.terrain.meta.source,
      };
    }
    if (nav) ctx.navigation = { phase: nav.phase, instruction: $("vt-text").textContent, oxygen_left: $("ng-o2").textContent, return_margin: $("ng-margin").textContent,
      time_to_habitat: $("ng-home").textContent, daylight_left: $("ng-day").textContent, status: $("rc-text").textContent, suit_leak_test: nav.leak > 1 };
    return ctx;
  }
  function scripted(q, ctx) {
    const s = q.toLowerCase();
    if (/note|tip|совет/.test(s)) return { text: Zyro.TIPS[Math.floor(Math.random() * Zyro.TIPS.length)], mood: "smug" };
    const picked = ctx.marswalk && (ctx.marswalk.routes.find((r) => r.selected) || ctx.marswalk.routes[0]);
    if (/route|маршрут/.test(s)) {
      if (!ctx.marswalk) return { text: "Open the Marswalk tab, pick a start and a destination and press Calculate route.", mood: "smug" };
      const b = picked;
      if (!b) return { text: `No route. ${ctx.marswalk.no_route.join(" ")}`, mood: "shock" };
      return { text: `${b.route}: ${b.km} km, max slope ${b.max_slope_deg}°. ${b.why} Simulated walk check: ${b.total_time}, ${b.oxygen_used_pct}% of the oxygen tank, ${b.verdict}.`, mood: b.verdict === "GO" ? "cool" : "shock" };
    }
    if (/oxygen|o2|кислород/.test(s)) {
      if (ctx.navigation) return { text: `${ctx.navigation.status} Oxygen left ${ctx.navigation.oxygen_left}, margin ${ctx.navigation.return_margin}.`, mood: /Turn back/.test(ctx.navigation.status) ? "shock" : "cool" };
      if (picked) { const r = picked; return { text: `The selected route uses ${r.oxygen_used_pct}% of the ${ctx.marswalk.settings.suit_oxygen_h} h tank. The limit is 77%: a 30% margin on top of the walk, which is 23% of the tank.`, mood: "smug" }; }
      return { text: "Plan a route first and I’ll check it against the suit’s oxygen.", mood: "smug" };
    }
    if (/rank|why|почему|first|лучш/.test(s)) return { text: explain(ranking.ok[0], ranking.ok[1]), mood: "smug" };
    if (/weather|earth|погод|земл|twin/.test(s) && ctx.selected_site) {
      const t = ctx.selected_site.earth_weather_twin;
      return { text: `${ctx.selected_site.name}: the air is like Earth’s sky ${ctx.selected_site.air_like_earth_altitude_km} km up.${t ? ` Closest Earth twin: ${t.place}. ${t.why}` : ""}`, mood: "smug" };
    }
    // A site named in the question wins over the one that happens to be open on the globe.
    const named = SITES.find((x) => s.includes(x.id));
    if (named) return { text: `${named.name}: ${named.blurb} ${named.waterWhy}`, mood: "smug" };
    if (ctx.selected_site) return { text: `Free-form AI answers aren’t connected in this build. What I know about ${ctx.selected_site.name}: ${ctx.selected_site.about} ${ctx.selected_site.water_evidence}`, mood: "smug" };
    return { text: "Free-form AI answers aren’t connected in this build. Try the quick questions below.", mood: "smug" };
  }
  Zyro.init({ images: ASSETS.nova, getContext: context, scripted });
  Buddy.init({ images: ASSETS.nova, onFace: () => Zyro.open(), speak: (t, l) => Zyro.speak(t, l) });
  const quietBtn = $("zyro-quiet");
  const syncQuiet = () => { quietBtn.setAttribute("aria-pressed", String(!Buddy.quiet)); quietBtn.title = Buddy.quiet ? "Pop-up tips are off" : "Pop-up tips are on"; };
  syncQuiet();
  quietBtn.addEventListener("click", () => { Buddy.setQuiet(!Buddy.quiet); syncQuiet(); toast(Buddy.quiet ? "Zyro will stay in the chat." : "Zyro will pop up with tips again."); });

  // Экскурсия по платформе
  function startTour() {
    if (nav) stopNav(true);
    Buddy.tour([
      { before: () => showTab("overview"), el: () => document.querySelector(".globe-pins .pin.playable") || $("globe-stage"), mood: "cool",
        text: "This is Mars with 14 candidate sites. Each icon tells you what is there: snowflake for ice, drops for ancient water, a small robot badge where a NASA lander touched down." },
      { el: () => $("filters"), text: "Filter by theme. You can turn on several at once, for example Water ice + Human landing." },
      { el: () => $("layers-btn"), text: "Layers: names, landers, sites outside the limits, only sites with photos. The legend explains every icon." },
      { before: () => selectSite("jezero", false), el: () => document.querySelector(".brief"), mood: "smug",
        text: "My analysis of the selected site: strengths, risks, the closest rival and what I recommend doing next." },
      { el: () => document.querySelector(".twin") && document.querySelector(".twin").closest("section"), mood: "wink",
        text: "Weather twin: the same air pressure as Earth’s sky 33 km up, and nights as cold as Antarctica’s Vostok Station." },
      { before: () => showTab("compare"), el: () => $("podium"), mood: "smug",
        text: "Compare sites. Pick a mission profile or move the weights, and the ranking updates with a clear reason for every place." },
      { before: () => showTab("concept"), el: () => $("pipe"), mood: "wink",
        text: "Mission concept: the whole plan for Grass on Mars I, from site selection to the trip home, with budgets, science goals and expected results. Press Play and I’ll walk the pipeline." },
      { before: () => { showTab("mission"); }, el: () => $("variants"), mood: "cool",
        text: "The Marswalk tab. Pick a region and a landing point, and I plan up to three routes on NASA terrain: the shortest, the lowest terrain risk and the science route, each with a walk check." },
      { el: () => $("start-nav"), mood: "cool",
        text: "Press Start navigation to walk it: turn-by-turn, oxygen and a return check. You can even test a suit leak." },
      { before: () => showTab("overview"), el: () => $("zyro-btn"), mood: "wink",
        text: "That’s it. Ask me anything here, and I’ll keep popping up with tips. You can turn the pop-ups off in the chat.",
        done: () => Zyro.post("Tour finished. Ask me anything about the sites or the walk.", { mood: "wink" }) },
    ]);
  }
  window.startTour = startTour;

  // Факты, которыми Zyro делится в простое
  const FUN = [
    ...Object.entries(EARTH_TWINS).filter(([id]) => SITES.find((x) => x.id === id)).map(([id, t]) => ({ id, text: `${SITES.find((x) => x.id === id).name} has an Earth twin: ${t.place}. ${t.why}` })),
    ...Object.entries(EXPEDITIONS).map(([id, e]) => ({ id, text: `${e.mission}: ${e.results[0]}.` })),
    ...Zyro.TIPS.map((t) => ({ id: null, text: t })),
  ];
  let idleAt = Date.now(), funI = Math.floor(Math.random() * FUN.length);
  ["pointerdown", "keydown", "wheel"].forEach((ev) => document.addEventListener(ev, () => { idleAt = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (!$("intro").hidden || nav || Date.now() - idleAt < 40000 || !$("zyro").hidden) return;
    const f = FUN[funI++ % FUN.length];
    const acts = f.id ? [{ label: "Show me", icon: "map-pin", primary: true, onClick: () => { showTab("overview"); selectSite(f.id, true); } }] : [];
    acts.push({ label: "Tell me more", icon: "message-circle", onClick: () => { Zyro.open(); Zyro.ask(`Tell me more: ${f.text}`); } });
    if (Buddy.say(f.text, { auto: true, tag: "Did you know?", mood: ["wink", "cool", "smug"][funI % 3], actions: acts })) idleAt = Date.now();
  }, 5000);

  // ---------- Усиление под номинации: история, 3D, открытка, открытые данные, языки ----------
  ext = Extras.init({
    ranking: () => ranking, PARAMS, state, icon, icons, toast, fmtKm, fmtDur,
    mission: () => mission, enterMission, showTab, selectSite, region: () => region, planJezero,
    profileLabel: () => (state.custom ? "custom" : profileObj().label),
    maxSlope: () => (mission && mission.plan ? mission.plan.opts.maxSlope : 15),
    setProfile: (id) => { if (state.custom || state.profile !== id) { const b = document.querySelector(`#profile-seg [data-p="${id}"]`); if (b) b.click(); } },
    stopNav: () => { if (nav) stopNav(true); },
    currentTab: () => currentTab,
  });

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-goto]");
    if (!a) return;
    e.preventDefault();
    showTab(a.dataset.goto);
  });

  Method.init({ ranking: () => ranking, PARAMS, state });

  // ---------- Старт ----------
  icons();
  tickClock();
  setInterval(tickClock, 10000);
  renderKpis();
  selectSite("jezero", false);
  Zyro.post("Hi, I’m Zyro. Pick any site on the globe and I’ll explain how it scores and why. Jezero has a full Marswalk plan.", { mood: "cool", tip: Zyro.TIPS[1] });
  const start = (location.hash || "").replace("#", "");
  if (TABS.includes(start)) { $("intro").hidden = true; showTab(start); }
  window.addEventListener("hashchange", () => { const h = location.hash.replace("#", ""); if (TABS.includes(h)) showTab(h); });
})();
