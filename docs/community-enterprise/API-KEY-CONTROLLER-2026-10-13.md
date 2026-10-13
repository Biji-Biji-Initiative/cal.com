# Existing API-key controller: native HTTP integration

Date: 2026-10-13. Source predecessor:
`41de10cc31a41b52666e30c025e86be262630a2b`.
Existing repository, branch, task identities and privacy decision remain canonical.
This slice changes already-public implementation and adds its verification; no
privately held draft or unpublished packaging was imported.

## Delivered

The existing `POST /v2/api-keys/refresh` controller now explicitly permits only
API_KEY authentication and returns `Cache-Control: no-store` with its plaintext
replacement-key response. URI, request fields, success envelope, key format and
transaction semantics are unchanged. No new production endpoint, dependency,
schema, workflow or deployment mechanism was introduced.

Cookie-only requests were already denied eventually by the service. The generic
guard nevertheless resolved their browser identity first. The route-specific
method declaration now rejects that path before those database reads. This is
not a claim that a cookie previously could rotate a key.

The prior response lacked an explicit no-store instruction. Absence is not proof
that any cache actually stored the secret. The new header states the intended
sensitive-response behavior, without guaranteeing compliance by every client.

## Native integration and regression results

The existing local API fixture now optionally registers the real ApiKeysController
and ApiKeysService. It executes the production GetUser decorator, Passport
strategies and guards, actual DTO classes, class-validator/class-transformer,
Nest HTTP dispatch, retained crypto and generated Prisma against PostgreSQL.
There is no replacement rotation implementation or test-created success response.

The test extracts and instantiates the real ValidationPipe and version-selection
expressions from the pinned bootstrap source. It does not start instrumentation,
global exception filters, queues, every business controller or the complete
production AppModule. Unrelated OAuth providers and source-to-platform-library
mapping remain controlled fixture boundaries. This is not a complete API build.

| Check | Result | Scope |
| --- | --- | --- |
| New actual-controller suite | 36 passed; zero failures/skips | HTTP, production controller/DTO/service/guards, generated Prisma and real PostgreSQL |
| Existing native auth suite | 44 passed; zero failures/skips | Previous local Nest/Passport/JWE/database suite with the extended fixture |
| Existing source regressions | 75 passed; zero failures/skips | Prior production-source suite with its documented framework/database doubles |
| Focused strict ES5 check | Exit 0 | Controller, DTOs, actual Nest decorators and guard; unchanged heavy service/principal interfaces represented by declarations |
| Biome error-level check | Exit 0 | Three changed/new JS/TS controller and test files |
| Gitleaks | Exit 0; no findings | Changed production controller only, approximately 2 KB |
| UBS | Exit 0; zero critical/warnings, two information findings | Same single controller; information concerns intentional await error propagation |

The initial 36-case run produced 34 passes and two failures: missing no-store and
unnecessary cookie-identity reads. Both pass after the controller repair.
Removing either new decorator temporarily produces one corresponding failure;
original bytes were restored before the final run and publication.

The suite covers default/explicit/non-expiring lifetimes, invalid/null/conflicting
inputs, unknown-field stripping without ownership changes, API version selection,
lock/demotion/membership removal, expired/deleted keys, different cookie versus
bearer identity, custom prefixes, old-key rejection, real audit rollback and an
authority change between guard acceptance and mutation.

Two HTTP refreshes are synchronized after both real mutation transactions read
the old key. Exactly one returns a replacement and one is denied; one credential
and one rotation audit remain. A real PostgreSQL CHECK constraint forces audit
failure and preserves the original key. Another case commits demotion after the
guard and confirms that the existing transaction service rechecks authority.

The bounded verifier on g2 uses pinned Nest 10.4.20, Passport 0.7.0, NextAuth
4.24.13, Prisma 6.16.1, TypeScript 5.9.3 and the unchanged complete schema with
PostgreSQL 18.6. Its tool installation is not an immutable whole-monorepo install.
No prior full-build or image receipt is extended to these new application bytes.
The first focused type check lacked an output DTO in the sparse fixture; fetching
its actual public source resolved that fixture issue without an application edit.

## Reproduction

After normal candidate dependency installation and Prisma generation, use the
existing isolated database runner directly:

```sh
python3 scripts/run-community-enterprise-postgres.py --suite api-key-http --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:api-auth --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node --test tests/community-enterprise/api-session-boundary.test.cjs
```

The runner gained only the new suite choice. Existing suites, connection limits,
private Unix-socket isolation, fixture-identity checks and teardown remain intact.
Each completed run stopped its own PostgreSQL server, and the native fixture
closes its Nest application. No new package-script alias is claimed.

## Tracking and release boundary

Issue #78 records this evidence against existing CAL-03.ROUTES and CAL-05.API.
Both remain unfinished at their full scope. The attempted graph-file update did
not complete, so TASK_GRAPH.json is unchanged by this tranche. No milestone,
prerequisite, repository decision or private-source boundary was rewritten.

No live account/key, notification, calendar, registry image, deployment or
production database was changed. The original disconnected host's unpublished
packaging remains untouched. No native tracker recovery or agent dispatch is
claimed. Verification artifacts are retained on g2; cleanup status is recorded
separately in the issue handover rather than presumed from a test exit code.

Remaining acceptance includes the current full web/platform/API build, complete
controller/resource scopes and global filters, real Authentik/SCIM lifecycle
across replicas, recovered exact-image packaging and scans, legacy-data
migration/restore, and the established shared-preview/release gates.

Primary references consulted 2026-10-13:
https://docs.nestjs.com/techniques/validation
https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store-2
Tests use the repository's pinned versions, not assumed current documentation APIs.
