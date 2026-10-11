# Recalibration and native Authentik: validation receipt

Date: 2026-10-12. Predecessor candidate:
`7029bb932393ec4ceadf016d335cd00d70554399`.
Status: locally built and smoke-tested web candidate. Not production-promotable.
Existing application main, deployed images, data and Authentik configuration are unchanged.

## Final observed results

| Check | Result | Scope |
| --- | --- | --- |
| Immutable dependency install | Exit 0; lock SHA-256 unchanged | Candidate's own Yarn 4.12 dependency graph; lifecycle scripts explicitly disabled |
| Prisma and app-store generation | Exit 0 | Target Prisma client/Zod/Kysely/enums and existing app-store registry/static assets |
| Native tRPC build | Exit 0 | `yarn workspace @calcom/trpc build`; actual installed dependencies, no substituted aliases |
| Full native web type check | Exit 0 | `yarn workspace @calcom/web type-check:ci`; actual web compiler settings and dependencies |
| Optimized Next production build | Exit 0 | `node ../../node_modules/next/dist/bin/next build` in apps/web; no skipped type checks |
| Enterprise source/protocol/graph tests | 122 passed, no failures/skips | 67 permission/repository contracts, 37 identity/protocol tests, 18 graph tests |
| Existing authentication Vitest suites | 58 passed across 3 files | Existing credentials, server-session and identity-provider regressions |
| Real PostgreSQL booking suite | 40 passed, no failures/skips | Complete target schema and actual booking SQL/policy; no old-checkout dependency fallback |
| Actual Next configuration tests | 2 passed | Native Next config loader, repository-bounded resolution/tracing, server-only Turbo environment declarations |
| Built-web smoke suite | 1 passed, containing 4 HTTP checks | Real built localhost Next server plus isolated synthetic PostgreSQL, reused fixture runner |
| Source permission guard | Passed across 4,540 files | Known 18 permission callers connected; not a whole security audit |
| Task graph verifier | 39 nodes validated | 10 preserved parent IDs, 29 executable children; source/runtime-aware readiness and complete production dependency coverage |
| Biome error-level checks | Passed on changed JS/TS | Warning/info diagnostics are not claimed absent |
| UBS identity scan | 3 files; 0 critical, 0 warnings, 15 information findings | New identity modules only; information findings reviewed as strict-check/regex heuristics and intentional fail-closed error propagation |

The install completed in 416 seconds using environment-scoped hardlink/global-cache
settings. Its unchanged lockfile SHA-256 is
`6c0963bd717b67e646216719c7c84f5a7d09da9cd76b8c0e916377549b98b828`.
This is not a claim that package lifecycle hooks, API v2 packaging or image
publication happened. Required application generators were executed explicitly.

## Native identity proof

The new code uses the installed NextAuth Authentik provider and Cal's existing
Account adapter. Identity is configured issuer plus subject, not email. Existing
users require an explicit reviewed link; there is no implicit user creation,
email conversion or global administrator promotion from IdP claims.

The 37 identity tests execute the actual application signIn/JWT/session callbacks,
Cal account adapter and server-session helper. Six perform real NextAuth OAuth
exchanges against a loopback OIDC fixture: discovery/JWKS, RSA-signed ID tokens,
PKCE/state/nonce, audience/signature checks, code exchange and encrypted native
session cookies. A valid linked identity succeeds; wrong state, nonce, audience,
signature and unlinked-subject cases fail. The same cookie is rejected after a
local account lock. Account rebinds and unauthorized profile/session updates are
also rejected. The IdP and database identity records in this suite are fixtures,
not the deployed Authentik service or production users.

The separate built-web suite starts the optimized application against a fresh
PostgreSQL schema with one synthetic user. It verifies:

1. `/api/auth/providers` exposes Authentik with the exact local callback URL.
2. `/auth/login` returns 200 and renders the real Authentik button, without
   exposing the fixture client secret or NextAuth secret in its HTML.
3. `/api/auth/session` remains unauthenticated for an anonymous visitor.
4. `/api/auth/csrf` returns a native CSRF token.

This local smoke passed twice, including through the committed reusable runner.
Both the owned web server and database were stopped and their temporary data
removed. Build ID: `3EssNLZiunyvWl4d_ZD8C`.
Build-manifest SHA-256:
`7eb367f404a888ef7c3aa6c7bcc94bc8d0928d83d94634b53b1d99f295e37249`.
This is a web-artifact receipt, not an OCI digest, deployed preview, real IdP login,
API v2 acceptance, team booking, MFA or 60-second revocation proof.

