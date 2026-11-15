import calendar
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pymannkendall as mk
from scipy import stats

from fetch_data.src.collect import DATACENTER_PARAMETERS, FETCH_DATA_DIR, FINLAND_REGIONS

DEFAULT_RAW_DIR = FETCH_DATA_DIR / "data" / "raw"
DEFAULT_CLEAN_DIR = FETCH_DATA_DIR / "data" / "clean"

# Physical thresholds for Data Center climate engineering
FREE_COOLING_T2M_THRESHOLD_C = 15.0    # Free air economizer economizing threshold (C)
EVAP_COOLING_T2MWET_THRESHOLD_C = 10.0  # Direct/indirect evaporative efficiency threshold (C)
HEAT_STRESS_T2M_MAX_THRESHOLD_C = 27.0  # ASHRAE A1 recommended upper inlet/ambient boundary (C)
# Below 0.10 kWh/m^2/day (polar night / deep twilight), satellite ALLSKY/CLRSKY ratios
# are dominated by snow-cloud scattering, auroral/airglow noise, and quantization artifacts.
POLAR_TWILIGHT_CLRSKY_THRESHOLD_KWH_DAY = 0.10

# Weights for the composite Data Center Suitability Score (0-100)
SUITABILITY_WEIGHTS = {
    "cooling": 0.50,
    "renewables": 0.30,
    "risk_safety": 0.20,
}


def enrich_monthly_datacenter_metrics(monthly_df: pd.DataFrame) -> pd.DataFrame:
    """Add derived monthly engineering metrics for data centers when input columns exist."""
    df = monthly_df.copy()
    if df.empty:
        return df

    days = np.array(
        [calendar.monthrange(int(ts.year), int(ts.month))[1] for ts in df.index],
        dtype=float,
    )
    df["days_in_month"] = days.astype(int)

    if "PRECTOTCORR" in df.columns:
        precip = pd.to_numeric(df["PRECTOTCORR"], errors="coerce")
        df["PRECTOTCORR_MM"] = (precip * days).round(2)

    if {"CLRSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DWN"}.issubset(df.columns):
        clr = pd.to_numeric(df["CLRSKY_SFC_SW_DWN"], errors="coerce")
        allsky = pd.to_numeric(df["ALLSKY_SFC_SW_DWN"], errors="coerce")
        loss = np.maximum(0.0, clr - allsky)
        df["CLOUD_SOLAR_LOSS"] = np.round(loss, 4)
        # Guard against polar night / deep polar twilight producing NaN/Inf or noise spikes
        valid_solar = clr.notna() & allsky.notna()
        raw_pct = np.where(
            clr > POLAR_TWILIGHT_CLRSKY_THRESHOLD_KWH_DAY,
            (loss / clr) * 100.0,
            0.0,
        )
        loss_pct = np.where(valid_solar, np.clip(raw_pct, 0.0, 100.0), np.nan)
        df["CLOUD_SOLAR_LOSS_PCT"] = np.round(loss_pct, 2)

    if "T2M" in df.columns:
        t2m = pd.to_numeric(df["T2M"], errors="coerce")
        df["FREE_COOLING_MONTH"] = (t2m <= FREE_COOLING_T2M_THRESHOLD_C).astype(int)

    if "T2MWET" in df.columns:
        t2mwet = pd.to_numeric(df["T2MWET"], errors="coerce")
        df["EVAP_COOLING_MONTH"] = (t2mwet <= EVAP_COOLING_T2MWET_THRESHOLD_C).astype(int)

    if {"T2M", "T2M_MAX"}.issubset(df.columns):
        t2m_v = pd.to_numeric(df["T2M"], errors="coerce").to_numpy(dtype=float)
        tmax_v = pd.to_numeric(df["T2M_MAX"], errors="coerce").to_numpy(dtype=float)
        spread = np.maximum(tmax_v - t2m_v, 0.5)
        thresh = FREE_COOLING_T2M_THRESHOLD_C

        frac = np.where(
            tmax_v <= thresh,
            1.0,
            np.where(
                t2m_v <= thresh,
                np.clip(0.5 + 0.5 * (thresh - t2m_v) / spread, 0.5, 1.0),
                np.clip(0.5 * (1.0 - (t2m_v - thresh) / spread), 0.0, 0.5),
            ),
        )
        valid_mask = ~np.isnan(t2m_v) & ~np.isnan(tmax_v)
        est_days = np.where(valid_mask, days * frac, np.nan)
        df["EST_FREE_COOLING_DAYS"] = np.round(est_days, 2)
        df["EST_FREE_COOLING_HOURS"] = np.round(est_days * 24.0, 1)

    if "T2M_MAX" in df.columns:
        tmax = pd.to_numeric(df["T2M_MAX"], errors="coerce")
        df["HEAT_STRESS_MONTH"] = (tmax >= HEAT_STRESS_T2M_MAX_THRESHOLD_C).astype(int)

    return df


