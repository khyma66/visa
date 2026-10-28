import Link from 'next/link';
import { publicPageMetadata } from '@/lib/search-metadata';
export function generateMetadata() { return publicPageMetadata('/countries', 'U.S. Community', 'VisaThreads currently focuses on U.S. visa questions and community experiences.'); }
export default function CountriesPage() {
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12 leading-7"><h1 className="text-3xl font-bold">U.S. Community</h1><p>Find questions, shared experiences, and resources for your U.S. visa journey. VisaThreads currently focuses on United States visas.</p><Link href="/us" className="block rounded-xl border bg-white p-5 font-bold text-blue-700">Explore the United States Visa Community</Link><p className="text-sm text-slate-600">A country community describes the topic of discussion, not your citizenship or residence. Selecting one does not change your privacy rights or guarantee that data is stored in that country.</p></main>;
}
