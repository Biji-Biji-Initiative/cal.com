# Exact prebuilt Cal candidate publication

This is an application-local publication path on the existing **Build Fork Image**
workflow (`.github/workflows/build-fork-image.yml`, ID **256866796**). Its runner
class remains `mereka-k8s-heavy-builders`, timeout 60 minutes, permissions
`contents: read` / `packages: write`. It changes no lane, promoter, runner sizing,
ruleset, credentials or deployment. Manual `mode=prebuilt` cannot run the legacy
Docker build, dependency installation or image/application execution. The pinned
Crane executable is a publication tool, not an application rebuild.

**Source contracts and fixture tests are not a completed publication.** Current
provider readback on 19 October 2026 found zero Cal repository runners and zero
organization runner groups admitting public repositories. The personal source
credential receives HTTP 403 requiring `read:packages` for package metadata;
do not widen it or repurpose a pull credential. Runner eligibility and repository
workflow-token package authorization remain actual external prerequisites.

## Local admission before public staging

The producer must already have the exact final image, completed native container
acceptance and complete image analysis. The helper creates none of that evidence.
Produce a private directory with exactly these six regular files:

| File | Contract |
| --- | --- |
| `publication.json` | Version 1, canonical repository, full source SHA, public origin, producer actor, UTC production time and five asset descriptors |
| `image.oci.tar` | Uncompressed OCI archive containing exactly one linux/amd64 image manifest and its referenced config/layer blobs |
| `enterprise-build.json` | Unmodified version-1 completion manifest from `prepare-enterprise-runtime.cjs` |
| `container.json` | Exact-source/manifest/config/build/origin native migration, replay, non-root/read-only web, callback and anonymous-session acceptance |
| `scan.json` | Exact-image scanner identity and complete value-free installed-package/finding projection, including private original-report SHA256 |
| `high-ledger.json` | One unwaived disposition per HIGH occurrence; no implicit security approval |

`publication.json` has exactly `schemaVersion`, `repository`, `sourceSha`,
`producerActor`, `producedAt`, `publicOrigin`, `artifacts`. Repository is
`Biji-Biji-Initiative/cal.com`; origin is `https://cal.mereka.dev`. `artifacts`
has exactly `archive`, `build`, `container`, `scan`, `ledger`; each value has
numeric `assetId`, SHA256 hex `sha256`, and exact integer `bytes`. IDs must be
distinct and later match the selected same-repository release assets. GitHub
provides no API to reserve asset IDs. Preliminary private local admission may
use clearly identified provisional transport IDs, distinct from real GitHub IDs;
all source/image/native execution and scan evidence must already be real. The
helper never creates a release or uploads an asset. Final admission uses returned
real asset IDs; downloading requires the finished published prerelease.

```sh
python3 -B scripts/publish-enterprise-prebuilt.py admit \
  --directory /absolute/private/candidate \
  --source-sha FULL_APPLICATION_COMMIT \
  --actor GITHUB_PRODUCER_LOGIN \
  --receipt-sha256 INDEPENDENTLY_CHECKED_RECEIPT_SHA256
```

Inputs are strict data, never shell fragments. JSON rejects duplicate keys and
non-finite numbers; integer IDs cannot be booleans. Archive size is at most
2 GiB, JSON at most 32 MiB (publication receipt 64 KiB). Outer archive paths are
restricted to OCI metadata and SHA256 blob files; links, special files,
duplicates, unrelated payloads and unsupported media/platform types fail.
All config/layer/manifest byte hashes and descriptor sizes must match.
Only the selected index image descriptor may carry the exact
`org.opencontainers.image.created` annotation, containing a valid UTC timestamp
with `Z` and at most nine fractional digits. Other annotations, including mutable
reference names, and annotations on config/layer descriptors fail. Admission
preserves the original archive, manifest and config bytes and their digests.
The real d8 archive remains refused for incomplete package metadata. Named
vendored package versions are never inferred from a parent package.

The helper streams layers without extracting or executing them. Total expanded
bytes are bounded to 8 GiB, each layer to 500,000 members, and layer reading to
180 seconds. Both gzip/uncompressed layer types must match their actual rootfs
diff digests. Whiteouts and opaque-directory markers remove lower-layer entries
before current-layer replacements; repeated paths/ambiguous ancestors fail.
Final embedded build manifest, build ID, build-manifest bytes, migration preflight
and entrypoint must match the source-bound build. Recipe hashes are read with
`git show APPLICATION_SHA:path`; publisher checkout SHA is a separate identity.
Archive/proof checksums are rechecked after admission to detect input changes.

## Native and security evidence

`container.json` has exactly `schemaVersion`, `sourceSha`, `publicOrigin`,
`buildId`, `manifestDigest`, `configDigest`, `completedAt`, `exitCode`,
`nativeReceiptSha256`, `checks`, `expectedMigrations`, `appliedMigrations`.
`exitCode` is integer zero, applied migrations equal a positive expected count,
and `checks` contains exactly five true booleans: `migration`, `migrationReplay`,
`nonRootReadOnlyWeb`, `nativePublicCallback`, `anonymousSession`.

