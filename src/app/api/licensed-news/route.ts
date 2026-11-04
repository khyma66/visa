import { loadLicensedNews } from '@/lib/licensed-news';
export const runtime = 'edge';
export async function GET() {
  try {
    const { edition, stale } = await loadLicensedNews();
    return Response.json({ ...edition, stale }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'public, max-age=60' } }); }
}
