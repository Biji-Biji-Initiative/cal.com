# Member roles, ownership and planned offboarding: assembled acceptance

Date: 2026-10-14. Built application revision: `3ee12ff80d110b077f15ac5d6c1fd037e7cc89f7`.
Repository/branch and the 39-node task graph are unchanged. This is local candidate
proof, not a production or live-identity offboarding receipt.

## User outcome

The existing administration screen can now review and confirm a basic organization
role change, ownership transfer, or planned removal of an accepted member. The
review shows affected memberships, additive profiles, organization attributes,
scoped credentials and pending invitations. It also shows blocking responsibilities
that must be handed over before the operation can commit. Nothing is removed by
opening a review. Changing current authority or impact invalidates confirmation.

The owner can promote/demote built-in root roles or transfer their ownership to a
selected accepted member, becoming ADMIN in the same transaction. An administrator
cannot manufacture owner rights or remove a peer administrator/owner. The last
active root or child-team owner is protected. Custom/directory roles and managed
identities are not silently treated as ordinary grants. Instance administration
is not an organization shortcut and is an offboarding blocker if broader rights
would remain. Member self-service departure and emergency containment are separate.

Removal deletes only the reviewed local organization/child memberships, additive
profile, related organization attributes and matching pending admissions. It revokes
scoped API credentials and organization OAuth token/grant records, not someone's
private provider credentials. Another organization, personal account, personal
calendar, personal event and retained booking history remain untouched. Root role
changes preserve independently granted child roles, which are explicit in review.
Cancelled invitations cannot revive merely because their former issuer rejoins.

Revoked secrets are not stored in audit or resurrected by retry. Recovery requires
fresh authorized admission/credential issuance, not replaying old access. A failed
transaction including a failed audit rolls back its changes. This does not promise
an automatic undo after a successfully committed revocation.

## Preservation boundaries

No blind removal occurs when the inspected records reveal outstanding event/host/
schedule ownership, future organization bookings, shared provider credentials,
scoped webhooks (including disabled subscriptions), relocated legacy profiles,
directory/custom-role data, hidden Host cascades, nested organizations, automatic
domain admission, or unclassified legacy invitation links. These are actionable
blockers, not a claim that a provider/booking handoff engine has been built. A
blocked review has revoked nothing. Existing security containment procedures
remain necessary for an urgent compromised-account incident.

The implementation reuses retained Team/Membership/Profile, API/OAuth and audit
models, plus the existing invitation binding parser. No new schema, dependencies,
scheduler, tenant directory, external IdP or queue was introduced. The domain
commands can later be adapted to authorized agent clients, but no agent delegation
or public MCP API is granted by a review hash or browser confirmation.

## Measured evidence

| Check | Result and boundary |
| --- | --- |
| Actual PostgreSQL member-lifecycle cases | 63 passed, no failures/skips; full disposable schema and current Prisma |
| Existing enterprise source regression command | 439 passed; includes overlapping router and webhook subsets |
| Retained router contract | 28 passed, including 10 member-command boundary cases |
| Webhook scoped-access contract | 12 passed; actual procedure with explicit policy/database doubles |
| Native tRPC and full web type checking | Exit 0; initial UI nullability failure repaired |
| Exact changed application build | Passed, same lockfile; unchanged dependency/generator receipts retain their original source |
| Five native browser journeys | Member lifecycle, invitations, organization admission, personal onboarding and team/guest/multi-host booking all pass |
| Build ID | `cGATkvQRJBFbuBBwrPtQA` |
| Build manifest SHA-256 | `6d48b09c3f6d26ee9a51b6eb1d8fc8612b2c4f66206a607f02b39a846f1dee98` |
| Origin | `http://127.0.0.1:38917` — local artifact, not a public-host image |

Source mutation controls ran against the initial 60-case database suite: disabling
last-owner blocking produced 1 failure, bypassing
review freshness produced 5, and omitting audit produced
6. The audit omission also prevents the lock-observation
barrier from being reached; its timeout is retained, not misrepresented as another
independent authorization exploit. Original source bytes were restored and the
suite passed again. The 61-case suite additionally blocks unknown inherited invitation links. The
resumed 63-case suite adds the database-catalog preservation and synthetic-cascade
checks described below. Substituting the original webhook procedure caused nine of its
12 cases to fail; the repaired procedure passes all 12.

The database tests exercise key/OAuth scope preservation, replay after removal,
new credentials invalidating a review, re-admission not reviving old keys, explicit
attribute impact, real audit CHECK-constraint rollback, competing owner demotions,
and actual User-row-lock waiting observed in PostgreSQL during account revocation.
These are bounded local transactions, not proof of every external writer, replicas
or live IdP revocation timing. Historical booking owner access is not blanket-denied.

## Actual assembled browser behavior

