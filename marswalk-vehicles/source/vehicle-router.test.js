const Router = require('./router_from_site.js');
const VR = require('../vehicle-router.js');
const rows = 200, cols = 200, cell = 25; // 5 km x 5 km
const elev = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  let z = 0;
  // ridge across the map at c=100: steep (≈20°) in the north, gentle (≈8°) in the south
  const d = Math.abs(c - 100) * cell, steep = r < 120 ? Math.tan(20 * Math.PI / 180) : Math.tan(8 * Math.PI / 180);
  z += Math.max(0, 150 - d * steep);
  // small steep mound around the goal (≈17°) → vehicles must park and walk
  // no mound
  elev.push(z);
}
const t = Router.createTerrain({ rows, cols, bounds: { north: 18.5, south: 18.42, west: 77.4, east: 77.48 }, cell_m: [cell, cell], elev });
const start = 40 * cols + 20, goal = 40 * cols + 170;
for (const v of ['foot', 'mrv', 'sev', 'mars_rover']) {
  const p = VR.planTrip(Router, t, start, goal, v, { suitHours: 8, startHour: 9, dustTau: 0.6, stopMinutes: 30, mode: 'time' });
  if (!p) { console.log(v, 'NO ROUTE'); continue; }
  const cells = p.driveCells || p.walkCells;
  const crossRow = cells.filter(i => i % cols === 100).map(i => Math.floor(i / cols));
  console.log(v.padEnd(10), {
    km: (p.sum.distance / 1000).toFixed(2), maxSlope: p.sum.maxSlope.toFixed(1), crossRidgeAtRow: crossRow[0],
    totalH: ((p.totalS ?? p.eva.totalS) / 3600).toFixed(2), walkLastMileM: p.walk ? Math.round(p.walk.distance) : 0,
    energy: p.energyUsed != null ? Math.round(p.energyUsed * 100) + '%' : '-', o2: Math.round((p.o2Used ?? p.eva.o2Used) * 100) + '%',
    go: p.go, reasons: p.reasons.join(',') });
}
