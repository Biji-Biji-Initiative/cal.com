# Native API calendar export authorization

JadeFrog, 21 October 2026. Existing CAL-05.API; source predecessor
`f2991903182cdcae9f6a9129564d248dbd2efeab`. The original leaf remains
`in_progress`. Actual ready output admitted CAL-05.API, current canonical Mail
handed it off, and active reservations were empty before exact exclusive leases.

The retained calendar-links route authenticated a principal and checked platform
permission bits, but generated an export without checking booking access. A
team-bound key also lost its exact team restriction between authentication and
the booking resource authority. On the old source, actual native HTTP returned
200 for another administered team, the same owner's personal booking, an
unrelated personal-key booking and a booking moved to another team.

The route now uses its existing `BookingPbacGuard` and `BookingAccessService`.
The guard reads primary authority and carries the authenticated API key's exact
team ID. The existing service intersects that restriction with its current team
permission policy before organizer/host access can grant a read. Managed children
retain their existing parent-team behavior; an explicit child team takes
precedence. Personal keys retain the existing organizer/host/team policy.
No new role engine, schema, provider call or booking implementation is added.
Public booking UID routes and guest booking/rescheduling/cancellation contracts
are unchanged. Existing recording/session routes sharing this guard also receive
the current primary/scope restriction.

## Executed proof and reproducible recipe

Use the already qualified locked installation, tracked Yarn, generated custom
Prisma client and checksum-verified local schema engine. The image below is
already local official PostgreSQL 18.6; the runner never pulls it or connects to
a deployed database. Set `CAL_NODE`, `CAL_ENGINE` and a **new** private receipt
directory to those qualified local paths.

```sh
python3 scripts/run-community-enterprise-cloud-tasker.py \
  --suite api-booking-scope \
  --image sha256:29754c7520f4b9654cf8ff98e19ac73b88e255c3a53f6236ebe9d52249bb6df3 \
  --receipt-dir "$CAL_RECEIPT" --node "$CAL_NODE" --schema-engine "$CAL_ENGINE"
"$CAL_NODE" node_modules/typescript/bin/tsc \
  --project tests/community-enterprise/tsconfig.api-booking-scope.json --pretty false
"$CAL_NODE" --test --test-reporter=spec \
  tests/community-enterprise/api-route-inventory.test.cjs \
  tests/community-enterprise/api-session-boundary.test.cjs \
  tests/community-enterprise/api-runtime-admission.test.cjs
python3 tests/community-enterprise/cloud-tasker-runner.test.py
```

The new suite executes the exact native calendar-links controller method and its
decorators, Passport strategy, permission/UID/resource guards, booking service
method, retained booking-access policy, exact native repository SQL and generated
Prisma against an owned, empty PostgreSQL 18 database. Its bounded AST loader
excludes unrelated routes/bootstrap imports. Calendar rendering/translation is a
recorded terminal seam; no external calendar service or live OAuth is exercised.

| Check | Actual result |
| --- | --- |
| Old-source HTTP/PG controls | 5 passed, 5 failed; four unauthorized exports returned 200, missing resource returned 404 before the resource guard was installed |
| Final focused HTTP/PG suite | 13 passed, zero failures/skips; runner exit 0 and owned-container removal verified |
| Cases | Exact team organizer, current team-admin policy, foreign team, personal scope, unrelated owner, revoked key, locked owner, unaccepted/stale membership, resource move, managed child, conflicting direct team, invalid internal scope, missing resource |
| Native strict type check | Exit 0 against actual modified source/import closure, generated types and original API ambient declarations |
| Affected API source checks | 122 passed, zero failures/skips |
| Affected native authentication HTTP/PG regression | 75 passed, zero failures/skips; owned-container removal verified |
| Offline runner controls | 11 passed |
| CJS fixture checkJs | Exit 0, including the existing runtime loader |
| Required tracked-Yarn `type-check:ci --force --concurrency=2` | Stopped at its 180-second deadline, actual exit 129; whole-repository type acceptance is not claimed |

An initial focused type configuration omitted native NextAuth ambient declarations
and produced 29 errors; the retained configuration includes the API's original
`packages/types/*.d.ts` declarations and passes. The first authentication regression attempt stopped in its hook because this
clean tree has no built `platform-types/dist/index.js`. The bounded source loader
now loads tracked native DTOs/enums directly; all 75 actual auth cases then pass.
This is a harness prerequisite correction, not a production auth failure.
Failure and success receipts stay private. No install, full app baseline or SCIM/audit baseline was rerun. The required
repository type command invoked its declared Prisma generation/format prerequisite.
Its seven schema alignment-only changes were compared line-by-line and restored
to the exact original bytes; generated caches were preserved. The command
receipt retains its deadline and actual exit, rather than claiming CI success.

This increment does not complete the full API leaf: native listing, authenticated
detail elevation, mutation and managed-client resource scopes still need their
own discriminating acceptance. Key revocation/disabled-owner proof here is an
actual new-route test, not a claim of production offboarding. Deployment, live
identity/provider acceptance and native schema restoration remain distinct gates.
