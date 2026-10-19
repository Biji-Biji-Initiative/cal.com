# API route authorization inventory - 2026-10-17

This read-only source inventory advances CAL-03.ROUTES. It parses the retained
apps/api/v2 controller source with the pinned TypeScript parser and records
route decorators, mutation methods, permission decorators, class or method
PermissionsGuard coverage, and controller files that contain direct JWT or
authorization-token handling.

## Verification

Command:

    node --test --test-reporter=spec tests/community-enterprise/api-route-inventory.test.cjs

Result: one test passed, zero failures, zero skips.

The inventory at this branch records:

- 38 controller files and 38 controller classes;
- 175 route methods, including 89 mutation routes;
- 54 permission-decorated routes;
- zero permission-decorated routes without a method or class-level
  PermissionsGuard;
- 13 controller files with direct JWT or authorization-token reader patterns.

The test executes the inventory script rather than trusting a checked-in count.
It also requires non-empty mutation and permission surfaces and validates every
reported route has a source file, controller and HTTP method.

## Calendar cron authorization correction — 2026-10-19

The retained `calendar-subscriptions`, `calendar-subscriptions-cleanup`, and
`selected-calendars` cron guards interpolated an absent `CRON_SECRET` into a
literal accepted credential. Empty raw-key or bearer configuration could also
admit empty or whitespace query credentials. These guards now require a
nonblank configured raw key or the existing hardened Tasker bearer verifier.

The configured raw-key and bearer forms remain supported through both their
existing header and query transports. An incorrect header still takes precedence
over a valid query; bearer case matching is unchanged. Raw key comparison
preserves exact bytes: added or removed whitespace is rejected, including when
a configured nonblank key contains whitespace. Authorization reads the current
configuration on every invocation and runs before dependency creation,
repository queries or provider work.

Focused reproduction:

```sh
node --test --test-reporter=spec tests/community-enterprise/calendar-cron-authorization.test.cjs
```

The regression executes all three actual route handlers and the existing real
Node crypto verifier, with explicit repository, provider and framework doubles.
Before the correction, 15 cases failed and 33 passed; afterward all 48 pass,
without failures or skips. Rejections cover absent and blank configuration,
literal undefined/null credentials and incorrect/missing credentials. Positive
controls exercise both configured forms in both transports, alongside header
precedence and configuration removal.

This is source acceptance. It makes no live cron requests, database calls,
provider calls, customer sends or deployment claim.

## Boundary

This is an AST/source inventory. It does not claim that every dynamic Nest
module route or every runtime request path is exercised. The existing
API-PERMISSION-BINDING and API-PERMISSION-RECEIPT evidence carries the native
PostgreSQL/HTTP, guard-order, ownership and negative-control checks; remaining
live IdP, complete resource matrix and serving-image acceptance stay open.
