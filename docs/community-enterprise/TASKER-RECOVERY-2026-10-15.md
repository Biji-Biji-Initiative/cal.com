# Retained Tasker recovery and real delivery acknowledgement

Date: 2026-10-15. Built application: `2a8e335a652ad4aa8fc2ca6469b14e1c15f43fab`.
The canonical repository/branch and the single 39-record task graph are unchanged.
This is an exact local candidate acceptance record, not a live worker/provisioning
cutover or an already-booked appointment transfer release.

## Outcome and reused implementation

The retained worker now claims due work durably before dispatch, keeps a bounded
renewable execution lease, rejects stale acknowledgements and preserves uncertain
effects after interruptions. Two cooperating consumers cannot acquire the same
live claim. A crashed worker's expiry does not automatically replay a possibly
completed external operation. The same existing Task table, handler registry,
native cron wrappers and application dependencies are used; no queue, schema,
identity system, agent permission or alternative infrastructure was introduced.

The tranche reuses the existing release checkout and Tasker implementation. Its
first candidate completed persistent failed-work attention, timeout follow-through
and queued-webhook acknowledgement handling. This continuation inspected and reran
that candidate, then reproduced and repaired a separate post-lock-wait lease race.
The final code below was rebuilt and all eight assembled checks rerun; none of the
predecessor application receipts was relabeled onto the new production bytes.

## Defects demonstrated, not assumed

The pinned baseline processor could let two selected batches execute the same task;
the controlled baseline probe observed two executions and two completions. It also
logged complete payload-bearing records and admitted the literal Bearer undefined
when CRON_SECRET was not configured. These baseline demonstrations use explicit
repository/handler doubles; the new database and crash tests are separate proof.

The pending repair had two additional follow-through issues: a later empty cron
pass forgot prior exhaustion, and timeout could keep admitting fresh work while
the preceding handler ignored cancellation. New negative cases reproduced those
failures. Persistent uncertainty/exhaustion counts now drive attentionRequired,
and an uncertain outcome stops new claims initiated by that invocation. It does
not forcibly stop a handler or undo a remote request.

The legacy sendWebhook task awaited a sender that returns an HTTP outcome but
ignored that returned status. The original handler failed seven of eight focused
outcome contracts: non-success/empty responses could become local success, raw
transport errors leaked to logs, and the execution signal was not passed on.
The handler now requires a valid successful acknowledgement, passes its active
signal to the retained sender, and preserves rejected or uncertain delivery for
reconciliation. Parsing before delivery may still cause a normal bounded retry;
it does not represent a remote effect. Other legacy handlers retain their prior
explicit-error retry policy and require their own idempotency/error classification.

No-show cancellation is now limited to the two no-show task types and uses the
same state guard. It cannot remove unrelated reference-sharing tasks, uncertain
work or running claims. Cancelling an already-completed task preserves its receipt
and remains a harmless no-op. Automatic cleanup remains the retained no-op.

## Exact application and tests

| Evidence | Result |
| --- | --- |
| Application code | `2a8e335a652ad4aa8fc2ca6469b14e1c15f43fab` |
| Build ID | `qDBt82BMA5UTK4JxOTAsK` |
| Build manifest SHA-256 | `c5c0e834957c876041f7a1f5ea781e83961e27ef2d5665ebacb3c38d2435f994` |
| Build origin | `http://127.0.0.1:38917` — local test artifact |
| Immutable install and retained generators | Passed; lockfile unchanged |
| Native tRPC/web type checks and optimized build | Passed |
| Actual PostgreSQL Tasker suite | 45 passed; zero failures/skips |
| Focused cron and webhook-handler source contracts | 17 passed; controlled work/delivery boundaries |
| Retained webhook/CRM/no-show native unit tests | 26 passed across five files |
| Enterprise source command | 505 passed; contains the focused source subset |
| Assembled application checks | New Tasker runtime plus seven existing user/provider journeys passed |

Counts overlap and are not independent cloud/production tests. The actual
PostgreSQL suite uses the generated client, real locking, wall-clock lease state
and AsyncLocalStorage; only default handlers/global app dependencies are controlled.
It includes ordinary retries/exhaustion, stale tokens and reused IDs, expired
leases, claim concurrency, locked-row progress, failed database acknowledgement,
payload/cancellation fencing, malformed handlers and sensitive-log negatives.

