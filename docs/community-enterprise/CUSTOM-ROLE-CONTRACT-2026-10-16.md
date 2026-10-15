# Scoped local roles: retained-model contract

Baseline: 944473deef33458f0b624f4432534b88ab66c5ae. The existing repository,
enterprise branch, 39-record graph and delivery/research threads remain canonical.
This source slice implements the missing local custom-role assignment mechanism;
it is not a second policy engine, universal entitlement switch or a public agent
credential. Execution evidence is recorded separately after the exact build.

## Reuse and capability boundary

Use the existing Role, RolePermission and Membership.customRoleId, the existing
PermissionPolicy/Prisma and Kysely stores, and the existing EnterpriseAuditEvent.
No new schema, migration, application dependency or directory is introduced.
The UI and native tRPC adapter call the same domain service, with current actor
identity supplied by the server. Existing built-in roles and scheduling services
are not replaced.

The initial assignable catalogue is deliberately limited to two already-scoped
read contracts: eventType.read and booking.readTeamBookings. Existing role records
may express other permissions; that is not evidence that their reachable routes
are safe to delegate. Wildcards, organization administration, editing, API-key
management and the forbidden booking.read/readOrgBookings aliases cannot be added
through this interface. Broader write delegations require their own reachable-route
and mutation-race qualification under CAL-03.ROUTES/CAL-05.API. Do not expand the
catalogue to make a UI test pass or equate this catalogue with all historical cloud
enterprise permissions.

A role applies to one exact root organization or child team. Custom root roles do
not inherit child authority; another team needs an explicit binding. The retained
policy requires an accepted parent membership for a child grant. A custom role
controls these explicit permission checks, not every personal or baseline member
right anywhere in the application. Returning to standard MEMBER restores that
role's ordinary rights, and does not remove membership or delete personal data.

## Who can act and what can change

Only a current unlocked human with a built-in accepted OWNER membership in this
organization can create or assign local roles. Instance ADMIN status or a custom
role named Owner is not equivalent. The chosen scope must be that root or its
actual direct child. Built-in ADMIN/OWNER targets are not downgraded through this
control: the existing reviewed member/ownership workflow remains responsible for
those decisions and last-owner preservation. An inherited root administrator
cannot be presented as a restricted child-role holder while retaining the broad
parent grant.

Existing directory mappings, organization directory ownership and retained
created/updated-by-directory membership attributes cause refusal. A local operation
cannot erase or reclassify them. A custom role with no matching local-definition
receipt, a foreign/global/system binding or an externally modified definition is
not silently adopted. These checks inspect existing recorded provenance; they do
not reconstruct erased historical provenance or implement SCIM. The existing
source-managed membership lifecycle remains separate.

Role creation records the exact permitted definition and its local actor/scope
provenance but grants nobody access. The UI separately reviews a named existing
accepted ordinary member and the before/after role. Review performs no write.
An operation ID supports replay without duplicate creation or regranting an old
assignment over a later change. The actor's current authority is still required.
A replay response describes a recorded historical operation, not permission to
restore its former effect.

Only Membership.customRoleId changes on assignment. Its user/team/accepted state
and built-in MEMBER role remain. Personal User/profile/calendar ownership, other
organization memberships, API-key data and invitation state are not rewritten.
The same client credentials encounter current permission state on subsequent
requests; this is local role revocation, not proof of real IdP revocation timing.

## Concurrency and audit

The short write transaction uses the retained root/user/membership lock order,
locks role definitions and their permission rows, and checks current state after
lock acquisition using READ COMMITTED. Existing organization settings and retained
directory-attribution rows are locked before their ownership is evaluated. No
network request runs inside the transaction. The review hash binds the current
actor, target, membership and role definition; it is a stale-state detector, not
an authorization token.

Role/permission creation and its audit commit together. Assignment and the before/
after definition and grant provenance commit together. Audit failure rolls back the
operation. Current identity and scope are checked again at commit, including a
permission removal that wins while a competing operation waits for the root lock.
The retained database remains the source of truth; bypassing this service with
manual database changes is not made impossible by an application-level contract.

Definitions are immutable through this interface. Replacement means creating a
new definition and reviewing each affected member, not silently broadening every
holder's rights by editing an existing role in place. The historical definition
and assignment audit remains available. No role-deletion/cascade shortcut is added.
The initial interface admits at most 100 definitions and 500 current members per
scope; it refuses beyond the explicit review bound instead of hiding rows or
pretending a truncated list is complete. Scaled pagination/retirement is separate
UI work, not an excuse for unbounded per-request enumeration.

## Human UI and later agent adapters

The existing organization/team settings page hosts this workflow. It presents
scope, named accounts, limited permission labels, before/after review, actionable
errors and local provenance. Scope changes invalidate old form/review state.
Authenticated role mutations require the configured same-origin POST path; the
router does not accept a caller-supplied actor, role administrator flag or source
label. Read endpoints do not enumerate role/member metadata to unauthorized users.
Future REST/MCP adapters must establish their own principal/delegation scope and
current authorization, not reuse an operator cookie or a review hash as authority.

## Acceptance and non-claims

The source criterion is the retained local-role mechanism, assignment/removal,
provenance preservation and effective scoped permissions. Full admin UX, all bearer
readers, custom write permission expansion, directory reconciliation and live
revocation remain separate graph criteria. No live tenant, person or provider is
changed by the isolated tests, and no candidate deployment or production release
follows from this source slice.

Tests must prove owner/member/foreign/instance-admin denials; exact scope; no grant
on creation/review; read-list/detail agreement; personal/coworker-private/sibling
exclusion; stale review and unchanged-session revocation; replay after later changes;
real audit rollback; directory provenance and unmanaged definitions; and observed
lock contention rather than only simultaneous function starts. Prior onboarding,
organization/member/invitation, scheduling, provider and worker contracts remain.