Three distinct native sessions are issued by the TLS test IdP. The existing
organization-admission API creates the workspace and a second independent
organization. The browser promotes a member, denies an ordinary administrator's
owner-only command, displays a real scheduling blocker, and refuses confirmation
when another actor changes the reviewed membership. A fresh review removes the
eligible target's local grants and scoped key; the same session is denied current
organization data while preserving their other organization and personal records.
The browser transfers ownership, then proves the old owner's lost owner-only
rights and the successor's last-owner protection. A current owner can read the
shared team webhook; an ordinary or removed member cannot use its ID to read it.

The other four journeys pass on the same final application. They preserve the
prior verified-address invitation/consent flow, first-organization creation,
first-user calendar setup and guest book/reschedule/cancel and multi-host cases.
Test IdP subjects and provider responses are synthetic. Real browser, native
session cryptography, application, PostgreSQL and loopback SMTP are exercised.
No real provider calendar, external inbox, deployed API/IdP, registry image or
community offboarding is claimed. Counts overlap and are not independent full
production scenarios. The member journey sends no external notifications.

## Webhook finding and repair

The retained browser guard could authorize a historical owner without checking
current team rights, and an ownerless team webhook could reach its handler without
scoped membership. It now uses current primary-backed team authorization, current
instance authority for platform records, rejects contradictory lookup/scope and
requires client-bound webhooks to use their proper client-scoped path. Personal
webhook ownership behavior is retained. This is a tested guard/resource-access
repair, not a complete atomicity or background-delivery audit of every webhook
handler, collection route or API version.

## Security and release status

Changed-file Gitleaks found no new secrets. The unchanged locale translation-key
finding is retained and compared with its baseline. The original combined UBS scan timed out with zero files scanned and remains in
the receipts as an incomplete attempt. Four separate current-source runs then
completed with zero critical findings, one warning and 73 informational findings.
The remaining warning matches the local async handler named confirm, not a call to
the browser blocking-dialog API; it is retained unsuppressed. No rule or threshold
was disabled. This resolves the earlier missing coverage of those four files,
not a whole-codebase/image-security assessment or production approval.

The exact source build reuses only proven unchanged installation/generator inputs;
changed domain/tRPC/web code is rebuilt. No serving workload or prior artifact is
relabeled to the new source hash. Existing image publication/security, real IdP and
directory lifecycle, complete provider handoff, custom-role editing, new-account
community enrollment and dev/staging/production acceptance remain open. This
tranche changes no live user, membership, credential, database, email, domain,
registry permission or deployment. The prior nonretryable Agent Mail denial is
retained rather than bypassed; no reservation or extra agent dispatch is claimed.

See MEMBER-LIFECYCLE-CONTRACT-2026-10-14.md for authority, recovery and reuse rules.
The canonical task graph records bounded evidence without closing broader tasks.
All fixture teardown receipts and final GitHub blob readback are recorded in #78.

```sh
yarn test:community-enterprise:member-lifecycle --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node --test tests/community-enterprise/webhook-membership-boundary.test.cjs
yarn test:community-enterprise:member-journey --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

## Upstream-update preservation check and resumed verification

The removal workflow is tied to the real foreign-key effects of Membership and
Profile deletion. A new acceptance check reads PostgreSQL's actual created
constraint catalog and compares the dependent tables, columns and delete actions
with the reviewed preservation contract. It currently covers the four incoming
relations: membership attributes/hosts and profile-linked events/relocated users.
A new or changed relation requires explicit preservation review instead of silently
inheriting a changed cascade from a future upstream schema update.

The negative control creates a synthetic dependent table with ON DELETE CASCADE
only in the disposable database. That actual relation makes the contract assertion
fail. No offboarding is executed during the negative: the dependent row and all
membership/profile snapshots remain unchanged. The synthetic table is dropped,
the original contract passes, and the private PostgreSQL server stops.
This is an update-acceptance guard, not runtime introspection on every request,
a universal migration analyser, or proof against manually bypassed test gates.
Non-foreign-key provider effects, background processes and other credential
families still require their own contracts. No persistent schema/migration file,
production command or application dependency changed for these two tests.

The complete test TypeScript dependency closure was also checked with the existing
native compiler settings. That exposed untyped Promise barrier resolvers in the
previous lock-observation test; those test-only types were corrected. The final
check passes against the actual generated Prisma types and imported services,
without a new application build or relabelled browser artifact.

During this continuation the original 439 source regressions, 61-case database
suite and actual member browser journey were rerun successfully before adding the
two schema tests. The final 63-case suite then passed; the other four prior browser
journeys retain their exact unchanged-application receipts. Later commits change
only tests, documentation and graph evidence, not the built application revision.

Primary catalog reference consulted for this test:
https://www.postgresql.org/docs/current/catalog-pg-constraint.html

Continuation evidence recorded at 2026-10-14T19:36:36.483410+00:00 (UTC).
