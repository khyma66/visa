import { OfficialNewsFeed } from '@/components/OfficialNewsFeed';
import { publicPageMetadata } from '@/lib/search-metadata';

export function generateMetadata() {
  return publicPageMetadata('/news', 'U.S. Visa News & Official Resources', 'Find U.S. visa updates and links to official immigration resources.', {}, false);
}

export default function NewsPage() {
  return <OfficialNewsFeed />;
}
