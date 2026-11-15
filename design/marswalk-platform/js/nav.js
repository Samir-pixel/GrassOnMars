// Навигация «как в обычных картах»: пошаговые подсказки и симуляция выхода.
(function (root) {
  const R = 3396190;
  const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

  function toXY(ll, lat0) {
    return [ll[1] * Math.PI / 180 * R * Math.cos(lat0 * Math.PI / 180), ll[0] * Math.PI / 180 * R];
  }
  function bearing(a, b, lat0) {
    const [x1, y1] = toXY(a, lat0), [x2, y2] = toXY(b, lat0);
    return (Math.atan2(x2 - x1, y2 - y1) * 180 / Math.PI + 360) % 360; // 0 = север
  }

  // Упрощение линии (Рамер — Дуглас — Пекер), возвращает индексы точек
  function simplify(pts, tol) {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1, bi = -1;
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
        if (d > best) { best = d; bi = i; }
      }
      if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    const idx = [];
    keep.forEach((k, i) => k && idx.push(i));
    return idx;
  }

  function turnWord(delta) {
    const a = Math.abs(delta);
    const side = delta > 0 ? "right" : "left";
    if (a < 25) return { dir: "straight", text: "Keep going straight" };
    if (a < 60) return { dir: `slight-${side}`, text: `Bear ${side}` };
    if (a < 130) return { dir: side, text: `Turn ${side}` };
    return { dir: `sharp-${side}`, text: `Sharp ${side}` };
  }

  // Строит шаги для пути (массив клеток) от старта к цели
  function buildSteps(t, cells, destName, maxSlope) {
    const ll = cells.map((i) => t.latLngOf(i));
    const lat0 = ll[0][0];
    const xy = ll.map((p) => toXY(p, lat0));
    const cum = [0];
    for (let k = 1; k < ll.length; k++) cum.push(cum[k - 1] + Math.hypot(xy[k][0] - xy[k - 1][0], xy[k][1] - xy[k - 1][1]));
    const idx = simplify(xy, Math.max(t.dx, t.dy) * 1.3);

    const steps = [];
    for (let s = 0; s < idx.length - 1; s++) {
      const a = idx[s], b = idx[s + 1];
      const br = bearing(ll[a], ll[b], lat0);
      let steep = 0;
      for (let k = a; k <= b; k++) steep = Math.max(steep, t.slope[cells[k]]);
      const dist = cum[b] - cum[a];
      if (s === 0) {
        steps.push({ kind: "depart", dir: "straight", text: `Head ${COMPASS[Math.round(br / 45) % 8]}`, from: a, to: b, atM: cum[a], dist, steep, bearing: br });
      } else {
        let delta = br - steps[steps.length - 1].bearing;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        const w = turnWord(delta);
        // слишком короткие или прямые отрезки сливаем с предыдущим
        if (w.dir === "straight" || dist < 60) {
          const prev = steps[steps.length - 1];
          prev.to = b; prev.dist += dist; prev.steep = Math.max(prev.steep, steep); prev.bearing = br;
          continue;
        }
        steps.push({ kind: "turn", dir: w.dir, text: w.text, from: a, to: b, atM: cum[a], dist, steep, bearing: br });
      }
    }
    steps.push({ kind: "arrive", dir: "arrive", text: `Arrive at ${destName}`, from: cells.length - 1, to: cells.length - 1, atM: cum[cum.length - 1], dist: 0, steep: 0 });
    for (const st of steps) st.steepWarn = st.steep > maxSlope * 0.66;
    return { steps, cum, ll };
  }

  // Время (с) от начала пути до каждой клетки, туда и обратно
  function timeline(t, cells, opts) {
    const out = [0], back = [0];
    for (let k = 1; k < cells.length; k++) out.push(out[k - 1] + Router.stepSeconds(t, cells[k - 1], cells[k], opts));
    // back[k] — время от клетки k до старта (идём в обратную сторону)
    for (let k = 1; k < cells.length; k++) back.push(back[k - 1] + Router.stepSeconds(t, cells[k], cells[k - 1], opts));
    return { out, back };
  }

  // Позиция на ломаной по массиву накопленного времени
  function positionAt(ll, times, tSec) {
    if (tSec <= 0) return { ll: ll[0], k: 0 };
    const n = times.length;
    if (tSec >= times[n - 1]) return { ll: ll[n - 1], k: n - 1 };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= tSec) lo = m; else hi = m; }
    const f = (tSec - times[lo]) / (times[hi] - times[lo] || 1);
    return { ll: [ll[lo][0] + (ll[hi][0] - ll[lo][0]) * f, ll[lo][1] + (ll[hi][1] - ll[lo][1]) * f], k: lo, f };
  }

  const ARROWS = {
    straight: "arrow-up", depart: "navigation", "slight-left": "arrow-up-left", "slight-right": "arrow-up-right",
    left: "corner-up-left", right: "corner-up-right", "sharp-left": "undo-2", "sharp-right": "redo-2", arrive: "flag",
  };

  root.Nav = { buildSteps, timeline, positionAt, ARROWS, COMPASS };
})(typeof window !== "undefined" ? window : globalThis);
