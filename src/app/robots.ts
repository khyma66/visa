import type { MetadataRoute } from 'next';
import { publicRobots } from '@/lib/search-visibility';

// Runtime approval can change without making a cached preview crawlable.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return publicRobots();
}
