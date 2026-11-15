"""HTTP API for direct frontend <-> NASA/GWA/DEM pipeline <-> Site Ranker v5 integration."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from fetch_data.src.clean import DEFAULT_CLEAN_DIR
from fetch_data.src.point_service import clear_caches as clear_point_service_caches
from fetch_data.src.point_service import evaluate_coordinates, evaluate_multiple_coordinates
from rank_sites import evaluate

REPO_ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = REPO_ROOT / "output"

app = FastAPI(
    title="Finland Data Center Climate & Energy API (Site Ranker v5)",
    version="5.0",
    description=(
        "Evaluates pre-computed Finnish regions and arbitrary (lat, lon) coordinates using "
        "NASA POWER (MERRA-2 + CERES), Global Wind Atlas 100m (with MERRA-2 100m fallback/mode), "
        "and Copernicus DEM terrain slope."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class PointRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees")
    site_id: str | None = Field(default=None, description="Optional custom site_id")
    region: str | None = Field(default=None, description="Optional display label for the site")
    country: str = Field(default="Finland", description="Country label")
    wind_source: Literal["gwa", "merra2"] = Field(
        default="gwa",
        description="Primary 100m wind data source ('gwa' for Global Wind Atlas, 'merra2' for pure NASA POWER/MERRA-2)",
    )
    include_baseline: bool = Field(
        default=False,
        description="When False (default), evaluates the single point using physical reference benchmarks; when True, ranks alongside the 19 Finland baseline regions",
    )
    horizon_years: int = Field(default=10, ge=1, le=30, description="Scenario horizon in years (1-30)")
    use_cache: bool = Field(default=True, description="Reuse cached hub/point raw fetches when valid")


class BatchPointItem(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    site_id: str | None = None
    region: str | None = None
    country: str = "Finland"


class BatchPointsRequest(BaseModel):
    points: list[BatchPointItem] = Field(..., min_length=1)
    wind_source: Literal["gwa", "merra2"] = "gwa"
    include_baseline: bool = False
    horizon_years: int = Field(default=10, ge=1, le=30)
    use_cache: bool = True


def _run_or_http_error(fn: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "Finland Data Center Climate & Energy API (Site Ranker v5)",
        "version": "5.0",
        "docs": "/docs",
        "endpoints": ["/health", "/regions", "/point", "/points", "/analyze"],
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "5.0"}


@app.post("/cache/clear")
def clear_memory_cache() -> dict[str, str]:
    _load_json_cached.cache_clear()
    clear_point_service_caches()
    return {"status": "cleared"}


@lru_cache(maxsize=8)
def _load_json_cached(path_str: str, mtime_ns: int) -> dict[str, Any]:
    return json.loads(Path(path_str).read_text(encoding="utf-8"))


@app.get("/regions")
def get_regions(
    wind_source: Literal["gwa", "merra2"] = Query(
        default="gwa",
        description="Select pre-computed output ('gwa' or 'merra2')",
    ),
) -> dict[str, Any]:
    filename = "frontend_merra2.json" if wind_source == "merra2" else "frontend.json"
    for candidate in (OUTPUT_DIR / filename, DEFAULT_CLEAN_DIR / filename):
        if candidate.exists():
            resolved = candidate.resolve()
            return _load_json_cached(str(resolved), resolved.stat().st_mtime_ns)
    raise HTTPException(status_code=404, detail=f"Pre-computed {filename} not found. Run fetch_data/process_data.py.")


@app.get("/point")
def analyze_point_get(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    site_id: str | None = Query(default=None),
    region: str | None = Query(default=None),
    country: str = Query(default="Finland"),
    wind_source: Literal["gwa", "merra2"] = Query(default="gwa"),
    include_baseline: bool = Query(default=False),
    horizon_years: int = Query(default=10, ge=1, le=30),
    use_cache: bool = Query(default=True),
) -> dict[str, Any]:
    return _run_or_http_error(
        evaluate_coordinates,
        lat,
        lon,
        site_id=site_id,
        region=region,
        country=country,
        wind_source=wind_source,
        include_baseline=include_baseline,
        horizon_years=horizon_years,
        use_cache=use_cache,
    )


@app.post("/point")
def analyze_point_post(req: PointRequest) -> dict[str, Any]:
    return _run_or_http_error(
        evaluate_coordinates,
        req.lat,
        req.lon,
        site_id=req.site_id,
        region=req.region,
        country=req.country,
        wind_source=req.wind_source,
        include_baseline=req.include_baseline,
        horizon_years=req.horizon_years,
        use_cache=req.use_cache,
    )


@app.post("/points")
def analyze_points_batch(req: BatchPointsRequest) -> dict[str, Any]:
    return _run_or_http_error(
        evaluate_multiple_coordinates,
        [pt.model_dump() for pt in req.points],
        wind_source=req.wind_source,
        include_baseline=req.include_baseline,
        horizon_years=req.horizon_years,
        use_cache=req.use_cache,
    )


@app.post("/analyze")
def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    return _run_or_http_error(evaluate, payload)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=True)
