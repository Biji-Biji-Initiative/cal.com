# Native Authentik integration

Status: source/protocol candidate. No production Authentik application or user
link has been changed. This document is not a rollout authorization.

## Configuration

The application uses its installed NextAuth v4 Authentik provider. Configure only
server-side variables through the existing secrets/configuration system:

```dotenv
CAL_AUTHENTIK_ENABLED=false
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
Only the enabled boolean, never client configuration, is passed to the login UI.

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
