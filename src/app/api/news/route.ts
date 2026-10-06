import { createNewsService, isNewsAgency } from '@/lib/news';

export const runtime = 'edge';
const getNews = createNewsService();

export async function GET(request: Request) {
  const agency = new URL(request.url).searchParams.get('agency') ?? 'all';
  if (!isNewsAgency(agency)) {
    return Response.json({ error: 'Choose a supported agency.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    return Response.json(await getNews(agency), {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return Response.json({ status: 'unavailable', error: 'Agency updates are temporarily unavailable.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  }
}
