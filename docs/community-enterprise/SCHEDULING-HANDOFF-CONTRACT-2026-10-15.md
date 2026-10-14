# Shared scheduling assignment handoff

Baseline: 6e78825dd1f7a15ade590b1a917f1a84f9302394. Existing repository,
enterprise branch, 39-task graph and delivery/research issues remain canonical.
This contract describes candidate behavior; executed results are recorded separately.

## The user outcome

An authorized organization owner/administrator can select a departing member's
shared event, an accepted successor in that same team and the successor's own
configured availability. A read-only review shows the exact reference changes and
blockers. Confirmation replaces one explicit host slot and its source-owned event
references atomically with an audit event. A separate fresh member-removal review
may then proceed if no other responsibilities remain. The handoff does not itself
remove membership, send a booking change or enroll the successor.

The first supported scope is a direct organization/team ROUND_ROBIN or COLLECTIVE
EventType with explicit hosts and no unresolved future appointments or event-level
provider bindings. Ownerless shared events remain ownerless unless the departing
person was their retained owner. Existing owner/profile references belonging to
someone else are not appropriated. Personal event types are outside this command.
The event ID, slug, team and public booking address stay unchanged. Host weights,
priority, group and required/optional status remain slot policy. The replacement
uses a newly created host row with the successor's current membership/schedule;
it does not copy personal calendar credentials or claim to transfer host history.

## What is reused, and what is not fabricated

The retained EventType, Host, Membership, Profile and Schedule models and the
existing EnterpriseAuditEvent are reused. The existing qualified-host and regular
booking algorithms still choose hosts, check conflicts and create appointments.
There is no second scheduler, tenant table, queue, identity system or dependency.

The inspected legacy ReassignDialog contains no-op query/mutation adapters, and
the ManagedEventReassignment DI files do not provide the removed implementation.
Those are not a working future-appointment handoff service. The retained broad
event editor also performs separate provider/calendar/host-group writes, so it
cannot simply be called inside this narrow transaction and described as atomic.
This new command composes retained data and policy for one explicit assignment;
it does not import restricted historical implementations or pretend full reassignment
parity. The generic event editor remains, with its own route/transaction audit work.

## Review and authority

The verified browser session supplies actor ID/UUID. Basic active root OWNER/ADMIN
membership is required; instance-admin status is not a substitute. Directory,
managed-identity and custom-role scopes retain their specialized lifecycle.
Both source and successor must have accepted same-team and root memberships. A
locked departing identity may be handed off without unlocking that identity; the
successor must be active. Successor schedules are their own; calendar appointments
and credential fields are not returned to the administration picker. Effective
schedule timezone includes the user's real fallback, not an assumed UTC default.

A review hash detects changed state; it is not a signed authorization grant or an
agent capability. Confirmation rechecks authority, host policy, source/successor
identity, schedules, profiles and outstanding appointments. A changed review must
be repeated. An exact operation replay returns its recorded outcome and does not
transfer the assignment again. A replay is not a claim that nobody subsequently
changed the event. New agent/REST adapters need explicit delegation and resource
scopes; no operator-cookie, boolean-confirmation or public MCP grant is added here.
The new browser mutations reuse the existing exact-Origin POST boundary.

## Appointment and provider preservation

Existing Booking, Attendee and BookingReference rows are never re-owned, recreated
or cancelled by this command. A future ACCEPTED, PENDING or AWAITING_HOST booking
on the selected event blocks handoff, including collective meetings where a
participant cannot reliably be inferred from a mutable email. Reassign or finish
those appointments through their verified lifecycle first. Rewriting a local
organizer ID is not proof that a Google/Microsoft invitation or conference moved.

Event-specific destination/selected calendars, sender identities, per-host
locations, configured app/payment settings (including disabled bindings) and departing-owner/client-bound webhooks
require explicit configuration/provider work. Managed/automatic host expansion,
recurrence, seats, instant events, shared restriction schedules and inconsistent
host/profile references remain blocked. A successor already assigned is not merged
silently into two weights or fewer collective participants. Address collisions
require review without changing the public URL. These refusals are not implemented
provider handoffs; a blocked review has changed nothing.

Planned member removal additionally inspects source-owned restriction/instant
schedules, another host's source-owned schedule, event destination credentials
and awaiting-host bookings. A handoff must not be presented as complete merely
because one formerly missing reference escaped the earlier removal inventory.
Emergency containment, new-account enrollment, customer notifications and directory
revocation are separate operations, not shortcuts hidden behind planned removal.

## Commit and concurrency scope

The command shares the organization and stable ordered User-row lock discipline
with the existing member and regular-booking paths, then locks the event and its
host rows. Commit uses READ COMMITTED deliberately: after waiting on a host lock,
the subsequent appointment check must see a just-committed booking. The existing
booking guard likewise rechecks assigned-host eligibility after that lock. This
lets the tests distinguish both orders rather than assume concurrent requests ran
simultaneously. An audit/write failure rolls back the local handoff.

This is not a claim that every historical editor, external writer, cache or live
provider joins one distributed lock. Independent configuration changes still need
their own resource authorization and transaction review. The operation reads
current scoped state and fails on changed review/constraints; it must not be
marketed as universal exactly-once provider orchestration. The database tests
exercise the actual retained booking commit guard, not an alternate scheduler.

Primary references used for the transaction design:
https://www.postgresql.org/docs/current/transaction-iso.html
https://www.postgresql.org/docs/current/explicit-locking.html

## Bounded administration and rollout

Event and successor lists are paginated. The single-event operation bounds host/
legacy-user/group relations and schedule availability. Large or complex changes
need an explicit reviewed bulk path, not silent truncation into a smaller handoff.
Existing personal profiles, provider credentials, appointments and other tenant
grants remain unchanged. Test fixtures, source acceptance and deployed service
acceptance are separately labelled. The existing dev/staging/production, identity,
security and migration gates remain open until their own receipts exist.