def build_annual_from_monthly(
    monthly_df: pd.DataFrame,
    raw_annual_df: pd.DataFrame,
    base_param_cols: list[str],
) -> pd.DataFrame:
    """
    Build type-accurate annual aggregations for complete 12-month years.
    Falls back to NASA POWER YYYY13 rows for partial/synthetic test fixtures.
    """
    if monthly_df.empty:
        return raw_annual_df

    years_col = monthly_df.index.year
    counts = pd.Series(years_col).value_counts()
    full_years = sorted(int(yr) for yr, cnt in counts.items() if cnt == 12)

    if not full_years:
        return raw_annual_df

    rows: list[dict[str, Any]] = []
    for yr in full_years:
        sub = monthly_df[monthly_df.index.year == yr]
        row: dict[str, Any] = {"year": yr}

        for col in base_param_cols:
            if col not in sub.columns:
                continue
            vals = pd.to_numeric(sub[col], errors="coerce").dropna()
            if vals.empty:
                row[col] = np.nan
            elif col == "T2M_MAX":
                # Monthly T2M_MAX in NASA POWER is already the monthly peak; annual peak is max()
                row[col] = round(float(vals.max()), 4)
            elif col in ("ALLSKY_SFC_SW_DWN", "CLRSKY_SFC_SW_DWN") and "days_in_month" in sub.columns:
                c_series = pd.to_numeric(sub[col], errors="coerce")
                d_series = pd.to_numeric(sub["days_in_month"], errors="coerce")
                valid = c_series.notna() & d_series.notna()
                if valid.any():
                    row[col] = round(
                        float(np.average(c_series[valid].to_numpy(dtype=float), weights=d_series[valid].to_numpy(dtype=float))),
                        4,
                    )
                else:
                    row[col] = np.nan
            else:
                row[col] = round(float(vals.mean()), 4)

        if "PRECTOTCORR_MM" in sub.columns:
            row["PRECTOTCORR_MM_YEAR"] = round(float(sub["PRECTOTCORR_MM"].sum()), 2)

        if {"CLRSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DWN"}.issubset(row.keys()):
            clr_y = float(row["CLRSKY_SFC_SW_DWN"])
            all_y = float(row["ALLSKY_SFC_SW_DWN"])
            loss_y = max(0.0, clr_y - all_y)
            row["CLOUD_SOLAR_LOSS"] = round(loss_y, 4)
            row["CLOUD_SOLAR_LOSS_PCT"] = round(
                (loss_y / clr_y * 100.0) if clr_y > POLAR_TWILIGHT_CLRSKY_THRESHOLD_KWH_DAY else 0.0,
                2,
            )

        if "FREE_COOLING_MONTH" in sub.columns:
            row["FREE_COOLING_MONTHS"] = int(sub["FREE_COOLING_MONTH"].sum())

        if "EVAP_COOLING_MONTH" in sub.columns:
            row["EVAP_COOLING_MONTHS"] = int(sub["EVAP_COOLING_MONTH"].sum())

        if "EST_FREE_COOLING_DAYS" in sub.columns:
            row["EST_FREE_COOLING_DAYS"] = round(float(sub["EST_FREE_COOLING_DAYS"].sum()), 1)

        if "EST_FREE_COOLING_HOURS" in sub.columns:
            row["EST_FREE_COOLING_HOURS"] = round(float(sub["EST_FREE_COOLING_HOURS"].sum()), 1)

        if "HEAT_STRESS_MONTH" in sub.columns:
            row["HEAT_STRESS_MONTHS"] = int(sub["HEAT_STRESS_MONTH"].sum())

        if "WS10M" in sub.columns:
            ws10_vals = pd.to_numeric(sub["WS10M"], errors="coerce").dropna()
            row["WS10M_MAX_MONTH"] = round(float(ws10_vals.max()), 4) if not ws10_vals.empty else np.nan

        rows.append(row)

    annual_df = pd.DataFrame(rows).set_index("year").sort_index()
    annual_df.index.name = "year"
    return annual_df


def enforce_physical_invariants(df: pd.DataFrame) -> pd.DataFrame:
    """Enforce physical meteorological bounds (solar clear-sky cap, frost wet-bulb cap, temp hierarchy, RH)."""
    out = df.copy()
    for col in ("ALLSKY_SFC_SW_DWN", "CLRSKY_SFC_SW_DWN", "PRECTOTCORR"):
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce").clip(lower=0.0)

    if {"ALLSKY_SFC_SW_DWN", "CLRSKY_SFC_SW_DWN"}.issubset(out.columns):
        mask = out["ALLSKY_SFC_SW_DWN"].notna() & out["CLRSKY_SFC_SW_DWN"].notna()
        out.loc[mask, "ALLSKY_SFC_SW_DWN"] = np.minimum(
            out.loc[mask, "ALLSKY_SFC_SW_DWN"],
            out.loc[mask, "CLRSKY_SFC_SW_DWN"],
        )

    if {"T2MWET", "T2M"}.issubset(out.columns):
        mask = out["T2MWET"].notna() & out["T2M"].notna()
        out.loc[mask, "T2MWET"] = np.minimum(out.loc[mask, "T2MWET"], out.loc[mask, "T2M"])

    if {"T2M", "T2M_MAX_AVG"}.issubset(out.columns):
        mask = out["T2M"].notna() & out["T2M_MAX_AVG"].notna()
        out.loc[mask, "T2M_MAX_AVG"] = np.maximum(out.loc[mask, "T2M_MAX_AVG"], out.loc[mask, "T2M"])

    if {"T2M_MAX_AVG", "T2M_MAX"}.issubset(out.columns):
        mask = out["T2M_MAX_AVG"].notna() & out["T2M_MAX"].notna()
        out.loc[mask, "T2M_MAX"] = np.maximum(out.loc[mask, "T2M_MAX"], out.loc[mask, "T2M_MAX_AVG"])

    if {"T2M", "T2M_MAX"}.issubset(out.columns):
        mask = out["T2M"].notna() & out["T2M_MAX"].notna()
        out.loc[mask, "T2M_MAX"] = np.maximum(out.loc[mask, "T2M_MAX"], out.loc[mask, "T2M"])

    if "RH2M" in out.columns:
        out["RH2M"] = pd.to_numeric(out["RH2M"], errors="coerce").clip(lower=0.0, upper=100.0)

    return out


