// Сетка рельефа и модель EVA-прогулки (SIMULATED). Маршруты считает backend: POST /api/v1/routes/plan.
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
      elev: data.elev, slope: data.slope, roughness: data.roughness, hillshade: data.hillshade, // server layers; they were dropped here, so the map never drew them
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

  // Walk time out and back along a route the backend computed: SIMULATED pace, not a route metric.
  function walkSeconds(t, path, options) {
    const opts = { ...DEFAULTS, ...options };
    let outS = 0, backS = 0;
    for (let k = 1; k < path.length; k++) {
      outS += stepSeconds(t, path[k - 1], path[k], opts);
      backS += stepSeconds(t, path[k], path[k - 1], opts);
    }
    return { outS, backS };
  }

  // Расстояние в метрах между двумя точками [lat, lng] (локальное приближение)
  function metersBetween(p, q) {
    const lat = (p[0] + q[0]) / 2 * Math.PI / 180;
    const dy = (p[0] - q[0]) * Math.PI / 180 * MARS_RADIUS_M;
    const dx = (p[1] - q[1]) * Math.PI / 180 * MARS_RADIUS_M * Math.cos(lat);
    return Math.hypot(dx, dy);
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

  const api = { createTerrain, computeSlope, stepSeconds: (t, a, b, o) => stepSeconds(t, a, b, { ...DEFAULTS, ...o }), walkSeconds, evaluateEva, metersBetween, DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Router = api;
})(typeof window !== "undefined" ? window : globalThis);
