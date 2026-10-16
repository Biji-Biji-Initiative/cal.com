# Invitation outbox: source checkpoint, runtime acceptance pending

17 October 2026. Existing `Biji-Biji-Initiative/cal.com` repository and
`work/cal-diy-enterprise-20261010` branch. Predecessor `5a1d207d6367923791c8bcae02f128dfae958c88`.
Exact implementation commits and input hashes are in the paired machine receipt.
This advances CAL-07.AUDIT; it does not close audit, reminders or the shared preview.

## What this continuation actually accomplished

The prior invitation-delivery lane left 18 modified/new code and test files in
the retained checkout. They had been quiet for hours and no matching Cal process
was active. This continuation preserved those exact bytes before reviewing and
finishing the source, rather than reverting, recreating or attributing the entire
implementation to a new writer. One existing inbox source-test file was extended,
so the final publication covers 19 code/test/translation files in seven small
commits. An unrelated pre-existing Python cache file is not part of this work.

The previous native invitation suite had **82 passes and one failure**. Its
50-invitation inbox test expired the actual 10-second interactive read transaction
while the service performed repeated per-row lookups. That failure was not waived
as host slowness or hidden by a larger application transaction timeout.

The pending-page service now parses the selected bindings once and batches the
member, issuer/recipient and organization reads. It retains the existing 51-row
scan, 50-item page, ascending cursor, RepeatableRead snapshot and 10-second bound.
Pure authority predicates are shared with the existing service checks. A pending
member must still belong to the exact bound user and root, have the ordinary
unaccepted MEMBER role and no custom override. Current identity, root and issuer
state determine visibility and actionability. Expired/unverified invitations
remain non-actionable; removed, malformed, wrong-member or directory-owned records
do not acquire authority through batching. Filtered rows still advance the raw
page cursor, so a page of unusable records does not hide a later valid invitation.
A failed batch query rejects the read rather than returning a misleading empty list.

Four new source tests execute the actual service against named in-memory query
boundaries. They observe six logical calls per personal page, including a full
50-item page and its continuation. **This is not a measured PostgreSQL query
count, latency result or proof that the former transaction timeout is fixed in
native execution.** The native test now records actual SQL calls and enforces a
bounded count, but that new test was not run in this continuation.

## Retained durable-delivery implementation now recorded in source

The pending invitation, its administrative audit and an identity-reference-only
Task row are created in the same existing mutation transaction. The task payload
has no email address, provider secret or invitation bearer capability. A replay
finds the same task; a historical invitation with no outbox row is not silently
resent. New notification requests remain explicitly audited and rate-limited.

The request's opportunistic delivery and the existing worker use the same Tasker
claim mechanism. Targeted processing does not drain unrelated queued work or
bypass the global claim limit. Delivery requires the exact task payload/reference,
current claim token and lease, and matching committed audit intent. Current
invitation, issuer, recipient, verified address and directory ownership are
rechecked before the attempted-send marker is committed.

No SMTP operation runs inside that state transaction. The subsequent result is
recorded as submitted, not_sent, suppressed or unconfirmed. SMTP acceptance is
not final inbox delivery. A process interruption, ambiguous transport exception
or failed post-send acknowledgement is not interpreted as permission to resend.
Such work remains unconfirmed for reconciliation. Re-entry also checks the
attempt marker and cannot silently turn a lost acknowledgement into a second
sender. The original sender, kill switch, template and authenticated inbox link
are retained; there is no new relay or accept-on-GET capability.

UI and response copy distinguish queued from mail-server submission and from
uncertainty. The internal task identifier is removed from the browser response.
Recipient consent still creates membership through the existing explicit flow;
a notification alone grants no access. Suppression before an attempted send is
not a promise to recall an email whose external submission is already in flight.
This source work makes no exactly-once external-delivery claim.

## Verification: completed and not completed

| Check | Observed result |
| --- | --- |
| Actual TypeScript import closure | Passed against the existing generated Prisma types, organization service, Tasker registry, tRPC/UI and native fixture sources. No replacement service declarations. |
| Focused source tests | 36 passed, zero failures/cancellations/skips across inbox, invitation mail, Tasker contract and webhook-outcome tests. Includes four new batch-reader cases with explicit in-memory boundaries. |
| Biome error-level check | Passed on all 18 JS/TS inputs; the nineteenth file is the translation JSON. No unsafe suggested fixes applied. |
| Final native invitation/Tasker tests | **Not executed.** The tool invocation was blocked by the execution safety check before a process was returned. The refusal is retained in the machine receipt; no alternative execution route was attempted. |
| Updated browser journey | Source preserved and reviewed; no fresh application build, browser run or actual SMTP delivery in this continuation. |
| Earlier native Tasker evidence | 49 passed on the earlier writer's recorded inputs. Historical evidence only, not a fresh combined-source verdict. |
| Earlier native invitation evidence | 82 of 83 passed, with the pagination transaction timeout still recorded. Not converted into current acceptance. |

The first new type check caught ES5-target incompatibility from iterating Set via
spread. The code now uses Array.from without relaxing the repository compiler
target; the final type and source checks passed. The proposed native test additions
cover actual SQL count and eight identity/root/membership regressions, but compile
success does not turn them into passed database tests.

Source scanning is also qualified. Gitleaks inspected all 19 inputs and retained
one match in unchanged localization text; those containing lines were checked
against the published parent. It did not exit clean, and no new secret finding
was waived. UBS inspected ten production files and reported six heuristic critical
findings, 53 warnings and 135 information items. The critical lines compare public
UI operation identity or bound resource/user IDs, not secret credentials. Warning
groups cover typed Prisma/tRPC/property access, dynamic handler imports whose
rejections propagate to the existing processor catch, and intentional parse
failures handled by the caller. No suppression rule was added. None of this is
application-wide security approval or a reduction of the older image's open ledger.

## Task graph and Beads

All 39 original graph records, criteria, dependencies and milestone boundaries
remain. CAL-07.AUDIT stays in progress; full booking audit, retention and final
outbox crash/retry acceptance remain open. CAL-07.REMINDERS stays open, including
controlled-recipient delivery. No native/runtime completion is inferred from
source checks. The executable task count remains 12 complete and 17 open.

CAL-01.TRACKER remains blocked. The last recorded native Beads migration rejected
schema 5 because its reviewed migration supported only 13 through 16 to 17. No
`.beads` store is present in the active checkout or the inspected existing project
locations on g and g2. This does not prove the historical database was deleted;
its supported recovery source still needs locating/admission. No new tracker was
initialized, no migration/reset was run, and this graph update is not represented
as a successful `br` operation or a closed bead.

## Required next acceptance

The existing maintained private-database runner's invitation and Tasker suites
must pass on the exact combined source when execution is available. In particular,
measure the actual bounded-page SQL, preserve the current timeout, and rerun
commit/attempt/claim/lease/SMTP ambiguity and retry controls. The native browser
journey then requires a fresh matching web build and its isolated controlled
recipient. These are recorded follow-up requirements, not queued background work.
Do not bypass the execution refusal, run against a configured live database or
weaken authority checks to obtain green output.

The older qualified e3a79afb image is not relabeled as this newer source. Registry
publication, native identity/database admission and actual staff-to-guest preview
remain separate release gates. Production, domains, existing data, staff/provider
accounts and publishing/runner permissions were unchanged. All source processes
launched in this continuation are bounded; no new agent or unattended worker was
dispatched. Raw receipts and inherited snapshots are retained at
`/data/tmp/cal-invitation-finish-20261017-extcxq9u` on g2.

Agent: ChatGPT-CalInvitationFinish-20261017
