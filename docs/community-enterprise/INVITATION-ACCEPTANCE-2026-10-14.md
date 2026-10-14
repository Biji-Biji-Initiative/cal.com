# Organization invitations: actual consent, cancellation and mail-failure proof

Date: 2026-10-14. Built source: `63047c42b33abe4431631232c8cf588389329fe3`.
Canonical repo/branch and the existing 39-record task graph remain unchanged.
This is assembled local candidate evidence, not a deployed community release.

## Delivered scope

Organization owners/admins can invite an existing enrolled account with verified email as an ordinary
member. The recipient sees a pending invitation in their own authenticated inbox
and explicitly accepts or declines. The administrator can cancel and request a
bounded email retry. Pending membership alone grants no organization permission,
profile or team-calendar ownership. Platform-wide admin status without the actual
organization grant and custom-role ADMIN hints cannot substitute for this policy.

This reuses the retained Membership, team-scoped VerificationToken lifetime,
Profile, administrative audit and invitation-email template/transport. The existing
browser router and management page are extended. No new application dependency,
schema, scheduler, tenant directory, queue service or public agent API is added.
See INVITATION-CONTRACT-2026-10-14.md for the reuse and future-adapter boundary.

Creation and recipient consent are separate operations. Acceptance binds the
current recipient ID/UUID, exact still-pending membership, current issuing authority,
root policy and seven-day expiry. The existing token column contains an unexposed
random value; the namespaced identifier holds the internal binding, neither of
which is returned to the browser or put in the email. The emailed link opens the
authenticated inbox, not an accept-on-GET or bearer-capability route. Guessing an
invitation ID does not grant another identity the right to accept it.

Acceptance creates only the specific additive organization profile and membership.
It does not rewrite personal User.organizationId/movedToProfileId or accept pending
child-team invitations. Decline/cancellation removes only the matching pending
records. Already accepted members require the separate offboarding workflow, not
this cancellation endpoint. Replaying a recorded outcome never regrants removed
access. Expiry or a cancelled/replaced invitation cannot be undone by replay.

A directory-managed root is not modified by local invitation actions. Existing
custom roles and orphan profiles are not silently overwritten. Invitations for
new people who do not yet have an enrolled account remain outside this slice:
account enrollment, IdP linkage, external consent and complete community onboarding
still require their own approved lifecycle. No live invitation was sent here.

## Measured verification

| Check | Result and scope |
| --- | --- |
| Actual PostgreSQL invitation suite | 53 passed; no failures/skips; generated client and full disposable schema |
| Existing enterprise source regression command | 417 passed; includes 6 mail and 5 inbox tests |
| Mail, inbox and existing router contract subset | 29 passed; explicit mail/framework doubles, not live delivery |
| Native tRPC and complete web type check | Exit 0 |
| Immutable installation, generation, optimized web build | All exit 0; lock unchanged |
| New invitation browser journey | Passed with three distinct native session identities and loopback SMTP |
| Existing organization, onboarding and team/guest/multi-host journeys | All passed on the same build |
| Build ID | `cZZ7Idz8DybWvYHFe7AgW` |
| Build manifest SHA-256 | `60076e5e6b22af4373ac08f35155ee661e34ca247164ffab039b00af09b55fe3` |
| Build origin | `http://127.0.0.1:38917` — local test artifact, not a live domain image |

AST-scoped negative controls disable one real production check at a time, only
in the task-owned working tree. Removing administrator authority produces
7 failures; removing recipient binding produces
1; removing expiry produces 1;
skipping audit produces 14. Original bytes are restored
and the database suite passes again. Those mutation runs used the original 48-case suite before the five added
verified-address cases; the final 53-case suite is separately rerun.
The tests cover wrong user/tenant/role,
changed identities and issuer authority, revoked/expired invites, unique replay,
accept/cancel competition, actual audit constraint rollback, profile collision,
directory/custom-role constraints, 50-item pagination and notification retry state.
The concurrent race is a real competing transaction test, not a new proof about
all independent membership writers or live IdP propagation.

## Actual browser result

Three separate native NextAuth sessions are issued through the local TLS OIDC
fixture, not by changing the user field in one privileged test context. The owner
creates a real organization through the previous admission API, then sends an
invitation through the actual UI. The recipient initially has no organization
profile or permission. The existing mail renderer and SMTP transport submit the
notice to the non-relaying synthetic-recipient sink.

The recipient accepts in the UI and becomes only an ordinary member. The owner
cannot accept on that person's behalf, and the new member cannot issue another
organization invitation. Another identity declines, is reinvited, and sees a stale
accept button after the owner cancels. That stale action is rejected and produces
no profile/access. A further invitation is exercised while the local SMTP sink
rejects mail: the UI reports unconfirmed submission, keeps the invitation pending,
and the recipient can still decline through the authenticated inbox. Three normal
notices reach the local sink; no notice is delivered outside the fixture.

