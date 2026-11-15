# MARSWALK

Интегрированная планетарная ГИС и исследовательская система планирования маршрутов по поверхности Марса (район исследования — **кратер Езеро**).

> **Отказ от ответственности:** MARSWALK — исследовательский и демонстрационный прототип. Приложение **не сертифицировано NASA**, не аффилировано с NASA, а рассчитываемые маршруты являются вычислительными оценками и **не гарантируют безопасность астронавтов**.

---

## Структура монорепозитория

```text
GrassOnMars/
├── frontend/          # Страница дизайнера (index.html, vanilla JS) на Vite; /api проксируется в backend
├── backend/           # Python + FastAPI + Pydantic + SQLAlchemy + Alembic + Pytest
├── data/              # Локальное хранилище геоданных NASA (raw, processed, samples, metadata)
├── docs/              # PRD, рамки проекта, критерии приёмки и архитектура (docs/architecture/)
├── scripts/           # SQL инициализации PostGIS и марсианских СК (SRID 949900, 949918)
├── docker-compose.yml # Оркестрация PostgreSQL/PostGIS + Backend + Frontend
├── .env.example       # Шаблон переменных окружения (без секретов)
└── README.md
```

---

## Быстрый старт (Docker Compose — основной режим)

1. Создайте локальный `.env` из шаблона (если ещё не создан) и укажите `GEMINI_API_KEY`:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Запустите все сервисы одной командой:
   ```powershell
   docker compose up --build
   ```
3. Проверьте доступность сервисов:
   - **Frontend (панель MARSWALK):** http://localhost:5173
   - **Backend Healthcheck:** http://localhost:8000/api/v1/health
   - **Swagger / OpenAPI (`/docs`):** http://localhost:8000/docs
   - **PostgreSQL + PostGIS:** `localhost:5432` (БД `marswalk`)

Остановка контейнеров:
```powershell
docker compose down
```

---

## Локальный запуск для разработки (без Docker)

### Локальный запуск одной командой на каждый сервис (скрипты Windows PowerShell)

В проекте уже настроены локальный кластер PostgreSQL (`.local/pgdata` на порту `5433`), виртуальное окружение Python (`backend/.venv`) и портативный Node.js 22 (`.local/node`):

```powershell
# Терминал 1 — PostgreSQL + Backend FastAPI (http://localhost:8000, Swagger: http://localhost:8000/docs)
.\scripts\dev-backend.ps1

# Терминал 2 — Frontend Vite (http://127.0.0.1:5173)
.\scripts\dev-frontend.ps1
```

Frontend — это страница дизайнера `frontend/index.html` (оригинал лежит рядом: `Marswalk, Grass on Mars.html`). Данные она берёт только у backend через `frontend/public/marswalk-api.js`: рельеф `/api/v1/terrain/heightmap`, высота точки `/api/v1/terrain/point`, снимки `/api/v1/layers` + `/api/v1/tiles/...`. Без backend карта показывает демо-рельеф с плашкой. Vite слушает только `127.0.0.1`; чтобы открыть в сети — `VITE_HOST=0.0.0.0` (вместе с ним в сеть уходит и прокси `/api`). Прежняя React-заготовка (`frontend/src`, вход `index.react.html`) не используется.

### Ручной локальный запуск

#### 1. Backend (Python + FastAPI)
```powershell
cd backend
$env:PATH = "C:\Program Files\PostgreSQL\18\bin;$env:PATH"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Запуск тестов Backend и проверка миграций Alembic:
```powershell
cd backend
$env:PATH = "C:\Program Files\PostgreSQL\18\bin;$env:PATH"
.\.venv\Scripts\python.exe -m pytest -v
.\.venv\Scripts\python.exe -m alembic current
```

#### 2. Frontend (Vite)
```powershell
cd frontend
$env:PATH = "d:\GrassOnMars\.local\node\node-v22.14.0-win-x64;$env:PATH"
npm run dev
```

Проверка качества кода и сборки Frontend:
```powershell
cd frontend
$env:PATH = "d:\GrassOnMars\.local\node\node-v22.14.0-win-x64;$env:PATH"
npm run lint
npm run format:check
npm run build
```


## Frontend layout

The live UI is Vite + the designer’s modular page:

- `frontend/index.html` — shell (tabs, markup)
- `frontend/public/js/` — modules (`app.js`, `mission.js`, …)
- `frontend/public/styles.css`, `frontend/public/logo.png` — brand mark is the team logo
- `frontend/public/data/` — concept film, Zyro faces, NASA system renders, globe rebuild sources
- `frontend/public/marswalk-api.js` — talks to the FastAPI backend (`/api/v1`)

Design source package (do not serve directly): `design/marswalk-platform/` and `design/LogoGrassOnMars.png`.
Offline single-file build from the designer lives in `design/marswalk-platform/dist/marswalk.html` (no backend).
