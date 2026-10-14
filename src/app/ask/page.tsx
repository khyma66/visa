import type { Metadata } from 'next';
import { AskQuestionForm } from '@/components/AskQuestionForm';

export const metadata: Metadata = { title: 'Ask a visa question' };

export default function AskPage() {
  return <AskQuestionForm />;
}
