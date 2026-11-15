import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Path, Query, Response
from pydantic import BaseModel, Field, field_validator

from app.api.deps import DbSession, Pagination
from app.core.errors import AppError
from app.schemas.common import ErrorResponse, IntegrationStatus, MarsCoord, Page
from app.schemas.dataset import DatasetRead
from app.schemas.environment import EnvParameter, EnvRegistryRead, EnvSeriesRead
from app.schemas.layer import LayerRead
from app.schemas.mission import MissionRead
from app.integrations.hazard_detection import RiskConfig
from app.schemas.ops import (
    HazardAssessmentRead,
    HazardFeatureRead,
    HazardGridRead,
    ReportCreate,
    ReportRead,
    RouteCreate,
    RouteRead,
    SimulationCreate,
    SimulationRead,
    TargetRead,
)
from app.integrations import assistant, gemini
from app.schemas.routing import RoutePlanRead, RoutePlanRequest
from app.schemas.terrain import (
    EnvironmentSummaryRead,
    LandingAssessmentRead,
    TerrainAnalysisRead,
    TerrainGridRead,
    TerrainPointRead,
    TerrainProfileRead,
    TerrainRegionRead,
    TerrainSlopePointRead,
)
from app.services import catalogue as svc

router = APIRouter()


@router.get(
    "/missions",
    response_model=Page[MissionRead],
    summary="Список научных миссий NASA, данные которых использует MARSWALK",
)
def get_missions(db: DbSession, page: Pagination) -> Page[MissionRead]:
    return svc.list_missions(db, page.limit, page.offset)


@router.get(
    "/datasets",
    response_model=Page[DatasetRead],
    summary="Реестр научных наборов данных (метаданные + ссылка на COG, без blob)",
)
def get_datasets(
    db: DbSession,
    page: Pagination,
    mission_id: str | None = Query(default=None, pattern=r"^[a-z0-9_-]{2,64}$"),
    integration_status: IntegrationStatus | None = None,
) -> Page[DatasetRead]:
    return svc.list_datasets(db, page.limit, page.offset, mission_id, integration_status)


@router.get(
    "/layers",
    response_model=Page[LayerRead],
    summary="Картографические слои (map_layers)",
)
def get_layers(db: DbSession, page: Pagination) -> Page[LayerRead]:
    return svc.list_layers(db, page.limit, page.offset)


@router.get(
    "/layers/{layer_id}/image",
    response_class=Response,
    summary="Кэшированный растровый оверлей слоя (например, NASA MRO CRISM)",
    responses={404: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
)
def get_layer_image(
    db: DbSession,
    layer_id: Annotated[str, Path(pattern=r"^[a-z0-9_-]{2,64}$")],
) -> Response:
    data, media_type = svc.get_layer_image(db, layer_id)
    return Response(data, media_type=media_type, headers={"Cache-Control": "public, max-age=86400"})


@router.get(
    "/tiles/{layer_id}/{z}/{row}/{col}",
    response_class=Response,
    summary="Тайл WMTS-слоя: кэширующий прокси к NASA Mars Trek",
    responses={
        200: {"content": {"image/jpeg": {}, "image/png": {}}},
        404: {"model": ErrorResponse, "description": "Слой или тайл отсутствует"},
        502: {"model": ErrorResponse, "description": "Сервис NASA недоступен или вернул некорректные данные"},
        504: {"model": ErrorResponse, "description": "Сервис NASA не ответил вовремя"},
    },
)
def get_tile(
    db: DbSession,
    layer_id: Annotated[str, Path(pattern=r"^[a-z0-9_-]{2,64}$")],
    z: Annotated[int, Path(ge=0, le=30)],
    row: Annotated[int, Path(ge=0)],
    col: Annotated[int, Path(ge=0)],
) -> Response:
    data, media_type = svc.get_layer_tile(db, layer_id, z, row, col)
    return Response(data, media_type=media_type, headers={"Cache-Control": "public, max-age=86400"})


@router.get(
    "/targets",
    response_model=Page[TargetRead],
    summary="Научные объекты; поддержка категорий, класса доказательности, инструмента, радиуса (м) и bbox на Марсе SRID 949900/949918",
)
def get_targets(
    db: DbSession,
    page: Pagination,
    category: str | None = Query(default=None, pattern=r"^[a-z0-9_-]{2,64}$"),
    include_demo: bool = Query(default=True),
    evidence_level: str | None = Query(default=None, pattern=r"^(direct_observation|scientific_interpretation|candidate_target|hypothesis)$"),
    instrument: str | None = Query(default=None, min_length=2, max_length=64),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=360),
    radius_m: float | None = Query(default=None, gt=0, le=100_000),
    min_lon: float | None = Query(default=None, ge=-180, le=360),
    min_lat: float | None = Query(default=None, ge=-90, le=90),
    max_lon: float | None = Query(default=None, ge=-180, le=360),
    max_lat: float | None = Query(default=None, ge=-90, le=90),
) -> Page[TargetRead]:
    return svc.list_targets(
        db,
        page.limit,
        page.offset,
        category,
        include_demo=include_demo,
        evidence_level=evidence_level,
        instrument=instrument,
        lat=lat,
        lon=lon,
        radius_m=radius_m,
        min_lon=min_lon,
        min_lat=min_lat,
        max_lon=max_lon,
        max_lat=max_lat,
    )


