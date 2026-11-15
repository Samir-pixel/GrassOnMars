// Фото, итоги экспедиций, «погодные близнецы» на Земле и метки посадочных аппаратов.
// Все снимки — из NASA Photojournal (PIA-номера проверены по каталогу). Подписи — краткий пересказ.

window.PJ_PAGE = (pia) => `https://photojournal.jpl.nasa.gov/catalog/${pia}`;
window.PJ_IMG = (pia) => {
  const n = pia.toLowerCase();
  return `https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/pia/${n.slice(0, 5)}/${n}/${pia}.jpg?w=900`;
};

window.PHOTOS = {
  jezero: [
    { pia: "PIA24921", title: "Detailed panorama of the Jezero delta", by: "Perseverance, Mastcam-Z", note: "Rocks of the ancient river delta, the main target of the mission." },
    { pia: "PIA25671", title: "Eastern edge of the delta", by: "Perseverance, Mastcam-Z", note: "Eroded delta front seen on 7 April 2022." },
    { pia: "PIA23727", title: "First high-resolution panorama", by: "Perseverance, Mastcam-Z", note: "Taken on sol 4; the delta front is about 2 km away." },
  ],
  gale: [
    { pia: "PIA22207", title: "Mount Sharp behind Curiosity", by: "Curiosity, MAHLI", note: "Self-portrait on Vera Rubin Ridge, January 2018." },
    { pia: "PIA22210", title: "Wide panorama from Vera Rubin Ridge", by: "Curiosity, Mastcam", note: "Crater floor and rim along five years of the rover’s route." },
  ],
  gusev: [
    { pia: "PIA11746", title: "Full-circle panorama at Home Plate", by: "Spirit, Pancam", note: "Spirit’s third winter site on the edge of Home Plate." },
    { pia: "PIA11758", title: "Wheel churns up bright soil", by: "Spirit, Pancam", note: "A stuck wheel exposed soil of nearly pure silica." },
  ],
  meridiani: [
    { pia: "PIA18885", title: "“Blueberries” in the Last Chance rock", by: "Opportunity, Microscopic Imager", note: "Hematite concretions, evidence of water-soaked rock." },
    { pia: "PIA05588", title: "Berries here, there, everywhere", by: "Opportunity, Pancam", note: "Spherules scattered across the plains." },
  ],
  phoenix: [
    { pia: "PIA10906", title: "Disappearing ice", by: "Phoenix, Surface Stereo Imager", note: "Ice in the Dodo-Goldilocks trench sublimates over four days." },
    { pia: "PIA11383", title: "Deeper trenches reach the ice layer", by: "Phoenix, Surface Stereo Imager", note: "Bluish-white ice under a few centimeters of soil." },
  ],
  utopia: [
    { pia: "PIA00571", title: "Ice on Utopia Planitia", by: "Viking Lander 2", note: "A thin frost coating, photographed on 18 May 1979." },
    { pia: "PIA12220", title: "Ice dug up by a fresh impact", by: "MRO HiRISE", note: "Water ice confirmed by CRISM at 55.6°N." },
  ],
  arcadia: [
    { pia: "PIA26321", title: "Icy crater in Arcadia Planitia", by: "MRO HiRISE", note: "A 13 m crater exposed ice in its floor and ejecta." },
    { pia: "PIA12219", title: "Fresh crater excavates ice", by: "MRO HiRISE", note: "Bright buried ice at 46°N, near Arcadia." },
  ],
  olympus: [
    { pia: "PIA02982", title: "Color mosaic of Olympus Mons", by: "Viking Orbiter 1", note: "About 600 km across; summit caldera ~24 km above the plains." },
    { pia: "PIA00300", title: "Olympus Mons mosaic", by: "Viking", note: "Ringed by a scarp up to 6 km high." },
  ],
  valles: [
    { pia: "PIA00426", title: "Valles Marineris and Chryse outflow channels", by: "Viking", note: "The whole canyon system, from Noctis Labyrinthus eastward." },
    { pia: "PIA00003", title: "Viking hemisphere mosaic", by: "Viking Orbiter 1", note: "Canyons over 3,000 km long and up to 8 km deep." },
  ],
  polar: [
    { pia: "PIA07118", title: "North polar layers", by: "MGS Mars Orbiter Camera", note: "Fine layers under the water-ice cap may record climate history." },
    { pia: "PIA03666", title: "Layered slope near 82.6°N", by: "MGS Mars Orbiter Camera", note: "Ice-and-dust layers exposed by erosion." },
  ],
  elysium: [
    { pia: "PIA19143", title: "InSight landing region", by: "Mars Reconnaissance Orbiter", note: "The flat Elysium Planitia ellipse chosen for InSight." },
  ],
};

