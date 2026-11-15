# AI-Агент та Frontend Гід — NASA Space Apps: Data Center Siting (v5.0)

Цей документ є головною точкою входу для AI-агента (фронтенд / аналітика / інтеграція) та розробників. У ньому зібрано актуальну архітектуру пайплайну, карту всіх файлів даних, 3-компонентну формулу оцінки (Клімат + ВДЕ + Водні ресурси), контракти HTTP API та команди запуску.

> **Важливе правило проєкту:**
> Папка [`NasaChallange/`](NasaChallange/) містить окремий React + Vite фронтенд. Бекенд-пайплайн (`fetch_data/`, `rank_sites.py`, `api.py`, `output/`) повністю відокремлений і взаємодіє з фронтендом через REST JSON API або статичні JSON-файли в [`output/`](output/).

---

## 1. Де знаходяться готові дані (Data Layout)

Усі 19 офіційних регіонів Фінляндії (Maakunnat) **уже зібрані та обраховані** — репозиторій працює одразу після клонування без повторного завантаження базових регіонів.

### А. Головні JSON-файли для карти та UI ([`output/`](output/))
- [`output/frontend.json`](output/frontend.json) — підсумковий рейтинг 19 регіонів Фінляндії (NASA POWER + DTU Global Wind Atlas 100 м + Copernicus DEM + водні ресурси GloFAS), включно з балами `0–100`, 10-річним сценарієм (`2025–2034`) і часовими рядами для графіків.
- [`output/frontend_merra2.json`](output/frontend_merra2.json) — аналогічний файл, де вітер на висоті 100 м пораховано чисто фізичною екстраполяцією з NASA POWER / MERRA-2 (`WS10M`, `WS50M`).

### Б. Очищені таблиці, входи моделі та звіт ([`fetch_data/data/clean/`](fetch_data/data/clean/))
- [`fetch_data/data/clean/pipeline_output.json`](fetch_data/data/clean/pipeline_output.json) та [`pipeline_output_merra2.json`](fetch_data/data/clean/pipeline_output_merra2.json) — нормалізовані вхідні пакети контракту Site Ranker v5 (`2005-01` .. `2024-12`).
- [`fetch_data/data/clean/finland_datacenter_suitability.csv`](fetch_data/data/clean/finland_datacenter_suitability.csv) та [`.json`](fetch_data/data/clean/finland_datacenter_suitability.json) — зведена таблиця всіх 19 регіонів (клімат, ВДЕ, водні метрики, тренди).
- [`fetch_data/data/clean/finland_datacenter_report.md`](fetch_data/data/clean/finland_datacenter_report.md) — аналітичний звіт українською мовою.
- [`fetch_data/data/clean/finland_all_regions_annual.csv`](fetch_data/data/clean/finland_all_regions_annual.csv) — річні дані (41 рік: `1984–2024`, `779` рядків).
- [`fetch_data/data/clean/finland_all_regions_monthly.csv`](fetch_data/data/clean/finland_all_regions_monthly.csv) — помісячні дані (492 місяці: `1984–2024`, `9 348` рядків).
- `fetch_data/data/clean/<region>_annual.{csv,json}` та `<region>_monthly.{csv,json}` — окремі файли по кожному регіону.

### В. Сирі дані та динамічний кеш точок ([`fetch_data/data/raw/`](fetch_data/data/raw/))
- `fetch_data/data/raw/<region>.json` — сирі відповіді для 19 регіонів (NASA POWER + `_gwa_100m` + `_terrain` + `_water`).
- `fetch_data/data/raw/points_cache/pt_<lat>_<lon>.json` — автоматичний дисковий кеш для будь-яких нових точок світу (ігнорується в `.gitignore`), із просторовим допуском пошуку `±0.01°` (`cache_tol_deg=0.01`).

---

## 2. Джерела наукових даних

Для будь-якої точки `(lat, lon)` паралельно (у `ThreadPoolExecutor` із перевикористанням TCP/TLS через `requests.Session`) опитуються 4 джерела:

