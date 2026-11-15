// Detailed procedural rover models (meters, Y up, forward = +X, lateral = Z).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- seeded random ----------
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
export const reseed = s => { seed = s; };

// ---------- procedural textures ----------
function canvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }

function heightToNormal(hc, strength) {
  const n = hc.width, src = hc.getContext('2d').getImageData(0, 0, n, n).data;
  const out = canvas(n), ctx = out.getContext('2d'), img = ctx.createImageData(n, n);
  const h = (x, y) => src[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    img.data[i] = (-dx / len * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return out;
}

function tex(c, repeat, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.anisotropy = 8; t.userData.mimeType = 'image/jpeg'; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// painted composite panels with seams, rivets, grime; tile = 2 m
function panelTextures(base, seamsDark = 0.3) {
  const n = 1024, col = canvas(n), hgt = canvas(n);
  const c = col.getContext('2d'), h = hgt.getContext('2d');
  c.fillStyle = base; c.fillRect(0, 0, n, n);
  h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  // fine noise / grime
  const id = c.getImageData(0, 0, n, n);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = (rnd() - 0.5) * 6;
    id.data[i] += v; id.data[i + 1] += v; id.data[i + 2] += v;
  }
  c.putImageData(id, 0, 0);
  for (let k = 0; k < 90; k++) { // soft smudges
    const x = rnd() * n, y = rnd() * n, r = 10 + rnd() * 60;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,105,75,${0.015 + rnd() * 0.025})`); g.addColorStop(1, 'rgba(120,80,55,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // panel layout
  const rows = [0, 330, 640, 1024], cols = [[0, 400, 820], [0, 260, 700], [0, 500, 900]];
  c.strokeStyle = `rgba(40,40,40,${seamsDark})`; c.lineWidth = 2;
  h.strokeStyle = '#2a2a2a'; h.lineWidth = 5;
  const line = (x0, y0, x1, y1) => { for (const g of [c, h]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); } };
  rows.forEach(y => line(0, y, n, y));
  for (let r = 0; r < 3; r++) cols[r].forEach(x => line(x, rows[r], x, rows[r + 1]));
  // rivets along seams
  c.fillStyle = 'rgba(90,90,90,0.35)'; h.fillStyle = '#c0c0c0';
  for (let r = 0; r < 3; r++) for (let x = 12; x < n; x += 48) {
    for (const y of [rows[r] + 10]) { c.beginPath(); c.arc(x, y, 2.5, 0, 7); c.fill(); h.beginPath(); h.arc(x, y, 3, 0, 7); h.fill(); }
  }
  // a few hatches / access panels
  for (const [x, y, w, hh] of [[90, 420, 180, 120], [600, 120, 140, 90], [720, 760, 200, 150]]) {
    c.strokeRect(x, y, w, hh); h.strokeRect(x, y, w, hh);
  }
  return { map: tex(col, 0.5, true), normalMap: tex(heightToNormal(hgt, 6), 0.5, false) };
}

function noiseNormal(scale = 1, strength = 3, blobs = 900) {
  const n = 512, hc = canvas(n), h = hc.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  for (let k = 0; k < blobs; k++) {
    const x = rnd() * n, y = rnd() * n, r = 2 + rnd() * 14, v = rnd() > 0.5 ? 255 : 0;
    const g = h.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${v},${v},${v},0.25)`); g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    h.fillStyle = g; h.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  return tex(heightToNormal(hc, strength), scale, false);
}

function solarTexture() {
  const n = 1024, c = canvas(n), g = c.getContext('2d');
  g.fillStyle = '#c9ccd2'; g.fillRect(0, 0, n, n);
  const cells = 16, s = n / cells;
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const gr = g.createLinearGradient(i * s, j * s, i * s + s, j * s + s);
    gr.addColorStop(0, '#1a2550'); gr.addColorStop(1, '#0d1638');
    g.fillStyle = gr; g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
    g.strokeStyle = 'rgba(180,190,220,0.35)'; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(i * s + 3, j * s + k * s / 4); g.lineTo(i * s + s - 3, j * s + k * s / 4); g.stroke(); }
  }
  return tex(c, 1, true);
}

