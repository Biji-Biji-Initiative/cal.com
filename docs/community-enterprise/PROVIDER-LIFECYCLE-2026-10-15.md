# Provider-backed appointments: retained-stack acceptance

Date: 2026-10-15. Built application `8ef8268a1fe348549cfa75beed8ca248fd1e30a6`.
Canonical repository/branch and single 39-node graph are unchanged. This is a
local candidate receipt, not a live provider or deployed-service release.

## Completed outcome

The actual application creates a Google-backed appointment and a Microsoft-backed
appointment, retains the exact stored provider/calendar/event binding after the
user's default destination changes, reschedules the appointment through the native
booking endpoint, and cancels it through the existing CSRF-protected endpoint.
Both providers receive the expected create/update/delete requests against the
original calendar. The private fixture confirms no remote resource remains after
its accepted deletion. New default-calendar preferences do not redirect existing
appointment mutations into the wrong calendar.

This is a repair of the retained Cal.diy provider/booking stack. No new scheduler,
identity system, queue, dependency, schema or provider-administrator transfer API
was introduced. The previous scheduling-handoff UI still refuses booked/provider-
bound cases; this slice does not claim to have implemented that later command.

## Defects reproduced and repaired

Google update selected primary when the recorded external calendar was absent
from the current destination list. Microsoft update/delete used a default-calendar
path and did not encode opaque identifiers. Google 404 deletion was treated as
completed despite also representing a potentially inaccessible calendar.
CalendarManager treated missing/empty adapter results as success; failed creation
could consequently produce an empty reference. EventManager could reuse a previous
reference's account or fan out an unbound legacy reference across multiple accounts.

The retained adapters now target the stored resource. Explicit provider/account/
delegation bindings are respected; an unresolved concrete binding fails. Legacy
unbound references retain only the single eligible-account compatibility path.
Explicit delegation retains its historical precedence over an old numeric ID and
must still match the provider. There is no fallback that probes another account
or calendar merely to obtain success.

A usable provider resource identity is required for creation/update success.
Invalid results remain failure entries, not blank BookingReference rows. Result
metadata and Google Meet associations now match the reference binding instead of
assuming result/reference arrays share positions. A merge waits for confirmed
replacement updates before deleting a different old resource. Old-provider cleanup
failures remain visible to the existing rescheduling integration-status path.
Independent provider failures do not reuse another provider's credentials.

The touched mutation error paths no longer copy raw provider exceptions into routine
logs/status messages; such exceptions can contain OAuth headers or request bodies.
A synthetic-marker test proves the manager log/status boundary. This is not a
whole-application logging audit: other inherited read/provider/job paths remain
separately reviewable. Exceptions still propagate where the provider interface
requires them; no network effect or retry is silently invented.

## Exact native application evidence

| Item | Result |
| --- | --- |
| Built source | `8ef8268a1fe348549cfa75beed8ca248fd1e30a6` |
| Build ID | `Wm0_kaH-OIf5GW270l-3l` |
| Build manifest SHA-256 | `bd3aafc70430c78a506606acd41c782562e568628c8a55074f898e866321a19d` |
| Build origin | `http://127.0.0.1:38917` — local test artifact, not a public-host image |
| Install/generation/registry/static assets | Fresh ordinary immutable installation and generation steps passed; no old receipt relabeling |
| Native tRPC and optimized web build | Passed |
| Focused provider source/wire tests | 40 passed |
| Real PostgreSQL provider lifecycle | 14 passed |
| Existing native provider/manager unit files | 65 functional cases passed in their existing CI mode |
| Enterprise source command | 488 passed; includes the focused provider subset |
| Assembled browser journeys | Seven pass on the same application |

The provider browser uses native session issuance, actual booking routes,
EventManager/CalendarManager, the retained Google SDK and Microsoft OAuth/adapter
code, generated Prisma and real PostgreSQL. App configuration, token-shaped
credentials and provider resources are synthetic. Only external provider HTTP is
intercepted in a test-process preload, with unhandled external requests refused.
No token is recorded in the provider receipt. The test does not assert actual
Google/Microsoft OAuth consent, refresh, scope grants or real cloud acceptance.

It opens the real public booking page and performs create, default-preference
change, reschedule and cancellation for each provider. Reference readback proves
unchanged provider event ID/calendar/account through rescheduling. Six provider
write requests are recorded: POST→PUT→DELETE for Google and POST→PATCH→DELETE for
Microsoft. Each stays on its original calendar. Booking/reschedule/cancel notices
reach only the local SMTP sink, not an external inbox. The six earlier admin,
onboarding, handoff and team/multi-host journeys also pass as regressions.

The 14 database cases execute actual source and generated Prisma against the
private fixture but explicitly control auth/registry/rendering boundaries. They
cover account/provider mismatch, legacy ambiguity, failed results, reference
preservation, partial cleanup and an async update-before-delete barrier. They are
not fourteen full browser/provider journeys. Counts overlap and must not be added
as independent production end-to-end cases.

## Failures and negative controls retained

