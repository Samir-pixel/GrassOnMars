# Промпт: выбор машины и пересчёт маршрута на сайте Marswalk

Скопируйте текст ниже целиком в чат, где лежит готовый HTML сайта, и приложите этот архив.

---

Ты дорабатываешь мой сайт **Marswalk (Grass on Mars)**, это один HTML-файл. Сейчас маршрут считается только пешком: модуль `window.Router` (A* по сетке рельефа, скорость по Тоблеру × 0.6, предельный уклон 15°, скафандр 8 ч, функции `findPath`, `summarize`, `evaluateEva`). Маршруты строит `buildVariant(v, start, goal)` для вариантов fast / safe / short / sci. Нужно добавить выбор машины: от выбора должны меняться путь, время, энергия и вердикт GO / NO GO.

## 1. Подключи модуль машин

- Вставь содержимое `vehicle-router.js` из архива в отдельный `<script>` **сразу после** скрипта с `window.Router`. Модуль создаёт `window.VehicleRouter`.
- Параметры машин хранятся в `VehicleRouter.VEHICLES` (`foot`, `mrv`, `sev`, `mars_rover`). Это единственный источник цифр: не дублируй их в другом месте. `vehicles.json` в архиве содержит те же значения плюс тексты для карточек.

## 2. Как считается маршрут для машины (не меняй логику, только используй)

1. **Проходимость клетки:** уклон клетки ≤ `maxSlope` машины (MRV 15°, SEV 25°, Mars Rover 18°, пешком 15°). Круче — клетка непроходима, A* ищет объезд.
2. **Время шага:** `скорость = vmaxKmh × f`, где `f = 1 − slopeSlowdown × (уклон / maxSlope)²`; в подъём `f` дополнительно умножается на `exp(−climbK × grade)`; нижняя граница `f = minSpeedFrac`. Время = длина шага / скорость.
3. **Режимы** как у пешего Router: `time` (быстрее), `safe` (время × (1 + safeWeight × (уклон/maxSlope)²)), `distance` (короче).
4. **Энергия шага (Вт·ч):** `км × whPerKm × (1 + 0.5 × (уклон/maxSlope)²) + масса × 3.71 × подъём_м / 3600 / 0.8`. Расход батареи = энергия туда и обратно / `batteryWh`.
5. **Последняя миля:** если цель на клетке, куда машина не въезжает, машина паркуется в ближайшей проходимой клетке в радиусе `lastMileM`, а остаток экипаж идёт пешком (пеший `Router.findPath`, режим `safe`).
6. **Вердикт** (`evaluateTrip`), причины NO GO:
   - `battery`: расход больше 80% батареи (резерв 20%);
   - `radius`: самая дальняя точка дальше `maxRadiusKm` от базы;
   - `duration`: поездка дольше `maxDurationH`;
   - `suit`: для открытого MRV всё время поездки в скафандре больше лимита (8 ч / 1.3); для SEV и Mars Rover скафандр считается только на пеший кусок и остановки;
   - `walkback` (только MRV, правило Apollo LRV): если машина сломается в самой дальней точке, экипаж должен успеть дойти до базы пешком в пределах лимита скафандра;
   - `dust` (τ ≥ 2) и `daylight` (возврат после 17:30 LMST): NO GO для MRV и пешком, для герметичных машин только предупреждение (`cautions`).

## 3. Что изменить в коде маршрута

- Добавь в `opts` поле `vehicle` (по умолчанию `"foot"`).
- В `buildVariant`: если `opts.vehicle === "foot"`, оставь всё как есть. Иначе вызывай
  `VehicleRouter.planTrip(Router, t, start, goal, opts.vehicle, { mode, suitHours: opts.suitHours, startHour: opts.startHour, dustTau: opts.dustTau, stopMinutes })`.
  Режим бери из варианта: fast → `time`, safe → `safe`, short → `distance`, sci → `time` через промежуточную цель (две поездки, склей `driveCells`).
- Результат `planTrip`: `driveCells` (путь машины), `walkCells` (пеший кусок или `null`), `sum` (`distance`, `maxSlope`, `outS`, `backS`, `energyWh`, `farthestM`), `totalS`, `energyUsed`, `o2Used`, `walkBackS`, `go`, `reasons`, `cautions`.
- Приведи результат к формату, который уже ждут карточки вариантов: `cells = driveCells.concat(walkCells?.slice(1) || [])`, `eva = { totalS, go, reasons, o2Used }`, `sum` из `planTrip`. Профиль высот, `difficulty` и `score` считай как сейчас.
- При смене машины пересчитывай все варианты и перерисовывай карту, как при смене цели.
- Кнопка «Raise the limit» и текст «No path within N° slopes» должны брать `maxSlope` выбранной машины.

## 4. Интерфейс в стиле сайта

- Блок **«Choose how the crew moves»** в разделе Plan the walk, над вариантами маршрута. Готовый пример вёрстки в `vehicle-picker-demo.html`: те же токены (`--panel`, `--line`, `--accent`, `--r-xl`), шрифты Archivo / Inter Tight / JetBrains Mono, карточки как `.card.sys` с `.sys-photo`.
- Четыре карточки: On foot, NASA MRV, NASA SEV, NASA Mars Rover. Картинки: `images/cutouts/*.png` (прозрачный фон, под `.sys-photo`). Выбранная карточка: рамка `var(--text)` + обводка `var(--accent)`, `aria-pressed="true"`.
- Над карточками баннер с рендером выбранной машины на Марсе: `images/scenes/<id>.jpg` (для пешего режима `images/scenes/lineup.jpg`), с подписью «3D render · concept».
- На карте: путь машины сплошной линией, пеший кусок пунктиром; в точке парковки иконка машины (lucide `car` / `truck`).
- В сводке маршрута добавь: время в пути, расход батареи %, кислород скафандра %, для MRV «Walk-back: 1 h 40 min of 6 h 9 min». Причины NO GO по-человечески:
  - battery → «Battery would drop below the 20% reserve»
  - radius → «Farther from the habitat than this vehicle may go»
  - duration → «Longer than this vehicle's trip limit»
  - suit → «Suit time runs out before the crew is back»
  - walkback → «If the rover breaks down, the crew can't walk home in time»
  - dust / daylight — как сейчас.
- Zyro комментирует выбор одной фразой, например: «SEV climbs the ridge directly and halves the distance.»
- Все новые строки добавь в словари i18n (`data-i18n`), как остальные тексты сайта.
- Сайт один файл: картинки встрой как base64 (`data:image/jpeg;base64,...`, cutouts как `image/png` или `image/webp` из `_600.webp`), как остальные ассеты в `ASSETS`.
- Под блоком мелкая подпись: «Vehicle route parameters are team assumptions for the demo, not official NASA specifications.»

## 5. Проверка

- Запусти `source/vehicle-router.test.js` в Node: на тестовом рельефе с гребнем пешеход и MRV обходят крутой участок (20°) по пологому проходу, SEV едет напрямую (≈ 3.8 км вместо 6.8 км), Mars Rover идёт в обход. С лимитом скафандра 4 ч пешеход получает `suit`, MRV `walkback`, SEV и Mars Rover остаются GO.
- В браузере проверь: при переключении машин маршрут на карте меняется, цифры в сводке обновляются, вердикт и причины соответствуют правилам выше, пешеходный режим работает как раньше.

---
