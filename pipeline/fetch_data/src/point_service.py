"""On-demand (lat, lon) point collection, caching, and Site Ranker v5 evaluation for the frontend."""
from __future__ import annotations

import argparse
import copy
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fetch_data.src.clean import (
    DEFAULT_CLEAN_DIR,
    build_site_ranker_input,
    clean_power_json,
)
from fetch_data.src.collect import (
    DATACENTER_PARAMETERS,
    DEFAULT_RAW_DIR,
    FINLAND_REGIONS,
    fetch_gwa_100m_point,
    fetch_monthly_point,
    fetch_terrain_point,
    fetch_water_point,
)
from rank_sites import clear_caches as clear_ranker_caches
from rank_sites import evaluate as evaluate_site_ranker

POINTS_CACHE_DIR = DEFAULT_RAW_DIR / "points_cache"
BASELINE_PIPELINE_PATH = DEFAULT_CLEAN_DIR / "pipeline_output.json"
BASELINE_PIPELINE_MERRA2_PATH = DEFAULT_CLEAN_DIR / "pipeline_output_merra2.json"


def _validate_coordinates(lat: float, lon: float) -> tuple[float, float]:
    lat_f = float(lat)
    lon_f = float(lon)
    if not math.isfinite(lat_f) or not math.isfinite(lon_f):
        raise ValueError("Latitude and longitude must be finite numbers")
    if not (-90.0 <= lat_f <= 90.0):
        raise ValueError(f"Latitude {lat_f} out of range [-90, 90]")
    if not (-180.0 <= lon_f <= 180.0):
        raise ValueError(f"Longitude {lon_f} out of range [-180, 180]")
    return round(lat_f, 4), round(lon_f, 4)


def _match_known_region(lat: float, lon: float, tol_deg: float = 0.01) -> tuple[str, dict[str, Any]] | None:
    best_match: tuple[float, str, dict[str, Any]] | None = None
    for loc_id, cfg in FINLAND_REGIONS.items():
        d_lat = abs(lat - float(cfg["lat"]))
        d_lon = abs(lon - float(cfg["lon"]))
        if d_lat <= tol_deg and d_lon <= tol_deg:
            dist = math.hypot(d_lat, d_lon)
            if best_match is None or dist < best_match[0]:
                best_match = (dist, loc_id, cfg)
    return (best_match[1], best_match[2]) if best_match is not None else None


def _point_cache_file(lat: float, lon: float, cache_dir: Path = POINTS_CACHE_DIR) -> Path:
    return cache_dir / f"pt_{lat:.4f}_{lon:.4f}.json"


def _is_point_cache_valid(
    cache_path: Path,
    start_year: int = 1984,
    end_year: int = 2024,
) -> dict[str, Any] | None:
    if not cache_path.exists():
        return None
    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        param_dict = data.get("properties", {}).get("parameter", {})
        if not all(p in param_dict for p in DATACENTER_PARAMETERS):
            return None
        sample_keys = param_dict[DATACENTER_PARAMETERS[0]]
        if f"{start_year}01" not in sample_keys or f"{end_year}12" not in sample_keys:
            return None
        terrain = data.get("_terrain")
        if not isinstance(terrain, dict) or terrain.get("slope_deg") is None:
            return None
        water = data.get("_water")
        if not isinstance(water, dict) or water.get("water_distance_km") is None or water.get("water_discharge_m3s") is None:
            return None
        gwa = data.get("_gwa_100m") or {}
        if not data.get("_gwa_unavailable") and float(gwa.get("wind_power_density_w_m2", 0)) <= 0:
            return None
        return data
    except Exception:
        return None


def _match_cached_point(
    lat: float,
    lon: float,
    cache_dir: Path,
    *,
    tol_deg: float = 0.01,
    start_year: int = 1984,
    end_year: int = 2024,
) -> Path | None:
    exact = _point_cache_file(lat, lon, cache_dir=cache_dir)
    if _is_point_cache_valid(exact, start_year=start_year, end_year=end_year) is not None:
        return exact
    if not cache_dir.exists() or tol_deg <= 0:
        return None
    best_match: tuple[float, Path] | None = None
    for candidate in cache_dir.glob("pt_*.json"):
        parts = candidate.stem.split("_")
        if len(parts) != 3:
            continue
        try:
            c_lat = float(parts[1])
            c_lon = float(parts[2])
        except ValueError:
            continue
        d_lat = abs(lat - c_lat)
        d_lon = abs(lon - c_lon)
        if d_lat <= tol_deg and d_lon <= tol_deg:
            dist = math.hypot(d_lat, d_lon)
            if best_match is None or dist < best_match[0]:
                if _is_point_cache_valid(candidate, start_year=start_year, end_year=end_year) is not None:
                    best_match = (dist, candidate)
    return best_match[1] if best_match is not None else None


