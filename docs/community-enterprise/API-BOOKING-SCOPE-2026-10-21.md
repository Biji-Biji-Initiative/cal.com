# Native API calendar export authorization

JadeFrog, 21 October 2026. Existing CAL-05.API; source predecessor
`f2991903182cdcae9f6a9129564d248dbd2efeab`. The original leaf remains
`in_progress`. Actual ready output admitted CAL-05.API, current canonical Mail
handed it off, and active reservations were empty before exact exclusive leases.

The retained calendar-links route authenticated a principal and checked platform
permission bits, but generated an export without checking booking access. A
team-bound key also lost its exact team restriction between authentication and
the booking resource authority. On the old source, actual native HTTP returned
200 for another administered team, the same owner's personal booking, an
unrelated personal-key booking and a booking moved to another team.

The route now uses its existing `BookingPbacGuard` and `BookingAccessService`.
The guard reads primary authority and carries the authenticated API key's exact
team ID. The existing service intersects that restriction with its current team
permission policy before organizer/host access can grant a read. Managed children
retain their existing parent-team behavior; an explicit child team takes
precedence. Personal keys retain the existing organizer/host/team policy.
No new role engine, schema, provider call or booking implementation is added.
Public booking UID routes and guest booking/rescheduling/cancellation contracts
are unchanged. Existing recording/session routes sharing this guard also receive
the current primary/scope restriction.

## Executed proof and reproducible recipe

Use the already qualified locked installation, tracked Yarn, generated custom
Prisma client and checksum-verified local schema engine. The image below is
already local official PostgreSQL 18.6; the runner never pulls it or connects to
a deployed database. Set `CAL_NODE`, `CAL_ENGINE` and a **new** private receipt
directory to those qualified local paths.

```sh
python3 scripts/run-community-enterprise-cloud-tasker.py \
  --suite api-booking-scope \
  --image sha256:29754c7520f4b9654cf8ff98e19ac73b88e255c3a53f6236ebe9d52249bb6df3 \
  --receipt-dir "$CAL_RECEIPT" --node "$CAL_NODE" --schema-engine "$CAL_ENGINE"
"$CAL_NODE" node_modules/typescript/bin/tsc \
  --project tests/community-enterprise/tsconfig.api-booking-scope.json --pretty false
"$CAL_NODE" --test --test-reporter=spec \
  tests/community-enterprise/api-route-inventory.test.cjs \
  tests/community-enterprise/api-session-boundary.test.cjs \
  tests/community-enterprise/api-runtime-admission.test.cjs
python3 tests/community-enterprise/cloud-tasker-runner.test.py
```

The new suite executes the exact native calendar-links controller method and its
decorators, Passport strategy, permission/UID/resource guards, booking service
method, retained booking-access policy, exact native repository SQL and generated
Prisma against an owned, empty PostgreSQL 18 database. Its bounded AST loader
excludes unrelated routes/bootstrap imports. Calendar rendering/translation is a
recorded terminal seam; no external calendar service or live OAuth is exercised.

| Check | Actual result |
| --- | --- |
| Old-source HTTP/PG controls | 5 passed, 5 failed; four unauthorized exports returned 200, missing resource returned 404 before the resource guard was installed |
| Final focused HTTP/PG suite | 13 passed, zero failures/skips; runner exit 0 and owned-container removal verified |
| Cases | Exact team organizer, current team-admin policy, foreign team, personal scope, unrelated owner, revoked key, locked owner, unaccepted/stale membership, resource move, managed child, conflicting direct team, invalid internal scope, missing resource |
| Native strict type check | Exit 0 against actual modified source/import closure, generated types and original API ambient declarations |
| Affected API source checks | 122 passed, zero failures/skips |
| Affected native authentication HTTP/PG regression | 75 passed, zero failures/skips; owned-container removal verified |
| Offline runner controls | 11 passed |
| CJS fixture checkJs | Exit 0, including the existing runtime loader |
| Required tracked-Yarn `type-check:ci --force --concurrency=2` | Stopped at its 180-second deadline, actual exit 129; whole-repository type acceptance is not claimed |

An initial focused type configuration omitted native NextAuth ambient declarations
and produced 29 errors; the retained configuration includes the API's original
`packages/types/*.d.ts` declarations and passes. The first authentication regression attempt stopped in its hook because this
clean tree has no built `platform-types/dist/index.js`. The bounded source loader
now loads tracked native DTOs/enums directly; all 75 actual auth cases then pass.
This is a harness prerequisite correction, not a production auth failure.
Failure and success receipts stay private. No install, full app baseline or SCIM/audit baseline was rerun. The required
repository type command invoked its declared Prisma generation/format prerequisite.
Its seven schema alignment-only changes were compared line-by-line and restored
to the exact original bytes; generated caches were preserved. The command
receipt retains its deadline and actual exit, rather than claiming CI success.

