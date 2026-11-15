// Контент платформы: точки на всём Марсе, цели в Езеро и стек данных NASA.
// Высоты — приблизительные значения по MOLA (км относительно ареоида).
// water — оценка команды 0…1 по данным о льде и следах воды (см. waterWhy).
// science и safety — оценки команды 1…5.

window.SITES = [
  {
    id: "jezero", name: "Jezero Crater", icon: "droplets", ice: "Not near the surface", waterSrc: "MRO CRISM", lat: 18.38, lon: 77.58, elevKm: -2.6,
    tags: ["lake", "rover"], water: 0.5, science: 5, safety: 4, playable: true,
    blurb: "A 45 km crater that held a lake about 3.5 billion years ago. A river built a delta here, and Perseverance has been exploring it since 2021.",
    waterWhy: "CRISM mapped clays and carbonates that formed in water. Shallow ice is unlikely this close to the equator.",
    safetyWhy: "A rover already landed here, and HiRISE elevation models cover the crater floor in 1 m detail.",
    data: ["MRO HiRISE", "MRO CRISM", "MRO CTX", "MGS MOLA", "Mars 2020 MEDA"],
  },
  {
    id: "gale", name: "Gale Crater", icon: "mountain", ice: "Not near the surface", waterSrc: "MSL Curiosity, MRO CRISM", lat: -5.4, lon: 137.8, elevKm: -4.5,
    tags: ["lake", "rover"], water: 0.4, science: 5, safety: 4,
    blurb: "Home of Curiosity and Mount Sharp, a 5 km stack of layered rock that records how Mars dried out.",
    waterWhy: "Curiosity found mudstones from a long-lived lake. No shallow ice.",
    safetyWhy: "Landed rover, well-mapped floor, but steep slopes on Mount Sharp.",
    data: ["MSL Curiosity RAD", "MSL Curiosity REMS", "MRO HiRISE", "MRO CRISM"],
  },
  {
    id: "arcadia", name: "Arcadia Planitia", icon: "snowflake", ice: "Within ~1 m", waterSrc: "MRO SHARAD, SWIM", lat: 47.0, lon: -170.0, elevKm: -4.0,
    tags: ["ice", "human"], water: 0.9, science: 3, safety: 5,
    blurb: "Smooth northern plains with ice close to the surface. Often named as a place where astronauts could mine water.",
    waterWhy: "SHARAD radar and the SWIM ice maps show water ice within about a meter of the surface.",
    safetyWhy: "Flat, smooth and low, so landing is easier and the air is a bit thicker.",
    data: ["MRO SHARAD", "Mars Odyssey GRS", "SWIM ice maps", "MRO HiRISE"],
  },
  {
    id: "deuteronilus", name: "Deuteronilus Mensae", icon: "snowflake", ice: "~1–10 m under debris", waterSrc: "MRO SHARAD", lat: 44.0, lon: 22.0, elevKm: -3.0,
    tags: ["ice", "human"], water: 0.9, science: 4, safety: 3,
    blurb: "Flat-topped mesas wrapped in glaciers buried under a thin layer of rock and dust.",
    waterWhy: "SHARAD sees nearly pure ice under the debris cover of these glaciers.",
    safetyWhy: "Plenty of water, but mesa cliffs make walking routes tricky.",
    data: ["MRO SHARAD", "MRO CTX", "MRO HiRISE", "MGS MOLA"],
  },
  {
    id: "utopia", name: "Utopia Planitia", icon: "snowflake", ice: "Buried deposit, meters deep", waterSrc: "MRO SHARAD", lat: 49.7, lon: 118.0, elevKm: -4.2,
    tags: ["ice", "human", "rover"], water: 0.85, science: 3, safety: 5,
    blurb: "A giant impact basin. Viking 2 landed here in 1976.",
    waterWhy: "SHARAD found a buried ice deposit holding about as much water as Lake Superior.",
    safetyWhy: "Wide, flat plains. Cold winters at this latitude.",
    data: ["MRO SHARAD", "MRO HiRISE", "Viking 2 lander", "MGS MOLA"],
  },
  {
    id: "hellas", name: "Hellas Planitia", icon: "waves", ice: "Buried glaciers on the rim", waterSrc: "MRO SHARAD", lat: -42.4, lon: 70.5, elevKm: -7.0,
    tags: ["ice", "extreme"], water: 0.6, science: 3, safety: 2,
    blurb: "The deepest basin on Mars. The air at the bottom is almost twice as dense as on the highlands.",
    waterWhy: "Pressure here is above water’s triple point (≈611 Pa). SHARAD found buried glaciers on the basin rim.",
    safetyWhy: "Big dust storms often start here.",
    data: ["MGS MOLA", "MRO SHARAD", "MRO MARCI"],
  },
  {
    id: "olympus", name: "Olympus Mons", icon: "triangle", ice: "None known", waterSrc: "MGS MOLA", lat: 18.65, lon: -133.8, elevKm: 21.9,
    tags: ["extreme"], water: 0.1, science: 3, safety: 1,
    blurb: "The tallest volcano in the solar system, about 22 km above the Martian datum.",
    waterWhy: "Almost no water. The summit air is around a tenth of the pressure on the plains.",
    safetyWhy: "Very thin air and cliffs up to 8 km tall around the base.",
    data: ["MGS MOLA", "MRO CTX", "Viking orbiters"],
  },
  {
    id: "valles", name: "Valles Marineris", icon: "layers", ice: "Hydrated minerals only", waterSrc: "MRO CRISM", lat: -13.9, lon: -59.2, elevKm: -5.0,
    tags: ["extreme"], water: 0.5, science: 4, safety: 2,
    blurb: "A canyon system about 4,000 km long and up to 7 km deep.",
    waterWhy: "CRISM maps hydrated sulfates in the canyon’s layered deposits.",
    safetyWhy: "Huge cliffs and landslides. Amazing for science, hard to walk.",
    data: ["MRO CRISM", "MRO HiRISE", "Mars Odyssey THEMIS", "MGS MOLA"],
  },
  {
    id: "gusev", name: "Gusev Crater", icon: "bot", ice: "Not near the surface", waterSrc: "MER Spirit", lat: -14.57, lon: 175.47, elevKm: -1.9,
    tags: ["rover", "lake"], water: 0.35, science: 4, safety: 4,
    blurb: "Spirit’s landing site. A river channel once drained into this crater.",
    waterWhy: "Spirit found silica-rich deposits, likely from ancient hot springs.",
    safetyWhy: "Rover-tested terrain, though Spirit got stuck in soft soil.",
    data: ["MER Spirit", "MRO HiRISE", "MGS MOLA"],
  },
  {
    id: "meridiani", name: "Meridiani Planum", icon: "bot", ice: "Not near the surface", waterSrc: "MER Opportunity, MGS TES", lat: -1.95, lon: -5.53, elevKm: -1.4,
    tags: ["rover"], water: 0.4, science: 4, safety: 5,
    blurb: "Opportunity’s home for 14 years, chosen after orbiters spotted hematite.",
    waterWhy: "Opportunity found hematite “blueberries” and sulfate rocks formed in acidic water.",
    safetyWhy: "One of the flattest, safest places on the planet.",
    data: ["MER Opportunity", "MGS TES", "MRO CRISM"],
  },
  {
    id: "phoenix", name: "Phoenix site", icon: "snowflake", ice: "~5 cm below the soil", waterSrc: "Phoenix lander", lat: 68.22, lon: -125.75, elevKm: -4.1,
    tags: ["ice", "rover"], water: 1.0, science: 4, safety: 3,
    blurb: "Arctic plains where the Phoenix lander dug into the soil in 2008.",
    waterWhy: "Phoenix exposed water ice a few centimeters down and saw it sublimate.",
    safetyWhy: "Ice is easy to reach, but the long polar winter covers everything in CO₂ frost.",
    data: ["Phoenix lander", "Mars Odyssey GRS", "MRO HiRISE"],
  },
  {
    id: "polar", name: "North polar cap", icon: "snowflake", ice: "Exposed ice cap", waterSrc: "MRO SHARAD, MGS MOLA", lat: 85.0, lon: 0.0, elevKm: -2.7,
    tags: ["ice", "extreme"], water: 1.0, science: 4, safety: 1,
    blurb: "Kilometers of layered water ice and dust, a record of past climate.",
    waterWhy: "The largest water reservoir we know of on Mars.",
    safetyWhy: "Months of darkness and extreme cold.",
    data: ["MRO SHARAD", "MGS MOLA", "MRO HiRISE"],
  },
  {
    id: "nili", name: "Nili Fossae", icon: "gem", ice: "Hydrated minerals only", waterSrc: "MRO CRISM", lat: 22.6, lon: 76.8, elevKm: -0.6,
    tags: ["lake"], water: 0.45, science: 5, safety: 3,
    blurb: "Troughs next to Jezero with some of the richest clay and olivine exposures on Mars.",
    waterWhy: "CRISM maps clays and carbonates altered by water.",
    safetyWhy: "Rough terrain inside the troughs.",
    data: ["MRO CRISM", "MRO CTX", "MGS MOLA"],
  },
  {
    id: "elysium", name: "Elysium Planitia", icon: "activity", ice: "Liquid water ~10–20 km deep", waterSrc: "InSight SEIS", lat: 4.5, lon: 135.6, elevKm: -2.6,
    tags: ["rover"], water: 0.3, science: 3, safety: 5,
    blurb: "InSight listened for marsquakes here from 2018 to 2022.",
    waterWhy: "InSight’s seismic data suggest liquid water deep in the crust, roughly 10–20 km down. Too deep to use.",
    safetyWhy: "Picked for InSight because it is flat and smooth.",
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

// Точка А — жилой модуль на месте посадки Perseverance (координаты по данным NASA)
window.HABITAT = {
  id: "habitat", name: "Habitat", icon: "house", latlng: [18.4447, 77.4508],
  why: "Octavia E. Butler landing site, where Perseverance touched down in 2021.",
};

// Точки Б для кейса Езеро. Положение сверено со снимками HiRISE/CTX в приложении; для научной точности — по картам CRISM.
window.TARGETS = [
  {
    id: "delta", category: "Sedimentary", evidence: "Rover observation", name: "Delta front", icon: "droplets", latlng: [18.455, 77.405], minutes: 30,
    tag: "Clays and carbonates", source: "MRO CRISM",
    why: "Layered sediments dropped by an ancient river. The best place in the crater to look for signs of past life.",
  },
  {
    id: "seitah", category: "Igneous", evidence: "Rover observation", name: "Séítah", icon: "gem", latlng: [18.43, 77.43], minutes: 20,
    tag: "Olivine rock", source: "Perseverance SuperCam, PIXL",
    why: "Olivine-rich rock that formed from slowly cooling magma and was later altered by water.",
  },
  {
    id: "margin", category: "Carbonate", evidence: "Orbital detection", name: "Margin carbonates", icon: "layers", latlng: [18.44, 77.33], minutes: 25,
    tag: "Carbonates", source: "MRO CRISM",
    why: "A carbonate band along the old shoreline. On Earth, rocks like these can keep traces of microbes.",
  },
  {
    id: "belva", category: "Impact and layers", evidence: "Rover imaging", name: "Belva crater rim", icon: "circle-dot", latlng: [18.4800, 77.3825], minutes: 15,
    tag: "Natural cross-section", source: "MRO HiRISE",
    why: "A crater about 1 km wide cut into the delta top. Its rim exposes the delta’s layers like a slice of cake.",
  },
  {
    id: "depot", category: "Sample cache", evidence: "Rover operation", name: "Sample depot", icon: "test-tube", latlng: [18.452, 77.44], minutes: 10,
    tag: "Sample tubes", source: "Mars 2020 mission",
    why: "Perseverance left a cache of sealed sample tubes on the crater floor for a future return mission.",
  },
  {
    id: "rim", category: "Crater rim", evidence: "Orbital mapping", name: "Crater rim lookout", icon: "telescope", latlng: [18.505, 77.32], minutes: 15,
    tag: "Ancient crust", source: "MRO CTX, MGS MOLA",
    why: "Climb toward the western rim for a view over the whole delta and rocks older than the lake.",
  },
];

// Стек данных NASA. status: used — уже в продукте, demo — пока примерные значения, next — следующий шаг
window.DATASETS = [
  { name: "MGS MOLA", mission: "Mars Global Surveyor", icon: "mountain", status: "used",
    what: "Global elevation from laser altimetry.", how: "Elevation of every site → air pressure parameter and the +2 km landing limit." },
  { name: "Viking global mosaic", mission: "Viking orbiters, via NASA 3D Resources", icon: "globe", status: "used",
    what: "Color image of the whole planet.", how: "Texture of the 3D globe and the 2D map." },
  { name: "Mars Trek WMTS", mission: "NASA/JPL Trek", icon: "layers", status: "used",
    what: "Online map tiles of Mars.", how: "Optional imagery layer in the mission map." },
  { name: "HiRISE DTM", mission: "Mars Reconnaissance Orbiter", icon: "scan-search", status: "demo",
    what: "1 m elevation models from stereo images.", how: "Slopes and the walking route. Demo terrain now, pipeline ready (prepare_terrain.py)." },
  { name: "CRISM", mission: "Mars Reconnaissance Orbiter", icon: "flask-conical", status: "used",
    what: "Mineral maps from infrared spectra.", how: "Water evidence for dry sites and the science targets in Jezero." },
  { name: "SHARAD + SWIM", mission: "MRO, Mars Odyssey", icon: "radar", status: "used",
    what: "Radar and neutron maps of buried ice.", how: "Water access parameter for ice-rich sites." },
  { name: "MEDA weather", mission: "Mars 2020 Perseverance", icon: "wind", status: "demo",
    what: "Temperature, pressure, wind and dust at Jezero.", how: "Go or no-go for the walk. Sample values for now." },
  { name: "SuperCam, PIXL", mission: "Mars 2020 Perseverance", icon: "telescope", status: "used",
    what: "Rock chemistry measured by the rover.", how: "Descriptions of science targets." },
  { name: "RAD", mission: "MSL Curiosity", icon: "atom", status: "used",
    what: "Radiation dose on the surface, about 0.67 mSv per day.", how: "Radiation dose of each walk." },
  { name: "Mars24 time", mission: "NASA GISS", icon: "clock", status: "used",
    what: "Algorithm for Mars time and sol numbers.", how: "Live Jezero clock and daylight window." },
];
