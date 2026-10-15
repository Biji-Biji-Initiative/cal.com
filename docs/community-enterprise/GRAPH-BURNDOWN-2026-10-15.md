# Acceptance-driven graph burndown — 2026-10-15

Repository: Biji-Biji-Initiative/cal.com. Branch: work/cal-diy-enterprise-20261010.
The original TASK_GRAPH.json remains the only task graph. This wave audits and
closes existing criteria, rather than adding more tasks or relaxing release gates.
No application runtime code, deployment, real account or provider was changed.

## Counts and decisions

**39 records = 10 parent epics + 29 executable tasks.** Before review, five leaves
were complete at their own required evidence level. Three further leaves are now
complete: **eight of 29**, with **21 executable tasks and all 10 parent epics still
unfinished**. These are unweighted record counts, not a claim that 28% of product
work/time is finished. M1, M2 and M3 remain open; no production approval is implied.

Existing completed leaves: CAL-02.INSTALL, CAL-02.BUILD, CAL-03.POLICY, CAL-03.LIST,
CAL-04.OIDC. Newly closed leaves and their unchanged criteria:

### CAL-02.API — runtime_proven

The current platform constants/enums/utils/types/libraries and tRPC server bundle
were built through the existing `build:docker` command; `yarn workspace
@calcom/api-v2 build` then completed the actual native compiler. Both exited zero.
The compiled **main, complete AppModule and bootstrap** were started with the same
schema in isolated PostgreSQL and real Redis. No Test.createTestingModule,
substitute service, hand-written success controller or alias loader was used.

The test performs actual HTTP health/timezone/profile requests, anonymous refusal,
key and encrypted-cookie authentication, DTO lifetime rejection, API-key-only
refresh, no-store replacement response, primary-database rotation audit, rejection
of the old key and current key success. The identical key/cookie are denied after
local account lock; the identical cookie remains denied after unlink and replacement
binding. Redis data confirms that the native request path actually used it.
This meets the specified build/start/schema criterion, not the broader CAL-05.API
permissions, provider integrations, optional background workers or deployment.

### CAL-04.SESSION — source_proven

The existing native Authentik callbacks/token refresh and server-session source
were reviewed and tested again. The same native session is rejected after local
lock, unlink and replacement binding. Caller session updates cannot replace
identity/role/email or retain an impersonation grant. Profile selection is scoped
to the identity's accepted organization membership. The server session branch
refreshes binding and current state before returning authorization; no old cache
return is counted as current identity.

The 37-case native Authentik suite and 44-case native API-auth database suite pass.
The former mixes explicit helper doubles with real local OIDC/token protocol
checks; the latter uses real Nest/Passport/JWE/Prisma with unrelated dependencies
controlled. The new complete-AppModule check additionally exercises the real API
entrypoint. These are source/local-runtime proofs, not a real-IdP revocation test.

The separately committed TOKEN-READER-INVENTORY-2026-10-15.json classifies each
runtime token-library import found by the new TypeScript-AST inventory. It records
token helper, presentation-only, native-session, separate OAuth/bearer and remaining
permission-guard boundaries. Named aliases, namespace calls and dynamic/re-export
boundaries are tested; source hashes are retained. The inventory is syntax-based,
not whole-program receiver/dataflow resolution or complete route reachability.
In particular the API PermissionsGuard and separate OAuth token paths are NOT
certified by this closure. CAL-03.ROUTES and CAL-05.API still own that review.
Thus the task's explicit separate-reader-inventory criterion is met without claiming
that every direct reader independently refreshes IdP or resource authority.

### CAL-06.REUSE — source_proven

The actual retained-engine tests were rerun: 42 PostgreSQL eligibility/commit cases
cover accepted/disabled/removed hosts, legacy and explicit assignments, fixed/RR
and collective membership, managed-child parent-team inheritance, explicit child
ownership, wrong tenant, same-host/rerouted rescheduling, buffers and cancellations.
They also exercise competing event types, shared collective participants, opposite
lock order, concurrent reschedules and independent-host controls.

The existing built application then ran its full team/guest/multi-host journey
with the insertion-gated overlapping-booking probe: one actual request succeeds,
one returns 409, one booking remains and only the winner's notifications are sent.
The database cases and native journey establish the task's retained algorithm and
qualified-host intersection contract. They do not prove an external provider or
future-appointment organizer transfer. Those are separate still-open integration,
audit/reconciliation and live journey requirements, not reasons to keep the
already-satisfied engine-reuse record indefinitely in progress.

## Exact runtime identity and reproduction

Current API source: `fd04d517c60ed3cdbcc2cb1dc040d6f85e40b8b5`. API compilation and its platform
dependencies were freshly rebuilt. Schema SHA-256: `90907c0ab1bd996844ccf3386f86aa55ee8d817fd64957795207b05037ac590f`.
The manifest of 3140 compiled files is preserved in the archive,
SHA-256 `28d5577bf8ba3560070f4c0d099ed9841d247ba23c826c563ab4408c7ab120a5`; it matches before/after acceptance.

