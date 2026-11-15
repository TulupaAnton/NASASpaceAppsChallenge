"""Derive static web assets from data.rar and the supplied offline ranker outputs."""
from csv import DictReader
from collections import Counter
from pathlib import Path
from datetime import date
from hashlib import sha256
import argparse
import json
import math

PREFIX = "fetch_data/data/"
WIND_EXPORTS = {"gwa": "frontend.json", "merra2": "frontend_merra2.json"}
HISTORICAL = [(f"{year:04d}-{month:02d}") for year in range(2005, 2025) for month in range(1, 13)]
SCENARIO = [(f"{year:04d}-{month:02d}") for year in range(2025, 2035) for month in range(1, 13)]
HISTORY = [(date(year, month, 1).isoformat()) for year in range(1984, 2025) for month in range(1, 13)]


def load_documents(source, generated):
    """Read all supplied Finland records and the regenerated frontend exports."""
    paths = {PREFIX + f.relative_to(source).as_posix(): f for f in source.rglob("*") if f.is_file()}
    paths.update({"output/" + filename: generated / wind / "frontend.json"
                  for wind, filename in WIND_EXPORTS.items()})
    documents = {}
    for name, path in paths.items():
        raw = path.read_bytes()
        text = raw.decode("utf-8-sig")
        suffix = path.suffix
        if suffix == ".json":
            value = json.loads(text)
        elif suffix == ".csv":
            records = DictReader(text.splitlines())
            value = list(records)
            assert all(None not in row and None not in row.values() for row in value), name
        elif suffix == ".md":
            assert text.startswith("# "), name
            value = text
        else:
            raise ValueError(name)
        documents[name] = {"raw": raw, "value": value, "sha256": sha256(raw).hexdigest()}
    return documents


def clean_artifacts(documents):
    return {name.removeprefix(PREFIX + "clean/"): document for name, document in documents.items()
            if name.startswith(PREFIX + "clean/")}


def matching_csv_and_json(csvrows, jsonrows):
    assert len(csvrows) == len(jsonrows)
    for record, normalized in zip(csvrows, jsonrows, strict=True):
        assert record.keys() == normalized.keys()
        for key, value in record.items():
            item = normalized[key]
            if isinstance(item, bool):
                assert value.lower() == str(item).lower()
            elif isinstance(item, (int, float)) and not isinstance(item, bool):
                assert float(value) == item
            elif item is None:
                assert not value
            else:
                assert value == item


def validate(documents):
    parsed = lambda key: documents[key]["value"]
    clean = clean_artifacts(documents)
    regions = parsed(PREFIX + "raw/finland_regions_catalog.json")
    parameters = parsed(PREFIX + "raw/parameters_catalog.json")
    assert len(regions) == 19 and sum(len(entry["points"]) for entry in regions.values()) == 24
    assert len(parameters) == 10
    for wind, basename in WIND_EXPORTS.items():
        output = parsed("output/" + basename)
        assert output["meta"]["historical_period"] == [HISTORICAL[0], HISTORICAL[-1]]
        assert output["meta"]["scenario_period"] == [SCENARIO[0], SCENARIO[-1]]
        assert len(output["ranking"]) == 19 and not output["excluded"]
        assert {key: output["meta"]["weights"][key] for key in ("climate", "renewables", "water")} == {
            "climate": 0.25, "renewables": 0.60, "water": 0.15,
        }
        assert {"water_distance", "water_discharge"}.issubset(output["meta"]["active_metrics"])
        assert set(output["charts"]) == {"fi_" + code for code in regions}
        assert sorted(entry["rank"] for entry in output["ranking"]) == list(range(1, 20))
        assert all(entry["data_quality"]["complete_required_months"] == 240 for entry in output["ranking"])
        for row in output["ranking"]:
            assert all(math.isfinite(score) and 0 <= score <= 100 for score in row["scores"].values())
            assert len(row["validation"]["heldout_monthly"]) == 72
            assert row["measurements"]["water_distance_km"] is not None
            assert row["measurements"]["water_discharge_m3s"] is not None
            assert row["sources"]["water"]
            assert row["extra_metrics"]["iso_code"] == regions[row["site_id"][3:]]["iso_code"]
            charts = output["charts"][row["site_id"]]
            assert [x["date"] for x in charts["historical_monthly"]] == HISTORICAL
            assert [x["date"] for x in charts["scenario_monthly"]] == SCENARIO
            assert [x["month"] for x in charts["monthly_climatology"]] == list(range(1, 13))
            assert len(charts["scenario_year_blocks"]) == 10
        pipeline = clean["pipeline_output" + ("_merra2" if wind == "merra2" else "") + ".json"]["value"]
        assert {entry["site_id"] for entry in pipeline["sites"]} == set(output["charts"])
        assert all(set(entry["nasa_power"]["properties"]["parameter"]).issubset(parameters)
                   for entry in pipeline["sites"])
    legacy = clean["finland_datacenter_suitability.json"]["value"]
    matching_csv_and_json(clean["finland_datacenter_suitability.csv"]["value"], legacy["regions"])
    for code in regions:
        raw = parsed(PREFIX + f"raw/{code}.json")
        assert raw["_meta"]["location_id"] == code
        assert raw["_water"]["water_distance_km"] >= 0 and raw["_water"]["water_discharge_m3s"] >= 0
        assert raw["_meta"]["points"] == regions[code]["points"]
        assert len(raw["_subpoints"]) == len(regions[code]["points"])
        assert set(raw["properties"]["parameter"]) == set(parameters)
        assert all(len(values) == 41 * 13 for values in raw["properties"]["parameter"].values())
        for period, key, expected in (("monthly", "date", HISTORY), ("annual", "year", list(range(1984, 2025)))):
            rows = clean[f"{code}_{period}.json"]["value"]
            assert [row[key] for row in rows] == expected
            assert all(row["ALLSKY_SFC_SW_DWN"] <= row["CLRSKY_SFC_SW_DWN"] + 1e-6 for row in rows)
            assert all(row["T2MWET"] <= row["T2M"] + 1e-6 for row in rows)
            matching_csv_and_json(clean[f"{code}_{period}.csv"]["value"], rows)
    for period, count in (("monthly", 492), ("annual", 41)):
        rows = clean[f"finland_all_regions_{period}.csv"]["value"]
        assert Counter(row["region_id"] for row in rows) == dict.fromkeys(regions, count)
        for code in regions:
            subset = [row for row in rows if row["region_id"] == code]
            local = clean[f"{code}_{period}.csv"]["value"]
            for actual, expected in zip(subset, local, strict=True):
                assert all(actual[key] == value for key, value in expected.items())
    for name in documents:
        if "/points_cache/" in name:
            raw = parsed(name)
            assert set(raw["properties"]["parameter"]) == set(parameters)
            assert raw["_meta"]["location_id"] == Path(name).stem
            assert all(len(series) >= 240 for series in raw["properties"]["parameter"].values())
            assert raw["_terrain"].get("slope_deg") is not None
    return regions, parameters, legacy, clean


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")