## What the wider verification corrected

Earlier isolated tests were insufficient to prove whole-application integration.
The actual compiler first found three new identity typing issues, which were
fixed. It then exposed two defects from earlier candidate slices:

* Booking access compared `booking.id`, but the two repository projections did
  not select that ID. Both now do, with production-method regression tests.
* The booking-list rewrite had narrowed its public recurring-information type
  beyond the existing UI contract. The nullable fields and indexed status-map
  shape were restored at the API source, not bypassed in the UI.

Aggregate Turbo attempts included a bounded timeout and those genuine errors;
none is represented as a successful full run. After repairs, the real generator,
tRPC build and complete web compiler commands passed. The optimized Next command
then completed its own compilation, type checks and static generation.

The first Next build inferred an unrelated home-directory lockfile as its root.
That owned process was stopped; no unrelated lockfile was edited or deleted.
The config now explicitly bounds Turbopack resolution and output tracing to the
monorepo, tested through Next's real loader. The existing static-asset copy step
was run rather than relying on leftovers. The final build succeeded without the
root warning or missing SVG-hash artifact. Mail configuration was intentionally
absent and organization-host rewrites disabled in this synthetic build; these
warnings do not establish delivery or live multi-organization routing acceptance.

## Graph and tracker

The original CAL-01 through CAL-10 IDs are preserved. Each executable child has
an owner role, scope, priority, prerequisites, acceptance and required evidence
level. Readiness cannot treat source-only proof as completion of a runtime task.
Every release-required child must be reachable from the team-production milestone;
fork reconciliation cannot be silently orphaned from the deployment path.
`--ready` returns validated, prioritized JSON. No workers are claimed dispatched.

CAL-02.BUILD is complete at its defined local build/start scope. CAL-02.PREVIEW
is the next integration task, not already deployed. Identity linkage, minimal
team operations and retained scheduling-engine proof are the other immediate
work. API v2 build is separate from the web preview but mandatory before production.

Native Beads recovery was attempted using its reviewed migration-plan command.
It rejects source schema 5; the installed tool supports 13..16 to 17 only. No
unsupported migration, reset, deletion or competing native tracker was created.
Stable graph IDs and issue #78 remain the handover until preservation-first
recovery of that existing database.

## Reproduction

Use a clean candidate with no deployed environment files:

```sh
YARN_NM_MODE=hardlinks-global YARN_ENABLE_GLOBAL_CACHE=true YARN_ENABLE_SCRIPTS=false yarn install --immutable --mode=skip-build
node node_modules/prisma/build/index.js generate --schema packages/prisma/schema.prisma
yarn workspace @calcom/app-store-cli build
yarn workspace @calcom/trpc build
yarn workspace @calcom/web type-check:ci
yarn test:community-enterprise
yarn test:community-enterprise:build-config
yarn test:community-enterprise:postgres --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

With temporary test-only web/encryption/auth environment configured, run the
existing `apps/web/scripts/copy-app-store-static.js` from apps/web and the native
`next build`. Then run:

```sh
yarn test:community-enterprise:web-smoke --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node scripts/verify-community-enterprise-task-graph.cjs --ready
```

The smoke test expects the isolated artifact URL `http://127.0.0.1:38917`, refuses
a populated/unrecognized database and deployed environment files, and generates
its own temporary credentials. It reuses the existing private-socket PostgreSQL
runner; it does not introduce a second deployment or database-control system.

## Remaining release boundary

No real user was linked and no live IdP client, existing application database,
ingress, cluster, secret, runner or production image was changed. No mail or
calendar invitations were sent. Shared-checkout unfinished edits are preserved.

Next requirements: admitted nonproduction preview; actual identity mapping;
SCIM/MFA/application-access policy and alternative-login enforcement; same-session
and bearer revocation across replicas within 60 seconds; remaining route/mutation
coverage; organization/team UI and scoped API v2; retained scheduling-engine
concurrency; durable audit/reminders; legacy migration/restore; and a real
community-update rehearsal. Full image/dependency/secret scans and runtime
release evidence remain required; the targeted UBS scan is not a substitute.
