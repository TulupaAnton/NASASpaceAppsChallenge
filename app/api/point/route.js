import { analyzeExactPoint } from '../../../server/v6/exact-point';
import { coordinateInFinland } from '../../../server/v6/finland';

export const runtime = 'nodejs';

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const { lat, lon, wind = 'gwa' } = body ?? {};
  if ((wind !== 'gwa' && wind !== 'merra2') || !(await coordinateInFinland(lat, lon))) {
    return Response.json({ error: 'Choose coordinates in Finland and a supported wind dataset.' }, { status: 400 });
  }
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(26_000)]);
    const report = await analyzeExactPoint({ lat, lon, windSource: wind, includeBaseline: false, signal });
    return Response.json(report);
  } catch {
    return Response.json({ error: 'Live point data are temporarily unavailable. Try bundled reference data or retry.' }, { status: 502 });
  }
}
