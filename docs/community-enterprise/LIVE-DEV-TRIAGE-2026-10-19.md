# Cal dev observations, 19 October 2026

This is a dated continuation of the existing enterprise programme, not release
acceptance. Production was not changed by this work. The live dev application
still serves stock Cal 6.2.0 with the Authentik bridge; the qualified local
application image from `0aaaa24ab167a3f3a58b4ea940b176cac62ee6f6` is not deployed.

## Public authentication paths

Infrastructure change `715ee6b59601f1e5cbd6207ca7ea841b4ebd8a6a` lets the five
exact native lifecycle paths reach Cal on both `cal.mereka.dev` and
`calendar.mereka.dev`: `/auth/login`, `/auth/logout`, `/api/auth/csrf`,
`/api/auth/session` and `/api/auth/signout`. These paths discard incoming
`x-authentik-*` identity headers before identity resolution or session issuance.
Other application routes retain authentication. Staging and production were
not enabled by this change.

The owner's subsequent `81c5a48c574a66add120755683c0dda0debbdc24` source includes
the global logout handoff. At 11:13Z the ready dev pod's actual proxy file had
SHA256 `5e93b3b0ec6511308cabedbc66aea97155e3be8b3c761a56ddd56ec82a2bbf07`.
The 11:14Z two-host HTTP receipt passed method restrictions, hostile identity
header checks, anonymous session `{}`, native CSRF and invalid-CSRF refusal.
It did not exercise an existing staff session.

Dev SSO dependencies subsequently became unavailable. Read-only observations
showed recovery in sequence: database primary 11:34:21Z, both poolers 11:34:24Z,
Authentik server 11:34:49Z and Cal outpost 11:35:22Z. Both protected Cal entries
again returned authorization redirects at 11:37:41Z. Replica readiness and
Argo's degraded state were separate unresolved observations; no Cal-team
database, node, pod or recovery mutation caused this recovery.

## Browser observation and corrections

One ordinary anonymous browser run reached the fully styled real Mereka
identification screen on both hosts. Native CSRF/signout/session responses were
200, followed by the real outpost and IdP redirects. Screenshots show passkey
and Google sign-in options, with email/password collapsed. The automated
receipt remains **failed**: its observer incorrectly required an expanded
email input, one blocked request per host was not classified, and it could not
retrieve the original session response body after navigation. Body retrieval
failure does not show a nonempty session. Earlier held-navigation failures
remain preserved too. All owned browser workloads and their slots were cleaned
up; this is not authenticated logout acceptance.

A stock-source conditional return-to-logout hazard was investigated rather
than assumed live. The 12:06:57Z canonical header-only check found a return to
the bare canonical app origin, with no query or fragment. Normalizing its empty
URL path gives `/`, not `sign_out`. The earlier classifier's `other` result
omitted this normalization. No live return-to-logout defect is established by
these observations. Existing-staff cookie expiry, logout without refresh and
subsequent sign-in remain required owner proof.

## Separate application and release boundaries

Google Calendar's 10:54:48Z provider-only check still returned
`redirect_uri_mismatch` for
`https://cal.mereka.dev/api/integrations/googlecalendar/callback`.
The app stays disabled until the configured Google client accepts that exact
callback. Google sign-in at the IdP is a different integration.

Application source `31c2d0bfc3ea2255820fb0e8da58bb99cc91b4b5` fixes the legacy
session-refresh branch that let stale cookie identity fields override freshly
saved profile data. Refresh now identifies the account by the signed immutable
user ID, rejects missing or locked accounts, and ignores client-supplied identity
changes. Both server refresh layers preserve existing administrator restrictions;
new administrator privileges require fresh sign-in. Initial sign-in and the
native Authentik branch retain their behavior.

