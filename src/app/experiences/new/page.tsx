import type { Metadata } from 'next';
import { AskQuestionForm } from '@/components/AskQuestionForm';
export const metadata: Metadata = { title: 'Share your visa experience', robots: { index: false, follow: false } };
export default function NewExperiencePage() { return <AskQuestionForm experience />; }
