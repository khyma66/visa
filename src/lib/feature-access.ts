/** UI rollout switches, NOT authorization. Paid endpoints must enforce trusted
 * server-side billing entitlements before any Premium/Pro rollout. Never use
 * editable user metadata to establish a subscription. Core safety stays free. */
export const featureAccess = Object.freeze({
  directMessaging: true,
  postSharing: true,
  postLibrary: true,
  premiumSavedSearches: false,
  proWorkspace: false,
});
