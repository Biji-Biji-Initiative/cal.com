# Plan-free first-run acceptance and product correction

Date: 2026-10-14. Tested code: `4c76854e22561bae0cb1f08ecb9ff2c3e4f6c6e9`.
Canonical repository/branch and the existing 39 task identities remain unchanged.
The source branch is Cal.diy-based; the served dev image was separately confirmed
as the retained calcom/cal.com:v6.2.0 image. These are different artifacts.

## Cause, not a cosmetic price-label edit

The owner's screenshot showed the old deployed plan chooser. The candidate also
contained a real defect: its onboarding-v3 flag selected a priced plan screen and
its team option linked to a route removed from the distribution. Separately,
organization membership could bypass the staff member's own calendar setup.
Those routes were not evidence of implemented enterprise entitlement.

The calendar-reference ownership repair at 246c07c3 is included in this history;
its ancestry was verified. Its narrow authorization evidence remains valid and
preserved. It did not establish onboarding, organization provisioning or a deployed
enterprise release. The accepted corrected strategy is explained in
PRODUCT-DELIVERY-CONTRACT-2026-10-14.md and grouped within TASK_GRAPH.json.

## What changed

The existing Cal.diy profile/calendar/conferencing/availability components now form
one supported first-run path at /getting-started. The modern entrypoint and old
personal/team/organization URLs have explicit compatibility destinations. Historical
onboarding flags and browser purchase drafts cannot reintroduce hosted checkout
or removed routes. This is not a new scheduler, second wizard, license bypass or
subscription system. The inactive org-creation no-op is explicitly not accepted
as provisioning and must not be reactivated as-is.

Organization members still configure their own profile and availability. Invitation
acceptance and role assignment remain separate server-authorized operations. The
onboarding change creates no organization, membership or administrator entitlement.
Default calendar/conferencing skips are preserved; no skipped provider is claimed
connected. Attendee payment integrations and third-party notices are untouched.

Completion waits for the fresh event query and initial default-event writes before
saving the completed flag and navigating. The current form refuses a duplicate
click while pending and surfaces read/create/save errors. This is not a new atomic
cross-resource onboarding transaction or cross-tab exactly-once guarantee; partial
initial templates from failed provider/transport work still need normal review.
Existing event types are not overwritten. Browser return hints are restricted to
supported local paths: external schemes, removed purchase flows and setup loops
fall back to /event-types while local invitation paths remain available.

## Executed evidence

| Check | Result and boundary |
| --- | --- |
| Production-code onboarding contract suite | 37 pass, 0 failures/skips; explicit framework/transport doubles |
| Historical source negative | 7 failures when prior path/organization decisions are substituted; source restored/unchanged |
| Native Next configuration | 2 tests pass; actual loader validates six compatibility rules |
| Full native web type check | Exit 0, actual candidate dependencies |
| Immutable install, generation, registry, tRPC and optimized web build | All exit 0; lock unchanged |
| Built-browser first-run journey | Exit 0; real Chromium, native NextAuth exchange, TLS test issuer and real PostgreSQL |
| Build ID | `EArBPwy3cHrM0Pay-jRXu` |
| Build manifest SHA-256 | `05cd7e472fc93723edb91bde21c231bdc12ca5e1cd1d766087051ebbf66d4ba5` |
| Build origin | `http://127.0.0.1:38917` (local test artifact, NOT a public deployment image) |

The browser starts with an unconfigured linked user and the old onboarding-v3 flag
enabled. It deliberately populates both localStorage and IndexedDB with obsolete
organization-plan state and a checkout return hint. The old entry URL leads to
"Set up your calendar", without a plan-selection step. The browser saves profile
settings, explicitly skips calendar/conferencing providers, saves availability,
finishes profile setup and reaches actual event management.

Database readback proves the saved name, completed flag, default availability,
three initial event types and unchanged USER role, with no memberships minted.
The old team/org URLs reach existing authenticated enterprise-team management,
not a checkout or false success. Anonymous users still reach login. No browser
checkout request was issued. This is a synthetic local journey, not live Authentik,
Google/Microsoft integration, multi-host scheduling or deployed enterprise acceptance.

