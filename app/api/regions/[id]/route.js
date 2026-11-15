import { regionReport } from '../../../../server/v6/catalog';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { id } = await params;
  const wind = request.nextUrl.searchParams.get('wind') ?? 'gwa';
  if (wind !== 'gwa' && wind !== 'merra2') {
    return Response.json({ error: 'Choose GWA or MERRA-2 as the wind dataset.' }, { status: 400 });
  }
  const report = await regionReport(id, wind);
  return report
    ? Response.json(report, { headers: { 'Cache-Control': 'public, max-age=300' } })
    : Response.json({ error: 'Unknown Finland reference site.' }, { status: 404 });
}