window.EXPEDITIONS = {
  jezero: { mission: "Perseverance (Mars 2020)", years: "Landed 18 Feb 2021", icon: "bot",
    results: ["Explored the crater floor and the river delta", "Left 10 sealed sample tubes at the “Three Forks” depot (Dec 2022–Jan 2023)", "Carried Ingenuity, the first aircraft to fly on another planet"] },
  gale: { mission: "Curiosity (MSL)", years: "Landed Aug 2012", icon: "bot",
    results: ["Found an ancient lake environment that could have supported microbes", "Climbing the 5 km tall Mount Sharp through its layers", "REMS station recorded winter nights below −120 °C"] },
  gusev: { mission: "Spirit (MER-A)", years: "2004–2010", icon: "bot",
    results: ["Found nearly pure silica near Home Plate, a sign of hot springs or steam vents", "Explored the Columbia Hills", "Last contact in March 2010"] },
  meridiani: { mission: "Opportunity (MER-B)", years: "2004–2018", icon: "bot",
    results: ["Hematite “blueberries” showed the rock was once soaked in water", "Sulfate rocks point to acidic water", "Worked for over 14 years, far beyond its 90-day plan"] },
  phoenix: { mission: "Phoenix", years: "May–Nov 2008", icon: "satellite-dish",
    results: ["Dug into the soil and exposed water ice a few cm down", "Watched the ice sublimate over a few days", "Detected perchlorate salts in the soil"] },
  elysium: { mission: "InSight", years: "Nov 2018–Dec 2022", icon: "activity",
    results: ["Recorded more than 1,300 marsquakes", "Largest one: magnitude 4.7 on 4 May 2022", "Measured the structure of the Martian crust, mantle and core"] },
  utopia: { mission: "Viking Lander 2", years: "Landed 3 Sep 1976", icon: "satellite-dish",
    results: ["First lander to photograph frost on the Martian surface", "Measured weather on the northern plains for years", "Searched the soil for signs of life"] },
  arcadia: { mission: "Mars Reconnaissance Orbiter", years: "Orbiting since 2006", icon: "satellite",
    results: ["HiRISE and CTX found fresh craters that dug up buried water ice", "SHARAD radar mapped ice under the plains"] },
  olympus: { mission: "Viking orbiters, MGS", years: "1976–1980, 1997–2006", icon: "satellite",
    results: ["Mapped the volcano’s summit calderas and cliffs", "MOLA laser altimeter measured its height"] },
  valles: { mission: "Viking orbiters, MRO", years: "1976–present", icon: "satellite",
    results: ["Mapped the full canyon system", "CRISM found hydrated sulfates in its layers"] },
  polar: { mission: "Mars Global Surveyor, MRO", years: "1997–present", icon: "satellite",
    results: ["MOC imaged layered ice and dust deposits", "SHARAD radar sounded the ice cap’s internal layers"] },
};