`scan.json` has exactly `schemaVersion`, `sourceSha`, `manifestDigest`,
`configDigest`, `completedAt`, `exitCode`, `scanner`, `rawReportSha256`,
`secretScope`, `report`, `releaseApproved`. `scanner` records `version`,
`binarySha256`, `databaseSha256`, `ignoredFindings: 0`, empty `skipFiles` and
`skipDirs`, and `ignoreUnfixed: false`. `secretScope` records completed zero-result
analysis (`findings: 0`, `exitCode: 0`) and true `filesystem`, `allLayers`,
`configAndHistory` coverage. Never copy secret matches into public evidence.
Trivy's normal image scan alone must not be labeled all-layer/config/history
coverage. Trivy 0.76.0 offers image-config secret analysis, while `--removed-pkgs`
is Alpine-only and does not establish Debian all-layer secret analysis. Retain
additional actual completed layer/config/history evidence before setting those
scope assertions. Keep scanner concurrency at most four.

`scanner.databaseMetadata` has exactly `raw` (the original UTF-8 metadata.json
bytes represented as a JSON string) and their `sha256`. Its parsed keys are
`Version: 2`, `UpdatedAt`, `NextUpdate`, `DownloadedAt`. Keep raw nanosecond
precision unchanged; timestamp comparisons explicitly floor to microseconds.
The database must be unexpired now and at scan completion, with a positive
update interval at most 48 hours, download within 24 hours and coherent
update/download/scan order (five-minute clock skew allowed). A fresh scan
timestamp cannot make an expired database fresh. Retain actual before/after DB
hash proof and private originals; metadata assertions alone do not prove the
scanner used those bytes. Do not reuse the 16 October database evidence.

`report` is a value-free projection of the completed image scan, retaining
`SchemaVersion: 2`, `ArtifactType: container_image`, `Metadata` (`ImageID` equals
the image config digest and `OS` has Debian `Family`/`Name`), and `Results`.
Every result has exactly `Target`, `Class`, `Type`, `Packages`, `Vulnerabilities`,
`Secrets`. Retain every package occurrence as `ID`, `Name`, `Version`, `PkgPath`;
every vulnerability as `VulnerabilityID`, `PkgName`, `InstalledVersion`, `Severity`.
Secrets must be an empty list. OS analysis is one Debian `os-pkgs` result;
Node analysis uses `lang-pkgs` / `node-pkg`. Unsupported analyses fail rather
than silently disappearing from an admission result.

Coverage is checked against the final image, not a five-package whitelist.
Installed OS Name/Version occurrences must exactly match final dpkg status.
Every physical `package.json` under any `node_modules` nesting with a name/version
must have exactly one matching scan path/name/version occurrence; no extra scan
occurrences are accepted. Name/version ambiguity fails; exact type-only module
markers are not installed package identities. The five historic Next/Axios/Effect/
Prisma paths are additional sentinels. First-party files outside `node_modules`
are outside this dependency inventory. An alias equal to or above any physical
package JSON, runtime identity file or dpkg status fails. Remaining symlink
directories under `node_modules` resolve only inside the final virtual image,
following each component, link and `..` in filesystem order, with a 40-link
bound. Their target must contain an already inventoried regular `package.json`
with its own complete name/version; aliases add no package occurrences.
Hardlinks, file aliases, missing targets, cycles, escapes and traversal through
non-directories fail. Whiteouts and replacements apply before resolution; no
host filesystem path is followed. This supports internal Next directory aliases
without claiming that every existing image is admitted.

Production time and native/scan completion times must be within 24 hours (up to
five minutes future clock skew). Zero CRITICAL and zero detected secrets are
mandatory. The HIGH ledger has exactly `schemaVersion`, `sourceSha`,
`manifestDigest`, `releaseApproved: false`, `entries`. Each entry has `target`,
`package`, `version`, `advisory`, `disposition: unwaived`; the exact multiset must
equal all HIGH scan occurrences. `scan.releaseApproved` must also be false.

These are hash-pinned **producer-supplied assertions and scan projections**.
Admission verifies their structure, exact image binding, freshness and occurrence
coverage; it does not independently attest that the producer executed the native
tests/scanner or truthfully copied all findings. Keep the private originals and
review their hashes/provenance before accepting the dispatch receipt hash.
No fixture receipt, historical scan or self-written success boolean substitutes
for that actual execution evidence. The e3a79afb receipt's **56 HIGH occurrences
remain unwaived**; this path cannot manufacture `releaseApproved: true`, close
security remediation or authorize deployment.

## Later authorized staging and publication

Perform external staging only after it is separately authorized:

1. Complete and review private native/scan evidence and preliminary local
   admission. Provisional transport IDs never substitute for execution evidence.