@router.get(
    "/hazards",
    response_model=Page[HazardFeatureRead],
    summary="Объекты опасности (реальные + DERIVED) с геометрией, источниками и уверенностью",
)
def get_hazards(
    db: DbSession,
    page: Pagination,
    hazard_class: str | None = Query(default=None, pattern=r"^(LOW|MODERATE|HIGH|UNKNOWN|no_go|caution)$"),
    include_demo: bool = Query(default=True),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=360),
    radius_m: float | None = Query(default=None, gt=0, le=100_000),
    min_lon: float | None = Query(default=None, ge=-180, le=360),
    min_lat: float | None = Query(default=None, ge=-90, le=90),
    max_lon: float | None = Query(default=None, ge=-180, le=360),
    max_lat: float | None = Query(default=None, ge=-90, le=90),
) -> Page[HazardFeatureRead]:
    return svc.list_hazards(
        db,
        page.limit,
        page.offset,
        hazard_class=hazard_class,
        include_demo=include_demo,
        lat=lat,
        lon=lon,
        radius_m=radius_m,
        min_lon=min_lon,
        min_lat=min_lat,
        max_lon=max_lon,
        max_lat=max_lat,
    )


@router.get(
    "/hazards/grid",
    response_model=HazardGridRead,
    responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Сетка оценки риска (LOW/MODERATE/HIGH/UNKNOWN) и неопределённости данных (DERIVED)",
)
def get_hazards_grid(
    west: float = Query(ge=-180, le=360),
    south: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=360),
    north: float = Query(ge=-90, le=90),
    step: int = Query(default=3, ge=1, le=50),
    w_slope: float = Query(default=0.40, ge=0.0, le=1.0),
    w_terrain: float = Query(default=0.25, ge=0.0, le=1.0),
    w_obstacle: float = Query(default=0.15, ge=0.0, le=1.0),
    w_uncertainty: float = Query(default=0.20, ge=0.0, le=1.0),
    slope_mod_deg: float = Query(default=10.0, gt=0.0, le=45.0),
    slope_high_deg: float = Query(default=18.0, gt=0.0, le=60.0),
) -> HazardGridRead:
    cfg = RiskConfig(
        w_slope=w_slope,
        w_terrain=w_terrain,
        w_obstacle=w_obstacle,
        w_uncertainty=w_uncertainty,
        slope_mod_deg=slope_mod_deg,
        slope_high_deg=slope_high_deg,
    )
    return svc.hazard_grid(west, south, east, north, step, cfg)


@router.get(
    "/hazards/assess",
    response_model=HazardAssessmentRead,
    responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Точечная оценка риска и объяснение факторов (Risk Assessment Engine)",
)
def assess_hazard_point(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=360),
    w_slope: float = Query(default=0.40, ge=0.0, le=1.0),
    w_terrain: float = Query(default=0.25, ge=0.0, le=1.0),
    w_obstacle: float = Query(default=0.15, ge=0.0, le=1.0),
    w_uncertainty: float = Query(default=0.20, ge=0.0, le=1.0),
    slope_mod_deg: float = Query(default=10.0, gt=0.0, le=45.0),
    slope_high_deg: float = Query(default=18.0, gt=0.0, le=60.0),
) -> HazardAssessmentRead:
    cfg = RiskConfig(
        w_slope=w_slope,
        w_terrain=w_terrain,
        w_obstacle=w_obstacle,
        w_uncertainty=w_uncertainty,
        slope_mod_deg=slope_mod_deg,
        slope_high_deg=slope_high_deg,
    )
    return svc.assess_hazard_point(lat, lon, cfg)


@router.get(
    "/environment",
    response_model=EnvironmentSummaryRead,
    responses={
        404: {"model": ErrorResponse, "description": "Сол не загружен в кэш MEDA"},
        503: {"model": ErrorResponse, "description": "Данные MEDA ещё не загружены"},
    },
    summary="Сводка измерений MEDA Perseverance за сол (DERIVED из таблиц NASA PDS)",
)
def get_environment(db: DbSession, sol: int | None = Query(default=None, ge=0, le=10000)) -> EnvironmentSummaryRead:
    return svc.get_environment_summary(db, sol)


