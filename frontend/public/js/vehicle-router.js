// Маршрут для машины (MRV, SEV, Mars Rover) поверх рельефа из window.Router.
// Работает с той же сеткой, что и пеший Router: t = Router.createTerrain(data).
// Без зависимостей: в браузере -> window.VehicleRouter, в Node -> require().
(function (root) {
  const G_MARS = 3.71;

  // Параметры машин. "assumed: true" = допущение команды для демо, не официальные данные NASA.
  const VEHICLES = {
    foot: {
      id: "foot", name: "On foot", pressurized: false, crew: 2,
      // пеший режим полностью считает существующий Router (Тоблер x 0.6, 15°, скафандр 8 ч)
    },
    mrv: {
      id: "mrv", name: "NASA MRV", pressurized: false, crew: 2,
      maxSlope: 15, vmaxKmh: 10, slopeSlowdown: 0.6, climbK: 2.0, minSpeedFrac: 0.25, safeWeight: 3,
      massKg: 1000, batteryWh: 30000, whPerKm: 150, maxRadiusKm: 10, maxDurationH: 8,
      lastMileM: 300, assumed: true,
    },
    sev: {
      id: "sev", name: "NASA SEV", pressurized: true, crew: 2,
      maxSlope: 25, vmaxKmh: 8, slopeSlowdown: 0.4, climbK: 1.2, minSpeedFrac: 0.3, safeWeight: 1.5,
      massKg: 3000, batteryWh: 125000, whPerKm: 450, maxRadiusKm: 100, maxDurationH: 336,
      lastMileM: 500, assumed: true,
    },
    mars_rover: {
      id: "mars_rover", name: "NASA Mars Rover (concept)", pressurized: true, crew: 4,
      maxSlope: 18, vmaxKmh: 12, slopeSlowdown: 0.7, climbK: 2.5, minSpeedFrac: 0.2, safeWeight: 2,
      massKg: 5000, batteryWh: 150000, whPerKm: 700, maxRadiusKm: 50, maxDurationH: 72,
      lastMileM: 400, assumed: true,
    },
  };

  const NEIGHBORS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  class Heap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
    }
    pop() {
      const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop();
      if (k.length) {
        k[0] = lk; v[0] = lv; let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r;
          if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; }
      }
      return top;
    }
  }

  function stepDist(t, a, b) {
    const dr = Math.floor(b / t.cols) - Math.floor(a / t.cols), dc = (b % t.cols) - (a % t.cols);
    return Math.hypot(dc * t.dx, dr * t.dy);
  }

  function passable(t, i, veh) {
    const s = t.slope[i];
    return t.elev[i] !== null && s >= 0 && s <= veh.maxSlope;
  }

  // Скорость машины (м/с) на шаге a -> b: падает на крутых клетках и в подъём
  function speedMs(t, a, b, veh) {
    const dist = stepDist(t, a, b), grade = (t.elev[b] - t.elev[a]) / dist;
    const s = t.slope[b] / veh.maxSlope;
    let f = 1 - veh.slopeSlowdown * s * s;
    if (grade > 0) f *= Math.exp(-veh.climbK * grade);
    f = Math.max(veh.minSpeedFrac, f);
    return veh.vmaxKmh * f / 3.6;
  }

  function stepSeconds(t, a, b, veh) { return stepDist(t, a, b) / speedMs(t, a, b, veh); }

  // Энергия шага (Вт·ч): сопротивление качению + подъём (КПД 0.8, рекуперации нет)
  function stepWh(t, a, b, veh) {
    const km = stepDist(t, a, b) / 1000, s = t.slope[b] / veh.maxSlope;
    const dz = Math.max(0, t.elev[b] - t.elev[a]);
    return km * veh.whPerKm * (1 + 0.5 * s * s) + veh.massKg * G_MARS * dz / 3600 / 0.8;
  }

  // Режимы как у пешего Router: time | safe | distance
  function stepCost(t, a, b, veh, mode) {
    if (mode === "distance") return stepDist(t, a, b);
    const base = stepSeconds(t, a, b, veh);
    if (mode === "safe") return base * (1 + veh.safeWeight * Math.pow(t.slope[b] / veh.maxSlope, 2));
    return base;
  }

  function findPath(t, start, goal, vehicleId, mode = "time") {
    const veh = VEHICLES[vehicleId];
    if (start < 0 || goal < 0 || !passable(t, start, veh) || !passable(t, goal, veh)) return null;
    const n = t.rows * t.cols, g = new Float64Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const vmax = mode === "distance" ? 1 : veh.vmaxKmh / 3.6;
    const gr = Math.floor(goal / t.cols), gc = goal % t.cols;
    const h = (i) => Math.hypot((Math.floor(i / t.cols) - gr) * t.dy, ((i % t.cols) - gc) * t.dx) / vmax;
    const open = new Heap(); g[start] = 0; open.push(h(start), start);
    while (open.size) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue; closed[cur] = 1;
      const r = Math.floor(cur / t.cols), c = cur % t.cols;
      for (const [ddr, ddc] of NEIGHBORS) {
        const nr = r + ddr, nc = c + ddc;
        if (nr < 0 || nr >= t.rows || nc < 0 || nc >= t.cols) continue;
        const nb = nr * t.cols + nc;
        if (closed[nb] || !passable(t, nb, veh)) continue;
        const cand = g[cur] + stepCost(t, cur, nb, veh, mode);
        if (cand < g[nb]) { g[nb] = cand; came[nb] = cur; open.push(cand + h(nb), nb); }
      }
    }
    if (!isFinite(g[goal])) return null;
    const path = []; for (let i = goal; i !== -1; i = came[i]) path.push(i);
    return path.reverse();
  }

  // Ближайшая к цели клетка, куда машина может доехать (для «последней мили» пешком)
  function nearestDrivable(t, goal, veh, radiusM) {
    const gr = Math.floor(goal / t.cols), gc = goal % t.cols;
    const R = Math.ceil(radiusM / Math.min(t.dx, t.dy));
    let best = -1, bestD = Infinity;
    for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
      const r = gr + dr, c = gc + dc; if (r < 0 || c < 0 || r >= t.rows || c >= t.cols) continue;
      const d = Math.hypot(dr * t.dy, dc * t.dx); if (d > radiusM || d >= bestD) continue;
      const i = r * t.cols + c; if (passable(t, i, veh)) { best = i; bestD = d; }
    }
    return best;
  }

  function summarize(t, path, vehicleId) {
    const veh = VEHICLES[vehicleId];
    let distance = 0, ascent = 0, descent = 0, maxSlope = 0, outS = 0, backS = 0, outWh = 0, backWh = 0, farIdx = 0, farD = 0;
    const start = path[0];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      distance += stepDist(t, a, b);
      const dz = t.elev[b] - t.elev[a]; if (dz > 0) ascent += dz; else descent -= dz;
      maxSlope = Math.max(maxSlope, t.slope[b]);
      outS += stepSeconds(t, a, b, veh); backS += stepSeconds(t, b, a, veh);
      outWh += stepWh(t, a, b, veh); backWh += stepWh(t, b, a, veh);
      const d = stepDist(t, start, b); if (d > farD) { farD = d; farIdx = k; }
    }
    return { distance, ascent, descent, maxSlope, outS, backS, energyWh: outWh + backWh, farthestM: farD, farthestIdx: farIdx };
  }

  // Полный план: доехать (туда-обратно), при необходимости дойти пешком последнюю милю.
  // Router — пеший роутер сайта (window.Router). opts: { suitHours, startHour, dustTau, daylightEnd, stopMinutes, mode }
  function planTrip(Router, t, start, goal, vehicleId, opts = {}) {
    const mode = opts.mode || "time";
    if (vehicleId === "foot") {
      const cells = Router.findPath(t, start, goal, { mode, maxSlope: opts.footMaxSlope || 15 });
      if (!cells) return null;
      const sum = Router.summarize(t, cells, { maxSlope: opts.footMaxSlope || 15 });
      const eva = Router.evaluateEva({ outS: sum.outS, backS: sum.backS, stopMinutes: opts.stopMinutes || 0,
        suitHours: opts.suitHours || 8, dustTau: opts.dustTau ?? null, startHour: opts.startHour ?? null });
      return { vehicle: "foot", driveCells: null, walkCells: cells, sum, eva, go: eva.go, reasons: eva.reasons };
    }
    const veh = VEHICLES[vehicleId];
    let park = goal, walkCells = null;
    if (!passable(t, goal, veh)) {
      park = nearestDrivable(t, goal, veh, veh.lastMileM);
      if (park < 0) return null;
    }
    const driveCells = findPath(t, start, park, vehicleId, mode);
    if (!driveCells) return null;
    if (park !== goal) {
      walkCells = Router.findPath(t, park, goal, { mode: "safe", maxSlope: opts.footMaxSlope || 15 });
      if (!walkCells) return null;
    }
    const sum = summarize(t, driveCells, vehicleId);
    const walk = walkCells ? Router.summarize(t, walkCells, { maxSlope: opts.footMaxSlope || 15 }) : null;
    const res = evaluateTrip(Router, t, driveCells, sum, walk, vehicleId, opts);
    return { vehicle: vehicleId, driveCells, walkCells, park, sum, walk, ...res };
  }

  // Решение GO / NO GO для машины
  function evaluateTrip(Router, t, driveCells, sum, walk, vehicleId, opts) {
    const veh = VEHICLES[vehicleId];
    const suitHours = opts.suitHours || 8, reserve = opts.reserve ?? 0.3, batteryReserve = opts.batteryReserve ?? 0.2;
    const walkS = walk ? walk.outS + walk.backS : 0;
    const stopS = (opts.stopMinutes || 0) * 60;
    const driveS = sum.outS + sum.backS;
    const totalS = driveS + walkS + stopS;
    const reasons = [], cautions = [];

    const energyUsed = sum.energyWh / veh.batteryWh;
    if (energyUsed > 1 - batteryReserve) reasons.push("battery");
    if (sum.farthestM / 1000 > veh.maxRadiusKm) reasons.push("radius");
    if (totalS / 3600 > veh.maxDurationH) reasons.push("duration");

    // Открытая машина: экипаж всё время в скафандрах + правило «дойти пешком назад»
    // (как у Apollo LRV): если машина сломается в самой дальней точке, экипаж должен дойти до базы.
    let walkBackS = null, o2Used = null;
    const suitLimitS = suitHours * 3600 / (1 + reserve);
    if (!veh.pressurized) {
      o2Used = totalS / (suitHours * 3600);
      if (totalS > suitLimitS) reasons.push("suit");
      let toFarS = 0; for (let k = 1; k <= sum.farthestIdx; k++) toFarS += stepSeconds(t, driveCells[k - 1], driveCells[k], veh);
      walkBackS = 0; for (let k = sum.farthestIdx; k > 0; k--) walkBackS += Router.stepSeconds(t, driveCells[k], driveCells[k - 1], { maxSlope: 90 });
      if (toFarS + walkS / 2 + stopS + walkBackS > suitLimitS) reasons.push("walkback");
    } else {
      // Герметичная машина: скафандр нужен только на пеший кусок и остановки
      const evaS = walkS + stopS;
      o2Used = evaS / (suitHours * 3600);
      if (evaS > suitLimitS) reasons.push("suit");
    }
    if (opts.dustTau != null && opts.dustTau >= 2) (veh.pressurized ? cautions : reasons).push("dust");
    if (opts.startHour != null) {
      const endHour = opts.startHour + totalS / 3699; // 1 час LMST ≈ 3699 с
      if (endHour > (opts.daylightEnd ?? 17.5)) (veh.pressurized ? cautions : reasons).push("daylight");
    }
    return { totalS, driveS, walkS, stopS, energyWh: sum.energyWh, energyUsed, o2Used, walkBackS, go: reasons.length === 0, reasons, cautions };
  }

  const api = { VEHICLES, findPath, summarize, planTrip, evaluateTrip, nearestDrivable, stepSeconds, stepWh, passable };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VehicleRouter = api;
})(typeof window !== "undefined" ? window : globalThis);
