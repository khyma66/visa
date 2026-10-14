import { CommunityPage } from '@/components/CommunityPage';

export const metadata = { title: 'Visa community' };
export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommunityPage key={slug} slug={slug} />;
}
