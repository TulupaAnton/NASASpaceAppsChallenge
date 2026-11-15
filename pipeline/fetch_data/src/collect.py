import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter

MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
GWA_POWER_DENSITY_URL = "https://globalwindatlas.info/api/gwa/custom/powerDensity"
GWA_WIND_SPEED_URL = "https://globalwindatlas.info/api/gwa/custom/windSpeed"
GWA_TEMPORAL_URL = "https://globalwindatlas.info/api/temporal/"
DEM_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
FLOOD_API_URL = "https://flood-api.open-meteo.com/v1/flood"
WATER_SEARCH_RADII_KM = (0.5, 2.0, 5.0, 12.0)
GWA_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://globalwindatlas.info/en",
    "Origin": "https://globalwindatlas.info",
}

FETCH_DATA_DIR = Path(__file__).resolve().parent.parent
DEFAULT_RAW_DIR = FETCH_DATA_DIR / "data" / "raw"

# 10 target NASA POWER variables (within 20-param limit)
DATACENTER_PARAMETERS: list[str] = [
    # 1. Cooling efficiency (primary OPEX driver & Site Ranker v5 contract)
    "T2M",                # Mean air temperature at 2 m (C)
    "T2M_MAX_AVG",        # Monthly mean of daily max air temperature at 2 m (C)
    "T2M_MAX",            # Monthly absolute maximum temperature at 2 m (C)
    "T2MWET",             # Wet-bulb temperature at 2 m (C)
    "RH2M",               # Relative humidity at 2 m (%)
    # 2. On-site / regional renewable energy potential
    "WS50M",              # Wind speed at 50 m (m/s)
    "ALLSKY_SFC_SW_DWN",  # Actual surface solar irradiance with clouds (kW-hr/m^2/day)
    "CLRSKY_SFC_SW_DWN",  # Clear-sky surface solar irradiance (kW-hr/m^2/day)
    # 3. Climate & structural risks
    "PRECTOTCORR",        # Bias-corrected precipitation (mm/day -> converted to mm/year)
    "WS10M",              # Near-surface wind speed at 10 m (m/s)
]

# Backward-compatible alias
DEFAULT_PARAMETERS = DATACENTER_PARAMETERS

