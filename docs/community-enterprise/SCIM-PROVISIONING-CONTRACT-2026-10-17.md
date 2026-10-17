# SCIM provisioning source contract

This is a bounded source proof for `CAL-04.SCIM`, with the retained API and
membership boundaries visible to `CAL-05.API`. It adds a write-free contract at
`packages/features/community-enterprise/identity/ScimProvisioningContract.ts`.
The contract is deliberately an adapter boundary, not a claim that Authentik,
SCIM credentials, or a production endpoint are configured.

## Contracted behavior

The pure parser and planner enforce the parts of the enterprise requirement that
can be reviewed without an IdP or database:

* SCIM user resources must carry the core User schema, an explicit non-empty
  `externalId`, and a username. The external ID is returned byte-for-byte;
  email, username, and display name cannot become an identity fallback.
* Group PATCH accepts only `add` and `remove` operations on `members`. A future
  adapter must map these values to retained `DSyncTeamGroupMapping` rows rather
  than treating arbitrary SCIM attributes as roles or permissions.
* List responses require explicit 1-based paging metadata, an exact
  `Resources`/`itemsPerPage` count, and a maximum page size of 100. The cursor
  cannot skip past `totalResults`.
* Reconciliation plans carry the directory ID and source `scim`. A group-sync
  plan removes only stale SCIM grants and preserves local grants. A directory
  filter change produces no revocation operations. Disable/deprovision plans
  stop new assignment and queue rows with booking history for handoff; explicit
  deprovisioning can remove only SCIM-sourced grants.
* Every plan advertises preservation of local grants and booking history. The
  module performs no Prisma writes, token issuance, locking, or external calls;
  the eventual implementation must execute a reviewed plan in a current,
  authorized transaction.

## Reproduction

From the repository root after the pinned dependency install:

```sh
node --test --test-reporter=spec tests/community-enterprise/scim-contract.test.cjs
```

The eight source cases cover exact external-ID handling, unsupported user/group
shapes, bounded page cursors, filter-change no-op behavior, local-grant
preservation, stale SCIM-grant removal, and disabled/deprovisioned booking
handoff planning. They compile the owned TypeScript contract in memory and do
not read credentials or connect to PostgreSQL, Authentik, or a running API.

## Boundary that remains open

This source contract does not implement a scoped bearer-token endpoint,
Authentik discovery, user PUT/group PATCH HTTP dispatch, persistence of the
plan, real directory membership writes, or the approved 60-second multi-replica
revocation test. `CAL-04.SCIM` therefore remains **open** and its required
evidence level remains runtime. The existing API route inventory and permission
binding records likewise remain source/runtime boundary evidence for
`CAL-05.API`; no API route is promoted by this module.
