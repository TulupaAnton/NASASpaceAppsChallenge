#!/usr/bin/env python3
"""Universal monthly climate + renewable-resource candidate-site screener.

The upstream pipeline owns locations, observed historical interval and input data.
No HTTP requests. JSON in -> JSON out. Not a construction feasibility model.
"""
from __future__ import annotations

import argparse
import calendar
import copy
import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm


@dataclass(frozen=True)
class Config:
    # Hypothetical weights for resource screening, NOT validated cost coefficients.
    climate_weight: float = 0.30
    climate_weight_with_water: float = 0.25
    water_weight: float = 0.15
    solar_weight_within_renewables: float = 0.40
    cooling_weight_within_climate: float = 0.75
    water_distance_weight_within_water: float = 0.70
    cooling_base_c: float = 10.0  # deliberately labeled proxy only
    min_months: int = 36
    hac_lags: int = 12
    min_spread_cooling: float = 15.0
    min_spread_hot: float = 0.5
    min_spread_solar: float = 35.0
    min_spread_wind_speed: float = 0.25
    min_spread_wind_density: float = 20.0
    min_spread_water_distance: float = 0.5
    min_spread_water_discharge: float = 1.0

    def validate(self):
        for name in (
            'climate_weight',
            'climate_weight_with_water',
            'water_weight',
            'solar_weight_within_renewables',
            'cooling_weight_within_climate',
            'water_distance_weight_within_water',
        ):
            value = getattr(self, name)
            if not 0 <= value <= 1:
                raise ValueError(f'{name} must be between 0 and 1')
        if self.climate_weight_with_water + self.water_weight > 1:
            raise ValueError('climate_weight_with_water + water_weight must be <= 1')
        if self.min_months < 24 or self.hac_lags < 0:
            raise ValueError('min_months must be >=24, hac_lags must be >=0')


PHYSICAL_REFERENCE_BOUNDS: dict[str, tuple[float, float]] = {
    'cooling': (150.0, 2500.0),         # Cooling degree-days DD10/yr (lower is better: <=150 -> 100, >=2500 -> 0)
    'summer_heat': (16.0, 35.0),        # Warmest-month avg daily high °C (lower is better: <=16 -> 100, >=35 -> 0)
    'solar': (700.0, 1800.0),           # Annual GHI kWh/m2/yr (higher is better: <=700 -> 0, >=1800 -> 100)
    'wind_density': (100.0, 600.0),     # 100m wind power density W/m2 (higher is better: <=100 -> 0, >=600 -> 100)
    'wind_speed': (4.0, 9.5),           # 100m wind speed m/s (higher is better: <=4.0 -> 0, >=9.5 -> 100)
    'water_distance': (0.5, 15.0),      # Distance to nearest water body km (lower is better: <=0.5 -> 100, >=15 -> 0)
    'water_discharge': (0.5, 50.0),     # Local river/stream discharge m3/s (higher is better: <=0.5 -> 0, >=50 -> 100)
}


def number(value: Any, label: str, low: float | None = None, high: float | None = None) -> float:
    if isinstance(value, bool):
        raise ValueError(f'{label}: boolean is not a measurement')
    try:
        v = float(value)
    except (ValueError, TypeError):
        raise ValueError(f'{label}: expected a numeric value') from None
    if not math.isfinite(v) or (low is not None and v < low) or (high is not None and v > high):
        raise ValueError(f'{label}: invalid value {value!r}')
    return v


def optional_number(raw, key, label, low=None, high=None):
    return None if key not in raw or raw[key] is None else number(raw[key], label, low, high)


@lru_cache(maxsize=4096)
def _parse_month_str(value: str) -> pd.Timestamp:
    dt = pd.to_datetime(value, format='%Y-%m', exact=True, errors='raise')
    if dt.strftime('%Y-%m') != value:
        raise ValueError(f'invalid canonical month {value!r}')
    return dt


def parse_month(value: Any, label: str) -> pd.Timestamp:
    if not isinstance(value, str) or len(value) != 7 or value[4] != '-':
        raise ValueError(f'{label}: expected YYYY-MM')
    try:
        return _parse_month_str(value)
    except (ValueError, TypeError):
        raise ValueError(f'{label}: invalid month {value!r}') from None


def next_month(ts: pd.Timestamp) -> pd.Timestamp:
    return ts + pd.DateOffset(months=1)


def months_between(start: pd.Timestamp, end: pd.Timestamp) -> list[str]:
    if start > end:
        raise ValueError('pipeline.analysis_period.start must be <= end')
    return [t.strftime('%Y-%m') for t in pd.date_range(start, end, freq='MS')]


