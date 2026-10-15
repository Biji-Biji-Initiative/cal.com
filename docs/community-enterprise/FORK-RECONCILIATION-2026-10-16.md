# Historical fork reconciliation and retained contracts

Date: 16 October 2026 (Pacific/Guadalcanal). Scope: CAL-01.REUSE, the source-level
reconciliation task in the existing repository and enterprise branch. This is
not full historical product parity, legal clearance of all dependencies, or a
production migration. The private research packet is not imported.

## Establish the right baseline before recreating anything

The old BBI fork is `e01d0d5f8cfec4dd910c2aae486b4857f6b8a256`. Comparing it with
the March v6.2.0 tag produces 658 changed, added or removed paths. That is not the
BBI customization inventory: it includes upstream development between the tag
and the fork's later upstream merge.

The actual upstream merge is `296c209389cdea45be319fd91358b5b0c90893b6`. Its second
parent is `facc0745d3c4bc77f97f56a5458dbe06f2f5f173`, the old public upstream
snapshot. Comparing that parent with the old BBI fork isolates **59 custom paths**.
The remaining **599 paths** in the tag comparison are not additional BBI changes.
This distinction prevents agents from recreating upstream work under the false
impression that it was a lost downstream feature.

The complete tree responses, immutable commit/tree IDs, response hashes, merge
parents, current upstream/fork references and license snapshots are recorded in
[FORK-REUSE-PROOF-2026-10-16.json](FORK-REUSE-PROOF-2026-10-16.json). GitHub tree
responses were checked for truncation. The comparison includes executable mode
changes, not only content hashes. A submodule cannot silently count as fully
inspected source.

The [59-row decision ledger](FORK-REUSE-DECISIONS-2026-10-16.json) binds every path
to its exact before/after blob and mode, current candidate blob where present,
reason, disposition and existing implementation task. No row is silently omitted.

| Disposition | Paths | Meaning |
| --- | ---: | --- |
| Retained | 11 | Historical documentation remains accessible at the original immutable commit in this same repository. It is evidence, not a current deployment recipe. |
| Replaced | 13 | Existing modern contracts replace old script/configuration behavior, or a focused compatibility repair restores the useful behavior. Runtime successors still require their own acceptance. |
| Obsolete | 7 | Old Cloud Build/Cloud Run or removed distribution/automatic-sync/license-unlock targets are not imported as the new platform's release mechanism. Historical files and the current legacy deployment are not deleted. |
| Unresolved | 28 | Twenty-seven CI/policy paths require current publisher/runner admission; the historical brand image requires explicit asset and packaging admission. Their follow-up task IDs remain recorded. |

An unresolved row is a completed classification, not completed implementation.
The original CAL-01.REUSE acceptance explicitly permits that disposition. The
preview, interface and upstream-update tasks retain the unresolved obligations;
this inventory does not certify that all 59 old files should be copied back.

## Useful behavior restored, without restoring old application bodies

The historical fork's application-code delta consists of three configurable
logo constants plus its image asset. Most other custom paths are delivery,
configuration, documentation or workflow changes. Current Cal.diy already retains
the broader scheduling architecture; it should not be reconstructed simply
because the historical comparison was made against the wrong tag.

Source `815e7fd739c71a0de4e2fe30c21845c05f69dbd8` restores the three established
build-time options over the current MIT constants: `NEXT_PUBLIC_APP_LOGO`,
`NEXT_PUBLIC_APP_LOGO_DARK`, and `NEXT_PUBLIC_APP_LOGO_ICON`. Empty/unset options
retain the bundled upstream assets. Each option works independently. The public
example now documents them without configuring a nonexistent image.

The old `apps/web/public/mereka-logo.png` is **not** bundled by that change.
Its original blob is retained in the ledger. Confirm the admitted owner asset and
package it before using that path; a configurable URL is not proof that the image
exists, is the desired current brand, or has appropriate reuse rights.

The same source restores six specific ignore patterns for historical local
credential/configuration/log filenames. Git's actual ignore engine verifies that
real files are ignored and their examples remain visible. We do not blindly
restore old ignored templates, architecture documentation, or tracker state.

Scanning exposed a fixed reusable cron credential in the inherited public
example. That example is now blank and asks operators to generate a unique value.
No real environment or live credential was read, changed or rotated. Existing
cron runtime authentication remains the separate admitted deployment contract.

The regression executes the actual three source initializers selected by the
TypeScript AST, rather than duplicating branding logic. Replacing the source
input in memory with the predecessor makes all four override assertions fail;
the restored source passes. This is source behavior, not a newly built browser
bundle or complete live branding acceptance.

## Preservation and licensing boundaries

Current source still uses the retained Cal models and source-of-truth services;
this work adds no tenant database, schema, identity provider or booking engine.
Existing hostnames, database identities, session/encryption secrets and provider
credentials are unchanged. Their actual migration/restore and deployed behavior
remain CAL-08.BASELINE, CAL-08.MIGRATE and CAL-02.PREVIEW obligations.

The old root and commercial EE license snapshots are distinct from the pinned
Cal.diy root and API platform MIT licenses. Their exact hashes are in the proof.
This source inventory is not permission to copy any unidentified old EE or AGPL
module into private product code. No old commercial module body, historical
credential example or privately held strategy was imported. General contract
compatibility was implemented on current MIT source. Existing notices remain.

