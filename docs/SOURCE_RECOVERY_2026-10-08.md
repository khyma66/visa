# Source recovery evidence - October 8, 2026

## Result

The exact editable source of the current VisaThreads deployment has **not been
recovered**. This does not mean the earlier VisaFlow chat or its work is absent.
That exact source is not accessible through the project, history, and account
surfaces checked in this pass. No live deployment was replaced during recovery.

## Checks completed

| Surface | Evidence |
| --- | --- |
| Workspace | The only VisaFlow checkout found under `/workspace` is `/workspace/scratch/68ccf6e22cb8/visaflow`. The sibling `/workspace/scratch/d4752d6329f4` contains StayHub projects, not a recovery copy. No source ZIP or tar archive was found. |
| Local Git | The checkout was cloned on October 6. Its reflog contains the known PR branches. `git fsck --full --no-reflogs --unreachable` found no unreachable objects to recover. |
| GitHub | The branch API for `khyma66/visa` returned seven branches. The newest existing branch checked was `fix/visathreads-login-20261007` at `792146fd9a4b05e900258f9e62a0a4d8bb2de415`; no separate recovery branch was identified. January `main` is not the live source. |
| VisaFlow folder | `/VISAFLOW` contains `Visaflow-production-review.md`, dated September 28, and no source archive or Site. Reading the document confirmed it is an earlier missing-source/security review. |
| Earlier conversation retrieval | Personal Context was unavailable for this conversation. The original implementation chat and any source it retained could not be inspected through that route. |
| Current browser inspection | The live Worker exposes **Experience** at `/experiences` and footer destinations `/cookies`, `/privacy-choices`, and `/countries`. These implementations are absent from the accessible baseline. Earlier handoffs also record newer avatar/privacy work. |
| Hosted database | The read-only migration-ledger check returned 22 migrations, ending with `20261006045212_visa_experiences`. That migration is absent from the accessible baseline; the hosted ledger is not proof of a matching application commit. |

Live site: <https://visaflow-dev.varunchinna5966.workers.dev/>.
The initial HTTP fetch routes were unavailable; the current live-route evidence
above comes from the subsequent browser inspection, not a successful curl check.

## Portability boundary

The accessible PR stack is a valid place to implement and test focused add-ons,
but passing its tests does not establish parity with the deployed application.
Preserve the live header/account behavior, Experience flow, countries, cookies,
privacy choices, avatar changes, and their database contracts when integrating.
Do not replace the live application wholesale with this older baseline or assume
all locally pending migrations should be applied to the hosted database.

The Reddit-style navigation, community discovery/create/join features, login fix,
and post-presentation changes must be reviewed as focused diffs against the
recovered source. Reconcile the hosted migration ledger and rehearse only the
required SQL changes in staging. Local preview verification is not verification
of those missing live features.

## Closure requirements

1. Recover the checkout or source artifact from the original VisaFlow work and
   commit it to a recovery branch without credentials, private archives, or build
   outputs. Alternatively, identify an already-pushed equivalent commit.
2. Record the active Worker version and known-good rollback version. Establish
   the exact source commit that produced the version; a compiled Worker alone is
   not a verified replacement for its editable source.
3. Confirm the recovered source contains the observed live routes and matches
   the hosted database contracts. Integrate reviewed PR deltas there.
4. Run regression, migration, auth, and browser checks on a separate preview;
   record the resulting source commit and Worker version before updating live.

Until these checks pass, source parity and safe live deployment remain open.
