# Calendar event references: authenticated ownership through the existing API

Date: 13 October 2026. Source predecessor:
`89ac7236715ff9cde28a1a774f665134be297712`.
Repository `Biji-Biji-Initiative/cal.com`, existing branch
`work/cal-diy-enterprise-20261010`; existing CAL-03.ROUTES and CAL-05.API.
No privately held research, alternative repository or packaging draft is imported.

## Delivered behavior

The retained GET and PATCH event-details handlers accepted authentication but
previously did not pass that user's ID through the unified/Google services to
the booking-reference lookup. That lookup selected by external event UID without
booking ownership. This slice carries the authenticated GetUser ID through those
same services and binds the credential-bearing query to the current booking
owner. Both `/events/{eventUid}` and the historical `/event/{eventUid}` paths
remain on their existing controller methods; no replacement booking API is added.

Sensitive reference selection now uses the primary database, requires an unlocked
booking owner, a Google-calendar reference and `deleted: null`, and selects only
the provider-required fields. Missing, foreign, orphaned or wrong-provider records
are refused before OAuth/calendar calls. Invalid or absent internal user IDs are
refused before querying, rather than allowing Prisma to omit an undefined filter.
Missing and foreign references have the same public not-found response.

The nonsensitive booking-reference list method retains its prior semantics.
The three API modules providing this repository were inspected: the unified
calendar module already provides PrismaWriteService, and the booking/calendar
modules import PrismaModule, which exports it. A read-only scan of 627 pinned API
TypeScript files found the affected internal call sites; both existing Jest
specifications were updated for the mandatory user ID.

This is the existing booking-owner contract, not a newly granted organization
administrator, co-host or service-agent privilege. It does not claim that the
remaining calendar endpoints, provider credential/delegation lifecycle, team-key
resource scopes, or every authorization rule have been audited. Owner changes
committed before a subsequent request are checked; this slice does not promise
that an external provider request already in flight is canceled atomically.

## Executed verification

A bounded verifier on authorized g2 used actual Nest/Express HTTP dispatch, the
production controller, GetUser decorator, unified/Google service methods, output
transformation, repository and generated Prisma client with PostgreSQL 18.6.
The complete application schema was unchanged. Nest 10.4.20, Prisma 6.16.1 and
TypeScript 5.9.3 match the inspected target pins; the isolated npm tool install
is not an immutable installation or compilation of the whole monorepo.

Authentication in the new calendar fixture deliberately supplies test principals;
it is NOT a rerun of the earlier real Passport/NextAuth verification. The generic
permission guard and unrelated providers are fixture boundaries. Google Calendar
and OAuth are controlled doubles recording calls, not live credentials or real
appointments. Thus HTTP/database ownership checks are executed, but real IdP,
Google permissions, provider delivery and complete production AppModule are not
claimed accepted by this suite.

| Check | Result | Actual scope |
| --- | --- | --- |
| New native calendar suite | 32 passed, zero failures/skips; repeated after controls | Both URL aliases, GET/PATCH, current owner, denied foreign/missing/locked/deleted/orphaned/wrong-provider records, duplicate external IDs, primary failure, and invalid internal IDs |
| Existing controller and Google service Jest suites | 47 passed in two suites | Existing tests with declared unit-service/guard/provider boundaries, not external integration |
| Focused strict TypeScript | Exit 0 | Actual modified repository against the complete generated schema; injectable Prisma service wrappers represented by typed declarations |
| Biome error-level check | Exit 0 on seven JS/TS files | Formatting/import fixes only; no unsafe suggested fix applied |
| Python syntax | Passed | Existing runner with the additional calendar suite choice |
| Gitleaks, four production files | Exit 0, no findings | Approximately 43 KB of actual changed production files |
| Gitleaks, all eight changed code/test/runner files | Exit 1, one finding | Inherited fake PEM-shaped TEST_KEY/KEY text in the existing mocked Google JWT test, inspected as test-only and not newly introduced |
| UBS, four production files | Exit 1: one critical heuristic flag, zero warnings, 46 information findings | The flag compares `credential.type` with the public GOOGLE_CALENDAR_TYPE constant, not a secret value; report retained unsuppressed |

The fixture asserts its private Unix socket, PostgreSQL data directory and test
user before seeding an empty database. Every completed native/control run stopped
its own PostgreSQL server. The application fixture closes Nest and Prisma. No
application DATABASE_URL, live user, booking, calendar token or provider was used.

## Discriminating controls and initial failures

Replacing the four production inputs in memory with their pinned original source
produced 28 failures in the same 32-case suite. These include both the missing
owner controls and the changed primary/projection expectations; they are not 28
separate production vulnerabilities. Owner-allowed behavior still reached the
provider fixture, so denied-case failures were not merely a broken test server.

Removing only the owner predicate produced eight failures; using the replica
service instead of the primary produced five; removing the Google reference-type
predicate produced two. All four controls ran all 32 tests with zero skips and
recorded database shutdown. Owned source hashes were unchanged by the controls;
the final unmodified baseline returned to 32 passes. The replica fixture is a
separately counted adapter, not a measurement of a real lagging database replica.

The first type-check fixture omitted a modern JavaScript library declaration and
failed on Number.isSafeInteger; adding the appropriate lib to the isolated
compiler configuration resolved it without an application change. An early
control-driver equality check included concurrently downloaded unchanged source
files and failed its directory comparison. The controls were repeated using only
the eight owned source/test inputs; their byte-level identity check passed.

## Reproduction and remaining release requirements

After the normal candidate dependency install and Prisma generation:

```sh
python3 scripts/run-community-enterprise-postgres.py --suite calendar-boundary --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node scripts/verify-community-enterprise-task-graph.cjs
node --test tests/community-enterprise/task-graph.test.cjs
```

Run the two existing unified-calendar controller/Google service specifications
with the API's normal Jest configuration as part of native full-API acceptance.
The isolated verification used explicit unit dependency boundaries recorded in
its retained receipt, not a claim to have run every existing application test.
The new suite reuses the existing disposable runner; no application dependency,
schema, endpoint, CI workflow or deployment mechanism was introduced.

CAL-03.ROUTES and CAL-05.API remain in progress. Their graph evidence links this
bounded result and the earlier controller evidence without claiming full runtime
completion. All 39 task identities and prior prerequisites remain. Full current
web/platform/API builds, all resource scopes, exact-image packaging/scans, real
Authentik/SCIM lifecycle, provider journeys, legacy migration/restore and existing
preview/release gates remain required. OpenAPI operation-ID aliases were not
changed or claimed repaired in this slice.

One isolated writer performed this work; no new Agent Mail registration,
independent review, tracker recovery or agent dispatch is claimed. Existing
repository visibility, main, production, domains, infrastructure, Authentik and
secrets are unchanged. Local receipts identify the exact tested file hashes;
publication and remote readback are recorded separately in issue #78.

Agent: ChatGPT-CalCalendarBoundary-20261013