@lru_cache(maxsize=64)
def _clean_power_json_cached(path_str: str, mtime_ns: int) -> tuple[Any, Any, dict[str, Any]]:
    return clean_power_json(Path(path_str))


@lru_cache(maxsize=4)
def _read_json_cached(path_str: str, mtime_ns: int) -> dict[str, Any]:
    return json.loads(Path(path_str).read_text(encoding="utf-8"))


def clear_caches() -> None:
    """Clear in-memory DataFrame/JSON/simulation LRU caches."""
    _clean_power_json_cached.cache_clear()
    _read_json_cached.cache_clear()
    clear_ranker_caches()


def _fetch_and_cache_point_json(
    lat: float,
    lon: float,
    cache_path: Path,
    *,
    start_year: int = 1984,
    end_year: int = 2024,
) -> Path:
    with ThreadPoolExecutor(max_workers=4) as pool:
        fut_nasa = pool.submit(
            fetch_monthly_point,
            lat=lat,
            lon=lon,
            parameters=DATACENTER_PARAMETERS,
            start_year=start_year,
            end_year=end_year,
        )
        fut_gwa = pool.submit(fetch_gwa_100m_point, lat=lat, lon=lon)
        fut_terrain = pool.submit(fetch_terrain_point, lat=lat, lon=lon)
        fut_water = pool.submit(fetch_water_point, lat=lat, lon=lon)

        payload = fut_nasa.result()

        gwa_data: dict[str, Any] = {}
        gwa_unavailable = False
        try:
            gwa_data = fut_gwa.result()
        except Exception:
            gwa_unavailable = True

        try:
            terrain_data = fut_terrain.result()
            terrain_payload = {
                "n_points": 1,
                "elevation_m": terrain_data["elevation_m"],
                "slope_deg": terrain_data["slope_deg"],
                "source": "Copernicus DEM GLO-90 (90m grid via Open-Meteo Elevation API, https://open-meteo.com/en/docs/elevation-api)",
            }
        except Exception:
            terrain_payload = {
                "n_points": 1,
                "elevation_m": 0.0,
                "slope_deg": 0.0,
                "source": "Fallback terrain estimate (DEM unavailable)",
            }

        try:
            water_data = fut_water.result()
            water_payload = {
                "n_points": 1,
                "water_distance_km": water_data["water_distance_km"],
                "water_discharge_m3s": water_data["water_discharge_m3s"],
                "center_discharge_m3s": water_data.get("center_discharge_m3s", water_data["water_discharge_m3s"]),
                "source": "Copernicus GloFAS v4 Flood API & Copernicus DEM GLO-90 water-proximity stencil (https://open-meteo.com/en/docs/flood-api)",
            }
        except Exception:
            water_payload = {
                "n_points": 1,
                "water_distance_km": 3.0,
                "water_discharge_m3s": 10.0,
                "center_discharge_m3s": 5.0,
                "source": "Fallback water resource estimate (GloFAS unavailable)",
            }

    payload["_meta"] = {
        "location_id": f"pt_{lat:.4f}_{lon:.4f}",
        "iso_code": "CUSTOM",
        "name": f"Custom ({lat:.4f}, {lon:.4f})",
        "hub_city": f"{lat:.4f}, {lon:.4f}",
        "lat": lat,
        "lon": lon,
        "n_points": 1,
        "start_year": start_year,
        "end_year": end_year,
    }
    payload["_gwa_100m"] = gwa_data
    payload["_gwa_unavailable"] = gwa_unavailable
    payload["_terrain"] = terrain_payload
    payload["_water"] = water_payload

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return cache_path


