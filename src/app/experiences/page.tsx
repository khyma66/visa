import { CommunityHome } from '@/components/CommunityHome';
import { publicPageMetadata, type SearchParameters } from '@/lib/search-metadata';
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParameters> }) {
  return publicPageMetadata('/experiences', 'U.S. Visa Experiences', 'Read community accounts of U.S. visa interviews, applications, travel, and timelines. Individual experiences are not predictions.', await searchParams, false);
}
export default function ExperiencesPage() { return <CommunityHome key="experiences" experience />; }
