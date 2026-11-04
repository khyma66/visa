import { DESTINATIONS } from '@/lib/destination-routing';
import Link from 'next/link';
import { publicPageMetadata } from '@/lib/search-metadata';
export function generateMetadata() { return publicPageMetadata('/countries', 'Visa destinations', 'VisaThreads currently focuses on U.S. visa questions and community experiences.'); }
export default function CountriesPage() {
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12 leading-7"><h1 className="text-3xl font-bold capitalize">Visa destinations</h1><p className="capitalize">Find questions, shared experiences, and resources for your U.S. visa journey. VisaThreads currently focuses on United States visas.</p>{DESTINATIONS.filter(destination => destination.status === 'available').map(destination => <Link key={destination.code} href={`/${destination.code}/${destination.languages[0]}`} className="block rounded-xl border bg-white p-5 font-bold text-blue-700 capitalize">Explore the {destination.name} Visa Community</Link>)}<p className="text-sm text-slate-600 capitalize">A country community describes the topic of discussion, not your citizenship or residence. Selecting one does not change your privacy rights or guarantee that data is stored in that country.</p></main>;
}