This increment does not complete the full API leaf: native listing, authenticated
detail elevation, mutation and managed-client resource scopes still need their
own discriminating acceptance. Key revocation/disabled-owner proof here is an
actual new-route test, not a claim of production offboarding. Deployment, live
identity/provider acceptance and native schema restoration remain distinct gates.

## Native listing continuation after cf06057a

The next admitted increment retains the same worker, branch and original API
leaf. Exact paths were freshly conflict-free and leased after releasing the
export increment. Source predecessor is
`cf06057a91627d610f654f02c2ee1c46f205a693`.

Native GET `/v2/bookings` discarded the authenticated key's team ID while
constructing the service principal. It now carries that server-owned restriction
through the existing booking service and `getAllUserBookings` wrapper. The service
uses the existing native `KyselyWriteService` so authorization uses primary state.
Inside the retained repeatable-read listing snapshot, the current permission
policy must authorize the exact team and the existing team-resource predicate
constrains the visibility base. Requested identities further restrict it. Counts,
pages, managed children and recurring-series metadata use that same base; no new
permission engine or request-controlled grant is added.

The expanded bounded fixture executes real native controller methods/decorators,
DTO transformation, Passport, service, shared wrapper, full retained SQL query,
policy, parsers, primary Kysely provider, native output transformation and Prisma
hydration against owned PostgreSQL 18. It excludes unrelated routes/bootstrap;
application-global connection and diagnostic logging are substituted. Its HTTP
validation uses whitelist/transform. SQL policy, joins, data and authorization
are real. The nonrecurring output path is executed; full public booking/seat,
provider and production behavior is not claimed tested by this fixture.

| Continuation check | Actual result |
| --- | --- |
| Old native list source, expanded suite | 15 passed, 10 failed; foreign/personal rows, counts/pages, filters, managed conflicts, current membership, invalid scope and recurring metadata discriminate the gap |
| Fixed native HTTP/SQL PG suite | 25 passed, zero failures/skips: 13 retained export controls and 12 added listing controls; actual runner exit 0, owned container removed |
| Affected retained query PG suite | 40 passed, zero failures/skips; unscoped native listing contracts retained, actual runner exit 0 and owned container removed |
| Native strict source/import-closure typing | Exit 0; source-owned config now explicitly includes the changed service, wrapper and query |
| CJS checkJs | Exit 0 for expanded fixture/helper |

The existing reproduction command above runs the expanded `api-booking-scope`
suite. The affected query regression uses the same owned runner/options with
`--suite bookings`. Its database identity, template copy, actual SQL and cleanup
checks remain unchanged. No full app/SCIM/audit baseline, install or provider action
was repeated. The earlier whole-repository type deadline is retained; full CI
success is still not claimed. That task's build/generation prerequisites are not
rerun for this increment; changed native source/imports are type-checked directly.

CAL-05.API stays `in_progress`. Authenticated detail elevation, mutation resource
scopes, managed OAuth-client resource intersection and concurrent post-query
hydration still require separate acceptance. The retained API hydrates selected
IDs after the listing snapshot; this increment does not claim atomic cancellation
of already admitted reads or writes. Live identity/provider/serving-image gates
remain separate and do not block the next authorized source slice.

## Seated detail elevation and native deletion continuation

Existing CAL-05.API, source predecessor
`adecb225f9cff06f638b0348a47b4f04dda276f3`. Fresh inbox and exact-path conflict
checks admitted the next narrow leases; the previous ten leases were released.

A team key still gained private seated-attendee visibility through the event
owner's identity in another team or a personal event. The retained
`EventTypeAccessService` now checks current actor activation, exact key/resource
team (including managed parent ownership) and the existing permission policy
before native owner/host/admin elevation. Its policy is re-exported through the
owning platform library, as required for native API imports. Public UID detail
continues to return its public representation; explicit public attendee settings,
personal-owner and accepted team-admin detail controls remain effective.

Modern DELETE `/v2/event-types/:eventTypeId` formerly discarded the principal's
scope and passed only its user ID. It now passes the full server-authenticated
principal. The retained service checks the original owner assertion and current
principal/scope/action permission, then invokes the retained repository delete in
one serializable primary transaction. Existing repository methods accept that
transaction client while their default callers retain their prior connections.
Foreign/personal team-key scope receives the same not-found response as missing
resources. Being an administrator still does not replace the existing owner
requirement for deletion.