1. **NASA POWER Monthly API (`1984–2024`, `community=RE`)** — 10 змінних: `T2M`, `T2M_MAX_AVG`, `T2M_MAX`, `T2MWET`, `RH2M`, `WS50M`, `ALLSKY_SFC_SW_DWN`, `CLRSKY_SFC_SW_DWN`, `PRECTOTCORR`, `WS10M`.
2. **DTU Global Wind Atlas v3.3 API (100 м, 250 м сітка)** — `wind_power_density_w_m2`, `wind_speed_100m_ms`, 12-місячний профіль. Якщо точка в морі або GWA недоступний, автоматично вмикається фізичний фолбек на MERRA-2 100 м (`wind_source_used = "merra2"`).
3. **Copernicus DEM GLO-90 (через Open-Meteo Elevation API)** — 5-точковий градієнт рельєфу: висота `elevation_m` та похил схилу `slope_deg`.
4. **Copernicus GloFAS v4 Flood API + Copernicus DEM GLO-90 (`fetch_water_point`)** — 17-точковий радіальний трафарет (центр + 4 кільця `0.5, 2.0, 5.0, 12.0 км` × 4 напрямки `N/E/S/W`):
   - `water_distance_km` — найменша відстань до водойми (море/узбережжя: `elevation <= 0.5 м`; річка: `river_discharge >= 1.5 м³/с`; озерне зниження: `z_i <= z_0 - 2.0 м` і `q_i >= 0.4 м³/с`; якщо в межах 12 км води не виявлено — `20.0 км`).
   - `water_discharge_m3s` — максимальний середньодобовий річковий стік (`м³/с`) у радіусі `<= 2.0 км` від точки.
   - При пакетному зборі 19 регіонів діє захист від ліміту Open-Meteo (600 координат/хв): інтервал `_WATER_RATE_LOCK` `0.4 с` та backoff для `HTTP 429`.

---

## 3. Модель оцінки та ваги (`rank_sites.py` — Спосіб 2, 3 стовпи)

Кожна локація оцінюється за шкалою `0–100`. За наявності всіх трьох груп метрик (`climate`, `renewables`, `water`) діють такі ваги:

$$
\text{Overall} = 0.25 \cdot \text{Climate} + 0.60 \cdot \text{Renewables} + 0.15 \cdot \text{Water}
$$

- **Клімат (`climate`, 25%):** `0.75 * cooling + 0.25 * summer_heat`
- **Відновлювана енергія (`renewables`, 60%):** `0.40 * solar + 0.60 * wind`
- **Водні ресурси (`water`, 15%):** `0.70 * water_distance + 0.30 * water_discharge`

*(Якщо для старих або синтетичних наборів даних водні метрики не передано, модель зберігає зворотну сумісність `0.30 * climate + 0.70 * renewables`.)*

### Режими нормалізації (`include_baseline`)
1. **Автономна оцінка 1 точки (`include_baseline=false`, за замовчуванням для `/point` та 1 точки в `/points`):**
   Бали рахуються незалежно від 19 регіонів Фінляндії за фіксованими фізичними інженерними межами `PHYSICAL_REFERENCE_BOUNDS` (`status: "physical_reference"`):
   - `cooling`: `(150.0, 2500.0)` DD10/рік (менше краще: `<=150 → 100`, `>=2500 → 0`)
   - `summer_heat`: `(16.0, 35.0)` °C (менше краще: `<=16 → 100`, `>=35 → 0`)
   - `solar`: `(700.0, 1800.0)` кВт·год/м²/рік (більше краще: `<=700 → 0`, `>=1800 → 100`)
   - `wind_density`: `(100.0, 600.0)` Вт/м² (більше краще: `<=100 → 0`, `>=600 → 100`)
   - `wind_speed`: `(4.0, 9.5)` м/с (більше краще, якщо немає густини потужності)
   - `water_distance`: `(0.5, 15.0)` км (менше краще: `<=0.5 → 100`, `>=15 → 0`)
   - `water_discharge`: `(0.5, 50.0)` м³/с (більше краще: `<=0.5 → 0`, `>=50 → 100`)
2. **Когортне порівняння (`include_baseline=true` або `>= 2` точок у `/points`):**
   Квантильна нормалізація `[0.10, 0.90]` відносно вибірки кандидатів (19 регіонів Фінляндії або переданих точок).

---

## 4. Запуск та HTTP API контракти (`api.py`)

### Запуск бекенд-сервера (`http://127.0.0.1:8000`)
```powershell
.\.venv\Scripts\python.exe api.py
# або:
.\.venv\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8000 --reload
```
CORS відкрито для будь-якого локального порту (`allow_origins=["*"]`). Swagger UI: `http://127.0.0.1:8000/docs`.

