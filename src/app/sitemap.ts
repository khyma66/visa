import type { MetadataRoute } from 'next';
import { publicSitemap } from '@/lib/search-visibility';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  return publicSitemap();
}