# All 19 official regions of Finland (Maakunnat, ISO 3166-2:FI)
# Multi-point sampling is used for the 4 largest northern/eastern regions.
FINLAND_REGIONS: dict[str, dict[str, Any]] = {
    "lapland": {
        "iso_code": "FI-10",
        "name": "Lapland (Lappi)",
        "name_fi": "Lappi",
        "name_uk": "Лапландія",
        "hub_city": "Rovaniemi",
        "lat": 66.50,
        "lon": 25.73,
        "points": [
            {"name": "Rovaniemi", "lat": 66.50, "lon": 25.73},
            {"name": "Sodankylä", "lat": 67.42, "lon": 26.59},
            {"name": "Inari", "lat": 68.91, "lon": 27.03},
        ],
    },
    "north_ostrobothnia": {
        "iso_code": "FI-14",
        "name": "North Ostrobothnia (Pohjois-Pohjanmaa)",
        "name_fi": "Pohjois-Pohjanmaa",
        "name_uk": "Північна Остроботнія",
        "hub_city": "Oulu",
        "lat": 65.01,
        "lon": 25.47,
        "points": [
            {"name": "Oulu", "lat": 65.01, "lon": 25.47},
            {"name": "Kuusamo", "lat": 65.97, "lon": 29.18},
        ],
    },
    "kainuu": {
        "iso_code": "FI-05",
        "name": "Kainuu",
        "name_fi": "Kainuu",
        "name_uk": "Кайнуу",
        "hub_city": "Kajaani",
        "lat": 64.23,
        "lon": 27.73,
        "points": [
            {"name": "Kajaani", "lat": 64.23, "lon": 27.73},
            {"name": "Suomussalmi", "lat": 64.89, "lon": 28.91},
        ],
    },
    "north_karelia": {
        "iso_code": "FI-13",
        "name": "North Karelia (Pohjois-Karjala)",
        "name_fi": "Pohjois-Karjala",
        "name_uk": "Північна Карелія",
        "hub_city": "Joensuu",
        "lat": 62.60,
        "lon": 29.76,
        "points": [
            {"name": "Joensuu", "lat": 62.60, "lon": 29.76},
            {"name": "Lieksa", "lat": 63.32, "lon": 30.02},
        ],
    },
    "central_ostrobothnia": {
        "iso_code": "FI-07",
        "name": "Central Ostrobothnia (Keski-Pohjanmaa)",
        "name_fi": "Keski-Pohjanmaa",
        "name_uk": "Центральна Остроботнія",
        "hub_city": "Kokkola",
        "lat": 63.84,
        "lon": 23.13,
        "points": [{"name": "Kokkola", "lat": 63.84, "lon": 23.13}],
    },
    "ostrobothnia": {
        "iso_code": "FI-12",
        "name": "Ostrobothnia (Pohjanmaa)",
        "name_fi": "Pohjanmaa",
        "name_uk": "Остроботнія",
        "hub_city": "Vaasa",
        "lat": 63.10,
        "lon": 21.62,
        "points": [{"name": "Vaasa", "lat": 63.10, "lon": 21.62}],
    },
    "south_ostrobothnia": {
        "iso_code": "FI-03",
        "name": "South Ostrobothnia (Etelä-Pohjanmaa)",
        "name_fi": "Etelä-Pohjanmaa",
        "name_uk": "Південна Остроботнія",
        "hub_city": "Seinäjoki",
        "lat": 62.79,
        "lon": 22.84,
        "points": [{"name": "Seinäjoki", "lat": 62.79, "lon": 22.84}],
    },
    "central_finland": {
        "iso_code": "FI-08",
        "name": "Central Finland (Keski-Suomi)",
        "name_fi": "Keski-Suomi",
        "name_uk": "Центральна Фінляндія",
        "hub_city": "Jyväskylä",
        "lat": 62.24,
        "lon": 25.75,
        "points": [{"name": "Jyväskylä", "lat": 62.24, "lon": 25.75}],
    },
    "north_savo": {
        "iso_code": "FI-15",
        "name": "North Savo (Pohjois-Savo)",
        "name_fi": "Pohjois-Savo",
        "name_uk": "Північне Саво",
        "hub_city": "Kuopio",
        "lat": 62.89,
        "lon": 27.68,
        "points": [{"name": "Kuopio", "lat": 62.89, "lon": 27.68}],
    },
    "south_savo": {
        "iso_code": "FI-04",
        "name": "South Savo (Etelä-Savo)",
        "name_fi": "Etelä-Savo",
        "name_uk": "Південне Саво",
        "hub_city": "Mikkeli",
        "lat": 61.69,
        "lon": 27.27,
        "points": [{"name": "Mikkeli", "lat": 61.69, "lon": 27.27}],
    },
    "pirkanmaa": {
        "iso_code": "FI-11",
        "name": "Pirkanmaa",
        "name_fi": "Pirkanmaa",
        "name_uk": "Пірканмаа",
        "hub_city": "Tampere",
        "lat": 61.50,
        "lon": 23.79,
        "points": [{"name": "Tampere", "lat": 61.50, "lon": 23.79}],
    },
    "satakunta": {
        "iso_code": "FI-17",
        "name": "Satakunta",
        "name_fi": "Satakunta",
        "name_uk": "Сатакунта",
        "hub_city": "Pori",
        "lat": 61.49,
        "lon": 21.80,
        "points": [{"name": "Pori", "lat": 61.49, "lon": 21.80}],
    },
    "varsinais_suomi": {
        "iso_code": "FI-19",
        "name": "Southwest Finland (Varsinais-Suomi)",
        "name_fi": "Varsinais-Suomi",
        "name_uk": "Південно-Західна Фінляндія",
        "hub_city": "Turku",
        "lat": 60.45,
        "lon": 22.27,
        "points": [{"name": "Turku", "lat": 60.45, "lon": 22.27}],
    },
    "kanta_hame": {
        "iso_code": "FI-06",
        "name": "Kanta-Häme",
        "name_fi": "Kanta-Häme",
        "name_uk": "Канта-Хяме",
        "hub_city": "Hämeenlinna",
        "lat": 61.00,
        "lon": 24.46,
        "points": [{"name": "Hämeenlinna", "lat": 61.00, "lon": 24.46}],
    },
    "paijat_hame": {
        "iso_code": "FI-16",
        "name": "Päijät-Häme",
        "name_fi": "Päijät-Häme",
        "name_uk": "Пяйят-Хяме",
        "hub_city": "Lahti",
        "lat": 60.98,
        "lon": 25.66,
        "points": [{"name": "Lahti", "lat": 60.98, "lon": 25.66}],
    },
    "kymenlaakso": {
        "iso_code": "FI-09",
        "name": "Kymenlaakso",
        "name_fi": "Kymenlaakso",
        "name_uk": "Кюменлааксо",
        "hub_city": "Kouvola / Hamina",
        "lat": 60.57,
        "lon": 26.94,
        "points": [{"name": "Kouvola / Hamina", "lat": 60.57, "lon": 26.94}],
    },
    "south_karelia": {
        "iso_code": "FI-02",
        "name": "South Karelia (Etelä-Karjala)",
        "name_fi": "Etelä-Karjala",
        "name_uk": "Південна Карелія",
        "hub_city": "Lappeenranta",
        "lat": 61.06,
        "lon": 28.19,
        "points": [{"name": "Lappeenranta", "lat": 61.06, "lon": 28.19}],
    },
    "uusimaa": {
        "iso_code": "FI-18",
        "name": "Uusimaa",
        "name_fi": "Uusimaa",
        "name_uk": "Уусімаа (Гельсінкі)",
        "hub_city": "Helsinki / Espoo",
        "lat": 60.17,
        "lon": 24.94,
        "points": [{"name": "Helsinki / Espoo", "lat": 60.17, "lon": 24.94}],
    },
    "aland": {
        "iso_code": "FI-01",
        "name": "Åland Islands (Ahvenanmaa)",
        "name_fi": "Ahvenanmaa",
        "name_uk": "Аландські острови",
        "hub_city": "Mariehamn",
        "lat": 60.10,
        "lon": 19.93,
        "points": [{"name": "Mariehamn", "lat": 60.10, "lon": 19.93}],
    },
}