def raw_nasa_monthly(data, sid):
    """NASA POWER /temporal/monthly/point fields with YYYYMM keys; -999 is missing."""
    if not isinstance(data, dict):
        raise ValueError(f'{sid}: nasa_power should contain NASA JSON object')
    parameters = data.get('properties', {}).get('parameter', {})
    means = parameters.get('T2M')
    highs = parameters.get('T2M_MAX_AVG')
    if not isinstance(means, dict) or (highs is not None and not isinstance(highs, dict)):
        raise ValueError(f'{sid}: NASA monthly JSON must have properties.parameter.T2M')
    if any(isinstance(k, str) and len(k) == 8 and k.isdigit() for k in means):
        raise ValueError(f'{sid}: NASA DAILY JSON received, MONTHLY required')
    rows = []
    for key, val in sorted(means.items()):
        if not isinstance(key, str) or len(key) != 6 or not key.isdigit() or key[4:] == '13':
            continue
        date = f'{key[:4]}-{key[4:]}'
        parse_month(date, f'{sid}.NASA date')
        rows.append({'date': date, 't2m_c': val,
                     't2m_max_avg_c': highs.get(key) if highs is not None else None})
    if not rows:
        raise ValueError(f'{sid}: NASA monthly data empty')
    return rows


def optional_energy(raw, sid):
    out = {}
    for key, limits in {
        'solar_ghi_kwh_m2_year': (0, 10000),
        'wind_speed_100m_ms': (0, 50),
        'wind_power_density_w_m2': (0, 10000),
        'water_distance_km': (0, 1000),
        'water_discharge_m3s': (0, 500000),
        'hydro_flow_m3s': (0, 200000),
        'hydro_head_m': (0, 5000),
        'slope_deg': (0, 90),
    }.items():
        out[key] = optional_number(raw, key, f'{sid}.{key}', *limits)
    if (out['hydro_flow_m3s'] is None) != (out['hydro_head_m'] is None):
        raise ValueError(f'{sid}: hydro_flow_m3s and hydro_head_m must come together')
    out['hydro_illustrative_mw_85pct'] = (
        round(.00981 * .85 * out['hydro_flow_m3s'] * out['hydro_head_m'], 4)
        if out['hydro_flow_m3s'] is not None else None
    )
    for key in ('solar_monthly_kwh_m2', 'wind_monthly_ms'):
        v = raw.get(key)
        if v is not None:
            if not isinstance(v, list) or len(v) != 12:
                raise ValueError(f'{sid}.{key}: must have 12 January-December values')
            v = [number(a, f'{sid}.{key}[{i}]', 0) for i, a in enumerate(v)]
        out[key] = v
    if out['solar_monthly_kwh_m2'] is not None and out['solar_ghi_kwh_m2_year'] is not None:
        total = sum(out['solar_monthly_kwh_m2'])
        expected = out['solar_ghi_kwh_m2_year']
        if abs(total - expected) > max(35, expected * .08):
            raise ValueError(f'{sid}: annual solar GHI inconsistent with monthly GHI')
    if out['wind_monthly_ms'] is not None and out['wind_speed_100m_ms'] is not None:
        mean = sum(out['wind_monthly_ms']) / 12
        expected = out['wind_speed_100m_ms']
        if abs(mean - expected) > max(.75, expected * .15):
            raise ValueError(f'{sid}: annual wind speed inconsistent with monthly wind speed')
    return out


def load_sites(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('sites'), list) or not payload['sites']:
        raise ValueError('Expected JSON object with non-empty sites array')
    seen = set()
    sites = []
    for idx, raw in enumerate(payload['sites']):
        if not isinstance(raw, dict):
            raise ValueError(f'sites[{idx}] must be an object')
        sid = raw.get('site_id')
        if not isinstance(sid, str) or not sid.strip() or sid in seen:
            raise ValueError(f'sites[{idx}].site_id must be unique non-empty string')
        seen.add(sid)
        lat = number(raw.get('lat'), f'{sid}.lat', -90, 90)
        lon = number(raw.get('lon'), f'{sid}.lon', -180, 180)
        if ('nasa_power' in raw) == ('climate_monthly' in raw):
            raise ValueError(f'{sid}: provide exactly one of nasa_power or climate_monthly')
        if 'nasa_power' in raw:
            rows = raw_nasa_monthly(raw['nasa_power'], sid)
        else:
            rows = raw['climate_monthly']
        if not isinstance(rows, list) or not rows:
            raise ValueError(f'{sid}: climate_monthly must be a nonempty array')
        frame = pd.DataFrame(rows)
        if 'date' not in frame or 't2m_c' not in frame:
            raise ValueError(f'{sid}: climate_monthly requires date, t2m_c')
        dates = [parse_month(d, f'{sid}.date') for d in frame.date]
        if len(set(dates)) != len(dates):
            raise ValueError(f'{sid}: duplicated climate months')
        frame['date'] = dates
        for col in ['t2m_c', 't2m_max_avg_c']:
            if col not in frame:
                frame[col] = np.nan
            frame[col] = pd.to_numeric(frame[col], errors='coerce').replace([-999, -999.0], np.nan)
        # invalid values are reported, NOT silently clipped / fabricated
        valid = frame.t2m_c.between(-90, 65)
        frame.loc[~valid, 't2m_c'] = np.nan
        valid_high = frame.t2m_max_avg_c.between(-90, 70) & (frame.t2m_max_avg_c >= frame.t2m_c - .05)
        frame.loc[~valid_high, 't2m_max_avg_c'] = np.nan
        frame = frame.sort_values('date').reset_index(drop=True)
        sites.append({
            'site_id': sid, 'region': str(raw.get('region') or sid),
            'country': str(raw.get('country') or ''), 'lat': lat, 'lon': lon,
            'rows': frame, 'sources': raw.get('sources') if isinstance(raw.get('sources'), dict) else {},
            'energy': optional_energy(raw, sid),
            'extra_metrics': raw.get('extra_metrics') if isinstance(raw.get('extra_metrics'), dict) else {},
            'nonempty_temp_months': int(frame.t2m_c.notna().sum()),
        })
    return sites


