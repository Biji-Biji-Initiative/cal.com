# Shared scheduling handoff: assembled acceptance

Date: 2026-10-15 (Pacific/Guadalcanal). Tested application: `094ae76b06e8834f227768d0b5d1d829acacdd88`.
Canonical repo/branch and the existing 39-node task graph remain unchanged.
This is a local application acceptance record, not a deployed service receipt.

## Completed vertical slice

The existing member-management UI can now review one departing person's explicit
round-robin/collective shared host slot, select an accepted successor in that team
and the successor's own configured availability, then confirm an audited handoff.
A separate fresh removal review can then remove the old membership when no other
responsibilities remain. The same public team booking address is retained and a
new anonymous guest booking resolves to the successor through the existing booking
engine. No account, membership or integration credential is created implicitly by
confirming the handoff.

Event ID, slug, team, required-host semantics and host policy are preserved. Only
the source-owned event owner/profile/host-list/main-schedule references are changed.
Existing Booking/Attendee/BookingReference rows, personal schedules, credentials,
private identity and unrelated memberships are not re-owned or erased. Historical
appointments keep their original organizer. Retrying the exact operation returns
the recorded result and does not move the assignment again.

The command is deliberately not future-appointment or provider reassignment.
Any future ACCEPTED/PENDING/AWAITING_HOST appointment on the selected event blocks
it. Event-level calendars, conferencing, sender settings, app configuration
(including disabled provider bindings), relevant webhooks and special/managed/
automatic event types require their own verified workflow. A populated blocker
means no handoff occurred. No enterprise license bypass, copied restricted
implementation, new scheduler, tenant database, queue, dependency or migration was
introduced. SCHEDULING-HANDOFF-CONTRACT-2026-10-15.md records the retained prior art,
authority and limited concurrency guarantees.

## Actual browser and database sequence

Three distinct encrypted native sessions are obtained from the local TLS test
issuer. Organization and team creation use the implemented application APIs;
existing scheduling and private-history records are synthetic fixture inputs.
The administrator's browser first sees that removal is blocked by the host
assignment. It opens the real handoff UI, selects event/successor/schedule and
reviews the effects without a database mutation.

A controlled host-weight change invalidates the first confirmation. A fresh review
and confirmation update exactly one host slot, preserve the original team URL and
record one audit. No email is emitted for this configuration change. The separate
member-removal UI then completes; the same old session no longer sees the removed
organization. Personal identity, private synthetic provider credential and the
old appointment record are read back unchanged.

An anonymous browser opens the unchanged team URL, observes no offered slots for
the departed host and available slots for the successor, creates an actual new
booking owned by that successor, and cancels it through the retained CSRF-protected
endpoint. Notification delivery is captured only by the local SMTP sink. No real
Google/Microsoft/calendar/conferencing provider, external inbox, live Authentik,
SCIM or deployed handoff is exercised by this record.

All five earlier browser journeys also pass against the same application:
member lifecycle, invitation/consent, initial organization admission, first-user
setup and team/guest/multi-host booking. These preserve prior accepted behavior;
they do not constitute new independent production scenarios.

## Verification scope

| Check | Result |
| --- | --- |
| New real PostgreSQL handoff cases | 60 passed, zero failures/skips |
| Existing real PostgreSQL member lifecycle | 63 passed, zero failures/skips |
| Existing enterprise source regression command | 448 passed, including the overlapping router subset |
| Native router contract | 37 passed, including nine handoff transport cases |
| Native web and test/import-closure type checks | Exit 0 against actual installed/generated types |
| Optimized changed application build | Pass; unchanged dependency/generator receipts keep their source identities |
| Native browser journeys | Six pass with real local application/DB/session crypto and synthetic IdP/provider resources |
| Build ID | `7-1B_F8wMQYi6_Vjopd01` |
| Build manifest SHA-256 | `8e8ae55f20f58474eab02ef654ac8a018c46a97e747807fb90f2bcd4ba139d64` |
| Local origin | `http://127.0.0.1:38917` — not a public-domain image |

