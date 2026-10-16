# Client-bound API permission acceptance

Continuation completed 17 October 2026 (Pacific/Guadalcanal); investigation began
16 October. Repository `Biji-Biji-Initiative/cal.com`, existing branch
`work/cal-diy-enterprise-20261010`. Predecessor `719116ad22930693a5198b158f74a8c97f561ccd`.
Combined tested implementation: `e499ebf6e902c8c5729fd1b0e10989477d46e6d2`. The machine receipt records
all intermediate small commits, input hashes, executed commands and limitations.
This advances CAL-03.ROUTES and CAL-05.API without closing either broader task.

## Defect reproduced, existing mechanism repaired

Passport already chooses and verifies the credential for an API request. The
retained platform permission guard independently reinterpreted the Authorization
header and native cookie. Consequently an ambient valid browser cookie, or an
unrelated API-key-shaped secondary header on a client-authenticated request,
could make that permission layer bypass its selected managed client's limits.
It also read client permission state through older replica paths, ignored a
controller-level requirement when only method metadata was requested, and
included a missing raw access token in its exception text.

The revised guard consumes the authenticator's selected method and validated
request user. It does not infer either from a caller-supplied header, decode the
cookie again or choose a different credential to satisfy a missing permission.
Managed access tokens and managed client credentials use narrowly projected
primary authorization reads in the existing repositories. A current token must
still exist, belong to the authenticated owner, have finite future expiry and
have an unlocked owner. The current client permission mask is required. Client
credentials additionally recheck their exact organization, current accepted
OWNER/ADMIN without a custom-role override, unlocked actor and current secret.
The existing constant-time secret helper is reused, and the secret is never
returned from the permission method or included in its errors.

A primary read outage remains a failed request; it does not fall back to the
accepting replica/cache. This is a current authorization check, not a replacement
OAuth issuer, refresh-token design or application-wide policy engine.

Native-session, personal/team API-key and third-party-token resource contracts
are not broadened or silently equated to managed-client permission bits. Their
existing resource/membership checks remain necessary. In particular this does
not claim complete third-party-token scope enforcement, full API-key resource
isolation, live IdP revocation, or atomic guard-to-business-write authorization.
A permission removal committed after this admission check still requires the
separate domain transaction contract. The 60-second multi-replica IdP test is
not replaced by a synthetic local database update.

## Correct placement, not a guard that rejects every legitimate call

Eight actual booking/event-type controllers attached the permission guard at
class level but authentication at method level. Simply requiring a selected
identity would have rejected legitimate calls before their authenticator ran.
The permission guard is now immediately after ApiAuthGuard on each existing
protected method. All other booking/resource/PBAC guards remain in order.

A ninth controller, Atoms schedules, declared six read/write permissions without
attaching the guard at all. Those methods now run the same existing guard after
authentication, with its existing TokensModule imported into the owning module.
No endpoint, payload, permission bit or new dependency was introduced.

An AST semantic comparison across the nine changed controllers verifies 62
method bodies, parameter/return signatures and non-guard decorators unchanged;
38 already-authenticated methods acquire the correct permission placement and
13 guest/optional route methods retain their prior authentication declarations.
The remaining methods are non-route helpers. This is structural preservation,
not a claim that every legacy endpoint is safe. Explicit guest routes remain
anonymous, and a real private-link controller still respects a subsequent
resource denial even after its client permission succeeds.

The existing source suite now contains an AST ratchet over directly decorated
controllers. It detects absent or prematurely ordered permission guards and
requires an authenticating guard before the permission check. Its scope is the
visible direct decorator forms; dynamic wrappers, aliases or undiscovered
transitive authorization paths are not declared audited merely by this test.

## Executed evidence

| Check | Result and actual boundary |
| --- | --- |
| Original production guard with new controlled cases | 70 cases ran; 47 passed, 23 failed. Expected failures include missing protections and a custom-prefix positive regression, not 23 distinct production vulnerabilities. |
| Initial repair | All 70 passed; subsequent actual-controller coverage increased the suite to 75. |
| Final native HTTP/PostgreSQL suite | 75 passed, zero failures/cancellations/skips, through real Nest, Passport, native encrypted cookie handling, permission guard and primary repositories. Actual Atoms and private-link controllers execute. |
| Existing API-key controller regression | 36 passed, including rotation, audit rollback and rechecking authority before writes. |
| Native API Jest unit suite | 27 passed under the retained Jest/ts-jest configuration, with explicit mocked repository dependencies and dotenv disabled. |
| Existing API source suites plus order ratchet | 154 passed, zero failures/skips. This includes the source-level tests and is not an additional 154 external API journeys. |
| Full API source TypeScript | No-emit native API type checking passed; no replacement declaration set or package-install change. It does not prove full AppModule startup or a newly compiled image. |
| Shared-checkout source suite | 600 passed at the recorded earlier working-tree checkpoint, including the other writer's uncommitted invitation tests. That count is not advertised as the exact standalone published-commit suite. |