def model_fit(df: pd.DataFrame, col: str, hac_lags: int):
    """OLS on original T with linear time and calendar-month fixed effects.

    Month effects remove seasonality without bias from incomplete first/last years.
    The HAC covariance approximates serially correlated monthly errors.
    """
    df = df[['date', col]].dropna().copy()
    if df.empty:
        raise ValueError('No temperature data for trend')
    time = df.date.dt.year.to_numpy(float) + (df.date.dt.month.to_numpy(float) - .5) / 12
    center = float(np.mean(time))
    months = df.date.dt.month.to_numpy(int)
    dummies = np.column_stack([(months == m).astype(float) for m in range(2, 13)])
    X = np.column_stack([np.ones(len(df)), time - center, dummies])
    if len(df) < 24 or np.linalg.matrix_rank(X) != 13:
        raise ValueError('Need observations in all 12 calendar months and at least two seasonal cycles')
    model = sm.OLS(df[col].to_numpy(float), X).fit(
        cov_type='HAC', cov_kwds={'maxlags': min(hac_lags, len(df) - 2)})
    slope = float(model.params[1])
    se = float(model.bse[1])
    p = float(model.pvalues[1]) if np.isfinite(model.pvalues[1]) else None
    ci = [slope - 1.95996398454 * se, slope + 1.95996398454 * se]
    month_means = {m: float(df.loc[df.date.dt.month == m, col].mean()) for m in range(1, 13)}

    def predict(date: pd.Timestamp):
        x = np.array([1., date.year + (date.month - .5) / 12 - center]
                     + [1. if date.month == m else 0. for m in range(2, 13)])
        return float(x @ model.params)

    return {'slope': slope, 'center_time': center, 'p': p, 'ci': ci,
            'pred': predict, 'monthly_norms': month_means,
            'fitted': np.asarray(model.fittedvalues, dtype=float)}


def backtest(monthly, cfg):
    n = len(monthly)
    train_n = int(n * .70)
    # Need enough observations for each month in train and 12+ later observations
    train = monthly.iloc[:train_n].copy()
    test = monthly.iloc[train_n:].copy()
    if len(train) < 48 or len(test) < 12 or train.date.dt.month.nunique() < 12:
        return {'status': 'insufficient_history'}
    try:
        fitted = model_fit(train, 't2m_c', cfg.hac_lags)
    except ValueError:
        return {'status': 'insufficient_history'}
    observed = test.t2m_c.to_numpy(float)
    predicted = np.array([fitted['pred'](d) for d in test.date])
    baseline = np.array([fitted['monthly_norms'][int(d.month)] for d in test.date])
    return {
        'status': 'evaluated',
        'train_period': [train.date.min().strftime('%Y-%m'), train.date.max().strftime('%Y-%m')],
        'test_period': [test.date.min().strftime('%Y-%m'), test.date.max().strftime('%Y-%m')],
        'monthly_mae_trend_c': round(float(np.mean(np.abs(observed-predicted))), 4),
        'monthly_mae_seasonal_baseline_c': round(float(np.mean(np.abs(observed-baseline))), 4),
        'trend_better_than_seasonal_baseline': bool(np.mean(abs(observed-predicted)) < np.mean(abs(observed-baseline))),
        'heldout_monthly': [
            {'date': dt.strftime('%Y-%m'), 'observed_c': round(float(a), 3),
             'model_c': round(float(b), 3), 'seasonal_baseline_c': round(float(c), 3)}
            for dt, a, b, c in zip(test.date, observed, predicted, baseline)],
    }