| Continuation check | Actual result |
| --- | --- |
| Corrected old-source controls | 31 passed, 5 failed: two hidden-attendee elevations, two out-of-scope real deletes, and the database trigger requiring serializable deletion |
| New native HTTP/domain/PG suite | 42 passed, zero failures/skips; actual runner exit 0 and owned database container removed |
| Current-state mutation controls | After actual native API-key authentication: revoked membership, read-only custom-role drift, disabled personal owner and changed event owner refuse deletion and preserve the row |
| Native transaction proof | Actual PostgreSQL BEFORE DELETE trigger rejects a non-serializable write; the native route passes with the transaction-bound service/repository/policy |
| Native strict source/import-closure types | Exit 0 against the actual added policy export and modified source/generated types |
| CJS checkJs | Exit 0, including typed exception predicates and the new bounded event fixture |

The first old-source attempt had an additional anonymous-detail failure because
its fixture omitted the required local session secret. A generated, memory-only
task-local secret corrected that prerequisite before the five genuine source
failures were recorded. Both receipts are preserved. No external credential,
provider, schema edit, install or full application baseline was required.

The fixture executes the native detail/output/attendee-seat paths, full retained
event access class, native membership/team repository bodies, actual principal
admission, and real synthetic event deletion. Public/foreign/personal representations
and row preservation are asserted. Other event-type versions/mutations and
personal-key host/team membership boundaries remain unfinished, as does the
post-list hydration gap. Key revocation already admitted in flight is not claimed
atomically canceled. Full API assembly, provider/identity/deployed acceptance and
original programme gates remain separate; CAL-05.API is still `in_progress`.

## Current personal-key resource membership continuation

Source predecessor `e835a200354fba92dd3a70adc6484edb4c2f6b83`; the same native API
leaf and worker continue under five freshly clear exclusive path leases.

The next eight old-source failures demonstrated that personal-key admission alone
let retained owner/Host rows revive private team access after membership or
custom-role changes. Managed-parent and parent-organization revocation had the
same gap, and a personal credential could still delete a revoked team resource.
A personal key's instance-admin flag replaced a resource relationship. The native
organization-admin lookup also classified every parentless standalone team as an
organization, exposing a coworker's personal seated roster.

The retained event authority now intersects current resource-team/action policy
before its existing owner/Host/admin relations, including personal credentials
and managed children. Valid member hosts remain permitted. Exact team-key
restrictions retain their administrator ceiling. API-key authentication still
returns its existing personal instance-role flag; that flag alone cannot grant a
resource relationship. The existing native organization lookup now requires
`isOrganization: true`. No alternate permission engine, role data migration,
Host deletion or new credential model is introduced.

| Continuation check | Actual result |
| --- | --- |
| Expanded old source | 43 passed, 8 failed; all failures exercise real native HTTP/database authorization rather than missing harness prerequisites |
| Fixed HTTP/domain/PG suite | 51 passed, zero failures/skips; actual runner exit 0 and owned container removal verified |
| Positive controls | Existing personal authentication flag, accepted member Host, true organization administrator, explicit custom-role read and owner-only delete grant, public UID/attendee setting and all previous scope controls retained |
| Native strict source/import-closure typing | Exit 0 |
| Expanded fixture checkJs | Exit 0 |

A retained Host row is explicitly asserted present after refused access; current
membership policy supplies revocation. The real read-only/custom delete role
controls use tracked Role/RolePermission and Membership records in the owned
fixture. The existing PG command now runs all 51 focused cases. There is no new
install, schema, external identity/provider call or application baseline rerun.

The complete API leaf remains open. Post-list hydration, legacy/other mutation
routes, managed-client resource binding and primary freshness of every remaining
native relation require separate proof. Deployment, external revocation/identity,
full native restoration and whole CI acceptance remain separate original gates.

## Retained attendee masking through native API hydration

Source predecessor `ecd8050744e881bb5742d54b47e1ad8986df448a`; four exact paths were
freshly clear and leased. Original CAL-05.API remains the active source leaf.

The shared native listing query already selected a participant's permitted seated
attendee/seat identities. The API service narrowed that result's type to booking
IDs, reloaded complete attendee/seat data, and formatted it as visible. Five
actual old-source failures exposed another participant's private answer in normal
and recurring lists, a newly added seat, an attendee rebound to another email and
seat data attached to another booking.

The service now retains the actual inferred query result and preserves its
attendee ID/email pairs and selected seat reference IDs when hydrating native
output data. Unselected/rebound attendees are omitted; a seat reference outside
the selected booking snapshot supplies no seat data. The retained query, policy,
SQL, native repository and output transformation remain the same. This applies
its existing privacy decision rather than introducing another permission engine.

| Continuation check | Actual result |
| --- | --- |
| Expanded old source | 53 passed, 5 failed, all five discriminate real native hydration privacy failures |
| Fixed native HTTP/domain/output/PG suite | 58 passed, zero failures/skips; runner exit 0 and owned database container removal verified |
| New controls | Normal/recurring participant own answer; real DB additions/rebinding between query and native hydration; foreign-booking seat data; legitimate owner roster and explicit public-attendee setting |
| Native strict source/import-closure types | Exit 0 with the actual inferred shared query result |
| Expanded fixture checkJs | Exit 0 |