function ventTexture() {
  const n = 256, c = canvas(n), g = c.getContext('2d');
  g.fillStyle = '#2b2d30'; g.fillRect(0, 0, n, n);
  for (let y = 8; y < n; y += 16) { g.fillStyle = '#0c0c0e'; g.fillRect(10, y, n - 20, 7); }
  return tex(c, 1, true);
}

// ---------- materials ----------
export function makeMaterials() {
  const hull = panelTextures('#e8e7e2');
  const lab = panelTextures('#dedbd3', 0.45);
  const m = {
    paint: new THREE.MeshStandardMaterial({ name: 'white_paint', map: hull.map, normalMap: hull.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.48, metalness: 0.05, vertexColors: true }),
    paint2: new THREE.MeshStandardMaterial({ name: 'lab_paint', map: lab.map, normalMap: lab.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.55, metalness: 0.05, vertexColors: true }),
    black: new THREE.MeshStandardMaterial({ name: 'composite_black', color: 0x1b1d20, roughness: 0.62, metalness: 0.15, normalMap: noiseNormal(2, 2), vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ name: 'brushed_metal', color: 0x9aa0a8, roughness: 0.32, metalness: 0.9, vertexColors: true }),
    darkMetal: new THREE.MeshStandardMaterial({ name: 'dark_metal', color: 0x3c4046, roughness: 0.42, metalness: 0.85, vertexColors: true }),
    rubber: new THREE.MeshStandardMaterial({ name: 'tire_rubber', color: 0x1c1c1d, roughness: 0.93, metalness: 0, normalMap: noiseNormal(3, 3), vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ name: 'glass', color: 0x7d93a6, roughness: 0.05, metalness: 1.0, vertexColors: true }),
    blue: new THREE.MeshStandardMaterial({ name: 'accent_blue', color: 0x1e5cc8, roughness: 0.3, metalness: 0.35, vertexColors: true }),
    orange: new THREE.MeshStandardMaterial({ name: 'safety_orange', color: 0xe8701f, roughness: 0.45, metalness: 0.1, vertexColors: true }),
    gold: new THREE.MeshStandardMaterial({ name: 'gold_foil', color: 0xd9a743, roughness: 0.28, metalness: 1, normalMap: noiseNormal(1.5, 8, 1600), vertexColors: true }),
    fabric: new THREE.MeshStandardMaterial({ name: 'seat_fabric', color: 0x2c2f35, roughness: 0.95, metalness: 0, normalMap: noiseNormal(4, 2), vertexColors: true }),
    solar: new THREE.MeshStandardMaterial({ name: 'solar_cells', map: solarTexture(), roughness: 0.18, metalness: 0.6, vertexColors: true }),
    vent: new THREE.MeshStandardMaterial({ name: 'vent', map: ventTexture(), roughness: 0.7, metalness: 0.3, vertexColors: true }),
    lamp: new THREE.MeshStandardMaterial({ name: 'led_white', color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 2.5, roughness: 0.2 }),
    lampBlue: new THREE.MeshStandardMaterial({ name: 'led_blue', color: 0x9fd0ff, emissive: 0x3aa0ff, emissiveIntensity: 2.2, roughness: 0.2 }),
    lampRed: new THREE.MeshStandardMaterial({ name: 'led_red', color: 0xff5a4a, emissive: 0xff2010, emissiveIntensity: 2.0, roughness: 0.2 }),
    screen: new THREE.MeshStandardMaterial({ name: 'screen', color: 0x0a1a2a, emissive: 0x1b6fa8, emissiveIntensity: 0.8, roughness: 0.1 }),
  };
  m.dish = new THREE.MeshStandardMaterial({ name: 'dish', color: 0xe4e2dc, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide, vertexColors: true }); m.dish.userData.dust = 0.1;
  // dust strength per material (how much regolith settles near the ground)
  m.paint.userData.dust = 0.75; m.paint2.userData.dust = 0.75; m.black.userData.dust = 0.6;
  m.metal.userData.dust = 0.5; m.darkMetal.userData.dust = 0.6; m.rubber.userData.dust = 1.0;
  m.glass.userData.dust = 0.25; m.blue.userData.dust = 0.4; m.orange.userData.dust = 0.4;
  m.gold.userData.dust = 0.3; m.fabric.userData.dust = 0.2; m.solar.userData.dust = 0.15; m.vent.userData.dust = 0.4;
  return m;
}

