// 3D view of the open region: the backend elevation grid, its relief picture on top, the route as a tube.
(function (root) {
  let view = null;

  function open(box, { terrain: t, imageUrl, route, habitat, target, exaggeration = 3 }) {
    if (typeof THREE === "undefined") return false;
    close();
    const canvasHost = document.createElement("div");
    canvasHost.className = "t3d-canvas";
    box.prepend(canvasHost);
    const W = box.clientWidth, H = box.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    canvasHost.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0c10);
    scene.fog = new THREE.Fog(0x0b0c10, 30, 70);
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.05, 200);

    // Размеры в километрах
    const b = t.bounds;
    const midLat = (b.north + b.south) / 2 * Math.PI / 180;
    const KM_PER_DEG = 59.27;
    // The scene (fog, camera, pins) is sized for the 17 km Jezero window; a 59 km MOLA window is shrunk to fit, relief included.
    const S = Math.min(1, 17 / ((b.north - b.south) * KM_PER_DEG));
    const wKm = (b.east - b.west) * KM_PER_DEG * Math.cos(midLat) * S;
    const hKm = (b.north - b.south) * KM_PER_DEG * S;
    let min = Infinity, max = -Infinity;
    for (const v of t.elev) { if (v < min) min = v; if (v > max) max = v; }

    const geo = new THREE.PlaneGeometry(wKm, hKm, t.cols - 1, t.rows - 1);
    const pos = geo.attributes.position;
    let k = exaggeration;
    const zOf = (e) => ((Number.isNaN(e) ? min : e) - min) / 1000 * k * S; // NoData cells lie flat at the lowest level
    function shapeMesh() {
      for (let i = 0; i < t.rows * t.cols; i++) pos.setZ(i, zOf(t.elev[i]));
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }
    shapeMesh();
    const tex = new THREE.TextureLoader().load(imageUrl);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
    mesh.rotation.x = -Math.PI / 2;
    const world = new THREE.Group();
    world.add(mesh);
    scene.add(world);

    scene.add(new THREE.HemisphereLight(0xfff1e0, 0x2a1e18, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.05);
    sun.position.set(-20, 18, 12); // низкое солнце с запада подчёркивает рельеф
    scene.add(sun);

    // Координаты точки на сетке → 3D (с учётом поворота плоскости)
    function toXYZ(lat, lng, lift = 0.03) {
      const x = ((lng - b.west) / (b.east - b.west) - 0.5) * wKm;
      const y = ((lat - b.south) / (b.north - b.south) - 0.5) * hKm;
      const r = Math.round((b.north - lat) / (b.north - b.south) * (t.rows - 1));
      const c = Math.round((lng - b.west) / (b.east - b.west) * (t.cols - 1));
      const e = t.elev[Math.max(0, Math.min(t.rows - 1, r)) * t.cols + Math.max(0, Math.min(t.cols - 1, c))];
      return new THREE.Vector3(x, zOf(e) + lift, -y);
    }
    const overlay = new THREE.Group();
    world.add(overlay);
    function buildOverlay() {
      overlay.children.slice().forEach((o) => { overlay.remove(o); o.traverse((x) => { if (x.geometry) x.geometry.dispose(); }); });
      const pin = (latlng, color) => {
        const p = toXYZ(latlng[0], latlng[1], 0);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 8), new THREE.MeshBasicMaterial({ color }));
        stem.position.set(p.x, p.y + 0.14, p.z);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshBasicMaterial({ color }));
        head.position.set(p.x, p.y + 0.3, p.z);
        overlay.add(stem, head);
      };
      if (route && route.length > 1) {
        const pts = route.map(([la, ln]) => toXYZ(la, ln, 0.012));
        const curve = new THREE.CatmullRomCurve3(pts);
        overlay.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(900, pts.length * 5), 0.016, 8, false),
          new THREE.MeshBasicMaterial({ color: 0xcfe26a })));
      }
      if (habitat) pin(habitat, 0xf3f2ee);
      if (target) pin(target, 0xcfe26a);
    }
    buildOverlay();

    // Центр обзора — середина маршрута или района
    let span = 3;
    if (route && route.length > 1) {
      const a = toXYZ(...route[0], 0), z = toXYZ(...route[route.length - 1], 0);
      span = Math.max(1.5, Math.hypot(a.x - z.x, a.z - z.z));
    }
    const focusPt = () => (route && route.length ? toXYZ(...route[Math.floor(route.length / 2)], 0) : new THREE.Vector3(0, 0, 0));
    let focus = focusPt();
    let az = -0.6, el = 0.55, dist = Math.max(3.5, span * 1.9);
    function setEx(v) { k = v; shapeMesh(); buildOverlay(); focus = focusPt(); }
    function place() {
      const f = focus;
      camera.position.set(f.x + dist * Math.cos(el) * Math.sin(az), f.y + dist * Math.sin(el), f.z + dist * Math.cos(el) * Math.cos(az));
      camera.lookAt(f);
    }

    let drag = null, auto = true, raf = 0, running = true;
    const el0 = renderer.domElement;
    el0.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; auto = false; el0.setPointerCapture(e.pointerId); });
    el0.addEventListener("pointermove", (e) => {
      if (!drag) return;
      az -= (e.clientX - drag.x) * 0.006;
      el = Math.max(0.12, Math.min(1.45, el + (e.clientY - drag.y) * 0.005));
      drag = { x: e.clientX, y: e.clientY };
    });
    el0.addEventListener("pointerup", () => { drag = null; });
    el0.addEventListener("wheel", (e) => { e.preventDefault(); dist = Math.max(2, Math.min(40, dist * (e.deltaY > 0 ? 1.1 : 0.9))); auto = false; }, { passive: false });

    const reduce = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function loop() {
      if (auto && !reduce) az += 0.0016;
      place();
      renderer.render(scene, camera);
      if (running) raf = requestAnimationFrame(loop);
    }
    loop();
    const onResize = () => {
      const w = box.clientWidth, h = box.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    root.addEventListener("resize", onResize);
    view = { renderer, stop: () => { running = false; cancelAnimationFrame(raf); }, onResize, canvasHost, setEx, geo, tex };
    return true;
  }

  function close() {
    if (!view) return;
    view.stop();
    root.removeEventListener("resize", view.onResize);
    view.renderer.dispose(); view.geo.dispose(); view.tex.dispose();
    view.canvasHost.remove();
    view = null;
  }

  root.Terrain3D = { open, close, setExaggeration: (k) => view && view.setEx(k) };
})(window);
