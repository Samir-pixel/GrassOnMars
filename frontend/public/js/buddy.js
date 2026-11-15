// Zyro на экране: всплывает с репликами, подсказывает следующий шаг и проводит экскурсию.
(function (root) {
  const $ = (id) => document.getElementById(id);
  let imgs = {}, onFace = () => {}, speakFn = () => {};
  let hideTimer = null, typeTimer = null, blinkTimer = null;
  let lastAuto = 0, dismissedAt = 0, touring = false, hovering = false;
  let quiet = false;
  try { quiet = localStorage.getItem("zyro-quiet") === "1"; } catch (_) { /* хранилище недоступно */ }
  const reduceMotion = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let currentText = "", speakingMine = false;
  function setVoiceBtn(on) {
    const b = $("buddy-voice");
    if (!b) return;
    b.innerHTML = root.icon(on ? "volume-x" : "volume-2");
    b.setAttribute("aria-label", on ? "Stop reading" : "Read aloud");
    b.classList.toggle("on", on);
  }
  function setFace(mood) { $("buddy-img").src = imgs[mood] || imgs.smug; }

  function blinkLoop(mood) {
    clearTimeout(blinkTimer);
    if (reduceMotion) return;
    blinkTimer = setTimeout(() => {
      setFace("wink");
      setTimeout(() => setFace(mood), 220);
      blinkLoop(mood);
    }, 2600 + Math.random() * 2600);
  }

  function typeText(text) {
    const p = $("buddy-text");
    clearInterval(typeTimer);
    const box = $("buddy");
    if (reduceMotion) { p.textContent = text; return; }
    box.classList.add("talking");
    p.textContent = "";
    const t0 = performance.now(), cps = 70; // символов в секунду, по реальному времени
    typeTimer = setInterval(() => {
      const i = Math.min(text.length, Math.round((performance.now() - t0) / 1000 * cps));
      p.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(typeTimer); box.classList.remove("talking"); }
    }, 30);
  }

  function place(anchor) {
    const box = $("buddy");
    box.classList.toggle("anchored", !!anchor);
    if (!anchor) { box.style.left = box.style.top = ""; return; }
    const r = anchor.getBoundingClientRect();
    const W = root.innerWidth, H = root.innerHeight;
    const bw = Math.min(380, W - 24), bh = box.offsetHeight || 170;
    let left = r.right + 14, top = r.top;
    if (left + bw > W - 12) left = r.left - bw - 14;           // слева от элемента
    if (left < 12) { left = Math.max(12, Math.min(W - bw - 12, r.left)); top = r.bottom + 12; } // под элементом
    if (top + bh > H - 12) top = Math.max(12, r.top - bh - 12);  // над элементом
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(Math.max(12, Math.min(H - bh - 12, top)))}px`;
  }

  function spotlight(el) {
    const s = $("spot");
    if (!el) { s.hidden = true; return; }
    const r = el.getBoundingClientRect();
    s.hidden = false;
    Object.assign(s.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
  }

  function hide() {
    clearTimeout(hideTimer); clearInterval(typeTimer); clearTimeout(blinkTimer);
    const box = $("buddy");
    if (box.hidden) return;
    box.classList.add("leaving");
    setTimeout(() => { box.hidden = true; box.classList.remove("leaving", "anchored", "warn"); }, reduceMotion ? 0 : 260);
    spotlight(null);
  }

  // say(text, {mood, tag, actions, auto, level, anchor, duration, spot})
  function say(text, o = {}) {
    if (o.auto) {
      const now = Date.now();
      if (quiet || touring || now - lastAuto < 18000 || now - dismissedAt < 45000) return false;
      lastAuto = now;
    }
    if (touring && !o.tour) return false;
    const box = $("buddy");
    clearTimeout(hideTimer);
    setFace(o.mood || "smug");
    blinkLoop(o.mood || "smug");
    $("buddy-tag").textContent = o.tag || "Zyro";
    box.classList.toggle("warn", o.level === "warn");
    const acts = $("buddy-actions");
    acts.innerHTML = "";
    (o.actions || []).forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `buddy-btn${a.primary ? " primary" : ""}`;
      b.innerHTML = `${a.icon ? root.icon(a.icon) : ""}${a.label}`;
      b.addEventListener("click", (e) => { e.stopPropagation(); if (!a.keep) hide(); a.onClick && a.onClick(); });
      acts.appendChild(b);
    });
    box.hidden = false;
    box.classList.remove("leaving");
    box.classList.remove("pop"); void box.offsetWidth; box.classList.add("pop");
    typeText(text);
    requestAnimationFrame(() => { place(o.anchor || null); spotlight(o.spot ? o.anchor : null); });
    // Голос — только по кнопке динамика (или в режиме истории, который пользователь включил сам)
    currentText = text;
    setVoiceBtn(false);
    if (o.autoSpeak) { speakingMine = true; setVoiceBtn(true); Promise.resolve(speakFn(text, o.lang)).then(() => { speakingMine = false; setVoiceBtn(false); }); }
    const dur = o.duration === 0 ? 0 : (o.duration || Math.min(16000, 4500 + text.length * 45));
    if (dur) {
      const tick = () => { if (hovering) hideTimer = setTimeout(tick, 1500); else hide(); };
      hideTimer = setTimeout(tick, dur);
    }
    return true;
  }

  // Экскурсия: шаги с подсветкой элементов. opt.auto — сама листает (режим истории)
  let autoTimer = null, paused = false;
  function stopTour() { touring = false; clearTimeout(autoTimer); paused = false; }
  function tour(steps, i = 0, opt = {}) {
    clearTimeout(autoTimer);
    touring = true;
    const st = steps[i];
    if (!st) { stopTour(); hide(); opt.onEnd && opt.onEnd(); return; }
    if (st.before) st.before();
    setTimeout(() => {
      const el = st.el ? st.el() : null;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
      setTimeout(() => {
        const actions = [];
        const next = () => tour(steps, i + 1, opt);
        if (opt.auto) {
          actions.push({ label: paused ? "Play" : "Pause", icon: paused ? "play" : "pause", keep: true, onClick: () => {
            paused = !paused;
            if (paused) clearTimeout(autoTimer); else next();
            const b = $("buddy-actions").firstChild;
            if (b) b.innerHTML = `${root.icon(paused ? "play" : "pause")}${paused ? "Play" : "Pause"}`;
          } });
          actions.push({ label: `Next ${i + 1}/${steps.length}`, primary: true, keep: true, onClick: () => { paused = false; next(); } });
        } else {
          if (i > 0) actions.push({ label: "Back", icon: "arrow-left", keep: true, onClick: () => tour(steps, i - 1, opt) });
          actions.push(i < steps.length - 1
            ? { label: `Next ${i + 1}/${steps.length}`, primary: true, keep: true, onClick: next }
            : { label: "Finish", primary: true, onClick: () => { stopTour(); st.done && st.done(); } });
        }
        actions.push({ label: opt.auto ? "Stop" : "Skip", onClick: () => { stopTour(); opt.onEnd && opt.onEnd(); } });
        const text = typeof st.text === "function" ? st.text() : st.text;
        say(text, { autoSpeak: !!opt.auto, tour: true, mood: st.mood || "cool", tag: st.tag || `${opt.label || "Tour"} ${i + 1} of ${steps.length}`, anchor: el, spot: !!el, actions, duration: 0, lang: opt.lang });
        if (opt.auto && !paused) {
          const ms = st.ms || Math.max(6500, 1800 + text.length * 62);
          autoTimer = setTimeout(() => { if (!paused && touring) { if (i === steps.length - 1) { st.done && st.done(); } next(); } }, ms);
        }
      }, el ? 380 : 0);
    }, st.before ? (st.wait || 450) : 0);
  }

  function init(opts) {
    imgs = opts.images; onFace = opts.onFace || onFace; speakFn = opts.speak || speakFn;
    $("buddy-face").addEventListener("click", () => { hide(); onFace(); });
    $("buddy-voice").addEventListener("click", (e) => {
      e.stopPropagation();
      if (speakingMine) { speakingMine = false; setVoiceBtn(false); if (root.Zyro) root.Zyro.stopSpeaking(); return; }
      if (!root.Zyro || !currentText) return;
      if (!root.Zyro.voiceOn) root.Zyro.setVoice(true);
      speakingMine = true; setVoiceBtn(true);
      Promise.resolve(root.Zyro.speak(currentText)).then(() => { speakingMine = false; setVoiceBtn(false); });
    });
    $("buddy-x").addEventListener("click", () => { dismissedAt = Date.now(); stopTour(); hide(); });
    const box = $("buddy");
    box.addEventListener("mouseenter", () => { hovering = true; });
    box.addEventListener("mouseleave", () => { hovering = false; });
    root.addEventListener("resize", () => { if (!box.hidden && touring && !autoTimer) hide(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) { stopTour(); hide(); } });
  }

  function setQuiet(v) {
    quiet = v;
    try { localStorage.setItem("zyro-quiet", v ? "1" : "0"); } catch (_) { /* хранилище недоступно */ }
  }

  root.Buddy = { init, say, hide, tour, setQuiet, get quiet() { return quiet; }, get touring() { return touring; } };
})(window);
