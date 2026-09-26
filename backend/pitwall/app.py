"""HTTP API. Serves the same JSON files as the static site, building them on demand.

    uvicorn pitwall.app:app --reload

GET /api/index.json                           season catalogue
GET /api/{year}/{round:02d}-{R|S}/session.json  analysis bundle (built on first request)
GET /api/{year}/{round:02d}-{R|S}/tel/{CODE}.json
"""

from __future__ import annotations

import re
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, bundle, catalog, config
from .sources import f1


@asynccontextmanager
async def lifespan(_: FastAPI):
    f1.enable_cache(config.CACHE_DIR)
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="pitwall", version=__version__, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"])

SLUG = re.compile(r"^(\d{2})-([RS])$")
CODE = re.compile(r"^[A-Z]{3}$")

_locks: dict[tuple, threading.Lock] = {}
_locks_guard = threading.Lock()
_index_cache: tuple[float, dict] | None = None


def _parse(year: int, slug: str) -> tuple[int, int, str]:
    m = SLUG.match(slug)
    if not m or not 1950 <= year <= 2100:
        raise HTTPException(404, "unknown session")
    return year, int(m.group(1)), m.group(2)


def _ensure(year: int, round_: int, kind: str) -> Path:
    target = bundle.session_dir(config.DATA_DIR, year, round_, kind)
    if (target / "session.json").exists():
        return target
    with _locks_guard:
        lock = _locks.setdefault((year, round_, kind), threading.Lock())
    with lock:
        if not (target / "session.json").exists():
            try:
                bundle.build(year, round_, kind, config.DATA_DIR)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:  # FastF1: no such event/session
                raise HTTPException(404, str(exc)) from exc
    return target


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": __version__}


@app.get("/api/index.json")
def get_index() -> JSONResponse:
    global _index_cache
    if _index_cache is None or time.monotonic() - _index_cache[0] > 3600:
        data = catalog.index(config.DATA_DIR, config.SEASONS, mode="live", only_built=False)
        _index_cache = (time.monotonic(), data)
    return JSONResponse(_index_cache[1])


@app.get("/api/{year}/{slug}/session.json")
async def get_session(year: int, slug: str) -> FileResponse:
    target = await run_in_threadpool(_ensure, *_parse(year, slug))
    return FileResponse(target / "session.json", media_type="application/json")


@app.get("/api/{year}/{slug}/tel/{code}.json")
async def get_telemetry(year: int, slug: str, code: str) -> FileResponse:
    if not CODE.match(code):
        raise HTTPException(404, "unknown driver")
    target = await run_in_threadpool(_ensure, *_parse(year, slug))
    path = target / "tel" / f"{code}.json"
    if not path.exists():
        raise HTTPException(404, "no telemetry for this driver")
    return FileResponse(path, media_type="application/json")


if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")
