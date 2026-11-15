// Контент платформы: точки на всём Марсе, цели в Езеро и стек данных NASA.
// Высоты — приблизительные значения по MOLA (км относительно ареоида).
// Site elevations (elevKm) and 10 km 90th-percentile slopes (molaP90Deg) are read directly from
// USGS MGS MOLA MEGDR DEM 463 m (128 px/deg, planetocentric +E). Water class (waterClass) maps NASA
// instrument detections to 0..1; scienceC counts 5 binary NASA observables (lake/hydrothermal,
// biosignature-host minerals, Noachian exposure, surface mission ground-truth, sample/ice archive).
window.WATER_CLASS_SCORE = { ice_exposed: 1.0, ice_shallow: 0.85, ice_deep: 0.65, aq_min: 0.40, deep_crust: 0.15, none: 0.0 };

window.SITES = [
  {
    id: "jezero", name: "Jezero Crater", icon: "droplets", ice: "Not near the surface", waterSrc: "MRO CRISM", lat: 18.38, lon: 77.58, elevKm: -2.645, molaP90Deg: 1.05, waterClass: "aq_min", scienceC: [1, 1, 1, 1, 1],
    tags: ["lake", "rover"], playable: true,
    blurb: "A 45 km crater that held a lake about 3.5 billion years ago. A river built a delta here, and Perseverance has been exploring it since 2021.",
    waterWhy: "CRISM mapped clays and carbonates that formed in water. Shallow ice is unlikely this close to the equator.",
    safetyWhy: "MOLA 10 km p90 slope 1.05°; rover-proven floor with 20 m CTX and 1 m HiRISE DTMs.",
    data: ["MRO HiRISE", "MRO CRISM", "MRO CTX", "MGS MOLA", "Mars 2020 MEDA"],
  },
  {
    id: "gale", name: "Gale Crater", icon: "mountain", ice: "Not near the surface", waterSrc: "MSL Curiosity, MRO CRISM", lat: -4.59, lon: 137.44, elevKm: -4.500, molaP90Deg: 3.54, waterClass: "aq_min", scienceC: [1, 1, 1, 1, 0],
    tags: ["lake", "rover"],
    blurb: "Home of Curiosity (Bradbury Landing) and Mount Sharp, a 5 km stack of layered rock that records how Mars dried out.",
    waterWhy: "Curiosity found mudstones from a long-lived lake. No shallow ice.",
    safetyWhy: "MOLA 10 km p90 slope 3.54° around Bradbury Landing as the floor transitions toward Mount Sharp.",
    data: ["MSL Curiosity RAD", "MSL Curiosity REMS", "MRO HiRISE", "MRO CRISM"],
  },
  {
    id: "arcadia", name: "Arcadia Planitia", icon: "snowflake", ice: "Within ~1 m", waterSrc: "MRO SHARAD, SWIM", lat: 47.0, lon: -170.0, elevKm: -4.025, molaP90Deg: 0.28, waterClass: "ice_shallow", scienceC: [0, 0, 0, 0, 1],
    tags: ["ice", "human"],
    blurb: "Smooth northern plains with ice close to the surface. Often named as a place where astronauts could mine water.",
    waterWhy: "SHARAD radar and the SWIM ice maps show water ice within about a meter of the surface.",
    safetyWhy: "MOLA 10 km p90 slope 0.28° (15 m relief), smooth and low for entry and landing.",
    data: ["MRO SHARAD", "Mars Odyssey GRS", "SWIM ice maps", "MRO HiRISE"],
  },
  {
    id: "deuteronilus", name: "Deuteronilus Mensae", icon: "snowflake", ice: "~1–10 m under debris", waterSrc: "MRO SHARAD", lat: 44.0, lon: 22.0, elevKm: -3.722, molaP90Deg: 2.94, waterClass: "ice_shallow", scienceC: [0, 0, 1, 0, 1],
    tags: ["ice", "human"],
    blurb: "Flat-topped mesas wrapped in glaciers buried under a thin layer of rock and dust.",
    waterWhy: "SHARAD sees nearly pure ice under the debris cover of these glaciers.",
    safetyWhy: "MOLA 10 km p90 slope 2.94° across mesa margins and debris-covered glaciers.",
    data: ["MRO SHARAD", "MRO CTX", "MRO HiRISE", "MGS MOLA"],
  },
  {
    id: "utopia", name: "Utopia Planitia", icon: "snowflake", ice: "Buried deposit, meters deep", waterSrc: "MRO SHARAD", lat: 48.27, lon: 134.01, elevKm: -4.485, molaP90Deg: 0.62, waterClass: "ice_deep", scienceC: [0, 0, 0, 1, 1],
    tags: ["ice", "human", "rover"],
    blurb: "A giant northern impact basin where Viking 2 landed in 1976.",
    waterWhy: "SHARAD found a buried regional ice deposit in western Utopia holding about as much water as Lake Superior.",
    safetyWhy: "MOLA 10 km p90 slope 0.62° at the Viking 2 plain.",
    data: ["MRO SHARAD", "MRO HiRISE", "Viking 2 lander", "MGS MOLA"],
  },
  {
    id: "hellas", name: "Hellas Planitia", icon: "waves", ice: "Buried glaciers on the rim", waterSrc: "MRO SHARAD", lat: -40.5, lon: 66.0, elevKm: -6.913, molaP90Deg: 3.66, waterClass: "ice_deep", scienceC: [1, 1, 1, 0, 1],
    tags: ["ice", "extreme"],
    blurb: "The deepest impact basin on Mars. The air at the bottom is almost twice as dense as on the highlands.",
    waterWhy: "Pressure here is above water’s triple point (≈611 Pa). SHARAD found buried glaciers on the basin rim.",
    safetyWhy: "MOLA 10 km p90 slope 3.66° on the deep basin floor; regional dust storms often nucleate here.",
    data: ["MGS MOLA", "MRO SHARAD", "MRO MARCI"],
  },
  {
    id: "olympus", name: "Olympus Mons", icon: "triangle", ice: "None known", waterSrc: "MGS MOLA", lat: 17.34, lon: -133.45, elevKm: 21.241, molaP90Deg: 2.06, waterClass: "none", scienceC: [0, 0, 0, 0, 0],
    tags: ["extreme"],
    blurb: "The tallest volcano in the solar system, rising 21.2 km above the MOLA areoid.",
    waterWhy: "Almost no water. The summit air is around a tenth of the pressure on the plains.",
    safetyWhy: "MOLA summit elevation +21.24 km (excluded above +2 km); ringed by basal cliffs up to 6 km tall.",
    data: ["MGS MOLA", "MRO CTX", "Viking orbiters"],
  },
  {
    id: "valles", name: "Valles Marineris", icon: "layers", ice: "Hydrated minerals only", waterSrc: "MRO CRISM", lat: -13.5, lon: -61.0, elevKm: -5.061, molaP90Deg: 3.65, waterClass: "aq_min", scienceC: [1, 1, 1, 0, 0],
    tags: ["extreme"],
    blurb: "A canyon system about 4,000 km long and up to 7 km deep (Coprates Chasma floor).",
    waterWhy: "CRISM maps hydrated sulfates in the canyon’s layered deposits.",
    safetyWhy: "MOLA 10 km p90 slope 3.65° on the chasma floor, bounded by multi-kilometer canyon walls.",
    data: ["MRO CRISM", "MRO HiRISE", "Mars Odyssey THEMIS", "MGS MOLA"],
  },
  {
    id: "gusev", name: "Gusev Crater", icon: "bot", ice: "Not near the surface", waterSrc: "MER Spirit", lat: -14.57, lon: 175.47, elevKm: -1.943, molaP90Deg: 1.11, waterClass: "aq_min", scienceC: [1, 1, 1, 1, 0],
    tags: ["rover", "lake"],
    blurb: "Spirit’s landing site. A river channel once drained into this crater.",
    waterWhy: "Spirit found silica-rich deposits, likely from ancient hot springs.",
    safetyWhy: "MOLA 10 km p90 slope 1.11° across Spirit’s plain and Columbia Hills approach.",
    data: ["MER Spirit", "MRO HiRISE", "MGS MOLA"],
  },
  {
    id: "meridiani", name: "Meridiani Planum", icon: "bot", ice: "Not near the surface", waterSrc: "MER Opportunity, MGS TES", lat: -1.95, lon: -5.53, elevKm: -1.384, molaP90Deg: 0.31, waterClass: "aq_min", scienceC: [1, 1, 1, 1, 0],
    tags: ["rover", "lake"],
    blurb: "Opportunity’s home for 14 years, chosen after orbiters spotted crystalline hematite.",
    waterWhy: "Opportunity found hematite “blueberries” and sulfate rocks formed in acidic groundwater.",
    safetyWhy: "MOLA 10 km p90 slope 0.31° — one of the flattest plains on Mars.",
    data: ["MER Opportunity", "MGS TES", "MRO CRISM"],
  },
  {
    id: "phoenix", name: "Phoenix site", icon: "snowflake", ice: "~5 cm below the soil", waterSrc: "Phoenix lander", lat: 68.22, lon: -125.75, elevKm: -4.126, molaP90Deg: 1.33, waterClass: "ice_exposed", scienceC: [0, 1, 0, 1, 1],
    tags: ["ice", "rover"],
    blurb: "Arctic plains where the Phoenix lander dug into the soil in 2008.",
    waterWhy: "Phoenix exposed water ice a few centimeters down and saw it sublimate.",
    safetyWhy: "MOLA 10 km p90 slope 1.33°, excluded by polar night at 68.2°N.",
    data: ["Phoenix lander", "Mars Odyssey GRS", "MRO HiRISE"],
  },
  {
    id: "polar", name: "North polar cap", icon: "snowflake", ice: "Exposed ice cap", waterSrc: "MRO SHARAD, MGS MOLA", lat: 87.0, lon: 15.0, elevKm: -2.661, molaP90Deg: 1.18, waterClass: "ice_exposed", scienceC: [0, 0, 0, 0, 1],
    tags: ["ice", "extreme"],
    blurb: "Kilometers of layered water ice and dust on Planum Boreum, a record of past climate.",
    waterWhy: "The largest exposed water-ice reservoir on Mars.",
    safetyWhy: "MOLA 10 km p90 slope 1.18° on the cap interior; excluded at 87°N by months of polar night.",
    data: ["MRO SHARAD", "MGS MOLA", "MRO HiRISE"],
  },
  {
    id: "nili", name: "Nili Fossae", icon: "gem", ice: "Hydrated minerals only", waterSrc: "MRO CRISM", lat: 22.6, lon: 76.8, elevKm: -0.209, molaP90Deg: 7.54, waterClass: "aq_min", scienceC: [1, 1, 1, 0, 0],
    tags: ["lake"],
    blurb: "Troughs next to Jezero with some of the richest clay and olivine exposures on Mars.",
    waterWhy: "CRISM maps clays and carbonates altered by water.",
    safetyWhy: "MOLA 10 km p90 slope 7.54° (649 m relief) across steep graben troughs.",
    data: ["MRO CRISM", "MRO CTX", "MGS MOLA"],
  },
  {
    id: "elysium", name: "Elysium Planitia", icon: "activity", ice: "Liquid water ~10–20 km deep", waterSrc: "InSight SEIS", lat: 4.5, lon: 135.62, elevKm: -2.614, molaP90Deg: 0.57, waterClass: "deep_crust", scienceC: [0, 0, 0, 1, 0],
    tags: ["rover"],
    blurb: "InSight listened for marsquakes here from 2018 to 2022.",
    waterWhy: "InSight’s seismic data suggest liquid water deep in the crust, roughly 10–20 km down. Too deep to use.",
    safetyWhy: "MOLA 10 km p90 slope 0.57°, chosen for InSight because it is flat and smooth.",
    data: ["InSight SEIS", "MRO HiRISE", "MGS MOLA"],
  },
];