// Метеостанции на поверхности: проверенные измерения
window.STATIONS = {
  jezero: { station: "Perseverance MEDA", text: "−83 °C at night to −22 °C by day (spring 2021); nights can reach −90 °C", min: -83, max: -22 },
  utopia: { station: "Viking Landers 1 and 2", text: "−107 °C to −17 °C, measured 1.5 m above the ground", min: -107, max: -17 },
  gale: { station: "Curiosity REMS", text: "Winter nights below −120 °C", min: -120, max: null },
};

// «Погодный близнец» на Земле: где условия похожи по холоду, сухости или рельефу
window.EARTH_TWINS = {
  jezero: { place: "Antarctic Plateau, Vostok Station", country: "Antarctica", flag: "aq", latlng: [-78.46, 106.84], wiki: "Vostok_Station",
    why: "Jezero nights (−83 °C) are close to Vostok’s record low of −89.2 °C, the coldest air ever measured on Earth.", icon: "snowflake" },
  gale: { place: "Antarctic Plateau in polar night", country: "Antarctica", flag: "aq", latlng: [-80.37, 77.35], wiki: "Antarctic_Plateau",
    why: "Gale’s winter nights below −120 °C are colder than anywhere on Earth; the Antarctic plateau is the nearest match.", icon: "snowflake" },
  arcadia: { place: "Devon Island, Haughton crater", country: "Canada", flag: "ca", latlng: [75.38, -89.68], wiki: "Devon_Island",
    why: "A polar desert with ice in the ground and patterned soil; NASA uses its Haughton crater as a Mars analog site.", icon: "snowflake" },
  deuteronilus: { place: "McMurdo Dry Valleys", country: "Antarctica", flag: "aq", latlng: [-77.5, 162.0], wiki: "McMurdo_Dry_Valleys",
    why: "Cold, dry winds and glaciers buried under rock debris, like the mesas’ ice.", icon: "wind" },
  utopia: { place: "Oymyakon, Siberia", country: "Russia", flag: "ru", latlng: [63.46, 142.79], wiki: "Oymyakon",
    why: "Viking 2 measured −107 °C to −17 °C, a deep winter that never warms up. Oymyakon, one of the coldest inhabited places, has recorded about −68 °C.", icon: "snowflake" },
  hellas: { place: "Dead Sea shore, the lowest point on land", country: "Jordan Rift Valley", flag: null, latlng: [31.5, 35.5], wiki: "Dead_Sea",
    why: "Like the Dead Sea for Earth, Hellas holds Mars’s densest air, though it is still thinner than on Everest’s summit.", icon: "mountain" },
  olympus: { place: "Earth’s stratosphere, ~50 km up", country: "No place on the ground", flag: null, latlng: null, wiki: "Stratosphere",
    why: "The summit air matches Earth’s sky about 50 km up, above almost all weather balloons.", icon: "plane" },
  valles: { place: "Grand Canyon, scaled up", country: "United States", flag: "us", latlng: [36.1, -112.1], wiki: "Grand_Canyon",
    why: "About 4,000 km long and up to 7 km deep, roughly ten times longer and four times deeper.", icon: "mountain" },
  gusev: { place: "El Tatio geysers", country: "Chile", flag: "cl", latlng: [-22.33, -68.01], wiki: "El_Tatio",
    why: "Silica deposits from hot springs, similar to the opal-like silica Spirit found.", icon: "flame" },
  meridiani: { place: "Río Tinto", country: "Spain", flag: "es", latlng: [37.7, -6.55], wiki: "Rio_Tinto_(river)",
    why: "Acidic, iron-rich water forms sulfate and hematite minerals like those Opportunity found.", icon: "droplets" },
  phoenix: { place: "Permafrost polygons, Svalbard", country: "Norway", flag: "no", latlng: [78.2, 15.8], wiki: "Patterned_ground",
    why: "Ice a few centimeters under the soil cracks the ground into polygons, as on the Phoenix plains.", icon: "snowflake" },
  polar: { place: "Greenland ice sheet", country: "Greenland", flag: "gl", latlng: [72.6, -38.5], wiki: "Greenland_ice_sheet",
    why: "Layer after layer of ice and dust record past climate, just like Earth’s ice cores.", icon: "layers" },
  nili: { place: "Atacama Desert", country: "Chile", flag: "cl", latlng: [-24.5, -69.25], wiki: "Atacama_Desert",
    why: "Very dry, salty and UV-rich; NASA tests rover instruments there.", icon: "sun" },
  elysium: { place: "Atacama Desert", country: "Chile", flag: "cl", latlng: [-24.5, -69.25], wiki: "Atacama_Desert",
    why: "A flat, dry, dusty plain under strong sunlight, where Mars instruments are tested.", icon: "sun" },
};