The controlled hydration seam only sequences real database changes before the
unchanged native repository query; it never substitutes a permission result or
query rows. Source/query-selected identities, actual SQL, native output and row
counts are asserted through HTTP. No app/SCIM/audit baseline, install, schema,
provider or production action was repeated.

This closes the selected attendee/seat masking loss. Other post-snapshot booking
fields, native relation freshness, other mutation/version families, managed-client
resource binding and external/runtime programme gates remain open. The complete
API leaf and original 39-node goal are not complete.

## Current primary event authorization snapshot

Source predecessor `0619a282a508a0c222197dd2139d70d2522f7808`; nine newly clear exact
paths were leased after the previous increment's four leases were released.

The retained event authority mixed current primary scope checks with an owner
from a lagging descriptor and Host/admin queries using read repositories. Actual
PostgreSQL repeatable-read old snapshots demonstrated four stale-relation grants;
a custom read role also inherited builtin administration from its stored ADMIN
label. These were authorization decisions on real native methods/data, with no
mock permission booleans or synthesized query results.

Read authorization now gets the current actor/resource and runs the retained
owner, Host/assignment, team and organization relation checks within one primary,
read-only RepeatableRead transaction. Existing native repository methods accept
the explicit transaction client while keeping their default callers intact.
Builtin administrator queries require `customRoleId: null`; the existing shared
policy still checks explicit resource permission. Current actor role is checked
before an already verified non-key system-admin flag can grant its legacy access.
The serializable mutation transaction continues to use the same scope helper
without being replaced by a read-only transaction.

| Continuation check | Actual result |
| --- | --- |
| Old-source controls | 58 passed, 5 failed: changed owner, removed Host, demoted team/org administrator, custom-role ADMIN-label inheritance |
| Fixed native HTTP/domain/PG suite | 64 passed, zero failures/skips; runner exit 0 and owned PG container removal verified |
| Real transaction mode | Native relation call executes a PostgreSQL query asserting `repeatable read` and `transaction_read_only = on`; native admin output remains correct |
| Native strict source/import-closure typing | Exit 0 |
| Expanded fixture checkJs | Exit 0 |

The stale-reader fixture opens a real database snapshot, commits changes through
the primary client, then dispatches HTTP while native read repositories continue
to use that old snapshot. The current authority refuses the stale grant. A missed
org-client forwarding call caused one intermediate negative to fail and was
corrected; all failure/success and patch-attempt receipts remain private. The
fixture never substitutes authorization results or native SQL bodies.

All previous owner/host/custom-role/public UID, export, list, seat masking and
serializable delete controls remain green. No install, schema, full application
baseline, provider or production action was required. CAL-05.API and the original
39-node goal remain in progress: complete native client/resource scope, other
routes/versions, remaining output fields and original runtime/provider gates need
separate acceptance.

## Native private-link owner admission

Source predecessor `b361db0ac76807eb1d33640cda2d0dfbca427766`; eight exact paths
were clear and leased. The original CAL-05.API leaf remains in progress.

The native private-link ownership guard previously checked an owner lookup alone,
losing the admitted key's team scope, current membership and action permission.
It now uses the same retained event authority's current primary owner snapshot.
GET/HEAD requires eventType.read; mutation admission requires eventType.update.
The original owner-only assertion remains: another team administrator cannot
manage the owner's links. Invalid internal principals fail closed.

| Continuation check | Actual result |
| --- | --- |
| Old native source | 67 passed, 5 failed: foreign-team list/mutations, team-key personal event, revoked personal membership and custom read-role write |
| Fixed native HTTP/domain/PG suite | 74 passed, zero failures/skips; exit 0 and owned container cleanup verified |
| Positive and binding controls | Actual native create/list/update/delete; foreign link remains unchanged; read-only role GET/HEAD; non-owner administrator refused; revoked key/disabled owner refused |
| Native strict source/import closure and fixture checkJs | Both exit 0 |

The fixture compiles the actual native controller, guard, input/output services,
repository and link helpers against the tracked 103-model PostgreSQL schema.
The actual native HashedLink model is present; this slice needs no restoration,
provider credentials or external keys. No authorization outcome is substituted.

This is admission evidence. A mutation can still race admission and write; the
next bounded source slice must share current authorization and native mutation
in a transaction. Managed-client resource scopes, other route/version families,
full CI and original runtime/provider gates remain separate unfinished criteria.
No install, whole-app/SCIM/audit baseline or production action was repeated.

## Native private-link transactional authority