The existing four-identity Playwright specification was updated to the supported
path; that separate full fixture suite was not executed here. The current source
regression command was run separately; see the issue handover for its exact count
and final repeat. Counts overlap and must not be added as unrelated end-to-end
scenarios. Screenshot evidence on g2 uses a synthetic identity and is not a capture
of the live service.

## Security and preservation

Biome error-level checks pass on changed code. The bounded return helper passes
native type checking. UBS on three routing/auth modules reports one critical-level
heuristic and five informational findings: the flagged equality compares a public
URL origin with a fixed sentinel and refuses URL credentials; it does not compare
a secret value. The finding remains unsuppressed, not a clean-UBS claim.

Gitleaks passes on the changed source/test/config/doc files except the existing
locale file. Its one flagged translation-key match is byte-for-byte identical to
the baseline finding beside the two-factor-authentication strings. Neither new
onboarding translation adds that finding. The full locale scan remains non-clean
and the redacted baseline comparison is retained. No tokens or credentials were
printed or added, no application dependency/schema changed, and no restricted
historical implementation or private product draft was imported.

## What is not finished

The candidate has not been deployed in this tranche. Live dev still uses the old
image and blanket forward-auth, which also authenticates the public booking path.
Native staff login and anonymous guest routing need a reviewed deployment cutover;
we did not remove the live boundary while the legacy service still runs.

Operator-authorized first-organization and membership provisioning remains open:
TeamService works within existing organizations; account linkage does not create
them. The visible account-settings upgrade banner and dormant onboarding helpers
must be included in the next surface audit rather than called fully removed by
this first-run fix. All advertised actions need implemented server-side outcomes.

Previously recorded GHCR publisher permissions, unresolved image findings, real
identity lifecycle, legacy migration/restore and dev/staging/production acceptance
remain separate release gates. No live database, user, membership, credential,
provider, domain, infrastructure or production change occurred. The earlier
explicit-deadline request is superseded by the owner's current phase-by-phase
quality direction; no security or preservation requirement is waived.

Reproduce after the normal dependency setup and an appropriately local web build:

```sh
node --test tests/community-enterprise/onboarding-contract.test.cjs
yarn test:community-enterprise:build-config
yarn workspace @calcom/web type-check:ci
yarn test:community-enterprise:onboarding --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

Use the existing private-socket database runner, not an application database URL.
The test closes its browser/Next/IdP/SMTP resources and the runner stops/removes
its own disposable PostgreSQL. Real-provider delivery remains a separate phase.

## Final recovery and regression readback

The direct Desktop Commander link to g2 became unavailable. The existing configured
SSH route from the connected operator laptop restored ordinary authorized access;
no credentials, network controls or agent settings were changed. Before rerunning,
the previous log and stopped PostgreSQL process were checked. The earlier unknown
last command had not completed the timezone selector correction.

The final browser test now actively selects the visible Kuala Lumpur option and
verifies the stored canonical Asia/Kuala_Lumpur timezone. The retained select
component exposes the city text rather than the option-role selector assumed by
the first extra test. Those failed selector attempts remain recorded; no application
change or weakened database assertion was needed. The final browser run passes
and its temporary PostgreSQL stops. Its test-only correction has separate commit
provenance from the built application source shown above.

The existing native team-booking journey was also rerun against the same built
application and passed. It exercises the prior team/member/public-booking lifecycle
and retained multi-host checks with the real local database, TLS test issuer and
SMTP sink. It seeds an already-configured organization: this is regression proof,
not proof that first-organization provisioning has been implemented. Its application,
IdP, SMTP and database fixtures are stopped by the retained runner. External
calendar providers, actual Authentik and the deployed service remain unverified.

The public product/recovery documentation and local application commits are
reconciled without force-pushing or losing either history. The graph's ready-work
order now starts with CAL-05.CORE: real operator-authorized workspace/bootstrap
and the complete staff/admin/guest journey. All 39 existing task IDs, prerequisites,
previous evidence, states and milestones remain. Acceptance is strengthened; no
release or deployed milestone is closed. The 19 graph regression cases include
phase-group references to the canonical task identities.