def build_site_for_coordinates(
    lat: float,
    lon: float,
    *,
    site_id: str | None = None,
    region: str | None = None,
    country: str = "Finland",
    start_ym: str = "2005-01",
    end_ym: str = "2024-12",
    wind_source: str = "gwa",
    use_cache: bool = True,
    cache_tol_deg: float = 0.01,
    raw_dir: Path | None = None,
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    """Build a complete Site Ranker v5 site object for any (lat, lon) coordinate."""
    raw_dir = raw_dir if raw_dir is not None else DEFAULT_RAW_DIR
    cache_dir = cache_dir if cache_dir is not None else POINTS_CACHE_DIR
    if wind_source not in ("gwa", "merra2"):
        raise ValueError(f"Unsupported wind_source={wind_source!r}; expected 'gwa' or 'merra2'")

    lat_f, lon_f = _validate_coordinates(lat, lon)
    start_year = 1984
    end_year = max(2024, int(end_ym.split("-")[0]))

    raw_path: Path | None = None
    source_tag = "live_fetch"
    matched = _match_known_region(lat_f, lon_f) if use_cache else None

    if matched is not None:
        loc_id, cfg = matched
        candidate_raw = raw_dir / f"{loc_id}.json"
        if _is_point_cache_valid(candidate_raw, start_year=start_year, end_year=end_year) is not None:
            raw_path = candidate_raw
            source_tag = "region_hub"
            default_site_id = f"fi_{loc_id}"
            short_region = cfg["name"].split(" (")[0]
            default_region = f"{short_region} ({cfg['hub_city']})"
            iso_code = cfg["iso_code"]
        else:
            matched = None

    if matched is None:
        default_site_id = f"pt_{lat_f:.4f}_{lon_f:.4f}"
        default_region = f"Custom ({lat_f:.4f}, {lon_f:.4f})"
        iso_code = "CUSTOM"
        cached_pt = (
            _match_cached_point(
                lat_f,
                lon_f,
                cache_dir,
                tol_deg=cache_tol_deg,
                start_year=start_year,
                end_year=end_year,
            )
            if use_cache
            else None
        )
        if cached_pt is not None:
            raw_path = cached_pt
            source_tag = "point_cache"
        else:
            pt_cache = _point_cache_file(lat_f, lon_f, cache_dir=cache_dir)
            raw_path = _fetch_and_cache_point_json(
                lat_f, lon_f, pt_cache, start_year=start_year, end_year=end_year
            )
            source_tag = "live_fetch"

    resolved_raw = raw_path.resolve()
    monthly_df, annual_df, stats_dict = _clean_power_json_cached(str(resolved_raw), resolved_raw.stat().st_mtime_ns)
    monthly_df = monthly_df.copy()
    annual_df = annual_df.copy()
    stats_dict = copy.deepcopy(stats_dict)
    gwa_dict = stats_dict.get("gwa_100m") or {}
    terrain_dict = stats_dict.get("terrain") or {}
    water_dict = stats_dict.get("water") or {}

    has_gwa = bool(gwa_dict.get("wind_power_density_w_m2") and gwa_dict.get("wind_speed_100m_ms"))
    effective_wind = wind_source if (wind_source == "merra2" or has_gwa) else "merra2"

    target_site_id = (site_id or default_site_id).strip()
    target_region = (region or default_region).strip()

    record = {
        "region_id": target_site_id,
        "cfg": {
            "iso_code": iso_code,
            "name": target_region,
            "hub_city": target_region,
        },
        "lat": lat_f,
        "lon": lon_f,
        "n_points": int((stats_dict.get("meta") or {}).get("n_points", 1)),
        "monthly_df": monthly_df,
        "annual_df": annual_df,
        "gwa_100m": gwa_dict,
        "terrain": terrain_dict,
        "water": water_dict,
    }

    built = build_site_ranker_input(
        [record],
        start_ym=start_ym,
        end_ym=end_ym,
        wind_source=effective_wind,
    )
    if not built["sites"]:
        raise ValueError(f"Insufficient monthly NASA POWER data at ({lat_f}, {lon_f}) for {start_ym}..{end_ym}")

    site = built["sites"][0]
    site["site_id"] = target_site_id
    site["region"] = target_region
    site["country"] = country
    site["lat"] = lat_f
    site["lon"] = lon_f
    site["extra_metrics"]["cache_source"] = source_tag
    site["extra_metrics"]["wind_source_used"] = effective_wind
    return site


def _load_baseline_payload(wind_source: str = "gwa") -> dict[str, Any]:
    path = BASELINE_PIPELINE_MERRA2_PATH if wind_source == "merra2" else BASELINE_PIPELINE_PATH
    if not path.exists():
        path = REPO_ROOT / ("pipeline_output_merra2.json" if wind_source == "merra2" else "pipeline_output.json")
    resolved = path.resolve()
    return copy.deepcopy(_read_json_cached(str(resolved), resolved.stat().st_mtime_ns))


def evaluate_coordinates(
    lat: float,
    lon: float,
    *,
    site_id: str | None = None,
    region: str | None = None,
    country: str = "Finland",
    wind_source: str = "gwa",
    include_baseline: bool = False,
    horizon_years: int = 10,
    use_cache: bool = True,
) -> dict[str, Any]:
    """Fetch/clean data for (lat, lon) and run Site Ranker v5 (standalone physical reference by default)."""
    point_site = build_site_for_coordinates(
        lat,
        lon,
        site_id=site_id,
        region=region,
        country=country,
        wind_source=wind_source,
        use_cache=use_cache,
    )
    target_site_id = point_site["site_id"]

    if include_baseline:
        base_payload = _load_baseline_payload(wind_source=wind_source)
        sites = [s for s in base_payload["sites"] if s["site_id"] != target_site_id]
        sites.append(point_site)
        payload = {
            "pipeline": {
                "analysis_id": f"{base_payload['pipeline']['analysis_id']}+point",
                "analysis_period": base_payload["pipeline"]["analysis_period"],
                "horizon_years": horizon_years,
            },
            "sites": sites,
        }
    else:
        payload = {
            "pipeline": {
                "analysis_id": f"single-point-{wind_source}-v5",
                "analysis_period": {"start": "2005-01", "end": "2024-12"},
                "horizon_years": horizon_years,
            },
            "sites": [point_site],
        }

    frontend = evaluate_site_ranker(payload)
    point_ranking = next((r for r in frontend["ranking"] if r["site_id"] == target_site_id), None)
    point_charts = frontend["charts"].get(target_site_id)

    return {
        "target_site_id": target_site_id,
        "total_ranked": frontend["meta"]["ranked_sites"],
        "point_input": point_site,
        "point_ranking": point_ranking,
        "point_charts": point_charts,
        "frontend": frontend,
    }


def evaluate_multiple_coordinates(
    points: list[dict[str, Any]],
    *,
    wind_source: str = "gwa",
    include_baseline: bool = False,
    horizon_years: int = 10,
    use_cache: bool = True,
) -> dict[str, Any]:
    """Evaluate a batch of custom (lat, lon) coordinate points together in Site Ranker v5."""
    if not points:
        raise ValueError("points must be a non-empty list")

    built_sites: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for idx, item in enumerate(points):
        if "lat" not in item or "lon" not in item:
            raise ValueError(f"points[{idx}] must contain 'lat' and 'lon'")
        site = build_site_for_coordinates(
            item["lat"],
            item["lon"],
            site_id=item.get("site_id"),
            region=item.get("region"),
            country=item.get("country", "Finland"),
            wind_source=wind_source,
            use_cache=use_cache,
        )
        sid = site["site_id"]
        if sid in seen_ids:
            sid = f"{sid}_{idx}"
            site["site_id"] = sid
        seen_ids.add(sid)
        built_sites.append(site)

    if include_baseline:
        base_payload = _load_baseline_payload(wind_source=wind_source)
        merged_sites = [s for s in base_payload["sites"] if s["site_id"] not in seen_ids] + built_sites
        analysis_period = base_payload["pipeline"]["analysis_period"]
        analysis_id = f"{base_payload['pipeline']['analysis_id']}+batch"
    else:
        merged_sites = built_sites
        analysis_period = {"start": "2005-01", "end": "2024-12"}
        analysis_id = f"custom-batch-{wind_source}-v5"

    frontend = evaluate_site_ranker(
        {
            "pipeline": {
                "analysis_id": analysis_id,
                "analysis_period": analysis_period,
                "horizon_years": horizon_years,
            },
            "sites": merged_sites,
        }
    )

    target_ids = [s["site_id"] for s in built_sites]
    ranking_map = {r["site_id"]: r for r in frontend["ranking"]}
    return {
        "target_site_ids": target_ids,
        "total_ranked": frontend["meta"]["ranked_sites"],
        "points_input": built_sites,
        "points_ranking": [ranking_map.get(sid) for sid in target_ids],
        "points_charts": {sid: frontend["charts"].get(sid) for sid in target_ids},
        "frontend": frontend,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lat", type=float, required=True, help="Latitude [-90, 90]")
    parser.add_argument("--lon", type=float, required=True, help="Longitude [-180, 180]")
    parser.add_argument("--site-id", type=str, default=None, help="Optional custom site_id")
    parser.add_argument("--region", type=str, default=None, help="Optional region/label name")
    parser.add_argument("--country", type=str, default="Finland", help="Country label")
    parser.add_argument("--wind-source", choices=("gwa", "merra2"), default="gwa")
    parser.add_argument("--include-baseline", action="store_true", help="Include the 19 Finland baseline regions for cohort-relative ranking")
    parser.add_argument("--no-baseline", action="store_true", help="Evaluate only the single point without the 19 baseline regions (default)")
    parser.add_argument("--no-cache", action="store_true", help="Force live API re-fetch")
    parser.add_argument("--out", type=Path, default=None, help="Optional output JSON path")
    args = parser.parse_args()

    result = evaluate_coordinates(
        args.lat,
        args.lon,
        site_id=args.site_id,
        region=args.region,
        country=args.country,
        wind_source=args.wind_source,
        include_baseline=bool(args.include_baseline and not args.no_baseline),
        use_cache=not args.no_cache,
    )
    pr = result["point_ranking"]
    print(f"Evaluated {result['target_site_id']} ({args.lat}, {args.lon}) -> rank {pr['rank']}/{result['total_ranked']}, score={pr['scores']['overall']:.2f}/100")
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
        print(f"Saved JSON to {args.out.resolve()}")


if __name__ == "__main__":
    main()