@router.get(
    "/environment/registry",
    response_model=EnvRegistryRead,
    summary="Реестр источников данных о среде: параметр, прибор, место, вид данных, доступность",
)
def get_environment_registry(db: DbSession) -> EnvRegistryRead:
    return svc.get_environment_registry(db)


@router.get(
    "/environment/observations",
    response_model=EnvSeriesRead,
    responses={
        404: {"model": ErrorResponse, "description": "Сол или станция не загружены"},
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse, "description": "Данные MEDA ещё не загружены"},
    },
    summary="Временной ряд одного параметра MEDA за сол в точке марсохода (PROCESSED: средние по интервалам LMST)",
)
def get_environment_observations(
    db: DbSession,
    parameter: EnvParameter,
    station: str = Query(default="m2020_meda", pattern=r"^[a-z0-9_]{2,64}$"),
    sol: int | None = Query(default=None, ge=0, le=10000),
    lmst_from: float = Query(default=0, ge=0, le=24, description="Начало, часы местного среднего солнечного времени"),
    lmst_to: float = Query(default=24, ge=0, le=24),
    bin_minutes: int = Query(default=15, ge=5, le=120),
) -> EnvSeriesRead:
    return svc.get_environment_series(db, station, parameter.value, sol, lmst_from, lmst_to, bin_minutes)


@router.get(
    "/terrain/point",
    response_model=TerrainPointRead,
    responses={
        422: {"model": ErrorResponse, "description": "Точка вне загруженной области"},
        503: {"model": ErrorResponse, "description": "Высоты ещё не загружены"},
    },
    summary="Высота в точке (REAL): ячейка CTX DTM 20 м, вне её охвата — MOLA 463 м; без интерполяции",
)
def get_terrain_point(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=360),
) -> TerrainPointRead:
    return svc.terrain_point(lat, lon)


@router.get(
    "/terrain/heightmap",
    response_model=TerrainGridRead,
    responses={
        422: {"model": ErrorResponse, "description": "Область вне рельефа CTX, пуста или слишком велика"},
        503: {"model": ErrorResponse, "description": "Рельеф ещё не загружен"},
    },
    summary="Сетка высот области (REAL): каждая step-я ячейка CTX DTM 20 м, значения не изменены",
)
def get_terrain_heightmap(
    west: float = Query(ge=-180, le=360),
    south: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=360),
    north: float = Query(ge=-90, le=90),
    step: int = Query(default=1, ge=1, le=50),
) -> TerrainGridRead:
    return svc.terrain_heightmap(west, south, east, north, step)


@router.get(
    "/terrain/analysis",
    response_model=TerrainAnalysisRead,
    responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Производные слои рельефа (DERIVED): уклон, отмывка, шероховатость TRI, классы и отчёт качества",
)
def get_terrain_analysis(
    west: float = Query(ge=-180, le=360),
    south: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=360),
    north: float = Query(ge=-90, le=90),
    step: int = Query(default=3, ge=1, le=50),
) -> TerrainAnalysisRead:
    return svc.terrain_analysis(west, south, east, north, step)


@router.get(
    "/terrain/export",
    response_class=Response,
    responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Экспорт производного слоя (elevation/slope/roughness/hillshade/terrain_class) в GeoTIFF",
)
def export_terrain_geotiff(
    layer: str = Query(pattern=r"^(elevation|slope|roughness|hillshade|terrain_class)$"),
    west: float = Query(ge=-180, le=360),
    south: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=360),
    north: float = Query(ge=-90, le=90),
    step: int = Query(default=3, ge=1, le=50),
) -> Response:
    data = svc.terrain_export_geotiff(layer, west, south, east, north, step)
    return Response(
        data,
        media_type="image/tiff",
        headers={"Content-Disposition": f'attachment; filename="marswalk_{layer}_step{step}.tif"'},
    )


@router.get(
    "/terrain/regions",
    response_model=list[TerrainRegionRead],
    summary="Регионы, где можно планировать Marswalk: Езеро на CTX 20 м и загруженные окна MOLA 463 м",
)
def get_terrain_regions() -> list[TerrainRegionRead]:
    return svc.terrain_regions()


@router.get(
    "/landing/assess",
    response_model=LandingAssessmentRead,
    responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Проверка точки посадки по критериям NASA и ближайшая подходящая ячейка (DERIVED)",
)
def get_landing_assessment(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=360),
    west: float = Query(default=77.3, ge=-180, le=360),
    south: float = Query(default=18.3, ge=-90, le=90),
    east: float = Query(default=77.6, ge=-180, le=360),
    north: float = Query(default=18.55, ge=-90, le=90),
    step: int = Query(default=3, ge=1, le=50),
) -> LandingAssessmentRead:
    return svc.assess_landing(lat, lon, west, south, east, north, step)