The existing cached Node image `sha256:ff56a7906c945e128a8a978652b4ebcf6fc4531c66a1294f6c8cd1f4b3403f06` supplies Node **22.23.3**
and system libraries only. Its old application is not invoked. The current source
and rebuilt distribution are mounted read-only at the existing repository path;
the entrypoint is explicitly the compiled current API main. The separate Redis
image is `sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5`. This is a compiled-runtime acceptance fixture,
not a new deployable API image, registry upload or old-image relabeling.

The Docker network is internal, no host port is published, both processes are
unprivileged/read-only with bounded CPU/memory, and the database uses the existing
private-socket runner. Request data enters the test client through stdin rather
than credential-bearing process arguments. No live secrets or provider endpoints
are used. Production NODE_ENV is used, supported slot-worker and asynchronous
Tasker modes are disabled, and constructor-required Stripe values are synthetic.
No billing operation, live IdP exchange or optional worker behavior is certified.

Reproduce after normal candidate installation/generation:

```sh
yarn workspace @calcom/api-v2 build:docker
yarn workspace @calcom/api-v2 build
python3 scripts/run-community-enterprise-postgres.py --suite api-assembled \
  --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp \
  --api-node-image sha256:ff56a7906c945e128a8a978652b4ebcf6fc4531c66a1294f6c8cd1f4b3403f06 \
  --api-redis-image sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5
node scripts/inventory-enterprise-token-readers.cjs
node scripts/verify-community-enterprise-task-graph.cjs --status
```

Those example image IDs must already exist locally and be approved for the test.
Select equivalent approved local Node22/Redis image IDs explicitly elsewhere; the
runner neither pulls images nor silently selects mutable tags. Five admission
negatives reject missing/tag-shaped/malformed image inputs or cross-suite use.
No existing application deployment configuration is rewritten for this fixture.

The retained web concurrency journey runs unchanged application build
`2a8e335a652ad4aa8fc2ca6469b14e1c15f43fab`, Build ID `qDBt82BMA5UTK4JxOTAsK`,
manifest `c5c0e834957c876041f7a1f5ea781e83961e27ef2d5665ebacb3c38d2435f994`. The later fd04 source checkpoint
changes documentation only; this wave changes tests/scripts/graph and does not
relabel that web build or claim to have deployed it.

## Why several tempting closures were refused

CAL-04.LINK's 24 real database/CLI tests were rerun and passed, including dry-run,
exact UUID/issuer binding, atomic audit, concurrency and replay. Its existing
implementation note nevertheless requires real preview mapping/operator review;
that has not happened here, so it remains in progress. CAL-05.CORE still requires
custom-role assignment and provenance, not just the working built-in-role screens.
CAL-05.API still requires the complete principal/scope/resource audit. Synthetic
first-user journeys do not close the real Authentik/calendar preview requirement.
Old live-image/registry observations were not re-read in this tranche and are not
presented as fresh deployment or permission evidence.

## Every remaining executable task

| Record | Specific remaining outcome |
| --- | --- |
| `CAL-01.REUSE` | Finish the exact historical fork/deployment/provenance reconciliation; private material is not silently published. |
| `CAL-01.TRACKER` | Supported legacy Beads migration with backup/content/rollback proof; do not create a competing tracker. |
| `CAL-02.PREVIEW` | Admit and identify the actual candidate on existing nonproduction infrastructure; live staff and anonymous guest routing; refresh stale deployment/registry blockers. |
| `CAL-03.ROUTES` | Complete call-reachable route/permission audit, including the separately inventoried bearer guards and mutation races. |
| `CAL-04.LINK` | Existing 24-case CLI/transaction proof is refreshed, but actual preview subject mappings/operator attribution remain unreviewed. |
| `CAL-04.SCIM` | Implement/test scoped Authentik discovery, users/groups, paging, grant provenance and deprovisioning without destroying local grants. |
| `CAL-04.REVOCATION` | Real IdP/application-access/role removal with unchanged credentials across replicas within 60 seconds, including delayed provisioning. |
| `CAL-05.CORE` | Finish custom-role assignment/provenance and supported lifecycle paths; built-in roles/invitations/admission alone are not the full criterion. |
| `CAL-05.UI` | Complete custom-permission/admin surfaces, keyboard/accessibility and denied-state acceptance without exposing unsupported actions. |
| `CAL-05.API` | Full active-principal/scope/resource intersection and all relevant list/detail/export/mutation negatives; native startup is not this completion. |
| `CAL-06.JOURNEY` | Real Authentik and connected test calendar on the admitted preview; begin with a genuinely unconfigured staff user. |
| `CAL-07.AUDIT` | Complete domain mutation plus durable enqueue/outbox and redacted booking/administrative audit; worker claims alone are insufficient. |
| `CAL-07.REMINDERS` | Stale reminder invalidation, reliable actual recipient delivery and explicit unknown-effect reconciliation across retained handlers. |
| `CAL-08.BASELINE` | Current deployed identity/data inventory and authorized isolated restore with stable identifiers and encryption checks. |
| `CAL-08.MIGRATE` | Full legacy-data preservation rehearsal and post-cutover-write recovery, not only empty-schema migration admission. |
| `CAL-08.UPDATE` | Apply a real reviewed upstream revision change and rerun enterprise contracts; schema guard tests are not an upstream update. |
| `CAL-09.ACCEPT` | All exact-artifact core product, identity, privacy, recovery and security requirements satisfied together. |
| `CAL-09.PILOT` | Existing gated GitOps promotion and supervised live team journeys after acceptance, not source publication. |
| `CAL-10.ROUTING` | Explainable programme/service/language routing and tested fallbacks on eligible retained teams. |
| `CAL-10.REPORTS` | Scoped operational reports/exports reconciled to booking data, with privacy and delivery-failure attribution. |
| `CAL-10.ROLLOUT` | Full routing/reporting plus operational handover and broader rollout; all upstream prerequisites remain. |

