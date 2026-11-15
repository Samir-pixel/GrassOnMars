# Промпт: машины + пустая карта Gale (модульный Marswalk)

Скопируйте в чат с репозиторием GrassOnMars / Marswalk.

---

Ты дорабатываешь **модульный** Marswalk (`frontend/public/js/*` + FastAPI), не монолитный HTML.

## A. Баг: Gale Crater — «пустая» карта

Симптом: после выбора Gale на карте почти ничего не видно.

Причина: первая IAU-цель (Yellowknife) почти совпадает с точкой посадки → `flyToBounds` уходит в `maxZoom: 13` в один пиксель MOLA 463 m; CTX/HiRISE нет; слой slope на ровном дне прозрачен.

Сделай:

1. При сборке целей вне Jezero отфильтруй точки вне сетки DEM и ближе ~1.5 km к habitat; дефолт — первая оставшаяся (или custom 0.1° east).
2. Для регионов на MOLA (`region.id !== "jezero"`) после загрузки вызывай `mission.fit()` (весь window), не `flyToBounds(..., maxZoom: 13)`.
3. Вне Jezero по умолчанию включи слой **Elevation** (картинка DEM всегда видна); Orbital imagery / slope оставь как есть.

## B. Интеграция `marswalk-vehicles` без поломки backend-маршрутов

Архив: `marswalk-vehicles/` (`vehicle-router.js`, `vehicles.json`, `images/cutouts|scenes`, тест).

Важно: пешие маршруты сейчас считает **backend** (`POST /routes/plan`). `VehicleRouter` — клиентский A* по той же сетке `Router.createTerrain`. `window.Router` сейчас **без** `findPath`/`summarize` (они нужны для last-mile и теста).

Сделай минимально:

1. Верни в `frontend/public/js/router.js` `passable`, `stepCost`, `Heap`, `findPath`, `summarize` из `marswalk-vehicles/source/router_from_site.js`. Не трогай `walkSeconds` / backend-поток для `foot`.
2. Скопируй `vehicle-router.js` → `frontend/public/js/vehicle-router.js`. Картинки cutouts + scenes → `frontend/public/vehicles/…`. Подключи скрипт сразу после `router.js`.
3. UI «Choose how the crew moves» над Route options (карточки foot / mrv / sev / mars_rover, hero scene, токены сайта, `.sys-photo`). Цифры только из `VehicleRouter.VEHICLES` / `vehicles.json`. Подпись: параметры — допущения команды.
4. `opts.vehicle` (default `"foot"`). Смена машины → invalidate + calculate; `maxSlope` слайдер = `VEHICLES[id].maxSlope` (foot 15).
5. `calculate`: `foot` — как сейчас backend. Иначе для short/safe/sci вызывай `VehicleRouter.planTrip` (режимы `distance` / `safe` / `time`; sci — через mid science waypoint если есть, иначе `time`). Собери variants в формате панели; `eva`/`go`/`reasons` из плана машины.
6. Карта: drive — сплошная линия, walk — пунктир; иконка машины в точке парковки.
7. Сводка: время, батарея %, O₂ %, walk-back для MRV; человекочитаемые reasons (battery/radius/duration/suit/walkback/dust/daylight).
8. Проверка: `node marswalk-vehicles/source/vehicle-router.test.js`; в UI Gale показывает рельеф; смена машины меняет маршрут.

Не дублируй параметры машин. Не ломай Jezero CTX и backend foot. Не тащи GLB в первый проход.

---
