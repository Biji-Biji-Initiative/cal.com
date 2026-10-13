# Onboarding correction: verified work and recovery checkpoint

Date: 2026-10-14. This document is an execution checkpoint, not application
release acceptance. The product contract is committed on the existing branch.
The application commits described below were still local when Desktop Commander
stopped exposing any online devices. Do not mistake this documentation commit
for publication of those application bytes.

## Verified findings

The inspected cal.mereka.dev Deployment serves the old pinned
calcom/cal.com:v6.2.0 image. Its plan-selection screen is not the deployed
Cal.diy enterprise candidate. The candidate itself nevertheless had a real
commercial-flow defect: onboarding-v3 selected a paid team-plan chooser whose
team route is absent. Organization membership also skipped personal setup.
The mother-agent calendar-reference authorization commit 246c07c3 is an ancestor
of the candidate; that work and its task evidence were not lost.

The live ingress still applies legacy forward-auth to the public booking-path
namespace. An anonymous request to a nonexistent /org/.../team/... path redirected
to the identity provider. Native staff authentication and anonymous guest booking
must be reviewed together during candidate deployment. No live security boundary
was disabled to conceal the screenshot.

## Work preserved on g2

Existing checkout: `/data/worktrees/cal.com/cal-delivery-20261013`.
Task scratch: `/data/tmp/cal-onboarding-20261014`.

Four local commits based on published `90b5d6ec1c9197bdbc07a29632db4584f7956fc7`:

- `d1aaa18f`: supported plan-free onboarding paths, retained setup components,
  compatibility redirects and translations.
- `fde22694`: await initial completion writes, surface errors, and constrain
  browser return hints to supported local destinations.
- `972637ef`: source/config/browser tests and existing runner integration.
- `4c76854e22561bae0cb1f08ecb9ff2c3e4f6c6e9`: product delivery contract.

These commits cover 19 files. Subsequent uncommitted edits affect only
`tests/community-enterprise/onboarding-browser-journey.cjs`, correcting the
schedule-ownership assertion and strengthening timezone selection/screenshot
checks. Do not reset, recreate or discard this checkout or its test artifacts.

The local application uses the retained five-step profile/calendar/conferencing/
availability/profile-completion components. Historical flags and persisted plan
choices cannot restore the chooser. Team/org aliases lead to implemented,
authenticated management rather than removed checkout routes. Membership and
roles are not granted by onboarding; operator organization bootstrap is still
required separately. The inactive organization no-op hook is not an accepted
provisioning implementation.

## Completed verification, before the interruption

The production-code onboarding suite passed 37 tests. Substituting the earlier
path/organization decisions made seven fail. The actual Next config loader's two
tests passed, including all six compatibility redirects. Full native web type
checking passed. The enterprise regression command passed 387 tests with no
failures or skips. Immutable installation, generation, app registry, tRPC and the
optimized standalone build completed; lockfile remained unchanged.

Built application source: `4c76854e22561bae0cb1f08ecb9ff2c3e4f6c6e9`.
Local test origin: `http://127.0.0.1:38917`.
Build ID: `EArBPwy3cHrM0Pay-jRXu`.
Build-manifest SHA-256:
`05cd7e472fc93723edb91bde21c231bdc12ca5e1cd1d766087051ebbf66d4ba5`.
This is not a cal.mereka.dev deployment image or registry receipt.

One actual first-run Chromium/NextAuth/PostgreSQL journey passed. It used a TLS
OIDC test issuer, an unconfigured linked user, the old onboarding-v3 flag, old
organization-plan data in localStorage and IndexedDB, and an old checkout return
hint. It reached plan-free setup, saved the name, skipped external calendar and
conferencing deliberately, saved availability, completed the profile and reached
real event management. Readback proved three default event types, an owned default
schedule, completedOnboarding=true, USER role and zero memberships. Old team/org
URLs reached management, anonymous staff-setup access reached login, and no
browser checkout request was made. External providers were NOT validated.

The initial browser assertion incorrectly queried Availability.userId; actual
availability belongs to the user through Schedule. The corrected owned-schedule
join passed without changing application logic. Its successful log is preserved
as `onboarding-browser-schedule-pass.log`; the temporary PostgreSQL stop was read
back. The original failed attempt remains in `onboarding-browser.log`.

Security: changed files passed Gitleaks except one unchanged locale translation-key
finding, verified identical to the original locale scan. UBS reported a critical
heuristic on a public URL-origin comparison alongside username/password URL
rejection, not a secret-content comparison. These findings are unsuppressed and
are not represented as a clean whole-repository or image assessment.

## Last operation: outcome not verified

The browser test was then strengthened to explicitly select Kuala Lumpur and
assert stored Asia/Kuala_Lumpur. Its first selector used the IANA text rather than
the UI's observed accessible label, `Kuala Lumpur GMT +8:00`; the diagnostic
screenshot confirmed the real option. The selector-correction script is
`use_timezone_accessible_label.py` in the task scratch.

The final command attempted to preserve that diagnostic log, apply the corrected
selector, run Biome and repeat the browser test. Desktop Commander timed out and
then reported every device offline. It is UNKNOWN whether that last command ran
or finished. Inspect the current source, log and process state before retrying.
Do not claim the explicit timezone-selection test or its latest cleanup passed.
The team-booking regression on this newer application build was not yet run.

## Recovery order

1. Read the existing checkout HEAD/status, last test log and owned processes.
   Confirm the current selector and any still-running fixture before another
   process can bind the same test port. Preserve the earlier successful log.
2. Finish the explicit timezone test, then the existing team journey against the
   same application bytes. Do not weaken an assertion merely to obtain success.
   Test-only changes need separate provenance; never relabel the build source.
3. Fetch the current public branch. The product contract was published directly
   while the remote machine was unavailable, so the local history and public
   branch now diverge. Reconcile the owned documentation and retain the local
   application commits; no force push, history deletion or replacement repository.
4. Apply the prepared graph/README/evidence changes after reviewing their current
   preconditions. Scripts `write_acceptance_record.py`, `reconcile_product_graph.py`
   and `focus_product_execution.py` were prepared but NOT executed. Their exact-HEAD
   assertions may need adaptation after a documentation-only merge, with explicit
   proof that application bytes remain the built revision. Retain all 39 IDs,
   dependencies, prior evidence and milestones; strengthen first-user acceptance
   and prioritize real operator organization provisioning. No milestone is closed.
5. Run the graph and relevant regressions, publish the application and evidence on
   the existing branch, verify file hashes and record the actual branch head in
   issue #78. Only then call this code published. Archive receipts and stop owned
   fixtures. The user's original screenshot and private drafts are not public
   source artifacts.

No live account, membership, database, provider, domain, deployment, registry
permission or production resource changed in this tranche. TASK_GRAPH.json is
still unchanged by this interrupted tranche; the committed product contract
references it rather than creating another executor. Earlier GHCR/security/
migration gates remain open. The latest user direction is careful phase-by-phase
delivery, not a deadline-driven bypass.
