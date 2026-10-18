import { TagDirectory } from '@/components/TagDirectory';
import { publicPageMetadata, type SearchParameters } from '@/lib/search-metadata';
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParameters> }) {
  return publicPageMetadata('/tags', 'Browse Visa Question Tags', 'Browse U.S. visa topics and find related questions and experiences.', await searchParams, false);
}
export default function TagsPage(){return <TagDirectory/>;}
