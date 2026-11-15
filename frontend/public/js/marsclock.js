// Марсианское время по алгоритму Mars24 (NASA GISS, Allison & McEwen 2000).
(function (root) {
  const LEAP_TT_OFFSET_S = 37 + 32.184; // TAI−UTC (37 с с 2017 г.) + TT−TAI
  const PERSEVERANCE_LANDING = Date.UTC(2021, 1, 18, 20, 55); // Sol 0

  function marsSolDate(ms) {
    const jdUT = ms / 86400000 + 2440587.5;
    const jdTT = jdUT + LEAP_TT_OFFSET_S / 86400;
    return (jdTT - 2405522.0028779) / 1.0274912517;
  }

  // Местное среднее солнечное время (часы) на восточной долготе lonE
  function lmst(ms, lonE) {
    const mtc = (24 * marsSolDate(ms)) % 24;
    return ((mtc + lonE / 15) % 24 + 24) % 24;
  }

  // Номер сола с посадки Perseverance (как в нумерации миссии)
  function perseveranceSol(ms, lonE = 77.45) {
    const local = (t) => Math.floor(marsSolDate(t) + lonE / 360);
    return local(ms) - local(PERSEVERANCE_LANDING);
  }

  function fmtHours(h) {
    const total = Math.round(h * 60);
    const hh = Math.floor(total / 60) % 24, mm = total % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  root.MarsClock = { marsSolDate, lmst, perseveranceSol, fmtHours };
})(typeof window !== "undefined" ? window : globalThis);
