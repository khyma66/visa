import { notFound } from 'next/navigation';
import { AssistantPanel } from '@/components/AssistantPanel';

export const metadata = { title: 'Ask VisaThreads', description: 'Find answers and catch up on VisaThreads discussions with linked evidence.' };

export default function AssistantPage() {
  if (process.env.NEXT_PUBLIC_SITE_URL !== 'https://visathreads.com') notFound();
  return <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
    <p className="text-xs font-bold uppercase tracking-wide text-teal-700">Your community, easier to follow</p>
    <h1 className="mt-3 text-3xl font-bold text-slate-950">Ask VisaThreads</h1>
    <p className="mt-3 text-sm leading-7 text-slate-600">Find relevant experiences, understand the discussion, and see what remains uncertain. Each supported answer links back to the posts and replies it uses.</p>
    <AssistantPanel scope={{ kind: 'public' }} defaultOpen />
  </main>;
}
