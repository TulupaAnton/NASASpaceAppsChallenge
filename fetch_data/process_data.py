import json
from pathlib import Path
import pandas as pd


def process_power_json(
    input_path: Path = Path("data/t2m_sample.json"),
    output_csv: Path = Path("data/t2m_processed.csv"),
) -> pd.DataFrame:
    """Load a NASA POWER JSON file, clean fill values, and export to CSV."""
    raw = json.loads(input_path.read_text(encoding="utf-8"))

    header = raw.get("header", {})
    fill_value = header.get("fill_value", -999)
    units = raw.get("parameters", {})
    param_dict = raw["properties"]["parameter"]

    df = pd.DataFrame(param_dict)
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df.index.name = "date"
    df = df.replace(fill_value, pd.NA)

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_csv)

    print("Units metadata:", units)
    print("\nData:")
    print(df)
    print("\nSummary:")
    print(df.describe())
    return df


if __name__ == "__main__":
    process_power_json()
