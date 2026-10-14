# U.S. preview scope and visual refinement

This is a refinement of the existing VisaThreads preview, not a public-launch
approval. Repository, database, release branch, and domain remain unchanged.

## Presentation

- Preserve the mixed-case VisaThreads wordmark; use orange for the brand/primary
  entry points and active navigation, blue for links, tags and supporting actions.
- Replace all-caps navigation/eyebrows with natural casing. Capitalize interface
  labels and render visa acronyms such as H-1B, H-4, USCIS and EAD correctly.
- Keep members' posts and stored tag identifiers unchanged. Frozen, previously
  accepted policy documents remain byte-for-byte unchanged.
- Main orange/blue accents meet 4.5:1 normal-text contrast against white.

## Current U.S. scope

- Question and community creation fix destination country to United States.
- Community discovery, joined-community selection and duplicate suggestions
  request United States results. News search targets USCIS/U.S. visa subjects.
- Remove Schengen, Canadian visas and generic foreign permits from visa choices.
  Feed filters list only U.S. categories represented by the loaded posts.
- Preserve U.S. re-entry/stamping discussions that mention Canada or Mexico.
  Three misclassified Canadian entries with explicit H-1B/I-94 markers are
  projected as U.S. discussions. One Canadian work-visa post and one ambiguous
  stamping post are omitted from this view.
- Original archive remains 563 posts and 628 comments. The current projected
  feed has 561 posts and 21 tags. No content is deleted. Generic discussions in
  the existing U.S. archive remain; this is not an automated semantic moderation
  guarantee. Suppress the old generic “Global” badge instead of inventing a country.

The presentation helper is not an authorization or country-isolation boundary.
The original archive endpoint remains intact. Existing database access controls,
closed launch gates and disabled AI/payments/ads remain unchanged. Future country
expansion still requires server-side scoping, content review and legal review.

## Verification plan

Run typecheck, full regressions, known-secret scan, preview build and bundle scan.
Check desktop/mobile feed, populated-only filters and read-only country inputs.
After publishing, verify the build commit on the real domain and run archive,
public-read and denied-access smoke tests. Record the exact deployed version below.

## Verified deployment — October 8, 04:46 UTC

- Application commit: `facc2d5c276bd308cf80f4b9ea0c00fad6baa9cd`.
- Worker version: `1f0b0c4e-a4cd-499a-834b-b2a9632f27b2` (`visaflow-dev`).
- Live health reports a clean build and source digest
  `40ce328bdc7961cef61d3878b9346822fb187e529ff660d88579b4e41954dcf6`.
- Full suite: 529 tests passed; final sign-in copy-only correction rechecked with
  all 53 auth tests, typecheck, preview build and 220-file bundle secret scan.
- Live smoke verifies all original archive IDs/comments, 561 projected posts,
  21 tags, successful public reads, denied private messaging/voting access and
  denied anonymous access to all 22 retired legacy tables. No hosted writes.
- Local desktop/mobile visual checks pass; no mobile horizontal overflow.
  Live guest view shows orange/blue branding and the six populated visa choices.
  H-1B filtering returns 294 matching posts; Clear Filters works.
- Live login entry opens correctly and Google/email controls enable. No fresh
  OAuth completion, email/SMS delivery, or policy acceptance performed.
- Existing signed-in browser displayed its account's policy acknowledgement;
  left it untouched and verified the public view in a separate guest browser.
- Consolidation PR #3 references this deployment. Existing preview/launch,
  dependency-audit and legal/operational limitations remain unchanged.
