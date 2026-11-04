import Link from 'next/link';
import { CommunityHome } from '@/components/CommunityHome';
import { publicPageMetadata, type SearchParameters } from '@/lib/search-metadata';

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParameters> }) {
  return publicPageMetadata('/', 'U.S. Visa Community', 'Explore U.S. visa questions, real community experiences, and source-linked resources on VisaThreads.', await searchParams);
}

export default function Home() {
  return <><nav aria-label="Visa destination" className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 pt-4 text-sm"><span className="font-semibold">Visa destination: United States</span><Link href="/us/en" className="text-blue-700 underline">Open U.S. community</Link><Link href="/countries" className="text-blue-700 underline">All destinations</Link></nav><CommunityHome /></>;
}
