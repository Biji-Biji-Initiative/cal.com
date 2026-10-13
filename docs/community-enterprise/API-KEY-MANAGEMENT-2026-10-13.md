# API key management and native PostgreSQL acceptance

Date: 2026-10-13 (Pacific/Guadalcanal).
Predecessor candidate: `bc22d6b142e3aa5b5a12f380eb84ff2a7510962b`.
Existing programme: issue #78, CAL-03.ROUTES and CAL-05.API. Their full release
acceptance remains open. The separate #79 research/strategy commission and
existing task identities are not rewritten by this implementation slice.

## Delivered behavior

The existing list, app-key lookup, edit and delete handlers now use a shared
management service and the same bounded Serializable transaction/retry helper
as creation and rotation. The service operates on the caller's own key records;
it is not an organization-wide credential-administration or service-principal API.
No new table, application dependency, public endpoint or workflow is introduced.

An active owner can view their key metadata, change notes and revoke their own
key after membership demotion/removal. Removing a credential does not increase
privileges, so it does not require the owner to retain key-issuance authority.
Changing its expiry does require current issuance authority, including direct
accepted built-in ADMIN/OWNER membership and accepted parent organization
membership where applicable. An expired key cannot be revived through the edit
handler. Editing notes does not silently change expiry, owner, application or
team; extra ownership/hash/nonexpiry fields are rejected by the shared service.

Edit/revoke requires the actual key owner, not another administrator of the same
team. Missing and foreign IDs receive the same denial. Locked users are refused.
Notes can be cleared explicitly, date inputs must be valid, and mutation inputs
are copied before use. Repeating an identical metadata update produces no extra
audit entry. Repeating a successful deletion is denied; no new replay scheme or
secret recovery facility is promised.

Team/organization edits and revocations commit their audit records with the key
change. Audit contains IDs, scope, expiry/change indicators and webhook counts,
not secret values, stored credential hashes or user-authored note content. Existing
personal/standalone-team paths do not invent an organization ID; general auditing
for those scopes remains an explicit gap in the current schema.

Zapier key removal preserves the existing owner-wide Zapier-webhook cleanup,
but moves it into the same transaction. A failure cannot commit the key deletion
without its cleanup/audit, nor can it delete another user's hooks. This preserves
legacy app semantics, not a newly introduced per-key webhook ownership model.

## Read and UI boundaries

List, edit and app-key lookup return only ID, owner/team/app references, note,
creation/last-use times and expiry. They do not return hashedKey or relations.
The normal list preserves its existing Zapier and Cal.ai internal-key filtering;
app-key lookup can still retrieve matching app-key metadata when authorized.
The inspected UI uses the retained metadata fields and derives its type from
the router output; no plaintext generation/rotation response format was changed.

The actual server-rendered settings page had a separate repository path that
fetched complete key records and cached them for one hour before passing them
to the client component. An added regression reproduced the hash in those props.
The page now uses the same current metadata-only service without that row cache.
This removes the separate unsafe presentation path rather than only changing
the tRPC response. The old general-purpose repository is not globally rewritten;
other uninspected consumers are not claimed to be audited by this change.

## Native verification now executed

The main coding machine still had no Desktop Commander connection. The alternate
authorized host g2 was reachable. To avoid a large monorepo build on a disk-limited
host, the exact source files and complete target Prisma schema were fetched by
immutable SHA into a bounded test fixture under /data/tmp. No shared checkout,
worktree, unrelated branch or remote packaging directory was changed.

The isolated verifier used Node 22.23.2, TypeScript 5.9.3, Prisma/client/adapter-pg
6.16.1, Biome 2.3.10 and PostgreSQL 18.6. Prisma generated its actual client from
the unchanged complete schema. Production services, shared policy/adapter,
retained crypto and handler code executed against that generated client and
real PostgreSQL through the native pg adapter. The npm verifier installation
is NOT an immutable installation of the entire candidate, and no new dependency
or lockfile update is part of the application diff.