// ---------- geometry helpers ----------
function mesh(geo, mat, parent, name) { const o = new THREE.Mesh(geo, mat); o.name = name || mat.name; o.castShadow = o.receiveShadow = true; parent.add(o); return o; }

function rbox(w, h, d, r, mat, parent, pos, name) {
  const o = mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), mat, parent, name);
  if (pos) o.position.set(...pos); return o;
}

// side profile (x forward, y up) extruded across the width (z), with rounded bevel
function profile(pts, width, bevel, mat, parent, name, zc = 0) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 5, curveSegments: 12 });
  g.translate(0, 0, -depth / 2 + zc);
  return mesh(g, mat, parent, name);
}

function tube(a, b, r, mat, parent, name) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const o = mesh(new THREE.CylinderGeometry(r, r, len, 16), mat, parent, name);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return o;
}

function curveTube(points, r, mat, parent, name) {
  const c = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(new THREE.TubeGeometry(c, 48, r, 12, false), mat, parent, name);
}

function cyl(r, h, mat, parent, pos, axis = 'y', name, seg = 32) {
  const o = mesh(new THREE.CylinderGeometry(r, r, h, seg), mat, parent, name);
  if (axis === 'z') o.rotation.x = Math.PI / 2; if (axis === 'x') o.rotation.z = Math.PI / 2;
  o.position.set(...pos); return o;
}

// detailed wheel: rounded tire with chevron tread, spoked rim, hub, lug nuts. Axis = Z.
export function wheel(M, r, w, opts = {}) {
  const g = new THREE.Group(); g.name = 'wheel';
  const rin = r * (opts.rimRatio || 0.62);
  // tire cross-section lathe (rounded rectangle), lathe axis Y -> rotate to Z
  const pts = [], cr = Math.min(w * 0.28, (r - rin) * 0.45);
  const hw = w / 2;
  pts.push(new THREE.Vector2(rin, -hw * 0.92));
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI / 2; pts.push(new THREE.Vector2(r - cr + Math.cos(a) * cr, -hw + cr + Math.sin(a) * cr)); }
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; pts.push(new THREE.Vector2(r - cr + Math.cos(a) * cr, hw - cr + Math.sin(a) * cr)); }
  pts.push(new THREE.Vector2(rin, hw * 0.92));
  const tg = new THREE.LatheGeometry(pts, 72); tg.rotateX(Math.PI / 2);
  mesh(tg, M.rubber, g, 'tire');
  // chevron tread blocks merged into one geometry
  const blocks = [], N = opts.lugs || Math.round(2 * Math.PI * r / 0.11);
  const bh = (r - rin) * 0.16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.045 * (r / 0.5) + 0.02, bh, w * 0.46);
      b.rotateX(side * 0.5); // chevron angle
      b.translate(0, r + bh * 0.25, side * w * 0.22);
      b.rotateZ(a + side * 0.04);
      blocks.push(b);
    }
  }
  mesh(mergeGeometries(blocks), M.rubber, g, 'tread');
  // rim
  const rim = new THREE.CylinderGeometry(rin, rin, w * 0.82, 48, 1, true); rim.rotateX(Math.PI / 2);
  mesh(rim, M.darkMetal, g, 'rim_barrel');
  for (const z of [-1, 1]) {
    const face = new THREE.RingGeometry(rin * 0.3, rin * 1.0, 48); if (z < 0) face.rotateY(Math.PI);
    face.translate(0, 0, z * w * 0.33);
    mesh(face, M.metal, g, 'rim_face');
  }
  const sp = [];
  const spokes = opts.spokes || 6;
  for (let i = 0; i < spokes; i++) {
    const b = new THREE.BoxGeometry(rin * 0.75, rin * 0.16, w * 0.1);
    b.translate(rin * 0.55, 0, w * 0.4); b.rotateZ((i / spokes) * Math.PI * 2);
    sp.push(b);
  }
  mesh(mergeGeometries(sp), M.metal, g, 'spokes');
  cyl(rin * 0.3, w * 0.9, M.darkMetal, g, [0, 0, 0], 'z', 'hub');
  cyl(rin * 0.16, w * 0.98, M.metal, g, [0, 0, 0], 'z', 'hub_cap');
  const nuts = [];
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, b = new THREE.CylinderGeometry(rin * 0.04, rin * 0.04, 0.03, 6); b.rotateX(Math.PI / 2); b.translate(Math.cos(a) * rin * 0.22, Math.sin(a) * rin * 0.22, w * 0.47); nuts.push(b); }
  mesh(mergeGeometries(nuts), M.metal, g, 'lug_nuts');
  return g;
}