def month_days(date):
    return calendar.monthrange(date.year, date.month)[1]


def _simulate_site_uncached(df, horizon, cfg):
    fitted = model_fit(df, 't2m_c', cfg.hac_lags)
    has_max = bool(df.t2m_max_avg_c.notna().all())
    maxfit = model_fit(df, 't2m_max_avg_c', cfg.hac_lags) if has_max else None
    normals = fitted['monthly_norms']
    historical = []
    for _, r in df.iterrows():
        d = r.date
        observed = float(r.t2m_c)
        baseline = normals[d.month]
        historical.append({
            'date': d.strftime('%Y-%m'), 't2m_c': round(observed, 4),
            't2m_max_avg_c': round(float(r.t2m_max_avg_c), 4) if pd.notna(r.t2m_max_avg_c) else None,
            'seasonal_normal_c': round(baseline, 4),
            'anomaly_c': round(observed - baseline, 4),
            'seasonal_trend_c': round(fitted['pred'](d), 4),
            'deseasonalized_trend_c': round(fitted['pred'](d) - baseline, 4),
        })
    future = []
    last_month = df.date.max()
    for ix in range(horizon * 12):
        date = last_month + pd.DateOffset(months=ix + 1)
        mean = fitted['pred'](date)
        high = maxfit['pred'](date) if maxfit else None
        future.append({
            'date': date.strftime('%Y-%m'), 't2m_c': round(mean, 5),
            't2m_max_avg_c': round(high, 5) if high is not None else None,
            'seasonal_normal_c': round(normals[date.month], 5),
            'no_trend_baseline_c': round(normals[date.month], 5),
            'anomaly_c': round(mean - normals[date.month], 5),
        })
    future_dates = [last_month + pd.DateOffset(months=ix+1) for ix in range(horizon*12)]
    days = np.array([month_days(d) for d in future_dates])
    means = np.array([r['t2m_c'] for r in future])
    cooling = float(np.sum(np.maximum(means-cfg.cooling_base_c,0)*days)/horizon)
    blocks = [future[i:i+12] for i in range(0,len(future),12)]
    high = float(np.mean([max(r['t2m_max_avg_c'] for r in block) for block in blocks])) if maxfit else None
    annual_scenario = []
    for block in blocks:
        first = pd.Timestamp(block[0]['date'])
        bdates = [pd.Timestamp(r['date']) for r in block]
        bd = [month_days(d) for d in bdates]
        mean = sum(float(r['t2m_c'])*days for r,days in zip(block, bd))/sum(bd)
        cdd = sum(max(float(r['t2m_c'])-cfg.cooling_base_c,0)*days for r,days in zip(block,bd))
        annual_scenario.append({'start_month':first.strftime('%Y-%m'),'end_month':block[-1]['date'],
                                'mean_temp_c':round(mean,4),'cooling_pressure_dd10':round(cdd,3)})
    hist_n = len(df)
    hist_days = np.array([month_days(d) for d in df.date])
    hist_means = df.t2m_c.to_numpy(float)
    stats = {
        'historical_mean_temp_c':round(float(np.average(hist_means,weights=hist_days)),4),
        'scenario_mean_temp_c':round(float(np.average(means,weights=days)),4),
        'scenario_avg_cooling_pressure_dd10':round(cooling,4),
        'scenario_avg_warmest_month_maxavg_c':round(high,4) if high is not None else None,
        'scenario_last_month_temp_c':round(float(means[-1]),4),
    }
    p = fitted['p']
    trend = {
        'slope_c_per_decade':round(fitted['slope']*10,5),
        'slope_95ci_c_per_decade':[round(v*10,5) for v in fitted['ci']],
        'p_value':round(p,7) if p is not None else None,
        'significant_p05':bool(p is not None and p < .05),
        'n_months':hist_n,
        'method':'Seasonal fixed-effects OLS (calendar-month intercepts), HAC Newey-West SE',
        'hac_lags':min(cfg.hac_lags,hist_n-2),
        'warning':'Historical slope confidence interval is not a 10-year prediction interval.',
    }
    monthly_climatology = [
        {'month':m, 'mean_t2m_c':round(float(normals[m]),4),
         'mean_t2m_max_avg_c':round(float(maxfit['monthly_norms'][m]),4) if maxfit else None}
        for m in range(1,13)]
    return {'measurements':stats,'trend':trend,'validation':backtest(df,cfg),
            'charts':{'historical_monthly':historical,'scenario_monthly':future,
                      'scenario_year_blocks':annual_scenario,
                      'monthly_climatology':monthly_climatology}}