A separate child process executed a real local HTTP effect and was killed before
acknowledging it. The next processor preserved uncertainty and did not send again.
Another real local receiver accepted a request but never acknowledged it; the
worker timed out, retained the unresolved outcome and did not replay it. A separate
case commits success and loses only the database reply: the success record is not
reclassified as runnable. These are isolated synthetic endpoints, not user calendars,
real participant notifications or a guarantee of exactly-once provider effects.

## Native route and actual signed-delivery proof

The rebuilt Next application uses the existing publicly exported GET cron/cleanup
wrappers, default TaskProcessor and actual registered handlers. The feature module
also exports POST and that function is source-tested, but the application wrapper
does not expose it. The new native fixture was corrected to use the actual GET
route before its first built run; no extra production endpoint was added.

Four unauthenticated/misconfigured requests leave the fixture queue unchanged.
An authenticated pass accounts for a failed SMS stub, unsupported handler and an
expired running record while leaving future work alone. This does not implement
SMS. Repeated runs claim no unresolved work and continue to report attention.
Cleanup preserves the fixture records. Removing the synthetic uncertainty rows
only inside the disposable test demonstrates that earlier exhaustion alone keeps
the warning active; no production reconciliation shortcut is added.

The same assembled route then runs the real sendWebhook handler against a local
HTTP receiver. The receiver checks the actual HMAC signature, webhook version and
fixture body. Its 204 response produces one completed task. A separate request is
recorded before a 503 response; it is retained as unconfirmed, not success or an
automatic retry. A subsequent cron pass makes no duplicate delivery. Exactly two
local receipts are recorded and no external subscriber or mailbox is contacted.
This separates successful processor invocation from successful receiver acceptance.

The seven existing provider, scheduling-handoff, member, invitation, organization,
onboarding and team/guest/multi-host journeys passed on the same application.
They retain their existing HTTPS test IdP, intercepted cloud provider and local
SMTP boundaries. Live Authentik consent, Google/Microsoft OAuth grants, real cloud
organizer transfer, external delivery and deployed API/workers are not proven.

## Native timestamp fixture correction

The predecessor build's first assembled Tasker pass found no due work, exposing a new test
fixture mistake: passing a local JavaScript Date directly through node-postgres
into a timestamp-without-time-zone stored due rows about two hours in the future.
The fixture's PostgreSQL timezone was Europe/Berlin. A separate production-source
regression proved that actual TaskRepository.create defaults were immediately due
under that same timezone; the application was not changed to satisfy bad seeding.

The raw fixture now constructs due instants explicitly from the database UTC wall
clock and asserts three due rows plus one future row before invoking the app.
The unchanged built application then passed cron accounting and both actual signed
webhook outcomes. The original failed run and offset-only diagnostics are retained.
A test-only commit recorded that fixture fix and default-creation regression
before this continuation. The newer production-code repair required a fresh
application build: all eight final native checks now have receipts for the exact
new source, alongside the retained predecessor logs.

## Retained failures and scans

The original 34-case database and 496-case source suites were rerun on resume.
Additional tests then strengthened the pending implementation. During a negative
run, an unrelated 200 ms local-network fixture deadline elapsed before the
receiver observed the request on the loaded host. Only that test deadline was
increased to 1500 ms; the final assertion still requires one real receipt and no
replay. This is neither a provider latency/SLO result nor a production timeout
change. A new fixture SQL-quoting error was caught by Node syntax validation and
replaced with parameterized values before runtime acceptance.

Biome and native type checks passed. Changed-file Gitleaks reports no findings;
the final all-file scan and publication hash binding are recorded in issue #78.
Nine production-source UBS runs completed with zero critical, two warning and
101 informational findings. The JSON.parse warning is intentional validation
before any send, whose rejection is accounted by the worker. The async-map warning
is an existing array collected by flatMap and awaited with Promise.all. These
findings remain unsuppressed; no whole-repository/image approval is implied.
The inherited native Vitest setup still emits its existing mock-hoisting warning.

## Required rollout and next operations

