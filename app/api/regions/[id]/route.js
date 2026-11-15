import { regionReport } from '../../../../server/v6/catalog';

export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  const { id } = await params;
  const report = await regionReport(id);
  return report
    ? Response.json(report, { headers: { 'Cache-Control': 'public, max-age=300' } })
    : Response.json({ error: 'Unknown Finland reference site.' }, { status: 404 });
}