| Check | Observed result | Scope |
| --- | --- | --- |
| Native PostgreSQL suite | 41 passed; 0 failed/skipped | Real generated Prisma, transactions, schema constraints, query conflicts, services and four handlers |
| Prior key-lifecycle regression suite | 72 passed; 0 failed/skipped | Existing production-code regression suite with its documented doubles |
| Strict ES5 TypeScript | Exit 0 | Both key services and their shared source dependencies against the actual generated schema; not whole web/API builds |
| Biome error-level check | Exit 0 | Eight changed/new TypeScript/JavaScript source and test files |
| Python syntax | Passed | Existing database runner with one added suite choice |
| Gitleaks | Exit 0; no findings | Ten changed code/config/test files, approximately 56 KB, default rules with output redacted |
| UBS | Exit 1: 8 critical-level heuristic findings, 0 warnings, 23 information findings | Two key-service files; findings reviewed below, not suppressed or represented as a clean scan |

The database tests use the existing disposable-runner path. They require its
private Unix socket, assert the server's actual data directory and database user,
refuse a populated fixture, and never use a deployed DATABASE_URL. The runner
installs the full schema into a new empty database and stops/removes its own
server/data after each execution. It is not a migration or restore from legacy
production data.

Real conflicting transactions were synchronized after both old-key reads. Two
rotations yielded one successful replacement and one denied loser; the loser
retried and re-read the now-consumed key. Double revocation produced one deletion
and one audit. Competing rotation/revocation produced one valid serial winner:
when rotation wins first, its new key remains. Deleting an old key ID is not a
promise to revoke every concurrently created successor or all user credentials.

Real PostgreSQL CHECK constraints forced audit insertion failure during edit,
revocation and rotation. The original key and notes remained intact, and Zapier
hooks remained intact. These are actual database rollback checks, not a simulated
transaction queue. Current/removed memberships, locked owners, exact expiry,
foreign keys, secret-safe metadata and unchanged bindings are also exercised.

The page test executes the production page function and real metadata query,
but Next authentication/headers/cache and JSX construction are controlled test
boundaries. It inspects component props, not a rebuilt Next server, browser or
rendered production HTML. This does not extend earlier browser/build receipts
to the newer source bytes.

## Regression controls and initial failures

The first fixture attempt failed before application tests because the driver
could not deserialize PostgreSQL's `name` type for current_user. Casting that
fixture identity column to text fixed the harness; it was not an application
bug. The next 37 native cases passed. Adding the actual settings-page metadata
case produced 37 passes and one genuine failure: hashedKey was present in props.
After repairing that page and adding boundary cases, all 41 passed.

Temporary mutations of task-owned source were then tested against real PostgreSQL:
adding hashedKey to the response selection caused 4 failures; bypassing management
audit caused 7; disabling serialization retry caused 1. Every mutation was restored
byte-for-byte before the final baseline and publication. No production or shared
checkout source was mutated for these controls.

UBS classified eight public-metadata comparisons as unsafe secret comparisons.
The inspected operands were user IDs, the unlocked flag, note change detection,
expiry timestamps, app ID `zapier`, and a note-prefix filter. The management
record deliberately does not select a key hash or plaintext. The two lifecycle
findings compare numeric user IDs. These findings are assessed as rule false
positives, not concealed: the unsuppressed report and source lines are retained.
No scanner rule was disabled and no timing-safe check was removed. The remaining
information findings concern type checks and deliberately propagated database
errors. This is not a full image/dependency/security acceptance or a waiver of
uninspected issues.

## Reproduction and remaining acceptance

After the normal candidate dependency installation and Prisma generation:

```sh
yarn test:community-enterprise:api-keys --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node --test --test-reporter=spec tests/community-enterprise/api-key-lifecycle.test.cjs
```

The new script entry reuses scripts/run-community-enterprise-postgres.py; the
existing suites, fixture isolation and connection limits remain intact. No new
CI lane, worker, deployment system or background task was introduced.

Before release: rerun the complete native web/platform/API build and authenticated
HTTP/browser suites on the exact new revision; recover/reconcile the unpublished
packaging from the original machine; scan and qualify the exact images; exercise
legacy-data migration/restore, real Authentik/SCIM and API bearer revocation across
replicas. Account-offboarding/bulk credential revocation, per-action key scopes,
other legacy repository consumers and universal logging/data minimization remain
open obligations. The synthetic database tests do not prove those requirements.

No real keys, users, memberships or webhooks were changed. No customer message,
calendar action, shared preview, registry publication, main or production change
occurred. Agent Mail registration was not completed; work remained isolated and
publication uses exact predecessor/ref and file-hash checks. Issue #78 carries
this progress without marking the overall API or preview task complete.
