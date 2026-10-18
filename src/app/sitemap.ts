import type { MetadataRoute } from 'next';
import { publicSitemap } from '@/lib/search-visibility';
import { publicThreadSitemap } from '@/lib/public-server';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = publicSitemap();
  // Preview never contacts the database or enumerates native content.
  if (!pages.length) return [];
  return [...pages, ...await publicThreadSitemap()];
}
