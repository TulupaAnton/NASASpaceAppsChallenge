import { areaReport } from '../../../server/v6/area';
import { coordinateInFinland } from '../../../server/v6/finland';
import { areaRadii } from '../../lib/geo';

export const runtime = 'nodejs';

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const { lat, lon, radius, source = 'bundled', wind = 'gwa' } = body ?? {};
  if (!areaRadii.includes(radius) || !['bundled', 'live'].includes(source) || !['gwa', 'merra2'].includes(wind)) {
    return Response.json({ error: 'Choose a supported radius, data source and wind dataset.' }, { status: 400 });
  }
  if (!(await coordinateInFinland(lat, lon))) {
    return Response.json({ error: 'Place the center of the area within Finland.' }, { status: 400 });
  }
  try {
    const result = await areaReport({ lat, lon, radius, source, wind, signal: request.signal });
    if (source === 'live' && result.coverage.used === 0) {
      return Response.json({ error: 'NASA POWER returned no usable samples. Try again or switch to bundled references.' }, { status: 502 });
    }
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Area data are temporarily unavailable.' }, { status: 502 });
  }
}