function placeWheel(M, parent, r, w, x, z, steer = 0, opts) {
  const wh = wheel(M, r, w, opts); wh.position.set(x, r, z);
  if (z < 0) wh.rotation.y = Math.PI; // outer face out
  wh.rotation.y += steer; parent.add(wh); return wh;
}

// fender arch over a wheel (extruded half-ring)
function fender(M, parent, x, z, r, w, mat) {
  const s = new THREE.Shape();
  const R = r + 0.12, T = 0.09;
  s.absarc(0, 0, R + T, Math.PI * 0.05, Math.PI * 0.95, false);
  s.absarc(0, 0, R, Math.PI * 0.95, Math.PI * 0.05, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: w + 0.12, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 24 });
  g.translate(0, 0, -(w + 0.12) / 2);
  const o = mesh(g, mat || M.black, parent, 'fender'); o.position.set(x, r, z); return o;
}

// regolith dust: darken/tint vertex colors near the ground
export function applyDust(root, dustColor = new THREE.Color(0.72, 0.47, 0.31)) {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3(), white = new THREE.Color(1, 1, 1), c = new THREE.Color();
  root.traverse(o => {
    if (!o.isMesh || !o.material.vertexColors) return;
    const k = o.material.userData.dust ?? 0.5;
    const pos = o.geometry.attributes.position, cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const t = THREE.MathUtils.smoothstep(v.y, 0.0, 1.6);
      const n = Math.sin(v.x * 7.3 + v.z * 3.1) * Math.sin(v.x * 2.1 - v.y * 5.7) * 0.5 + 0.5; // streaks
      const a = k * (1 - t) * (0.55 + 0.45 * n);
      c.copy(white).lerp(dustColor, a);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    o.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  });
}

// EVA suit docked on a suitport: PLSS backpack + helmet dome hint
function dockedSuit(M, parent, x, z, y) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  rbox(0.32, 0.85, 0.62, 0.08, M.paint2, g, [-0.18, 0, 0], 'plss_backpack');
  rbox(0.08, 0.6, 0.5, 0.03, M.black, g, [-0.36, 0.0, 0], 'plss_cover');
  rbox(0.1, 0.12, 0.4, 0.03, M.orange, g, [-0.36, 0.33, 0], 'plss_handle');
  cyl(0.05, 0.25, M.metal, g, [-0.25, -0.5, 0.18], 'y', 'plss_port');
  cyl(0.05, 0.25, M.metal, g, [-0.25, -0.5, -0.18], 'y', 'plss_port');
  return g;
}

