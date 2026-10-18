import { ExploreCommunities } from '@/components/ExploreCommunities';
import { publicPageMetadata, type SearchParameters } from '@/lib/search-metadata';

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParameters> }) {
  return publicPageMetadata('/explore', 'Explore Communities', 'Find U.S. visa communities and public discussions by topic.', await searchParams, false);
}
export default function ExplorePage() { return <ExploreCommunities />; }
