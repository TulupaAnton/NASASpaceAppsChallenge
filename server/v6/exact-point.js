// Point analysis engine from the supplied v6 archive.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const MAX_CACHE_ENTRIES = 200;
const FETCH_TIMEOUT_MS = 18_000;
const WEIGHTS = {
    climate: 0.25,
    climate_no_water: 0.30,
    renewables: 0.60,
    water: 0.15,
    cooling_within_climate: 0.75,
    solar_within_renewables: 0.40,
    water_distance_within_water: 0.70
};
const PHYSICAL_REFERENCE_BOUNDS = {
    cooling: {
        low: 150,
        high: 2500,
        higherIsBetter: false
    },
    summer_heat: {
        low: 16,
        high: 35,
        higherIsBetter: false
    },
    solar: {
        low: 700,
        high: 1800,
        higherIsBetter: true
    },
    wind: {
        low: 100,
        high: 600,
        higherIsBetter: true
    },
    water_distance: {
        low: 0.5,
        high: 15.0,
        higherIsBetter: false
    },
    water_discharge: {
        low: 0.5,
        high: 50.0,
        higherIsBetter: true
    }
};
const pointCache = new Map();
const nasaCoarseCache = new Map();
let finlandWaterPromise = null;
function round(value, decimals = 4) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function haversineKm(lat1, lon1, lat2, lon2) {
    const r = 6371.0088;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}
