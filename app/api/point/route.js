import { analyzeExactPoint } from '../../../server/v6/exact-point';
import { coordinateInFinland } from '../../../server/v6/finland';
import { analyzeCanadaPoint, coordinateInCanada } from '../../../server/v6/canada';
import { analyzeMongoliaPoint, coordinateInMongolia } from '../../../server/v6/mongolia';

export const runtime = 'nodejs';

const MIN_YEAR = 1984;
const MAX_YEAR = 2024;
const MIN_SPAN_YEARS = 3;
const COUNTRY_HANDLERS = {
  fi: { name: 'Finland', contains: coordinateInFinland, analyze: analyzeExactPoint },
  ca: { name: 'Canada', contains: coordinateInCanada, analyze: analyzeCanadaPoint },
  mn: { name: 'Mongolia', contains: coordinateInMongolia, analyze: analyzeMongoliaPoint },
};

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const { country = 'fi', lat, lon, startYear = 2005, endYear = 2024, horizonYears = 10 } = body ?? {};
  const handler = COUNTRY_HANDLERS[country];
  if (!handler) return Response.json({ error: 'Choose Finland, Canada, or Mongolia.' }, { status: 400 });
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) ||
    startYear < MIN_YEAR || endYear > MAX_YEAR || endYear - startYear + 1 < MIN_SPAN_YEARS) {
    return Response.json(
      { error: `Historical window must be at least ${MIN_SPAN_YEARS} years within ${MIN_YEAR}–${MAX_YEAR}.` },
      { status: 400 },
    );
  }
  if (!Number.isInteger(horizonYears) || horizonYears < 1 || horizonYears > 30) {
    return Response.json({ error: 'Forecast horizon must be between 1 and 30 years.' }, { status: 400 });
  }
  try {
    const inside = await handler.contains(lat, lon);
    if (!inside) return Response.json({ error: `Choose land coordinates in ${handler.name}.` }, { status: 400 });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(26_000)]);
    const report = await handler.analyze({ lat, lon, startYear, endYear, horizonYears, signal });
    return Response.json(report);
  } catch {
    return Response.json({ error: 'Live point data are temporarily unavailable. Try bundled reference data or retry.' }, { status: 502 });
  }
}
