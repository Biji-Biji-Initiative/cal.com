# Retained provider lifecycle: resource identity and honest outcomes

Date: 2026-10-15. Baseline: 239241cce2e87f161a258339712d74ebf34991b1.
Same repository, enterprise branch, task graph and delivery/research threads.
This is a prerequisite slice for future-appointment handoff, not an implemented
provider-organizer transfer UI or a new scheduling/queue system.

## Why repair before orchestration

The preceding wave safely hands over future scheduling configuration only when
there are no future appointments or provider-specific bindings. Existing booked
appointments are a different operation: their stored provider, credential,
calendar and event identity must survive changes in a user's default calendar.
The retained adapter pipeline did not consistently preserve those distinctions.
Building a new handoff screen on those methods would turn ambiguous outcomes into
false success. The current slice repairs that existing pipeline rather than
copying removed enterprise code or inventing a second provider abstraction.

## Retained components and required behavior

| Existing component | Required outcome |
| --- | --- |
| Google Calendar adapter and installed SDK | Update the recorded calendar, not the current destination preference; propagate ambiguous deletion failures |
| Microsoft Calendar adapter and existing OAuth manager | Use the recorded calendar/event with encoded opaque identifiers; preserve online-meeting content on the same resource |
| CalendarManager | A missing adapter or empty creation/update response cannot be successful; valid empty DELETE response is not a failure |
| EventManager | Resolve each reference independently, preserve declared provider/account/calendar binding, and refuse ambiguous legacy account fan-out |
| RegularBookingService and existing appsStatus | Retain old-provider cleanup failures alongside new-provider results rather than discard them |
| BookingReference | Do not create an empty reference from failed work; reference/result association is by binding, not array position |
| Existing native/database/browser runners | Exercise these same components using only synthetic accounts and intercepted provider HTTP |

No application dependency, schema/migration, credential format, queue or live
provider account is added. Existing delegation identity keeps its established
precedence over an old numeric credential field, but must still match the provider.
A legacy reference with no binding may use one unambiguous eligible retained
account; this is compatibility behavior, not new proof of historical ownership.
A concrete missing/mismatched/invalid reference is never replaced by whichever
credential happened to be used for a preceding result.

## Outcome boundaries

Calendar creation/update requires a usable provider resource ID. Invalid/empty
responses remain failed results and cannot mint blank BookingReference rows.
Integration result lists may therefore have failures without corresponding new
references. Metadata such as a Google Meet link must match the actual reference's
account/calendar binding and cannot use an unrelated array position.

Deletion may legitimately succeed with no response body. Google 410 on its event
DELETE retains the existing already-deleted idempotency. Google 404 is not treated
as proof of deletion because it can also mean the caller lacks access to that
calendar. No fallback probes another calendar or credential merely to obtain a
successful status. Microsoft legacy references without a calendar use its
all-calendar event endpoint; explicit calendar references remain explicit.

A merge waits for all replacement calendar updates to settle successfully before
attempting original cleanup, and does not delete an identical referenced event.
A failed cleanup is returned as an integration failure. Independent provider
failures do not cause another account's credential to be reused. This is not an
atomic transaction across PostgreSQL and external services. In particular, a
provider timeout can leave an ambiguous remote effect; ordinary retry is not a
substitute for readback and reconciliation.

Existing calendar cleanup callers receive bounded failure results. The ordinary
organizer-changing reschedule path carries them into its established integration
status reporting. Other older cancellation/job/API callers may still ignore those
results and need their own follow-through. A local booking cancellation is not
universal evidence that every external invitation, meeting or CRM object vanished.
Non-calendar provider adapters and external notifications retain independent
acceptance requirements. No new automatic destructive retry is added here.

## Explicitly unfinished handoff design

The provider-bound blockers in SchedulingHandoffService stay in force. An actual
future-appointment transfer needs an approved actor and exact source/destination
resources, a durable operation identity, current state/availability checks,
provider-specific supported actions, and recoverable partial-outcome state.
Only after the remote result is read back should new local reference ownership
and participant-change notifications be reported complete. Google and Microsoft
must not be assumed to share organizer-transfer semantics or notification controls.

The existing Tasker/Task model is prior art for asynchronous work, not automatic
proof of exclusive claims, idempotent provider effects or crash recovery. Its
claim/retry/observability contract must be established before it is used for a
multi-stage destructive workflow. No new queue or speculative durable ledger is
silently introduced by this repair. UI, future REST and MCP adapters should share
that eventual reviewed command and delegated authority rather than borrow an
operator's browser cookie or duplicate business logic.

## Verification and source references

Focused tests intercept actual SDK/fetch requests from the retained adapters and
check the method, encoded calendar/event address, success shape and failure path.
Database tests use the actual generated Prisma client and EventManager against an
explicit private PostgreSQL fixture, with declared registry/auth/rendering doubles.
A separate built application journey keeps native authentication, application
routes, provider adapter/auth code and database persistence, intercepting only
provider network responses. Such fixtures are not live OAuth/provider acceptance.
Exact results, failures, build identity and publication are recorded after execution.

Primary contracts consulted 2026-10-15:
- https://developers.google.com/workspace/calendar/api/v3/reference/events/update
- https://developers.google.com/workspace/calendar/api/v3/reference/events/delete
- https://developers.google.com/workspace/calendar/api/guides/errors
- https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/event-delete?view=graph-rest-1.0

The retained source, these provider contracts and discriminating tests govern this
slice. Nothing here grants image-security approval, live IdP/provider acceptance,
new community enrollment or dev/staging/production promotion.