DEFAULT_LOCATIONS = FINLAND_REGIONS

_THREAD_LOCAL = threading.local()
_WATER_RATE_LOCK = threading.Lock()
_LAST_WATER_CALL_TS = 0.0


def _get_http_session() -> requests.Session:
    """Return a thread-local HTTP session for TCP/TLS connection reuse."""
    session = getattr(_THREAD_LOCAL, "session", None)
    if session is None:
        session = requests.Session()
        adapter = HTTPAdapter(pool_connections=10, pool_maxsize=20)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        _THREAD_LOCAL.session = session
    return session


def _request_json_with_retry(
    method: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 30,
    max_retries: int = 3,
) -> dict[str, Any]:
    last_exc: Exception | None = None
    session = _get_http_session()
    for attempt in range(max_retries):
        try:
            response = session.request(
                method,
                url,
                params=params,
                headers=headers,
                json=body,
                timeout=timeout,
            )
            if response.status_code in (429, 500, 502, 503, 504):
                last_exc = RuntimeError(f"HTTP {response.status_code}")
                sleep_s = 5.0 * (attempt + 1) if response.status_code == 429 else 1.5 * (2**attempt)
                time.sleep(sleep_s)
                continue
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_exc = exc
            if attempt < max_retries - 1:
                time.sleep(1.5 * (2**attempt))
    raise RuntimeError(f"Failed {method} {url}: {last_exc}") from last_exc


