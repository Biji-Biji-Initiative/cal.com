# Authentik-only staff login: source implementation

Date: 2026-10-13 (Pacific/Guadalcanal).
Predecessor: `aeb7ddee4e42f72cca52e08986d1e280957c9b31`.
Owner/programme: existing Cal enterprise issue #78; CAL-04.SESSION and
CAL-04.REVOCATION. Both remain open at their full acceptance scope.

## What changed

An optional, instance-wide server setting now distinguishes offering Authentik
from requiring it for the inspected staff-login paths:

```dotenv
CAL_AUTHENTIK_ENABLED=true
CAL_AUTHENTIK_ONLY=true
```

No deployment configuration was enabled in this change. Unset or exactly `false`
preserves the existing mixed-login mode. Invalid values fail instead of silently
turning enforcement off. `true` requires the native Authentik provider to be
explicitly enabled and configured through the existing mechanism.

The real NextAuth API entrypoint retains only its native Authentik provider in
strict mode and wraps both sign-in and JWT callbacks. It rejects local password,
email-link and alternative social sign-ins before invoking their callbacks.
An existing native cookie cannot sponsor an incoming non-Authentik login.
Legacy unmarked cookies and client updates attempting to manufacture provenance
are refused. The server-session helper applies the same requirement before user
lookup, then still invokes the existing native account/binding validator.

The marker check is NOT identity validation. It only dispatches to the existing
verified-token and current-account path. Malformed markers, removed links and
inactive users must still be rejected by that path; the new code never grants
roles or membership merely because a marker is present.

Four public POST entrypoints are gated before their existing handlers execute:
setup, signup, forgot-password and reset-password. This prevents web bootstrap of
a local administrator, invitation-token bypass of the signup restriction,
password conversion and account-recovery mail in strict mode. The gate returns
403 with a non-cacheable generic response. The original handlers, rate limiting
and CSRF checks remain in place for mixed mode.

The existing login screen uses a server-derived boolean to hide its local form,
password-recovery/signup controls and other login providers. It uses the existing
translated Authentik label. Strict login ignores local TOTP query parameters and
does not redirect an empty database to public first-admin setup. The native safe
redirect and mixed-mode setup behavior remain intact. The flag is declared in
Turbo's existing server environment list; it is not a browser-public variable.

## Verification actually executed

| Check | Result | Scope |
| --- | --- | --- |
| Focused policy and integration tests | 48 passed; 0 failed/skipped | Production policy, actual auth entrypoint, account-route POST exports, server-session helper, login props and JSX decisions with explicit test dependencies |
| Deliberately disable the policy in memory | 16 failed, 32 passed; exit 1 | Proves the suite detects a bypass; source files on disk were not mutated |
| Strict TypeScript at ES5 target | Exit 0 | New dependency-free policy module only |
| Syntax/parse checks | Passed | Ten changed TypeScript/TSX/JavaScript files and the new Node test file |
| Test-command integration | Verified source change | The new file is appended to the existing `test:community-enterprise` command, not a parallel CI lane |

Commands run in this session's isolated execution sandbox:

```sh
node --test --test-reporter=spec tests/community-enterprise/staff-login-policy.test.cjs
tsc --strict --noEmit --target es5 --lib esnext,dom --skipLibCheck packages/features/community-enterprise/identity/StaffLoginPolicy.ts
node --check tests/community-enterprise/staff-login-policy.test.cjs
```

The sandbox had Node 22.16.0 and TypeScript 5.8.3. The repository's pinned
TypeScript 5.9.3 and other dependencies are unchanged. The tests transpile the
inspected production source with controlled dependencies; the JSX check records
the component's actual conditional output, not React hydration or a browser.

No full application install/build/type check, existing complete suite, native
NextAuth cryptographic exchange, live PostgreSQL, browser, image scan or deployed
IdP test was run for this new slice. Biome was unavailable. The previous build
receipts do not validate these newer application bytes. Fresh native checks must
pass before an image containing this policy is promoted.

## Rollout and compatibility boundary

Before enabling strict mode, finish the normal build and browser/API acceptance,
prove native login for pre-linked staff and a reviewed recovery operator, and
prepare the normal identity provisioning route. An empty instance must not be
publicly exposed as an administrator-bootstrap shortcut. No public bootstrap or
administrator exception is added here.

Enabling the setting requires old local/social staff sessions to sign in through
Authentik again on the covered paths. Removing the setting restores mixed-mode
acceptance; it does NOT cryptographically revoke old cookies, and still-valid
legacy cookies may be accepted again. This is policy rollback, not key rotation.
No user, password, account binding, encryption key or membership is changed by
setting or unsetting this flag.

The following remain release requirements, not claims made by this slice:

* Inventory and test direct JWT readers, other consumers of auth options, API v2
  bearer paths, custom OAuth endpoints and administrative impersonation flows.
  Do not infer universal authentication coverage from these named entrypoints.
* Prove real Authentik MFA/application access, SCIM membership lifecycle and
  same-session/bearer revocation across replicas within the approved 60 seconds.
* Re-run calendar-connection and external guest-booking journeys with strict
  mode enabled. Their routes and calendar OAuth adapters were not modified;
  an anonymous visitor still resolves to no staff session, not a global booking
  denial. Retention of source does not substitute for that live acceptance.

## Remote work preservation

Desktop Commander was attempted but did not return usable container/build
receipts. GitHub remained available, so this disjoint source slice was tested in
the local execution sandbox and committed directly to the existing candidate
branch. No claim is made that Agent Mail, Beads or remote access was repaired.

Unpublished container/Prisma packaging on the coding machine was neither
reconstructed nor overwritten. Resume it from [the preserved image checkpoint](PREVIEW-IMAGE-2026-10-13.md),
reconcile it onto the current candidate, and rebuild/reverify the exact final
application and packaging revision. Do not discard these login changes while
recovering the old detached release worktree or reuse an old image's scan result.

No main/prod push, deployment, secret change, real identity write, customer message
or registry publication was performed in this slice. The existing task graph and
release gates remain authoritative; this document records bounded source progress,
not completion of CAL-04.REVOCATION or CAL-02.PREVIEW.
