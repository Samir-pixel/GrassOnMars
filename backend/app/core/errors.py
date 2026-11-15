import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("marswalk.errors")

HTTP_ERRORS = {
    404: ("NOT_FOUND", "Ресурс не найден."),
    405: ("METHOD_NOT_ALLOWED", "Метод не поддерживается для этого адреса."),
}


class AppError(Exception):
    def __init__(
        self, status_code: int, code: str, message_ru: str, details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(message_ru)
        self.status_code = status_code
        self.code = code
        self.message_ru = message_ru
        self.details = details or {}


class NotYetIntegratedError(AppError):
    """The module exists in the API, but the data or computation behind it is not connected yet."""

    def __init__(self, module: str, requires_ru: str, planned_stage: int) -> None:
        super().__init__(
            503,
            "NOT_YET_INTEGRATED",
            f"Модуль «{module}» ещё не подключён: требуется {requires_ru} (этап {planned_stage}).",
            {"module": module, "planned_stage": planned_stage},
        )


def _error_response(
    request: Request, status_code: int, code: str, message_ru: str, details: dict[str, Any]
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unknown")
    logger.warning(
        "%s: %s", code, message_ru, extra={"request_id": request_id, "status_code": status_code}
    )
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message_ru": message_ru,
                "details": details,
                "request_id": request_id,
            }
        },
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return _error_response(request, exc.status_code, exc.code, exc.message_ru, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Only loc/msg/type: the raw pydantic error may hold objects that are not JSON-serializable.
        errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        return _error_response(
            request, 422, "VALIDATION_ERROR", "Некорректные параметры запроса.", {"errors": errors}
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message_ru = HTTP_ERRORS.get(exc.status_code, ("HTTP_ERROR", "Ошибка HTTP."))
        return _error_response(request, exc.status_code, code, message_ru, {"detail": exc.detail})

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error")
        return _error_response(
            request, 500, "INTERNAL_SERVER_ERROR", "Внутренняя ошибка сервера MARSWALK.", {}
        )
