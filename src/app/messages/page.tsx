import type { Metadata } from 'next';
import { MessagesClient } from '@/components/MessagesClient';

export const metadata: Metadata = { title: 'Private messages' };

export default function MessagesPage() {
  return <MessagesClient />;
}
