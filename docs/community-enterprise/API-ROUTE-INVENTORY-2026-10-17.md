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

## Boundary

This is an AST/source inventory. It does not claim that every dynamic Nest
module route or every runtime request path is exercised. The existing
API-PERMISSION-BINDING and API-PERMISSION-RECEIPT evidence carries the native
PostgreSQL/HTTP, guard-order, ownership and negative-control checks; remaining
live IdP, complete resource matrix and serving-image acceptance stay open.
