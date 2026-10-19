# Native Authentik integration

Status: source/protocol candidate. No production Authentik application or user
link has been changed. This document is not a rollout authorization.

## Configuration

The application uses its installed NextAuth v4 Authentik provider. Configure only
server-side variables through the existing secrets/configuration system:

```dotenv
CAL_AUTHENTIK_ENABLED=false
CAL_AUTHENTIK_ONLY=false
CAL_AUTHENTIK_ISSUER=https://your-identity-host/application/o/your-application-slug
CAL_AUTHENTIK_CLIENT_ID=
CAL_AUTHENTIK_CLIENT_SECRET=
```

The provider stays disabled unless the flag is exactly `true`. Enabled but
incomplete/unsafe configuration fails rather than silently enabling another login
route. Use the provider's application-specific issuer, without a trailing slash.
The exact redirect is the configured web application origin followed by
`/api/auth/callback/authentik`. Register it exactly; do not use wildcard redirects.
HTTPS is required in production. Loopback HTTP is allowed for development tests.
The ordinary login UI receives only the enabled boolean. The explicit entry below
also receives the public issuer origin and validated callback; neither UI receives
the OAuth client ID or secret as props.

The native provider performs discovery, signed ID-token verification, client
(audience) validation, authorization-code exchange and PKCE/state/nonce checks.
The existing application adapter continues to create the native session. There
is no proxy that manufactures session cookies and no SAML/EE dependency.

## Account linkage

Identity is the configured issuer plus its stable OIDC subject. The Account
provider is `authentik`; `providerAccountId` is SHA-256 of the JSON pair
`[issuer, subject]`. The hash is an unambiguous bounded storage key, not encryption
or a credential. Never use a mutable email as this identity key.

This slice admits only pre-linked existing users. The operator-controlled
`linkAuthentikAccount` service requires the reviewed numeric user ID, expected
user UUID, configured issuer and IdP subject. It defaults to dry-run. Application
callers must supply an admitted transaction and retain the operation receipt.
It refuses a conflicting link, does not create users or change roles, and writes
only the Account binding. A production CLI and audited onboarding UI are not
included in this slice; do not hand-edit production SQL to bypass the review.

No automatic linkage is performed from email, display name, group name, domain,
IdP administrator status or a claimed Cal role. An organization admin is not a
global Cal admin. Calendar OAuth connections stay attached to the existing user
and are not replaced by staff sign-in.

The native session records the binding-row identity. Deleting and recreating a
link produces a different row identity so old cookies cannot become valid again
merely because the same subject was linked later.

## Current session behavior

Native login and every native JWT refresh resolve the current account binding
and unlocked user. Only identity/profile fields from the database are used.
A client session-update payload cannot choose another user, role, email or
impersonation identity. Profile switches must identify a profile owned by that
user and an accepted root-organization membership. Custom role membership does
not become the old built-in administrator shortcut.

The server-session helper no longer returns a process-local cached session before
checking the current account. The native marker is revalidated; locked, removed,
rebound or disabled-provider identities are rejected. The regular local-account
path also checks locked status instead of indefinitely returning the old cache.

This is local application authorization freshness, not a complete IdP lifecycle
solution. SCIM provisioning, IdP application/group removal, central logout,
other login-path enforcement, direct JWT consumers and API bearer revocation
remain explicit production tasks. A failed live IdP lookup must not be silently
substituted with stale privileges when those tasks are implemented.

## Native dev cutover prerequisites — read-only 2026-10-19

