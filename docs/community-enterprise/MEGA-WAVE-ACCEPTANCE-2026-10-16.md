# Integrated native application acceptance — 16 October 2026

Repository: Biji-Biji-Initiative/cal.com. Branch:
work/cal-diy-enterprise-20261010. Task graph: TASK_GRAPH.json; delivery issue #78.
The [machine-readable receipt](MEGA-WAVE-RECEIPT-2026-10-16.json) preserves the
exact identities, outcomes and hashes of the retained raw evidence.
This wave integrates the preceding owners' implementation, including the native
role transport and source-bound runtime preparation repairs. It adds test
coverage and truthful graph completion; it does not claim their code as new work.

## Exact tested subjects

| Subject | Identity |
| --- | --- |
| Local application and native API source | `167f457dfe1004d897144c2c6323c23df240a8c7` |
| Current test/runner source | `fc02e571df63ee3278680bff340f47a1e1d628e2` |
| Local browser build ID | `lU8Gd2j2pm5ibfjHrcqdc` |
| Local browser manifest SHA-256 | `aceeac49539300f19ac4793c82c13b30d6acebc94bf439d1e13aeb3bd85d0aed` |
| Compiled API main SHA-256 | `9fd306de7b8ddf7b14516609c25b1a26c7b806bb7dfe277c0376aa43b93f5df0` |
| Immutable dependency-lock SHA-256 | `cf5d55e96d254c4a0483728a96c47493b974a530c9247cf1f2ac2b0e652c8258` |
| Local browser origin | `http://127.0.0.1:38917` |

The two intervening CopperRidge fixes (Tasker fixture SQL helpers and a pinned
embed build dependency) were preserved. Actual immutable installation, generation,
native tRPC/web types, optimized Next build, native platform/API compilation and
full AppModule startup all passed. No authentication/compiler mock was substituted
for those builds. Existing dependency, export-condition and Prisma deprecation
warnings are not claimed resolved.

The later source commit changes seven **test/fixture/graph-test** files only; it
does not alter application, schema or dependency bytes. Tests continue to identify
the actual existing compiled source. The HTTPS-origin artifact is independently
rebuilt on the newer exact source, not assigned a newer label after compilation.

## Existing and additional journeys

All **nine existing assembled web journeys pass** on the same local build:
organization admission, first-user onboarding, invitation consent, member
lifecycle, custom roles, shared scheduling handoff, calendar-provider lifecycle,
Tasker recovery and team/guest/multi-host booking. Every test has its owned
PostgreSQL stop receipt. These remain local synthetic identities, real native
sessions/PostgreSQL, non-relaying SMTP and explicitly intercepted provider HTTP.

The full compiled API also passes its real main/AppModule/bootstrap checks with
isolated PostgreSQL and Redis: healthy startup, personal profile, native cookie
and scoped key handling, rotation/audit and rejection of the revoked cookie/old
key. Docker supplies already-present runtime images only; the current compiled
API is mounted read-only. This is not a newly packaged or deployed API image.

Additional executed UI cases close gaps in the previous acceptance:

- A second organization is created through the native admitted service. Actual
  keyboard Home/ArrowDown/Enter selects each organization; the other workspace's
  team heading and membership controls disappear and return with the correct
  selection. Accessible naming and current-owner denial remain asserted.
- An operator signs in through the fixture identity provider and uses the real
  review/provision service to admit a fresh existing staff account. That accepted
  MEMBER then completes personal timezone/profile/availability setup despite
  stale organization-purchase drafts and the old onboarding flag. The existing
  membership/profile is preserved and default events remain personal. No SQL
  secretly creates the organization or its membership behind this success.
- The ordinary unassociated-user onboarding case is rerun as a negative contrast:
  setup creates no organization membership. Neither case attempts hosted checkout
  or obtains authority from a subscription/marketing selection.
- Invitation confirmation binds to the actual UI mutation's returned ID and
  reads that exact item from the native inbox response before asserting display.
  Accepted, declined, cancelled, stale-button denial and failed SMTP-submission
  semantics are all retained.

The product contract explicitly allows skipping optional calendar/conferencing
connection steps. The onboarding tests exercise those actual screens and skip
controls and **do not report a skipped connection as verified**. Provider adapter
lifecycles are separately exercised through their synthetic network boundary.
This is bounded keyboard/accessible-name coverage, not a comprehensive external
accessibility certification or live provider OAuth acceptance.

## The invitation failure was not waived

The previous isolated integration stopped at invitation-3 after a five-second
render assertion, leaving later suites unexecuted. The unchanged original test
passes in this wave; that alone does not establish the old run's exact slowness
cause. A discriminating control delays the actual inbox GET by six seconds and
reproduces the original failure. The revised test waits for the real server
response, verifies the exact committed invitation, then retains the same
five-second render assertion. The same delay passes with all permission and
consent checks intact. There is no blanket timeout increase, fabricated response,
application policy change or claimed production performance repair.

## Source and test acceptance

The registered source suite passes **570 cases with zero failures/skips**,
including 25 graph and 39 onboarding/source/runner cases. The actual role database
suite passes **53 cases**, including real lock wait, current-owner removal,
atomic audit failure, exact scope, directory provenance, historical replay and
personal-resource preservation. Four extended browser invocations pass; these
include reruns of existing journeys and are not four separate new products.