// ---------- vehicles ----------
export function buildMRV(M) {
  const root = new THREE.Group(); root.name = 'NASA_MRV';
  const r = 0.4, w = 0.3, tz = 0.98;
  // chassis tub
  profile([[-1.75, 0.38], [1.7, 0.38], [1.93, 0.52], [1.9, 0.72], [1.25, 0.86], [-1.62, 0.86], [-1.8, 0.66]], 1.52, 0.05, M.paint, root, 'body_tub');
  profile([[-1.7, 0.33], [1.65, 0.33], [1.8, 0.45], [-1.75, 0.45]], 1.42, 0.03, M.black, root, 'belly_pan');
  // nose fairing
  profile([[1.05, 0.86], [1.88, 0.74], [1.97, 0.6], [1.98, 0.7], [1.5, 1.04], [1.0, 1.12]], 1.32, 0.06, M.paint, root, 'nose_fairing');
  rbox(0.04, 0.05, 1.0, 0.02, M.lamp, root, [1.97, 0.66, 0], 'headlight_bar');
  // side skirts with accent
  for (const s of [-1, 1]) {
    rbox(2.0, 0.16, 0.06, 0.02, M.black, root, [0.0, 0.55, s * 0.77], 'side_skirt');
    rbox(1.6, 0.025, 0.02, 0.008, M.lampBlue, root, [0.0, 0.66, s * 0.8], 'side_led');
  }
  // e-corners: wheel + kingpin housing + motor pod + A-arms
  for (const x of [1.25, -1.25]) for (const s of [-1, 1]) {
    const steer = x > 0 ? 0.22 : -0.08;
    placeWheel(M, root, r, w, x, s * tz, steer, { spokes: 5 });
    cyl(0.12, 0.42, M.darkMetal, root, [x, r + 0.28, s * (tz - 0.2)], 'y', 'kingpin_housing');
    cyl(0.15, 0.16, M.paint, root, [x, r + 0.5, s * (tz - 0.2)], 'y', 'motor_cap');
    tube([x - 0.18, r + 0.1, s * (tz - 0.2)], [x - 0.25, 0.5, s * 0.62], 0.035, M.metal, root, 'a_arm');
    tube([x + 0.18, r + 0.1, s * (tz - 0.2)], [x + 0.25, 0.5, s * 0.62], 0.035, M.metal, root, 'a_arm');
    tube([x, r + 0.45, s * (tz - 0.2)], [x, 0.82, s * 0.62], 0.03, M.metal, root, 'upper_arm');
  }
  // seats (bucket) side by side
  for (const z of [0.34, -0.34]) {
    rbox(0.52, 0.12, 0.48, 0.05, M.fabric, root, [0.02, 0.98, z], 'seat_base');
    const back = rbox(0.12, 0.66, 0.48, 0.05, M.fabric, root, [-0.27, 1.32, z], 'seat_back'); back.rotation.z = 0.18;
    rbox(0.1, 0.16, 0.3, 0.05, M.fabric, root, [-0.36, 1.74, z], 'headrest').rotation.z = 0.18;
    for (const s of [-1, 1]) rbox(0.4, 0.14, 0.05, 0.02, M.fabric, root, [0.0, 1.07, z + s * 0.24], 'bolster');
    tube([-0.2, 1.05, z + 0.18], [-0.3, 1.6, z - 0.15], 0.012, M.orange, root, 'harness');
  }
  // dash, screens, drive-by-wire stick
  rbox(0.3, 0.32, 1.22, 0.06, M.black, root, [0.72, 1.05, 0], 'dash');
  const scr = rbox(0.02, 0.2, 0.42, 0.01, M.screen, root, [0.62, 1.2, 0.0], 'screen'); scr.rotation.z = -0.4;
  cyl(0.025, 0.24, M.black, root, [0.46, 1.12, 0.34], 'y', 'joystick');
  cyl(0.04, 0.06, M.orange, root, [0.46, 1.26, 0.34], 'y', 'joystick_top');
  // roll hoop
  for (const z of [0.72, -0.72]) curveTube([[-0.55, 0.86, z], [-0.55, 1.6, z], [-0.5, 1.9, z * 0.9]], 0.035, M.metal, root, 'roll_hoop');
  curveTube([[-0.5, 1.9, 0.65], [-0.48, 1.97, 0], [-0.5, 1.9, -0.65]], 0.035, M.metal, root, 'roll_hoop_top');
  cyl(0.05, 0.08, M.lamp, root, [-0.48, 1.98, 0.3], 'y', 'roof_lamp');
  // rear battery pack + vents + tail lights
  rbox(0.75, 0.4, 1.32, 0.06, M.paint2, root, [-1.2, 1.05, 0], 'battery_pack');
  rbox(0.02, 0.24, 0.9, 0.01, M.vent, root, [-1.58, 1.05, 0], 'battery_vent');
  for (const s of [-1, 1]) rbox(0.03, 0.06, 0.22, 0.01, M.lampRed, root, [-1.82, 0.66, s * 0.55], 'tail_light');
  // camera mast
  tube([0.85, 1.2, -0.55], [0.85, 1.65, -0.55], 0.02, M.metal, root, 'cam_mast');
  rbox(0.1, 0.08, 0.16, 0.02, M.black, root, [0.87, 1.7, -0.55], 'nav_camera');
  applyDust(root);
  return root;
}