This assessment binds application source
`d8dae0cb45af05cf14c7ba4790f0ed1e018fe39c` and infrastructure source
[`ee96e4f0861e1a40d0e734a3f861a7d51c94d161`](https://github.com/Biji-Biji-Initiative/bbi-infrastructure/tree/ee96e4f0861e1a40d0e734a3f861a7d51c94d161).
It records source and read-only metadata, not a deployed native-login acceptance.
`CAL-04.OIDC` retains its historical `source_proven` contract and evidence;
that state does not certify live native dev, ordinary-person or launcher admission.
No browser, client creation, account linkage, credentials or runtime changes were
performed for this assessment.

The five required web runtime names are `CAL_AUTHENTIK_ENABLED`,
`CAL_AUTHENTIK_ONLY`, `CAL_AUTHENTIK_ISSUER`, `CAL_AUTHENTIK_CLIENT_ID` and
`CAL_AUTHENTIK_CLIENT_SECRET`. Native-only operation requires both flags to be
exactly `true` and complete server-side client configuration. The selected
provider's application-specific HTTPS issuer, normalized without a final slash,
must agree with discovery; the existing proxy's bare identity host is not a
qualified native issuer. The exact canonical dev callback is
`https://cal.mereka.dev/api/auth/callback/authentik`, independent of Google.
See [AuthentikConfig.ts:14](../../packages/features/community-enterprise/identity/AuthentikConfig.ts#L14)
and [StaffLoginPolicy.ts:6](../../packages/features/community-enterprise/identity/StaffLoginPolicy.ts#L6).

Live `calcom-dev/calcom` still serves stock
`calcom/cal.com:v6.2.0@sha256:ace3bb1219fb7306585ab9f4d94d41af7ee064c343db0498173436bbe857bd49`
with an auth-proxy sidecar. Deployment resourceVersion `539562393` has no explicit
CAL_AUTHENTIK env names; the web container's only envFrom Secret is `calcom-env`.
ExternalSecret resourceVersion `539713365` uses `infisical-secret-store-dev`, has
no CAL_AUTHENTIK mapping and no dataFrom. Its materialized Secret has ten keys and
none of the five native names, verified by key names only. The live Cal Service
exposes port 80 with targetPort 8080, the proxy port.

The maintained [dev blueprint](https://github.com/Biji-Biji-Initiative/bbi-infrastructure/blob/ee96e4f0861e1a40d0e734a3f861a7d51c94d161/branding/mereka/authentik/blueprints/99-dev-forward-auth-providers.yaml)
declares `Cal.com Proxy (Dev)`, a proxy provider. The inspected maintained Cal
provider paths, ESO mappings and credential metadata contain no native Cal OIDC
client declaration or CAL_AUTHENTIK secret-reference contract.
The [auth registry](https://github.com/Biji-Biji-Initiative/bbi-infrastructure/blob/ee96e4f0861e1a40d0e734a3f861a7d51c94d161/docs/AUTH_REGISTRY.yaml)
still describes Cal as forward-auth. An unmanaged live native client might exist;
its issuer, exact redirect, access policy, subject mode and secret alignment
remain unqualified. The infrastructure identity owner/platform operator owns
that qualification and Infisical/ESO delivery under the maintained
[provider-secret contract](https://github.com/Biji-Biji-Initiative/bbi-infrastructure/blob/ee96e4f0861e1a40d0e734a3f861a7d51c94d161/docs/security/AUTHENTIK_PROVIDER_SECRET_CONTRACT.md).

### Retire the legacy mint atomically with native-only routing

The current [proxy mint](https://github.com/Biji-Biji-Initiative/bbi-infrastructure/blob/ee96e4f0861e1a40d0e734a3f861a7d51c94d161/apps/calcom/base/auth-proxy-configmap.yaml#L157)
emits user fields and optional `bbiCalSession`, but no native `authentik` binding
marker. It intercepts `/auth/login`, sends the explicit action to `/auth/mereka`,
mints there and redirects to the requested destination. Candidate
[getServerSession.ts:53](../../packages/features/auth/lib/getServerSession.ts#L53)
returns null for an unmarked token when ONLY=true;
[restrictStaffJwt:54](../../packages/features/community-enterprise/identity/StaffLoginPolicy.ts#L54)
also rejects its refresh, as installed by the
[native handler:25](../../apps/web/pages/api/auth/[...nextauth].ts#L25).
Leaving that mint in front of native-only validation predicts a legacy
mint → protected-page denial → intercepted login → repeated bridge-attempt cycle.
The explicit login page waits for another user action; this is a cutover hazard
derived from source, not proof of the reported current user's browser loop.

The inspected d8 candidate has no native `/auth/mereka` route or auto-login query input.
Its existing [login action:199](../../apps/web/modules/auth/login-view.tsx#L199)
explicitly calls `signIn("authentik", { callbackUrl })`; `/auth/signin` also renders
provider buttons. The installed NextAuth v4 core GET `signin` handler redirects
to the configured `/auth/login`; provider initiation requires its CSRF-verified
POST. A launcher hyperlink to `/api/auth/signin/authentik` is not an automatic
native-entry shortcut. After proxy retirement, the supported entry is native
`/auth/login` plus its explicit button. One-click launcher entry needs a separately
tested explicit native entry route/input. Ordinary `/auth/login` must stay explicit
after logout. The old `/auth/mereka` entry must retire or lead only to native login
UX, with no legacy cookie minting.

### Qualify the principal before enabling ONLY

User 1's native Account binding was not established by this assessment. Matching
email or proxy identity headers are not prelink proof. The
[link service:16](../../packages/features/community-enterprise/identity/LinkAuthentikAccount.ts#L16)
requires the exact normalized issuer/OIDC subject pair, reviewed numeric Cal user
ID and expected UUID, an unlocked user and a nonconflicting Account binding.
The current [audited operator service](../../packages/features/community-enterprise/identity/AuditedIdentityLinkService.ts)
and [plan/apply CLI](../../scripts/link-enterprise-identity.cjs) additionally bind
the active instance ADMIN actor/UUID, existing root organization/slug and accepted
memberships, database fingerprint, audit schema and unchanged 15-minute plan.
These later operator tools do not imply a deployed audited onboarding UI.
The isolated [preview bootstrap](../../packages/features/community-enterprise/identity/PreviewOperatorBootstrap.ts#L60)
only admits an empty `cal_enterprise_preview...` database at the exact dev origin
in native-only mode; it cannot bootstrap the current `calcom` database.
The identity owner must choose and qualify the supported admission lane privately;
no first-login administrator, email-autolink or direct SQL fallback is implied.

Google Calendar remains separate: its
[native connection callback](../../packages/app-store/googlecalendar/api/add.ts#L26)
is `/api/integrations/googlecalendar/callback`. The existing dev Google credential
patch supplies `GOOGLE_API_CREDENTIALS` for that consent flow and keeps direct Google
login disabled. Native staff authentication neither grants Google consent nor
replaces existing calendar credentials. Preserving organization profile handles
also does not establish organization calendar-install acceptance; the personal
database handle and managed-platform limits remain in [onboarding evidence](ONBOARDING-2026-10-14.md).

### Dev-only preflight and rollback order

1. Qualify the native dev provider, exact canonical callback/issuer, claims/access
   policy and secret mirror through the infrastructure owner. Preserve the current
   proxy provider and Google credentials; qualify aliases against the canonical
   origin and host-only cookie behavior.
2. Qualify the selected database/schema and reviewed issuer/subject/user-UUID
   admission. Link the required operator and staff through the supported workflow
   before ONLY can exclude legacy sessions. No role or completion state comes from
   email, headers or a successful image build.
3. Bind the attested candidate image and add the five server-only names through
   dev-specific workload/ESO and credential-metadata changes. Use the ApplicationSet
   namespace override `calcom-dev`; the raw dev overlay says `dev-calcom`. Staging,
   production, shared auth behavior and existing session/encryption keys stay outside
   this dev wiring change.
4. Switch the dev Service to native port 3000, resolve ingress forward-auth and
   alias behavior, and retire/redirect the old explicit entry and legacy mint in
   the same reviewed transition. Merely replacing the backend image behind proxy
   port 8080 does not expose the candidate's native login UI. Remove the stock
   workload's command/args override atomically too: the maintained
   [dev overlay:379](https://github.com/Biji-Biji-Initiative/bbi-infrastructure/blob/ee96e4f0861e1a40d0e734a3f861a7d51c94d161/apps/calcom/overlays/dev/kustomization.yaml#L379)
   invokes `exec yarn start`, whereas
   [Dockerfile.enterprise-preview:40](../../Dockerfile.enterprise-preview#L40)
   uses the direct Node entrypoint and removes Yarn. The historical deliberate
   old-command control exits 127; see
   [RUNTIME-SECURITY-2026-10-16.md:93](RUNTIME-SECURITY-2026-10-16.md#L93).
   Carrying that override into the native image prevents startup before login.
   Repoint the maintained dev launcher catalog/blueprint from the site root to
   the explicit native entry only after its selected artifact contains that route.
5. Accept the actual native callback/session, linked/unlinked and revoked/locked
   principals, fresh ordinary-person setup, explicit login/logout, launcher and
   no-cookie navigation at their real runtime scope. Source/protocol fixtures and
   healthy pods alone do not close these checks; Google provider acceptance remains
   separate.

For an auth-wiring rollback, restore the captured dev stock image, proxy carrier,
Service targetPort 8080, the captured stock command/args, ingress auth annotations and previous env references through
GitOps. Retain original session/encryption keys, proxy provider, Google credentials
and identity/audit records. Expect explicit re-login, not session migration.
Candidate schema changes require their own tested compatibility/recovery decision;
an image revert alone is not database rollback proof.

## Explicit native launcher entry — source candidate 2026-10-19

The newer application-owned `/auth/mereka` page starts the existing native
provider after React commits. `/auth/login` remains an explicit manual page,
including after logout. The default return is `/event-types`; optional `rd` must
be a single bounded relative or absolute canonical-origin URL accepted by the
existing workspace return-path policy. Foreign origins, scheme/port changes,
credentials, malformed/repeated inputs and auth/API/removed-commerce paths are
explicit errors, not silent fallback sign-in attempts. Browser origin must agree
with the canonical callback origin; aliases need qualified canonical routing.
Disabled or malformed native configuration performs no initiation.

The client uses public same-origin `GET /api/auth/csrf`, then form-encoded
`POST /api/auth/signin/authentik` with `csrfToken`, `callbackUrl` and `json=true`.
The installed NextAuth 4.24.15 public handler applies native cookies and returns
JSON `{url}`; it can also return a 200 JSON local error URL. Both responses must be
HTTP 200 with `application/json`, and their streamed bodies are capped at 4 KiB
and 16 KiB respectively, even without Content-Length. CSRF is nonblank and at
most 512 characters. The authorization URL is capped at 8192 characters and
must match the origin derived from the validated issuer, with no credentials or
fragment, the exact native callback, and unique nonblank client/state/nonce/PKCE
code-flow fields. A cross-origin discovered authorization endpoint is refused
until separately qualified; no client configuration is serialized or logged.

One AbortController and 30-second deadline cover fetches and body consumption.
StrictMode reuses one attempt; unmount, callback/issuer changes and manual exit
cancel ownership, and stale results cannot redirect. Errors offer explicit retry.
The UI reports pending/error only: navigation to authorization is not a native
session or account-admission certificate. Once the browser leaves for the IdP,
the application cannot cancel that external flow or certify server cancellation.
Separate tabs may still compete for the native provider's OAuth cookies.
No private NextAuth internals, custom identity/cookie minting, user creation,
linking, role changes or session shortcut is introduced.

`TMPDIR=/data/tmp node --test --test-concurrency=1 tests/community-enterprise/mereka-entry.test.cjs`
passes 100 cases with zero skips. The first installed-handler positive protocol
test passed before production edits and confirmed the actual production provider's
nonce/state/S256 shape. Protocol controls execute the production API wrapper,
staff dispatch, provider and public NextAuth handler against loopback discovery;
only application option assembly is doubled, and admission/session callbacks
throw if initiation invokes them. Other controls render the real server page and
React/ReactDOM/JSDOM component with named transport/navigation/i18n/presentation
boundaries, including a reader that ignores cancellation. Existing signed
callback/linkage/revocation tests remain separate admission evidence.

This source is newer than d8's completed standalone build/archive. That d8
artifact is not deployed and does not contain this entry route; no build or
archive is relabeled here. Live provider/client/secret alignment, reviewed exact
issuer/subject/user-UUID linkage, startup/routing/mint retirement, ordinary-person
and launcher acceptance remain open. Google Calendar OAuth remains independent.

## Native logout completion — 2026-10-19

The native logout page now starts one CSRF GET / signout POST / fresh session
GET attempt after React commits. All three responses require HTTP 200 and an
`application/json` media type; CSRF tokens must be nonblank and at most 512 characters.
It requires the exact same-origin
logout callback acknowledgement, and a plain empty JSON session object before
showing success, enabling login or leaving for the cancellation survey. A failed
or malformed session read, `null`, an active session or a refused signout cannot
be mistaken for completion. NextAuth's public session helpers convert failed
reads to `null`, so they are not used as the completion certificate.

A shared attempt survives StrictMode effect replay; a real unmount aborts it and
ignores late UI updates. The entire attempt, including JSON bodies, is bounded
to 30 seconds and failures offer an explicit retry. Successful login/survey
navigation reloads the destination rather than reusing stale session context.
Password-reset/email-change copy remains visible only after verified completion.
Existing translation keys are retained. This ends the local Cal session; it does
not sign out the central identity provider or change proxy cookie handling.

`node --test --test-concurrency=1 tests/community-enterprise/logout-view.test.cjs`
passes 50 actual React/ReactDOM/JSDOM render cases with zero skips. The initial
31-case regression failed all 31 against the unchanged component, which started
signout during render and unconditionally displayed success. Transport,
navigation, translations and presentation are controlled test boundaries; React
hooks, effects, StrictMode, DOM events and promise timing are real. This is
source/component acceptance, not a browser, cookie-expiry or serving-image proof.

## What has been tested

The source tests execute the actual application callbacks, Cal account adapter
and server-session helper. A loopback OIDC fixture additionally exercises the real NextAuth handler,
real discovery/JWKS, signed ID tokens, token exchange and encrypted native cookie.
A valid linked identity succeeds; wrong state/nonce/audience/signature and unlinked
subjects fail. Locking the local user invalidates the same cookie on the next
session request. A separate smoke suite starts the optimized built web server with synthetic
PostgreSQL and confirms the native login button and four HTTP endpoints. Neither
suite is a test against the deployed Authentik server, a browser on the real
ingress, or every API/replica. See the current validation
receipt for exact commands, counts and compiler scope.

## Community alignment

The upstream OIDC sequence #29988/#29989/#29990 was inspected on 2026-10-12.
It is closed and unmerged. Its backend proposal adds an identity-provider enum
and supports verified-email account conversion/merging. We do not import that
behavior: pre-linked issuer/subject identity fits our multi-organization contract
without a schema migration. Revisit integration when upstream adopts a suitable
native extension; preserve these security tests rather than blindly duplicating
or merging two identity paths.

Sources inspected on 2026-10-12:

- https://next-auth.js.org/providers/authentik
- https://next-auth.js.org/configuration/callbacks
- https://docs.goauthentik.io/add-secure-apps/providers/scim/
- https://github.com/calcom/cal.diy/pull/29989

Authentik's SCIM documentation matters for the next slice: user/group updates
and periodic reconciliation are separate from immediate access revocation, and
changing a group-sync filter does not retract already synchronized membership.
Do not treat an hourly reconciliation as proof of the required 60-second bound.