function offsetPoint(lat, lon, distKm, bearingDeg) {
    const bRad = bearingDeg * Math.PI / 180;
    const dLat = distKm * Math.cos(bRad) / 111.32;
    const cosLat = Math.max(0.1, Math.cos(lat * Math.PI / 180));
    const dLon = distKm * Math.sin(bRad) / (111.32 * cosLat);
    return [
        lat + dLat,
        lon + dLon
    ];
}
function pruneMap(map, maxSize) {
    while(map.size >= maxSize){
        const firstKey = map.keys().next().value;
        if (firstKey === undefined) break;
        map.delete(firstKey);
    }
}
async function fetchJsonWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), timeoutMs);
    const externalSignal = init.signal;
    const onExternalAbort = ()=>controller.abort();
    if (externalSignal) {
        if (externalSignal.aborted) {
            clearTimeout(timer);
            throw new Error('Request aborted');
        }
        externalSignal.addEventListener('abort', onExternalAbort, {
            once: true
        });
    }
    try {
        const res = await fetch(url, {
            ...init,
            signal: controller.signal,
            cache: 'no-store'
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
        }
        return await res.json();
    } finally{
        clearTimeout(timer);
        if (externalSignal) {
            externalSignal.removeEventListener('abort', onExternalAbort);
        }
    }
}
export async function fetchNasaPowerMonthly(lat, lon, signal, startYear = 1984, endYear = 2024) {
    const paramsList = [
        'T2M',
        'T2M_MAX_AVG',
        'ALLSKY_SFC_SW_DWN',
        'CLRSKY_SFC_SW_DWN',
        'RH2M',
        'T2MWET',
        'PRECTOTCORR',
        'WS10M',
        'WS50M'
    ].join(',');
    const url = `https://power.larc.nasa.gov/api/temporal/monthly/point` + `?parameters=${paramsList}&community=RE` + `&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}` + `&start=${startYear}&end=${endYear}&format=JSON`;
    const raw = await fetchJsonWithTimeout(url, {
        signal
    });
    const parameter = raw.properties?.parameter;
    if (!parameter || !parameter.T2M) {
        throw new Error('NASA POWER Monthly API returned empty parameter payload.');
    }
    return { parameters: parameter, elevationM: raw.geometry?.coordinates?.[2] };
}
function extractGwaPercentile(areaMeans, targetPerc) {
    if (!Array.isArray(areaMeans) || areaMeans.length === 0) return undefined;
    const exact = areaMeans.find((m)=>m.sel_perc === targetPerc);
    if (exact && typeof exact.val === 'number' && Number.isFinite(exact.val)) {
        return exact.val;
    }
    const fallback = targetPerc >= 50 ? areaMeans[areaMeans.length - 1] : areaMeans[0];
    return typeof fallback?.val === 'number' && Number.isFinite(fallback.val) ? fallback.val : undefined;
}
async function queryGwaBox(lat, lon, boxDeg, signal) {
    const r5 = (v)=>Number(v.toFixed(5));
    const poly = [
        [
            [
                r5(lon - boxDeg),
                r5(lat - boxDeg)
            ],
            [
                r5(lon + boxDeg),
                r5(lat - boxDeg)
            ],
            [
                r5(lon + boxDeg),
                r5(lat + boxDeg)
            ],
            [
                r5(lon - boxDeg),
                r5(lat + boxDeg)
            ],
            [
                r5(lon - boxDeg),
                r5(lat - boxDeg)
            ]
        ]
    ];
    const headers = {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://globalwindatlas.info/en',
        Origin: 'https://globalwindatlas.info',
        'Content-Type': 'application/json',
        Accept: 'application/json'
    };
    const [pdData, wsData, tempData] = await Promise.all([
        fetchJsonWithTimeout('https://globalwindatlas.info/api/gwa/custom/powerDensity', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                height: 100,
                coord: poly
            }),
            signal
        }, 10_000),
        fetchJsonWithTimeout('https://globalwindatlas.info/api/gwa/custom/windSpeed', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                height: 100,
                coord: poly
            }),
            signal
        }, 10_000),
        fetchJsonWithTimeout('https://globalwindatlas.info/api/temporal/', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                coord: poly
            }),
            signal
        }, 10_000).catch(()=>({
                annual_ts: undefined
            }))
    ]);
    const pdMeans = pdData.area_means ?? [];
    const wsMeans = wsData.area_means ?? [];
    if (pdMeans.length === 0 || wsMeans.length === 0) {
        throw new Error(`GWA returned empty area_means for box_deg=${boxDeg}`);
    }
    const powerDensity100m = extractGwaPercentile(pdMeans, 100);
    const windSpeed100m = extractGwaPercentile(wsMeans, 100);
    const windiest10PowerDensity = extractGwaPercentile(pdMeans, 10);
    const windiest10Speed100m = extractGwaPercentile(wsMeans, 10);
    if (windSpeed100m === undefined || powerDensity100m === undefined) {
        throw new Error(`GWA returned invalid 100m values for box_deg=${boxDeg}`);
    }
    let monthlyWind100m;
    const annualTs = tempData.annual_ts;
    if (Array.isArray(annualTs) && annualTs.length === 12) {
        const byMonth = new Array(12).fill(0);
        let valid = true;
        for (const row of annualTs){
            if (typeof row.month === 'number' && row.month >= 1 && row.month <= 12 && typeof row.crosstable === 'number' && Number.isFinite(row.crosstable)) {
                byMonth[row.month - 1] = row.crosstable;
            } else {
                valid = false;
            }
        }
        const meanF = byMonth.reduce((a, b)=>a + b, 0) / 12;
        if (valid && meanF > 0) {
            monthlyWind100m = byMonth.map((f)=>round(windSpeed100m * (f / meanF), 4));
        }
    }
    return {
        windSpeed100m,
        powerDensity100m,
        windiest10Speed100m,
        windiest10PowerDensity,
        monthlyWind100m,
        boxDeg
    };
}
async function fetchGwa100mWithRetry(lat, lon, signal) {
    try {
        return await queryGwaBox(lat, lon, 0.0025, signal);
    } catch  {
        try {
            return await queryGwaBox(lat, lon, 0.01, signal);
        } catch  {
            return null;
        }
    }
}
async function fetchTerrainStencil(lat, lon, signal) {
    const stepDeg = 0.002;
    const pts = [
        [
            lat,
            lon
        ],
        [
            lat + stepDeg,
            lon
        ],
        [
            lat - stepDeg,
            lon
        ],
        [
            lat,
            lon + stepDeg
        ],
        [
            lat,
            lon - stepDeg
        ]
    ];
    const lats = pts.map((p)=>p[0].toFixed(5)).join(',');
    const lons = pts.map((p)=>p[1].toFixed(5)).join(',');
    try {
        const data = await fetchJsonWithTimeout(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`, {
            signal
        });
        const elevs = data.elevation;
        if (!Array.isArray(elevs) || elevs.length < 5 || elevs.some((v)=>!Number.isFinite(v))) {
            throw new Error('Incomplete DEM stencil');
        }
        const [eCenter, eNorth, eSouth, eEast, eWest] = elevs;
        const dyM = 2 * stepDeg * 111_320;
        const dxM = 2 * stepDeg * 111_320 * Math.max(0.1, Math.cos(lat * Math.PI / 180));
        const dzDy = (eNorth - eSouth) / dyM;
        const dzDx = (eEast - eWest) / dxM;
        const slopeDeg = Math.atan(Math.hypot(dzDx, dzDy)) * 180 / Math.PI;
        return {
            elevationM: round(eCenter, 1),
            slopeDeg: round(slopeDeg, 2),
            source: 'Copernicus DEM GLO-90 (90m grid via Open-Meteo Elevation API, 5-pt 220m stencil)'
        };
    } catch  {
        return {
            elevationM: 0,
            slopeDeg: 0,
            source: 'Copernicus DEM GLO-90 fallback (elevation unavailable)'
        };
    }
}
async function loadFinlandWaterIndex() {
    if (!finlandWaterPromise) {
        finlandWaterPromise = (async ()=>{
            try {
                const filePath = path.join(process.cwd(), 'server', 'v6', 'data', 'hydro', 'finland-water.json');
                const raw = await readFile(filePath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed.points) || parsed.points.length === 0) return null;
                return parsed;
            } catch  {
                return null;
            }
        })();
    }
    return finlandWaterPromise;
}
function queryFinlandHydroProximity(index, lat, lon) {
    const best = {};
    const pts = index.points;
    for(let i = 0; i < pts.length; i++){
        const p = pts[i];
        const code = p[2];
        const d = haversineKm(lat, lon, p[0], p[1]);
        const prev = best[code];
        if (!prev || d < prev.dist) {
            best[code] = {
                dist: d,
                lat: p[0],
                lon: p[1]
            };
        }
    }
    const toSample = (code)=>{
        const entry = best[code];
        if (!entry) return null;
        return {
            distance_to_sample_km: round(entry.dist, 3),
            sample_lat: entry.lat,
            sample_lon: entry.lon
        };
    };
    const candidates = [];
    for (const code of [
        0,
        1,
        2
    ]){
        if (best[code]) candidates.push([
            best[code].dist,
            code
        ]);
    }
    const nearestSurface = candidates.length > 0 ? candidates.reduce((a, b)=>a[0] <= b[0] ? a : b) : null;
    const freshCandidates = [];
    for (const code of [
        1,
        2
    ]){
        if (best[code]) freshCandidates.push([
            best[code].dist,
            code
        ]);
    }
    const nearestFresh = freshCandidates.length > 0 ? freshCandidates.reduce((a, b)=>a[0] <= b[0] ? a : b) : null;
    const typeName = (code)=>code === 0 ? 'sea' : code === 2 ? 'river' : 'lake';
    return {
        source: 'SYKE Ranta10-derived user-supplied sparse point sample',
        status: 'approximate_sample_proximity_not_shoreline_distance',
        sampling_cell_m: 3400,
        sea: toSample(0),
        lake: toSample(1),
        river: toSample(2),
        nearest_surface_type: nearestSurface ? typeName(nearestSurface[1]) : null,
        nearest_surface_sample_km: nearestSurface ? round(nearestSurface[0], 3) : null,
        nearest_freshwater_type: nearestFresh ? typeName(nearestFresh[1]) : null,
        nearest_freshwater_sample_km: nearestFresh ? round(nearestFresh[0], 3) : null,
        used_in_score: false
    };
}
async function fetchGlofasDischargeBatch(coords, signal) {
    const lats = coords.map((c)=>c[0].toFixed(4)).join(',');
    const lons = coords.map((c)=>c[1].toFixed(4)).join(',');
    const url = `https://flood-api.open-meteo.com/v1/flood` + `?latitude=${lats}&longitude=${lons}&daily=river_discharge&past_days=14&forecast_days=1`;
    const raw = await fetchJsonWithTimeout(url, {
        signal
    });
    const items = Array.isArray(raw) ? raw : [
        raw
    ];
    return items.map((item)=>{
        const vals = (item.daily?.river_discharge ?? []).filter((v)=>typeof v === 'number' && Number.isFinite(v));
        if (vals.length === 0) return null;
        return vals.reduce((a, b)=>a + b, 0) / vals.length;
    });
}
export async function fetchWaterPrecision(lat, lon, signal) {
    const ringsKm = [
        0.5,
        1.5,
        3.0,
        6.0,
        10.0,
        15.0
    ];
    const bearings = [
        0,
        45,
        90,
        135,
        180,
        225,
        270,
        315
    ];
    const stencil = [
        {
            coord: [
                lat,
                lon
            ],
            distKm: 0
        }
    ];
    for (const r of ringsKm){
        for (const b of bearings){
            stencil.push({
                coord: offsetPoint(lat, lon, r, b),
                distKm: r
            });
        }
    }
    try {
        const coords = stencil.map((s)=>s.coord);
        const lats = coords.map((c)=>c[0].toFixed(4)).join(',');
        const lons = coords.map((c)=>c[1].toFixed(4)).join(',');
        const [discharges, dem] = await Promise.all([
            fetchGlofasDischargeBatch(coords, signal),
            fetchJsonWithTimeout(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`, {
                signal
            }).catch(()=>({
                    elevation: undefined
                }))
        ]);
        const validDischarges = discharges.filter((v)=>v !== null);
        const maxDischarge = validDischarges.length > 0 ? round(Math.max(...validDischarges), 2) : null;
        let nearestDistKm = 20;
        let detectedType;
        for(let i = 0; i < stencil.length; i++){
            const q = discharges[i];
            const elev = dem.elevation?.[i];
            if (typeof elev === 'number' && elev <= 0.5) {
                nearestDistKm = Math.min(nearestDistKm, stencil[i].distKm);
                detectedType = 'sea';
                break;
            }
            if (q !== null && q >= 0.5) {
                nearestDistKm = Math.min(nearestDistKm, stencil[i].distKm);
                detectedType = 'river';
                break;
            }
        }
        if (maxDischarge === null) {
            return {
                waterDistanceKm: null,
                waterDischargeM3s: null,
                waterMethod: 'unavailable',
                status: 'unavailable',
                source: 'Copernicus GloFAS v4 unavailable'
            };
        }
        return {
            waterDistanceKm: nearestDistKm,
            waterDischargeM3s: maxDischarge,
            waterBodyType: detectedType,
            waterMethod: 'glofas_49pt_stencil',
            status: 'measured',
            source: 'Copernicus GloFAS v4 & Copernicus DEM GLO-90 49-pt stencil'
        };
    } catch  {
        return {
            waterDistanceKm: null,
            waterDischargeM3s: null,
            waterMethod: 'unavailable',
            status: 'unavailable',
            source: 'Water service unavailable'
        };
    }
}
function normalCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp(-z * z / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z >= 0 ? 1 - p : p;
}
function fitSeasonalOls(values, months) {
    const n = values.length;
    const seasonalNormals = new Array(12).fill(0);
    const counts = new Array(12).fill(0);
    for(let i = 0; i < n; i++){
        const mIdx = months[i] - 1;
        seasonalNormals[mIdx] += values[i];
        counts[mIdx] += 1;
    }
    for(let m = 0; m < 12; m++){
        seasonalNormals[m] = counts[m] > 0 ? seasonalNormals[m] / counts[m] : 0;
    }
    const anomalies = values.map((v, i)=>v - seasonalNormals[months[i] - 1]);
    const meanCenter = (n - 1) / 2;
    let num = 0;
    let den = 0;
    for(let i = 0; i < n; i++){
        const x = i - meanCenter;
        num += x * anomalies[i];
        den += x * x;
    }
    const slopePerMonth = den > 0 ? num / den : 0;
    const residuals = anomalies.map((a, i)=>a - slopePerMonth * (i - meanCenter));
    const maxLag = Math.min(12, Math.max(1, Math.floor(n / 4)));
    let s = 0;
    for(let i = 0; i < n; i++){
        const xe = (i - meanCenter) * residuals[i];
        s += xe * xe;
    }
    for(let lag = 1; lag <= maxLag; lag++){
        const weight = 1 - lag / (maxLag + 1);
        let cov = 0;
        for(let i = lag; i < n; i++){
            const xe1 = (i - meanCenter) * residuals[i];
            const xe2 = (i - lag - meanCenter) * residuals[i - lag];
            cov += xe1 * xe2;
        }
        s += 2 * weight * cov;
    }
    const variance = den > 0 ? Math.max(0, s) / (den * den) : 0;
    const sePerMonth = Math.sqrt(variance);
    const z = sePerMonth > 0 ? slopePerMonth / sePerMonth : 0;
    const pValue = sePerMonth > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : 1;
    return {
        seasonalNormals,
        slopePerMonth,
        sePerMonth,
        pValue,
        meanCenter
    };
}
function getParamSeries(params, key, startYear, endYear) {
    const dict = params[key] ?? {};
    const out = [];
    for(let y = startYear; y <= endYear; y++){
        for(let m = 1; m <= 12; m++){
            const ym = `${y}${String(m).padStart(2, '0')}`;
            const raw = dict[ym];
            if (typeof raw === 'number' && Number.isFinite(raw) && raw > -900) {
                out.push({
                    date: `${y}-${String(m).padStart(2, '0')}`,
                    year: y,
                    month: m,
                    value: raw
                });
            }
        }
    }
    return out;
}
function scorePhysical(value, bounds) {
    if (value === null || !Number.isFinite(value)) return null;
    const span = bounds.high - bounds.low;
    if (span <= 0) return 50;
    const raw = bounds.higherIsBetter ? (value - bounds.low) / span * 100 : (bounds.high - value) / span * 100;
    return round(clamp(raw, 0, 100), 3);
}
function weightedAverage(items) {
    let num = 0;
    let den = 0;
    for (const [val, w] of items){
        if (val !== null && Number.isFinite(val)) {
            num += val * w;
            den += w;
        }
    }
    return den > 0 ? round(num / den, 3) : null;
}
export async function analyzeExactPoint({ lat, lon, startYear = 2005, endYear = 2024, horizonYears = 10, signal }) {
    const coordKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cacheKey = `${coordKey}:${startYear}-${endYear}:${horizonYears}`;
    const cached = pointCache.get(cacheKey);
    if (cached) return cached;
    let rawInputs = nasaCoarseCache.get(coordKey);
    if (!rawInputs) {
        const [params, gwaRes, terrain, water, hydroIndex] = await Promise.all([
            fetchNasaPowerMonthly(lat, lon, signal).then(data => data.parameters),
            fetchGwa100mWithRetry(lat, lon, signal),
            fetchTerrainStencil(lat, lon, signal),
            fetchWaterPrecision(lat, lon, signal),
            loadFinlandWaterIndex()
        ]);
        rawInputs = { params, gwaRes, terrain, water, hydroIndex };
        pruneMap(nasaCoarseCache, MAX_CACHE_ENTRIES);
        nasaCoarseCache.set(coordKey, rawInputs);
    }
    const { params, gwaRes, terrain, water, hydroIndex } = rawInputs;
    const pointHydro = hydroIndex ? queryFinlandHydroProximity(hydroIndex, lat, lon) : null;
    const response = buildPointReport({ lat, lon, startYear, endYear, horizonYears, params, gwaRes, terrain, water, pointHydro });
    pruneMap(pointCache, MAX_CACHE_ENTRIES);
    pointCache.set(cacheKey, response);
    return response;
}

export function buildPointReport({ lat, lon, startYear = 2005, endYear = 2024, horizonYears = 10,
    params, gwaRes = null, terrain, water, pointHydro = null, requireComplete = false }) {
    const t2mRows = getParamSeries(params, 'T2M', startYear, endYear);
    const t2mMaxAvgRows = getParamSeries(params, 'T2M_MAX_AVG', startYear, endYear);
    const solarRows = getParamSeries(params, 'ALLSKY_SFC_SW_DWN', startYear, endYear);
    const clrSolarRows = getParamSeries(params, 'CLRSKY_SFC_SW_DWN', startYear, endYear);
    const rhRows = getParamSeries(params, 'RH2M', startYear, endYear);
    const wetRows = getParamSeries(params, 'T2MWET', startYear, endYear);
    const precipRows = getParamSeries(params, 'PRECTOTCORR', startYear, endYear);
    const ws10Rows = getParamSeries(params, 'WS10M', startYear, endYear);
    const ws50Rows = getParamSeries(params, 'WS50M', startYear, endYear);
    const expected = (endYear - startYear + 1) * 12;
    if (requireComplete && [t2mRows, t2mMaxAvgRows, solarRows, ws10Rows, ws50Rows].some(rows => rows.length !== expected)) {
        throw new Error('NASA POWER did not provide complete climate, solar and wind history.');
    }
    if (t2mRows.length < 24) {
        throw new Error('Insufficient NASA POWER temperature history at this coordinate.');
    }
    const t2mVals = t2mRows.map((r)=>r.value);
    const t2mMonths = t2mRows.map((r)=>r.month);
    const olsT2m = fitSeasonalOls(t2mVals, t2mMonths);
    const maxAvgMap = new Map(t2mMaxAvgRows.map((r)=>[
            r.date,
            r.value
        ]));
    const maxAvgVals = t2mRows.map((r)=>maxAvgMap.get(r.date) ?? r.value + 2.0);
    const olsMaxAvg = fitSeasonalOls(maxAvgVals, t2mMonths);
    const historicalMonthly = t2mRows.map((r, i)=>{
        const seasonalNormal = olsT2m.seasonalNormals[r.month - 1];
        const deseasonalizedTrend = olsT2m.slopePerMonth * (i - olsT2m.meanCenter);
        return {
            date: r.date,
            t2m_c: round(r.value, 2),
            t2m_max_avg_c: round(maxAvgVals[i], 2),
            seasonal_normal_c: round(seasonalNormal, 4),
            anomaly_c: round(r.value - seasonalNormal, 4),
            seasonal_trend_c: round(seasonalNormal + deseasonalizedTrend, 4),
            deseasonalized_trend_c: round(deseasonalizedTrend, 4)
        };
    });
    const nHist = t2mRows.length;
    const scenarioStartYear = endYear + 1;
    const scenarioEndYear = endYear + horizonYears;
    const scenarioMonthly = [];
    const scenarioYearBlocks = [];
    const warmestMonthMaxAvgByYear = [];
    for(let y = scenarioStartYear; y <= scenarioEndYear; y++){
        let yearTempSum = 0;
        let yearDd10 = 0;
        let yearMaxAvgPeak = -Infinity;
        for(let m = 1; m <= 12; m++){
            const idx = nHist + (y - scenarioStartYear) * 12 + (m - 1);
            const anomaly = olsT2m.slopePerMonth * (idx - olsT2m.meanCenter);
            const normal = olsT2m.seasonalNormals[m - 1];
            const t2mProj = normal + anomaly;
            const maxAvgAnomaly = olsMaxAvg.slopePerMonth * (idx - olsMaxAvg.meanCenter);
            const maxAvgProj = olsMaxAvg.seasonalNormals[m - 1] + maxAvgAnomaly;
            yearTempSum += t2mProj;
            yearDd10 += Math.max(0, t2mProj - 10) * daysInMonth(y, m);
            if (maxAvgProj > yearMaxAvgPeak) yearMaxAvgPeak = maxAvgProj;
            scenarioMonthly.push({
                date: `${y}-${String(m).padStart(2, '0')}`,
                t2m_c: round(t2mProj, 5),
                t2m_max_avg_c: round(maxAvgProj, 5),
                seasonal_normal_c: round(normal, 4),
                no_trend_baseline_c: round(normal, 4),
                anomaly_c: round(anomaly, 5)
            });
        }
        warmestMonthMaxAvgByYear.push(yearMaxAvgPeak);
        scenarioYearBlocks.push({
            start_month: `${y}-01`,
            end_month: `${y}-12`,
            mean_temp_c: round(yearTempSum / 12, 4),
            cooling_pressure_dd10: round(yearDd10, 3)
        });
    }
    const isDefaultHist = startYear === 2005 && endYear === 2024;
    let splitIdx = isDefaultHist ? t2mRows.findIndex((r)=>r.year >= 2019) : -1;
    if (splitIdx <= 24) {
        const targetTrain = Math.floor(nHist * 0.7);
        const splitYear = t2mRows[Math.min(nHist - 1, Math.max(24, targetTrain))]?.year;
        const yearBoundary = splitYear !== undefined ? t2mRows.findIndex((r)=>r.year >= splitYear) : -1;
        splitIdx = yearBoundary >= 24 && nHist - yearBoundary >= 12 ? yearBoundary : Math.floor(nHist * 0.7);
    }
    const trainCount = Math.min(nHist - 1, Math.max(12, splitIdx));
    const trainVals = t2mVals.slice(0, trainCount);
    const trainMonths = t2mMonths.slice(0, trainCount);
    const trainOls = fitSeasonalOls(trainVals, trainMonths);
    const heldoutMonthly = [];
    let absErrTrendSum = 0;
    let absErrBaseSum = 0;
    for(let i = trainCount; i < nHist; i++){
        const m = t2mMonths[i];
        const base = trainOls.seasonalNormals[m - 1];
        const model = base + trainOls.slopePerMonth * (i - trainOls.meanCenter);
        const obs = t2mVals[i];
        absErrTrendSum += Math.abs(obs - model);
        absErrBaseSum += Math.abs(obs - base);
        heldoutMonthly.push({
            date: t2mRows[i].date,
            observed_c: round(obs, 2),
            model_c: round(model, 3),
            seasonal_baseline_c: round(base, 3)
        });
    }
    const nTest = Math.max(1, heldoutMonthly.length);
    const maeTrend = absErrTrendSum / nTest;
    const maeBase = absErrBaseSum / nTest;
    const solarMonthlySums = new Array(12).fill(0);
    const solarMonthlyCounts = new Array(12).fill(0);
    for (const r of solarRows){
        const kwhM2 = r.value * daysInMonth(r.year, r.month);
        solarMonthlySums[r.month - 1] += kwhM2;
        solarMonthlyCounts[r.month - 1] += 1;
    }
    const solarMonthlyClimatology = solarMonthlySums.map((s, idx)=>solarMonthlyCounts[idx] > 0 ? round(s / solarMonthlyCounts[idx], 2) : 0);
    const solarAnnualGhi = round(solarMonthlyClimatology.reduce((a, b)=>a + b, 0), 2);
    const clrMonthlySums = new Array(12).fill(0);
    const clrMonthlyCounts = new Array(12).fill(0);
    for (const r of clrSolarRows){
        clrMonthlySums[r.month - 1] += r.value * daysInMonth(r.year, r.month);
        clrMonthlyCounts[r.month - 1] += 1;
    }
    const clrSolarAnnual = round(clrMonthlySums.reduce((acc, s, idx)=>acc + (clrMonthlyCounts[idx] > 0 ? s / clrMonthlyCounts[idx] : 0), 0), 2);
    const cloudLossPct = clrSolarAnnual > 0 ? round((clrSolarAnnual - solarAnnualGhi) / clrSolarAnnual * 100, 2) : 0;
    const rhMean = rhRows.length > 0 ? round(rhRows.reduce((a, b)=>a + b.value, 0) / rhRows.length, 2) : null;
    const wetMean = wetRows.length > 0 ? round(wetRows.reduce((a, b)=>a + b.value, 0) / wetRows.length, 2) : null;
    const precipAnnualMm = precipRows.length > 0 ? round(precipRows.reduce((a, b)=>a + b.value * daysInMonth(b.year, b.month), 0) / Math.max(1, new Set(precipRows.map((r)=>r.year)).size), 1) : null;
    const ws10Mean = ws10Rows.length > 0 ? ws10Rows.reduce((a, b)=>a + b.value, 0) / ws10Rows.length : 3.0;
    const ws50Mean = ws50Rows.length > 0 ? ws50Rows.reduce((a, b)=>a + b.value, 0) / ws50Rows.length : 4.5;
    const histMeanTemp = t2mVals.reduce((a, b)=>a + b, 0) / t2mVals.length;
    const usedGwa = gwaRes !== null;
    let windSpeed100m = usedGwa ? round(gwaRes.windSpeed100m, 2) : null;
    let windPowerDensity = usedGwa ? round(gwaRes.powerDensity100m, 2) : null;
    let windMonthly100m = gwaRes?.monthlyWind100m;
    if (!windMonthly100m) {
        const rawAlpha = ws10Mean > 0.2 && ws50Mean > ws10Mean ? Math.log(ws50Mean / ws10Mean) / Math.log(5) : 0.2;
        const factor50To100 = 2 ** clamp(rawAlpha, 0.05, 0.45);
        const ws50ByMonth = new Array(12).fill(0);
        const counts = new Array(12).fill(0);
        for (const { month, value } of ws50Rows) {
            ws50ByMonth[month - 1] += value;
            counts[month - 1]++;
        }
        const estimatedSpeed = round(ws50Mean * factor50To100, 3);
        const scale = usedGwa && estimatedSpeed > 0 ? gwaRes.windSpeed100m / estimatedSpeed : 1;
        const estimatedMonthly = ws50ByMonth.map((sum, index) =>
            round((counts[index] ? sum / counts[index] : ws50Mean) * factor50To100, 4));
        windMonthly100m = estimatedMonthly.map(value => round(value * scale, 4));
        if (!usedGwa) {
            const airDensity = 1.225 * (288.15 / (273.15 + histMeanTemp)) * Math.exp(-terrain.elevationM / 8400);
            windPowerDensity = round(0.5 * airDensity * (6 / Math.PI) * (estimatedMonthly.reduce((sum, value)=>sum + value ** 3, 0) / 12), 2);
            windSpeed100m = estimatedSpeed;
        }
    }
    const monthlyClimatology = Array.from({
        length: 12
    }, (_, idx)=>({
            month: idx + 1,
            mean_t2m_c: round(olsT2m.seasonalNormals[idx], 4),
            mean_t2m_max_avg_c: round(olsMaxAvg.seasonalNormals[idx], 4),
            solar_kwh_m2: solarMonthlyClimatology[idx],
            wind_speed_100m_ms: windMonthly100m[idx]
        }));
    const scenarioMeanTemp = round(scenarioYearBlocks.reduce((a, b)=>a + b.mean_temp_c, 0) / scenarioYearBlocks.length, 4);
    const scenarioAvgCoolingDd10 = round(scenarioYearBlocks.reduce((a, b)=>a + b.cooling_pressure_dd10, 0) / scenarioYearBlocks.length, 4);
    const scenarioAvgWarmestMaxAvg = round(warmestMonthMaxAvgByYear.reduce((a, b)=>a + b, 0) / warmestMonthMaxAvgByYear.length, 4);
    const scenarioLastMonthTemp = round(scenarioMonthly[scenarioMonthly.length - 1]?.t2m_c ?? scenarioMeanTemp, 4);
    const scoreCooling = scorePhysical(scenarioAvgCoolingDd10, PHYSICAL_REFERENCE_BOUNDS.cooling);
    const scoreSummerHeat = scorePhysical(scenarioAvgWarmestMaxAvg, PHYSICAL_REFERENCE_BOUNDS.summer_heat);
    const scoreSolar = scorePhysical(solarAnnualGhi, PHYSICAL_REFERENCE_BOUNDS.solar);
    const scoreWind = scorePhysical(windPowerDensity, PHYSICAL_REFERENCE_BOUNDS.wind);
    const waterMeasured = water.status === 'measured';
    const scoredWaterDistKm = waterMeasured ? water.waterDistanceKm : null;
    const scoredWaterDischM3s = waterMeasured ? water.waterDischargeM3s : null;
    const scoreWaterDist = scorePhysical(scoredWaterDistKm, PHYSICAL_REFERENCE_BOUNDS.water_distance);
    const scoreWaterDisch = scorePhysical(scoredWaterDischM3s, PHYSICAL_REFERENCE_BOUNDS.water_discharge);
    const hasWater = scoreWaterDist !== null || scoreWaterDisch !== null;
    const effectiveClimateWeight = hasWater ? WEIGHTS.climate : WEIGHTS.climate_no_water;
    const effectiveWaterWeight = hasWater ? WEIGHTS.water : 0;
    const effectiveRenewablesWeight = round(1 - effectiveClimateWeight - effectiveWaterWeight, 6);
    const scoreClimate = weightedAverage([
        [
            scoreCooling,
            WEIGHTS.cooling_within_climate
        ],
        [
            scoreSummerHeat,
            1 - WEIGHTS.cooling_within_climate
        ]
    ]);
    const scoreRenewables = weightedAverage([
        [
            scoreSolar,
            WEIGHTS.solar_within_renewables
        ],
        [
            scoreWind,
            1 - WEIGHTS.solar_within_renewables
        ]
    ]);
    const scoreWater = hasWater ? weightedAverage([
        [
            scoreWaterDist,
            WEIGHTS.water_distance_within_water
        ],
        [
            scoreWaterDisch,
            1 - WEIGHTS.water_distance_within_water
        ]
    ]) : null;
    const contribClimate = round(effectiveClimateWeight * (scoreClimate ?? 0), 3);
    const contribRenewables = round(effectiveRenewablesWeight * (scoreRenewables ?? 0), 3);
    const contribWater = round(effectiveWaterWeight * (scoreWater ?? 0), 3);
    const scoreOverall = scoreClimate !== null && scoreRenewables !== null ? round(contribClimate + contribRenewables + contribWater, 3) : weightedAverage([
        [
            scoreClimate,
            effectiveClimateWeight
        ],
        [
            scoreRenewables,
            effectiveRenewablesWeight
        ],
        [
            scoreWater,
            effectiveWaterWeight
        ]
    ]);
    const rankingMetricsUsed = [
        'cooling',
        'summer_heat',
        'solar',
        'wind_density',
        ...scoreWaterDist !== null ? [
            'water_distance'
        ] : [],
        ...scoreWaterDisch !== null ? [
            'water_discharge'
        ] : []
    ];
    const rankingMetricsMissing = [
        ...scoreWaterDist === null ? [
            'water_distance'
        ] : [],
        ...scoreWaterDisch === null ? [
            'water_discharge'
        ] : []
    ];
    const slopeDecade = round(olsT2m.slopePerMonth * 120, 5);
    const seDecade = olsT2m.sePerMonth * 120;
    const siteId = `pt_${lat.toFixed(4)}_${lon.toFixed(4)}`;
    const waterObj = {
        water_distance_km: scoredWaterDistKm ?? undefined,
        water_discharge_m3s: scoredWaterDischM3s ?? undefined,
        water_body_type: water.waterBodyType,
        water_method: water.waterMethod,
        status: water.status,
        source: water.source
    };
    const extraMetrics = {
        iso_code: 'CUSTOM',
        elevation_m: terrain.elevationM,
        water_distance_km: scoredWaterDistKm,
        water_discharge_m3s: scoredWaterDischM3s,
        water_body_type: water.waterBodyType ?? null,
        water_method: water.waterMethod,
        water_source: water.source,
        rh2m_mean_pct: rhMean,
        t2mwet_mean_c: wetMean,
        clrsky_solar_ghi_kwh_m2_year: clrSolarAnnual,
        cloud_solar_loss_pct: cloudLossPct,
        prectotcorr_mm_year: precipAnnualMm,
        ws10m_mean_ms: round(ws10Mean, 3),
        ws50m_mean_ms: round(ws50Mean, 3),
        ...usedGwa ? {
            gwa_wind_power_density_w_m2: round(gwaRes.powerDensity100m, 2),
            gwa_wind_speed_100m_ms: round(gwaRes.windSpeed100m, 2),
            ...gwaRes.windiest10PowerDensity !== undefined ? {
                gwa_windiest_10pct_power_density_w_m2: round(gwaRes.windiest10PowerDensity, 2)
            } : {},
            ...gwaRes.windiest10Speed100m !== undefined ? {
                gwa_windiest_10pct_wind_speed_100m_ms: round(gwaRes.windiest10Speed100m, 2)
            } : {}
        } : {},
        wind_source_used: usedGwa ? 'gwa' : 'merra2'
    };
    const strengths = [];
    const limitations = [];
    if (scoreCooling !== null && scoreCooling >= 70) {
        strengths.push({
            text: 'Lower estimated cooling-temperature pressure'
        });
    } else if (scoreCooling !== null && scoreCooling <= 30) {
        limitations.push({
            text: 'Higher estimated cooling-temperature pressure'
        });
    }
    if (scoreWind !== null && scoreWind >= 70) {
        strengths.push({
            text: 'Stronger 100m wind resource'
        });
    } else if (scoreWind !== null && scoreWind <= 30) {
        limitations.push({
            text: 'Weaker 100m wind resource'
        });
    }
    if (scoreSolar !== null && scoreSolar >= 70) {
        strengths.push({
            text: 'Higher solar irradiation potential'
        });
    }
    if (scoreWater !== null && scoreWater >= 70) {
        strengths.push({
            text: 'Strong surface water access & discharge capacity'
        });
    } else if (scoreWater !== null && scoreWater <= 30) {
        limitations.push({
            text: 'Limited nearby surface water resource'
        });
    }
    const pointRanking = {
        site_id: siteId,
        region: `Exact coordinates (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
        rank: null,
        lat: round(lat, 4),
        lon: round(lon, 4),
        scores: {
            cooling: scoreCooling,
            summer_heat: scoreSummerHeat,
            solar: scoreSolar,
            wind: scoreWind,
            water_distance: scoreWaterDist,
            water_discharge: scoreWaterDisch,
            climate: scoreClimate,
            renewables: scoreRenewables,
            water: scoreWater,
            overall: scoreOverall
        },
        score_contributions: {
            climate: contribClimate,
            renewables: contribRenewables,
            water: contribWater,
            total: scoreOverall ?? 0
        },
        measurements: {
            historical_mean_temp_c: round(histMeanTemp, 4),
            scenario_mean_temp_c: scenarioMeanTemp,
            scenario_avg_cooling_pressure_dd10: scenarioAvgCoolingDd10,
            scenario_avg_warmest_month_maxavg_c: scenarioAvgWarmestMaxAvg,
            scenario_last_month_temp_c: scenarioLastMonthTemp,
            solar_ghi_kwh_m2_year: solarAnnualGhi,
            wind_speed_100m_ms: windSpeed100m,
            wind_power_density_w_m2: windPowerDensity,
            water_distance_km: scoredWaterDistKm,
            water_discharge_m3s: scoredWaterDischM3s,
            slope_deg: terrain.slopeDeg
        },
        sources: {
            climate: `NASA POWER Monthly API (MERRA-2, 2m height, ${startYear}-01..${endYear}-12, https://power.larc.nasa.gov/api/temporal/monthly/point)`,
            solar: `NASA POWER Monthly API (CERES ALLSKY_SFC_SW_DWN, ${startYear}-01..${endYear}-12, converted to kWh/m2)`,
            wind: usedGwa ? `DTU Global Wind Atlas v3.3 (100m height, box_deg=${gwaRes.boxDeg})` : 'NASA POWER MERRA-2 (vertical extrapolation from WS10M & WS50M to 100m)',
            terrain: terrain.source,
            water: water.source
        },
        extra_metrics: extraMetrics,
        water: waterObj,
        data_quality: {
            ranking_metrics_used: rankingMetricsUsed,
            ranking_metrics_missing: rankingMetricsMissing,
            water_source_is_fallback: !hasWater
        },
        trend: {
            slope_c_per_decade: slopeDecade,
            slope_95ci_c_per_decade: [
                round(slopeDecade - 1.96 * seDecade, 5),
                round(slopeDecade + 1.96 * seDecade, 5)
            ],
            p_value: round(olsT2m.pValue, 7),
            significant_p05: olsT2m.pValue < 0.05,
            p_value_fdr_bh: null,
            significant_fdr05: false,
            n_months: nHist,
            method: 'Seasonal fixed-effects OLS (calendar-month intercepts), HAC Newey-West SE'
        },
        validation: {
            train_period: [
                t2mRows[0].date,
                t2mRows[trainCount - 1].date
            ],
            test_period: [
                t2mRows[trainCount]?.date ?? `${endYear}-01`,
                t2mRows[nHist - 1].date
            ],
            monthly_mae_trend_c: round(maeTrend, 4),
            monthly_mae_seasonal_baseline_c: round(maeBase, 4),
            trend_better_than_seasonal_baseline: maeTrend < maeBase,
            heldout_monthly: heldoutMonthly
        },
        insight: {
            strengths,
            limitations,
            mandatory_checks: [
                '24/7 firm power supply, storage, or grid connection',
                'Land zoning and environmental permitting',
                'Flood exposure and local geotechnical constraints'
            ],
            effective_weights: {
                climate: effectiveClimateWeight,
                renewables: effectiveRenewablesWeight,
                water: effectiveWaterWeight
            }
        }
    };
    const pointCharts = {
        historical_monthly: historicalMonthly,
        scenario_monthly: scenarioMonthly,
        scenario_year_blocks: scenarioYearBlocks,
        monthly_climatology: monthlyClimatology
    };
    const meta = {
        historical_period: [
            `${startYear}-01`,
            `${endYear}-12`
        ],
        scenario_period: [
            `${scenarioStartYear}-01`,
            `${scenarioEndYear}-12`
        ],
        ranked_sites: 1,
        weights: {
            climate: effectiveClimateWeight,
            renewables: effectiveRenewablesWeight,
            water: effectiveWaterWeight
        },
        scoring_mode: 'fixed',
        score_type: 'Fixed-anchor climate/resource screening score (heuristic), NOT construction viability'
    };
    return {
        point_hydro: pointHydro,
        partial: !hasWater,
        point_ranking: pointRanking,
        point_charts: pointCharts,
        point_input: {
            lat: round(lat, 4),
            lon: round(lon, 4),
            extra_metrics: extraMetrics,
            water: waterObj
        },
        meta,
        total_ranked: 1
    };
}
