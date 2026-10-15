import { notFound } from 'next/navigation';
import { AssistantPanel } from '@/components/AssistantPanel';

export const metadata = { title: 'Ask VisaThreads', description: 'Chat with VisaThreads AI for answers from community discussions.' };

export default function AssistantPage() {
  if (process.env.NEXT_PUBLIC_SITE_URL !== 'https://visathreads.com') notFound();
  return <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
    <h1 className="text-2xl font-bold text-slate-950">Ask VisaThreads</h1>
    <p className="mt-2 text-sm text-slate-500">Your question. A clear answer. Sources included.</p>
    <AssistantPanel scope={{ kind: 'public' }} defaultOpen />
  </main>;
}