export function buildSEV(M) {
  const root = new THREE.Group(); root.name = 'NASA_SEV';
  const r = 0.43, w = 0.3, tz = 1.22;
  // chassis frame
  rbox(4.3, 0.28, 1.5, 0.06, M.darkMetal, root, [0, 0.95, 0], 'chassis');
  rbox(4.0, 0.08, 1.9, 0.03, M.black, root, [0, 1.12, 0], 'deck');
  // 6 pivoting bogies x 2 wheels = 12 wheels
  for (const x of [1.65, 0, -1.65]) for (const s of [-1, 1]) {
    const b = new THREE.Group(); b.position.set(x, 0, s * tz); root.add(b);
    placeWheel(M, b, r, w, 0.31, 0, x > 0 ? 0.12 : 0, { spokes: 6 });
    placeWheel(M, b, r, w, -0.31, 0, x > 0 ? 0.12 : 0, { spokes: 6 });
    rbox(0.95, 0.16, 0.12, 0.04, M.darkMetal, b, [0, r, -s * 0.2], 'bogie_beam');
    cyl(0.1, 0.28, M.darkMetal, b, [0, r + 0.22, -s * 0.25], 'y', 'bogie_pivot');
    tube([0, r + 0.3, -s * 0.25], [0, 0.95, -s * 0.55], 0.05, M.metal, b, 'bogie_strut');
    cyl(0.04, 0.4, M.orange, b, [0, r + 0.32, -s * 0.12], 'y', 'damper');
  }
  // pressurized cabin
  profile([[-2.2, 1.18], [2.0, 1.18], [2.42, 1.55], [2.45, 2.35], [2.12, 3.0], [-2.2, 3.0]], 2.5, 0.14, M.paint, root, 'cabin');
  rbox(4.5, 0.12, 2.56, 0.05, M.gold, root, [0.05, 1.3, 0], 'mmod_band');
  // front window panes (vertical + slanted) with mullions
  const paneZ = [-0.72, 0, 0.72];
  for (const z of paneZ) {
    rbox(0.04, 0.62, 0.62, 0.03, M.glass, root, [2.47, 1.98, z], 'front_window_low');
    const top = rbox(0.04, 0.62, 0.62, 0.03, M.glass, root, [2.31, 2.69, z], 'front_window_top');
    top.rotation.z = Math.atan2(0.33, 0.65);
  }
  for (const z of [-1.08, -0.36, 0.36, 1.08]) {
    rbox(0.06, 0.74, 0.06, 0.02, M.black, root, [2.48, 1.98, z], 'mullion');
    const t = rbox(0.06, 0.74, 0.06, 0.02, M.black, root, [2.32, 2.69, z], 'mullion'); t.rotation.z = Math.atan2(0.33, 0.65);
  }
  // lower "foot" windows to see the ground ahead
  for (const z of [-0.45, 0.45]) { const p = rbox(0.04, 0.3, 0.5, 0.03, M.glass, root, [2.3, 1.45, z], 'foot_window'); p.rotation.z = 0.75; }
  // side windows + side hatch
  for (const s of [-1, 1]) {
    rbox(0.7, 0.42, 0.04, 0.05, M.glass, root, [1.55, 2.5, s * 1.25], 'side_window');
    rbox(1.0, 1.25, 0.05, 0.08, M.paint2, root, [-0.2, 2.05, s * 1.25], 'side_hatch');
    rbox(0.3, 0.05, 0.08, 0.02, M.orange, root, [-0.2, 2.1, s * 1.29], 'hatch_handle');
    // grab rails
    curveTube([[0.6, 2.85, s * 1.27], [-0.2, 2.9, s * 1.29], [-1.6, 2.85, s * 1.27]], 0.025, M.gold, root, 'handrail');
  }
  // rear bulkhead with 2 suitports + docked suits + porch
  rbox(0.12, 1.6, 2.2, 0.06, M.paint2, root, [-2.28, 2.05, 0], 'aft_bulkhead');
  for (const z of [0.55, -0.55]) {
    cyl(0.42, 0.08, M.darkMetal, root, [-2.36, 2.05, z], 'x', 'suitport_ring');
    cyl(0.34, 0.1, M.black, root, [-2.37, 2.05, z], 'x', 'suitport_hatch');
    dockedSuit(M, root, -2.4, z, 2.05);
  }
  rbox(0.75, 0.06, 2.0, 0.02, M.darkMetal, root, [-2.75, 1.18, 0], 'porch');
  for (const z of [-0.98, 0.98]) curveTube([[-2.4, 1.2, z], [-3.05, 1.25, z], [-3.1, 1.9, z]], 0.025, M.metal, root, 'porch_rail');
  // roof: radiators, mast with stereo cameras, light bars, antenna
  rbox(2.4, 0.06, 1.9, 0.02, M.solar, root, [-0.85, 3.06, 0], 'roof_array');
  for (const z of [-0.98, 0.98]) rbox(2.5, 0.08, 0.04, 0.01, M.metal, root, [-0.85, 3.08, z], 'array_frame');
  tube([1.2, 3.0, 0.7], [1.2, 3.75, 0.7], 0.035, M.metal, root, 'mast');
  rbox(0.14, 0.14, 0.5, 0.03, M.paint2, root, [1.22, 3.82, 0.7], 'camera_head');
  for (const z of [0.53, 0.87]) cyl(0.04, 0.05, M.glass, root, [1.3, 3.82, z], 'x', 'camera_lens');
  rbox(0.08, 0.06, 1.6, 0.02, M.lamp, root, [2.15, 3.03, 0], 'roof_lightbar');
  cyl(0.02, 0.6, M.metal, root, [0.4, 3.3, -0.8], 'y', 'whip_antenna');
  const dish = new THREE.LatheGeometry(Array.from({ length: 12 }, (_, i) => new THREE.Vector2(i * 0.022, (i * 0.022) ** 2 * 1.4)), 32);
  const d = mesh(dish, M.dish, root, 'hga_dish'); d.position.set(-0.2, 3.35, -0.75); d.rotation.z = -0.6;
  tube([-0.2, 3.06, -0.75], [-0.2, 3.35, -0.75], 0.03, M.metal, root, 'dish_post');
  for (const s of [-1, 1]) rbox(0.04, 0.1, 0.32, 0.02, M.lamp, root, [2.44, 1.45, s * 0.95], 'headlight');
  applyDust(root);
  return root;
}