Source predecessor `d800c01990d51ca602f0f7561e8d0eea8f4fd5c2`; seven exact paths
were freshly clear and leased. Native ready/inbox and real reservations were
checked after releasing the preceding increment's leases.

The actual controller now retains the authenticated principal through the native
service. The service reuses EventTypeAccessService's owner/action/key/resource
check inside the same primary transaction as the existing HashedLink repository
operation: Serializable for writes, read-only RepeatableRead for listing. The
repository accepts the explicit transaction client; its default callers keep
their existing behavior. Update rereads use that same client, and create selects
only output fields. Existing input/output and event/link binding remain intact.

| Continuation check | Actual result |
| --- | --- |
| Old source | 74 passed, 6 failed; all newly added controls discriminate the race or absent native transaction |
| Fixed native HTTP/domain/PG | 80 passed, zero failures/skips, exit 0; owned PG cleanup verified |
| Changes after the real owner guard | Create refuses revoked membership; update refuses moved resource; delete refuses changed owner; list refuses disabled principal; rows preserved |
| Actual database mode | HashedLink INSERT/UPDATE/DELETE trigger requires Serializable; native list repository query observes RepeatableRead and read-only mode |
| Native strict source/import closure and fixture checkJs | Both exit 0 |

The sequencing hook calls the real native owner guard, commits a real database
change, then allows native HTTP dispatch to continue. It supplies neither
authorization decisions nor repository rows. All previous positive owner/role,
foreign-link, native key revocation and output controls remain green. The typed
service no longer needs its prior any casts for actual generated-client data.

This closes the selected guard-to-service transactional gap. Admission token
validity is still established by the native authentication path; this evidence
does not claim every other API/client/version or concurrent revocation boundary.
CAL-05.API and the original 39-node programme remain in progress. No install,
whole application baseline, external key, provider or production action occurred.

## Private-link bearer unpredictability and same-clock creation

Source predecessor `351bf193615300a014aa0e08b0380ef9014b0235`; four exact clear
paths were leased after fresh original ready/inbox/reservations inspection.

The native helper derived its bearer link from UUIDv5(user ID : millisecond).
An observer knowing those public inputs could reconstruct the private URL, and
two creates for the same owner and millisecond collided at the unique key.
The helper now uses the existing UUIDv4 implementation's cryptographic entropy
while retaining short-UUID encoding and its existing caller signature. Existing
links are read unchanged; no schema, dependency or real credential is issued.

| Continuation check | Actual result |
| --- | --- |
| Old source | 80 passed, 3 failed: same-clock uniqueness, exact public-seed reconstruction, second native create |
| Fixed actual HTTP/domain/PG | 83 passed, zero failures/skips, exit 0; owned database cleanup verified |
| Entropy/format controls | 256 distinct IDs with identical owner/time; each decodes to valid UUIDv4 with existing 22-character short format; public-seed prediction differs |
| Native route compatibility | Two actual owner creates within one frozen millisecond return 201 and distinct persisted links; native listing retains old and new links |

The tests use Node's Date-only mock and actual tracked helper/native HTTP/service/
repository/PostgreSQL. No external/private production URL is guessed or probed.
The retained authority, serializable mutation and positive/denial controls remain
green. Full client/resource/version and original runtime programme acceptance
remain open; the complete API leaf is not closed by this source increment.

## Calendar export current authority and primary output snapshot

Source predecessor `26cbdb5829dfc67d8eb3710c4038936d38c9e76e`; nine exact clear
paths were leased after fresh original ready/inbox/reservations checks.

The guard checked primary authority, but the native service dropped the principal
and reloaded output from independent read repositories. It now retains the full
principal and repeats the same BookingAccessService authority inside a primary,
read-only RepeatableRead transaction. Both native booking and event repository
hydration use that transaction. Shared access/repository methods accept an
explicit client while default callers preserve their previous behavior.

| Continuation check | Actual result |
| --- | --- |
| Old native source | 83 passed, 6 failed: post-guard moved resource, disabled actor, revoked membership, changed personal organizer; lagged output; absent authority transaction |
| Fixed actual native HTTP/domain/PG | 89 passed, zero failures/skips; exit 0 and owned database cleanup verified |
| Actual output contract | Tracked calendar formatter and event-name parser run; Google/Office/Outlook/ICS IDs retained; decoded ICS contains VCALENDAR; current title/description/location present and old snapshot values absent |
| Same database mode | Native hydration query observes primary RepeatableRead and transaction_read_only=on |
| Native strict import closure and fixture checkJs | Both exit 0 |
| Affected authorization/route-inventory source checks | 68 passed, zero failures/skips |

Real changes commit after the native guard returns its actual authority decision.
A separate real PG snapshot retains old booking/event rows during native HTTP
dispatch. Neither test substitutes policy outcomes or SQL results. Export
generation is never reached after refused authority. The bounded formatter loader
excludes the unused location-placeholder lookup and localization loading; the
formatter, event naming, ICS library, schema and database remain actual source.

