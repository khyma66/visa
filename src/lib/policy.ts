// Bump the version and retain the old published text whenever the terms change.
export const POLICY_VERSION = '2026-10-06-preview-v2';
export const POLICY_UPDATED = 'October 6, 2026';
export const SUPPORT_EMAIL = 'varunchinna5966@gmail.com';
export const MINIMUM_AGE = 18;
export const POLICY_MARKET = 'US';

export function acceptanceInput(userId: string, terms: boolean, privacy: boolean, adult: boolean) {
  if (!terms || !privacy || !adult) throw new Error('Please confirm the community acknowledgement.');
  return { user_id: userId, policy_version: POLICY_VERSION, market: POLICY_MARKET, terms_accepted: true, privacy_acknowledged: true, adult_confirmed: true };
}
