import Link from 'next/link';
export const metadata = { title: 'U.S. Community' };
export default function CountriesPage() {
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12 leading-7"><h1 className="text-3xl font-bold">U.S. Community</h1><p>Start with the United States community. Other country communities are not open yet.</p><Link href="/us" className="block rounded-xl border bg-white p-5 font-bold text-blue-700">United States · Early access</Link><p className="text-sm text-slate-600">A country community describes the topic of discussion, not your citizenship or residence. Selecting one does not change your privacy rights or guarantee that data is stored in that country.</p></main>;
}
