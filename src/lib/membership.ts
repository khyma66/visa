/** Product definitions, not billing entitlements. Never authorize an API with this catalog. */
export const MEMBERSHIP_PLANS = [
  { id: 'free', name: 'Community', description: 'Keep essential community knowledge accessible.', features: ['Browse and contribute to discussions', 'Read official-resource guides', 'Report unsafe or misleading content'] },
  { id: 'premium', name: 'Premium', description: 'Organize your research with less distraction.', features: ['Ad-free browsing', 'Saved collections and comparison notes', 'Personal checklists and export', 'Opt-in topic digests'] },
  { id: 'pro', name: 'Pro', description: 'Follow complex research across topics.', features: ['Everything in Premium', 'Saved searches and change alerts', 'Expanded source-linked summaries within usage limits', 'Cross-topic research workspace'] },
] as const;

export const MONETIZATION_REVIEW_THRESHOLD = 10_000;
// Deliberately not environment-variable switches: integration and launch review
// are required before a future release can enable either provider.
export const COMMERCE_CAPABILITIES = Object.freeze({ checkout: false, advertising: false, paidEntitlements: false });

export function monetizationReview(verifiedActiveMembers: number) {
  const valid = Number.isSafeInteger(verifiedActiveMembers) && verifiedActiveMembers >= 0;
  return { reviewDue: valid && verifiedActiveMembers >= MONETIZATION_REVIEW_THRESHOLD, ...COMMERCE_CAPABILITIES };
}

/** Layout policy only. No request, targeting data, script or provider is loaded. */
export function inlineAdPositions(postCount: number): number[] {
  if (!Number.isSafeInteger(postCount) || postCount < 8) return [];
  // At most two per 20-row page, never first/last, at least seven posts apart.
  return [7, 15].filter(position => position < postCount);
}

export type ResearchItem = { url: string; title: string; checked: boolean };
export function researchItem(title: string, url: string): ResearchItem | null {
  try {
    const parsed = new URL(url);
    const safeHost = ['visathreads.com', 'www.uscis.gov', 'travel.state.gov'].includes(parsed.hostname);
    if (!safeHost || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !title.trim()) return null;
    return { title: title.trim().slice(0, 160), url: parsed.href, checked: false };
  } catch { return null; }
}
