import { CommunityPage } from '@/components/CommunityPage';
import { publicPageMetadata } from '@/lib/search-metadata';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Client-rendered hubs need a substantive public rendering review before indexing.
  return publicPageMetadata(`/c/${encodeURIComponent(slug)}`, 'Visa Community', 'A VisaThreads community for U.S. visa questions and experiences.', {}, false);
}
export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommunityPage key={slug} slug={slug} />;
}