An initial direct verification command mistakenly included api-assembled.test.cjs,
whose isolated-runner precondition refused before full-API bootstrap. That receipt
is preserved; it provides no assembled API acceptance. The corrected affected
source checks pass. Full build/whole CI/API image, managed-client/version scopes,
remaining key/resource edges and original runtime gates remain open. No install,
whole-app/SCIM/audit baseline, provider or production action was repeated.

## Personal API-key resource membership before organizer/Host grants

Source predecessor `4a184c7285c9d1c1a4c9c725c143c04d78dd0fba`; four clear exact
paths were leased after fresh original ready/inbox/live-reservation checks.

An explicit personal-key marker now requires current resource permission before
the retained organizer/Host decision. The shared existing policy admits either
eventType.read or booking.readTeamBookings on the real team/managed-parent team.
This retains active MEMBER host access and either existing custom read role,
while honoring membership/root revocation and custom-role action rather than
its ADMIN storage label. The relation check still runs afterward: resource read
alone cannot expose another organizer's private export. Legacy callers omitting
the API marker retain their original behavior. No new permission is introduced.

| Continuation check | Actual result |
| --- | --- |
| Old-source negatives | 94 passed, 3 failed: revoked organizer membership, retained Host after root removal, non-read custom role inheriting ADMIN label |
| Final native HTTP/domain/PG | 98 passed, zero failures/skips; exit 0 and owned cleanup verified |
| Positive/no-widening controls | Current MEMBER Host; explicit eventType.read and booking.readTeamBookings owner roles; unrelated organizer denied; personal resource without team retained; default legacy caller unchanged |
| Native strict source/import closure and final fixture checkJs | Both exit 0 |
| Affected shared authorization source checks | 67 passed |

The initial fixed run passed 96 of 97 and refused an old positive fixture's
organizer who had no team membership. Its allow/deny assertions remain intact;
the legitimate positive now establishes accepted MEMBER membership. A separate
absent-membership organizer negative records the boundary explicitly. The final
98-case actual run passes. All old/failure/corrected receipts remain private.

The native export still shares the primary read-only authority/output snapshot.
No unchanged whole app, SCIM or audit baseline, install, external key or production
action was repeated. Managed-client resource binding, other API/version families
and original runtime/provider acceptance remain unfinished; CAL-05.API stays open.

## Selected managed-client event resource scope

Source predecessor `94818514781d4481ed2a221a1e4dd659572a5a67`; eight exact clear
paths were reserved after fresh original ready/inbox/live-reservation inspection.

Native Passport now retains the selected platform client ID for client credentials
and managed access-token admission. The existing permission guard binds it to the
currently verified client and rejects a mismatch. The retained event authority
checks that same current client in its primary transaction: the actual resource
team must be its root or direct child; a personal event must have an explicitly
client-associated owner. Current principal/action/membership and owner/Host rules
still run. An explicit foreign team takes precedence over a managed parent.

| Continuation check | Actual result |
| --- | --- |
| Old native source | 101 passed, 6 failed: foreign list/mutation; global personal-key shortcut; post-guard org movement; foreign optional roster; deleted client behind lagged native admission |
| Final native HTTP/domain/PG | 111 passed, zero failures/skips; exit 0 and owned database cleanup verified |
| Affected native auth PG | 75 passed, zero failures/skips; exit 0 and owned cleanup verified |
| Affected runtime/session/inventory source checks | 122 passed |
| Native strict import closure and final fixture checkJs | Both exit 0 |

The added bounded loader executes the native OAuth-client, owner-membership and
user/profile repositories. Explicit fixture providers now take precedence over
defaults, so no fake owner lookup or permission result supplies admission. The
controls use actual Passport, guards, controller, service, repository and SQL.
Two real organizations are administered by the same principal with ADMIN global
role, which no longer broadens client resource scope. A real RepeatableRead
client-reader snapshot survives primary deletion during optional detail dispatch.
Current primary authority strips roster elevation despite that stale admission.

Root/child CRUD, actual owner assertion, explicitly associated personal owner,
managed-parent fallback and explicit foreign-team refusal are proven. A secondary
foreign API key does not widen the selected client. Current read-only client bits
permit listing and refuse mutation through the existing native permission guard.
Existing anonymous UID capability and all prior native key/role controls remain.

These resource controls use client-credential HTTP admission; existing managed
access-token admission regressions pass, but complete access-token resource/bit
coverage is not claimed. Other native list/export paths still drop client scope;
optional-route permission/cache checks, legacy versions, full API image/CI and
original runtime/provider criteria remain open. CAL-05.API stays in progress.
No unchanged app/SCIM/audit baseline, install, external credential, provider or
production action was repeated.

