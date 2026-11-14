import json
from pathlib import Path
import requests

NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"


def fetch_parameter(
    parameter: str = "T2M",
    latitude: float = 50.4501,
    longitude: float = 30.5234,
    start: str = "20240101",
    end: str = "20240107",
    community: str = "RE",
    output_path: Path = Path("data/t2m_sample.json"),
) -> Path:
    """Fetch a single parameter from NASA POWER API and save the raw JSON."""
    params = {
        "parameters": parameter,
        "community": community,
        "latitude": latitude,
        "longitude": longitude,
        "start": start,
        "end": end,
        "format": "JSON",
    }

    response = requests.get(NASA_POWER_URL, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return output_path


if __name__ == "__main__":
    saved_file = fetch_parameter()
    print(f"Saved raw JSON to: {saved_file.resolve()}")