window.FILTERS = [
  { id: "all", label: "All sites" },
  { id: "ice", label: "Water ice" },
  { id: "lake", label: "Ancient water" },
  { id: "rover", label: "Landers" },
  { id: "human", label: "Human landing" },
  { id: "extreme", label: "Extreme terrain" },
];

// Профили миссии: веса параметров для индекса пригодности (сумма = 1)
window.PROFILES = [
  { id: "base", label: "Greenhouse base", note: "Long stay: water, sunlight for power and crops, thicker air.",
    w: { water: 0.40, sunlight: 0.25, pressure: 0.20, terrain: 0.15, science: 0.00 } },
  { id: "landing", label: "Safe first landing", note: "Smooth ground and thicker air for entry, descent and landing.",
    w: { water: 0.15, sunlight: 0.15, pressure: 0.30, terrain: 0.40, science: 0.00 } },
  { id: "science", label: "Astrobiology", note: "Best chance to find signs of past life.",
    w: { water: 0.30, sunlight: 0.10, pressure: 0.00, terrain: 0.15, science: 0.45 } },
];

// Жёсткие ограничения зоны исследования (NASA Human Landing Sites workshop, 2015)
window.CONSTRAINTS = { maxAbsLat: 50, maxElevKm: 2, source: "NASA Human Landing Sites / Exploration Zones workshop, 2015" };