The actual callback/server/tRPC middleware regression suite passed 97 cases with
`node --test --test-concurrency=1 tests/community-enterprise/authentik.test.cjs`.
The existing credentials/Azure sign-in suite passed 37 cases; strict TypeScript
checked the 2,265-file import closure of all three production files. Biome,
Gitleaks and diff checks passed. UBS remains unsuppressed with 19 critical and
five warning findings; reviewed dispositions include test-loader/fixture and
public-role comparison findings, plus an inherited uncancelled Azure fetch that
remains open. Repository/database edges in the regression suite are named
doubles. These checks do not establish the cause of the live onboarding loop,
and the correction is not deployed.

Application code permits legacy bridge sessions when `CAL_AUTHENTIK_ONLY` is
unset or false. The packaged `0aaaa` image nevertheless requires complete
native-only configuration at its entrypoint. It cannot start unchanged in
bridge mode. Neither entrypoint checks nor identity rules were weakened.

At 12:13Z, read-only GitHub checks still found zero Cal repository runners and
no public-admitting group among 27 organization runner groups. The personal
credential lacks package scopes. The deployment owner must supply the admitted
publisher route. No artifact upload, registry push or new app deployment ran.
At the 13:06Z record, the Trigger upgrade was held pending a separately
requested security-remediation decision; introduced findings were not waived.
The 14:00Z continuation below records the resolved source correction.

## Recovery qualification

Published infrastructure preflight source `0d9c2c1eb919f4b2a9f9ee244fdc55dfa25b0c97`
was checked with actual Velero 1.18.3 native policy and modifier code. Nineteen
semantic leaf cases passed: corrected fields were accepted, old schema fields
rejected, hostile PVC source bindings removed, and scoped Pod/Argo changes
applied correctly. Network access was disabled during compilation and test;
owned units were removed and the actual slot released at 11:53:12Z.
This proves native decoding and modifier behavior, not controller discovery,
archived Pod dependencies, provider payload usability, a data restore or
CAL-08 migration acceptance.

The single 12:41Z archive-metadata acquisition attempt refused at its live
identity guard because the current database Pod UID had changed since review.
It stopped before creating a DownloadRequest or downloading any archive.
The historical backup Pod identity was not replaced with the current Pod's
identity. The verified worker exited after exact owned-file cleanup; its
mechanical exit code does not turn the refusal into metadata acceptance.
Fresh identity selection requires a new reviewed plan before any second
acquisition. No restore or database mutation occurred.

## Retained receipts

The private operator receipts retain commands and raw failures. Their complete
SHA256 identities are:

| Observation | Receipt SHA256 |
| --- | --- |
| Two-host lifecycle HTTP checks | `bb20b0916b544b5e6c4fc336afe70e8efab29d157e3657ebdd1380e8a9c021f5` |
| SSO transport recovery | `376e8897416eb1582eba7d2a5cd17e202a0b5d33c18903da51f249188c7b63b7` |
| Ordinary browser, failed | `4fb8e667166a03c5f1a20566853a1f2c83fbfddecdde4b351812e21c6ed4185e` |
| Browser observation correction | `10281b98fc4f24d8f38fcb89e867916f5d50e785b3a82eafbadad48bcb6cad68` |
| Canonical normalized return target | `b0220feae921e13c880ae1859364ac50cc1eeb63438f37b852134f6b9cdba5af` |
| Google callback rejection | `e26eba39b731d73779437de44d914009c3abf09a3f625da203c80605295a2703` |
| Publisher admission refresh | `5aa0554b08293236b426ab1efaaa16a85475e769ed69f1abd2e24da407cee9d6` |
| Native Velero completion | `1e67572c70919753c4e698258dac9ce4c97edb155e5953ca5a0e80a661fa4eab` |
| Legacy session four-path review | `fafa5d7211fbb1ef952ad544509c34325852536bb4090bd95402292f8b1ef130` |
| Archive metadata identity refusal | `45024a5f533a24f9f88830302b65d2a3ce7218dc84dadb70fec31ff87273c1b4` |

These observations close no additional programme task. Keep source, isolated
qualification, live anonymous behavior and authenticated release acceptance
separate when continuing this work.