2. Create an authorized **draft** prerelease in this repository, tag
   `cal-candidate-FULL_APPLICATION_SHA`, exact `target_commitish` equal to that
   SHA. Upload the archive and four proof files to the draft so they remain
   private; use GitHub's returned real asset IDs to finalize `publication.json`.
3. Run final local admission and independently review the final receipt hash.
   Upload that exact final receipt as the sixth draft asset and retain its
   returned asset ID. Do not change the admitted bytes afterward.
4. Only when the executor/package prerequisites and publication authorization
   are satisfied, publish the prerelease and dispatch the existing workflow.

The prerelease author must match the producer/manual dispatch actor. Supply its
numeric release ID, final `publication.json` asset ID and independently checked
receipt SHA with `mode=prebuilt` and `source_sha`; leave `tag_override` empty.
Downloading uses canonical GitHub API asset IDs, strict size bounds and bounded
HTTPS redirects to GitHub asset hosts; authorization headers are stripped on
asset-host redirects. No arbitrary URL or repository is accepted. These steps
are a later procedure; writing this helper and running its source tests performs
none of these external actions.

The helper derives only
`ghcr.io/biji-biji-initiative/cal.com:candidate-FULL_SOURCE_SHA-FULL_MANIFEST_HEX`.
Legacy overrides cannot use the reserved `candidate-` prefix. Prebuilt runs are
serialized across refs without cancellation, use the existing repository token
via password stdin and a private temporary registry-auth directory, and refuse
conflicting existing tags. Authentication/transport errors are not absence;
only explicit `MANIFEST_UNKNOWN` permits the push. An identical existing tag is
idempotent and is still read back. No ordinary, `latest`, cache or deployment tag
is written by prebuilt mode.

Crane v0.22.1 uses the checksum already reviewed by the infrastructure mirror,
but this application path never invokes or widens that mirror's upstream-only
policy. Its [push](https://github.com/google/go-containerregistry/blob/v0.22.1/cmd/crane/cmd/push.go),
[manifest](https://github.com/google/go-containerregistry/blob/v0.22.1/cmd/crane/cmd/manifest.go)
and [blob](https://github.com/google/go-containerregistry/blob/v0.22.1/cmd/crane/cmd/blob.go)
commands support this direct OCI layout and raw-byte readback. Publication checks
the remote tag digest, hashes the raw manifest and raw config bytes, and compares
the config with the admitted image. Consumers must pin the resulting digest.
Refusal to replace a tag is this publisher's contract, not a registry-wide
immutability setting; external writers/registry policy remain separate.

The sanitized result records source/producer, publisher revision/actor/run ID,
manifest/config digests, counts, candidate reference and `releaseApproved: false`.
It is written to the job summary only. Private authentication is removed on normal
exit; job artifacts/tools are cleaned in an always step. An interrupted or failed
push is not publication success and is not automatically deleted or relabeled.
No public artifact upload, workflow dispatch, registry push or deployment is
performed by source tests.

## Validation boundary

The registered `runtime-package.test.cjs` executes real local source reads,
archive/layer/inventory/receipt parsing and hash checks. Synthetic image/native/
scanner evidence and registry/GitHub transports are explicit doubles; no test
claims native image execution or real GHCR acceptance. Focused controls cover
gzip corruption/bounds, whiteouts/replacements, omitted nested copies, every
evidence gate, hostile metadata, conflicts and raw-byte readback differences.
Run the focused Node test with at most four workers, actionlint with the existing
custom runner label declared in task scratch, Python syntax checks, Biome, UBS
and Gitleaks. Full build/E2E and new tool/dependency installation are separate.

The focused command `node --test --test-concurrency=4 --test-reporter=tap
tests/community-enterprise/runtime-package.test.cjs` passes **157/157**. The
registered `test:community-enterprise` source gate passes **1073/1073**, including
creation-annotation rejection, alias resolution, whiteout/replacement, duplicate
coverage, database freshness and application-versus-publisher revision controls.
Python syntax, Node syntax, Biome, Gitleaks and diff checks pass. The unchanged
workflow previously passed actionlint with its custom runner label declared in
task scratch. Focused UBS remains **exit 1: 3 critical, 42 warning, 175 information
findings**, with no suppressions. The three critical matches are unchanged test
fixtures: one public dummy secret and two rules on the trusted source-fixture
loader. Warnings cover exact JSON type/boolean gates (including rejection of
integer booleans) and JSON parsing whose failure propagates to a failed CLI/test.
Historical public checksum-comparison findings remain public-data comparisons,
not credential authentication. This is source triage, not a clean scanner result
or release approval. Exact commands, file/line/rule catalog and source hashes are
retained in `alias-fix-verification.json`, `alias-security-verification.json` and
`ubs-triage.json` in the private task review directory. Actual image admission
still refuses ambiguous installed-package metadata; these source tests do not
supply missing vendored versions or establish native/security acceptance.