export function buildMarsRoverConcept(M) {
  const root = new THREE.Group(); root.name = 'NASA_Mars_Rover_Concept';
  const r = 0.74, w = 0.52, tz = 1.42;
  rbox(7.7, 0.32, 1.6, 0.08, M.darkMetal, root, [0, 1.0, 0], 'chassis');
  for (const x of [2.85, 0.55, -2.9]) for (const s of [-1, 1]) {
    placeWheel(M, root, r, w, x, s * tz, x > 2 ? 0.1 : 0, { spokes: 7, rimRatio: 0.58 });
    fender(M, root, x, s * tz, r, w);
    tube([x, r, s * (tz - 0.32)], [x - 0.35, 1.0, s * 0.75], 0.06, M.metal, root, 'trailing_arm');
    cyl(0.05, 0.6, M.orange, root, [x + 0.2, r + 0.45, s * (tz - 0.4)], 'y', 'shock');
  }
  // front scout pod
  profile([[1.15, 1.08], [3.95, 1.08], [4.33, 1.38], [4.3, 1.9], [3.55, 2.92], [1.15, 3.05]], 2.45, 0.16, M.paint, root, 'scout_pod');
  // wrap-around canopy glass following the slanted nose
  const A = new THREE.Vector2(4.33, 1.92), B = new THREE.Vector2(3.55, 2.94), L = A.distanceTo(B);
  const cg = rbox(0.05, L, 2.2, 0.03, M.glass, root, [(A.x + B.x) / 2 + 0.02, (A.y + B.y) / 2, 0], 'canopy');
  cg.rotation.z = Math.atan2(B.y - A.y, B.x - A.x) - Math.PI / 2;
  for (const s of [-1, 1]) {
    profile([[2.35, 2.05], [3.85, 2.05], [3.4, 2.82], [2.35, 2.85]], 0.04, 0.012, M.glass, root, 'side_glass', s * 1.235);
    profile([[1.15, 1.08], [4.2, 1.08], [4.3, 1.42], [1.15, 1.42]], 0.05, 0.015, M.black, root, 'lower_trim', s * 1.23);
    rbox(2.9, 0.03, 0.02, 0.01, M.lampBlue, root, [2.7, 1.5, s * 1.245], 'blue_led_strip');
    rbox(0.06, 1.2, 0.05, 0.02, M.black, root, [2.25, 2.0, s * 1.24], 'door_seam');
  }
  rbox(0.05, 0.08, 1.7, 0.02, M.lamp, root, [4.33, 1.62, 0], 'headlight_bar');
  for (const s of [-1, 1]) rbox(0.06, 0.12, 0.28, 0.02, M.lamp, root, [4.31, 1.3, s * 0.8], 'fog_light');
  rbox(0.1, 0.1, 0.2, 0.02, M.black, root, [4.2, 2.05, 0], 'hazcam');
  // detachable coupling
  rbox(0.5, 0.9, 1.3, 0.06, M.darkMetal, root, [0.85, 1.85, 0], 'coupler');
  for (const s of [-1, 1]) tube([0.6, 1.55, s * 0.5], [1.1, 1.55, s * 0.5], 0.06, M.orange, root, 'latch');
  // rear laboratory module
  profile([[-4.12, 1.08], [0.62, 1.08], [0.62, 3.08], [-3.88, 3.08], [-4.15, 2.75]], 2.5, 0.14, M.paint2, root, 'lab_module');
  for (const s of [-1, 1]) {
    profile([[-4.12, 1.08], [0.62, 1.08], [0.62, 1.4], [-4.12, 1.4]], 0.05, 0.015, M.black, root, 'lab_trim', s * 1.255);
    rbox(4.2, 0.03, 0.02, 0.01, M.lampBlue, root, [-1.75, 1.48, s * 1.27], 'lab_led');
    for (const x of [-0.5, -1.55, -2.6]) rbox(0.62, 0.38, 0.04, 0.06, M.glass, root, [x, 2.5, s * 1.255], 'lab_window');
    rbox(0.9, 0.06, 0.06, 0.02, M.gold, root, [-3.5, 2.95, s * 1.25], 'handrail');
  }
  rbox(0.05, 1.45, 1.05, 0.06, M.paint, root, [-4.18, 2.05, 0], 'rear_hatch');
  rbox(0.07, 0.06, 0.3, 0.02, M.orange, root, [-4.21, 2.1, 0], 'hatch_handle');
  for (const s of [-1, 1]) rbox(0.04, 0.3, 0.08, 0.02, M.lampRed, root, [-4.17, 2.0, s * 1.05], 'tail_light');
  // roof solar array + rails, mast, high-gain dish
  rbox(3.8, 0.06, 2.15, 0.02, M.solar, root, [-1.75, 3.17, 0], 'solar_array');
  for (const s of [-1, 1]) rbox(3.9, 0.07, 0.05, 0.01, M.metal, root, [-1.75, 3.2, s * 1.1], 'array_rail');
  tube([1.6, 3.0, 0.75], [1.6, 3.85, 0.75], 0.04, M.metal, root, 'mast');
  const dish = new THREE.LatheGeometry(Array.from({ length: 14 }, (_, i) => new THREE.Vector2(i * 0.03, (i * 0.03) ** 2 * 1.1)), 40);
  const d = mesh(dish, M.dish, root, 'hga_dish'); d.position.set(1.6, 3.9, 0.75); d.rotation.z = -0.5;
  rbox(0.16, 0.14, 0.42, 0.03, M.black, root, [2.5, 3.07, -0.6], 'roof_cameras');
  rbox(0.08, 0.06, 1.4, 0.02, M.lamp, root, [3.45, 2.95, 0], 'roof_lightbar');
  applyDust(root);
  return root;
}