// Точки Б для кейса Езеро — реальные путевые точки марсохода Perseverance (NASA M20_waypoints).
window.TARGETS = [
  {
    id: "delta", name: "Delta front", icon: "droplets", latlng: [18.45381, 77.40690], minutes: 30, // Perseverance waypoint, sol 541
    tag: "Clays and carbonates", source: "MRO CRISM, Mars 2020 sol 541",
    why: "Layered sediments dropped by an ancient river. The best place in the crater to look for signs of past life.",
  },
  {
    id: "seitah", name: "Séítah", icon: "gem", latlng: [18.43270, 77.44129], minutes: 20, // Perseverance waypoint, sol 201
    tag: "Olivine rock", source: "Perseverance SuperCam, PIXL (sol 201)",
    why: "Olivine-rich rock that formed from slowly cooling magma and was later altered by water.",
  },
  {
    id: "margin", name: "Margin carbonates", icon: "layers", latlng: [18.48344, 77.35078], minutes: 25, // Perseverance Margin Unit entry waypoint, sol 911
    tag: "Carbonates", source: "MRO CRISM, Mars 2020 sol 911",
    why: "A carbonate band along the old shoreline. On Earth, rocks like these can keep traces of microbes.",
  },
  {
    id: "belva", name: "Belva crater rim", icon: "circle-dot", latlng: [18.48280, 77.36869], minutes: 15, // Perseverance Echo Creek / Belva rim waypoint, sol 784
    tag: "Natural cross-section", source: "MRO HiRISE, Mars 2020 sol 784",
    why: "A crater about 1 km wide cut into the delta top. Its rim exposes the delta’s layers like a slice of cake.",
  },
  {
    id: "depot", name: "Sample depot", icon: "test-tube", latlng: [18.45267, 77.40806], minutes: 10, // Three Forks depot waypoint, sol 658
    tag: "Sample tubes", source: "Mars 2020 Three Forks, sol 658",
    why: "Perseverance left a cache of sealed sample tubes on the crater floor for a future return mission.",
  },
  {
    id: "rim", name: "Crater rim lookout", icon: "telescope", latlng: [18.49057, 77.31367], minutes: 15, // Perseverance western rim climb waypoint, sol 1148
    tag: "Ancient crust", source: "MRO CTX, Mars 2020 sol 1148",
    why: "Climb toward the western rim along Perseverance’s route for older rim-margin rocks and a view across the delta.",
  },
];