With actual adapter code/SDK and intercepted HTTP, the corrected six-case baseline
produced four failures in stored-target/deletion semantics. Reusing the baseline
adapter source in a scratch-only fixture reproduces four failures; baseline manager
outcome logic produces ten. Production files are not rewritten for these negatives.
The current positive suites run unfiltered and pass.

Initial new fixture errors were corrected against the actual contracts: Microsoft
OAuth requestRaw, Prisma's PostgreSQL driver adapter, the PostgreSQL name-to-text
identity query, node:process import and the shared timezone plugin setup. These
were fixture faults, not hidden product failures. The first strict delegation
change also contradicted retained precedence; that compatibility was preserved
with explicit provider matching and a regression test.

An inherited date benchmark compared UTC millisecond windows to local-DST calendar
arithmetic. Its reference comparison is now explicitly UTC. A separate noisy
shared-host performance-ratio failure remains recorded; functional unit acceptance
uses the suite's existing CI behavior, which does not assert that timing ratio.
No performance improvement, warning-free install or full repository unit result
is claimed. Native type checking caught and corrected an undefined-result access.

## Security and qualification limits

Changed-file Gitleaks reports no new secret finding. Any identical inherited test
fixture finding is retained with a baseline comparison, not removed from the scan.
Five production-source UBS scans completed rather than timing out. Their reported
22 critical-level constant-time-comparison heuristics are comparisons of provider,
resource/delegation IDs, email/calendar identifiers, enum/type discriminators
and content encoding—not comparisons of OAuth token or password contents. The
operands were read back and the findings remain unsuppressed.

Six warnings remain: four inherited Microsoft fetch operations lack explicit
AbortSignal cancellation, and two inherited parse sites propagate malformed-data
failures. These are not relabeled clean or resolved by the provider-target repair.
Full provider timeout/recovery, other logging paths and image-level dependency
security remain release work. No whole-repository/image approval is granted here.

## Next boundary and task graph

This ordinary provider lifecycle is the prerequisite for a trustworthy transfer
of already-booked future appointments. That later operation still needs explicit
actor/resource approval, provider-specific supported organizer semantics, durable
operation identity, partial-outcome reconciliation and participant notification.
PostgreSQL rollback cannot undo an external calendar request. A timeout or 404 is
not authority to delete elsewhere or claim successful transfer.

Existing Tasker is prior art, not proof of exclusive claims or exactly-once provider
effects. Other older cancellation/background/API callers may still ignore cleanup
failure results; their follow-through is not established here. The previous
provider/future-appointment handoff blockers stay in place. Community enrollment,
live IdP/provider integration, approved publishing permissions, image security,
migration/restore and staged deployment remain open in the same task graph.

```sh
yarn test:community-enterprise
yarn test:community-enterprise:provider-lifecycle --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:provider-journey --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

The source command now explicitly caps node test concurrency at four, using the
existing runner rather than creating another verification lane. No production,
real account, provider, credential, invitation, mailbox or deployment changed.
Final teardown, file-hash readback and archive location are recorded in issue #78.

## Continuation readback and additional refusal tests

The previous interruption had left the application and seven local journey receipts
intact, with only a synthetic App seed correction uncommitted. This continuation
inspected the exact source, build identity, recorded provider requests and pending
edit rather than rebuilding or relabeling the application. Required App categories
and updatedAt now appear explicitly in that native fixture. The fixture edit is
separately committed test code, not an application schema or source change.

The original 481 source cases, 14 database cases and actual built provider journey
were rerun successfully on resume. Seven additional focused cases then strengthened
provider refusal behavior: Microsoft Teams body-read failures cannot be followed
by PATCH or a fallback calendar probe; denied deletions target only the stored
calendar; Google failed updates do not retry against a new preference; the legacy
Microsoft all-calendar deletion path supports a normal empty success response;
and invalid numeric resource identities cannot become create/update success.

The retained three native unit files were also rerun successfully, 65 cases, with
one worker and their existing CI-mode behavior. The final source command passes
488 cases; 40 belong to the focused provider suite. None of those totals is a
count of independent cloud or production tests. New test-only changes do not
invalidate the unchanged production build but have their own commit provenance.

The original app mutation interfaces still do not represent a recoverable provider
transfer operation. Non-calendar cleanup adapters, callers that ignore cleanup
failures, recurring aggregation, merged references with coincident IDs across
accounts/calendars and all external retry/reconciliation behavior require separate
acceptance before future-appointment handoff is released. This receipt does not
promise complete coverage of those older paths. It specifically establishes the
ordinary Google/Microsoft resource lifecycle and the exercised refusal contracts.

Provider API references were rechecked during the continuation. Microsoft documents
that a successful delete has no response body and that an online-meeting body
must preserve its meeting content. Google documents that 404 can represent a
calendar the caller cannot access; it is not sufficient deletion evidence. The
synthetic tests are consistent with these contracts, not a replacement for the
required real-provider sandbox tests. Raw provider credentials, customer calendars
and the user's own calendar accounts were not used.

Continuation recorded: 2026-10-15T02:36:11.593883+00:00 (UTC).
