'use client';

import Link from 'next/link';
import { Bell, MessageCircle } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useNotifications } from './NotificationProvider';

export function NotificationLinks() {
  const { user, loading } = useAuth();
  const { data, error } = useNotifications();
  if (loading || !user) return null;
  return <nav className="header-notifications" aria-label="Notifications And Messages">
    {[
      { href: '/notifications', label: 'Notifications', count: data.unreadNotifications, Icon: Bell },
      { href: '/messages', label: 'Messages', count: data.unreadMessages, Icon: MessageCircle },
    ].map(({ href, label, count, Icon }) => <Link key={href} href={href} className="notification-icon" title={error ? `${label} · Unread Status Unavailable` : label} aria-label={count > 0 ? `${label}, ${count} unread` : error ? `${label}, unread status unavailable` : label}>
      <Icon size={21} aria-hidden="true" />
      {count > 0 && <span className="notification-dot" aria-hidden="true" />}
    </Link>)}
  </nav>;
}