// Посадочные аппараты NASA (координаты по данным миссий)
window.MISSIONS = [
  { id: "m2020", name: "Perseverance", lat: 18.44, lon: 77.45, year: "2021", site: "jezero", icon: "bot" },
  { id: "msl", name: "Curiosity", lat: -4.59, lon: 137.44, year: "2012", site: "gale", icon: "bot" },
  { id: "spirit", name: "Spirit", lat: -14.57, lon: 175.47, year: "2004", site: "gusev", icon: "bot" },
  { id: "oppy", name: "Opportunity", lat: -1.95, lon: -5.53, year: "2004", site: "meridiani", icon: "bot" },
  { id: "phx", name: "Phoenix", lat: 68.22, lon: -125.75, year: "2008", site: "phoenix", icon: "satellite-dish" },
  { id: "insight", name: "InSight", lat: 4.50, lon: 135.62, year: "2018", site: "elysium", icon: "activity" },
  { id: "vl1", name: "Viking 1", lat: 22.70, lon: -48.22, year: "1976", site: null, icon: "satellite-dish",
    summary: "Viking 1 landed in Chryse Planitia on 20 July 1976, the first successful US landing on Mars. Its weather station measured −107 °C to −17 °C together with Viking 2." },
  { id: "vl2", name: "Viking 2", lat: 48.27, lon: 134.01, year: "1976", site: "utopia", icon: "satellite-dish" },
];

// Высота в стандартной атмосфере Земли с тем же давлением (US Standard Atmosphere 1976)
window.earthAltitudeForPressure = function (pa) {
  const t = [[25, 2549.2], [30, 1197.0], [32, 868.0], [35, 574.6], [40, 287.1], [45, 149.1], [47, 110.9], [50, 79.8], [55, 42.5]];
  if (pa >= t[0][1]) return t[0][0];
  for (let i = 0; i < t.length - 1; i++) {
    const [h1, p1] = t[i], [h2, p2] = t[i + 1];
    if (pa <= p1 && pa >= p2) return h1 + (Math.log(p1 / pa) / Math.log(p1 / p2)) * (h2 - h1);
  }
  return 55;
};