## Managed-client scope in native calendar export

Source predecessor `8672d2bd9e7950695e73f02d46ec0862caef5ec1`; eleven exact paths
(nine code files) were freshly clear and leased. Original ready/inbox and actual
active reservations were checked before selecting this existing API gap.

The native booking guard and export service now retain the selected client ID.
The previously proven current-client event predicate moved unchanged into the
existing shared authorization module and is reused by retained BookingAccessService.
Native booking queries select the real event owner needed for personal scope.
Current existing event/read-team membership permission constrains client organizer
and Host grants, just as explicit personal keys. The primary export transaction
therefore binds resource scope, active principal, retained policy and actual output.
Default callers and the event authority's existing behavior remain intact.

| Continuation check | Actual result |
| --- | --- |
| Old native source | 112 passed, 7 failed: foreign/personal export, post-guard org/root-membership/deleted client, explicit foreign team over parent, secondary foreign key |
| Fixed native HTTP/domain/PG | 119 passed, zero failures/skips; exit 0 and owned cleanup verified |
| Positive source contracts | Own child and root exports, explicit personal owner association, managed-parent fallback, real calendar/ICS output and all prior key/role/client event controls retained |
| Native strict source/import closure and fixture checkJs | Both exit 0 |
| Affected shared authorization/inventory source checks | 68 passed |

The current client predicate has one implementation. It supplements the existing
membership and booking relation authority; it does not replace it or grant access
from a client association alone. All database reads for export use the existing
primary read-only snapshot. Actual database changes commit between native guard
and native service, and refused authority never reaches calendar generation.

Client listing still loses selected scope; optional-route permission/cache,
complete access-token resource coverage, other API versions and original runtime
criteria remain open. CAL-05.API and the original 39-node programme are not closed.
No install, unchanged app/SCIM/audit baseline, provider or production action ran.

## Native error-header credential redaction

Source predecessor `4e769154e655bcf478bd7c05e54ba32da7ee2fd8`; four exact clear
paths were leased after fresh original ready/inbox/live-reservation inspection.
While wiring the next native listing error controls, source inspection found that
filterReqHeaders copied raw Authorization and the native TRPC exception filter
logged that object. This disjoint credential-exposure correction precedes listing.

Present Authorization values now become [REDACTED], including title/lowercase,
multiple and empty values. Absent headers remain absent. The input is unchanged,
selected diagnostic context remains, and existing cookie/client-secret omission
is retained. No real credential was supplied or copied into any test or receipt.

| Continuation check | Actual result |
| --- | --- |
| Old native source | 1 passed, 7 failed |
| Fixed focused source tests | 8 passed, zero failures/skips |
| Actual native TRPC filter logger sink | Synthetic bearer absent; redaction marker present; native 403 response contract retained |
| Production helper and final fixture types | Both exit 0 |

The exact focused command is `node --test --test-reporter=spec
tests/community-enterprise/api-request-logging.test.cjs` using the qualified Node20.
The production helper is typed directly with noEmit, skipLibCheck, ES2022, CommonJS
and Node types; the fixture uses the existing checkJs recipe. Initial fixture type
modeling errors were corrected and all failure/final receipts remain private.
No PostgreSQL or whole application baseline was needed for this two-line behavior
change. Full request-body/privacy, persistent audit and complete API/runtime
acceptance are not established. The next existing gap remains client listing.

## Managed-client native listing visibility snapshot

Source predecessor `350d797e4dba144edae7ebf9968a7ed23e779a22`; eight exact clear
paths were leased after fresh original ready/inbox/live-reservation inspection.

Native dispatch now retains the selected client ID through the existing service
and shared wrapper. The retained primary read-only query resolves its current
valid root before permission evaluation, overriding a different default profile.
Existing PermissionPolicy supplies current read-team and event-read grants within
that root; the existing booking identity predicate and client-associated personal
owners constrain visibility before requested filters, rows, counts and metadata.
The original role engine, SQL query, output contracts and default callers remain.

| Continuation check | Actual result |
| --- | --- |
| Old native source | 120 passed, 12 failed: scope rows/count/page/search, personal/root/parent, current client changes/revocation/shape, series/rescheduler and invalid marker |
| Final native HTTP/domain/PG | 133 passed, zero failures/skips; exit 0 and owned cleanup verified |
| Affected retained listing PG | 40 passed, zero failures/skips; exit 0 and owned cleanup verified |
| Affected shared authorization/inventory source | 68 passed |
| Native strict import closure and final fixture checkJs | Both exit 0 |

