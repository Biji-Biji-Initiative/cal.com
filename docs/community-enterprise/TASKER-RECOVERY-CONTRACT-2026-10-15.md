# Retained Tasker: execution ownership and uncertain effects

Baseline: 96951beea17f94ab94f9bff0478754dec31e7a3e. Existing repository,
enterprise branch, Tasker registry, Task table and the single task graph remain.
This is a worker and delivery-outcome contract, not provider-organizer transfer,
a new queue, an agent privilege grant or a deployed-service acceptance receipt.

## Why the existing worker needed repair

The retained worker selected due rows and ran the returned batch without first
claiming those rows. Two consumers could run the same work. Success-recording
errors entered the ordinary retry catch; a lost database acknowledgement could
therefore schedule an already-issued external effect again. Unsupported task
handlers did not establish durable execution failure, and routine logs contained
whole task records/payloads. Cron authentication compared against a constructed
Bearer value even when CRON_SECRET was absent.

Reuse the existing stack rather than build a second scheduler. A short primary-
database transaction now claims one due task with a unique execution token and
increments the attempt before invoking its retained handler. The lease has a
bounded lifetime and renewal. Completion, retry, payload updates and lease renewal
require the same task, attempt and token. A stale execution cannot acknowledge a
replacement attempt, change an uncertain payload or erase completion evidence.
The database clock determines due/lease boundaries, aligned to the retained UTC
naive timestamp columns; the application clock does not grant execution authority.

## Versioned state in the retained schema

There is no new table or schema migration. While a task is running, scheduledAt
holds its lease deadline and lastError holds tasker:v1:running:<opaque-token>.
Unconfirmed tasks use tasker:v1:unconfirmed:<bounded-category>; explicit ordinary
handler failures use tasker:v1:retry:handler_failed. Payloads and raw error text
are not embedded in those markers. Completed tasks use the existing succeededAt.
Attempts now count claimed executions, including a crash before acknowledgement.

The marker prefix is reserved internal state, not a public API or a user-supplied
retry flag. Create options are explicitly projected so extra fields cannot forge
execution, completion, payload or task type. The existing task type and stable
reference UID interfaces are retained. The read-only getNextBatch is inspection,
not an execution capability; consumers must use claimNext/the processor.

A global short claim lock coordinates compliant workers and admits at most four
current valid leases. Row-level SKIP LOCKED permits unrelated unlocked work to
progress. No database transaction is held open around a network request. The
processor stops initiating more claims in its current invocation after an
unconfirmed outcome; already-issued claim requests/handlers must still settle.

That lease bound is NOT a physical guarantee that only four remote requests or
JavaScript functions can exist after failures. AbortSignal is cooperative. A
handler that ignores cancellation, a stalled connection or an old process can
remain active after the authority lease expires. New invocation behavior and
external-provider idempotency/reconciliation must account for that boundary.

## Retry, crash and acknowledgement semantics

Ordinary explicit legacy handler errors retain bounded at-least-once retries.
This does not establish that every existing handler is safe to retry. New
non-idempotent operations must classify ambiguity rather than throw an ordinary
retry error for every timeout. TaskOutcomeUnknownError marks that explicit case.
Missing/malformed handlers and timed-out/lost-lease executions become unconfirmed.
A subsequent worker records an expired running claim as interrupted/unconfirmed;
expiry is not permission to replay a potentially completed provider request.

Recording completion is separate from running the effect. If acknowledgement
cannot be established, the processor does not turn it into an ordinary retry.
An already-committed succeededAt remains authoritative even if its reply was lost.
If neither success nor uncertainty could be recorded, the durable running claim
will eventually be presented for review. The cron request then fails rather than
returning a false successful work result.

No exactly-once remote effect guarantee is introduced. The Task row records local
execution and its latest outcome; it is not a provider receipt, immutable full
attempt history or a multi-step transfer journal. Unconfirmed work is not silently
made runnable by cancellation, payload editing, cleanup or another cron pass.
There is no operator "force retry" endpoint in this tranche. A future recovery
operation must verify target/provider/actor state and evidence, authorize a bounded
action and preserve its audit before it can resume or reconcile external work.