## Continuation at 14:00Z

The earlier Trigger hold was resolved under the standing authorization for
ordinary reversible work; no new user answer was received or inferred.
Source `06729e80b55563444183fc71b9b1a0997a8259a6` publishes Trigger SDK/CLI
4.7.4 and the existing systeminformation resolution at 5.33.15. All five
remote blobs and personal authorship were verified. Twenty-five native SDK
controls, the strict 5,828-file import closure and immutable skip-build install
passed. The frozen offline lock audit fell from 301 to 286 advisory occurrences
with none introduced. UBS remains unsuppressed at three critical, three warning
and three information findings, with retained negative-fixture/test-read
dispositions. Earlier full-postinstall failures remain unproved. This source
and the session correction above are absent from the previously built image.

The exact local `0aaaa` image has now completed two distinct security checks.
Its raw Trivy diagnostic reports 52 HIGH occurrences: 43 OS and nine Node
dependency findings, with zero reported critical or secrets in that diagnostic.
The separate whole-layer detector reports **108 unwaived matches** across all
26 complete native reports. These are detector matches, not 108 confirmed
credentials; none has been declared harmless or waived. The whole-layer stage
completed with findings and blocks release. Both scanner workloads terminated,
all owned resources were removed, and the actual slots were released.
The older image cannot qualify later dependency or authentication source.

The second metadata-only acquisition used a freshly reviewed identity/backup
storage binding. Its one DownloadRequest and provider GET acquired 247,967
compressed bytes, but the strict projection refused `pod-api-default`.
An offline diagnostic of that already acquired archive found a nonzero integer
Pod priority where the source projection expected no field. This is not an
accepted API default. The original refusal and worker remain unchanged.
Exact owned cleanup disposed of the raw archive and private transfer material;
the actual owner process is absent and no raw custody remains. No further
download, filesystem backup payload, restore or database mutation followed.

Infrastructure `6d90846d49f2a55a171722c8e89f2e34ee7f7e13` now explicitly resets
both Pod scheduling fields, `priority` and `priorityClassName`, in the isolated
dev restore modifier. It retains the exact historical namespace/Pod scope.
The maintained wrapper suite passed, and actual Velero 1.18.3 modifier code
passed 26 semantic controls (32 Go test results), including absent/present
fields and hostile/out-of-scope cases. All three remote source blobs and
personal authorship were verified. This is modifier qualification using
synthetic input, not acceptance of the refused archive or a data restore.

Google callback acceptance, the admitted image publisher and the native-only
entrypoint versus existing bridge deployment contract still require their
existing owners. Requests were routed to those owners; no credential was
requested from the user. The live staff login/onboarding/logout journey and
Google Calendar connection remain unproved. No additional task is closed.

| Continuation evidence | Receipt SHA256 |
| --- | --- |
| SDK five-blob/personal-author readback | `f16f0d59116f035a50d7327c1006afd8ffbd886704cfb375b583b11763bd1194` |
| Current-image raw diagnostic | `2c795a2c45478d5c6dfb54ceb135f5a9ac8a40d747feb21e3fe0bc1f6722c36a` |
| Current-image whole-layer findings | `1e2410a9d4c9081dead639ce3254ec35fc97af702d2dd8858fdf98f35a39c786` |
| Second metadata refusal | `c0837e371473cb5c9813bf45d1a73feb9c372dbe678c600fc2f7545d73dde476` |
| Second metadata cleanup readback | `257c9ad356c13590534271b0b8506500d42c6ed47019691b07e13229d17eb7a6` |
| Native scheduling modifier controls | `ee7f4ba7d0bdb5c615f61825e3be1521c20b6316c12bbc2f99006b249455b26d` |
| Scheduling reset remote source readback | `f5d12f81db806e734752606f286802fee9d564794a80068d56002679d23a48b0` |

## 15:12Z continuation: source corrections published; live acceptance remains open

