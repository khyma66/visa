import type { Metadata } from 'next';
import { AskQuestionForm } from '@/components/AskQuestionForm';
import { VISA_TYPES } from '@/lib/post-categories';
export const metadata: Metadata = { title: 'Share your visa experience', robots: { index: false, follow: false } };
export default async function NewExperiencePage({ searchParams }: { searchParams: Promise<{ visa?: string | string[] }> }) {
  const { visa } = await searchParams;
  const selectedVisa = typeof visa === 'string' && VISA_TYPES.includes(visa) ? visa : 'F-1 / OPT';
  return <AskQuestionForm key={selectedVisa} experience initialVisa={selectedVisa} />;
}
