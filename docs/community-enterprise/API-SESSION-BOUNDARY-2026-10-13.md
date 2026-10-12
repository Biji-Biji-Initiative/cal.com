# API v2 session continuity and credential boundaries

Date: 2026-10-13 (Pacific/Guadalcanal).
Predecessor candidate: `42918744533d07e9dd2600b8e9d4f382d92f1f25`.
Delivery issue #78; existing CAL-03.ROUTES, CAL-04.SESSION and CAL-05.API.
Status: tested source slice, not a built or deployed API release. These tasks
remain open at their full acceptance scope. The separate #79 research commission
and the existing task graph are not replaced or extended here.

## Inspected gaps and repairs

Both API v2 NextAuth strategies resolved the user through the token's email,
without invoking the native Authentik Account-binding validator. The standalone
web login policy therefore did not establish the same behavior on these API
paths. The API strategy also grouped API keys and access tokens under one
allow-condition, used a configuration key different from the actual API prefix
setting, and rounded key expiration to midnight while mutating the Date object.

The two NextAuth strategies now share NextAuthSessionService. They still call
NextAuth's getToken first to verify/decrypt the credential and require an
explicit configured session secret. The resolver does not decode tokens or
turn arbitrary Authentik access tokens into Cal sessions.

Identity is the canonical positive numeric token subject, never a mutable email.
Strict mode rejects unmarked legacy sessions. A native marker, even in mixed
mode, invokes the same refreshAuthentikToken implementation used by the web
application. A marker by itself is not authority: issuer, binding-row identity,
local user, lock state and selected organization profile are revalidated.
Unlinking and relinking cannot resurrect the old binding's session.

The resolver uses PrismaWriteService's authoritative database in one bounded
repeatable-read transaction, rather than accepting a lagging read replica's old
user or membership. No writes occur in that transaction. Its queue wait limit
is two seconds and transaction timeout is five seconds. Existing internal
UserWithProfile data is loaded by verified ID; accepted root-organization
profiles are filtered, and obsolete moved-profile references are discarded.
The native organization context follows the validated selected profile instead
of selecting a different default organization. Caller-supplied roles, email and
organization IDs are not accepted as authority.

The API receives only issuer configuration for existing-session revalidation;
it does not need the OAuth client secret merely to read an Account binding.
The web provider continues to require its client ID and secret. Shared exports
use the repository's existing platform-libraries boundary, not direct feature
imports that API v2's compiler cannot resolve.

The internal principal retains the existing UserWithProfile scalar/relation
contract to avoid a speculative rewrite of every API consumer. This is not a
new response DTO and does not select calendar credentials. Minimizing all scalar
fields and auditing every downstream response remain separate work; do not
mistake this resolver for a comprehensive API data-exposure assessment.

## Bearer behavior

A supplied malformed Authorization header is refused rather than silently
falling back to a valid cookie. The Bearer scheme is case-insensitive; malformed,
empty or combined credentials are not accepted as a session fallback.

API keys use the real `api.keyPrefix` configuration. A route allowing only an
access token cannot admit an API key, and vice versa. API keys are not retried as
third-party tokens. Non-key tokens may reach the existing third-party verifier
only when that authentication method is explicitly permitted by the route or
by its existing default method policy. Failed bearer authentication does not
fall through to the browser cookie.

Expiration is compared at its exact instant: expired-at-now is expired, invalid
values are denied, and only an explicit null denotes a non-expiring key. The
stored Date is not modified. The common API success presenter rejects locked
users for all methods that call it.

Strict Authentik staff login does NOT automatically prohibit legitimate API keys
or OAuth machine credentials. Those remain separate credential types with their
own scopes, revocation and organization-permission requirements. This change
fixes their method selection and expiry boundary; it does not claim to implement
all of those requirements.

## Executed verification

