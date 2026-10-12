# Reviewed Authentik account onboarding

Date: 2026-10-13 (Pacific/Guadalcanal). Predecessor candidate:
`d158a73e38d955d3ca8a8d0e4a589d550d9e1d5b`.
Scope: an operator command and database transaction for linking existing accounts.
No live staff account, IdP application, shared database or deployment was changed.

## Final verification

- 24 real PostgreSQL checks passed, including actual CLI plan/apply/replay and native sign-in compatibility; no failures or skips.
- 132 enterprise source/protocol/graph checks passed, including four CLI input/target/file regressions; no failures or skips.
- Strict ES5-target TypeScript check passed for the new service and its actual dependencies. Biome error-level checks passed on seven changed code/config files.
- Immutable candidate install and explicit Prisma generation passed; the lockfile is unchanged. This is not a fresh web/API image build.
- Targeted UBS inspected three files: zero critical findings, five warnings for synchronous filesystem operations in the one-shot CLI, and 19 information findings. The warnings are retained and reviewed, not suppressed: files are size-bounded, output is exclusive-create, and partial JSON cannot authorize apply. This is not a full dependency/image/secret scan.

A stronger negative test initially failed: the new workflow could supplement an
existing Authentik identity with a different one on the same user. The operator
boundary now refuses that case. A second real concurrent test proves two different
subjects cannot both be attached to one user. The initial red run was 22 passing
and one failing; final verification is 24 passing, with no weakened assertions.
This is a guard on the new operator workflow, not a claim that every legacy writer
or a database administrator is constrained by it.

## What this closes in the implementation

The native identity helper previously depended on its caller to provide a safe
transaction and an audit record. The new AuditedIdentityLinkService supplies that
boundary, and `yarn enterprise:identity-link` makes it usable without hand-edited
Account SQL. It reuses the existing Account and EnterpriseAuditEvent tables;
there is no schema migration, new runtime dependency or new web/API endpoint.

Only an active, explicitly identified global Cal instance administrator may use
this operation. That operator must also be an accepted member of the chosen root
organization. An organization administrator is not sufficient: letting ordinary
team administration attach another person's sign-in identity would be an account
takeover capability. All targets must be existing, unlocked, accepted organization
members with the exact reviewed user UUIDs. No user, membership or role is created
or elevated by this command.

The CLI runs with an already authorized operator's database access. The actor ID
and UUID are checked attribution, not cryptographic authentication of the human
running the command. Protect that execution environment and review the mapping.
The plan checksum detects accidental changes; it is not a digital signature or
an independent second approver.

## Dry run and apply

The request contains an operation UUID, operator ID and expected operator UUID,
root organization ID and expected slug, and up to 25 target user IDs/UUIDs paired
with their verified stable OIDC subjects. Repeated subjects or user IDs are
rejected. Use issuer/subject values established from the real provider; never
substitute an email address or infer membership from a domain.

`plan` uses a read-only repeatable-read transaction. It creates no account or audit
rows and writes a new local plan file with mode 0600; it will not overwrite an
existing file. The plan contains account-key hashes, not raw subjects, emails or
provider credentials. Store the request securely as it contains identity mappings.
Input paths must be bounded regular JSON files, not symlinks.

Plans expire after 15 minutes and are bound to the request, application origin,
normalized issuer and database endpoint/identity fingerprint. `apply` also verifies
the expected database name specified by the operator. The fingerprint includes the
configured endpoint, database role and server address; it does not include the
connection password and is not a replacement for authenticated database transport.
Failover or changed endpoints may require a new plan, deliberately.

Apply locks duplicate operations and target users in deterministic order, then
rechecks current user, organization, membership and account bindings. It also
rechecks expiry after acquiring the locks. An account disabled while the operation
waits cannot be linked using old reviewed state. The batch and its audit record
commit together. Audit failure rolls back all new links. Competing claims on one
subject cannot create two bindings or two successful audit records.

Replaying the same operation returns its existing receipt only while every saved
binding still matches. An unlink or replacement binding makes the replay fail;
an old successful request cannot resurrect a revoked sign-in. Existing matching
bindings are preserved rather than deleted/recreated. A different existing
Authentik binding on the target user causes refusal, not a second sign-in route. There is no force-rebind
option. Post-commit correction/revocation remains a separately reviewed operation;
this command is not a general-purpose unlink or account-recovery service.

## Commands

Use an authorized environment with the intended `DATABASE_URL`, server-side
`CAL_AUTHENTIK_ISSUER` and `NEXT_PUBLIC_WEBAPP_URL`. The issuer and origin must be
HTTPS. The operator command needs no client secret and loads no `.env` files.
The selected database name must match the actual connected database.

```sh
yarn enterprise:identity-link plan --request /secure/request.json --out /secure/reviewed-plan.json --database calcom_preview
# Review the mapping and the generated plan before applying the same request.
yarn enterprise:identity-link apply --request /secure/request.json --plan /secure/reviewed-plan.json --database calcom_preview
```

These paths and database names are examples, not production account mappings.
Required request shape (replace placeholders with reviewed values):

```json
{
  "operationId": "<new UUID>",
  "actorUserId": 101,
  "actorUuid": "<existing operator UUID>",
  "organizationId": 20,
  "organizationSlug": "<existing organization slug>",
  "links": [{ "userId": 105, "userUuid": "<existing member UUID>", "subject": "<verified OIDC subject>" }]
}
```

The command returns a bounded JSON receipt, never raw provider/database exceptions.
It uses the repository's installed ts-node runtime for execution; the service is
also checked independently with strict TypeScript. Runtime transpilation is not
being presented as a substitute for type checking.

## Verification and boundary

The new real-PostgreSQL suite exercises the actual Prisma service and the actual
CLI, not a fake repository. It covers read-only planning; batch/audit atomicity;
wrong operator role/UUID; locked, pending and foreign members; stale/expired or
changed plans; changed deployment targets; concurrent duplicates and competing
claims; audit-trigger failure rollback; revoked-binding replay; existing binding
preservation; and acceptance by the native Authentik sign-in/token functions.
The CLI test checks restrictive plan permissions, no overwrite, wrong-database
refusal, apply and replay. Separate CLI tests check argument parsing, symlinks,
file bounds and password-free target fingerprints.

```sh
yarn test:community-enterprise:identity-link --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise
```

The same existing disposable-database runner creates the isolated fixture and
stops it afterward. The concurrency test holds a user update open while apply is
started, then commits the lock state and verifies refusal. This is local database
freshness, not a 60-second real-IdP revocation or cross-replica bearer test.

CAL-04.LINK stays in progress until the admitted preview's real subject mappings
and operator attribution are reviewed and exercised. Shared preview admission,
root organization/user onboarding, SCIM/MFA/application-access policies, API v2,
remaining write paths, migration/restore and production acceptance remain open.
This tranche does not rebuild the web image or replace the prior web runtime
receipt: the added service is reached only from the operator command/tests, and
the existing native helper change narrows its issuer-only TypeScript input.
