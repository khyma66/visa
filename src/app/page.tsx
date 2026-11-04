import { CommunityHome } from '@/components/CommunityHome';
import { publicPageMetadata, type SearchParameters } from '@/lib/search-metadata';

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParameters> }) {
  return publicPageMetadata('/', 'U.S. Visa Community', 'Explore U.S. visa questions, real community experiences, and source-linked resources on VisaThreads.', await searchParams);
}

export default function Home() {
  return <CommunityHome />;
}