## Retained webhook and cancellation integration

The existing sendWebhook task previously awaited the sender but ignored its
returned HTTP acceptance status. It now requires a valid successful response.
A rejected/malformed acknowledgement or transport exception becomes unconfirmed,
not successful completion or blind automatic replay. A receiver can apply an
operation before emitting a failure response, so a non-2xx alone is not proof
that nothing happened. The active task signal reaches the retained fetch path.
This is bounded behavior for this handler, not all webhook-delivery consumers,
provider APIs, retry middleware or legacy handler logging.

No-show cancellation now uses the existing Tasker guard and only its two no-show
types. It cannot erase unrelated tasks sharing a booking reference, a running
attempt or an uncertain outcome. Cancelling an already-completed task is a
harmless no-op that retains its receipt. It does not promise that cancelled work
which has already crossed an external effect boundary can be undone. There is
no new automatic retention deletion; the prior cleanup no-op is preserved.
A retained completed reference remains subject to the existing unique constraint;
it is not silently recycled into a new logical operation.

## Route, visibility and security boundary

Both existing cron methods and cleanup require a present configured secret and
compare fixed-size digests. No literal undefined/empty configuration is accepted.
The response contains counts, not payloads, task credential material or raw errors.
Success at the request level means the processor pass completed, not every task
succeeded. attentionRequired remains true for existing unconfirmed or exhausted
records even on a later invocation which claims no new work.

The database error count and unconfirmed count distinguish failed attempts from
lost external acknowledgements. They are operational indicators, not tenant-safe
self-service APIs. Existing internal getFailed/getSucceeded still return stored
task objects to their internal callers; do not expose them without projection,
authorization, retention and secret-handling design. Other old handlers can still
log their own data or ignore useful sender results; this tranche is not a full
logging/delivery audit or protection against arbitrary code with database access.

## Rollout is a protocol cutover, not just a schema-free deployment

Old Tasker workers do not understand the new markers. Before adopting this
implementation, pause the existing cron/worker triggers, drain or account for all
old in-flight executions, snapshot/inspect the queue and ensure every worker
consumer uses the same qualified implementation. Then resume the approved triggers
and read back actual processing and uncertainty counts. No trigger, worker,
production secret or runtime configuration is changed by these source edits.

A mixed-version rolling worker period cannot claim the lease/replay guarantee.
Rolling back to the old worker with running/unconfirmed rows is equally unsafe;
first stop workers and perform the reviewed state/effect reconciliation. Do not
clear markers or attempts as a rollback shortcut. Database schema compatibility
alone does not establish execution-protocol compatibility. The existing gated
release process remains authoritative, with explicit approval for consequential
live data or customer-message operations.

## Qualification and next step

Source-level negatives, real PostgreSQL claim/race/crash cases and the actual
built cron route provide separate evidence. Synthetic local HTTP receipts prove
only the tested receiver interaction; they do not validate live provider consent,
cloud delivery, tenant permission or a future-appointment handoff. The existing
provider/shared-scheduling blockers remain until a versioned domain command,
provider-specific organizer semantics, durable step/effect receipts, audited
reconciliation and participant notification are implemented and verified.

The next operator recovery interface should bind a specific task and recorded
attempt to concrete provider evidence, distinguish "not sent", "accepted",
"rejected" and "unknown", and refuse to infer remote truth from a local timeout.
It must not make unknown outcomes disappear merely to drain a queue. The current
small worker repair is reusable infrastructure for that contract, not a second
business implementation or a new generic workflow platform.

Primary references checked 2026-10-15:
https://www.postgresql.org/docs/18/sql-select.html (row locking/SKIP LOCKED)
https://www.postgresql.org/docs/18/functions-datetime.html (database wall time)
https://nodejs.org/api/globals.html (AbortController/AbortSignal; actual tests use installed Node 22)

Executed commands and exact artifact identity are recorded in the companion
acceptance receipt after the native build. No production milestone is closed by
this contract alone.
