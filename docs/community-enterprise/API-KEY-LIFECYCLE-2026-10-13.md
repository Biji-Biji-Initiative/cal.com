# API key issuance and atomic rotation

Date: 2026-10-13 (Pacific/Guadalcanal).
Predecessor: `3f6cdf5cb0ccf2295bea71d5dcc101440dce6c30`.
Existing delivery issue #78; CAL-05.API remains open at its full acceptance scope.
Status: tested source implementation; not a native build, database or deployment receipt.

## Delivered

The API v2 key service was calling a platform-library stub that always threw.
The web application retained key generation, but its key-create permission query
accepted a matching membership role without checking invitation acceptance.
The API refresh service separately created a replacement and deleted the old
key. It did not bind those operations into one transaction.

One shared lifecycle now serves the existing web create handler and API v2
create/refresh service. The compatibility export `createApiKeyHandler` points
to the actual web adapter; API v2 itself supplies its existing PrismaWriteService
client to the shared service, rather than using an unrelated global client.
No new endpoint, key format, database table, package dependency or runner is added.

The retained MIT `generateUniqueAPIKey` and `hashAPIKey` helpers are reused.
Only the key hash is stored. The plaintext replacement is returned after the
transaction resolves; it is not written into audit records or persisted for replay.
The web response remains a string and the existing API refresh controller retains
its response shape. Its public creation endpoint coverage is not expanded here.

## Authority and scope

Creation requires a current unlocked local user. Team-scoped creation and rotation
additionally require a direct, accepted built-in ADMIN/OWNER membership without
a custom role, plus the existing shared policy's `apiKey.manage` check. The shared
policy verifies the organization hierarchy and accepted parent membership.
An instance ADMIN flag alone does not supply team membership. A parent-org admin
without direct team membership does not gain a new credential-issuance shortcut.

These are existing legacy user credentials, not newly scoped service principals.
A narrow custom role is deliberately insufficient to mint an unrestricted legacy
key, even if somebody assigns it apiKey.manage. Proper per-action API scopes and
custom-role/service-principal support remain separate release work. Do not weaken
this restriction to make custom-role UI tests pass.

Rotation requires the authenticated actor to be the old key's owner, even when
another actor is an accepted administrator of the same team. It preserves the
owner, team, app binding and note from the stored key. Replacement input cannot
change those fields, IDs or hash material. The old key must still exist and be
unexpired in the primary transaction; possession of an expired or revoked key
cannot renew it.

## Atomicity, expiry and audit

Authorization reads, consumption of the exact old key, replacement creation and
organization-scoped audit recording occur within one Serializable transaction.
The code retries only Prisma P2034 conflicts, at most twice after the first try;
each attempt repeats authority and current-key checks. A zero-row guarded delete
fails closed. Any create/audit/delete/commit error prevents a successful result.
Actual PostgreSQL isolation and competing requests still require native testing;
the passing local concurrency-shaped test uses a serialized transaction double.

Expiry is validated at execution time. Omitted lifetime defaults to 30 days.
Non-expiring keys require explicit `neverExpires: true`; an ambiguous null expiry
without that flag is rejected. Existing callers that send both the true flag and
a computed date retain their non-expiring behavior. API lifetime days must be a
positive safe integer and produce a valid date. Dates are copied, not mutated.
The configured prefix is validated and prior keys must actually begin with it.
The existing Bearer parser is reused rather than using a case-sensitive replace.

For a root organization or its child team, audit records include key IDs, actor,
organization, team and expiry, but never plaintext, hashes, the app binding, or
user-provided note content. Failure to persist this audit aborts the transaction.
Personal and standalone-team credentials have no root organization in the current
schema; their compatibility paths do not invent an organization ID and do not
write EnterpriseAuditEvent. General personal-credential auditing remains open.

The API's key-by-hash lookup now reads its authoritative write database. A read
replica retaining an old key is not a valid reason to accept it after rotation.
Other bearer user/membership repositories and resource guards are not changed;
this is not a proof of complete cross-replica or IdP-driven revocation.

This operation does not promise replay of a lost plaintext response. Once the
old key is consumed, another request using it fails. A failed delivery after a
successful commit requires recovery via an authenticated management path; the
server does not store or reproduce the new secret. No new API idempotency scheme
or secret-recovery endpoint was introduced.

## Verification actually executed

| Check | Result | Scope |
| --- | --- | --- |
| Production-source tests | 72 passed; 0 failed/skipped | Actual shared policy/adapter, crypto, lifecycle, web create handler, API service and key repository with explicit framework/transaction/database doubles |
| Permission-check bypass in memory | 8 failed; expected nonzero | Tests detect bypassed membership/parent authority |
| Audit-write bypass in memory | 7 failed; expected nonzero | Tests detect absent audit and loss of fail-closed audit behavior |
| Old-key consumption bypass in memory | 6 failed; expected nonzero | Tests detect duplicate live keys and failed rotation semantics |
| Strict ES5 TypeScript | Exit 0 | ApiKeyInput and the dependency-free shared PermissionPolicy only |
| Syntax parsing | 11 staged code files passed | Eight changed/new code files plus three unchanged source dependencies used by tests |
| Existing test-command integration | Passed | New test included once in the existing enterprise command |

The test harness executes production functions and native Node crypto; it does
not use a live Prisma client, PostgreSQL server, Nest server, browser or real IdP.
It explicitly models transactional rollback and serializes fixture operations.
That proves the code uses the expected contract, not that PostgreSQL's concurrency
behavior or the generated query types have been accepted. One initial mutation
of just the owner check remained denied by the independent membership/delete
checks; no claim is made that every individual redundant check must fail a test.

The sandbox used Node 22.16.0 and TypeScript 5.8.3. Pinned dependencies are unchanged.
Network installation and native Prisma/Nest/Biome were unavailable. No full native
application type check, prior complete suite, API/platform build, image scan or
production-quality formatter pass is asserted. Earlier build receipts do not
cover these application bytes.

Reproduction from the normal installed candidate:

```sh
node --test --test-reporter=spec tests/community-enterprise/api-key-lifecycle.test.cjs
yarn test:community-enterprise
```

The first command was executed here. The second is the existing aggregate lane,
now extended by one regression file, and must be rerun in the assembled candidate.

## Native acceptance and preservation

Before promotion: regenerate from the actual schema, run native web/platform/API
builds and existing controller/E2E tests; prove creation and rotation on real
PostgreSQL, including concurrent refresh versus revocation, owner demotion,
P2034 retries, audit failures and replica lag. Validate API dependency injection,
current key-prefix configuration, the additive audit migration, expiry compatibility
and secret-safe HTTP/log outputs. Root-organization audit must be present before
organization key operations are enabled.

The rest of the legacy list/edit/delete handlers, per-action key scopes, direct
JWT consumers, user-state replica reads, real SCIM/IdP lifecycle, 60-second
revocation, API packaging and preview/migration/release gates remain open.
Source helpers and transport adapters were reused from the exact MIT candidate;
no historical commercially licensed implementation was copied.

Remote execution did not run in this turn. Unpublished container packaging and
its unknown corrected-test/cleanup state remain untouched. Reconcile that work
onto this newer source before rebuilding or scanning any image. No main/prod
push, live key creation, staff account change, secret, registry publication,
customer message, new tracker or rewrite of research issue #79 occurred.