@router.get(
    "/terrain/profile",
    response_model=TerrainProfileRead,
    responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Профиль высот и уклонов между двумя точками по DTM (DERIVED)",
)
def get_terrain_profile(
    start_lat: float = Query(ge=-90, le=90),
    start_lon: float = Query(ge=-180, le=360),
    end_lat: float = Query(ge=-90, le=90),
    end_lon: float = Query(ge=-180, le=360),
) -> TerrainProfileRead:
    from app.schemas.common import MarsCoord

    return svc.terrain_profile(
        MarsCoord(lat=start_lat, lon=start_lon),
        MarsCoord(lat=end_lat, lon=end_lon),
    )


@router.get(
    "/terrain/slope",
    response_model=TerrainSlopePointRead,
    responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Расчёт уклона, шероховатости TRI и класса рельефа в точке по DTM (DERIVED)",
)
def get_terrain_slope(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=360),
) -> TerrainSlopePointRead:
    return svc.terrain_slope(lat, lon)


@router.post(
    "/routes",
    response_model=RouteRead,
    status_code=201,
    responses={422: {"model": ErrorResponse}},
    summary="Сохранить маршрут (LineString SRID 949900); расчёт вариантов — POST /routes/plan",
)
def post_route(db: DbSession, body: RouteCreate) -> RouteRead:
    return svc.create_route(db, body)


@router.post(
    "/routes/plan",
    response_model=RoutePlanRead,
    responses={
        422: {"model": ErrorResponse, "description": "Точка вне сетки CTX или старт и финиш в одной ячейке"},
        503: {"model": ErrorResponse, "description": "Рельеф CTX ещё не загружен"},
    },
    summary="Рассчитать варианты маршрута по сетке рельефа (DERIVED): A*, эталон — Дейкстра; без оценок времени и кислорода",
)
def post_route_plan(db: DbSession, body: RoutePlanRequest) -> RoutePlanRead:
    return svc.plan_route(db, body)


@router.post(
    "/simulations",
    response_model=SimulationRead,
    status_code=201,
    responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    summary="Создать запрос симуляции выхода (расчёт — этап 13)",
)
def post_simulation(db: DbSession, body: SimulationCreate) -> SimulationRead:
    return svc.create_simulation(db, body)


@router.post(
    "/reports",
    response_model=ReportRead,
    status_code=201,
    responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    summary="Создать запрос миссионного отчёта (генерация — этап 14)",
)
def post_report(db: DbSession, body: ReportCreate) -> ReportRead:
    return svc.create_report(db, body)


# Free-text fallback for hosts without the tool loop; /assistant/chat is the data-backed path.
class AssistantAsk(BaseModel):
    prompt: str = Field(min_length=1, max_length=16_000)


class AssistantReply(BaseModel):
    text: str


@router.post(
    "/assistant/ask",
    response_model=AssistantReply,
    responses={502: {"model": ErrorResponse}, 503: {"model": ErrorResponse}, 504: {"model": ErrorResponse}},
    summary="Ответ Zyro через Gemini (ключ только на сервере)",
)
def post_assistant_ask(body: AssistantAsk) -> AssistantReply:
    return AssistantReply(text=gemini.ask(body.prompt))


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=4000)


class ChatContext(BaseModel):
    start: MarsCoord | None = None
    target: MarsCoord | None = None
    sol: int | None = Field(default=None, ge=0, le=10_000)
    region: assistant.Window | None = Field(default=None, description="Окно региона, открытого на карте Marswalk")
    page: dict[str, Any] | None = Field(default=None, description="Что пользователь видит на странице (рейтинг площадок и т. п.)")

    @field_validator("page")
    @classmethod
    def _page_size(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None and len(json.dumps(v, default=str)) > 32_000:
            raise ValueError("page context too large")
        return v


class AssistantChat(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
    context: ChatContext = Field(default_factory=ChatContext)


class ToolCallRead(BaseModel):
    name: str
    arguments: dict[str, Any]
    ok: bool
    error: str | None = None


class AssistantChatReply(BaseModel):
    text: str
    mode: Literal["gemini", "deterministic"]
    intent: list[str]
    tool_calls: list[ToolCallRead]
    sources: list[str] = Field(description="Только id наборов из результатов инструментов")
    uncertainty: list[str]


@router.post(
    "/assistant/chat",
    response_model=AssistantChatReply,
    responses={422: {"model": ErrorResponse}},
    summary="Zyro с вызовом инструментов MARSWALK (только чтение)",
)
def post_assistant_chat(db: DbSession, body: AssistantChat) -> AssistantChatReply:
    if body.messages[-1].role != "user":
        raise AppError(422, "LAST_MESSAGE_NOT_USER", "Последнее сообщение должно быть от пользователя.")
    return AssistantChatReply(
        **assistant.chat(db, [m.model_dump() for m in body.messages], body.context.model_dump(exclude_none=True))
    )
