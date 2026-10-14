# Accepted-member roles and planned offboarding

Date: 2026-10-14. Baseline: 260c7cbba8b618d34b2f2ebd6c6e4d35f831892b.
Existing repository, enterprise branch and 39-node TASK_GRAPH.json remain canonical.
This is a domain and product contract, not proof of a deployed release.

## Reuse and boundaries

Use the retained Team hierarchy, Membership roles, additive Profile, scoped API
and OAuth grants, and EnterpriseAuditEvent. The existing native administration
screen and authenticated tRPC transport are extended. The retained role-change
modal currently returns null; it is not a functioning member-administration API.
Historical membership deletion and host-cleanup behavior informs preservation
requirements, not permission to transplant restricted historical implementations.
No new schema, dependency, directory, scheduler, IdP or queue is introduced.

This is a reviewed single-person operation for ordinary local organization
memberships. An active owner can change built-in organization roles and transfer
their ownership to another active accepted member. An administrator can remove
ordinary members or their own administration membership, but cannot create owner
rights or remove another administrator/owner. Instance-admin status alone does
not grant access to this organization's member controls. Custom roles, directory
ownership and managed identities require their respective workflows.

An ownership transfer atomically makes the selected member OWNER and the caller
ADMIN. Other owners are not demoted. Root role changes do not erase independent
child-team grants. Last-active-owner checks disregard pending, locked and managed
accounts; child teams must also retain an active owner during root offboarding.

## Review before an atomic command

A review reads current primary state and returns the person, proposed operation,
counts of affected records and explicit blockers. It creates no membership,
revocation or audit mutation. The hash binds the inspected state and exact command;
it is not a signed authority token. A changed grant, identity, profile, policy or
affected credential set invalidates confirmation and requires another review.
The server obtains the actor from the native session, never from a supplied
operator flag. Privileged commands require the configured same-origin POST.

Commit uses bounded serializable transactions, the organization row lock shared
with invitation writers, and a sorted actor/target/owner User-row lock order.
Authorization and impact are checked again. Existing external writers are still
subject to database conflict behavior, not a new universal distributed lock or
live IdP revocation guarantee. At most 500 rows of each inspected resource group
are admitted; larger operations need a separately reviewed bulk path.

The operation and administrative audit commit together. An identical idempotency
key returns the recorded outcome instead of repeating revocation or granting old
permissions again. Actor/payload reuse is refused. A self-removed administrator
may read back their exact prior outcome while their personal account stays active;
that does not restore authority for another action.

## What planned removal may change

The reviewed operation removes the target's root and direct child-team memberships,
the additive profile for that organization and their organization membership
attributes. It revokes API keys in those scopes and OAuth access/refresh/consent
grants for clients owned by that organization, and disconnects the corresponding
client-user association. No credential plaintext is selected or returned.

A role change or ownership transfer revokes affected root-scoped API credentials
and organization OAuth grants, while independent child-team credentials and roles
remain explicit in the review. Removed credentials cannot silently revive upon
later, independently approved re-admission or promotion.

Pending namespaced invitations issued by or to the departing identity are
cancelled. Only exactly matching pending basic-member rows are cancelled; accepted
recipients are not expelled. The parser is shared with the existing invitation
service rather than duplicating its binding format. Historical unknown invitation
formats are not adopted; unclassified scoped links block offboarding until their
admission policy is reviewed. Re-admitting an old issuer does not resurrect a cancelled
pending invitation.

Personal User identity, calendars, provider credentials, event types and unrelated
organizations are not moved or deleted. Past booking records are preserved. This
is not erasure, automatic appointment reassignment or an assertion that the person
loses access to all historical appointments they personally own.

## Stop rather than destroy or overstate revocation

Confirmation is blocked when the inspected state shows a remaining scheduling
assignment, event ownership/profile/schedule reference, future organization booking,
shared provider credential, scoped webhook (including disabled subscriptions),
legacy relocated profile, custom role, directory-managed grant/attribute, hidden
membership-to-Host cascade, nested organization, automatic domain re-admission,
or a last active owner without a successor. An instance-wide administrator cannot
be described as offboarded while retaining broader platform rights.

These blockers require an explicit handoff through the appropriate existing
workflow or a separately reviewed preservation plan. They are not a new automatic
provider/event-transfer engine. This operation is NOT emergency account suspension:
a blocked review has not revoked anything. A security incident needs the existing
IdP/platform containment procedure, independently of planned data handoff.

## Webhook resource boundary discovered during integration

The retained browser webhook procedure previously checked historical user/event
ownership but omitted current team authority. An ownerless team webhook could also
reach its handler without a scoped membership check. The procedure now requires
current primary-backed team permission, rejects conflicting IDs and contradictory
scope, checks current instance authority for platform records, and refuses
client-bound webhooks on this ordinary browser path. Personal webhook owner checks
remain. This is not a complete rewrite of webhook handlers or a transaction-wide
proof for every webhook mutation and background delivery route.

## Future human and agent clients

Future versioned REST/MCP adapters should call the same reviewed domain commands
with explicit client/delegation/resource grants. A review hash, confirmation boolean
or operator cookie must not become agent authority. Consent and actor identity
remain separate from a transport. Community-grade bulk governance, custom-role
editing, member self-service departure, external enrollment, audit-retention policy,
provider handoff and durable notifications remain explicit programme work.

Source, fixture and deployed acceptance remain separate. Test receipts, failure
controls and the exact built revision are recorded in the implementation evidence,
not inferred from the existence of this contract.