def fetch_monthly_point(
    lat: float,
    lon: float,
    parameters: list[str] = DATACENTER_PARAMETERS,
    start_year: int = 1984,
    end_year: int = 2024,
    community: str = "RE",
    max_retries: int = 3,
) -> dict[str, Any]:
    """Fetch monthly time-series JSON from NASA POWER API for a single point with retries."""
    params = {
        "parameters": ",".join(parameters),
        "community": community,
        "latitude": lat,
        "longitude": lon,
        "start": str(start_year),
        "end": str(end_year),
        "format": "JSON",
    }
    payload = _request_json_with_retry(
        "GET", MONTHLY_URL, params=params, timeout=60, max_retries=max_retries
    )
    if "properties" not in payload or "parameter" not in payload["properties"]:
        raise ValueError(f"Unexpected NASA POWER response schema at ({lat}, {lon})")
    return payload


def _post_json_with_retry(url: str, body: dict[str, Any], max_retries: int = 3) -> dict[str, Any]:
    return _request_json_with_retry(
        "POST", url, headers=GWA_HEADERS, body=body, timeout=30, max_retries=max_retries
    )


def fetch_terrain_point(
    lat: float,
    lon: float,
    step_deg: float = 0.005,
    max_retries: int = 3,
) -> dict[str, Any]:
    """Fetch Copernicus DEM elevation and local 5-point stencil terrain slope (degrees)."""
    lats = [lat, lat + step_deg, lat - step_deg, lat, lat]
    lons = [lon, lon, lon, lon + step_deg, lon - step_deg]
    payload = _request_json_with_retry(
        "GET",
        DEM_ELEVATION_URL,
        params={
            "latitude": ",".join(f"{v:.5f}" for v in lats),
            "longitude": ",".join(f"{v:.5f}" for v in lons),
        },
        timeout=20,
        max_retries=max_retries,
    )
    elevs = payload.get("elevation")
    if not isinstance(elevs, list) or len(elevs) != 5:
        raise ValueError(f"Unexpected elevation response at ({lat}, {lon})")
    z_c, z_n, z_s, z_e, z_w = [float(z) for z in elevs]
    dy = 2.0 * step_deg * 111320.0
    dx = 2.0 * step_deg * 111320.0 * max(math.cos(math.radians(lat)), 1e-6)
    dz_dy = (z_n - z_s) / dy
    dz_dx = (z_e - z_w) / dx
    slope_deg = round(math.degrees(math.atan(math.hypot(dz_dx, dz_dy))), 2)
    return {
        "elevation_m": round(z_c, 1),
        "slope_deg": slope_deg,
        "step_deg": step_deg,
    }