The next source work is CAL-05.CORE custom roles/provenance and CAL-03.ROUTES
reachable authorization. Preview admission/publication must progress with its
existing infrastructure owner in parallel, followed by real mapping and identity
lifecycle tests. Closed prerequisites are not reimplemented just to keep producing
commits. Conversely, no automatic closure is inferred for a parent, SCIM, reminders,
upstream-update, migration or production task when only a prerequisite passes.

## Graph and test-tool changes

The validator now rejects a completed task whose prerequisite is still incomplete.
The new read-only --status reports real executable completion, unfinished
prerequisites, pending descendants and milestone requirements rather than treating
parent containers as work units. Its fixtures do not pin an engine task forever
open. These changes retain all 39 IDs, original dependencies, acceptance clauses,
required proof levels, historical evidence and milestone/release constraints.
Only the three reviewed states and the next-ready focus order change.

Eight inventory-parser cases, five API-image admission cases and four additional
graph cases supplement the existing source suite. Test counts overlap; exact final
command totals, changed-file scans and publication hashes are recorded in #78.
The new scripts do not dispatch agents or create an alternate tracker/queue.

## Failed attempts retained

The first Docker fixture tried to discover a published host port on an internal
network. It was changed to perform requests inside the container; external access
was not enabled. A subsequent synthetic cookie used the unprefixed name despite
HTTPS configuration; it was corrected to the existing secure-cookie convention.
A later assertion expected an organization audit from a personal key; the fixture
now creates a real organization-scoped key for that assertion. No production
authentication, TLS, validation, audit or rate-limit rule was weakened for these
test corrections. The finished native route test passed and was repeated with
explicit image IDs and before/after compiled-file hash binding.

All fixture PostgreSQL, API and Redis processes and their private network were
closed by the tests. Source build outputs and bounded receipts remain in the
existing release workspace/archive. No production data, real membership, account,
calendar, credential, message, IdP setting, domain or deployment changed.

Recorded: 2026-10-15T11:08:03.892177+00:00 UTC.

## Final tooling verification and retained scan limits

The final enterprise regression command passes **522 cases**, including the eight
new import-inventory cases, five runtime-image admission cases and the enlarged
23-case graph suite. The actual current API runtime was repeated with explicitly
pinned local image IDs; its compilation-manifest hash stayed unchanged. These
counts overlap and do not certify all business endpoints or any live deployment.

Gitleaks scanned all changed files. Five generic-key matches occurred in the graph
and evidence document: they are the already-resolved source revision and Node/Redis
image identifiers used by the recorded command. Their exact values were checked
against the existing Git commit and local Docker image identities. The original
nonzero reports are retained; no finding was hidden, rule disabled or credential
value accepted by analogy. No real credential was added or published.

UBS completed analysis of the graph validator. The inventory tool and integration
test reached the analyzer's command/SQL taint-work limits and returned partial
reports, not clean passes. The integration test also has two critical-level
hardcoded-key heuristics on the literal synthetic Stripe constructor placeholders;
no billing/provider operation is performed, and the fixture has no cloud egress.
The warnings concern one-shot filesystem/parsing operations and the test's inline
client. That client uses a fixed loopback base, literal test routes, stdin request
arguments and an explicit AbortSignal timeout; it is not an untrusted-input server
endpoint. The reports remain unsuppressed, and their incomplete dataflow coverage
is explicit. No image/dependency or whole-repository security approval follows.

These source-tool limitations do not change the demonstrated build/start/schema,
native-session-source and retained-engine criteria. They do prevent calling this
wave a comprehensive security assessment; the wider authorization, security and
release gates remain open. Runtime application code is unchanged in this wave.