### Ендпоінти
| Метод і шлях | Призначення | Основні параметри / тіло |
|---|---|---|
| `GET /` | Статус API та список маршрутів | — |
| `GET /health` | Healthcheck для фронтенду / деплою | — |
| `GET /regions` | Готовий рейтинг 19 регіонів Фінляндії (`output/frontend*.json`, in-memory LRU кеш) | `?wind_source=gwa\|merra2` |
| `GET /point` | Оцінка однієї координати світу | `?lat=...&lon=...&region=...&wind_source=gwa&include_baseline=false&horizon_years=10&use_cache=true` |
| `POST /point` | Те саме через JSON body | `{ "lat", "lon", "site_id?", "region?", "country?", "wind_source", "include_baseline", "horizon_years", "use_cache" }` |
| `POST /points` | Пакетна оцінка та взаємний рейтинг кількох точок | `{ "points": [{ "lat", "lon", "site_id?", "region?", "country?" }], "wind_source", "include_baseline", "horizon_years", "use_cache" }` |
| `POST /analyze` | Прямий запуск `rank_sites.evaluate()` поверх сирого JSON контракту v5 | `{ "pipeline": {...}, "sites": [...] }` |
| `POST /cache/clear` | Очищення серверного in-memory `lru_cache` | — |

### Ключові поля у відповіді `/point` та `/regions`
```json
{
  "target_site_id": "fi_uusimaa",
  "total_ranked": 1,
  "point_ranking": {
    "rank": 1,
    "scores": {
      "overall": 67.89,
      "climate": 14.1,
      "renewables": 89.3,
      "water": 71.8,
      "cooling": 12.162,
      "summer_heat": 19.914,
      "solar": 100.0,
      "wind": 82.164,
      "water_distance": 100.0,
      "water_discharge": 5.999
    },
    "measurements": {
      "historical_mean_temp_c": 6.09,
      "scenario_mean_temp_c": 7.04,
      "scenario_avg_cooling_pressure_dd10": 656.82,
      "scenario_avg_warmest_month_maxavg_c": 22.40,
      "solar_ghi_kwh_m2_year": 1043.1,
      "wind_power_density_w_m2": 399.64,
      "wind_speed_100m_ms": 7.45,
      "water_distance_km": 0.0,
      "water_discharge_m3s": 14.51,
      "slope_deg": 0.34
    },
    "trend": {
      "slope_c_per_decade": 0.625,
      "slope_95ci_c_per_decade": [0.27, 0.98],
      "p_value": 0.0005,
      "significant_p05": true
    },
    "validation": { "status": "evaluated", "monthly_mae_trend_c": 1.61, "heldout_monthly": [] },
    "insight": { "summary": "...", "strengths": [], "limitations": [], "effective_weights": {} }
  },
  "point_charts": {
    "historical_monthly": [],
    "scenario_monthly": [],
    "scenario_year_blocks": [],
    "monthly_climatology": []
  },
  "frontend": { "meta": {}, "ranking": [], "charts": {}, "diagnostics": {}, "excluded": [] }
}
```

---

## 5. Ключові модулі репозиторію

- [`api.py`](api.py) — FastAPI сервер з in-memory кешуванням JSON-відповідей `_load_json_cached`.
- [`rank_sites.py`](rank_sites.py) — оцінка `evaluate()`, HAC OLS тренд, бектест 70/30, `PHYSICAL_REFERENCE_BOUNDS`, 3-стовпова формула, `@lru_cache` на симуляції (`_simulate_site_cached`).
- [`fetch_data/src/collect.py`](fetch_data/src/collect.py) — збір NASA POWER, GWA 100 м, DEM, GloFAS `fetch_water_point()` та дозавантаження 19 регіонів.
- [`fetch_data/src/clean.py`](fetch_data/src/clean.py) — фізичні інваріанти, екстраполяція MERRA-2 100 м, формування звітів, CSV і v5-контракту.
- [`fetch_data/src/point_service.py`](fetch_data/src/point_service.py) — on-demand оцінка будь-якої точки світу `(lat, lon)`, дисковий кеш із толерантністю `±0.01°`, CLI.
- [`fetch_data/fetch_data.py`](fetch_data/fetch_data.py) / [`fetch_data/process_data.py`](fetch_data/process_data.py) — CLI-скрипти перезбирання та перерахунку всіх 19 регіонів.
- [`tests/`](tests/) — автотести ([`tests/test_pipeline.py`](tests/test_pipeline.py), [`tests/test_rank_sites.py`](tests/test_rank_sites.py)).

---

## 6. CLI та перевірка тестів

```powershell
# Оцінка довільної точки з термінала
.\.venv\Scripts\python.exe fetch_data/src/point_service.py --lat 61.4978 --lon 23.7610 --region "Tampere"

# Перевірка / дозбагачення сирих даних 19 регіонів
.\.venv\Scripts\python.exe fetch_data/fetch_data.py

# Перегенерація CSV, звітів і output/frontend*.json
.\.venv\Scripts\python.exe fetch_data/process_data.py

# Повний прогін тестів
.\.venv\Scripts\python.exe -m pytest -q tests/
```
