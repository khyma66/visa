import { NextResponse } from 'next/server';
import archive from '@visa/archive';
import { summarizeArchiveTags } from '@/lib/tag-directory';
import { usVisaPost } from '@/lib/post-presentation';
import type { Question } from '@/lib/types';

export const runtime = 'edge';

export function GET() {
  if (process.env.APP_ENV === 'production' && process.env.IMPORTED_CONTENT_APPROVED !== 'true') {
    return NextResponse.json({ error: 'Imported content is not enabled for public distribution.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (process.env.COMMUNITY_SOURCE_MODE !== 'snapshot') {
    return NextResponse.json({ error: 'The reviewed archive summary is unavailable.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
  const questions = (archive.questions as Question[]).filter(question => usVisaPost(question));
  return NextResponse.json({ tags: summarizeArchiveTags(questions) }, {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300', 'X-Content-Type-Options': 'nosniff' },
  });
}
