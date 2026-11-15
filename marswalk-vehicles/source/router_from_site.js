// Поиск пешего маршрута по сетке рельефа (A*).
// Без зависимостей: работает в браузере (window.Router) и в Node (require) для тестов.
(function (root) {
  const MARS_RADIUS_M = 3396190;

  // Скорость пешехода по Тоблеру (км/ч) в зависимости от уклона dz/dx.
  // На Марсе в скафандре люди ходят медленнее — это учитывает suitSpeedFactor.
  function toblerKmh(grade) {
    return 6 * Math.exp(-3.5 * Math.abs(grade + 0.05));
  }

  const DEFAULTS = {
    maxSlope: 15,          // градусов: круче — не идём (допущение команды)
    suitSpeedFactor: 0.6,  // доля земной скорости в скафандре (допущение)
  };

  // Декодирует высоты из base64 (int16, дециметры) — так хранится встроенный демо-рельеф
  function decodeElev(b64, n) {
    const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dm = new Int16Array(bytes.buffer, 0, n);
    return Array.from(dm, (v) => v / 10);
  }

  // Склон в градусах по центральным разностям (как np.gradient в prepare_terrain.py)
  function computeSlope(elev, rows, cols, dx, dy) {
    const slope = new Array(rows * cols);
    const z = (r, c) => elev[r * cols + c];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const r0 = Math.max(0, r - 1), r1 = Math.min(rows - 1, r + 1);
        const c0 = Math.max(0, c - 1), c1 = Math.min(cols - 1, c + 1);
        const vals = [z(r0, c), z(r1, c), z(r, c0), z(r, c1), z(r, c)];
        if (vals.some((v) => v === null || Number.isNaN(v))) { slope[r * cols + c] = -1; continue; }
        const gx = (z(r, c1) - z(r, c0)) / ((c1 - c0) * dx);
        const gy = (z(r1, c) - z(r0, c)) / ((r1 - r0) * dy);
        slope[r * cols + c] = Math.round(Math.atan(Math.hypot(gx, gy)) * 1800 / Math.PI) / 10;
      }
    }
    return slope;
  }

  function createTerrain(data) {
    const { rows, cols, bounds } = data;
    const [dx, dy] = data.cell_m;
    if (!data.elev && data.elev_dm_b64) data = { ...data, elev: decodeElev(data.elev_dm_b64, rows * cols) };
    if (!data.slope) data = { ...data, slope: computeSlope(data.elev, rows, cols, dx, dy) };
    const latSpan = bounds.north - bounds.south;
    const lngSpan = bounds.east - bounds.west;
    return {
      rows, cols, bounds, dx, dy, meta: data.meta,
      elev: data.elev, slope: data.slope,
      cellOf(lat, lng) {
        const c = Math.floor((lng - bounds.west) / lngSpan * cols);
        const r = Math.floor((bounds.north - lat) / latSpan * rows);
        if (r < 0 || r >= rows || c < 0 || c >= cols) return -1;
        return r * cols + c;
      },
      latLngOf(i) {
        const r = Math.floor(i / cols), c = i % cols;
        return [bounds.north - (r + 0.5) / rows * latSpan, bounds.west + (c + 0.5) / cols * lngSpan];
      },
    };
  }

  function passable(t, i, opts) {
    const s = t.slope[i];
    return t.elev[i] !== null && s >= 0 && s <= opts.maxSlope;
  }

  function stepDist(t, a, b) {
    const dr = Math.floor(b / t.cols) - Math.floor(a / t.cols);
    const dc = (b % t.cols) - (a % t.cols);
    return Math.hypot(dc * t.dx, dr * t.dy);
  }

  // Время (с) на шаг из клетки a в соседнюю клетку b
  function stepSeconds(t, a, b, opts) {
    const dist = stepDist(t, a, b);
    const grade = (t.elev[b] - t.elev[a]) / dist;
    const speed = toblerKmh(grade) * opts.suitSpeedFactor / 3.6; // м/с
    // Штраф за поперечный склон: идти по косогору тяжелее и опаснее.
    // Для отчётов по времени берём базовый штраф 0.5, чтобы варианты сравнивались честно
    const sideways = 1 + 0.5 * Math.pow(t.slope[b] / opts.maxSlope, 2);
    return dist / speed * sideways;
  }

  // Стоимость шага для поиска. Режимы:
  //   time     — минимальное время (по умолчанию)
  //   safe     — время с сильным штрафом за крутизну
  //   distance — минимальное расстояние
  function stepCost(t, a, b, opts) {
    if (opts.mode === "distance") return stepDist(t, a, b);
    const base = stepSeconds(t, a, b, opts);
    if (opts.mode === "safe") return base * (1 + 3 * Math.pow(t.slope[b] / opts.maxSlope, 2));
    return base;
  }

  // Минимальная двоичная куча
  class Heap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v;
      let i = k.length; k.push(key); v.push(val);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (k[p] <= k[i]) break;
        [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p;
      }
    }
    pop() {
      const k = this.k, v = this.v, top = v[0];
      const lk = k.pop(), lv = v.pop();
      if (k.length) {
        k[0] = lk; v[0] = lv;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < k.length && k[l] < k[m]) m = l;
          if (r < k.length && k[r] < k[m]) m = r;
          if (m === i) break;
          [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
        }
      }
      return top;
    }
  }

  const NEIGHBORS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  // Возвращает массив индексов клеток от start до goal или null, если пути нет
  function findPath(t, start, goal, options) {
    const opts = { ...DEFAULTS, ...options };
    if (start < 0 || goal < 0 || !passable(t, start, opts) || !passable(t, goal, opts)) return null;

    const n = t.rows * t.cols;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const vmax = opts.mode === "distance" ? 1 : toblerKmh(-0.05) * opts.suitSpeedFactor / 3.6;
    const gr = Math.floor(goal / t.cols), gc = goal % t.cols;
    const h = (i) => Math.hypot((Math.floor(i / t.cols) - gr) * t.dy, ((i % t.cols) - gc) * t.dx) / vmax;

    const open = new Heap();
    g[start] = 0;
    open.push(h(start), start);

    while (open.size) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const r = Math.floor(cur / t.cols), c = cur % t.cols;
      for (const [ddr, ddc] of NEIGHBORS) {
        const nr = r + ddr, nc = c + ddc;
        if (nr < 0 || nr >= t.rows || nc < 0 || nc >= t.cols) continue;
        const nb = nr * t.cols + nc;
        if (closed[nb] || !passable(t, nb, opts)) continue;
        const cand = g[cur] + stepCost(t, cur, nb, opts);
        if (cand < g[nb]) {
          g[nb] = cand; came[nb] = cur;
          open.push(cand + h(nb), nb);
        }
      }
    }
    if (!isFinite(g[goal])) return null;

    const path = [];
    for (let i = goal; i !== -1; i = came[i]) path.push(i);
    return path.reverse();
  }

  // Сводка по маршруту: туда и обратно тем же путём
  function summarize(t, path, options) {
    const opts = { ...DEFAULTS, ...options };
    let distance = 0, ascent = 0, descent = 0, maxSlope = 0, outS = 0, backS = 0;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      const dr = Math.floor(b / t.cols) - Math.floor(a / t.cols);
      const dc = (b % t.cols) - (a % t.cols);
      distance += Math.hypot(dc * t.dx, dr * t.dy);
      const dz = t.elev[b] - t.elev[a];
      if (dz > 0) ascent += dz; else descent -= dz;
      maxSlope = Math.max(maxSlope, t.slope[b]);
      outS += stepSeconds(t, a, b, opts);
      backS += stepSeconds(t, b, a, opts);
    }
    return { distance, ascent, descent, maxSlope, outS, backS };
  }

  // Расстояние в метрах между двумя точками [lat, lng] (локальное приближение)
  function metersBetween(p, q) {
    const lat = (p[0] + q[0]) / 2 * Math.PI / 180;
    const dy = (p[0] - q[0]) * Math.PI / 180 * MARS_RADIUS_M;
    const dx = (p[1] - q[1]) * Math.PI / 180 * MARS_RADIUS_M * Math.cos(lat);
    return Math.hypot(dx, dy);
  }

  // Научные остановки не дальше radiusM от маршрута
  function stopsNearRoute(t, path, stops, radiusM) {
    const pts = path.map((i) => t.latLngOf(i));
    return stops.filter((s) => pts.some((p) => metersBetween(p, s.latlng) <= radiusM));
  }

  // Решение «идти / не идти»: запас скафандра, пыль и световой день
  // startHour и daylightEnd — местное солнечное время (LMST), часы
  function evaluateEva({ outS, backS, stopMinutes, suitHours, reserve = 0.3, dustTau = null,
                         startHour = null, daylightEnd = 17.5 }) {
    const totalS = outS + backS + stopMinutes * 60;
    const limitS = suitHours * 3600 / (1 + reserve);
    const reasons = [];
    if (totalS > limitS) reasons.push("suit");
    if (dustTau !== null && dustTau >= 2) reasons.push("dust");
    // Марсианский час длиннее земного: 1 час LMST ≈ 3699 с
    const endHour = startHour === null ? null : startHour + totalS / 3699;
    if (endHour !== null && endHour > daylightEnd) reasons.push("daylight");
    return {
      totalS, limitS, endHour, go: reasons.length === 0, reasons,
      o2Used: totalS / (suitHours * 3600),
      caution: dustTau !== null && dustTau >= 1 && dustTau < 2,
    };
  }

  const api = { createTerrain, computeSlope, stepSeconds: (t, a, b, o) => stepSeconds(t, a, b, { ...DEFAULTS, ...o }), findPath, summarize, stopsNearRoute, evaluateEva, metersBetween, DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Router = api;
})(typeof window !== "undefined" ? window : globalThis);

