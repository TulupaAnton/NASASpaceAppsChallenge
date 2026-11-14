import json
import time
from pathlib import Path
import requests

MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"

# Key Earth science variables (max 20 per NASA POWER request)
DEFAULT_PARAMETERS = [
    "T2M",                # Temperature at 2 Meters (C)
    "PRECTOTCORR",        # Precipitation Corrected (mm/day)
    "RH2M",               # Relative Humidity at 2 Meters (%)
    "WS2M",               # Wind Speed at 2 Meters (m/s)
    "ALLSKY_SFC_SW_DWN",  # All Sky Surface Shortwave Downward Irradiance (kW-hr/m^2/day)
]

# Demo locations covering diverse climate zones for the MVP
DEFAULT_LOCATIONS = {
    "kyiv": {"name": "Kyiv, Ukraine", "lat": 50.4501, "lon": 30.5234},
    "sahara": {"name": "Sahara (Tamanrasset, Algeria)", "lat": 22.7850, "lon": 5.5228},
    "amazon": {"name": "Amazon (Manaus, Brazil)", "lat": -3.1190, "lon": -60.0217},
    "arctic": {"name": "Arctic (Svalbard, Norway)", "lat": 78.2232, "lon": 15.6267},
}


def fetch_monthly_point(
    lat: float,
    lon: float,
    parameters: list[str],
    start_year: int = 1985,
    end_year: int = 2024,
    community: str = "RE",
) -> dict:
    """Fetch monthly time-series JSON from NASA POWER API for a single point."""
    params = {
        "parameters": ",".join(parameters),
        "community": community,
        "latitude": lat,
        "longitude": lon,
        "start": str(start_year),
        "end": str(end_year),
        "format": "JSON",
    }
    response = requests.get(MONTHLY_URL, params=params, timeout=60)
    response.raise_for_status()
    return response.json()


def collect_all(
    locations: dict[str, dict] = DEFAULT_LOCATIONS,
    parameters: list[str] = DEFAULT_PARAMETERS,
    start_year: int = 1985,
    end_year: int = 2024,
    raw_dir: Path = Path("data/raw"),
    overwrite: bool = False,
) -> None:
    """Download and save raw JSON files for all configured locations."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    catalog: dict[str, dict] = {}

    for loc_id, loc in locations.items():
        out_file = raw_dir / f"{loc_id}.json"
        if out_file.exists() and not overwrite:
            print(f"[skip] {loc_id} already exists: {out_file}")
            data = json.loads(out_file.read_text(encoding="utf-8"))
        else:
            print(f"[fetch] {loc_id} ({loc['name']}) {start_year}-{end_year}...")
            data = fetch_monthly_point(
                lat=loc["lat"],
                lon=loc["lon"],
                parameters=parameters,
                start_year=start_year,
                end_year=end_year,
            )
            data["_meta"] = {"location_id": loc_id, **loc}
            out_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
            print(f"[saved] {out_file}")
            time.sleep(0.5)

        if not catalog and "parameters" in data:
            catalog = data["parameters"]

    if catalog:
        catalog_file = raw_dir / "parameters_catalog.json"
        catalog_file.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
        print(f"[saved] {catalog_file}")


if __name__ == "__main__":
    collect_all()
