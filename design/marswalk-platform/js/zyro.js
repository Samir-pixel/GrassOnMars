// Zyro — персонаж и ИИ-ассистент миссии. Все реплики и ответы живут в одной панели чата.
// На claude.ai отвечает через Claude (capability "sample"), в любой другой копии сайта —
// готовыми ответами по данным приложения.
(function (root) {
  const $ = (id) => document.getElementById(id);
  const NAME = "Zyro";

  const TIPS = [
    "Martian soil contains perchlorates, salts that are toxic to people (found by Phoenix in 2008). Wash any water melted from soil before use.",
    "Water ice is water, oxygen and rocket fuel: electrolysis splits it into hydrogen and oxygen.",
    "Surface pressure is under 1% of Earth’s. Without a pressure suit, body fluids would start to boil.",
    "Curiosity’s RAD measured about 0.67 mSv per day on the surface. Plan short walks and long shelter.",
    "Global dust storms can block the Sun for weeks. In 2018 one ended the Opportunity rover’s mission.",
    "A sol is 24 h 39 min. Walk in daylight: nights at Jezero fall far below −70 °C.",
    "Gravity is 38% of Earth’s, but gear keeps its full mass, so stopping and turning still take effort.",
  ];

  let ctxFn = () => ({});
  let scriptFn = () => ({ text: "" });
  let sample = null, tts = null, voiceOn = true, aiOff = false; // голос включён по умолчанию; звучит после первого нажатия пользователя
  try { if (localStorage.getItem("zyro-mute") === "1") voiceOn = false; } catch (_) { /* хранилище недоступно */ }
  let imgs = {};
  let unread = 0;
  const history = [];

  function setMood(mood) {
    const src = imgs[mood] || imgs.smug;
    for (const el of document.querySelectorAll("[data-zyro-face]")) el.src = src;
  }

  function isOpen() { return !$("zyro").hidden; }

  function addMsg(who, text, opts = {}) {
    const li = document.createElement("li");
    li.className = `msg msg-${who === "me" ? "me" : "bot"}${opts.level ? " " + opts.level : ""}`;
    const p = document.createElement("p");
    p.textContent = text;
    li.appendChild(p);
    if (opts.tip) {
      const tip = document.createElement("div");
      tip.className = "tip";
      tip.innerHTML = `${root.icon("lightbulb")}<div><b>Survival note</b><p></p></div>`;
      tip.querySelector("p").textContent = opts.tip;
      li.appendChild(tip);
    }
    const log = $("zyro-log");
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
    history.push({ who, text });
    if (history.length > 14) history.shift();
    return p;
  }

  function bumpUnread() {
    if (isOpen()) return;
    unread += 1;
    const dot = $("zyro-unread");
    dot.textContent = unread > 9 ? "9+" : String(unread);
    dot.hidden = false;
  }

  // Голос Zyro: всегда английский, мужской, ниже обычного и с «инопланетным» эффектом —
  // короткий сигнал связи до и после фразы и тихий низкий гул, пока он говорит.
  // Основной путь — системный синтезатор речи (там можно задать тембр и выбрать мужской голос);
  // голоса Claude — только запасной вариант, если в браузере нет английского голоса.
  let voiceName = "";
  let browserVoices = [];
  const PREFERRED = [
    /Microsoft (Guy|Andrew|Brian|Christopher|Eric|Roger|Davis|Steffan|Ryan|Thomas).*Natural/i,
    /Google UK English Male/i,
    /\b(Daniel|Arthur|Aaron|Alex|Gordon|Rishi|Oliver|Tom|Fred|Reed|Rocko|Ralph|David|Mark|George|James|Guy|Ryan|Thomas)\b/i,
    /\bmale\b/i,
  ];
  const FEMALE = /\b(female|woman|samantha|victoria|karen|zira|susan|kate|serena|moira|tessa|fiona|allison|ava|aria|jenny|emma|libby|sonia|natasha|michelle|ana|clara|joanna|salli|kimberly|ivy|kendra|amy|nicole|olivia|google us english|google uk english female)\b/i;
  const isEn = (v) => /^en/i.test(v.lang);
  function maleEnglishVoices() {
    const en = browserVoices.filter((v) => isEn(v) && !FEMALE.test(v.name));
    const ranked = [];
    PREFERRED.forEach((re) => en.forEach((v) => { if (re.test(v.name) && !ranked.includes(v)) ranked.push(v); }));
    return ranked;
  }
  function pickBrowserVoice() {
    const chosen = browserVoices.find((v) => v.name === voiceName);
    if (chosen) return chosen;
    return maleEnglishVoices()[0] || browserVoices.find((v) => isEn(v) && !FEMALE.test(v.name)) || browserVoices.find(isEn) || null;
  }

  // Звуки связи (Web Audio): трель «инопланетного» передатчика и низкий гул
  let ac = null, hum = null;
  function audio() {
    if (!ac) { const A = root.AudioContext || root.webkitAudioContext; if (A) ac = new A(); }
    if (ac && ac.state === "suspended") ac.resume();
    return ac;
  }
  function chirp(up) {
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + 0.01;
    const o = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain(), g = a.createGain();
    o.type = "sine"; lfo.type = "sine"; lfo.frequency.value = 34; lg.gain.value = 70;
    lfo.connect(lg); lg.connect(o.frequency); o.connect(g); g.connect(a.destination);
    o.frequency.setValueAtTime(up ? 640 : 1180, t0);
    o.frequency.exponentialRampToValueAtTime(up ? 1180 : 520, t0 + 0.22);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
    o.start(t0); lfo.start(t0); o.stop(t0 + 0.28); lfo.stop(t0 + 0.28);
  }
  function humOn() {
    const a = audio(); if (!a || hum) return;
    const o = a.createOscillator(), trem = a.createOscillator(), tg = a.createGain(), g = a.createGain();
    o.type = "sine"; o.frequency.value = 58;
    trem.frequency.value = 5.5; tg.gain.value = 0.012;
    trem.connect(tg); tg.connect(g.gain); g.gain.value = 0.02;
    o.connect(g); g.connect(a.destination);
    o.start(); trem.start();
    hum = { stop() { const t = a.currentTime; g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.08); o.stop(t + 0.4); trem.stop(t + 0.4); } };
  }
  function humOff() { if (hum) { hum.stop(); hum = null; } }

  // Сообщаем интерфейсу, что происходит с голосом: start / word / tick / pause / resume / end.
  // «word» приходит от самого синтезатора речи (событие boundary) — по нему работает эквалайзер.
  function emit(state, extra) { root.dispatchEvent(new CustomEvent("zyro-speech", { detail: { state, ...(extra || {}) } })); }
  let speechSeq = 0, paused = false, ttsSubs = null;
  function speak(text) {
    if (!voiceOn) return Promise.resolve(false);
    const clean = text.replace(/[\u{1F300}-\u{1FAFF}]/gu, "");
    const seq = ++speechSeq;
    paused = false;
    const v = root.speechSynthesis ? pickBrowserVoice() : null;
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return; finished = true;
        humOff();
        if (seq === speechSeq) { chirp(false); paused = false; emit("end"); }
        resolve(true);
      };
      if (v) {
        root.speechSynthesis.cancel();
        humOff();
        const u = new SpeechSynthesisUtterance(clean);
        u.voice = v; u.lang = v.lang;
        u.pitch = 0.88;  // мужской, но светлее и бодрее
        u.rate = 1.08;   // живой, энергичный темп
        u.onstart = () => { humOn(); emit("start", { text: clean, source: "browser" }); };
        u.onboundary = (e) => {
          if (seq !== speechSeq || (e.name && e.name !== "word")) return;
          const len = e.charLength || (clean.slice(e.charIndex).match(/^\S+/) || [""])[0].length;
          emit("word", { index: e.charIndex, length: len, word: clean.substr(e.charIndex, len), total: clean.length });
        };
        u.onpause = () => { if (seq === speechSeq) emit("pause"); };
        u.onresume = () => { if (seq === speechSeq) emit("resume"); };
        u.onend = u.onerror = done;
        chirp(true);
        setTimeout(() => { if (seq === speechSeq) root.speechSynthesis.speak(u); else resolve(false); }, 200);
        // страховка: некоторые браузеры не присылают onend
        const guard = () => {
          if (finished || seq !== speechSeq) return;
          if (!root.speechSynthesis.speaking && !root.speechSynthesis.pending) done(); else setTimeout(guard, 1000);
        };
        setTimeout(guard, 2500);
        return;
      }
      if (tts) {
        chirp(true); humOn(); emit("start", { text: clean, source: "claude" });
        if (ttsSubs) ttsSubs.forEach((f) => f && f());
        ttsSubs = [
          tts.onPosition && tts.onPosition((e) => { if (seq === speechSeq) emit("tick", { ms: e.ms }); }),
          tts.onState && tts.onState((e) => {
            if (seq !== speechSeq) return;
            if (e.state === "paused") emit("pause");
            else if (e.state === "speaking" && paused) emit("resume");
          }),
        ];
        tts.speak(clean, { voice: voiceName || "rounded", language: "en", rate: 1.08 }).then(done).catch(done);
        return;
      }
      resolve(false);
    });
  }
  function pauseSpeaking() {
    if (paused) return;
    paused = true;
    humOff();
    if (root.speechSynthesis && root.speechSynthesis.speaking) root.speechSynthesis.pause();
    else if (tts) tts.pause().catch(() => {});
    emit("pause");
  }
  function resumeSpeaking() {
    if (!paused) return;
    paused = false;
    humOn();
    if (root.speechSynthesis && root.speechSynthesis.paused) root.speechSynthesis.resume();
    else if (tts) tts.resume().catch(() => {});
    emit("resume");
  }
  function stopSpeaking() {
    speechSeq++;
    paused = false;
    humOff();
    if (root.speechSynthesis) root.speechSynthesis.cancel();
    if (tts) tts.stop();
    emit("end");
  }
  function setVoice(on) {
    voiceOn = !!on && !!(tts || root.speechSynthesis);
    try { localStorage.setItem("zyro-mute", voiceOn ? "0" : "1"); } catch (_) { /* хранилище недоступно */ }
    const btn = $("zyro-voice");
    if (btn) btn.setAttribute("aria-pressed", String(voiceOn));
    if (!voiceOn) stopSpeaking();
    root.dispatchEvent(new CustomEvent("zyro-voice", { detail: { on: voiceOn } }));
  }
  function setupVoiceUi(options, def) {
    const sel = $("zyro-voice-name");
    const btn = $("zyro-voice");
    sel.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
    voiceName = def;
    sel.value = def;
    sel.hidden = false;
    btn.hidden = false;
    sel.addEventListener("change", () => { voiceName = sel.value; if (voiceOn) speak("Zyro here. Greetings from Jezero crater."); });
    btn.setAttribute("aria-pressed", String(voiceOn));
    btn.addEventListener("click", () => {
      setVoice(!voiceOn);
      if (voiceOn) speak("Voice on! I’ll read everything aloud for you.");
    });
  }

  // Реплика Zyro по ходу работы (рекомендации, предупреждения) — только в ленте чата
  function post(text, opts = {}) {
    setMood(opts.mood || "smug");
    addMsg("zyro", text, opts);
    bumpUnread();
    if (opts.level === "warn") $("zyro-btn").classList.add("alert");
    // Предупреждения Zyro говорит прямо на экране
    if (opts.level === "warn" && root.Buddy) root.Buddy.say(text, { mood: "shock", level: "warn", tag: "Heads up", speak: false });
    speak(text);
  }

  function open() {
    $("zyro").hidden = false;
    $("zyro-btn").setAttribute("aria-expanded", "true");
    $("zyro-btn").classList.remove("alert");
    unread = 0;
    $("zyro-unread").hidden = true;
    const log = $("zyro-log");
    log.scrollTop = log.scrollHeight;
  }
  function close() {
    $("zyro").hidden = true;
    $("zyro-btn").setAttribute("aria-expanded", "false");
  }

  async function ask(question) {
    open();
    addMsg("me", question);
    const ctx = ctxFn();
    if (!sample || aiOff) {
      const ans = scriptFn(question, ctx);
      const p = addMsg("zyro", "…");
      setTimeout(() => { setMood(ans.mood || "smug"); p.textContent = ans.text; speak(ans.text); $("zyro-log").scrollTop = $("zyro-log").scrollHeight; }, 300);
      return;
    }
    const p = addMsg("zyro", "Thinking…");
    p.parentElement.classList.add("thinking");
    const transcript = history.slice(-9, -2).map((h) => `${h.who === "me" ? "User" : NAME}: ${h.text}`).join("\n");
    const prompt = `You are ${NAME}, the mission assistant inside "Marswalk", a decision-support platform for choosing work sites on Mars and planning safe walks (Marswalks) with NASA data. Built by team Grass on Mars (Dushanbe) for NASA Space Apps 2026, challenge "Interplanetary Survival Guide: Martian Map".
Tone: friendly, calm, precise, like a good mission controller. 1 to 4 short sentences, under 80 words. Plain text, no markdown, no emojis.
Rules: be scientifically accurate. Use ONLY numbers in CONTEXT; if something is not there, say you don't know. When asked why something ranks higher, cite the parameters and weights from CONTEXT. Safety first: if CONTEXT shows NO GO, a negative return margin or low oxygen, say so and give the safe action. Always reply in English, even if the user writes in another language.

CONTEXT (what the user sees now, JSON):
${JSON.stringify(ctx)}

Recent conversation:
${transcript || "(none)"}

User: ${question}
${NAME}:`;
    try {
      const { text } = await sample(prompt, {
        modelTier: "quick", cache: false,
        onText: ({ text }) => { p.textContent = text; p.parentElement.classList.remove("thinking"); $("zyro-log").scrollTop = $("zyro-log").scrollHeight; },
      });
      p.textContent = text.trim();
      p.parentElement.classList.remove("thinking");
      history[history.length - 1].text = text.trim();
      speak(text);
    } catch (e) {
      p.parentElement.classList.remove("thinking");
      if (e && e.code === "not_granted") aiOff = true;
      p.textContent = (e && e.text) || scriptFn(question, ctx).text;
    }
    $("zyro-log").scrollTop = $("zyro-log").scrollHeight;
  }

  async function init({ images, getContext, scripted }) {
    imgs = images; ctxFn = getContext; scriptFn = scripted;
    setMood("smug");
    $("zyro-btn").addEventListener("click", () => (isOpen() ? close() : open()));
    $("zyro-close").addEventListener("click", close);
    $("zyro-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("zyro-input").value.trim();
      if (!q) return;
      $("zyro-input").value = "";
      ask(q);
    });
    $("zyro-chips").addEventListener("click", (e) => {
      const c = e.target.closest("button");
      if (c) ask(c.dataset.q);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });

    if (root.claude && typeof root.claude.use === "function") {
      try { sample = await root.claude.use("sample"); } catch (_) { sample = null; }
      if (sample) $("zyro-mode").textContent = "Mission assistant, AI by Claude";
      try { tts = await root.claude.use("tts"); } catch (_) { tts = null; }
    }
    // Список голосов: сначала английские мужские голоса браузера
    const load = () => {
      if (!root.speechSynthesis) return false;
      browserVoices = root.speechSynthesis.getVoices();
      const list = maleEnglishVoices().slice(0, 8);
      if (!list.length || $("zyro-voice-name").options.length) return !!list.length;
      setupVoiceUi(list.map((v) => ({ value: v.name, label: v.name.replace(/^Microsoft |Online \(Natural\) - .*$/g, "").trim() })), list[0].name);
      return true;
    };
    if (!load() && root.speechSynthesis && root.speechSynthesis.addEventListener) {
      root.speechSynthesis.addEventListener("voiceschanged", () => { if (!$("zyro-voice-name").options.length && !load() && tts) setupVoiceUi([{ value: "rounded", label: "Zyro" }], "rounded"); });
    }
    setTimeout(() => { if (!$("zyro-voice-name").options.length && tts) setupVoiceUi([{ value: "rounded", label: "Zyro" }], "rounded"); }, 1500);
  }

  root.Zyro = { init, post, ask, open, close, setMood, speak: (t) => speak(t), stopSpeaking: () => stopSpeaking(), pauseSpeaking: () => pauseSpeaking(), resumeSpeaking: () => resumeSpeaking(), get paused() { return paused; }, setVoice: (on) => setVoice(on), get voiceOn() { return voiceOn; }, TIPS, NAME };
})(window);