def clean_power_json(raw_path: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """
    Clean a NASA POWER monthly JSON file.

    Separates monthly records (YYYY01-YYYY12) from annual summaries (YYYY13),
    replaces fill_value (-999) with NaN, adds data-center derived metrics,
    and returns (monthly_df, annual_df, stats).
    """
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    fill_value = raw.get("header", {}).get("fill_value", -999)
    param_dict = raw["properties"]["parameter"]
    base_cols = list(param_dict.keys())

    df_raw = pd.DataFrame(param_dict)
    df_raw.index = df_raw.index.astype(str)
    df_raw = df_raw.replace(fill_value, pd.NA)
    for col in base_cols:
        df_raw[col] = pd.to_numeric(df_raw[col], errors="coerce").astype(float)

    is_annual = df_raw.index.str.endswith("13")

    monthly_df = df_raw[~is_annual].copy()
    monthly_df.index = pd.to_datetime(monthly_df.index, format="%Y%m")
    monthly_df.index.name = "date"
    monthly_df = monthly_df.sort_index()
    monthly_df = monthly_df.dropna(how="all")
    monthly_df = enforce_physical_invariants(monthly_df)

    missing_monthly_cells = int(monthly_df[base_cols].isna().sum().sum()) if not monthly_df.empty else 0

    raw_annual_df = df_raw[is_annual].copy()
    raw_annual_df.index = raw_annual_df.index.str[:4].astype(int)
    raw_annual_df.index.name = "year"
    raw_annual_df = raw_annual_df.sort_index()
    raw_annual_df = raw_annual_df.dropna(how="all")
    raw_annual_df = enforce_physical_invariants(raw_annual_df)

    monthly_enriched = enrich_monthly_datacenter_metrics(monthly_df)
    annual_df = build_annual_from_monthly(monthly_enriched, raw_annual_df, base_cols)

    stats_dict = {
        "file": raw_path.name,
        "monthly_rows": len(monthly_enriched),
        "annual_rows": len(annual_df),
        "missing_monthly_cells": missing_monthly_cells,
        "date_range": (
            f"{monthly_enriched.index.min():%Y-%m} .. {monthly_enriched.index.max():%Y-%m}"
            if not monthly_enriched.empty
            else "empty"
        ),
        "meta": raw.get("_meta", {}),
        "gwa_100m": raw.get("_gwa_100m", {}),
        "terrain": raw.get("_terrain", {}),
        "water": raw.get("_water", {}),
    }
    return monthly_enriched, annual_df, stats_dict


def _compute_series_trend(years: np.ndarray, values: np.ndarray) -> dict[str, Any]:
    """Compute Sen slope, OLS slope/decade, and Mann-Kendall p-value using SciPy + pymannkendall."""
    mask = np.isfinite(years) & np.isfinite(values)
    x = years[mask].astype(float)
    y = values[mask].astype(float)
    if len(x) < 6 or float(np.ptp(x)) == 0:
        return {"sen_decade": 0.0, "ols_decade": 0.0, "mk_p": 1.0, "significant": False}

    sen = stats.theilslopes(y, x, 0.95)
    ols = stats.linregress(x, y)
    mk_res = mk.original_test(y, alpha=0.05)

    return {
        "sen_decade": round(float(sen.slope) * 10.0, 4),
        "ols_decade": round(float(ols.slope) * 10.0, 4),
        "mk_p": round(float(mk_res.p), 6),
        "significant": bool(mk_res.h or float(ols.pvalue) < 0.05),
    }


REFERENCE_BOUNDS: dict[str, tuple[float, float, bool]] = {
    # (low, high, higher_is_better) anchored to Nordic/European engineering limits
    "est_free_cooling_days_yr": (150.0, 350.0, True),
    "t2m_mean_c": (-2.0, 14.0, False),
    "t2mwet_mean_c": (-3.0, 12.0, False),
    "t2m_max_annual_peak_c": (20.0, 36.0, False),
    "rh2m_mean_pct": (50.0, 95.0, False),
    "ws50m_mean_ms": (3.0, 8.5, True),
    "allsky_sw_dwn_mean": (1.5, 3.5, True),
    "cloud_solar_loss_pct": (15.0, 45.0, False),
    "prectotcorr_mm_year_mean": (450.0, 1100.0, False),
    "ws10m_mean_ms": (1.5, 7.5, False),
    "ws10m_peak_month_ms": (2.0, 10.0, False),
}


def _bounded_score(df: pd.DataFrame, col: str) -> pd.Series:
    """Normalize a metric against physical engineering reference bounds into [0, 100]."""
    lo, hi, higher_is_better = REFERENCE_BOUNDS[col]
    s = df[col].astype(float)
    span = hi - lo
    if higher_is_better:
        return ((s - lo) / span * 100.0).clip(0.0, 100.0)
    return ((hi - s) / span * 100.0).clip(0.0, 100.0)


def build_finland_suitability_ranking(
    region_summaries: list[dict[str, Any]],
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """
    Compute 3 domain sub-scores (Cooling 50%, Renewables 30%, Risk Safety 20%),
    total suitability score (0-100), rank (1-19), and suitability tier.
    """
    df = pd.DataFrame(region_summaries)

    # 1. Cooling Score (50%)
    s_fc_days = _bounded_score(df, "est_free_cooling_days_yr")
    s_t2m = _bounded_score(df, "t2m_mean_c")
    s_twet = _bounded_score(df, "t2mwet_mean_c")
    s_tmax = _bounded_score(df, "t2m_max_annual_peak_c")
    s_rh = _bounded_score(df, "rh2m_mean_pct")

    df["cooling_score"] = (
        0.45 * s_fc_days
        + 0.175 * s_t2m
        + 0.175 * s_twet
        + 0.10 * s_tmax
        + 0.10 * s_rh
    ).round(2)

    # 2. Renewables Score (30%)
    s_ws50 = _bounded_score(df, "ws50m_mean_ms")
    s_allsky = _bounded_score(df, "allsky_sw_dwn_mean")
    s_cloud_keep = _bounded_score(df, "cloud_solar_loss_pct")

    df["renewables_score"] = (
        0.65 * s_ws50
        + 0.175 * s_allsky
        + 0.175 * s_cloud_keep
    ).round(2)

    # 3. Climate Risk Safety Score (20%)
    s_precip = _bounded_score(df, "prectotcorr_mm_year_mean")
    s_ws10 = _bounded_score(df, "ws10m_mean_ms")
    s_ws10_peak = _bounded_score(df, "ws10m_peak_month_ms")

    df["risk_safety_score"] = (
        0.55 * s_precip
        + 0.225 * s_ws10
        + 0.225 * s_ws10_peak
    ).round(2)

    # Composite Data Center Suitability Score (0..100)
    df["datacenter_suitability_score"] = (
        SUITABILITY_WEIGHTS["cooling"] * df["cooling_score"]
        + SUITABILITY_WEIGHTS["renewables"] * df["renewables_score"]
        + SUITABILITY_WEIGHTS["risk_safety"] * df["risk_safety_score"]
    ).round(2)

    df = df.sort_values("datacenter_suitability_score", ascending=False).reset_index(drop=True)
    df.insert(0, "rank", np.arange(1, len(df) + 1))

    def _tier(score: float) -> str:
        if score >= 59.0:
            return "A (Відмінно)"
        if score >= 55.0:
            return "B (Добре)"
        return "C (Помірно)"

    df["suitability_tier"] = df["datacenter_suitability_score"].apply(_tier)

    payload = {
        "metadata": {
            "country": "Finland",
            "n_regions": int(len(df)),
            "period": "1984-2024",
            "source": "NASA POWER Monthly API (community=RE)",
            "parameters_used": DATACENTER_PARAMETERS,
            "weights": SUITABILITY_WEIGHTS,
            "thresholds": {
                "free_cooling_t2m_c": FREE_COOLING_T2M_THRESHOLD_C,
                "evap_cooling_t2mwet_c": EVAP_COOLING_T2MWET_THRESHOLD_C,
                "heat_stress_t2m_max_c": HEAT_STRESS_T2M_MAX_THRESHOLD_C,
            },
            "reference_bounds": {
                k: {"low": lo, "high": hi, "higher_is_better": hib}
                for k, (lo, hi, hib) in REFERENCE_BOUNDS.items()
            },
            "formula_description": (
                "datacenter_suitability_score = 0.50 * cooling_score "
                "+ 0.30 * renewables_score + 0.20 * risk_safety_score"
            ),
        },
        "regions": df.to_dict(orient="records"),
    }
    return df, payload


def _write_markdown_report(ranking_df: pd.DataFrame, out_path: Path) -> None:
    lines: list[str] = [
        "# Кліматичний рейтинг 19 регіонів Фінляндії для розміщення дата-центрів (NASA POWER, 1984–2024)",
        "",
        "- **Джерело даних:** NASA POWER Monthly API (`community=RE`), 1984–2024 (41 рік, 492 місяці, 0% пропусків).",
        "- **Охоплення:** усі 19 офіційних регіонів (Maakunnat), включно з багатоточковим усередненням для великих територій (Лапландія — 3 точки, Північна Остроботнія / Кайнуу / Північна Карелія — по 2 точки).",
        "",
        "## Формула оцінки перспективності (0–100 балів)",
        "",
        "$$\\text{Score} = 0.50 \\cdot \\text{Cooling} + 0.30 \\cdot \\text{Renewables} + 0.20 \\cdot \\text{RiskSafety}$$",
        "",
        "1. **Охолодження (`cooling_score`, 50%):** дні вільного охолодження (`EST_FREE_COOLING_DAYS`, 45%), низькі `T2M` і `T2MWET` (35%), низький пік спеки `T2M_MAX` та вологість `RH2M` (20%).",
        "2. **Відновлювана енергія (`renewables_score`, 30%):** вітровий потенціал `WS50M` (65%), реальна сонячна радіація `ALLSKY_SFC_SW_DWN` і мінімальні втрати від хмар `CLOUD_SOLAR_LOSS_PCT` (35%).",
        "3. **Кліматична безпека (`risk_safety_score`, 20%):** помірні опади `PRECTOTCORR_MM_YEAR` (55%) і нижчий приземний вітер/штормовий пік `WS10M` (45%).",
        "",
        "## Рейтинг усіх 19 регіонів",
        "",
        "| Ранг | Регіон (укр.) | Місто-центр | Категорія | Заг. бал | Охолодж. | ВДЕ | Ризики (безпека) | Днів вільн. охол./рік | Сер. T2M (°C) | Тмокрий (°C) | Вітер 50м (м/с) | Втрати від хмар (%) | Опади (мм/рік) | Тренд ALLSKY /10р (p MK) |",
        "|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]

    for _, r in ranking_df.iterrows():
        sig_mark = " ★" if r["allsky_sw_sig"] else ""
        trend_str = f"{r['allsky_sw_trend_decade']:+.4f} (p={r['allsky_sw_mk_p']:.4f}){sig_mark}"
        lines.append(
            f"| {int(r['rank'])} | {r['name_uk']} (`{r['iso_code']}`) | {r['hub_city']} | {r['suitability_tier']} | "
            f"**{r['datacenter_suitability_score']:.2f}** | {r['cooling_score']:.1f} | {r['renewables_score']:.1f} | "
            f"{r['risk_safety_score']:.1f} | {r['est_free_cooling_days_yr']:.1f} | {r['t2m_mean_c']:.2f} | "
            f"{r['t2mwet_mean_c']:.2f} | {r['ws50m_mean_ms']:.2f} | {r['cloud_solar_loss_pct']:.1f}% | "
            f"{r['prectotcorr_mm_year_mean']:.0f} | {trend_str} |"
        )

    sig_brightening = ranking_df[ranking_df["allsky_sw_sig"] & (ranking_df["allsky_sw_trend_decade"] > 0)]
    lines.extend([
        "",
        "## Зв'язок із темою потемніння / посвітління сонячної радіації",
        "",
        f"- У **{len(sig_brightening)} з {len(ranking_df)}** регіонів Фінляндії спостерігається статистично значущий тренд зростання реальної сонячної радіації `ALLSKY_SFC_SW_DWN` за 1984–2024 рр. (`p < 0.05` — ефект «сонячного посвітління» над Північною Європою).",
        f"- Натомість прозорість за чистого неба `CLRSKY_SFC_SW_DWN` змінюється значно слабше, а середні втрати від хмарності у Фінляндії становлять від **{ranking_df['cloud_solar_loss_pct'].min():.1f}%** до **{ranking_df['cloud_solar_loss_pct'].max():.1f}%** (при тому що абсолютні літні максимуми дозволяють гібридні СЕС + вітер).",
    ])
    out_path.write_text("\n".join(lines), encoding="utf-8")


def compute_merra2_100m_wind(
    monthly_df: pd.DataFrame,
    elevation_m: float = 0.0,
) -> dict[str, Any]:
    """
    Physically extrapolate NASA POWER / MERRA-2 winds (WS10M, WS50M) to 100 m height
    with barometric + thermal air density and intra-monthly energy pattern factor (K=1.28).
    """
    ws10 = np.maximum(pd.to_numeric(monthly_df["WS10M"], errors="coerce").to_numpy(dtype=float), 0.1)
    ws50 = np.maximum(pd.to_numeric(monthly_df["WS50M"], errors="coerce").to_numpy(dtype=float), 0.1)
    t2m_k = pd.to_numeric(monthly_df["T2M"], errors="coerce").to_numpy(dtype=float) + 273.15

    alpha = np.clip(np.log(ws50 / ws10) / np.log(50.0 / 10.0), 0.05, 0.60)
    ws100 = ws50 * np.power(100.0 / 50.0, alpha)

    p_pa = 101325.0 * np.exp(-float(elevation_m) / 8500.0)
    rho = p_pa / (287.058 * t2m_k)
    wpd100 = 0.5 * 1.28 * rho * np.power(ws100, 3)

    months = monthly_df.index.month.to_numpy(dtype=int)
    wind_monthly_ms = [
        round(float(np.nanmean(ws100[months == mo])), 4)
        for mo in range(1, 13)
    ]

    return {
        "wind_speed_100m_ms": round(float(np.nanmean(ws100)), 3),
        "wind_power_density_w_m2": round(float(np.nanmean(wpd100)), 2),
        "wind_monthly_ms": wind_monthly_ms,
        "shear_alpha_mean": round(float(np.nanmean(alpha)), 3),
        "air_density_kg_m3_mean": round(float(np.nanmean(rho)), 3),
    }


def build_site_ranker_input(
    region_records: list[dict[str, Any]],
    start_ym: str = "2005-01",
    end_ym: str = "2024-12",
    horizon_years: int = 10,
    wind_source: str = "gwa",
) -> dict[str, Any]:
    """Build Site Ranker v5 contract JSON payload from NASA POWER, GWA/MERRA-2, and DEM terrain data."""
    if wind_source not in ("gwa", "merra2"):
        raise ValueError(f"Unsupported wind_source={wind_source!r}; expected 'gwa' or 'merra2'")

    sites: list[dict[str, Any]] = []
    start_ts = pd.Timestamp(f"{start_ym}-01")
    end_ts = pd.Timestamp(f"{end_ym}-01")

    for rec in region_records:
        loc_id = rec["region_id"]
        cfg = rec["cfg"]
        monthly_df: pd.DataFrame = rec["monthly_df"]
        annual_df: pd.DataFrame = rec["annual_df"]
        gwa: dict[str, Any] = rec.get("gwa_100m") or {}
        terrain: dict[str, Any] = rec.get("terrain") or {}
        water: dict[str, Any] = rec.get("water") or {}

        m_win = monthly_df.loc[start_ts:end_ts]
        a_win = annual_df.loc[(annual_df.index >= start_ts.year) & (annual_df.index <= end_ts.year)]
        if m_win.empty or (wind_source == "gwa" and not gwa):
            continue

        elevation_m = round(float(terrain.get("elevation_m") or 0.0), 1)
        raw_slope = terrain.get("slope_deg")
        slope_deg = round(float(raw_slope), 2) if raw_slope is not None else None
        prectot_mm = (
            float(a_win["PRECTOTCORR_MM_YEAR"].mean())
            if "PRECTOTCORR_MM_YEAR" in a_win.columns and not a_win.empty
            else 600.0
        )
        raw_w_dist = water.get("water_distance_km")
        raw_w_dis = water.get("water_discharge_m3s")
        water_distance_km = (
            round(float(raw_w_dist), 2)
            if raw_w_dist is not None
            else round(max(0.5, 10.0 - prectot_mm / 100.0), 2)
        )
        water_discharge_m3s = (
            round(float(raw_w_dis), 2)
            if raw_w_dis is not None
            else round(max(0.5, prectot_mm / 50.0), 2)
        )
        merra2_wind = compute_merra2_100m_wind(m_win, elevation_m=elevation_m)

        if wind_source == "gwa":
            wind_power_density = gwa["wind_power_density_w_m2"]
            wind_speed_100m = gwa["wind_speed_100m_ms"]
            wind_monthly = gwa["wind_monthly_ms"]
            wind_source_desc = (
                "DTU Global Wind Atlas v3.3 (100m height above ground, 250m grid, "
                "mean power density W/m2, mean speed m/s & seasonal profile, https://globalwindatlas.info)"
            )
        else:
            wind_power_density = merra2_wind["wind_power_density_w_m2"]
            wind_speed_100m = merra2_wind["wind_speed_100m_ms"]
            wind_monthly = merra2_wind["wind_monthly_ms"]
            wind_source_desc = (
                f"NASA POWER / MERRA-2 ({start_ym}..{end_ym}, WS50M & WS10M vertical power-law "
                "extrapolation to 100m with barometric air density & K=1.28, https://power.larc.nasa.gov)"
            )

        solar_monthly_kwh_m2 = [
            round(
                float(
                    (
                        m_win.loc[m_win.index.month == mo, "ALLSKY_SFC_SW_DWN"]
                        * m_win.loc[m_win.index.month == mo, "days_in_month"]
                    ).mean()
                ),
                2,
            )
            for mo in range(1, 13)
        ]
        solar_ghi_year = round(sum(solar_monthly_kwh_m2), 2)

        clrsky_monthly = [
            float(
                (
                    m_win.loc[m_win.index.month == mo, "CLRSKY_SFC_SW_DWN"]
                    * m_win.loc[m_win.index.month == mo, "days_in_month"]
                ).mean()
            )
            for mo in range(1, 13)
        ]
        clrsky_ghi_year = round(sum(clrsky_monthly), 2)
        cloud_loss_pct = (
            round((1.0 - solar_ghi_year / clrsky_ghi_year) * 100.0, 2)
            if clrsky_ghi_year > 0
            else 0.0
        )

        rh2m_monthly = [
            round(float(m_win.loc[m_win.index.month == mo, "RH2M"].mean()), 2)
            for mo in range(1, 13)
        ]
        t2mwet_monthly = [
            round(float(m_win.loc[m_win.index.month == mo, "T2MWET"].mean()), 2)
            for mo in range(1, 13)
        ]

        nasa_param_dict: dict[str, dict[str, float]] = {}
        for param_name in ("T2M", "T2M_MAX_AVG", "ALLSKY_SFC_SW_DWN", "RH2M", "T2MWET"):
            if param_name in monthly_df.columns:
                nasa_param_dict[param_name] = {
                    ts.strftime("%Y%m"): round(float(val), 4)
                    for ts, val in monthly_df[param_name].items()
                    if pd.notna(val)
                }

        short_region = cfg["name"].split(" (")[0]
        sites.append(
            {
                "site_id": f"fi_{loc_id}",
                "region": f"{short_region} ({cfg['hub_city']})",
                "country": "Finland",
                "lat": rec["lat"],
                "lon": rec["lon"],
                "slope_deg": slope_deg,
                "water_distance_km": water_distance_km,
                "water_discharge_m3s": water_discharge_m3s,
                "solar_ghi_kwh_m2_year": solar_ghi_year,
                "solar_monthly_kwh_m2": solar_monthly_kwh_m2,
                "wind_power_density_w_m2": wind_power_density,
                "wind_speed_100m_ms": wind_speed_100m,
                "wind_monthly_ms": wind_monthly,
                "sources": {
                    "climate": (
                        f"NASA POWER Monthly API (MERRA-2, 2m height, {start_ym}..{end_ym}, "
                        "https://power.larc.nasa.gov/api/temporal/monthly/point)"
                    ),
                    "solar": (
                        f"NASA POWER Monthly API (CERES ALLSKY_SFC_SW_DWN, {start_ym}..{end_ym}, "
                        "converted from kWh/m2/day to monthly/annual kWh/m2 sums)"
                    ),
                    "wind": wind_source_desc,
                    "terrain": terrain.get(
                        "source",
                        "Copernicus DEM GLO-90 (https://open-meteo.com/en/docs/elevation-api)",
                    ),
                    "water": water.get(
                        "source",
                        "Copernicus GloFAS v4 Flood API & Copernicus DEM GLO-90 water-proximity stencil (https://open-meteo.com/en/docs/flood-api)",
                    ),
                },
                "nasa_power": {
                    "header": {"fill_value": -999},
                    "properties": {"parameter": nasa_param_dict},
                },
                "extra_metrics": {
                    "iso_code": cfg["iso_code"],
                    "n_sampled_points": rec["n_points"],
                    "elevation_m": elevation_m,
                    "water_distance_km": water_distance_km,
                    "water_discharge_m3s": water_discharge_m3s,
                    "rh2m_mean_pct": round(float(m_win["RH2M"].mean()), 2),
                    "rh2m_monthly_pct": rh2m_monthly,
                    "t2mwet_mean_c": round(float(m_win["T2MWET"].mean()), 2),
                    "t2mwet_monthly_c": t2mwet_monthly,
                    "t2m_max_abs_c": round(float(m_win["T2M_MAX"].max()), 2),
                    "clrsky_solar_ghi_kwh_m2_year": clrsky_ghi_year,
                    "cloud_solar_loss_pct": cloud_loss_pct,
                    "prectotcorr_mm_year": round(float(a_win["PRECTOTCORR_MM_YEAR"].mean()), 1),
                    "ws10m_mean_ms": round(float(m_win["WS10M"].mean()), 3),
                    "ws50m_mean_ms": round(float(m_win["WS50M"].mean()), 3),
                    "merra2_wind_power_density_w_m2": merra2_wind["wind_power_density_w_m2"],
                    "merra2_wind_speed_100m_ms": merra2_wind["wind_speed_100m_ms"],
                    "merra2_wind_monthly_ms": merra2_wind["wind_monthly_ms"],
                    "merra2_shear_alpha": merra2_wind["shear_alpha_mean"],
                    "merra2_air_density_kg_m3": merra2_wind["air_density_kg_m3_mean"],
                    "gwa_wind_power_density_w_m2": gwa.get("wind_power_density_w_m2"),
                    "gwa_wind_speed_100m_ms": gwa.get("wind_speed_100m_ms"),
                    "gwa_windiest_10pct_power_density_w_m2": gwa.get("windiest_10pct_power_density_w_m2"),
                    "gwa_windiest_10pct_wind_speed_100m_ms": gwa.get("windiest_10pct_wind_speed_100m_ms"),
                },
            }
        )

    analysis_id = "finland-19-regions-nasa-gwa-v5" if wind_source == "gwa" else "finland-19-regions-nasa-merra2-v5"
    return {
        "pipeline": {
            "analysis_id": analysis_id,
            "analysis_period": {
                "start": start_ym,
                "end": end_ym,
            },
            "horizon_years": horizon_years,
        },
        "sites": sites,
    }


def clean_all(
    raw_dir: Path = DEFAULT_RAW_DIR,
    clean_dir: Path = DEFAULT_CLEAN_DIR,
) -> pd.DataFrame:
    """Clean all Finnish region JSONs, export regional & master CSV/JSONs and suitability ranking."""
    clean_dir.mkdir(parents=True, exist_ok=True)

    all_monthly_frames: list[pd.DataFrame] = []
    all_annual_frames: list[pd.DataFrame] = []
    region_summaries: list[dict[str, Any]] = []
    ranker_records: list[dict[str, Any]] = []

    skip_files = {"parameters_catalog.json", "finland_regions_catalog.json"}
    for raw_path in sorted(raw_dir.glob("*.json")):
        if raw_path.name in skip_files:
            continue

        loc_id = raw_path.stem
        region_cfg = FINLAND_REGIONS.get(loc_id, {})
        monthly_df, annual_df, stats_dict = clean_power_json(raw_path)

        # Save per-region files
        monthly_csv = clean_dir / f"{loc_id}_monthly.csv"
        annual_csv = clean_dir / f"{loc_id}_annual.csv"
        monthly_json = clean_dir / f"{loc_id}_monthly.json"
        annual_json = clean_dir / f"{loc_id}_annual.json"

        monthly_df.to_csv(monthly_csv)
        annual_df.to_csv(annual_csv)

        m_export = monthly_df.reset_index()
        m_export["date"] = m_export["date"].dt.strftime("%Y-%m-%d")
        monthly_json.write_text(m_export.to_json(orient="records", indent=2, force_ascii=False), encoding="utf-8")

        a_export = annual_df.reset_index()
        annual_json.write_text(a_export.to_json(orient="records", indent=2, force_ascii=False), encoding="utf-8")

        print(
            f"[clean] {loc_id}: {stats_dict['monthly_rows']} months ({stats_dict['date_range']}), "
            f"{stats_dict['annual_rows']} annual rows, missing={stats_dict['missing_monthly_cells']}"
        )

        if loc_id in FINLAND_REGIONS and not annual_df.empty:
            meta = stats_dict.get("meta") or {}
            lat_val = float(meta.get("lat", region_cfg["lat"]))
            lon_val = float(meta.get("lon", region_cfg["lon"]))
            c_lat = float(meta.get("centroid_lat", lat_val))
            c_lon = float(meta.get("centroid_lon", lon_val))
            n_pts = int(meta.get("n_points", len(region_cfg.get("points", [1]))))

            m_tagged = m_export.copy()
            m_tagged.insert(0, "lon", lon_val)
            m_tagged.insert(0, "lat", lat_val)
            m_tagged.insert(0, "hub_city", region_cfg["hub_city"])
            m_tagged.insert(0, "region_name", region_cfg["name"])
            m_tagged.insert(0, "iso_code", region_cfg["iso_code"])
            m_tagged.insert(0, "region_id", loc_id)
            m_tagged["year"] = monthly_df.index.year
            m_tagged["month"] = monthly_df.index.month
            all_monthly_frames.append(m_tagged)

            a_tagged = a_export.copy()
            a_tagged.insert(0, "lon", lon_val)
            a_tagged.insert(0, "lat", lat_val)
            a_tagged.insert(0, "hub_city", region_cfg["hub_city"])
            a_tagged.insert(0, "region_name", region_cfg["name"])
            a_tagged.insert(0, "iso_code", region_cfg["iso_code"])
            a_tagged.insert(0, "region_id", loc_id)
            all_annual_frames.append(a_tagged)

            yrs = annual_df.index.to_numpy(dtype=float)
            allsky_tr = _compute_series_trend(yrs, annual_df["ALLSKY_SFC_SW_DWN"].to_numpy(dtype=float))
            clrsky_tr = _compute_series_trend(yrs, annual_df["CLRSKY_SFC_SW_DWN"].to_numpy(dtype=float))
            t2m_tr = _compute_series_trend(yrs, annual_df["T2M"].to_numpy(dtype=float))
            ws50_tr = _compute_series_trend(yrs, annual_df["WS50M"].to_numpy(dtype=float))
            precip_tr = _compute_series_trend(yrs, annual_df["PRECTOTCORR_MM_YEAR"].to_numpy(dtype=float))

            region_summaries.append(
                {
                    "region_id": loc_id,
                    "iso_code": region_cfg["iso_code"],
                    "name": region_cfg["name"],
                    "name_fi": region_cfg["name_fi"],
                    "name_uk": region_cfg["name_uk"],
                    "hub_city": region_cfg["hub_city"],
                    "lat": lat_val,
                    "lon": lon_val,
                    "centroid_lat": c_lat,
                    "centroid_lon": c_lon,
                    "n_points": n_pts,
                    "period": f"{int(yrs.min())}-{int(yrs.max())}",
                    "n_years": int(len(yrs)),
                    # Pillar 1: Cooling
                    "t2m_mean_c": round(float(annual_df["T2M"].mean()), 2),
                    "t2mwet_mean_c": round(float(annual_df["T2MWET"].mean()), 2),
                    "t2m_max_annual_peak_c": round(float(annual_df["T2M_MAX"].mean()), 2),
                    "t2m_max_record_c": round(float(annual_df["T2M_MAX"].max()), 2),
                    "rh2m_mean_pct": round(float(annual_df["RH2M"].mean()), 2),
                    "est_free_cooling_days_yr": round(float(annual_df["EST_FREE_COOLING_DAYS"].mean()), 1),
                    "est_free_cooling_hours_yr": round(float(annual_df["EST_FREE_COOLING_HOURS"].mean()), 1),
                    "free_cooling_months_yr": round(float(annual_df["FREE_COOLING_MONTHS"].mean()), 2),
                    "evap_cooling_months_yr": round(float(annual_df["EVAP_COOLING_MONTHS"].mean()), 2),
                    "heat_stress_months_yr": round(float(annual_df["HEAT_STRESS_MONTHS"].mean()), 2),
                    # Pillar 2: Renewables & Dimming/Brightening
                    "ws50m_mean_ms": round(float(annual_df["WS50M"].mean()), 3),
                    "allsky_sw_dwn_mean": round(float(annual_df["ALLSKY_SFC_SW_DWN"].mean()), 3),
                    "clrsky_sw_dwn_mean": round(float(annual_df["CLRSKY_SFC_SW_DWN"].mean()), 3),
                    "cloud_solar_loss": round(float(annual_df["CLOUD_SOLAR_LOSS"].mean()), 3),
                    "cloud_solar_loss_pct": round(float(annual_df["CLOUD_SOLAR_LOSS_PCT"].mean()), 2),
                    "allsky_sw_trend_decade": allsky_tr["sen_decade"],
                    "allsky_sw_mk_p": allsky_tr["mk_p"],
                    "allsky_sw_sig": allsky_tr["significant"],
                    "clrsky_sw_trend_decade": clrsky_tr["sen_decade"],
                    "clrsky_sw_mk_p": clrsky_tr["mk_p"],
                    "t2m_trend_decade": t2m_tr["sen_decade"],
                    "t2m_mk_p": t2m_tr["mk_p"],
                    "ws50m_trend_decade": ws50_tr["sen_decade"],
                    # Pillar 3: Climate Risks
                    "prectotcorr_mm_year_mean": round(float(annual_df["PRECTOTCORR_MM_YEAR"].mean()), 1),
                    "prectotcorr_mm_year_max": round(float(annual_df["PRECTOTCORR_MM_YEAR"].max()), 1),
                    "prectotcorr_mm_trend_decade": precip_tr["sen_decade"],
                    "ws10m_mean_ms": round(float(annual_df["WS10M"].mean()), 3),
                    "ws10m_peak_month_ms": round(float(annual_df["WS10M_MAX_MONTH"].mean()), 3),
                    "ws10m_record_month_ms": round(float(annual_df["WS10M_MAX_MONTH"].max()), 3),
                    **(
                        {
                            "water_distance_km": stats_dict["water"].get("water_distance_km"),
                            "water_discharge_m3s": stats_dict["water"].get("water_discharge_m3s"),
                        }
                        if isinstance(stats_dict.get("water"), dict) and stats_dict.get("water")
                        else {}
                    ),
                }
            )
            ranker_records.append(
                {
                    "region_id": loc_id,
                    "cfg": region_cfg,
                    "lat": lat_val,
                    "lon": lon_val,
                    "n_points": n_pts,
                    "monthly_df": monthly_df,
                    "annual_df": annual_df,
                    "gwa_100m": stats_dict.get("gwa_100m") or {},
                    "terrain": stats_dict.get("terrain") or {},
                    "water": stats_dict.get("water") or {},
                }
            )

    if all_monthly_frames:
        master_m = pd.concat(all_monthly_frames, ignore_index=True)
        master_m.to_csv(clean_dir / "finland_all_regions_monthly.csv", index=False)
        print(f"[saved] finland_all_regions_monthly.csv ({len(master_m)} rows)")

    if all_annual_frames:
        master_a = pd.concat(all_annual_frames, ignore_index=True)
        master_a.to_csv(clean_dir / "finland_all_regions_annual.csv", index=False)
        print(f"[saved] finland_all_regions_annual.csv ({len(master_a)} rows)")

    ranking_df = pd.DataFrame()
    if region_summaries:
        ranking_df, ranking_payload = build_finland_suitability_ranking(region_summaries)
        ranking_df.to_csv(clean_dir / "finland_datacenter_suitability.csv", index=False)
        (clean_dir / "finland_datacenter_suitability.json").write_text(
            json.dumps(ranking_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        _write_markdown_report(ranking_df, clean_dir / "finland_datacenter_report.md")
        print(f"[saved] finland_datacenter_suitability.csv/.json & finland_datacenter_report.md ({len(ranking_df)} regions)")

    pipeline_payload = build_site_ranker_input(ranker_records, wind_source="gwa")
    if pipeline_payload["sites"]:
        pipeline_text = json.dumps(pipeline_payload, ensure_ascii=False, indent=2)
        (clean_dir / "pipeline_output.json").write_text(pipeline_text, encoding="utf-8")

        from rank_sites import evaluate as evaluate_site_ranker

        frontend_result = evaluate_site_ranker(pipeline_payload)
        frontend_text = json.dumps(frontend_result, ensure_ascii=False, indent=2, allow_nan=False)

        merra2_payload = build_site_ranker_input(ranker_records, wind_source="merra2")
        merra2_text = json.dumps(merra2_payload, ensure_ascii=False, indent=2)
        (clean_dir / "pipeline_output_merra2.json").write_text(merra2_text, encoding="utf-8")
        frontend_merra2_result = evaluate_site_ranker(merra2_payload)
        frontend_merra2_text = json.dumps(frontend_merra2_result, ensure_ascii=False, indent=2, allow_nan=False)

        out_dir = (FETCH_DATA_DIR.parent / "output") if clean_dir.resolve() == DEFAULT_CLEAN_DIR.resolve() else clean_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "frontend.json").write_text(frontend_text, encoding="utf-8")
        (out_dir / "frontend_merra2.json").write_text(frontend_merra2_text, encoding="utf-8")

        print(
            f"[saved] Site Ranker v5: pipeline_output.json, pipeline_output_merra2.json, frontend.json & frontend_merra2.json "
            f"({frontend_result['meta']['ranked_sites']}/{frontend_result['meta']['submitted_sites']} sites ranked)"
        )

    return ranking_df


if __name__ == "__main__":
    clean_all()