def _aggregate_terrain_points(terrain_points: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(terrain_points)
    return {
        "n_points": n,
        "elevation_m": round(sum(pt["elevation_m"] for pt in terrain_points) / n, 1),
        "slope_deg": round(sum(pt["slope_deg"] for pt in terrain_points) / n, 2),
        "source": "Copernicus DEM GLO-90 (90m grid via Open-Meteo Elevation API, https://open-meteo.com/en/docs/elevation-api)",
    }


def fetch_water_point(
    lat: float,
    lon: float,
    max_retries: int = 5,
) -> dict[str, Any]:
    """Estimate water distance (km) and local river discharge (m3/s) via 17-point GloFAS + DEM radial stencil."""
    global _LAST_WATER_CALL_TS
    with _WATER_RATE_LOCK:
        now = time.monotonic()
        wait_s = 0.4 - (now - _LAST_WATER_CALL_TS)
        if wait_s > 0:
            time.sleep(wait_s)
        _LAST_WATER_CALL_TS = time.monotonic()

    pts: list[tuple[float, float, float]] = [(lat, lon, 0.0)]
    cos_lat = max(math.cos(math.radians(lat)), 1e-4)
    for r_km in WATER_SEARCH_RADII_KM:
        for deg in (0, 90, 180, 270):
            rad = math.radians(deg)
            d_lat = (r_km / 111.32) * math.cos(rad)
            d_lon = (r_km / (111.32 * cos_lat)) * math.sin(rad)
            p_lat = max(-89.9, min(89.9, lat + d_lat))
            p_lon = ((lon + d_lon + 180.0) % 360.0) - 180.0
            pts.append((p_lat, p_lon, r_km))

    lat_str = ",".join(f"{p[0]:.5f}" for p in pts)
    lon_str = ",".join(f"{p[1]:.5f}" for p in pts)

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_flood = pool.submit(
            _request_json_with_retry,
            "GET",
            FLOOD_API_URL,
            params={
                "latitude": lat_str,
                "longitude": lon_str,
                "daily": "river_discharge",
                "past_days": 30,
                "forecast_days": 1,
            },
            timeout=25,
            max_retries=max_retries,
        )
        f_elev = pool.submit(
            _request_json_with_retry,
            "GET",
            DEM_ELEVATION_URL,
            params={"latitude": lat_str, "longitude": lon_str},
            timeout=20,
            max_retries=max_retries,
        )
        flood_resp = f_flood.result()
        elev_resp = f_elev.result()

    flood_list = flood_resp if isinstance(flood_resp, list) else [flood_resp]
    elevs = elev_resp.get("elevation") or []
    if len(flood_list) != len(pts) or len(elevs) != len(pts):
        raise ValueError(f"Unexpected water stencil response length at ({lat}, {lon})")

    mean_q: list[float] = []
    for item in flood_list:
        vals = [
            float(v)
            for v in (item.get("daily", {}).get("river_discharge") or [])
            if v is not None and math.isfinite(float(v))
        ]
        mean_q.append(sum(vals) / len(vals) if vals else 0.0)

    z_0 = float(elevs[0])
    q_0 = mean_q[0]

    water_radii: list[float] = []
    near_discharges: list[float] = []
    for i, (_, _, r_km) in enumerate(pts):
        z_i = float(elevs[i])
        q_i = mean_q[i]
        if r_km <= 2.0:
            near_discharges.append(q_i)
        is_sea = z_i <= 0.5
        is_river = q_i >= 1.5
        is_lake_basin = i > 0 and z_i <= z_0 - 2.0 and q_i >= 0.4
        if is_sea or is_river or is_lake_basin:
            water_radii.append(r_km)

    water_distance_km = min(water_radii) if water_radii else 20.0
    water_discharge_m3s = max(near_discharges) if near_discharges else q_0

    return {
        "water_distance_km": round(float(water_distance_km), 2),
        "water_discharge_m3s": round(float(water_discharge_m3s), 2),
        "center_discharge_m3s": round(float(q_0), 2),
    }


def _aggregate_water_points(water_points: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(water_points)
    return {
        "n_points": n,
        "water_distance_km": round(sum(pt["water_distance_km"] for pt in water_points) / n, 2),
        "water_discharge_m3s": round(sum(pt["water_discharge_m3s"] for pt in water_points) / n, 2),
        "center_discharge_m3s": round(sum(pt["center_discharge_m3s"] for pt in water_points) / n, 2),
        "source": "Copernicus GloFAS v4 Flood API & Copernicus DEM GLO-90 water-proximity stencil (https://open-meteo.com/en/docs/flood-api)",
    }


def _extract_gwa_percentile(area_means: list[dict[str, Any]], target_perc: int) -> float:
    if not area_means:
        raise ValueError("Empty Global Wind Atlas area_means response")
    for item in area_means:
        if int(item.get("sel_perc", -1)) == target_perc:
            return float(item["val"])
    return float(area_means[-1]["val"] if target_perc >= 50 else area_means[0]["val"])


def fetch_gwa_100m_point(
    lat: float,
    lon: float,
    box_deg: float = 0.02,
    max_retries: int = 3,
) -> dict[str, Any]:
    """Fetch 100m wind power density, 100m wind speed, and 12-month profile from Global Wind Atlas API."""
    poly = [[
        [round(lon - box_deg, 5), round(lat - box_deg, 5)],
        [round(lon + box_deg, 5), round(lat - box_deg, 5)],
        [round(lon + box_deg, 5), round(lat + box_deg, 5)],
        [round(lon - box_deg, 5), round(lat + box_deg, 5)],
        [round(lon - box_deg, 5), round(lat - box_deg, 5)],
    ]]

    with ThreadPoolExecutor(max_workers=3) as pool:
        f_pd = pool.submit(_post_json_with_retry, GWA_POWER_DENSITY_URL, {"height": 100, "coord": poly}, max_retries)
        f_ws = pool.submit(_post_json_with_retry, GWA_WIND_SPEED_URL, {"height": 100, "coord": poly}, max_retries)
        f_temp = pool.submit(_post_json_with_retry, GWA_TEMPORAL_URL, {"coord": poly}, max_retries)
        pd_resp = f_pd.result()
        ws_resp = f_ws.result()
        temp_resp = f_temp.result()

    pd_means = pd_resp.get("area_means") or []
    ws_means = ws_resp.get("area_means") or []
    wpd_100 = _extract_gwa_percentile(pd_means, 100)
    wpd_10 = _extract_gwa_percentile(pd_means, 10)
    ws_100 = _extract_gwa_percentile(ws_means, 100)
    ws_10 = _extract_gwa_percentile(ws_means, 10)

    annual_ts = temp_resp.get("annual_ts") or []
    by_month = {int(row["month"]): float(row["crosstable"]) for row in annual_ts if "month" in row and "crosstable" in row}
    if len(by_month) == 12:
        factors = [by_month[m] for m in range(1, 13)]
        mean_f = sum(factors) / 12.0
        wind_monthly_ms = [round(ws_100 * (f / mean_f), 4) if mean_f > 0 else round(ws_100, 4) for f in factors]
    else:
        wind_monthly_ms = [round(ws_100, 4)] * 12

    return {
        "height_m": 100,
        "box_deg": box_deg,
        "wind_power_density_w_m2": round(wpd_100, 2),
        "wind_speed_100m_ms": round(ws_100, 3),
        "windiest_10pct_power_density_w_m2": round(wpd_10, 2),
        "windiest_10pct_wind_speed_100m_ms": round(ws_10, 3),
        "wind_monthly_ms": wind_monthly_ms,
    }


def _aggregate_gwa_points(gwa_points: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(gwa_points)
    monthly = [
        round(sum(pt["wind_monthly_ms"][m_idx] for pt in gwa_points) / n, 4)
        for m_idx in range(12)
    ]
    return {
        "height_m": 100,
        "n_points": n,
        "wind_power_density_w_m2": round(sum(pt["wind_power_density_w_m2"] for pt in gwa_points) / n, 2),
        "wind_speed_100m_ms": round(sum(pt["wind_speed_100m_ms"] for pt in gwa_points) / n, 3),
        "windiest_10pct_power_density_w_m2": round(
            sum(pt["windiest_10pct_power_density_w_m2"] for pt in gwa_points) / n, 2
        ),
        "windiest_10pct_wind_speed_100m_ms": round(
            sum(pt["windiest_10pct_wind_speed_100m_ms"] for pt in gwa_points) / n, 3
        ),
        "wind_monthly_ms": monthly,
        "source": "DTU Global Wind Atlas v3.3 API (100m height, https://globalwindatlas.info)",
    }


def _aggregate_point_payloads(
    loc_id: str,
    loc: dict[str, Any],
    point_payloads: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]],
    start_year: int,
    end_year: int,
) -> dict[str, Any]:
    """Average NASA POWER, Global Wind Atlas, terrain, and water payloads across sampled points of a region."""
    base = json.loads(json.dumps(point_payloads[0][1]))
    fill_value = base.get("header", {}).get("fill_value", -999)
    n_points = len(point_payloads)

    if n_points > 1:
        param_names = list(base["properties"]["parameter"].keys())
        averaged_params: dict[str, dict[str, float]] = {}
        for p_name in param_names:
            time_keys = list(base["properties"]["parameter"][p_name].keys())
            merged_series: dict[str, float] = {}
            for tk in time_keys:
                vals = []
                for _, p_data, _, _, _ in point_payloads:
                    v = p_data["properties"]["parameter"].get(p_name, {}).get(tk, fill_value)
                    pt_fill = p_data.get("header", {}).get("fill_value", -999)
                    if v is not None and v != pt_fill and v != -999:
                        vals.append(float(v))
                merged_series[tk] = round(sum(vals) / len(vals), 4) if vals else float(fill_value)
            averaged_params[p_name] = merged_series
        base["properties"]["parameter"] = averaged_params

    subpoints_meta = [
        {
            "name": pt_info["name"],
            "lat": pt_info["lat"],
            "lon": pt_info["lon"],
            "grid_coords": p_data.get("geometry", {}).get("coordinates", []),
            "parameter": p_data["properties"]["parameter"],
            "gwa_100m": gwa_data,
            "terrain": terrain_data,
            "water": water_data,
        }
        for pt_info, p_data, gwa_data, terrain_data, water_data in point_payloads
    ]

    points_list = loc.get("points") or [{"name": loc.get("hub_city", loc["name"]), "lat": loc["lat"], "lon": loc["lon"]}]
    base["_meta"] = {
        "location_id": loc_id,
        "iso_code": loc.get("iso_code", ""),
        "name": loc["name"],
        "name_fi": loc.get("name_fi", loc["name"]),
        "name_uk": loc.get("name_uk", loc["name"]),
        "hub_city": loc.get("hub_city", ""),
        "lat": loc["lat"],
        "lon": loc["lon"],
        "centroid_lat": round(sum(pt["lat"] for pt in points_list) / len(points_list), 4),
        "centroid_lon": round(sum(pt["lon"] for pt in points_list) / len(points_list), 4),
        "points": points_list,
        "n_points": len(points_list),
        "start_year": start_year,
        "end_year": end_year,
    }
    base["_gwa_100m"] = _aggregate_gwa_points([g for _, _, g, _, _ in point_payloads])
    base["_terrain"] = _aggregate_terrain_points([t for _, _, _, t, _ in point_payloads])
    base["_water"] = _aggregate_water_points([w for _, _, _, _, w in point_payloads])
    base["_subpoints"] = subpoints_meta
    return base


def _is_cache_valid(
    out_file: Path,
    loc_id: str,
    loc: dict[str, Any],
    parameters: list[str],
    start_year: int,
    end_year: int,
) -> dict[str, Any] | None:
    if not out_file.exists():
        return None
    try:
        data = json.loads(out_file.read_text(encoding="utf-8"))
        meta = data.get("_meta", {})
        if meta.get("location_id") != loc_id:
            return None
        points_expected = len(loc.get("points") or [1])
        if meta.get("n_points") != points_expected:
            return None
        param_dict = data.get("properties", {}).get("parameter", {})
        if not all(p in param_dict for p in parameters):
            return None
        sample_keys = param_dict[parameters[0]]
        if f"{start_year}01" not in sample_keys or f"{end_year}12" not in sample_keys:
            return None
        gwa = data.get("_gwa_100m", {})
        if (
            not isinstance(gwa, dict)
            or float(gwa.get("wind_power_density_w_m2", 0)) <= 0
            or float(gwa.get("wind_speed_100m_ms", 0)) <= 0
            or len(gwa.get("wind_monthly_ms") or []) != 12
        ):
            return None
        return data
    except Exception:
        return None


def _is_terrain_valid(data: dict[str, Any]) -> bool:
    terrain = data.get("_terrain")
    return (
        isinstance(terrain, dict)
        and terrain.get("elevation_m") is not None
        and terrain.get("slope_deg") is not None
    )


def _is_water_valid(data: dict[str, Any]) -> bool:
    water = data.get("_water")
    return (
        isinstance(water, dict)
        and water.get("water_distance_km") is not None
        and water.get("water_discharge_m3s") is not None
    )


def _collect_single_region(
    loc_id: str,
    loc: dict[str, Any],
    parameters: list[str],
    start_year: int,
    end_year: int,
    out_file: Path,
    overwrite: bool,
) -> tuple[str, dict[str, Any], str]:
    points = loc.get("points") or [{"name": loc.get("hub_city", loc["name"]), "lat": loc["lat"], "lon": loc["lon"]}]
    if not overwrite:
        cached = _is_cache_valid(out_file, loc_id, loc, parameters, start_year, end_year)
        if cached is not None:
            need_terrain = not _is_terrain_valid(cached)
            need_water = not _is_water_valid(cached)
            if not need_terrain and not need_water:
                return loc_id, cached, "cached"
            enriched_tags: list[str] = []
            if need_terrain:
                terrain_pts = [fetch_terrain_point(lat=pt["lat"], lon=pt["lon"]) for pt in points]
                cached["_terrain"] = _aggregate_terrain_points(terrain_pts)
                for sp, t_data in zip(cached.get("_subpoints") or [], terrain_pts):
                    sp["terrain"] = t_data
                enriched_tags.append("_terrain")
            if need_water:
                water_pts = [fetch_water_point(lat=pt["lat"], lon=pt["lon"]) for pt in points]
                cached["_water"] = _aggregate_water_points(water_pts)
                for sp, w_data in zip(cached.get("_subpoints") or [], water_pts):
                    sp["water"] = w_data
                enriched_tags.append("_water")
            out_file.write_text(json.dumps(cached, ensure_ascii=False, indent=2), encoding="utf-8")
            return loc_id, cached, f"enriched ({', '.join(enriched_tags)}, {len(points)} pt)"

    point_payloads: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for pt in points:
            fut_nasa = pool.submit(
                fetch_monthly_point,
                lat=pt["lat"],
                lon=pt["lon"],
                parameters=parameters,
                start_year=start_year,
                end_year=end_year,
            )
            fut_gwa = pool.submit(fetch_gwa_100m_point, lat=pt["lat"], lon=pt["lon"])
            fut_terrain = pool.submit(fetch_terrain_point, lat=pt["lat"], lon=pt["lon"])
            fut_water = pool.submit(fetch_water_point, lat=pt["lat"], lon=pt["lon"])
            point_payloads.append((pt, fut_nasa.result(), fut_gwa.result(), fut_terrain.result(), fut_water.result()))

    merged = _aggregate_point_payloads(loc_id, loc, point_payloads, start_year, end_year)
    out_file.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return loc_id, merged, f"fetched ({len(points)} pt + GWA100m + DEM + Water)"


def collect_all(
    locations: dict[str, dict[str, Any]] = FINLAND_REGIONS,
    parameters: list[str] = DATACENTER_PARAMETERS,
    start_year: int = 1984,
    end_year: int = 2024,
    raw_dir: Path = DEFAULT_RAW_DIR,
    overwrite: bool = False,
    max_workers: int = 4,
) -> dict[str, Path]:
    """Download and save raw NASA POWER JSON files for all 19 Finnish regions."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    catalog: dict[str, dict[str, Any]] = {}
    saved_paths: dict[str, Path] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(
                _collect_single_region,
                loc_id,
                loc,
                parameters,
                start_year,
                end_year,
                raw_dir / f"{loc_id}.json",
                overwrite,
            ): loc_id
            for loc_id, loc in locations.items()
        }

        for fut in as_completed(futures):
            loc_id = futures[fut]
            _, data, status = fut.result()
            out_file = raw_dir / f"{loc_id}.json"
            saved_paths[loc_id] = out_file
            print(f"[{status}] {loc_id} ({locations[loc_id]['name']}) -> {out_file.name}")
            if not catalog and "parameters" in data:
                catalog = data["parameters"]

    if catalog:
        catalog_file = raw_dir / "parameters_catalog.json"
        catalog_file.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[saved] {catalog_file.name}")

    regions_catalog_file = raw_dir / "finland_regions_catalog.json"
    regions_catalog_file.write_text(
        json.dumps(locations, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[saved] {regions_catalog_file.name}")
    return saved_paths


if __name__ == "__main__":
    collect_all()
