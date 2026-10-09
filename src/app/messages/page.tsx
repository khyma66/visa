import type { Metadata } from 'next';
import { MessagesClient } from '@/components/MessagesClient';

export const metadata: Metadata = { title: 'Private messages' };
export const dynamic = 'force-dynamic';

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ to?: string | string[]; member?: string | string[] }> }) {
  const params = await searchParams;
  const recipientUsername = typeof params.to === 'string' ? params.to.slice(0, 80) : '';
  const recipientMemberId = typeof params.member === 'string' ? params.member.slice(0, 80) : '';
  return <MessagesClient key={`${recipientUsername}:${recipientMemberId}`} recipientUsername={recipientUsername} recipientMemberId={recipientMemberId} />;
}