// Подробности экспедиций для окна «Подробнее»
window.EXPEDITION_DETAILS = {
  jezero: {
    facts: [["Launched", "30 Jul 2020"], ["Landed", "18 Feb 2021"], ["Landing site", "Octavia E. Butler"], ["Type", "Rover"]],
    instruments: ["Mastcam-Z", "SuperCam", "PIXL", "SHERLOC", "MEDA weather station", "RIMFAX radar", "MOXIE"],
    story: "Perseverance landed on the floor of Jezero crater to search an ancient lake and river delta for signs of past microbial life and to collect rock samples for a future return to Earth.",
    more: ["MOXIE made oxygen from the CO₂ atmosphere, a first test of making breathable air and rocket propellant on Mars.",
      "Ingenuity made its first powered flight on 19 Apr 2021 and flew 72 times.",
      "The rover drove up the delta front and later toward the crater rim, sampling different rock layers."],
    link: "https://science.nasa.gov/mission/mars-2020-perseverance/",
  },
  gale: {
    facts: [["Launched", "26 Nov 2011"], ["Landed", "6 Aug 2012 (UTC)"], ["Location", "Gale crater, Aeolis Mons"], ["Type", "Rover"]],
    instruments: ["Mastcam", "ChemCam", "CheMin", "SAM", "MAHLI", "APXS", "RAD", "REMS", "DAN"],
    story: "Curiosity studies whether Gale crater was ever habitable by climbing through the layers of Mount Sharp, each recording a different time in Mars’s history.",
    more: ["Showed that an ancient lake at Yellowknife Bay had the chemistry microbes could have used.",
      "Found organic molecules preserved in mudstone about 3 billion years old.",
      "RAD measured the radiation dose a crew would get on the surface; REMS records daily weather."],
    link: "https://science.nasa.gov/mission/msl-curiosity/",
  },
  gusev: {
    facts: [["Launched", "10 Jun 2003"], ["Landed", "4 Jan 2004"], ["Last contact", "22 Mar 2010"], ["Distance driven", "7.73 km"]],
    instruments: ["Pancam", "Mini-TES", "Mössbauer spectrometer", "APXS", "Microscopic Imager", "Rock Abrasion Tool"],
    story: "Spirit landed in Gusev crater, which looked like an old lake bed from orbit. The plains turned out to be volcanic, so the rover drove to the Columbia Hills to find older rock.",
    more: ["Found nearly pure silica near Home Plate, likely from hot springs or steam vents.",
      "Got stuck in soft soil in 2009 and kept working as a stationary platform until 2010.",
      "Planned for 90 days, it worked for over six years."],
    link: "https://science.nasa.gov/mission/mer-spirit/",
  },
  meridiani: {
    facts: [["Launched", "7 Jul 2003"], ["Landed", "25 Jan 2004"], ["Last contact", "10 Jun 2018"], ["Distance driven", "45.16 km"]],
    instruments: ["Pancam", "Mini-TES", "Mössbauer spectrometer", "APXS", "Microscopic Imager", "Rock Abrasion Tool"],
    story: "Opportunity went to Meridiani Planum because orbiters saw the mineral hematite there, which often forms in water.",
    more: ["Its first rocks held hematite “blueberries” and sulfate salts, proof of past water at the surface.",
      "Explored Endurance, Victoria and Endeavour craters over more than 14 years.",
      "A planet-wide dust storm in 2018 covered its solar panels and ended the mission."],
    link: "https://science.nasa.gov/mission/mer-opportunity/",
  },
  phoenix: {
    facts: [["Launched", "4 Aug 2007"], ["Landed", "25 May 2008"], ["Last contact", "2 Nov 2008"], ["Type", "Stationary lander"]],
    instruments: ["Robotic arm and scoop", "TEGA oven analyser", "MECA wet chemistry lab", "Surface Stereo Imager", "Weather station with lidar"],
    story: "Phoenix was the first mission to land in the Martian arctic. It dug into the ground to touch the water ice that orbiters had detected below the surface.",
    more: ["Exposed bright ice a few centimetres down and watched chunks of it sublimate.",
      "Found perchlorate salts, which matter for both life and human health.",
      "Its lidar saw snow falling from clouds before it reached the ground."],
    link: "https://science.nasa.gov/mission/phoenix/",
  },
  elysium: {
    facts: [["Launched", "5 May 2018"], ["Landed", "26 Nov 2018"], ["Mission ended", "Dec 2022"], ["Type", "Stationary lander"]],
    instruments: ["SEIS seismometer", "HP³ heat probe", "RISE radio science", "TWINS weather sensors"],
    story: "InSight listened to the inside of Mars. Seismic waves from marsquakes and meteorite impacts revealed the planet’s layers.",
    more: ["Recorded more than 1,300 marsquakes; the largest was magnitude 4.7 on 4 May 2022.",
      "Measured the thickness of the crust and showed that Mars has a liquid metal core.",
      "Dust on its solar panels slowly cut its power until the mission ended."],
    link: "https://science.nasa.gov/mission/insight/",
  },
  utopia: {
    facts: [["Launched", "9 Sep 1975"], ["Landed", "3 Sep 1976"], ["Lander worked until", "Apr 1980"], ["Type", "Lander"]],
    instruments: ["Cameras", "Biology experiments", "Gas chromatograph mass spectrometer", "Seismometer", "Weather station"],
    story: "Viking 2 landed on the northern plains of Utopia Planitia, about 7,500 km from Viking 1, to look for life and to study weather and soil.",
    more: ["Photographed thin frost on the ground during winter.",
      "Its biology experiments gave puzzling results that are still discussed today.",
      "Recorded weather for more than three Earth years."],
    link: "https://science.nasa.gov/mission/viking/",
  },
  arcadia: {
    facts: [["Launched", "12 Aug 2005"], ["Arrived at Mars", "10 Mar 2006"], ["Orbit", "About 250–320 km"], ["Type", "Orbiter"]],
    instruments: ["HiRISE camera", "CTX camera", "CRISM spectrometer", "SHARAD radar", "Mars Climate Sounder", "MARCI"],
    story: "The Mars Reconnaissance Orbiter maps the planet in great detail and relays data from rovers. It is the main source of ice evidence for the northern plains.",
    more: ["Fresh impact craters dug up bright water ice that slowly faded as it sublimated.",
      "SHARAD radar mapped thick ice under parts of Arcadia and Utopia Planitia.",
      "Its HiRISE images are used to choose safe landing sites."],
    link: "https://science.nasa.gov/mission/mars-reconnaissance-orbiter/",
  },
  olympus: {
    facts: [["Viking 1 orbiter arrived", "19 Jun 1976"], ["MGS arrived", "Sep 1997"], ["Height", "About 22 km above datum"], ["Type", "Orbiters"]],
    instruments: ["Viking visual cameras", "MOLA laser altimeter"],
    story: "Olympus Mons was mapped from orbit. Viking took the first detailed mosaics; Mars Global Surveyor’s laser altimeter measured its shape.",
    more: ["Its base is about 600 km across and ringed by cliffs up to 6 km high.",
      "Its slopes are gentle: walking up would feel like a long climb, not a cliff.",
      "The summit air is far too thin for a human landing."],
    link: "https://science.nasa.gov/mission/viking/",
  },
  valles: {
    facts: [["Viking 1 orbiter arrived", "19 Jun 1976"], ["MRO arrived", "Mar 2006"], ["Length", "About 4,000 km"], ["Type", "Orbiters"]],
    instruments: ["Viking visual cameras", "HiRISE", "CRISM"],
    story: "Valles Marineris is a canyon system that would stretch across the United States. Orbiters mapped its walls, landslides and layered deposits.",
    more: ["Viking mosaics showed the whole system for the first time.",
      "CRISM found hydrated sulfate minerals in its layers, a sign of water.",
      "Steep walls make it a dramatic but risky place to land."],
    link: "https://science.nasa.gov/mission/viking/",
  },
  polar: {
    facts: [["MGS arrived", "Sep 1997"], ["MGS last contact", "Nov 2006"], ["MRO arrived", "Mar 2006"], ["Type", "Orbiters"]],
    instruments: ["MOC camera", "MOLA laser altimeter", "SHARAD radar", "HiRISE"],
    story: "The north polar cap is a dome of water ice kilometres thick, built from layers of ice and dust.",
    more: ["MOC images showed the fine layering exposed in troughs and cliffs.",
      "SHARAD radar traced the layers deep inside the cap.",
      "The layers may record changes in Mars’s climate over millions of years."],
    link: "https://science.nasa.gov/mission/mars-reconnaissance-orbiter/",
  },
};