The application programme now includes the published Deepmerge correction
`bc03b396be3f2e1fbed4e23291669887acdc4523` and Nanoid correction
`a5fe6bfd3f68f5b8614798d4a2310455275eb886`. Root independently read the complete
diffs, actual focused command/results, retained failures and personal GitHub
commit/blob readbacks. These commits are source changes; the serving dev image
and the previously scanned `0aaaa` artifact do not contain them.

Deepmerge is overridden only for `@prisma/config` to 8.0.2. Seven regressions,
strict real caller/dependency declarations and actual Prisma CLI schema
validation pass. Its frozen native source-lock audit removes one HIGH finding
(286 to 285), with none introduced. Nanoid is overridden only for the actual
ToDesktop util and Trigger core parents to 3.3.20, preserving their upstream
metadata and every other selector. Six new cases, two established dependency
checks and all 25 existing Trigger controls pass. Its native source-lock audit
removes three HIGH and one MEDIUM finding (285 to 281), with none introduced.
Root separately parsed both native reports and verified their report, lock,
tool and database bindings. The wrapper that incorrectly expected exactly
three removals remains failed; a separate comparison of the retained reports
records the fourth removal without rerunning or modifying either scanner.

The broader ToDesktop declaration check still fails with the same 43 exact
diagnostics before and after the Nanoid change. Those failures are unwaived.
Only the changed Nanoid declarations passed the permanent strict CJS/ESM check;
no all-ToDesktop-types or actual Node 20/browser/desktop acceptance is claimed.
Both changes retain unsuppressed UBS dispositions and the earlier full
postinstall failures. During Deepmerge publication, a missed per-command hook
setting ran an unplanned 35-second generation hook. It completed naturally,
with no tracked generated effect; its output and terminal process evidence
are preserved separately and do not count as qualification. Nanoid publication
used per-command `HUSKY=0`; no generation hook ran.

Source review has accepted the design of a pinned, signed, non-debug Node 22
Debian 13 distroless final base. Native Crane/Cosign metadata verification
passes for the exact index, amd64 manifest and config; no layers were pulled
or image process executed during that metadata review. Focused source work
must retain UID/GID 1000, explicit writable home, the existing application
entrypoint and auth/migration denials. It still needs source checks, an actual
new image, native Prisma/Sharp/application checks and complete security scans.
The old image's 52 HIGH occurrences and 108 whole-layer/config detector
matches remain unwaived. A source audit does not replace image coverage.

Google Calendar remains disabled and unaccepted. The actual provider response
at 10:54Z was `redirect_uri_mismatch` for the exact canonical dev Calendar
callback. Infra commit `87b794e4fab2fd357fa9ca0991bd37a3033666fa` corrects the
registry's dev callback and records that disabled state; it does not change
Google or application credentials. The canonical dev client ID's public
numeric prefix matches the current Mac registry's `bbi-k8` project mapping.
This is a source-corroborated project candidate, not Cloud Console verification
of the actual client or administrator. Owner message 147169 carries the exact
project/client-verification route. No new consent, code exchange or enablement
is claimed.

The backup metadata reader's introduced scheduling-reset comparison passed
59 offline cases, preserving the original generic comparison and historical
identity checks. The native Python UBS module completed, but the aggregate
runner timed out and optional offline analyzers could not start. Its 15
critical, 83 warning and 143 informational results, capped samples and
incomplete analyzer coverage remain explicit and unwaived. A fresh read-only
metadata preparation then refused with an unattributed wrapper error before
creating a plan or downloading an archive. One separately authorized fixed
Backup GET subsequently passed; that does not identify the failed read or
prove a general API recovery. The next preparation completed all ten fixed
metadata reads, but the helper omitted the retained empty `sources` field
before comparing the Argo projection. Its refusal did not establish live Argo
or source drift. That failed preparation and its diagnostic remain preserved.
A helper-only correction passed eight offline identity/refusal controls;
subsequent fresh metadata preparation passed all ten reads, all current and
historical guards, and the exact unchanged Argo binding. The actual published
preflight produced a dry render with the reviewed scheduling reset. Root read
the exact five inputs, four tool hashes, plan and FileVault/private-mode
receipts, then separately authorized one bounded metadata-only archive read.
This authorization does not establish an accepted archive, FSB payload,
Restore, SQL or data recovery. The source is the explicitly reviewed frozen
commit; a local tracking reference is not proof of the latest remote head.