The comparison against current upstream `54343aa685ae8f33159d2f485ec4a57bad5c574a`
and the repaired candidate `815e7fd7` finds **7,596 byte/mode-identical files,
106 modified files, 166 added files, and zero removed upstream files**. That is a
patch-surface measurement including tests/docs, not a feature-completion ratio
or blanket provenance review of every dependency. Later source/documentation
commits must retain their own identity rather than reusing these counts as if
unchanged.

## Preserve the existing delivery integration, not obsolete launch instructions

Current main `7a6ce165fa4c0054acaeca1a6c3d6d6b3ce787a2` differs from the old BBI
baseline in three workflow files. Those newer runner-policy corrections must be
considered when admitting the enterprise branch; replaying April runner labels
would discard newer work.

The existing `Build Fork Image` workflow is active and declares job-level
`packages: write` for its GitHub Actions token. Therefore, the observed personal
credential's missing package scope does **not** mean GitHub has no possible
publication route. It means the currently used personal publication route lacks
that capability. The existing programme owner should admit a correct publisher.

Do not blindly dispatch the inherited workflow: it uses the old root Dockerfile,
placeholder public origins, a mutable cache/tag policy and an old builder label.
The current enterprise Dockerfile expects a separately prepared native runtime
context. Its source-bound receipt, origin, complete native build, security review
and final registry digest must agree. No workflow was changed or dispatched by
this reconciliation. The existing publisher request remains with the CI/CD
programme owner, rather than introducing another registry, repository or token
bridge to bypass that decision.

The original fork's active deployment and domains remain untouched. Source
reconciliation is not a license to retire its database, redirect DNS or force
an unqualified enterprise artifact into production.

## Reproduction and negative controls

Save fresh complete tree responses into a task-owned scratch directory, using
the exact repository/commit URLs in the proof (no shell credential values):

```sh
gh api 'repos/calcom/cal.diy/git/trees/facc0745d3c4bc77f97f56a5458dbe06f2f5f173?recursive=1' > old-upstream.json
gh api 'repos/Biji-Biji-Initiative/cal.com/git/trees/e01d0d5f8cfec4dd910c2aae486b4857f6b8a256?recursive=1' > old-fork.json
node scripts/inventory-enterprise-fork.cjs old-upstream.json old-fork.json docs/community-enterprise/FORK-REUSE-DECISIONS-2026-10-16.json
node --test --test-reporter=spec tests/community-enterprise/fork-reuse.test.cjs
yarn test:community-enterprise
```

The helper reads only the supplied tree responses and decision file. It refuses
truncation, duplicate/escaping paths, silently uninspected submodules, missing or
invented dispositions and changed source identities. Tests include additions,
deletions, mode changes and omission/tampering controls. All disposition task IDs
were separately checked against the current canonical 39-node graph.

Strict typing of the actual constants passed using existing repository ambient
declarations. Biome passed for the changed source/test/helper at error level.
Full native Next/API rebuilding remains an integration obligation, not inferred
from a constants import-closure check. The source-contract suite was run, with
its measured count and exact final publication recorded in issue #78.

Security scan limitations are retained: after removing the shared cron example,
one full-file Gitleaks flag remains across two adjacent blank E2E variable
assignments, not credential contents. The constants-file UBS report has two
heuristic critical findings on the public credential-sync **header name**, two
warnings on unchanged JSON parsing of operator configuration, and 99 information
items. These are inspected and unsuppressed; no whole-file clean scan or complete
security approval is claimed. Narrow newly authored inventory source and its
tests are scanned separately.

## Acceptance and next actions

CAL-01.REUSE may close at its original **source_proven** scope: every actual old
fork customization is classified with immutable provenance; useful compatibility
and credential-file protections are restored; infrastructure/data/identity
ownership remains untouched. The classification does not close CAL-02.PREVIEW,
CAL-05.UI, CAL-08.BASELINE, CAL-08.MIGRATE, CAL-08.UPDATE or production acceptance.
In particular, upstream update rehearsal still needs an actual reviewed incoming
change and its contract tests; merely being on the current upstream SHA is not a
successful rehearsal.

Finish the active role lane, select a clean exact source for one coordinated
native build, admit its publisher, and prove the shared preview against actual
identities and provider journeys. Do not replace those delivery steps with more
source-only claims or a second copy of the application.

Agent: ChatGPT-CalExecution-20261016

## Final source checkpoint

The complete registered `yarn test:community-enterprise` command passed **566
cases with zero failures, cancellations or skips**, including the 15 fork-reuse
contracts and 23 graph cases. These retain their individual source/loopback/fixture
scopes; the total is not 566 deployed production journeys. The exact 59-row
inventory/disposition command also passed with all target task IDs present.

Gitleaks passed over the five newly authored inventory/test/decision/proof/report
files. UBS completed on the inventory helper with zero critical findings, two
unsuppressed warnings for synchronous local-file reads in a one-shot CLI, and
four information findings. This does not override the separately described
inherited constants/example scan results. No application server uses this helper.

The tested source/config restoration is `815e7fd7`. Final graph/inventory/report
publication is a later documentation/tooling commit, read back from GitHub and
recorded in issue #78. Preserve one clean source selection for the next build;
do not label an old browser bundle or container with that newer source hash.