Actual native owner/profile lookup now runs rather than a default-profile stub.
A real default profile in another administered organization cannot substitute
for the selected client. Native root/child/parent and explicit personal association
remain useful; caller search filters cannot widen scope. Current client movement
changes the visible scope; deletion, invalid root and disabled principal receive
the existing native TRPC filter's 403. Root revocation cannot retain team records
through an organizer shortcut. Counts and shared-query series/rescheduler metadata
use the same scoped visibility base and read-only transaction.

The first fixed attempt passed 132 of 133: its search control used unsupported
teamIds instead of the native teamsIds input. The response still contained only
current-client rows. The corrected actual legacy parameter is proven by the final
run; no production parameter was renamed. Failure/corrected receipts are private.

This proves native page membership/counts and the retained query's metadata. The
API formatter can still perform a separate predecessor lookup when hydrating
rescheduledByEmail; other post-query fields, optional permission/cache, complete
access-token/version and original runtime acceptance remain open. CAL-05.API and
the full 39-node goal stay in progress. No unchanged app/SCIM/audit baseline,
install, external credential, provider or production action was repeated.

## Authorized rescheduler retained through native list output

Source predecessor `6e47934d34896d517d95f24ed3e81b53d8452f38`; five exact clear
paths were leased after fresh original ready/inbox/live-reservation checks.

The actual native query selected a safe predecessor rescheduler, but the API
formatter discarded it and queried the predecessor again without its scope.
Normal and seated list output now receive an optional typed context from that
actual selected snapshot. Explicit null prevents a fallback lookup. Current-row
fallback and rescheduled-row precedence are computed from the selected row,
preserving the existing native contract. Other callers can omit the context.

| Continuation check | Actual result |
| --- | --- |
| Old native source | 134 passed, 6 failed |
| Fixed native HTTP/domain/PG | 140 passed, zero failures/skips; exit 0 and owned cleanup verified |
| Proven negative paths | Team key normal list, managed seated list, participant own-seat list and real query-to-hydration predecessor movement/email change |
| Positive/fallback contracts | Authorized predecessor preserved without late getByUid; participant own answer retained; current-row fallback and rescheduled-row precedence retained |
| Native strict source/import closure and fixture checkJs | Both exit 0 |

The drift hook commits a real predecessor team/email change after the actual
query and before unchanged native hydration. Output retains the authorized
original snapshot email. No permission result, query row or SQL body is replaced.
The existing policy/query provides the decision; this only preserves it through
the existing mapper. Existing reschedule UID fields and recurring output shapes
remain intact; no new API field or permission engine is introduced.

This closes the selected list email re-read. Other hydration fields, other output
paths/secondary lookups, optional client permission/cache, complete API versions
and original runtime criteria remain open. CAL-05.API and the full goal stay in
progress. No unchanged app/SCIM/audit baseline, install, external credential,
provider or production action was repeated.

## Current credential permission on optional UID and seat reads

Source predecessor `b881cc46dd93cc1a482c00cc8d2eb9a602fc8b25`; six exact clear
paths were reserved after fresh original ready/inbox/live-reservation inspection.

Native UID and seat reads now declare BOOKING_READ after optional authentication.
A thin OptionalPermissionsGuard delegates to the existing PermissionsGuard for
every present principal; only null/undefined anonymous principals skip it. The
existing current-client bits, secret, active owner and native credential selection
remain authoritative. No second permission engine is introduced. Native Nest
discovers the subclass and resolves its inherited repository dependencies.

| Continuation check | Actual result |
| --- | --- |
| Corrected old native source | 142 passed, 6 failed |
| Fixed native HTTP/domain/PG | 148 passed, zero failures/skips; exit 0 and owned cleanup verified |
| Current native negatives | Missing/read-wrong/write-only bits; permission diminution and secret rotation behind real lagged client admission; custom-role OWNER label; secondary key; deleted client |
| Preserved positives | BOOKING_READ-only scoped owner; anonymous UID hides roster, anonymous seat retains its own attendee; all prior domain/scope controls |
| Authentication/inventory source checks | 118 passed |
| Native strict import closure and both changed JS fixtures | Exit 0 |

The original stale/deleted-client privacy control now expects a stricter supplied
credential 403; a separate anonymous request to that UID still returns 200 with
no roster. Source guard-order checks accept the optional form only for these two
reviewed read methods and BOOKING_READ, rejecting reversed/missing authentication,
unreviewed mutations and write metadata. Existing assertions remain meaningful.

An initial old-source seat control used wrong case allowed-first instead of the
actual allowed-First fixture reference, causing native 404s; corrected old proof
is recorded separately. The broader changed JavaScript check exposed older
fixture narrowing/AST/interface errors, corrected without removing assertions.
All failure/corrected receipts remain private. No whole application, SCIM/audit
baseline, install, provider or production action ran. Other mutation/route/token
versions, output fields and original runtime criteria remain open; CAL-05.API and
the full original goal are not complete.