The initial database run exposed a missing explicit managed-event classification
and a test fixture missing the retained required webhook ID. Both were corrected;
no failure was hidden. Effective schedule timezone fallback was then bound to the
successor's real user timezone, and disabled app bindings/malformed legacy config
were explicitly blocked rather than silently inherited.

The real booking race tests pause transactions and observe actual PostgreSQL lock
waiting. When a booking commits first, the waiting handoff sees the new appointment
and refuses. When handoff commits first, the waiting stale departing-host booking
fails the retained guard's current eligibility check. The normal successor booking
is still permitted. These tests use the existing BookingCommitGuard, not another
scheduler or a simultaneous-client-start assumption.

Two temporary source negatives on the 55-case suite detected the intended defects:
skipping review freshness caused 4 failures; using a pre-wait repeatable snapshot for commit
caused 2 failures. Original bytes were restored before further changes and the
final application build. The 58-case suite added disabled/malformed provider
configuration tests; the final 60-case suite also includes the two Host-reference
update checks below. Real audit constraint failure proves atomic rollback of the
local event/host/audit changes. This is not a claim that every historical editor
or external writer joins the same locks or that provider effects are transactional.

Planned offboarding also now inventories source-owned restriction/instant schedules,
a different host's source-owned schedule, event destination credentials and
AWAITING_HOST appointments. A previously omitted reference must not be interpreted
as a completed handoff. The generic event editor and dormant legacy reassignment
UI still have broader independent audit/implementation work; this slice does not
claim those features were made complete by wiring a no-op.

## Update guard and initial browser-fixture correction

The previous member-removal database-catalog contract is extended to the Host row
this operation replaces. The two added tests read the actual incoming Host foreign
key/delete actions and require the reviewed HostLocation relationship. A synthetic
new ON DELETE CASCADE relation makes that acceptance contract fail; the dependent
row and event/member/profile snapshots remain untouched because no handoff is run
during the negative. The synthetic table is removed and the original contract
passes. This guards upstream schema acceptance, not every live request, arbitrary
trigger or background side effect. No persistent schema/migration was added.

The first browser attempt reached the successful handoff, removal, same public
page and successor-owned booking, then the existing loopback SMTP sink rejected
an unlisted synthetic guest address. The test was corrected to an already-permitted
synthetic recipient and the unchanged application was rerun. The sink allowlist,
transport restrictions and production code were not relaxed. The final test checks
both booking and cancellation notices and captures four local messages. An anonymous
booking browser is separate from the three native staff sessions; its email need
not confer organization membership. The initial failure remains in the receipts.

## Security and preservation

Five separate production source scans completed: zero critical findings, one
warning and 108 informational findings. The warning is the existing local async
handler named confirm, not a browser blocking-dialog invocation; it remains
unsuppressed. Changed-file Gitleaks reports no new secret findings; the inherited
locale translation-key finding is byte-for-byte matched against its baseline and
not relabeled clean. This is not a new full-codebase/image-security assessment.

No live account, membership, key, calendar, email, provider, domain, registry scope,
database or deployment was changed. The public Agent Mail registration was refused
with nonretryable 403/1010 at 2026-10-14T21:43:52Z, ray a4a9c31b8ffa9750; no identity,
lease, alternate mailbox or spoofed client was used. No additional agents or task
system were created. Production, private drafts, original backup artifacts and
existing release gates remain untouched.

## Remaining programme work

Provider-bound events and already-booked future appointments need explicit
calendar/conferencing-aware handoff and participant notification/recovery. Managed
and automatic-host workflows, custom-role/directory governance, community enrollment,
live IdP/provider acceptance, image publication/security and staged deployment are
still open. This configuration handoff is one completed local user journey, not
blanket offboarding readiness for every event or integration.

```sh
yarn test:community-enterprise:scheduling-handoff --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:handoff-journey --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise
```

Fixture teardown and GitHub file-hash readback are recorded in issue #78. The
post-build evidence commit does not change the application; never relabel a later
documentation-only branch tip onto the built revision above.
