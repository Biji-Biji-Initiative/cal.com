# API primary-state authority and native HTTP acceptance

Date: 2026-10-13 (Pacific/Guadalcanal).
Predecessor: `208c80b62474188741d48f4e48e9e64576cf1eb5`.
Delivery issue #78; existing CAL-03.ROUTES, CAL-04.SESSION and CAL-05.API remain
open at their complete acceptance scope. Research/strategy issue #79 is unchanged.
This is a bounded implementation and local runtime test, not a deployed API release.

## Delivered

Key creation, rotation and deletion already used primary state, but API key
use still loaded its owner from UsersRepository's read-replica path. Key use also
did not recheck the membership/role that permits issuing a team credential.
A current key record alone was therefore insufficient evidence of current authority.

The API strategy now delegates key authentication to one shared feature service
using its existing injected PrismaWriteService. Key existence, expiry, unlocked
owner, direct issuance authority, parent organization membership and profile
scope are checked in one bounded primary-database transaction. The transaction
performs no writes and has a two-second wait bound and five-second execution
bound. The current key hash is used only for lookup; the credential record is
not returned to the API principal or response.

The service reuses requireApiKeyAuthority and existing key parsing/hash helpers;
it does not introduce a second membership policy. Team credentials require
current accepted direct ADMIN/OWNER membership, no custom role, and the valid
accepted parent membership where applicable. Removal, demotion, pending status
or conversion to a narrow custom role invalidates use of that legacy credential.
An instance-administrator flag alone cannot replace membership. This intentionally
matches issuance authority: these are unrestricted legacy user credentials,
not newly implemented per-action scoped service principals.

A team-bound key does not inherit its owner's platform-wide administrator role.
The internal principal is limited to the relevant root-organization profiles,
and its instance role is reduced to USER. Personal keys retain existing role
behavior and accepted profiles; standalone-team keys do not invent organization
profiles. The established request.organizationId field continues to carry the
stored key's exact teamId, including child teams; this slice does not silently
rename or reinterpret that existing API contract.

The management paths delivered previously still permit an active owner to view,
rename and revoke their own credentials after losing issuance authority. A failed
key authentication is not a reason to prevent recovery through an independently
authenticated management session. No bulk/offboarding key deletion is added.

Existing internal UserWithProfile scalar compatibility is retained. No calendar
credentials are selected, but this is not a comprehensive user-DTO minimization
review. Resource guards, response shaping and OAuth machine-principal authority
outside the inspected paths remain explicit work.

## Constant-time client-secret comparison

The targeted scanner also identified an inherited ordinary string comparison of
OAuth client secrets. That branch now uses Node's timingSafeEqual on fixed-size
SHA-256 digests of the exact UTF-16 code units. This preserves exact JavaScript
string equality, including avoiding lossy UTF-8 replacement of unpaired
surrogates, while supporting different input lengths. Empty/non-string values
are rejected. No credential storage, client-secret format or OAuth owner-selection
policy is changed. The comparison itself is constant-time; the entire HTTP request
is not claimed to have constant duration.

The existing focused tests exercise equal/unequal strings, length differences,
null/undefined values, embedded NUL, Unicode normalization differences and
unpaired surrogates. The actual OAuth strategy branch is exercised with controlled
repositories to prove rejection occurs before owner lookup. This is not full
OAuth-client or external-access-token runtime acceptance.

## Stronger native verification

The original coding machine remains disconnected. On authorized host g2, a small
exact-source fixture was fetched from the predecessor SHA. It uses the unchanged
complete Prisma schema and a generated Prisma 6.16.1 client with the native pg
adapter, PostgreSQL 18.6, NextAuth 4.24.13, Nest 10.4.20, Passport 0.7.0, TypeScript
5.9.3 and Node 22.23.2. The pinned verifier installation is not a full immutable
monorepo installation and no application dependency/lockfile was changed.

The test fixture starts a real local Nest/Express application. It uses the
production Passport strategies, route guards and method-policy decorator, native
NextAuth encrypted JWT creation/decryption and real PostgreSQL queries. Controller
responses are deliberately small diagnostic projections. Unrelated OAuth/queue
providers and the legacy default-organization helper are controlled fixture
boundaries, not a claim to bootstrap the complete production AuthModule/AppModule.
The platform-library exports are mapped to their actual source implementations;
the built platform package itself was not rebuilt here.

| Check | Observed result | Scope |
| --- | --- | --- |
| Native HTTP/database suite | 44 passed, 0 failed/skipped | Real Nest, Passport, NextAuth JWE and generated Prisma/PostgreSQL with production guards/strategies/services |
| Existing focused suite, extended | 75 passed, 0 failed/skipped | Production source with its documented explicit framework/DB doubles; includes exact secret comparison |
| Strict ES5 TypeScript | Exit 0 | New key-authentication service, shared source dependencies and client-secret helper against generated schema; not full API/platform build |
| Biome error-level check | Exit 0 | Eight changed/new TypeScript/JavaScript source and test files |
| Database-runner execution | Passed | Existing isolated runner extended by one suite; no new orchestration system |

