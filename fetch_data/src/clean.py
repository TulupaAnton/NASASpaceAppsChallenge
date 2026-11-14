import json
from pathlib import Path
import pandas as pd


def clean_power_json(raw_path: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """
    Clean a NASA POWER monthly JSON file.

    Separates monthly records (YYYY01-YYYY12) from annual summaries (YYYY13),
    replaces fill_value (-999) with NaN, and returns (monthly_df, annual_df, stats).
    """
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    fill_value = raw.get("header", {}).get("fill_value", -999)
    param_dict = raw["properties"]["parameter"]

    df_raw = pd.DataFrame(param_dict)
    df_raw.index = df_raw.index.astype(str)
    df_raw = df_raw.replace(fill_value, pd.NA)

    # NASA POWER monthly endpoint includes month '13' for annual averages
    is_annual = df_raw.index.str.endswith("13")

    monthly_df = df_raw[~is_annual].copy()
    monthly_df.index = pd.to_datetime(monthly_df.index, format="%Y%m")
    monthly_df.index.name = "date"
    monthly_df = monthly_df.sort_index()
    monthly_df = monthly_df.dropna(how="all")

    annual_df = df_raw[is_annual].copy()
    annual_df.index = annual_df.index.str[:4].astype(int)
    annual_df.index.name = "year"
    annual_df = annual_df.sort_index()
    annual_df = annual_df.dropna(how="all")

    stats = {
        "file": raw_path.name,
        "monthly_rows": len(monthly_df),
        "annual_rows": len(annual_df),
        "missing_monthly_cells": int(monthly_df.isna().sum().sum()),
        "date_range": f"{monthly_df.index.min():%Y-%m} .. {monthly_df.index.max():%Y-%m}",
    }
    return monthly_df, annual_df, stats


def clean_all(
    raw_dir: Path = Path("data/raw"),
    clean_dir: Path = Path("data/clean"),
) -> None:
    """Clean all raw location JSONs and export CSV + JSON for the web app."""
    clean_dir.mkdir(parents=True, exist_ok=True)

    for raw_path in sorted(raw_dir.glob("*.json")):
        if raw_path.name == "parameters_catalog.json":
            continue

        loc_id = raw_path.stem
        monthly_df, annual_df, stats = clean_power_json(raw_path)

        monthly_csv = clean_dir / f"{loc_id}_monthly.csv"
        annual_csv = clean_dir / f"{loc_id}_annual.csv"
        monthly_json = clean_dir / f"{loc_id}_monthly.json"

        monthly_df.to_csv(monthly_csv)
        annual_df.to_csv(annual_csv)

        # Export JSON with ISO dates for easy consumption by a web frontend/API
        monthly_export = monthly_df.reset_index()
        monthly_export["date"] = monthly_export["date"].dt.strftime("%Y-%m-%d")
        monthly_json.write_text(
            monthly_export.to_json(orient="records", indent=2),
            encoding="utf-8",
        )

        print(
            f"[clean] {loc_id}: {stats['monthly_rows']} months ({stats['date_range']}), "
            f"{stats['annual_rows']} annual rows, missing={stats['missing_monthly_cells']}"
        )


if __name__ == "__main__":
    clean_all()
