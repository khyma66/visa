import { FeedbackForm } from '@/components/FeedbackForm';

export const metadata = { title: 'Share Feedback', robots: { index: false, follow: false } };
export default function FeedbackPage() {
  return <main className="mx-auto max-w-xl space-y-5 px-4 py-10"><h1 className="text-2xl font-bold">Help Improve VisaThreads</h1><p className="text-sm text-slate-600">Tell us what could work better. Every suggestion goes to the site owner for review.</p><FeedbackForm/></main>;
}