The native fixture intentionally gives managed-token admission a stale accepting
cache and selected-user view, then executes the actual permission repository
against current PostgreSQL. That discriminates downstream current-state checks
without pretending a real lagging replica, external OAuth server or token-issuing
flow was exercised. Scope-changing local DB mutations occur only in the
private fixture. The actual domain bodies are preserved structurally; the native
controller tests use named schedule/private-link service and ownership-check
doubles to record whether a denied call reaches them. They do not book a real
appointment or evaluate the full ownership implementation anew.

Two additional discriminating controls restore only the old controller source
in memory. The old Atoms controller allows two writes that the current tests
require denied; both cases fail. The old private-link ordering causes both valid
read cases to fail before authentication. All control inputs are named and owned
source bytes remain unchanged. The final real-controller baseline passes.

Initial test-construction errors are retained: the first direct API Jest setup
used an incompatible deep-mock signature for class/handler getters (zero tests
executed); using typed spies fixed that fixture. The first actual Atoms fixture
missed the controller's relative service import and failed dependency setup;
the named service boundary was registered, then the complete suite reran. Neither
setup failure is counted as a reproduced application defect or successful test.

## Security findings remain visible

The final owned 17-file input has no detected secrets. The actual 13-production-
file UBS scan is retained with two critical heuristic findings, 37 warnings and
94 information findings, not relabeled clean. Both critical findings compare
public authentication-method enum values, not secrets. The header lookup warning
is an Express request.get call, not an outbound HTTP client. Actual secret
rotation uses the unchanged constant-time helper and is tested.

Thirty-two property-chain warnings are Prisma/DI accesses, mostly unchanged
repository lines; the new query paths have real success, denied and primary-
outage tests. Four warnings concern unchanged older booking-body handling.
Their AST identity is verified; the complete historical request-validation and
resource audit remains open. No suppression or broad scanner waiver was added.
These source scans do not reduce or replace the earlier image's 56 open HIGH
package/advisory occurrences.

## Reproduction and publication

Use the existing candidate dependencies and generated Prisma client, never a
live DATABASE_URL as a fallback. The maintained runner verifies the private
socket, data directory and test identity before creating fixture records:

```sh
python3 scripts/run-community-enterprise-postgres.py --suite api-auth --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
python3 scripts/run-community-enterprise-postgres.py --suite api-key-http --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node --test --test-reporter=spec tests/community-enterprise/api-session-boundary.test.cjs tests/community-enterprise/api-key-lifecycle.test.cjs tests/community-enterprise/api-runtime-admission.test.cjs
```

Run the permission guard specification with the retained API Jest configuration,
`--runInBand`, and dotenv pointed to `/dev/null`; its existing synthetic test
configuration is not a production environment. Exact commands, duration, source
hashes, controls and cleanup records are in the paired machine receipt and the
raw task-owned `/data/tmp/cal-api-permissions-20261016-r6l9fwki` evidence on g2.

Implementation was divided into five bounded source/test commits; each touches
at most nine files and fewer than 500 changed code lines. Remote branch and every
owned blob are read back before reporting publication. The separate invitation,
Tasker, UI and translation writer's work is neither reverted, included, claimed
as this implementation nor silently treated as an immutable build input.

All 39 original graph records, their criteria, dependencies and milestone gates
remain. CAL-03.ROUTES and CAL-05.API receive this evidence but stay in progress;
12 executable tasks remain complete and 17 open. No full route audit, deployed
preview, real provider/IdP acceptance, production change or successful publisher
operation is inferred. The prior qualified e3a79afb image is not relabeled as
these newer API sources. A new exact combined API build and serving acceptance
must follow through the existing delivery owner.

Agent: ChatGPT-CalPermissionBinding-20261016

## Final directly observed coverage

The direct-decorator inventory contains **54 permission-decorated methods in
14 controllers**, with zero remaining missing/out-of-order checks in that scope.
Final no-emit TypeScript verification ran against the actual complete API source
again after continuation, and the final 75-case native suite and 36-case key
controller suite were repeated. All nine owned database invocations, including
failed setup and negative controls, have stop receipts and absent temporary
directories. No matching PostgreSQL fixture process remains.

The final graph validator and all 25 graph regression cases pass. Publication
metadata scanning returned ten flags on recorded SHA-256 source-file digests
and two existing image-identifier flags in the graph. Each new digest was
recomputed from its exact published file; the image lines are unchanged from
the parent. These are retained as reviewed metadata findings, not suppressed
rules or a claim that the metadata scanner exited clean. The separate 17-file
source secret scan did exit zero.
