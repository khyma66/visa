import type { Metadata } from 'next';
import { QuestionDetail } from '@/components/QuestionDetail';
import { publicAnswers, publicQuestion } from '@/lib/public-server';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { serializeStructuredData, threadMetadata, threadStructuredData, type SearchParameters } from '@/lib/search-metadata';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }>; searchParams: Promise<SearchParameters> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const question = await publicQuestion(id);
  return threadMetadata(question, id, await searchParams);
}

export default async function QuestionPage({ params }: Props) {
  const { id } = await params;
  const question = await publicQuestion(id);
  // Local demo state is never emitted into search metadata or structured data.
  if (!question && !process.env.NEXT_PUBLIC_SUPABASE_URL) return <QuestionDetail key={id} />;
  if (!question) notFound();
  const answers = await publicAnswers(id);
  const schema = threadStructuredData(question, answers);
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <>{schema && <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: serializeStructuredData(schema) }} />}
    <QuestionDetail key={id} initialQuestion={question} initialAnswers={answers} /></>;
}
