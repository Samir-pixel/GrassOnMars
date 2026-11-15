from contextlib import asynccontextmanager
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.v1 import router as v1_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.logging import RequestLoggingMiddleware, configure_logging

configure_logging(settings.log_level)
logger = logging.getLogger("marswalk.app")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "Starting %s v%s (env=%s, data_dir=%s)",
        settings.app_name,
        settings.app_version,
        settings.app_env,
        settings.data_dir,
    )
    yield
    logger.info("Shutting down %s", settings.app_name)


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Интегрированная планетарная ГИС и система планирования маршрутов по поверхности Марса "
        "(кратер Езеро). Исследовательский прототип — не сертифицирован NASA."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
register_exception_handlers(app)

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(health_router)
api_v1.include_router(v1_router)
app.include_router(api_v1)
# Short alias used by Docker healthchecks and scripts.
app.include_router(health_router)
