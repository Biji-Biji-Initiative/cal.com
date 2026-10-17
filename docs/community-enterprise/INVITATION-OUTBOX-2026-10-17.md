# Invitation outbox: native runtime acceptance

17 October 2026. Existing repository `Biji-Biji-Initiative/cal.com`, branch
`work/cal-diy-enterprise-20261010`. Tested source:
`39ea68b4cba1aa3375bba40596e6b605c90a9b3b` (application/test source originally
published at `92d944676a7c9e3b5fda7cd530f6622db53d22a6`). The continuation accepts
the previously pending invitation/Tasker component at its demonstrated scope;
it does not close the broader booking-audit, reminder or deployed-preview gates.
No application implementation was changed to obtain these runtime results.

## The previously blocked database checks now execute

The preceding source checkpoint recorded a generic tool-level launch refusal.
After reviewing the unchanged maintained runner and current source, this
continuation made a direct request through the same tool and host. It executed
normally. No alternate execution host, credential, database target, policy change
or weakened test was used. The old refusal is retained as historical evidence;
it was not an application failure and is not relabeled as an earlier success.

All **91 invitation database/service cases passed**, including the new batched
page checks and every retained consent, identity, outbox and ambiguity case.
The actual complete page of 50 invitations executed **seven SQL SELECTs**, as
measured by the native test. The 51-record continuation returned the final
invitation without duplication or loss. The original ten-second application
transaction limit and the existing pagination size were unchanged.

That is now a PostgreSQL measurement, not the earlier six-logical-call source
fixture result. The two numbers describe different layers. The formerly failing
pagination case completed in the current run; its observed test duration is not
a production response-time percentile, and different host load makes it unsuitable
for a claimed before/after latency multiplier. No indexing or schema change was
needed for this read-path acceptance.

All **49 Tasker database/process cases passed** on the same source. They cover
claim ownership, four-claim global capacity, targeted processing without draining
unrelated tasks, bounded retries, lease loss, expired/late acknowledgements,
uncertain completion and stopped work. The process-crash case actually terminates
its newly created fixture worker after its local HTTP effect, then proves that
a new worker does not automatically resend. That HTTP/process test is distinct
from the invitation-specific service tests; it is not a real production SMTP
process-crash experiment.

The sender remains the existing mail transport and template. Pending invitation,
audit and identity-reference-only intent commit together. Both immediate and
scheduled delivery use the same durable Tasker claim. A failed pre-send audit
prevents dispatch; a failed/ambiguous post-send result is held unconfirmed, not
made runnable automatically. Cancellation, accepted/declined invitations,
revoked actors, unverified or changed recipient identity and directory ownership
are checked before the attempt. Already-in-flight external mail cannot be
recalled, and exactly-once external delivery is not claimed.

## Build and browser acceptance

A fresh local-origin web build completed from the pinned source. Immutable
installation, Prisma/app registry generation, tRPC generation, native web type
checking and the optimized Next build all passed. Its build ID is
`pJhmrSvd_ZjeWuiPjexI2`, with manifest SHA-256
`29cbb20588074a55846a17c0898816e8ab892c9e1237d46edbd60a3250c6644d` and origin
`http://127.0.0.1:38917`. Those source and manifest identities were checked again
before publishing evidence. The build is not an HTTPS deployment artifact or a
new full API binary/container qualification.

Both assembled journeys passed on this one new build. The invitation journey
uses three existing synthetic identities with real encrypted sessions against a
local TLS identity-provider fixture, the actual built UI/tRPC/cron/registered
handler, PostgreSQL and a controlled local SMTP receiver. It verifies one
acceptance, two declines, three cancellations, identity/verified-email checks,
queued notification display under full worker capacity, rejected unauthenticated
cron requests, and recovery of the same queued intent through the actual cron.

Exactly four messages were accepted by the local SMTP fixture. Cancellation of
a queued invitation suppressed its later send; repeating cron did not resend.
A deliberately rejected SMTP submission preserved the pending invitation and
reported uncertainty. The controlled six-second inbox response delay remains in
the test; the existing five-second post-response rendering assertion passes.
This is not a six-second production latency target or final external inbox proof.

The separate built Tasker route journey verifies authenticated cron admission,
signed local-webhook success/non-success, recovery of interrupted work without
replaying uncertain effects, future-task preservation and retained failure
receipts during cleanup. Its exact assertions are not interpreted as complete
calendar reminder or external provider acceptance.

The full registered source suite passed **604 cases, zero failures/skips** on
this same source, and the focused invitation/Tasker/graph set passed **61**
(36 focused source cases plus the 25 graph regressions). These overlapping totals
are not added together or represented as hundreds of deployed user journeys.

The prior HTTPS e3a79afb container is a separate artifact. It was neither rebuilt
nor relabeled as this newer source or as the local-origin browser build. All
four owned PostgreSQL fixtures have shutdown receipts and absent temporary
directories. No matching Cal test application/browser process or listener on
port38917 remained at final inspection.

## Boundaries retained

All accounts, addresses, task rows, calendars and identity-provider exchanges in
these tests are synthetic. The maintained database runner verifies its new private
socket/data directory and dedicated test user, binds only that fixture and stops
it afterward. No configured live DATABASE_URL, customer address, actual IdP
account, calendar provider, deployment, DNS, production or registry permission
was modified. The local SMTP fixture proves submission to that controlled
receiver, not delivery to a person's external inbox.

The build uses the retained checkout rather than a clone or new worktree. It
checks the pinned HEAD and unchanged tracked inputs before and after each step.
The one inherited untracked Python bytecode file is preserved and hash-bound as
a non-application artifact. The repository is not described as completely clean,
and the image preparer's stricter clean-tree contract is not changed. This
acceptance does not publish a container or bypass that preparer.

The original 19 source/test/translation inputs match their previously published
hashes. Their existing security findings are therefore retained, not magically
cleared by a new test run. No new image scan or reduction of the older image's
56 open HIGH package/advisory occurrences is claimed. Publication metadata was
scanned separately: two matches are unchanged identifier lines in the existing
graph, verified against the parent. No suppression was added or clean metadata
scanner exit claimed. The updated graph validator and all25 graph tests pass.

## What remains on the existing graph

CAL-07.AUDIT keeps its original administrative-and-booking contract. This
invitation component now has native runtime evidence; complete booking audit
coverage, retention and any missing domain transaction proof remain open.
CAL-07.REMINDERS is not closed by testing invitation notices. Actual external
controlled-recipient reminder acceptance and cancellation/rescheduling coverage
remain its own requirements.

CAL-02.PREVIEW and CAL-06.JOURNEY still require an admitted publisher, actual
isolated native identity/database/routing setup and the serving staff-to-guest
journey. A successful local browser build does not establish those outcomes.
The 39-record canonical graph, original criteria/dependencies and 12-complete /
17-open executable count remain. Native Beads recovery is still its separate
blocked task; no new store, migration or fabricated bead closure is introduced.

Reproduce with the candidate's native installed dependencies and generated schema:

```sh
python3 scripts/run-community-enterprise-postgres.py --suite invitations --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
python3 scripts/run-community-enterprise-postgres.py --suite tasker --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

The assembled browser checks require a fresh matching local-origin application
build first; do not reuse an unrelated or HTTPS-only bundle as proof. Commands,
source/build identities, measurements, scope limits and cleanup are in the paired
machine receipt. Prior source-only evidence remains available at commit39ea68b4;
this dated continuation supersedes its pending runtime status without altering
what actually happened in the earlier attempt.

Agent: ChatGPT-CalInvitationRuntime-20261017
