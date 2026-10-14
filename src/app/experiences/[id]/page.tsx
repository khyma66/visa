import type { Metadata } from 'next';
import { QuestionDetail } from '@/components/QuestionDetail';
import { publicAnswers, publicQuestion } from '@/lib/public-server';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const question = await publicQuestion((await params).id);
  return question?.post_kind === 'experience' ? { title: question.title, description: question.body.slice(0,160) } : { title: 'Visa experience' };
}
export default async function ExperiencePage({ params }: Props) {
  const { id } = await params;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <QuestionDetail key={id} />;
  const question = await publicQuestion(id);
  if (!question || question.post_kind !== 'experience') notFound();
  return <QuestionDetail key={id} initialQuestion={question} initialAnswers={await publicAnswers(id)} />;
}
