from contextlib import asynccontextmanager
from pathlib import Path
from sqlite3 import Error as SqliteError

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import init_db
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Torpedo Schedule API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(router)


@app.get("/api/health")
def health():
    return {"ok": True}


FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


@app.get("/")
def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.exception_handler(RequestValidationError)
async def _invalid(_: Request, exc: RequestValidationError):
    errs = [
        {
            "field": ".".join(str(p) for p in e["loc"][1:]),
            "message": e["msg"].removeprefix("Value error, "),
        }
        for e in exc.errors()
    ]
    return JSONResponse({"detail": "Проверьте введённые данные", "errors": errs}, status_code=422)


@app.exception_handler(SqliteError)
async def _db_down(_: Request, exc: SqliteError):
    return JSONResponse({"detail": "База данных недоступна, попробуйте позже"}, status_code=503)


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