Real staff session expiry/logout without refresh, onboarding completion and
calendar connection remain open. The current packaged artifact requires native
SSO, while dev's maintained deployment uses the existing bridge; owner message
147157 asks for the deployment contract decision. Read-only preparation of an
explicit bridge-compatible artifact contract can proceed without bypassing the
entrypoint, identity/header guards, migration boundary or existing owners.
Package publication authority and both previously recorded credential incidents
also remain open. Delivery receipts show the relevant owner requests persisted,
with no signal or acknowledgment; silence is not approval or containment.

Evidence remains in the private bounded review directories on g/g2:
`/data/tmp/cal-deepmerge-qualification-d3wpnakh`,
`/data/tmp/cal-nanoid-prepare-eSq15i`,
`/data/tmp/cal-distroless-proposal-5PePUI`,
`/data/tmp/cal-google-registry-ZdmTOB` (registry review is also recorded in the
publication receipt), and `/data/tmp/cal-google-project-ybpFXZ`. The backup
work remains under `/data/tmp/cal-dev-metadata-wJgV7E` and its private Mac
review directory. This continuation closes no task and changes no production
acceptance state.


## Bridge-compatible source continuation (2026-10-19)

Application source `e452d8ee92c60b2301be387aaae20624bed11ee3`, parent `e6dc6641c735e930d4b989f80c553b483124d061`, is published. The owner selected one existing forward-auth plus stable-key bridge, while native-only startup stays the default. The explicit bridge startup requires both existing Authentik flags exactly false and all three native provider fields absent. The application exposes no sign-in providers or local account/recovery grants in that case; signed-subject refresh still consults the current database, and NextAuth retains CSRF, session and signout handling. The application change does not revoke replay of an old signed cookie.

The actual focused command in `UPGRADE_LOG.md` passes all 355 cases, including installed NextAuth JWE, valid-CSRF provider denials, session update and signout. Its explicit database/profile seams are controlled doubles, not a live staff or database proof. The strict API import closure remains FAILED/unwaived: exact baseline/current arrays contain the same 108 diagnostics across 1,631 files, with no introduced or resolved diagnostics. The full producer type check and build remain future checks. Biome exits 0 with 24 warnings and 14 infos; Gitleaks exits 0 with no findings; UBS exits 1 with 19 critical, nine warning and 294 informational findings, all retained with source/rule dispositions. The source qualification and its failures are recorded under `/data/tmp/cal-bridge-source-8e5wd8iu`; the five final code hashes were captured before the final comparison and matched again afterward. Requested Nice10 versus observed process priority5 remains explicit.

The exact six published GitHub blob bytes and personal Gurpreet author/Agent trailer were independently checked, and all six file leases and qualification resources were released. This source includes the published distroless recipe; its account setup and literal HOME/PATH source controls pass, and 26 plain packaging fixtures pass, including 19 environment negatives. No distroless layers, rebuilt application image, deployment or release acceptance follows from those source/fixture results. The older image's 52 HIGH vulnerability occurrences and 108 detector matches remain unwaived; the replacement requires fresh complete image scans and semantic review.

Backup archive metadata remains refused at the historical imagePullSecrets difference. The rejected archive was disposed, and independent cleanup proved all 16 custody checks. A separate isolated Pod+ServiceAccount pull-reference reset is being qualified against source-declared empty lists; both Secret identities remain checked, while the restore filter selects only the database Secret. Its 64 offline reader tests and focused actual-CLI render controls pass, but the full source wrapper timed out at 140 seconds and remains unverified. Native Velero parser/modifier qualification is separate; no Restore, FSB payload, recovery SQL or writer-quiescence acceptance has occurred. Anonymous availability of the exact pinned PostgreSQL manifest does not establish a layer pull or runtime.

