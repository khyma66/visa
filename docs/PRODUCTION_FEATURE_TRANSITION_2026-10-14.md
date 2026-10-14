# Existing production-site feature transition

The owner authorized integrating the remaining PRs and enabling AI on
`https://visathreads.com`, without AI on `https://visa-central.com`.

The existing public-facing site is an early preview served by `visaflow-dev`.
The feature release preserves that launch state, noindex headers, production
database `cycnichledvqbxevrwnt`, and the separate formal public-launch gates.

## Precisely identified replacement baseline

- Original deployment: `82f636de-0d17-4625-9510-4480c11dc8e0`
- Guarded rollback deployment: `5763d137-9c62-4646-a35b-efbe947cfe65` (same original version at 100%, independently observed at 14:47 UTC after release run `38582002973` restored it at 14:44 UTC)
- Worker version: `879503b4-e947-420e-8ad8-e1f2f7082ae5`
- Reported source commit: `0624c651cb252436c47c5f2b020baecfec0bfbd0`
- Reported source tree: `1e67b513d22bd843ddcb587548feb68e71f0ef92`
- Tracked-source fingerprint: `2b0809b06597008d2f9b911ec76b13648cfb3cefd271bdbe20809c2826762ea7`

The old health metadata reports a clean build but a null site origin. The owned
domain-to-Worker mapping is independently checked through Cloudflare. The
original commit and tree are unavailable through GitHub and existing checkouts;
no exact source-equivalent ancestor has been found. This release is explicitly a
replacement of the pinned version, **not** a claim that its editable source was
recovered or that the replacement is byte-for-byte source-equivalent.

The narrow transition recognizes only either recorded deployment ID together with all of the other identifiers above. The rollback ID was observed through the read-only inventory run `38521061702`, job `115919280072`; it is not inferred from a successful CLI exit.
Other historical builds require normal ancestry or exact tracked-source
equivalence. New deployments must publish the correct site origin and exact
committed source provenance.

## Gates retained

The release requires clean committed `main`, full regression/type checks, the
dependency audit, actual hosted AI acceptance for every enabled mode, production
database compatibility, exact recovered-archive/public-feed parity, and an
unchanged active deployment immediately before upload. The original 563 posts
and 628 replies must remain unchanged after deployment. The captured previous
version is available for rollback, and automated rollback refuses to overwrite a
later unrelated deployment.

`PUBLIC_LAUNCH_APPROVED` and `IMPORTED_CONTENT_APPROVED` remain false. Formal
public launch still requires its existing owner, operational and legal reviews.
Hosted model tests and anonymous-denial checks do not establish a real user's
signed-in browser acceptance; report that result separately.
