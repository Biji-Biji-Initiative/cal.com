# SCIM and IdP revocation source boundary — 2026-10-17

This checkpoint records the exact source boundary for `CAL-04.SCIM` and
`CAL-04.REVOCATION`. It is a review aid for the task graph, not a claim that
Authentik is configured or that an HTTP/database runtime has been exercised.

## What is implemented in this tree

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

## What the bounded inventory found

The companion inventory and test inspect tracked `apps/api/v2/src` and
`packages/features/community-enterprise/identity` source. On this revision:

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

## Acceptance consequence

`CAL-04.SCIM` remains **open**. The source contract is useful evidence, but
runtime acceptance still needs a scoped Authentik SCIM credential, discovery
and User/Group dispatch, persisted membership provenance, disable/deprovision
handoff, and real database/API checks.

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
