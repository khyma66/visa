// A market is a community destination, not a claim about a visitor's residence,
// citizenship, legal jurisdiction, or where their data is stored.
export const markets = [{ code: 'us', name: 'United States', locale: 'en-US', currency: 'USD', status: 'preview' }] as const;
export function marketForCode(code: string) {
  return markets.find(market => market.code === code.toLowerCase()) ?? null;
}
export function marketForHostname(hostname: string) {
  // Explicit allowlist. Do not infer a tenant from arbitrary prefixes/headers.
  return ['visathreads.com', 'www.visathreads.com', 'us.visathreads.com'].includes(hostname.toLowerCase()) ? markets[0] : null;
}
export const MONETIZATION_REVIEW_USERS = 10_000;
export function monetizationReadiness(verifiedActiveUsers: number) {
  return {
    reviewDue: Number.isSafeInteger(verifiedActiveUsers) && verifiedActiveUsers >= MONETIZATION_REVIEW_USERS,
    paymentsEnabled: false,
    advertisingEnabled: false,
    marketingEnabled: false,
  } as const;
}