| Check | Result | Exact scope |
| --- | --- | --- |
| Focused production-code tests | 63 passed; 0 failed/skipped | Shared native binding implementation, resolver, both strategies, credential helpers and dependency wiring with explicit framework/database doubles |
| Reintroduce the broad method condition in memory | 2 failed; nonzero exit | The route-method tests detect the old API-key/access-token acceptance bug |
| Disable the expiration comparison in memory | 2 failed; nonzero exit | Exact expiry tests detect the bypass |
| Skip native binding refresh in memory | 13 failed; nonzero exit | Native identity, strict/mixed and revoked-binding cases detect the bypass |
| Strict ES5 TypeScript | Exit 0 | New dependency-free credential-policy module only |
| TypeScript syntax/parse | Passed | All 10 changed/new TypeScript and JavaScript files, including the existing E2E fixture update |
| Existing test-command integration | Passed | The new suite occurs once in the existing enterprise test command |

The framework and database are test doubles. No Nest server, real PostgreSQL,
NextAuth cryptographic exchange, browser, real Authentik, replica or full native
API build ran in this sandbox. The existing E2E test module was updated to provide
the new dependency, but its database suite was not executed. Full constructor
injection/platform-library compatibility must still pass native build and E2E
checks. Previous application/image receipts do not validate these newer bytes.

The sandbox used Node 22.16.0 and TypeScript 5.8.3. Repository versions, dependencies
and lockfile are unchanged. Biome was unavailable; no Biome or full-repository
type-check success is claimed. No generated source, schema, workflow, runner or
new deployment configuration is introduced.

Focused reproduction after a normal dependency installation:

```sh
node --test --test-reporter=spec tests/community-enterprise/api-session-boundary.test.cjs
tsc --strict --noEmit --target es5 --lib esnext,dom --skipLibCheck apps/api/v2/src/modules/auth/services/credential-policy.ts
```

The regression suite is appended to `yarn test:community-enterprise`; the full
command and native API suites must be rerun in the assembled candidate.

## Acceptance still required

This slice is local database authorization freshness, not the required real IdP
60-second revocation proof. An in-flight transaction can observe its original
committed snapshot; subsequent requests must be tested against committed primary
state. Test disablement, issuer/application access, profile removal and API bearer
revocation across actual replicas with unchanged client credentials.

Other bearer repositories still use their existing read paths. OAuth scopes,
third-party token cryptography, client-secret comparison, rate limits, resource
permissions, direct JWT readers elsewhere, current-data DTOs and the retained
API feature stubs remain to be audited and tested. No universal API hardening or
fully supported enterprise API is asserted.

Before promotion: native install/generation/platform/API build and existing E2E
suites; real primary/replica cases; actual strict-mode staff and calendar/guest
journeys; full image/dependency/secret review; and the existing preview/migration
and release gates. API configuration must carry the same strict-mode flags and
issuer as the web service; no deployed variables were changed here.

## Work preservation and sources

Desktop Commander returned an explicit no-live-connection result for the coding
machine. This disjoint source tranche was prepared and tested in the conversation
sandbox, then delivered through the GitHub connector. Unpublished remote packaging
and its unknown container/cleanup state were not overwritten, reconstructed or
claimed repaired. Resume that work from PREVIEW-IMAGE-2026-10-13.md and reconcile
onto the latest branch before rebuilding/scanning any final image.

Inspected at the predecessor SHA: both API strategy files, auth.module.ts,
PrismaWriteService/PrismaModule, UsersRepository/UsersService, config/app.ts,
platform/libraries/index.ts, AuthentikConfig/AuthentikIdentity/StaffLoginPolicy,
and the existing API-auth E2E test module. The original file hashes were checked
before modifications. Primary framework reference, accessed 2026-10-13:
https://next-auth.js.org/configuration/options (getToken verifies/decrypts native
session credentials; database access and application authorization are separate).

No main/prod push, runtime mutation, user linkage, message, secret, registry
publication, new tracker or research-graph rewrite occurred. Issue #78 carries
this bounded implementation progress; no release milestone is closed by it.
