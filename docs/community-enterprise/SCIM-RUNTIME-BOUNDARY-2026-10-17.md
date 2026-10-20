# SCIM and IdP revocation source boundary — 2026-10-17

This file retains the October 17 source checkpoint and the subsequent bounded
source/database acceptance. It supports `CAL-04.SCIM` and `CAL-04.REVOCATION`;
both tasks retain their real provider and application acceptance gates.

## Current source/database checkpoint — 2026-10-20

The additive `ScimUserIdentity` and `ScimMembershipGrant` migration landed in
`0f2ac6956f`. Eleven real isolated PostgreSQL 18 tests cover exact scoped keys,
restrictive references, rollback/replay refusal, empty provenance without
inferred backfill, and preservation of existing users, custom roles and bookings.

`ScimIdentityService.ts` provides exact reviewed operator binding/resolution
under current organization, directory, tenant, operator, user UUID and accepted
membership checks. Original organization/directory/tenant audit provenance is
required on subsequent resolution. Source delivery `d9ef369c7e` passed fifteen
isolated PostgreSQL tests, including actual lock-wait operator revocation,
competing mappings and atomic audit failure. The child-team grant integration
adds pending-payment/platform-root refusals and keeps the same transaction open
through the mapped team/member/provenance write.

`ScimGroupMembershipService.ts` is a reviewed operator adapter for an exact
existing directory/group mapping to a direct child team. It creates only a
native accepted `MEMBER` with provenance and audit in one transaction. Existing
local memberships are preserved; ambiguous provenance, privileged/custom roles
and role/acceptance/nullable-timestamp drift are refused by
`ScimMembershipProvenance.ts`. Twenty isolated PostgreSQL tests exercise
these boundaries, rollback, replay, competing absent-member requests and
explicit managed team membership deactivation.
The source guard has nine additional focused controls.

The `deactivate` operation accepts only an explicit `group-member-remove` event.
It requires the same current exact identity, directory/group mapping and
unchanged MEMBER provenance as a grant. It atomically marks the native team
membership unaccepted, advances its managed acceptance/timestamp snapshot and
records an audit event. Existing local grants, root-organization admission,
users, native Host rows and past/future bookings remain unchanged. Deleting
Membership would cascade-delete Host rows, so this operation retains them.
Actual current host-selection and booking-commit services exclude the inactive
member; a deterministic PostgreSQL lock-wait test proves a booking commit waits
for in-flight deactivation and then refuses the stale selected host. Collective
hosts do not silently become smaller meetings. Audit failure rolls back both
membership and provenance. Filter-change/sync snapshots cannot invoke this
operation, and `add` cannot reactivate it. Future bookings still require a
separate reviewed handoff; this operation does not queue or execute one.

The bounded inventory now reports these three SCIM source modules. The two
original request/provisioning contracts remain write-free. Direct API v2 SCIM
routes and IdP HTTP dispatch remain absent in the inspected scope. No hosted
schema migration, native service injection, SCIM token issuance, provider
dispatch, membership deletion/user-wide deprovision, session revocation or 60-second
multi-replica acceptance is claimed. Local fixture evidence does not authorize
application database execution.

## Historical source contract — 2026-10-17

`packages/features/community-enterprise/identity/ScimProvisioningContract.ts`
contains a write-free SCIM value and plan boundary. Its source-level checks
cover the SCIM User, Group PATCH and ListResponse shapes; bounded paging;
exact `externalId` mapping; grant provenance; and reconciliation planning that
preserves local grants and booking history. A directory filter change produces
no membership-removal operation. Disable/deprovision planning stops new
assignment, queues existing bookings for handoff, and removes only a
SCIM-sourced grant in the plan.

The existing `AuthentikIdentity.ts` checks are a separate local session
boundary. They re-read the linked Account/user row and reject a locked,
unlinked, rebound, or issuer-mismatched local identity. Those checks do not
query Authentik, consume SCIM events, or prove an IdP application-access
change reaches every replica within 60 seconds.

## Historical bounded inventory — 2026-10-17

The companion inventory and test inspect tracked `apps/api/v2/src` and
`packages/features/community-enterprise/identity` source. On the recorded October 17 revision:

| Boundary | Result |
| --- | --- |
| SCIM contract module | Present and write-free |
| Direct SCIM HTTP route in `apps/api/v2` | No candidate found |
| Direct SCIM adapter beside the enterprise identity modules | No candidate found |
| Direct HTTP call in the enterprise identity modules | No candidate found |
| Local session lock/link checks | Present in `AuthentikIdentity.ts` |
| Authentik discovery/token dispatch/persistence worker | Not evidenced by this inventory |

The inventory is intentionally static and narrow. It does not certify that a
dynamic route cannot exist elsewhere, that a module is registered, or that a
database adapter is absent from the rest of Cal.com. Existing core DSync
models and UI strings are not treated as an Authentik SCIM runtime because
they do not provide direct evidence of this enterprise route, token boundary,
or deprovision worker.

## Remaining acceptance

`CAL-04.SCIM` remains **open**. The source contract is useful evidence, but
runtime acceptance still needs a scoped Authentik SCIM credential, discovery
and User/Group dispatch, persisted membership provenance, disable/deprovision
handoff, and real application API/database checks. The local PostgreSQL acceptance above
qualifies its explicit source boundaries only.

`CAL-04.REVOCATION` remains **open** with no runtime evidence. Its required
proof still includes disabling a user and removing application access at the
real Authentik service, replaying the same browser session and bearer across
every replica, measuring the approved 60-second bound under delayed/missed
notifications, and verifying the configured MFA/application policy and
alternate-login exclusion.

## Reproduction

```sh
node --test --test-reporter=spec tests/community-enterprise/scim-runtime-boundary.test.cjs
node scripts/inventory-scim-runtime-boundary.cjs
```

The test is source evidence only. It must not be promoted to `runtime` or
used to close either graph task.