Serving stock Cal 6.2.0 is still separate from the candidate source. Owner-reported dev/staging browser lifecycle evidence has been requested but is not independently established here. Google Calendar still returns redirect_uri_mismatch for `https://cal.mereka.dev/api/integrations/googlecalendar/callback`; bbi-k8 remains a source-corroborated Console project candidate, without client/admin confirmation or a successful calendar connection. The package publisher/executor, new producer/image qualification, runtime wiring and real staff onboarding/logout/calendar acceptance remain open. No production mutation or task closure is recorded.


## Full web producer continuation (2026-10-19)

The bounded producer for published application source `e452d8ee92c60b2301be387aaae20624bed11ee3` completed all nine steps with exit 0. The actual `yarn workspace @calcom/web type-check:ci` passed in 151.129 seconds, and `next build` passed in 581.494 seconds, including its embedded TypeScript check. Preparation passed in 76.962 seconds. The immutable lock was unchanged, the standalone context is 643,485,403 bytes, and the retained compressed context is 309,821,931 bytes. This full producer pass does not relabel the earlier isolated 108-diagnostic import closure as green.

The actual unit used two CPUs, 24 GiB memory, no swap, 256 tasks, NoNewPrivileges and requested/observed Nice10. Root read the final build, raw Next log, manifest and cleanup receipts. The pinned release worktree, supervisor, launcher and cgroup are absent; the real slot was released. All three Prisma trace warnings remain explicit: the shell helper was not parsed as JavaScript, and dynamic generator resolution was unresolved. The actual packaged migration CLI and replay must still pass. Fixture EMAIL_FROM/organization warnings establish no mail or organization runtime acceptance. Evidence is retained under `/data/tmp/cal-web-bridge-producer-o1kj_02u`; the actual context remains on g2 under `/data/tmp/cal-web-release-20261019-bridge-e452d8ee92c6`.

Five bounded source-control commands also passed: 86 HTTP mock controls, five actual cookie-jar function controls, eleven redirect predicate controls, and synthetic admission/identity negatives. They used explicit doubles and minted no real JWE, loaded no image and started no PostgreSQL. The private fixture, unit, PID and cgroup are absent and the slot was released. Image packaging is still preparation only: the finite-worker observer needs to retain same-PID executable transitions and sample the short Node setup step. No rebuilt OCI image, image security, native runtime, browser or deployment acceptance is recorded.

Infrastructure source `5b339c09c0b93c7625ebb55f324dc791c975e7bb` published the exact three reviewed isolated restore-preflight files. Root independently verified the personal GitHub author and all three full blob bytes. The 64 reader controls and native Velero 1.18.3 modifier/parser proof passed, while the full 140-second wrapper timeout and later UBS helper-checksum refusal remain open. One fresh metadata-only acquisition transferred the same 247,967-byte archive with HTTP 200 but refused `historical-metadata-unqualified`. The offending object/key was not projected and is not inferred. Exact-owner self-cleanup and independent readback prove raw archive, private projections, request identity and API/auth/URL/config/log files absent. No metadata acceptance, FSB payload, Restore, SQL recovery or writer quiescence follows. Evidence is under `/data/tmp/cal-dev-metadata-wJgV7E/pull-reset-preparation`.

The last direct dev serving observation at 16:43:57 UTC still showed the stock Cal 6.2.0 image, ready 1/1; readiness is not a staff journey proof. The last actual Google provider challenge remains the 10:54:48 UTC redirect mismatch, rather than a newly repeated check. Google Console ownership/callback correction, admitted image publishing authority, rebuilt image security/runtime qualification and real staff onboarding/logout/calendar proof remain open. The two previously recorded credential incidents remain open. This continuation changes no task state or production acceptance.
