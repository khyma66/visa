import type { Metadata } from 'next';
import { QuestionDetail } from '@/components/QuestionDetail';
import { publicAnswers, publicQuestion } from '@/lib/public-server';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const question = await publicQuestion(id);
  return question ? { title: question.title, description: question.body.slice(0,160) } : { title:'Community question' };
}

export default async function QuestionPage({ params }: Props) {
  const { id } = await params;
  // Imported/demo records have a separate source and remain client-loaded in preview.
  if (id.startsWith('apify-') || !process.env.NEXT_PUBLIC_SUPABASE_URL) return <QuestionDetail key={id} />;
  const question = await publicQuestion(id);
  if (!question) notFound();
  const answers = await publicAnswers(id);
  return <QuestionDetail key={id} initialQuestion={question} initialAnswers={answers} />;
}
