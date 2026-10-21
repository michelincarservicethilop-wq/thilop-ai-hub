"""Điểm khởi động API của Thi Lốp AI Hub."""
import importlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import get_settings
from .seed import init_db
from .services.llm import GatewayError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("hub")

ROUTERS = [
    "auth", "overview", "chat", "keys", "admin", "files", "openai_compat", "anthropic_compat",
    "documents", "apps", "studio", "inbox", "webhooks",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    log.info("%s đã sẵn sàng", get_settings().app_name)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Thi Lốp AI Hub", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
    for name in ROUTERS:
        mod = importlib.import_module(f".api.{name}", __package__)
        app.include_router(mod.router)

    @app.exception_handler(GatewayError)
    async def gateway_error(_: Request, e: GatewayError):
        return JSONResponse(status_code=e.status_code, content={"detail": e.message, "error": {"message": e.message, "type": e.code}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        first = e.errors()[0] if e.errors() else {}
        where = ".".join(str(x) for x in first.get("loc", [])[1:])
        return JSONResponse(status_code=422, content={"detail": f"Dữ liệu không hợp lệ ở '{where}': {first.get('msg', '')}"})

    @app.get("/api/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