@lru_cache(maxsize=256)
def _simulate_site_cached(
    dates_tuple: tuple[pd.Timestamp, ...],
    t2m_tuple: tuple[float, ...],
    tmax_tuple: tuple[float | None, ...],
    horizon: int,
    cfg: Config,
) -> dict[str, Any]:
    df = pd.DataFrame({
        'date': list(dates_tuple),
        't2m_c': list(t2m_tuple),
        't2m_max_avg_c': [np.nan if v is None else v for v in tmax_tuple],
    })
    return _simulate_site_uncached(df, horizon, cfg)


def simulate_site(df, horizon, cfg):
    dates_tuple = tuple(df.date)
    t2m_tuple = tuple(round(float(v), 6) for v in df.t2m_c.to_numpy(float))
    tmax_tuple = tuple(None if pd.isna(v) else round(float(v), 6) for v in df.t2m_max_avg_c)
    return copy.deepcopy(_simulate_site_cached(dates_tuple, t2m_tuple, tmax_tuple, int(horizon), cfg))


def clear_caches() -> None:
    """Clear in-memory month parsing and site simulation LRU caches."""
    _parse_month_str.cache_clear()
    _simulate_site_cached.cache_clear()


def normalize(values, higher_is_better, spread, label, force_physical: bool = False):
    x = np.asarray(values, dtype=float)
    if not np.isfinite(x).all():
        raise ValueError(f'Nonfinite scoring data for {label}')
    if (force_physical or len(x) == 1) and label in PHYSICAL_REFERENCE_BOUNDS:
        lo, hi = PHYSICAL_REFERENCE_BOUNDS[label]
        result = np.clip((x - lo) / (hi - lo), 0, 1) * 100
        if not higher_is_better:
            result = 100 - result
        return [round(float(v), 3) for v in result], {
            'metric': label, 'status': 'physical_reference',
            'anchors': [round(float(lo), 5), round(float(hi), 5)],
            'range': [round(float(x.min()), 5), round(float(x.max()), 5)]}
    if len(x) == 1 or float(np.ptp(x)) < spread:
        return [50.] * len(x), {'metric':label,'status':'not_discriminating',
                                'range':[round(float(x.min()),5),round(float(x.max()),5)]}
    lo,hi = (np.quantile(x,[.10,.90]) if len(x)>=5 else [min(x),max(x)])
    if hi-lo < .25*spread:
        lo,hi = min(x), max(x)
    result = np.clip((x-lo)/(hi-lo),0,1)*100
    if not higher_is_better:
        result = 100-result
    return [round(float(v),3) for v in result], {
        'metric':label,'status':'discriminating',
        'anchors':[round(float(lo),5),round(float(hi),5)],
        'range':[round(float(x.min()),5),round(float(x.max()),5)]}


def explanation(row, rank, n, score_weights):
    strengths, weaknesses = [], []
    for k, positive, negative in [
        ('cooling','Lower estimated cooling-temperature pressure', 'Higher estimated cooling-temperature pressure'),
        ('summer_heat','Lower projected monthly average of daily highs','Higher projected monthly average of daily highs'),
        ('solar','Higher solar irradiation potential','Lower solar irradiation potential'),
        ('wind','Stronger wind resource','Weaker wind resource'),
        ('water','Strong surface water access & discharge capacity','Limited nearby surface water resource'),
    ]:
        if k not in row['scores'] or row['scores'][k] is None:
            continue
        v = row['scores'][k]
        if v>=70:strengths.append({'metric':k,'text':positive,'score':v})
        elif v<=30:weaknesses.append({'metric':k,'text':negative,'score':v})
    if row['trend']['significant_p05'] and row['trend']['slope_c_per_decade']>0:
        weaknesses.append({'metric':'warming','text':f'Historical warming +{row["trend"]["slope_c_per_decade"]:.2f} °C/decade'})
    return {'summary':f'Rank {rank} of {n} pipeline-provided eligible candidates',
            'strengths':strengths,'limitations':weaknesses,
            'methodology':'Relative comparison of available common indicators, not an engineering feasibility assessment',
            'effective_weights':score_weights,
            'mandatory_checks':['24/7 firm supply, storage or grid connection', 'land and permitting',
                                'flood and environmental constraints','cost and redundancy']}


