# Linked-booking audit authorization — 21 October 2026

This is a bounded `CAL-07.AUDIT` source milestone on the original enterprise
branch, implemented by JadeFrog (30264) under the operator's coordinator delegation
and exact canonical Mail reservations (claim message 150914). The leaf remains
`in_progress`; its original owner role, dependencies and acceptance are retained.

## Resulting behavior

`BookingAuditViewerService.getAuditLogsForBooking` previously authorized the
current booking, then fetched and enriched the audit of its `fromReschedule`
booking without checking that second resource. A link to another person's
booking could therefore expose its audit and actors through an authorized
current booking.

The viewer now asks the **same retained `BookingAuditAccessService`** about the
predecessor, with the same user and organization context, before its audit query
or enrichment. A permission/not-found/ownerless refusal omits that optional
history; unexpected database or policy failures propagate. Primary-booking
authorization still precedes either audit read. Authorized predecessor history
continues to render, and no booking, actor or audit record is modified/deleted.

No new role engine, permission string, schema, queue, producer or provider path
is introduced. The existing access service still implements its recorded
owner-only policy; organization/PBAC restoration remains an explicit gap.

## Actual acceptance

Base source is `04fb26a010e33152ca0ebcab03131336f4c81f3e` plus this exact scoped
candidate. Existing locked dependencies, Node20.19.5, generated Prisma6.16.1,
checksum-qualified matching schema engine and official local PostgreSQL18.6
were reused. No install, full build, browser E2E or unchanged local-app/SCIM
qualification was repeated.

| Check | Actual result |
| --- | --- |
| Old-source real PostgreSQL regression | 3 passed, 4 failed, 0 skipped |
| Fixed-source real PostgreSQL component | 7 passed, 0 failed/skipped |
| Old-source viewer regression | 34 passed, 2 failed |
| Fixed native viewer + access Vitest files | 40 passed, 0 failed |
| Changed viewer/test strict native import closure | exit0, real generated types and owning ambient declarations |
| New CJS fixture `tsc --allowJs --checkJs` | exit0 |
| Owned Docker runner controls | 11 passed |
| Changed TypeScript/CJS/JSON Biome, Python compile/tabnanny, diff checks | exit0 |

The database cases cover allowed history, foreign-owner history, deleted and
ownerless predecessors, changed ownership on a later request, primary denial,
and no predecessor link. They verify zero forbidden predecessor queries or
enrichment and unchanged persisted bookings, actors and audit rows. The foreign
owner also belongs to a different organization, but the denial proves the
current owner policy, **not** enterprise organization/PBAC enforcement.

The fixture executes exact native booking/membership repository method bodies,
the real access service, native Prisma audit repository and viewer decision
methods. It uses the custom generated Prisma client against the isolated PG18
database. Unrelated repository/telemetry loading is excluded by bounded AST
selection; display rendering is an explicit double. The separate native Vitest
file executes the complete real viewer/enrichment implementation with its
existing repository doubles. Neither result is a serving HTTP/image proof.

The first added viewer negative used an invalid synthetic reschedule payload;
that failure is retained. Correcting only the fixture produced two discriminating
old-source authorization failures. The first private type configuration omitted
the repository's business-day/window ambient declarations; adding the existing
declarations yielded a passing real import closure without application changes.
All per-attempt failures and actual cleanup receipts remain private under
`/workspace/cal-consumer-qualification/coordinator/audit/`.

## Reproduction

Use the previously qualified Node20 path in `PATH`, existing local official
PostgreSQL image digest, and existing matching schema-engine executable:

```sh
python3 -B scripts/run-community-enterprise-cloud-tasker.py \
  --suite booking-audit-access --image "$CAL_CLOUD_PG_IMAGE" \
  --node "$CAL_CLOUD_NODE20" --schema-engine "$CAL_CLOUD_SCHEMA_ENGINE" \
  --receipt-dir /absolute/private/new-audit-access-attempt
TZ=UTC node node_modules/vitest/vitest.mjs run \
  packages/features/booking-audit/lib/service/__tests__/BookingAuditViewerService.test.ts \
  packages/features/booking-audit/lib/service/__tests__/BookingAuditAccessService.test.ts \
  --maxWorkers=1 --no-file-parallelism
node node_modules/typescript/bin/tsc --project tests/community-enterprise/tsconfig.booking-audit.json
node node_modules/typescript/bin/tsc --allowJs --checkJs --noEmit --skipLibCheck \
  --target ES2022 --module commonjs --types node \
  tests/community-enterprise/postgres-booking-audit-access.test.cjs
python3 -B tests/community-enterprise/cloud-tasker-runner.test.py
node scripts/verify-community-enterprise-task-graph.cjs
node --test tests/community-enterprise/task-graph.test.cjs
```

The runner refuses application DSNs and starts only its owned offline fixture.
Its actual child exit and owned-container absence are separate durable receipts.
Python/Markdown are outside the current Biome tool's supported file types.

## Remaining original requirements

This change does not qualify organization/team PBAC, same-snapshot authorization
and audit reads, mutation-to-audit wiring, transaction-bound enqueue/idempotency,
retention/anonymization, provider side effects, native119/122 restoration,
deployed staff/replica behavior or release acceptance. These original graph
criteria remain open. Existing six-value/zero-vault local-app and SCIM receipts
are preserved, and controller-owned publication/fonts are independent.
