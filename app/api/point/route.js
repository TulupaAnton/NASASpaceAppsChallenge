import { analyzeExactPoint } from '../../../server/v6/exact-point';
import { coordinateInFinland } from '../../../server/v6/finland';
import { analyzeCanadaPoint, coordinateInCanada } from '../../../server/v6/canada';

export const runtime = 'nodejs';

const MIN_YEAR = 1984;
const MAX_YEAR = 2024;
const MIN_SPAN_YEARS = 3;

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const { country = 'fi', lat, lon, startYear = 2005, endYear = 2024, horizonYears = 10 } = body ?? {};
  if (country !== 'fi' && country !== 'ca') return Response.json({ error: 'Choose Finland or Canada.' }, { status: 400 });
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
    const canadian = country === 'ca';
    const inside = canadian ? await coordinateInCanada(lat, lon) : await coordinateInFinland(lat, lon);
    if (!inside) return Response.json({ error: `Choose land coordinates in ${canadian ? 'Canada' : 'Finland'}.` }, { status: 400 });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(26_000)]);
    const analyze = canadian ? analyzeCanadaPoint : analyzeExactPoint;
    const report = await analyze({ lat, lon, startYear, endYear, horizonYears, signal });
    return Response.json(report);
  } catch {
    return Response.json({ error: 'Live point data are temporarily unavailable. Try bundled reference data or retry.' }, { status: 502 });
  }
}
