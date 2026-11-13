import { headers } from 'next/headers';
import { serializeStructuredData, siteStructuredData } from '@/lib/search-metadata';

export async function SiteIdentity() {
  const schema = siteStructuredData();
  if (!schema) return null;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: serializeStructuredData(schema) }} />;
}