The retained organization/first-run/team booking tests are separate scenarios on
the same built application. Calendar provider responses and IdP identities remain
synthetic, while the browser, native session cryptography, application routes,
database and loopback SMTP are real. Passing these tests is not live Authentik,
Google/Microsoft calendar, replica lag, external inbox or enterprise-release proof.
The suites overlap; counts must not be summed as independent production journeys.

## Failure handling that was corrected

A further boundary review found that the new invitation lookup did not require
proof of email ownership. Four added database tests reproduced issuance, acceptance,
notification and actionable display for an unverified account. The service now
requires the existing emailVerified state for issuance, acceptance and notice
submission. An unverified recipient can still decline without gaining access.
A legitimate verified email change preserves the same UUID-bound identity. The
native browser also verifies rejection before issuance and before consent when
the stored verification is removed. It does not simulate completing real email
verification or prove a live IdP's address claims.

The first screenshot exposed double-escaped date separators. The UI now renders a
semantic time element with readable text; the browser asserts the exact datetime
and absence of escaped entities. A focused view test also caught an empty filtered
first page hiding later invitations. The continuation remains accessible; truly
empty inboxes may still hide. These are source fixes, not screenshot retouching.
The exact final application was rebuilt after both changes.


The first new cooldown test exposed raw database timestamp decoding across the
Europe/Berlin timezone. A raw timestamptz decoded differently from retained audit
UTC values, so the resend check did not reject an immediate attempt. The new
clock query reads epoch milliseconds, then constructs a Date for exact comparisons.
Tests assert both upper/lower seven-day bounds and cooldown-before/after behavior.
The failed original and diagnostic receipts are preserved, not erased.

The retained BaseEmail method logs and swallows SMTP failures by default. This
slice adds an opt-in strict propagation mode for the invitation workflow; existing
callers retain their compatibility. The mail kill switch and test bypass still
prevent submission. The self-hosted notice hides the hard-coded hosted-vendor
support claim, without stripping attribution or changing existing callers.

Notifications run only after the membership transaction commits. An audit records
the attempt before transport, not guaranteed delivery. A retry with the same
operation is not silently sent again; new attempts are rate-limited per invitation.
SMTP acceptance is not final inbox receipt. Crash/timeout or lost-response status
remains unconfirmed and the pending inbox remains authoritative. This is not a
durable outbox, automatic retry worker or exactly-once delivery implementation.

## Security, compatibility and open gates

The final build reuses the earlier successful immutable installation, Prisma/app
registry generation and static assets because their dependency, schema, generator
and lock inputs are unchanged and checked. Each reused receipt names its original
source. Changed domain/tRPC and web code are rebuilt, with native type checking,
and all four browser journeys rerun at the final application source. An older
bundle is not relabeled as the current build.


All privileged invitation writes require the configured same-origin POST and a
verified session, then current domain authorization. Wrong-origin and anonymous
protection in the shared procedure is retained. Query payloads expose only bounded
invitation display metadata. The stored binding envelope is scoped to the current
purpose; future upstream VerificationToken consumers and cleanup migrations must
be reviewed against this namespace, rather than assuming unrestricted compatibility.

Gitleaks reports no new findings in the changed source/test/config files; the old
locale translation-key finding is identical to the baseline and unsuppressed.
UBS on four production modules reports six critical-level heuristics, two warnings
and 62 informational findings. The flagged comparisons are numeric IDs/public
UUIDs, expiry and a browser request signature, not secret bearer tokens. The JSX
warning points to a static input, and malformed stored JSON rejects operations or
is excluded from listing. Findings remain recorded, not suppressed or called a
clean security scan. No fresh whole-image or deployed security approval is implied.

The task graph preserves its IDs, states, dependencies, earlier evidence and all
release milestones. CAL-05.CORE/UI and CAL-07.AUDIT gain this bounded evidence,
not a blanket completed status. Full member/custom-role lifecycle and offboarding,
new-account enrollment, real native IdP/directory behavior, durable delivery,
current image publication/security and dev/staging/production gates remain open.
No live accounts, memberships, credentials, database, domain, registry permission
or deployment changed in this tranche. Private research and restricted historical
source were not copied. The earlier supported Agent Mail refusal is preserved;
no repeated edge bypass, claimed reservation or extra agent dispatch occurred.

Reproduction after normal dependencies and a matching local-origin web build:

```sh
yarn test:community-enterprise:invitations --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node --test tests/community-enterprise/invitation-mail.test.cjs
yarn test:community-enterprise:invitation-journey --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

Use only the existing isolated database runner. Final publication hashes and
teardown receipts are recorded in issue #78 and the archived local evidence.
