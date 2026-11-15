// Глобус Марса на three.js с HTML-метками точек. Если WebGL нет — плоская карта.
(function (root) {
  const DEG = Math.PI / 180;

  // Та же формула, что у THREE.SphereGeometry, чтобы метки совпадали с текстурой
  function lonLatToVec(lon, lat, r) {
    const phi = ((lon + 180) / 360) * 2 * Math.PI;
    const theta = (90 - lat) * DEG;
    return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
  }

  function pinButton(site, onSelect) {
    const b = document.createElement("button");
    b.type = "button";
    const kind = site.kind || "site";
    b.className = `pin pin-${kind}` + (site.playable ? " playable" : "");
    b.dataset.id = site.id;
    const sub = kind === "mission" ? `<small>${site.year}</small>` : site.lander ? `<small class="lander">${site.lander.name}</small>` : "";
    const badge = site.lander ? `<span class="pin-badge" title="${site.lander.name} landed here">${window.icon(site.lander.icon)}</span>` : "";
    b.innerHTML = `<span class="pin-ico" aria-hidden="true">${window.icon(site.icon || "map-pin")}${badge}</span><span class="pin-label">${site.name}${sub}</span>`;
    b.setAttribute("aria-label", kind === "mission" ? `${site.name} landing site, ${site.year}` : site.name);
    b.addEventListener("click", (e) => { e.stopPropagation(); onSelect(site.id, kind); });
    return b;
  }

    function starColor(k) {
    // Приближение цвета абсолютно чёрного тела (Tanner Helland), смягчённое к белому
    const t = Math.max(2000, Math.min(30000, k)) / 100;
    let r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
    let g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
    let b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
    const mix = (x) => (Math.max(0, Math.min(255, x)) * 0.55 + 255 * 0.45) / 255;
    return [mix(r), mix(g), mix(b)];
  }

  function buildStars() {
    const S = window.STARS;
    if (!S || typeof THREE === "undefined") return null;
    const bin = atob(S.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dv = new DataView(bytes.buffer);
    const nCat = S.count, nDust = 26000, n = nCat + nDust, R = 150;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), bright = new Float32Array(n);
    for (let i = 0; i < nCat; i++) {
      const o = i * 8;
      const ra = dv.getUint16(o, true) / 100 * Math.PI / 180;
      const de = dv.getInt16(o + 2, true) / 100 * Math.PI / 180;
      const mag = dv.getInt16(o + 4, true) / 100;
      const k = dv.getUint16(o + 6, true) * 10;
      pos[i * 3] = R * Math.cos(de) * Math.cos(ra);
      pos[i * 3 + 1] = R * Math.sin(de);
      pos[i * 3 + 2] = -R * Math.cos(de) * Math.sin(ra);
      const c = starColor(k);
      col.set(c, i * 3);
      // Поток света ~ 10^(−0.4·m): яркие звёзды крупнее, слабые — тонкие точки
      const flux = Math.pow(10, -0.4 * (mag - 1));
      size[i] = Math.max(2.0, Math.min(9, 2.2 + 2.8 * Math.sqrt(flux)));
      bright[i] = Math.max(0.45, Math.min(1, 0.5 + 0.8 * Math.sqrt(flux)));
    }
    // Слабые звёзды фона гуще у плоскости Галактики — получается мягкий Млечный Путь
    const ngpRa = 192.86 * Math.PI / 180, ngpDe = 27.13 * Math.PI / 180;
    const pole = [Math.cos(ngpDe) * Math.cos(ngpRa), Math.sin(ngpDe), -Math.cos(ngpDe) * Math.sin(ngpRa)];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = nCat; i < n;) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      const x = rr * Math.cos(th), y = u, z = rr * Math.sin(th);
      const sinB = Math.abs(x * pole[0] + y * pole[1] + z * pole[2]);
      if (rnd() > 0.18 + 0.82 * Math.exp(-sinB / 0.16)) continue;
      pos[i * 3] = x * R; pos[i * 3 + 1] = y * R; pos[i * 3 + 2] = z * R;
      const warm = rnd();
      col.set(warm < 0.5 ? [0.86, 0.9, 1] : [1, 0.94, 0.86], i * 3);
      size[i] = 1.4 + rnd() * 1.0;
      bright[i] = 0.18 + Math.pow(rnd(), 3) * 0.5;
      i++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1));
    g.setAttribute("bright", new THREE.BufferAttribute(bright, 1));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { dpr: { value: dpr } },
      vertexShader: `
        attribute float size; attribute float bright; attribute vec3 color;
        varying vec3 vColor; varying float vBright; uniform float dpr;
        void main() {
          vColor = color; vBright = bright;
          gl_PointSize = size * dpr;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vBright;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p) * 2.0;
          float core = smoothstep(1.0, 0.15, d);
          float halo = exp(-d * d * 3.0) * 0.35;
          float a = min(1.0, core * 0.9 + halo) * vBright;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    const pts = new THREE.Points(g, m);
    pts.renderOrder = -1;
    pts.frustumCulled = false;
    return pts;
  }

  function createGlobe(stage, { textureUrl, normalUrl, sites, onSelect }) {
    const canvasWrap = stage.querySelector(".globe-canvas");
    const pinLayer = stage.querySelector(".globe-pins");
    const flat = stage.querySelector(".flat-map");
    const flatPins = flat.querySelector(".flat-pins");
    flat.querySelector("img").src = textureUrl;

    const pins = new Map();
    const flatPinEls = new Map();
    for (const s of sites) {
      const p = pinButton(s, onSelect);
      pinLayer.appendChild(p);
      pins.set(s.id, p);
      const f = pinButton(s, onSelect);
      f.style.left = `${((s.lon + 180) / 360) * 100}%`;
      f.style.top = `${((90 - s.lat) / 180) * 100}%`;
      flatPins.appendChild(f);
      flatPinEls.set(s.id, f);
    }

    let gl = null;
    try {
      const test = document.createElement("canvas");
      gl = test.getContext("webgl") || test.getContext("experimental-webgl");
    } catch (_) { gl = null; }

    const api = {
      mode: "3d",
      select(id) {
        for (const [k, el] of pins) el.classList.toggle("active", k === id);
        for (const [k, el] of flatPinEls) el.classList.toggle("active", k === id);
        const s = sites.find((x) => x.id === id);
        if (s && api.flyTo) api.flyTo(s);
      },
      filter(ids) {
        for (const [k, el] of pins) el.classList.toggle("dim", !ids.has(k));
        for (const [k, el] of flatPinEls) el.classList.toggle("dim", !ids.has(k));
      },
      mark(cls, ids) {
        for (const [k, el] of pins) el.classList.toggle(cls, ids.has(k));
        for (const [k, el] of flatPinEls) el.classList.toggle(cls, ids.has(k));
      },
      setMode(mode) {
        api.mode = gl ? mode : "2d";
        stage.dataset.mode = api.mode;
      },
      zoom: () => {},
      zoomTo: () => {},
      hasWebGL: !!gl,
    };

    if (!gl || typeof THREE === "undefined") {
      api.setMode("2d");
      return api;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    canvasWrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    // Расстояние камеры подбирается так, чтобы планета целиком влезала в кадр
    let fitDist = 4.4, zoomK = 1;
    const camDist = () => fitDist * zoomK;
    camera.position.set(0, 0, fitDist);

    // Звёздное небо: 9 096 настоящих звёзд из каталога BSC5, цвет по температуре, размер по яркости
    const stars = buildStars();
    const skyScene = new THREE.Scene();
    const skyCam = new THREE.PerspectiveCamera(62, 1, 1, 400);
    if (stars) skyScene.add(stars);
    renderer.autoClear = false;
    let spinAcc = 0;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff1e0, 0.95);
    sun.position.set(-3, 1.5, 3);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9fd8c4, 0.25);
    rim.position.set(3, -1, -2);
    scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    const tex = new THREE.TextureLoader().load(textureUrl);
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 160, 120),
      // текстура же как карта рельефа: тёмные низины и светлые возвышенности дают объём
      new THREE.MeshPhongMaterial({ map: tex, shininess: 5, specular: 0x1a1a1a })
    );
    group.add(sphere);
    // Карта нормалей даёт чёткий рельеф: кратеры, вулканы, каньоны
    if (normalUrl) {
      new THREE.TextureLoader().load(normalUrl, (n) => {
        n.anisotropy = tex.anisotropy;
        sphere.material.normalMap = n;
        sphere.material.normalScale = new THREE.Vector2(1.1, 1.1);
        sphere.material.needsUpdate = true;
      });
    }

    // Атмосфера: светящийся ободок (френель), не вращается вместе с планетой
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.06, 64, 48),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
        uniforms: { color: { value: new THREE.Color(0xe08a5e) } },
        vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: "uniform vec3 color; varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(color, 1.0) * i; }",
      })
    );
    scene.add(atmo);

    const anchors = new Map(sites.map((s) => [s.id, lonLatToVec(s.lon, s.lat, 1.01)]));

    // Вращение: target — куда плавно поворачиваем, rot — текущее
    const rot = { x: 0.3, y: 0 };
    const target = { x: 0.3, y: 0 };
    let dragging = false, last = null, idleSince = performance.now(), autoSpin = true;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const el = renderer.domElement;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", (e) => {
      dragging = true; last = [e.clientX, e.clientY]; autoSpin = false;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const k = 0.005 * zoomK;
      target.y += (e.clientX - last[0]) * k;
      target.x = Math.max(-1.3, Math.min(1.3, target.x + (e.clientY - last[1]) * k));
      last = [e.clientX, e.clientY];
    });
    const end = () => { dragging = false; idleSince = performance.now(); };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      api.zoom(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    api.zoom = (dir) => {
      zoomK = Math.max(0.5, Math.min(1.3, zoomK + dir * 0.1));
    };
    api.zoomTo = (k) => { zoomK = k; };

    api.flyTo = (s) => {
      autoSpin = false;
      const phi = ((s.lon + 180) / 360) * 2 * Math.PI;
      let ty = Math.PI / 2 - phi;
      // кратчайший поворот
      while (ty - target.y > Math.PI) ty -= 2 * Math.PI;
      while (ty - target.y < -Math.PI) ty += 2 * Math.PI;
      target.y = ty;
      target.x = Math.max(-1.3, Math.min(1.3, s.lat * DEG));
      idleSince = performance.now();
    };

    function resize() {
      const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      skyCam.aspect = w / h;
      skyCam.updateProjectionMatrix();
      const half = Math.tan((camera.fov / 2) * DEG);
      fitDist = 1.42 / (half * Math.min(1, camera.aspect));
    }
    new ResizeObserver(resize).observe(canvasWrap);
    resize();

    const v = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    function frame(now) {
      if (stage.dataset.mode === "3d" && !document.hidden && stage.offsetParent !== null) {
        if (!dragging && !autoSpin && now - idleSince > 8000 && !reduceMotion) autoSpin = true;
        if (autoSpin && !reduceMotion) { target.y += 0.0015; spinAcc += 0.0015; }
        rot.x += (target.x - rot.x) * 0.08;
        rot.y += (target.y - rot.y) * 0.08;
        group.rotation.set(rot.x, rot.y, 0);
        // небо поворачивается вместе с жестами пользователя (как при облёте), но не от вращения планеты
        if (stars) stars.rotation.set(rot.x * 0.6, (rot.y - spinAcc) * 0.6, 0);
        camera.position.z += (camDist() - camera.position.z) * 0.1;
        renderer.clear();
        if (stars) renderer.render(skyScene, skyCam);
        renderer.clearDepth();
        renderer.render(scene, camera);

        const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
        camPos.copy(camera.position);
        for (const [id, local] of anchors) {
          v.copy(local).applyEuler(group.rotation);
          const facing = v.clone().normalize().dot(camPos.clone().sub(v).normalize());
          v.project(camera);
          const pin = pins.get(id);
          const visible = facing > 0.12;
          pin.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
          pin.style.opacity = visible ? Math.min(1, (facing - 0.12) * 5) : 0;
          pin.style.pointerEvents = visible ? "auto" : "none";
          pin.tabIndex = visible ? 0 : -1;
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    api.setMode("3d");
    return api;
  }

  root.createGlobe = createGlobe;
})(window);
