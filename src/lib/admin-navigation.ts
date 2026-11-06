export const ADMIN_SECTIONS = [
  { id: 'analytics', label: 'Overview & analytics' },
  { id: 'members', label: 'Members & signups' },
  { id: 'reports', label: 'Reports & moderation' },
  { id: 'security', label: 'Security' },
  { id: 'launch', label: 'Launch & experiments' },
  { id: 'feedback', label: 'Feedback inbox' },
] as const;
export type AdminSection = typeof ADMIN_SECTIONS[number]['id'];
export const adminHref = (section: AdminSection) => `/admin?section=${section}`;
export function adminSection(value: string | null): AdminSection {
  return ADMIN_SECTIONS.find(section => section.id === value)?.id ?? 'analytics';
}