[The execution contract](TASKER-RECOVERY-CONTRACT-2026-10-15.md) defines marker
semantics, retries and adoption boundaries. The retained scheduledAt/lastError
fields now carry a versioned execution protocol. Old workers do not understand
those markers. Pause and account for old processing before deployment; do not
claim a safe mixed-worker rolling period or roll back into old consumers while
uncertain/running markers remain. This source tranche changed no live trigger,
cron secret, queue, environment variable, worker or production record.

At most four valid ownership leases are admitted by cooperating workers; that is
not a physical upper bound on uncooperative functions or external effects after
lease loss. Abort is cooperative. Legacy generic handler errors remain retryable;
this worker cannot infer provider truth for every handler. Unconfirmed records
are not a durable multi-step transfer journal, full immutable attempt history,
tenant-safe public read API or operator recovery permission. Their payloads can
still be sensitive stored data and must not be exposed indiscriminately.

The next domain operation must bind a specific task/attempt and provider resource
to reviewed evidence and current actor authority, distinguish accepted/rejected/
not-issued/unknown outcomes, and record authorized reconciliation before any
resend or compensation. A local timeout is not enough. The existing future-booking
and provider-bound handoff blockers remain until that transfer and participant-
notification contract is implemented and verified. No force-retry endpoint or
universal claim of duplicate-free external effects is added here.

Existing live identity, community enrollment, image-security/publication,
migration/restore and dev/staging/production requirements remain in the single
graph. The worker repair supports those tasks but closes none of the broad
release milestones. The separate initial enqueue and business mutation are not
made atomic by this change; that is still part of the domain/outbox contract.

```sh
yarn test:community-enterprise
yarn test:community-enterprise:tasker --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:tasker-runtime --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

The test database runner checks its private socket/data-directory identity and
refuses application data. Original/resumed task and HTTP fixture teardown, the
closed test listener, exact public file hashes and archive location are recorded
in the final delivery handover. No customer message, live provider or identity,
domain, database, registry permission or deployment changed.

Primary documentation rechecked: PostgreSQL 18 SELECT locking and wall-clock
functions; Node 22 AbortController/AbortSignal. The actual installed runtime used
Node 22.23.2. The contracts explain the implementation; synthetic tests are not
substitutes for eventual live provider acceptance.

Recorded at 2026-10-15T09:33:52.572306+00:00 UTC.

## Independent lock-wait race and final assembled acceptance

The first resumed pass repeated 505 source tests, 39 database cases and the actual
Tasker GET/HTTP-delivery journey without error. Additional real-contention tests
then disproved a stronger lease guarantee in that candidate. They hold an unchanged
row lock, observe the waiting mutation in pg_stat_activity, wait for the database's
actual lease deadline, and only then release the blocker. Four mutations were
incorrectly admitted: renewal, success acknowledgement, retry scheduling and active
payload rewriting. This was a reproducible production-code race, not a clock/mock
fixture issue. The baseline failure logs are retained.

The shared repository now acquires the exact claim row before a separate READ
COMMITTED write statement revalidates the token, attempt and current database
clock. Payload execution context is checked again after the lock wait. No network
request is held in that transaction. Six new cases prove the four stale operations
are refused, original-claim uncertainty may still be recorded after expiry, and
cancellation during a wait stops a payload change even while its lease remains
live. Refused operations preserve the original row; expiration leads to review,
not renewed authority or blind replay.

The final 45-case PostgreSQL suite and 505-source/26-retained-unit checks passed.
The full current tRPC/web type checks passed before committing the repair; the
fresh immutable application build and all eight assembled checks then passed on
the updated code. The earlier test-only cron/timezone corrections were included
in the build, not replayed as a new production fix. The existing handlers and
provider adapters remain unchanged by the lock-order repair.

This solves the demonstrated claim-state race, not every physical interruption.
The database still cannot revoke a provider's already-issued request or force an
uncooperative handler to stop. The worker's claim protocol does not turn arbitrary
old handlers into idempotent operations. Provider-aware domain reconciliation,
operator permission and a safe paused/drained old-worker cutover remain required.
A schema-free change can still require an execution-protocol migration; never
roll old workers over running/unconfirmed markers as an automatic rollback.