def evaluate(payload: dict, config: Config|None=None):
    cfg = config or Config()
    cfg.validate()
    sites = load_sites(payload)
    meta = payload.get('pipeline') or {}
    if not isinstance(meta, dict):
        raise ValueError('pipeline must be an object')
    period = meta.get('analysis_period')
    if period is not None:
        if not isinstance(period, dict):
            raise ValueError('pipeline.analysis_period must contain start/end')
        start = parse_month(period.get('start'),'pipeline.analysis_period.start')
        end = parse_month(period.get('end'),'pipeline.analysis_period.end')
        requested = months_between(start, end)
        period_source = 'pipeline.explicit'
    else:
        # Inferred from overlapping observations; the pipeline still chooses the available data.
        sets = [set(s['rows'].date.dt.strftime('%Y-%m')) for s in sites]
        common = sorted(set.intersection(*sets))
        if not common:
            raise ValueError('No common monthly dates among pipeline sites')
        requested = months_between(pd.Timestamp(common[0]),pd.Timestamp(common[-1]))
        period_source = 'pipeline.data_overlap'
    horizon = meta.get('horizon_years',10)
    if isinstance(horizon,bool) or not isinstance(horizon,int) or not (1<=horizon<=30):
        raise ValueError('pipeline.horizon_years must be an integer 1-30')
    if len(requested)<cfg.min_months:
        raise ValueError(f'Pipeline selected {len(requested)} months; need at least {cfg.min_months} for this monthly trend model')
    accepted, excluded = [], []
    expected_dates = [pd.Timestamp(d) for d in requested]
    for site in sites:
        frame = site['rows'].set_index('date')
        selected = frame.reindex(expected_dates)
        missing = [d.strftime('%Y-%m') for d in expected_dates if pd.isna(selected.loc[d,'t2m_c'])]
        if missing:
            excluded.append({'site_id':site['site_id'], 'reason':'missing/invalid T2M months in pipeline period',
                             'missing_months_count':len(missing),'examples':missing[:6]})
            continue
        selected = selected.reset_index().rename(columns={'index':'date'})
        selected['date'] = expected_dates
        if len(selected)<cfg.min_months:
            excluded.append({'site_id':site['site_id'], 'reason':'insufficient complete monthly temperature history'})
            continue
        accepted.append((site,selected))
    if not accepted:
        raise ValueError('No eligible sites with complete T2M coverage for pipeline period; '+str(excluded))
    # Every eligible candidate is compared over EXACTLY the requested months.
    ranking, charts = [], {}
    warnings=[]
    for site, df in accepted:
        model = simulate_site(df,horizon,cfg)
        entry = {
            'site_id':site['site_id'],'region':site['region'],'country':site['country'],
            'lat':site['lat'],'lon':site['lon'],'sources':site['sources'],
            'extra_metrics':site['extra_metrics'],
            'measurements':{**model['measurements'],**{k:v for k,v in site['energy'].items()
                                     if k not in ('solar_monthly_kwh_m2','wind_monthly_ms')}},
            'trend':model['trend'],'validation':model['validation'],
            'data_quality':{'monthly_points':len(df),'complete_required_months':len(requested),
                            'observed_maxavg_months':int(df.t2m_max_avg_c.notna().sum()),
                            'period':[requested[0],requested[-1]]},
        }
        monthly= model['charts']['monthly_climatology']
        for m in monthly:
            i=m['month']-1
            m['solar_kwh_m2']=site['energy']['solar_monthly_kwh_m2'][i] if site['energy']['solar_monthly_kwh_m2'] else None
            m['wind_speed_100m_ms']=site['energy']['wind_monthly_ms'][i] if site['energy']['wind_monthly_ms'] else None
        ranking.append(entry)
        charts[site['site_id']]=model['charts']
    n = len(ranking)
    keys={
        'cooling':('scenario_avg_cooling_pressure_dd10',False,cfg.min_spread_cooling),
        'summer_heat':('scenario_avg_warmest_month_maxavg_c',False,cfg.min_spread_hot),
        'solar':('solar_ghi_kwh_m2_year',True,cfg.min_spread_solar),
        'wind_density':('wind_power_density_w_m2',True,cfg.min_spread_wind_density),
        'wind_speed':('wind_speed_100m_ms',True,cfg.min_spread_wind_speed),
        'water_distance':('water_distance_km',False,cfg.min_spread_water_distance),
        'water_discharge':('water_discharge_m3s',True,cfg.min_spread_water_discharge),
    }
    # Only metrics measured for ALL accepted sites enter the ranking.
    active=['cooling']
    if all(s['measurements']['scenario_avg_warmest_month_maxavg_c'] is not None for s in ranking):
        active.append('summer_heat')
    if all(s['measurements']['solar_ghi_kwh_m2_year'] is not None for s in ranking):
        active.append('solar')
    if all(s['measurements']['wind_power_density_w_m2'] is not None for s in ranking):
        active.append('wind_density')
    elif all(s['measurements']['wind_speed_100m_ms'] is not None for s in ranking):
        active.append('wind_speed')
    if all(s['measurements']['water_distance_km'] is not None for s in ranking):
        active.append('water_distance')
    if all(s['measurements']['water_discharge_m3s'] is not None for s in ranking):
        active.append('water_discharge')
    if not any(k in active for k in ('solar','wind_density','wind_speed')):
        warnings.append('No common solar/wind data: climate-only score, NOT a renewable-resource siting decision')
    skipped=[]
    for k in ['summer_heat','solar','wind_density','wind_speed','water_distance','water_discharge']:
        if k not in active:
            skipped.append(k)
    scoring_mode = str(meta.get('scoring_mode') or ('physical' if n == 1 else 'cohort')).lower()
    force_physical = scoring_mode in ('physical', 'absolute') or n == 1
    normalizations={}
    for name in active:
        key,prefer,spread=keys[name]
        vals,details=normalize([s['measurements'][key] for s in ranking],prefer,spread,name,force_physical=force_physical)
        normalizations[name]=details
        dest='wind' if name.startswith('wind_') else name
        for site,score in zip(ranking,vals):
            site.setdefault('scores',{})[dest]=score
    has_energy= 'solar' in active or 'wind_density' in active or 'wind_speed' in active
    wind_active='wind_density' in active or 'wind_speed' in active
    has_water='water_distance' in active or 'water_discharge' in active
    for s in ranking:
        score=s['scores']
        cw=cfg.cooling_weight_within_climate if 'summer_heat' in active else 1.0
        score['climate']=round(cw*score['cooling']+(1-cw)*score.get('summer_heat',0),3)
        if has_energy:
            sw = cfg.solar_weight_within_renewables if 'solar' in active and wind_active else (1.0 if 'solar' in active else 0.0)
            score['renewables']=round(sw*score.get('solar',0)+(1-sw)*score.get('wind',0),3)
        else:
            sw=None
            score['renewables']=None
        if has_water:
            if 'water_distance' in active and 'water_discharge' in active:
                ww=cfg.water_distance_weight_within_water
                score['water']=round(ww*score['water_distance']+(1-ww)*score['water_discharge'],3)
            elif 'water_distance' in active:
                ww=1.0
                score['water']=round(score['water_distance'],3)
            else:
                ww=0.0
                score['water']=round(score['water_discharge'],3)
        else:
            ww=None
            score['water']=None
        if has_energy and has_water:
            effective_climate_weight=cfg.climate_weight_with_water
            effective_water_weight=cfg.water_weight
            effective_renewables_weight=round(1.0-effective_climate_weight-effective_water_weight,6)
        elif has_energy:
            effective_climate_weight=cfg.climate_weight
            effective_renewables_weight=round(1.0-effective_climate_weight,6)
            effective_water_weight=0.0
        elif has_water:
            effective_climate_weight=round(1.0-cfg.water_weight,6)
            effective_renewables_weight=0.0
            effective_water_weight=cfg.water_weight
        else:
            effective_climate_weight=1.0
            effective_renewables_weight=0.0
            effective_water_weight=0.0
        score['overall']=round(
            effective_climate_weight*score['climate']
            +effective_renewables_weight*(score['renewables'] or 0)
            +effective_water_weight*(score['water'] or 0),
            3,
        )
    ranking.sort(key=lambda s:(-s['scores']['overall'],s['site_id']))
    sensitivity={s['site_id']:[] for s in ranking}
    total=0
    # Rerank with altered priorities only if both energy and climate measured.
    for climate_weight in ([i/100 for i in range(10,71,10)] if has_energy else [effective_climate_weight]):
        for solar_weight in ([i/100 for i in range(20,81,15)] if 'solar' in active and wind_active else [sw]):
            total+=1
            def rank_score(s):
                wat_term=effective_water_weight*(s['scores']['water'] or 0)
                if not has_energy:
                    return (1.0-effective_water_weight)*s['scores']['climate']+wat_term
                w_ren=1.0-climate_weight-effective_water_weight
                energy = (solar_weight*s['scores']['solar']+(1-solar_weight)*s['scores']['wind']) if ('solar' in active and wind_active) else s['scores']['renewables']
                return climate_weight*s['scores']['climate']+w_ren*energy+wat_term
            order=sorted(ranking,key=lambda s:(-rank_score(s),s['site_id']))
            for pos,s in enumerate(order,1):
                sensitivity[s['site_id']].append(pos)
    weights_dict={
        'climate':effective_climate_weight,
        'renewables':effective_renewables_weight,
        'solar_within_renewables':sw,
        'cooling_within_climate':cw,
    }
    if has_water:
        weights_dict['water']=effective_water_weight
        weights_dict['water_distance_within_water']=ww
    for rank,s in enumerate(ranking,1):
        ranks=sensitivity[s['site_id']]
        s['rank']=rank
        s['sensitivity']={'best_rank':min(ranks),'worst_rank':max(ranks),
                          'fraction_ranked_first':round(ranks.count(1)/total,3),
                          'weight_combinations':total}
        s['insight']=explanation(s,rank,n,weights_dict)
    for name,desc in normalizations.items():
        if desc['status']=='not_discriminating':
            warnings.append(f'{name}: all candidates receive neutral 50 (little relative variation)')
    if 1<n<5 and not force_physical:
        warnings.append('Fewer than 5 eligible sites: cohort-relative scores are especially unstable')
    if n==1:
        warnings.append('Single-site mode: scores normalized against fixed physical engineering reference bounds')
    if len(requested)<96:
        warnings.append('Less than 8 years of monthly history: trend and 10-year extrapolation highly uncertain')
    if any(not s['sources'] for s in ranking):
        warnings.append('Some sites lack explicit source provenance')
    if any(s['validation']['status']=='insufficient_history' for s in ranking):
        warnings.append('Some candidate trends have insufficient history for held-out backtesting')
    if 'summer_heat' not in active:
        warnings.append('T2M_MAX_AVG missing at some sites: extreme-heat proxy excluded for fair ranking')
    if any(s['measurements']['hydro_illustrative_mw_85pct'] is not None for s in ranking):
        warnings.append('Illustrative hydropower MW shown but NOT scored: ecological/engineering feasibility unknown')
    if n>=2 and ranking[0]['scores']['overall']-ranking[1]['scores']['overall']<3:
        warnings.append('Top two candidates differ by <3 index points: winner not decisive')
    if any(s['validation']['status']=='evaluated' and
           not s['validation']['trend_better_than_seasonal_baseline'] for s in ranking):
        warnings.append('Historical-trend model underperforms no-trend seasonal baseline on some holdouts')
    if not any(k in active for k in ('solar','wind_density','wind_speed')):
        warnings.append('Availability of electricity, storage, CAPEX and 24/7 output are not measured')
    warnings.append('No grid/redundancy/storage/permits/parcel-level hazards assessed: do not claim suitable to build')
    warnings.append('Solar and wind annual resource indicators do not guarantee 24/7 data-center power')
    return {
        'meta':{'schema_version':'5.0','scope':'Pipeline-provided sites, any country',
                'pipeline_analysis_id':meta.get('analysis_id'),
                'historical_period':[requested[0],requested[-1]],
                'historical_period_source':period_source,
                'historical_months':len(requested),
                'scenario_period':[charts[ranking[0]['site_id']]['scenario_monthly'][0]['date'],
                                   charts[ranking[0]['site_id']]['scenario_monthly'][-1]['date']],
                'horizon_years':horizon,
                'submitted_sites':len(sites),'ranked_sites':n,'excluded_sites':len(excluded),
                'active_metrics':active,'skipped_metrics':skipped,
                'score_type':('Physical reference benchmark screening score, not buildability/ROI probability'
                              if force_physical else 'Cohort-relative resource + climate screening score, not buildability/ROI probability'),
                'weights':weights_dict,
                'calibration_status':'Heuristic weights; no observed CAPEX/PUE/electric reliability labels',
                'assumptions':['Monthly temperature means only, not free-cooling hours or electrical kWh',
                               'HAC uncertainty is for historical trend slope only',
                               'Future values are an illustrative linear scenario, NOT climate-model projections',
                               'Unreported metrics are excluded cohort-wide for fair comparison',
                               'Index changes when candidate set or source measurements change']},
        'ranking':ranking,'charts':charts,
        'diagnostics':{'metric_normalization':normalizations,'warnings':warnings,
                       'period_months_required':len(requested),'dropped_metrics':skipped},
        'excluded':excluded,
    }


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True,help='Pipeline-generated JSON input')
    parser.add_argument('--out',type=Path,default=Path('output'),help='Results directory')
    args=parser.parse_args()
    try:
        payload=json.loads(args.input.read_text(encoding='utf-8-sig'))
        result=evaluate(payload)
        args.out.mkdir(parents=True,exist_ok=True)
        target=args.out/'frontend.json'
        target.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
        print(f'Analyzed {result["meta"]["ranked_sites"]}/{result["meta"]["submitted_sites"]} sites')
        print('Pipeline period:',result['meta']['historical_period'])
        for row in result['ranking']:
            print(f'{row["rank"]}. {row["region"]}: {row["scores"]["overall"]:.2f}/100')
        print('JSON saved:',target.resolve())
        for warning in result['diagnostics']['warnings']:
            print('WARNING:',warning)
    except (OSError,ValueError,TypeError,json.JSONDecodeError) as exc:
        parser.error(str(exc))


if __name__=='__main__':
    main()