The new accepted-member runner flag refuses unrelated suites before database
setup; it cannot silently alter another fixture. Node/Python syntax and scoped
Biome checks pass. Gitleaks reports zero findings across all seven changed test
and runner files. UBS reports two critical heuristics, two warnings and six
information findings on the existing database runner: the test-selector string
contains API-key words, argv-based child execution consumes explicit allowlisted
environment, and existing package-JSON reads fail closed on malformed input.
The six added lines only validate/set a test boolean; none enables a shell or
imports deployed configuration. Findings remain recorded and unsuppressed; this
is not a whole-application or image security clearance.

Graph tests now model unfinished CORE explicitly instead of requiring actual
project work to stay unfinished. New controls verify that accepted CORE makes
its existing UI/SCIM children runnable without completing a release, and that UI
source evidence alone cannot satisfy the runtime prerequisite. The production
graph verifier itself and every original requirement/dependency are unchanged.

## Task decisions at their original scope

**CAL-05.CORE: source_proven.** Retained Team/Membership/Profile/Role models have
actual organization/team creation, existing-account admission/invitations and
consent, built-in and supported exact-scope custom roles, last-owner protection,
provenance, audit and idempotency. It remains a deliberately limited two-permission
custom read catalogue, not unrestricted imported/write/agent rights. Full directory
lifecycle and broader resource authorization stay on SCIM/API/route tasks.

**CAL-05.UI: runtime_proven for the assembled routine administration UI.**
Organization switching, team/member controls, event ownership, current denied
states, real provisioning, keyboard confirmation and fresh accepted-member
personal setup satisfy its unchanged UI requirements. Optional provider skipping
follows the already accepted product contract, not a new waiver. Live deployment,
real enrollment/IdP, external delivery/provider permission, replica revocation and
migration remain separate release requirements. Neither this closure nor a local
build completes the first shared-preview staff-to-guest milestone.

These two closures move the original graph from **10 to 12 of 29 executable
tasks**, leaving **17**. All 39 original nodes, prior evidence, acceptance text,
required levels, dependencies, milestone boundaries and concurrency settings are
preserved. Counts are unweighted work records, not a readiness percentage.

## Public-origin artifact and release boundary

The new HTTPS-origin image is `sha256:e57cd80124e6bf18fed5398d5f4a874637a06fcdd172eb7e3cc2ebe02234d514` with build ID
`mWs-lMnuzoe4xV--OxtBj`, built from `fc02e571df63ee3278680bff340f47a1e1d628e2` for
`https://cal.mereka.dev`. It is a **local artifact, not a published registry
digest or deployed preview**. The Dockerfile and entrypoint hashes are in the
source-bound image receipt. The earlier loopback build was not retagged as this image.

Native container admission exit: `0`.
Migration count: `596`
against the exact source migration-file count. The existing rootless/read-only
fixture checks explicit migration/replay, the native provider and HTTPS callback,
login rendering without loopback-origin leakage and absent anonymous staff session.
These are container admission checks, not the live Authentik or staff-booking journey.

The pinned Trivy 0.75.0 scan completed with exit `0` and zero CRITICAL findings.
Reported severities: `{"HIGH": 113, "LOW": 66, "MEDIUM": 143, "UNKNOWN": 3}`.
Secret findings: `0`.
The scanner's critical/secret floor does not resolve HIGH findings or authorize
release. No image finding was silently waived and no publication was attempted.

Independent readback from the actual read-only image matches its prepared build
manifest and source/entrypoint/migration-preflight hashes. The image retains 772
license notices and three recorded dependency-trace warnings. The exact created
container and network IDs are now absent, and the private database stopped before
its temporary directory was removed. This is fixture cleanup, not retirement of
any pre-existing service, namespace or database.

Fresh read-only cluster metadata found the existing dev/staging workloads healthy
but still serving the retained v6.2.0 application and auth proxy, not the enterprise
candidate. An initially failed readiness probe was retained; the same supported
wrapper's bounded readiness retries then completed the observations. A separate
nonprod names-only read found that the five native CAL_AUTHENTIK configuration
keys are not in the inspected Cal environment sources; existing session/encryption
key names remain present. The legacy callback-base and auth proxy are still in
place. This is expected legacy configuration, not a native cutover. No decoded
secret values, live account rows or provider contents were exported or changed.
It is not permission to repoint or migrate an existing legacy database.

The real-user package route remains unauthorized. The existing Actions publisher
has its own declared package capability, but its old Dockerfile/placeholder-origin
path is not this accepted prepared context. The existing programme-owner request
must supply the approved publisher, then a registry digest and admitted preview
identity/configuration. No alternate credential, public-runner exception, registry,
repository, DNS route or production promotion was created to bypass that boundary.

## Reproduction

```sh
yarn test:community-enterprise
python3 scripts/run-community-enterprise-postgres.py --suite custom-roles --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
python3 scripts/run-community-enterprise-postgres.py --suite invitation-journey --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
python3 scripts/run-community-enterprise-postgres.py --suite organization-journey --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
python3 scripts/run-community-enterprise-postgres.py --suite onboarding-journey --accepted-organization-member --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node scripts/verify-community-enterprise-task-graph.cjs --status
```

Browser commands require the matching loopback build; do not run them against an
HTTPS-origin bundle and call an origin failure a product regression. The actual
commands, separate source/build/image identities, controlled negative, full logs,
container/scanner outcomes and cleanup receipts are retained privately at
`/data/tmp/cal-megawave-20261016-0qrxyb3f` on g2. No real staff, calendar, participant,
production data, identity secret, deployment or namespace changed in this wave.

Agent: ChatGPT-CalMegaWave-20261016

The full-graph metadata scan retains two pre-existing generic-api-key matches
on documented image identifiers; their containing lines are unchanged from the
parent. They are not newly supplied credentials, and no scanner suppression or
graph-wide clean claim is used. The new report and index pass their own scan.