def publish(documents, output_dir):
    regions, parameters, legacy, clean = validate(documents)
    sources = {wind: documents["output/" + basename]["value"] for wind, basename in WIND_EXPORTS.items()}
    metadata = {
        "regions": {"fi_" + code: item for code, item in regions.items()},
        "parameters": parameters,
        "legacySuitability": {
            "metadata": legacy["metadata"],
            "regions": {"fi_" + item["region_id"]: item for item in legacy["regions"]},
        },
    }
    write_json(output_dir / "metadata.json", metadata)
    for wind, source in sources.items():
        ranking = [
            {**item, "validation": {key: value for key, value in item["validation"].items() if key != "heldout_monthly"}}
            for item in source["ranking"]
        ]
        write_json(output_dir / f"{wind}.json",
                   {key: source[key] for key in ("meta", "diagnostics", "excluded")} | {"ranking": ranking})

    gwa, merra2 = sources["gwa"], sources["merra2"]
    gwa_ranking, merra2_ranking = [{r["site_id"]: r for r in s["ranking"]} for s in (gwa, merra2)]
    for site_id, chart in gwa["charts"].items():
        merra_chart = merra2["charts"][site_id]
        assert chart.keys() == merra_chart.keys()
        assert all(value == merra_chart[key] for key, value in chart.items() if key != "monthly_climatology")
        assert all({k: v for k, v in a.items() if k != "wind_speed_100m_ms"} ==
                   {k: v for k, v in b.items() if k != "wind_speed_100m_ms"}
                   for a, b in zip(chart["monthly_climatology"], merra_chart["monthly_climatology"], strict=True))
        heldout = gwa_ranking[site_id]["validation"]["heldout_monthly"]
        assert heldout == merra2_ranking[site_id]["validation"]["heldout_monthly"]
        write_json(output_dir / "charts" / f"{site_id}.json", {
            "chart": chart, "merra2WindClimatology": [item["wind_speed_100m_ms"] for item in merra_chart["monthly_climatology"]],
            "heldout": heldout,
        })

    history = output_dir / "history"
    history.mkdir(parents=True, exist_ok=True)
    for code in regions:
        for period in ("monthly", "annual"):
            basename = f"{code}_{period}.csv"
            (history / basename).write_bytes(clean[basename]["raw"])
    for basename in ("finland_all_regions_annual.csv", "finland_all_regions_monthly.csv",
                     "finland_datacenter_suitability.csv", "finland_datacenter_report.md"):
        (history / basename).write_bytes(clean[basename]["raw"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Extracted data.rar directory with raw/ and clean/")
    parser.add_argument("generated", type=Path, help="Directory containing gwa/ and merra2/ ranking outputs")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    documents = load_documents(args.source, args.generated)
    publish(documents, args.output)
    print(f"Validated {len(documents) - 2} archive entries and 2 regenerated ranking documents.")


if __name__ == "__main__":
    main()