The native tests exercise both NextAuth strategy entry points over HTTP. Valid
native cookies work; forged/expired ciphertext, valid legacy cookies in strict
mode, mismatched subjects, replaced Account bindings and invalid selected profiles
fail. The same unchanged cookie is rejected after local user disablement or
unlinking. Native validation needs the configured issuer and session secret,
not an unnecessary OAuth client secret. Mixed-mode behavior is also covered.

Real key requests verify primary state, expiry, rotation, direct and parent
membership changes, custom roles, correct prefix, credential-type restrictions,
and removal of instance privilege from scoped keys. A poisoned UsersRepository
fixture would return a stale unlocked administrator if called; the tested key
and native-cookie paths do not call it. This is a controlled stale-read trap,
not a physically lagging PostgreSQL replica measurement.

A synchronized test pauses an in-flight primary authority read, commits a lock
from another connection and resumes the request. The original request sees one
consistent previous snapshot; the next identical request is denied. This proves
the specified local snapshot behavior, not immediate cancellation of every
in-flight action, mutation atomicity, or the real IdP 60-second revocation target.

One legacy non-finite database timestamp case may fail as either invalid
credentials or a driver error, but cannot authenticate. Authentication does not
modify key rows or manufacture audit events. All fixture requests and database
records are synthetic. Every completed runner execution stops its PostgreSQL
server, and the Nest application closes in its test teardown.

## Regression controls

Temporary changes to task-owned source were run through the native suite and
restored byte-for-byte afterwards. Skipping team issuance authority caused eight
failures, retaining instance privilege on a team credential caused one, and
skipping native Account-binding validation caused five. The final unmodified
source passes all 44 cases. No shared checkout or deployed service was mutated.

The earlier 63-test source suite is retained and expanded. Its old strategy-local
expiry test now verifies delegation to the authoritative service; exact expiry
and stored-state behavior are additionally exercised through actual HTTP and
PostgreSQL. The previous dependency-free expiry helper tests remain. Existing
API-auth database fixture creation now supplies the accepted direct memberships
required for its positive key tests. That original broad E2E suite has not been
executed here; its new fixture code was syntax/lint checked.

## Reproduction and remaining acceptance

After the normal candidate install and schema generation:

```sh
yarn test:community-enterprise:api-auth --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node --test --test-reporter=spec tests/community-enterprise/api-session-boundary.test.cjs
```

The native suite reuses scripts/run-community-enterprise-postgres.py. It requires
its private Unix socket, verifies the server data directory and user, rejects a
populated initial database, and uses only the complete synthetic schema. It never
uses a deployed DATABASE_URL or starts a public listener. The verifier uses at
most four DB connections; tests execute sequentially.

Before release: full native platform/API/web build, complete existing E2E and
controller contracts, direct-client profile assumptions, real replica behavior,
actual Authentik/SCIM/MFA lifecycle and unchanged credentials across replicas,
resource scopes, recovery, exact-image scanning and the existing preview/migration
and promotion gates. Other OAuth/access-token user lookups are unchanged; this
is not universal primary-state authority for every API credential type. Remaining
legacy API feature stubs and scoped service principals are not implemented here.

No main/prod mutation, real key/account update, invitation, secret, registry image,
new tracker or deployment configuration was introduced. Unpublished packaging and
its unknown corrected-container-test state on mereka were not touched. Agent Mail
registration could not be completed through the attempted tool path; isolated
source work and exact branch/file-hash checks protect this publication. Existing
CAL IDs and the separate research programme remain intact.

Primary references consulted on 2026-10-13:
https://next-auth.js.org/configuration/options — getToken verification/decryption
is separate from current application authorization.
https://www.prisma.io/docs/orm/fundamentals/transactions — transaction isolation,
timeouts and snapshot boundaries. Test outcomes above are measured against the
repository's pinned versions, not inferred from current documentation.

## Targeted security receipt

Gitleaks exited 0 with no findings over ten changed code/config/test files,
approximately 113 KB, with output redacted. UBS scanned the new authentication
service, client-secret helper and modified API strategy: final exit 1, five
critical-level heuristic findings, one warning and 17 information findings.
No scanner rule or finding was suppressed, and no clean-UBS or full-image claim
is made.

The initial scan included the real inherited direct client-secret comparison;
that implementation was repaired and its focused tests passed. The five remaining
critical-level flags concern team-ID null tests, a role enum comparison, a profile
organization-ID comparison, and checking that a configured secret is a nonempty
string. They do not compare secret contents. The warning flags passing Origin
to the local authentication method; this call site does not fetch that URL.
These remaining flags are assessed as local rule false positives, not blanket
approval of uninspected OAuth or downstream code. The complete unsuppressed
report and inspected source lines are retained with the verification receipts.
