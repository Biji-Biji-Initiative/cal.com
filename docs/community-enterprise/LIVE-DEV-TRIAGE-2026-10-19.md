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


## Packaged candidate and current serving image (2026-10-19)

The exact e452 standalone context was packaged as OCI manifest `sha256:c5455d127849dee8dbeb216975cd3c44e76d90e8f216ebb93bbbd7ffdebf5d6a`, config `sha256:55944b5bf59e425d86857421215e765fd189c5b5d1cc03813266f67cbd27d9df`, archive SHA256 `7b581fdc5356f8d6d29b740738eb8a2f800cdec8960385213e9a8911b1c7f03b` (338,941,952 bytes). The finite builder's actual Node process and resources were observed, and its owned resources were removed. The packaged CLI completed all 596 migrations and replay on an isolated empty database. Native HTTP, UID/GID1000, account/home, actual Sharp operation and native marker acceptance and ordinary bridge denial in native mode have separately retained positive evidence. These are synthetic fixture results, not staff, live data or deployment acceptance.

The third bridge attempt failed at `bridge-valid`. Stage-bound diagnostics show a valid token shape, HTTP200/JSON, a user object and matching ID/name/username/USER role; only email differs from the refreshed database expectation. Root independently read the actual packaged NextAuth route: it passes a default session built from the old decoded token alongside the refreshed JWT. The application session callback projects the refreshed ID/name/username/role but omits email. A focused source fix and actual-callback regression are in progress; this candidate remains failed. Authenticated onboarding and logout assertions and the guarded synthetic purge were not reached. Independent teardown of the whole disposable fixture is recorded separately from that unexecuted purge. Earlier failed attempts and cumulative timeout flags remain explicit; none is relabelled green.

The exact image's offline Trivy diagnostic completed with zero reported HIGH/CRITICAL occurrences, 58 MEDIUM and ten LOW, zero default secret matches and no suppressions. It reports 14 OS and 776 Node package occurrences, pending independent physical-inventory comparison. Full whole-layer scanning completed all 58 raw/printable/config sources with exact native byte coverage, 28 EOF/CRC/diffID checks and 816,696,320 uncompressed bytes. Four native reports contain 89 unwaived detector matches: 86 generic-api-key, two private-key and one square-access-token. These are detector occurrences across raw and printable views, not 89 confirmed or unique secrets. Semantic disposition is incomplete; no release or admitted scan follows. Root independently checked every native report hash/count/exit/coverage record. The historical image's findings remain historical and unwaived.

The package reader's HOME/status.d adaptation passed 159 focused fixtures, source Gitleaks and syntax/diff checks. Its native JavaScript UBS exit1 retains eight reviewed test-only critical findings and 130 informational findings; the Python helper checksum refusal establishes no Python UBS coverage. The original source wrapper failed because native UBS left one invocation-owned 92-byte temporary cache. Its original failure remains; later exact-owner cleanup and PID/unit/cgroup absence were independently proven. The separate required read-only Biome check passed with warnings and infos, without edits. Source qualification does not establish an actual physical inventory of this failed artifact; a corrected future artifact needs fresh binding and execution.

Fresh canonical dev reads at18:31–18:32UTC found Deployment generation38, one ready/available replica and both containers ready without restarts. It requests `ghcr.io/biji-biji-initiative/calcom-web-node24@sha256:fb5e1110b899d644daf21fc22f6d74dbca3e8885ab2cb2c47bf28259003a1aaf`. Exact canonical Infisical resolution/injection and read-only registry authentication retrieved only that manifest/config; config `177327e3d8e449a9265b7aa0a59e97d510dd48745b67c4b05650b107296c02fa` matches the live container status. Its labels cite infrastructure commit `bc4b7ed1acde9692e2c8a555ac51513c2a4de50f` and v6.2.0. Personal GitHub readback of the October15 recipe shows that it preserves the pinned stock application and replaces only Node. It is distinct from the functional candidate. This is image-lineage/readiness evidence, not a live staff journey. No registry layers were downloaded, package writes attempted or deployment changed by this investigation; temporary authentication material is absent.

Google's fresh provider-only challenge at18:29:01UTC still returned HTTP302 `redirect_uri_mismatch` for `https://cal.mereka.dev/api/integrations/googlecalendar/callback`. The same canonical client-ID-only guards and one provider GET were used, with no consent, callback exchange, client-secret read or provider change. Calendar integration remains unaccepted. Owner requests cover the actual Console client/admin and candidate publication authority. The existing private-infrastructure Node24 workflow publishes the stock runtime rebase; it is not yet an admitted consumer of the Cal prebuilt contract. Read-only registry access grants no publication authority, and no workflow was dispatched or changed.

Backup metadata comparison now passed for the same bounded archive after the exact published scheduling/pull reset and explicitly opted-in five-key ServiceAccount cleanup transformation. The raw discriminator retains two cleanup-category annotations without projecting their values or asserting their historical writer. The resulting five-object metadata projection claims only after-reset parity; raw parity, admission reinjection absence, FSB payload, PostgreSQL recovery and writer quiescence remain false. Exact-owner disposal and independent readback prove archive, private projection, authentication and request/log material absent, with only the known value-free receipts retained. An isolated restore plan is prepared; fresh capacity, effective controller/plugin and source-volume identity gates remain before any data action. No Restore or recovery SQL has run.

Actual receipts remain under `/data/tmp/cal-image-security-e452-fwr3rei1`, `/data/tmp/cal-native-e452-prep-5PePUI`, `/data/tmp/cal-current-registry-evidence-LX7m5o`, `/data/tmp/cal-google-current-JDenee` and `/data/tmp/cal-dev-metadata-wJgV7E`. The exact e452 image remains on g2; secret reports and raw streams stay private. Both recorded credential incidents remain open. This checkpoint closes no task, changes none of the 39 task objects, and records no production or real staff acceptance.

## Refreshed-email candidate and disposable restore (2026-10-19)

Published application commit `e8e8df8ff779e643a7b1fd34a1283e994223ec6d`
adds the refreshed database email to the session callback. Its actual-callback
regression first failed against the previous implementation; the corrected
authentication suite passed all 100 cases. The complete nine-step producer
then passed, including the full web TypeScript check and Next build. The three
previously documented Prisma tracing warnings remain. Source UBS findings and
the inherited uncancelled Azure fetch remain unsuppressed.

The resulting image has manifest
`sha256:f76241029f2d7f67bd9c82af3878b04c2546e8ae440f4ef4986499cf04b1d872`,
config `sha256:5c38ce754e97b3e3b9123cd68576f1384d7df54e68334b92d2e4d1e1d7be126e`
and archive SHA256
`ea6816d9c3e4ed93a726015c1e1b127e3c1d2784b8c1d7d41d5eb3ebfaed3879`
(338,933,248 bytes). Its own raw Trivy run reports zero HIGH/CRITICAL,
58 MEDIUM and ten LOW findings, all unwaived. The separate full-layer scan
completed all 58 sources and reports 89 unwaived detector occurrences. These
are not 89 confirmed or unique credentials, and no old-candidate disposition
has been transferred. Physical inventory and semantic secret review remain
separate requirements.

The first physical read refused the inherited `SSL_CERT_FILE` key before
package comparison. Published reader correction
`3575f1069fcfbc750e7dbc23192d67a64d8f3c23` accepts only the signed base's exact
public certificate path, with the regex dot escaped. Ten focused fixtures,
Biome, Gitleaks and syntax/diff checks pass. Eight test-only UBS critical
findings and the Python helper-checksum refusal remain unsuppressed. Its
original wrapper failed on one owned 92-byte temporary cache; later exact
cleanup is independently recorded. This reader correction changes no image
bytes or scan findings. The second physical read passed the certificate check
but refused an ambiguous Node package identity; inventory comparison remains
unreached. Its original failure, unchanged inputs and independent cleanup are
retained; the offending metadata is being diagnosed without changing guards.

Native attempt e8e8a01 stopped at the probe's stale expected source commit.
After that exact binding correction, e8e8a02 passed 596 migrations and replay,
native HTTP/session checks and the strict bridge principal and onboarding
redirect checks. It stopped at CSRF handling. The probe statically rejected
Cal's published `__Secure-next-auth.csrf-token` because it expected the stock
`__Host-` name; the retained runtime evidence does not isolate the exact failing
subcheck. The one-name fixture correction passed eleven focused controls,
including the old probe's failure and unknown-cookie/expiry cases. The failed
attempts remain failed. The corrected e8e8a03 run then passed in 45.002 seconds:
fresh database profile/email, exact onboarding 307, immutable subject and
administrator-update refusals, native CSRF signout with session-cookie removal
and an empty subsequent session, locked-owner denial and guarded synthetic
CAS purge back to zero. Native-marker and bridge-token isolation passed in
both directions. The four containers, private PostgreSQL fixture, socket,
processes and cgroup are absent, and the real slot was released. These are
isolated server results; client JavaScript, staff SSO, old-cookie revocation
and the live user journey remain unproved.

The authorized disposable dev restore created its five owned resources and
completed with zero errors and two warnings. All three volume restores
(`data`, `dshm`, `empty-dir`) completed and match their historical backup
volume, Pod, snapshot, uploader and storage-location identities. The data
restore matches the new 8 GiB claim; its new PV/CSI handle differs from the
serving source and has two healthy replicas on distinct nodes. The two
warnings remain unresolved. One warning-reader attempt refused a changed
in-memory selection before any provider download; that original failure is
preserved. The corrected caller keeps the bound selection unchanged. Its
fresh attempt downloaded 210 compressed bytes, decoded 296 bytes, retained
both cluster warnings as unclassified/unwaived and repeated the exact
Restore/Backup/storage identity checks successfully. This is not PostgreSQL integrity, writer
quiescence, migration or recovery acceptance. The serving database was not
written; the copied resources remain retained under their exact ownership
ledger.

The last direct serving-image observation remains the 18:31–18:32Z stock
Cal 6.2.0 application with only its Node runtime replaced. The candidate is
not deployed. Google's last actual provider check remains the 18:29Z
`redirect_uri_mismatch` for the canonical dev Calendar callback. The admitted
publisher route, Google Console administrator, real staff journey and both
credential incidents remain open. Owner message 147276 records the updated
request. This checkpoint changes no task state or production acceptance.

Evidence: producer `a06f3ded703c6d3a2e5a967c66f5c0341113b40d711d0224b8fea4784ad2d51c`;
native `340a9bcc3b09b2c4ea95f046f93837cb649a1ee7875cebb0e390d6adcd052f0d`;
whole-layer scan `887aa3476077898e1b0729fab547a3c6f5bc3063794fe782d2129078821f8017`;
restore warning projection `7d05af25a322498f986dbec4cc6eb128017a56916280049fc445313c1a77017f`.


## Public entry and calendar connection failures (2026-10-20 reports)

The owner reported an automatic IdP redirect, a second login prompt after
passkey authentication, slow logout, missing Google Calendar and an Apple
connection error. The requested flow is a public Cal welcome, explicit Mereka
sign-in and then the workspace, with app logout returning to the welcome.

The DEV public-entry fixes are published and adopted as infrastructure commits
`729d3821346fcbe053190fe4be2957708b69c778` and
`99f45a439d9aa92f6a82ec8cece188f26ac91481`. The first fixes the session-entry
mismatch: only `/auth/mereka` mints the local Cal bridge session, while the old
protected catch-all root started IdP authentication without that entry. Public
root and login now render a styled welcome with a passive sign-in link. Existing
sessions are checked through a bounded cookie-only native session request, and
native-confirmed app logout returns to `/`. The second fixes the observed
Traefik 3.7.15 NGINX-compatibility rule-priority failure with a DEV-only native
exact-root route, explicit priority and the same rate limit. The initial live
root redirect failure is retained. Stage/prod activation and logout behavior
are unchanged.

The focused source suites pass 63 entry cases and ten routing cases; the
routing suite first reproduced the defect. Full affected-file Gitleaks, syntax
and diff checks pass. Unsuppressed UBS results and dispositions are retained:
22 critical, 32 warning and 355 informational findings for the first change,
and one critical, four warning and 52 informational findings for routing. These
are not clean UBS scans.

Both DEV hosts pass 24 live HTTP checks covering public welcome, methods,
explicit entry, spoofed-header isolation, protected routes, anonymous session
and native CSRF denial. Two failed observers with over-specific IdP/CSRF-path
expectations remain retained. Actual headless Chromium then passes fourteen
browser steps across both hosts in 39.305 seconds: painted welcome, warm reload,
login, native client CSRF/logout/session requests, same-host welcome return,
shared-cookiejar empty-session confirmation, invalid synthetic-cookie recovery
and an explicit click to interactive Authentik login. Anonymous logout took
3.052 and 3.067 seconds including quiet, confirmation and screenshot. An earlier
regular-Chromium launch failed before a host request; a later optional document
fetch failed under the welcome's intentional restrictive CSP. Both failed runs
remain separate from the final pass. All owned browser processes, contexts,
profiles and cgroup are absent; the actual slot was released at 22:58:55Z.
This proves anonymous behavior, not staff passkey/dashboard, authenticated
logout or old-token revocation.

The native application welcome counterpart is published as
`feb0256f5e4f925496a106668902fa9063262e82`. Five focused cases, baseline/candidate
strict types, Biome and diff checks pass. Full-source Gitleaks retains one
unchanged baseline translation finding with zero introduced findings. UBS
retains 12 critical, six warning and 155 informational findings; all critical
and warning occurrences are in unchanged test fixtures. This source is not yet
built into a new serving image.

The Apple failure has an independently confirmed server cause: the running
stock Cal 6.2 AES-256 constructor received a 64-byte Latin-1 encryption key and
returned `ERR_CRYPTO_INVALID_KEYLEN`. A bounded read-only database snapshot
found zero affected credential, two-factor, encrypted deployment-token or
platform OAuth records. The DEV secret binding was proven distinct from
staging/production. One DEV provider update created a qualified 32-byte ASCII
key at version 2, with version 1 retained for rollback. Exact readback passed;
temporary rollback escrow and bearer files are absent. No NextAuth key, stored
user data or other environment was changed.

ESO initially remained Ready with the old value because its refresh interval
is one hour. One guarded DEV force-sync metadata request refreshed the owned
Secret at 22:34Z. The sole GitOps rollout carrier,
`d75a04050382dda8238b29b2e788b53dac538a28`, changes one DEV template annotation;
complete rendered-object comparison confirms no other object change.
Generation 40 became ready. A fresh exact-Pod check confirms 32 Latin-1 bytes
and an accepted AES-256 constructor with no invalid-key-length error. The check
performed no password attempt, encryption, decryption or database write. Apple
provider connection is still pending. The app-specific password exposed in the
owner's screenshot was not copied or tested; the owner was advised to revoke it.

The owner signed into Google Console and enabled Safari JavaScript automation.
The exact existing `cal-com-web-dev` Web client in BBI K8 Infrastructure,
project `907021223244`, matches both live DEV client identifiers by SHA-256.
One normal Save appended only
`https://cal.mereka.dev/api/integrations/googlecalendar/callback`.
Reload verified the original two ordered redirects and two origins unchanged,
with the callback as the third redirect. Separate staging/production clients
and other settings were untouched. A fresh anonymous Google challenge returned
to the exact callback with `interaction_required`; redirect registration is
now accepted instead of the earlier redirect mismatch. This is not consent,
code exchange or calendar connection proof.

The installed stock integration reads the App database keys without an
environment fallback. The live `google-calendar` row was disabled with SQL-null
keys despite complete matching credentials in the container environment. A
reviewed one-row compare-and-swap enablement uses only those canonical runtime
keys in container RAM, guarded by the original row version, exact DEV database
and current source identities. The single update committed successfully at 23:23Z with exact three-field key
readback and a closed connection; seven native calls returned zero. It created
no credential records. Signed-in browser verification remains separate; no
calendar connection is accepted in this checkpoint. CalDAV
needs its own provider's server details and is not required for Google Calendar.

Offline physical image inventory v3 genuinely refused contradictory module
metadata before comparison. A subsequent bounded data-only diagnostic identified
`next-i18next/dist/commonjs/createClient/package.json`, an internal dual-target
marker with no version. Its bytes match the retained image metadata and
installed package, whose own imports use that helper. The proposed correction
is limited to that exact marker and physical parent; no parent version is
assigned to it. Inventory remains failed pending focused source controls and a
separately qualified comparison. All inputs remain unchanged and all owned
processes/cgroups are absent, with the diagnostic slot released at 23:21:24Z.
The 89 source secret-detector occurrences remain unwaived. The live DEV image
is still the stock Cal Node-runtime rebase; functional image publication,
priced onboarding and production acceptance remain open.

Retained evidence:

- Live HTTP receipt: `2cf5f9481a53510128107c601178197e4d7fe1271659d6113fcaa382e7cb6321`.
- Final anonymous browser receipt: `c7c2fa2dbfca07ad807ca8bca41cfbdfd1ca86d66596dd68709e30ba986b4835`.
- DEV key update: `2f81ef1ad521fd08b721ab93ad10ed958e589b99b600ea09625150ab648730f8`.
- Fresh running-process key proof: `73d10ac0b75630fb842dc1efb16caef04dcf0f95fa514f110c5ed6c723f68110`.
- Saved/reloaded Google callback: `6bbbef7c690d15ab6469c877c0c3936e8d2e7ab2a1d215a571d1a6b3b452e5ac`.
- Fresh Google redirect acceptance: `4afe52f9d3fd7e98552b3c4e1460d5e2435d304f99738c7819dabbf28a448dcc`.
- Failed physical inventory v3: `ecda36612f035f6fbab14cd228cd9c99f9f987b28f95be94cd3f5d5a98eb93f9`.

All 39 task objects, previous graph checkpoints and other graph fields remain
unchanged; this checkpoint does not close staff, calendar or release acceptance.


## Google connected; broader integration recovery (2026-10-20 00:05Z)

The actual staff Safari session returned 200 from native session validation and
matched the intended account and admin role. One normal Google consent completed,
and Cal returned to `/apps/installed/calendar` with the expected Google account,
discovered calendars, conflict checking and destination-calendar controls. No
meeting, calendar event or message was created. This supersedes the earlier
connection-pending checkpoint. Receipt:
`c6ade5b75d6f0a2b4dde1cf0d7c8f435c39da26b40f65862a1427d6abd68eaad`.

The owner explicitly selected `cal.mereka.dev/gurpreet`. Native username
availability returned 200, available and nonpremium. One profile submit succeeded
with existing full name and timezone preserved, advancing through the calendar
and video steps. No availability form was edited or submitted. Zoom was absent
from the owner's captured video-list viewport; complete mounted-list and live
registry qualification remain pending. No alternative provider or default was
installed. Later mutable Safari tab indices failed their identity guards, so no
session-loss or actor attribution follows from their changed URLs. Successful
Google/profile observations remain preserved; current browser authentication is
unknown until a newly identified owned window can be checked.

The missing-provider audit has a concrete configuration cause. The current DEV
recovery command runs URL replacement and `yarn start`, explicitly skipping stock
migrations and app seeding. Stock v6.2 `start.sh` invokes `seed-app-store.ts`, which
copies configured provider settings into database App keys and validates enabled
state. Native OAuth loaders read those database keys, with no environment fallback.
Google web settings seed both Calendar and Meet. Zoom and Microsoft require their
own configured pairs; existing stored keys are preserved when no replacement is
provided. This proves a DEV bootstrap gap, not deletion of March production data.
No full startup seed or blanket integration toggle has been run.

Google Meet is a dependent non-OAuth app: `google-meet` / `googlevideo` uses the
same three Google web settings and depends on Google Calendar. Native Connect
creates a user marker without another provider callback or consent. A selective
repair still requires an actual live App/principal readiness check.

Five bounded Infisical requests returned 200. Direct Cal folders in dev, staging
and prod contain Google provider keys, with no direct Zoom or Microsoft pair;
absence elsewhere is not inferred. A stored shared reference identifies an
existing Cal.com Integration Zoom app. A nonrotating admin read confirms its name,
unpublished status and 136 account/admin/master scopes. General-manifest export
returned 404, and no target credentials were returned. Its suitability for Cal's
user OAuth flow is unproved; no app, permission, credential or manifest changed.

A separate real calendar-settings error produced SyntaxError metadata. The proxy
currently replaces the incoming public Host with loopback localhost. A DEV-only
correction validates the two public authorities and forwards Host separately from
the unchanged TCP destination, including session validation and native logout.
Four new cases reproduced three failures before correction and pass afterward;
121 existing cases pass with one existing PostgreSQL skip. Syntax, diff and
Gitleaks pass. UBS retains 16 critical and 13 warning findings, all in an exact
unchanged test prefix; there is no embedded-YAML semantic coverage claim.
The three-file correction and single DEV rollout annotation are reviewed but not
published. Both native renders completed; normalized comparison remains pending.
Encryption revision is preserved. Stage/prod opt-in behavior is unchanged.

Mac SSH timed out twice and Commander reads reported no response. No subsequent
browser/provider/database mutation was queued. The owner has been asked to keep
the Mac awake with Commander connected. This blocks canonical deployment and
browser checks while offline source work continues.

Physical image inventory v4 now parses the image, with OS 14/14 exact and 775
matching Node occurrences. Its one missing native record is the physically shipped
first-party `calcom/apps/web/package.json`, omitted by the node_modules-only
collector. All seven inputs remain unchanged; the phase failed coverage and its
process/cgroup cleanup and actual slot release are retained. A narrow collector
correction has a genuine failing regression; its whole-suite attempt timed out,
so no candidate pass is claimed. The focused resume subsequently passed all 105 selected cases, including 18 new
app-manifest cases and 87 existing collector/alias/coverage/deadline controls.
Syntax, Biome, Gitleaks and diff checks passed. UBS remains unsuppressed at
21 critical, 107 warning and 252 informational findings. The whole-suite timeout
stays failed; exact owned cleanup and slot release at 00:14:28Z are verified.
Source review/publication and actual image comparison remain pending.
All 89 secret-detector occurrences remain semantically unqualified and unwaived;
70 coordinates are mapped, with 19 blocked by exact replay-format limits. No
image or production acceptance follows from these partial results.


## Native Cal baseline and resumed live checks (2026-10-20 00:50Z)

The owner explicitly requires Cal.com's existing product and previously available
capabilities as the baseline. Preserve and integrate native booking,
availability, calendars, conferencing, App Store, profiles, teams, workflows,
notifications, webhooks, APIs and embeds. Add Mereka-specific behavior around
those services. Before adding a replacement, establish the native capability
and the actual gap. The review now includes disabled, bypassed, removed and
duplicated native paths, rather than startup omissions alone.

The App Store implementation is present. Its configuration initialization was
bypassed by the recovery command. The exact upstream v6.2 startup order is URL
replacement, database wait, Prisma migration deployment, App Store seed, then
web startup. Recovery retains URL replacement and web startup. Database
readiness, migration state, native startup-tool availability and the effects of
the missing app initialization still require runtime qualification. The native
admin App Store already validates provider keys and enables a disabled app in
one save; this is the preferred restoration path. No general replacement
reconciler or blanket seed has been introduced.

The owner confirmed the Mac is awake and connected, and SSH access recovered.
The three reviewed source files remained intact, although old private temporary
helpers and identity selections were absent. Helpers are recreated from public
source and runtime selections are refreshed. A newly owned Safari window with a
stable identity and one Cal tab passes expected staff-session validation.
Native event types render, and a fresh installed-calendar observation confirms
the expected Google account, conflict and destination controls, fourteen
switches and one checked calendar. No second consent or reconnect occurred.

Clarification of the previous profile observation: the outer setup form saves
name and timezone. Username uses a separate native Update and confirmation Save.
Earlier progression did not prove the booking username persisted. The owner has
chosen `gurpreet`; the correct native save and fresh profile/public-page readback
are pending. No database-loss inference follows from the empty setup field or
the earlier public Not Found response.

The DEV Host correction is personally published as
`c28e7a2dfcabd27b988dc7881154104483be01e8`. All three remote blobs match the
reviewed bytes. The normalized render has 33 objects and changes only proxy code
and the DEV rollout carrier; images, arguments, environment and encryption
revision remain identical. GitOps generation 41 has adopted the carrier, with
the new Pod still awaiting readiness. Calendar-settings retest and actual staff
logout/re-entry remain open.

The physical inventory collector correction is published as
`2999be9b5b762c62f9d6e462050f2bb7580005d7`. One actual v5 comparison exits zero:
all 776 Node path/name/version occurrences and all fourteen full OS tuples match
the native report. All seven input identities remain unchanged. The actual
unit, process, cgroup and temporary-home absence precede slot release at
00:28:40Z. This qualifies physical inventory only. The earlier failed inventory
attempts and whole-file test timeout remain retained; the 105 focused source
tests passed. All 89 secret-detector findings remain unqualified and unwaived,
and no image admission, publication, deployment or production acceptance follows.

Historical March31 source already declares Google provider settings and a
production startup override. Its lack of direct Zoom/Microsoft variable names
does not establish absent stored App settings or deleted connections. Current
App/provider and native background-service audits remain open. Google Meet
restoration is authorized through the native admin flow only after exact DEV,
staff, existing Google configuration and conflict-free target-state checks.
Zoom still needs a compatible configuration and credential pair. No provider
default, calendar event or customer-visible message has been created.


## Release hold: preserve full native Cal (2026-10-20 01:15Z)

The reduced e8 candidate is on hold for publication and deployment. All
capability-removing cleanup migrations are also on hold, including against
empty tables. The owner's requirement is to retain the existing full native
Cal.com product and extend its actual services with necessary Mereka behavior.
The current full-stock Cal.com DEV runtime remains the repair target. No reduced
candidate or its cleanup migration has been deployed or run by this work.

The [native preservation audit](NATIVE-CAL-PRESERVATION-AUDIT-2026-10-20.md)
pins the full v6.2.0 tag to `1c193cca8682b33b9866c792186033f7ef886682`.
The programme inherits a reduced MIT distribution. It removes no files relative
to that MIT baseline, but lacks native workflow, routing-form and many
organization/team API paths relative to full Cal. Nineteen native models are
absent: the full schema has 119 models, the candidate has 101 including one new
audit model. Native reassignment and routing-response paths also reach no-op
adapters. The newer narrow administration/routing modules do not establish
native parity. The complete report and all seventeen sealed source-evidence
files were independently checked. Preserve all programme work and port genuine
identity, provider, authority, booking and worker fixes onto full native services;
do not adopt the reduced source or its lock/migrations wholesale.

The Host correction is now actually ready in generation 41. Five native commands
returned zero and checked the running source against the reviewed ConfigMap,
with stable Pod identity, images and encryption revision. The subsequent real
`/settings/my-account/calendars` retest still renders its generic error and Try
Again. The Host contract repair is valid but does not close this user-facing
bug. The installed-calendar page separately retains the working Google account
and conflict/destination controls. A bounded native error investigation remains
open; no reconnect, reseed or provider-default change was made.

The booking username is now actually saved through the normal native inner
Update and confirmation Save, exactly once. A full reload initializes
`gurpreet`; full name and timezone remain. `/gurpreet` renders the expected name
and two existing event-type links, without Not Found. No event type or booking
was recreated. The earlier outer form progression was not username-persistence
proof. Fresh authenticated dashboard/logout/re-entry acceptance remains open.

The current read-only App/profile/startup matrix completed eleven native commands
successfully with stable web/PostgreSQL/PVC identities. There are 104 App rows,
78 enabled and 26 disabled; every disabled row has SQL NULL keys. Google Calendar
has all three canonical environment-matching settings and the staff credential.
Meet and Zoom are existing disabled rows without keys. The native admin Save
path remains the preferred selective restoration method; Meet has not yet been
saved. Preserve the complete redirect array when using the existing native API.
No blanket seed or replacement configuration service is needed.

All 584 installed migration directories are applied; the database records 588
completed migrations, none incomplete or rolled back. The four additional names
are version evidence and do not authorize applying an older migration tree.
Database readiness is presently proven; omitted cold-start ordering remains a
separate contract. Actual native seed/tools/imports exist. The fixed native
`.env` and `.env.appStore` inputs are absent, and exact process-key discovery
finds only the Google provider group complete. Running the seed cannot recover
an absent Zoom pair from those inputs.

Native mail uses its existing configured EMAIL_SERVER_HOST transport branch.
The earlier SMTP-variable probe did not cover that native contract. No relay
connection or delivery is claimed. DEV has no namespace CronJobs, CRON_API_KEY
and CRON_SECRET are absent, and native API v2 plus Redis have zero desired
replicas. These operational gaps need restoration through the existing native
service/scheduler contracts after pending-work and no-send checks. No cron,
queue, email, provider or migration action was executed by the audit.

The exact e8 physical 776 Node / 14 OS comparison and its 105 focused source
tests remain their limited historical evidence. All 89 detector findings remain
unqualified and unwaived. Physical inventory does not override the native
capability hold or establish complete image, API, worker or production acceptance.

## Native DEV settings closure and preservation preparation (2026-10-20)

The real calendar settings page is now verified. DEV infrastructure commit
`3e1bda93c27b6bfed9079b8d0ed99ebfd13c638a` corrects only the native
ALLOWED_HOSTNAMES value: this installed Cal version wraps quoted CSV in brackets
and matches base-domain suffixes. The old full JSON array nested the entries;
full public host names also failed its suffix match. The native value now uses
the Mereka DEV base domain. The proxy still accepts exactly the canonical and
alias hosts. Images, encryption revision, proxy implementation and carriers are
unchanged; staging and production renders are identical to their preimages.

Focused native-contract tests pass, and the relevant source suite passes 123
tests with one existing PostgreSQL skip. Gitleaks reports no findings. UBS
findings remain unsuppressed: 17 inherited critical findings and 41 warnings,
including four introduced test/parser warnings reviewed separately. This is not
a clean UBS claim. The three published blobs were independently read back.

The first bounded rollout observation ended not ready and is retained. A later
metadata read qualified the previous healthy Pod and the new running Pod without
restarts. A subsequent bounded startup diagnosis observed actual readiness;
the final five native commands returned zero and qualified generation 42 as one
ready, available, updated replica with stable Pod UID/spec, actual loaded CSV,
native parser/suffix results and reviewed source. No rollout restart or second
configuration change was made. The logger warning/JSON fault remains separately
unqualified; correcting this native domain contract does not prove a logger fix.

At 01:51:56Z, the fresh real Safari page
`/settings/my-account/calendars` showed the expected Google account, Google
Calendar, Check for conflicts and Add events to. Error, Try Again, loading and
busy markers were absent. No calendar control changed. This closes that exact
DEV page failure; installed-calendar and authenticated journey evidence remain
separate observations.

Google Meet configuration was restored through the existing native admin form,
with exactly one Save. Fresh read-only native results qualified enabled state,
all three exact Google-source settings and the complete ordered redirect array.
The first post-save DOM observer matched a toast as a second card and failed;
the original failure remains, and no Save was retried. One normal native
Install app click subsequently reached the native event-type assignment phase.
No event type, default location, booking or provider meeting was changed.
Fresh native installed-conferencing observations at 01:53:13/01:53:34Z then
showed exactly one Google Meet heading/card with no error. A failed count-query
observer remains separately retained; the successful native transition and
installed card are the user-installation evidence.

The real staff journey is now complete for the current configuration: one native
Sign out reached the public welcome page; ordinary same-profile navigation to
the native session endpoint at 01:59:24Z showed exact JSON `{}`. The welcome page
remained, and one explicit Mereka sign-in at 02:01:13Z returned to the same staff
dashboard. The final 02:02:43Z native session request returned 200 with expected
staff/admin identity, and the native Google-credential check returned 200/true.
No passkey or credential intervention was needed. This proves app logout and
explicit re-entry using the existing IdP session; fresh-passkey, global IdP
logout, token-revocation and screenshot acceptance are not claimed. The sealed
staff-native-journey receipt binds sixteen evidence files and retains earlier
observer refusals, navigation transitions and CSP-blocked injected fetches.

The saved username and public `/gurpreet` profile remain qualified. A settled
fresh `/event-types` page showed native event types, New and Availability with
the expected staff session. Early SPA-navigation and exact-label observer
failures are retained as observer results, not new product defects.

Correction to the earlier migration count: the fourteen-digit directory filter
excluded four legitimate native fifteen/seventeen-digit migration names. The
selected native source has 588 migrations. Thus the observed 584 count is not a
complete installed set and does not establish version drift against 588 database
rows. Exact source/installed/database names and raw checksums remain the required
comparison. The corrected read-only reader has not run; no migration is approved.

The reduced release and all five capability-removing cleanup migrations remain
on hold, including against empty tables. Full native source objects were
verified against all 10,341 sealed path/mode/blob entries without changing shared
source, refs, index or foreign files. Six explicit scratch partitions cover
3,733 trusted application paths: 2,713 missing native paths and 1,020 unchanged
MIT paths. Root independently checked their twelve file hashes and all final
native/preimage identities. The exact six partitions pass read-only
`git apply --check`; this is hunk compatibility, not source adoption or a build.

All 123 programme-different paths have exact three-way fragment evidence. Fifty
have identical native/MIT bases, but they still require capability review:
programme onboarding, organization, authorization or routing cuts must not be
retained merely because a patch applies. Root prepared provisional scratch
schema and platform-binding proposals: preserve every byte of the native 119
model schema plus the existing independent audit extension; restore actual
native reassignment, verification, organization, payment and phone functions
with necessary existing identity/API adapter exports. Native policy absorption,
dependency/lock support, remaining service merges and generation checks are open.
No source-restoration patch, dependency install, build or migration has run.

A separate real guest gap is now confirmed: anonymous GETs without cookies or
identity headers to `/gurpreet` on both public DEV hosts return 302 to
`https://auth0.mereka.dev/application/o/authorize/`. Redirect queries were omitted
and the provider redirect was not followed. The earlier public-profile rendering
was observed in the staff browser and does not prove anonymous booking access.
Native public booker routing needs repair while retaining explicit protected
Mereka entry, native auth boundaries and the two-host proxy restriction.

Both native cron secrets are absent from the serving Pod, DEV ExternalSecret
mappings and exact hidden-value provider metadata. Installed tasker cron/cleanup
source uses the interpolated Bearer guard, but compiled/middleware/external
equivalence has not been asserted or exercised. A selective native-secret/ESO
configuration plan is prepared with separate actual Secret-adoption and Pod
carrier gates. No key has been created and no scheduler/worker/endpoint enabled
or invoked. This configuration admission precedes wider native public API routing.
The optional migration/pending reader also remains unexecuted: a tiny cgroup
check found insufficient immediate headroom for an extra PostgreSQL Node process
in the web container. A bounded PostgreSQL-Pod read and public-file hash route is
being prepared instead, without changing memory limits or the healthy app.

DEV native API/Redis/scheduler configuration, Zoom credentials, mail delivery,
full native adoption, image/security qualification and production acceptance
remain open. The current source proposals and page proof do not close them.

## 2026-10-20 continuation: native runtime restoration and capability preservation

The full native Cal.com feature set remains the baseline. The reduced Cal.diy
candidate and all five capability-dropping cleanup migrations remain held,
including on empty fixtures. None of the source proposals below authorizes a
build, source adoption, migration, release, scheduler or customer-visible send.
The live DEV application remains the existing full native 6.2 derivative.

Native DEV cron credentials are now present and loaded. Exactly two missing
Infisical DEV records were created, with independently generated values held
only in memory; both version-1 records were read back successfully. Infrastructure
commit `58105a9369a6fe269c2e18950f76f8e354b1b09f` added only the two DEV
ExternalSecret references and their documentation. Commit
`cacaa8a46e49e16d2c04d2ed7b36b8f1a2c4bcc8` added only the DEV Pod annotation
needed to load them. Stage and production renders were unchanged. The actual
generation-43 ready Pod `calcom-6bff67c56b-2dwqr` was checked before and after
the loaded-environment inspection: both native cron values were present,
distinct and correctly shaped; web and proxy restart counts were zero. No
values or value hashes were recorded. The direct read-only proof used five
successful native operations and no extra web Node process. Its receipt is
`value-free-native-cron-direct-ready-v2.json` in the existing cron evidence
directory. The earlier rollout/cardinality refusal and failed direct-UID
observer remain recorded separately. Provider-to-ESO value equality was not
tested, and the installed cron authorization behavior remains untested. No cron
endpoint was called and no scheduler or worker was enabled. The native source
guard still needs the reviewed fail-closed repair before execution is considered.

Two retained failed Pods were evicted during `calcom-yarn-bootstrap`, before
either web or proxy started. Their projected native status messages identify
ephemeral storage as the resource dimension. Neither is evidence of a web OOM.
The currently ready Pod has no web or proxy restarts. The node's current
Ready=True and pressure=False conditions do not prove its historical state.
Fleet owner HazyValley was notified in Agent Mail message 147829; no node,
network, permissions or capacity configuration was changed by this work.

The real staff browser audit settled seven existing native pages: Teams,
Availability, Bookings, App Store and Profile rendered their normal content;
Workflows and Routing rendered native license notices. This proves navigation
and these readiness states, rather than full business workflows. The earlier
native staff logout, empty session, explicit Mereka sign-in, dashboard, Google
Calendar and Meet proofs remain valid within their recorded limits. Fresh
passkey entry, global IdP logout and revocation have not been proved. The native
session currently reports hasValidLicense=false. The loaded license environment
variable is absent; native Deployment-row license fallback is still under
read-only investigation. No license bypass or activation has occurred.

Zoom's authenticated native Build index contains one matching Cal.com
Integration app in the currently inspected account. It is explicitly a
Server-to-Server OAuth app. The native Cal connector uses a user authorization
code flow, so this existing app cannot simply be substituted. The fresh DEV
native App Store query reports Zoom disabled with empty client fields. This is
not proof that another owner or the March deployment had no usable client.
Historical lane metadata is being checked before any new client is created.
The staging PostgreSQL StatefulSet is currently scaled to zero, so its stored
configuration remains unknown without starting it. No credentials were revealed,
rotated or copied between environments; no new Zoom app, provider consent,
meeting or default conferencing assignment has been performed. A dedicated
unpublished DEV user OAuth recovery plan is prepared using Cal's existing
connector and maintained Zoom configuration tooling.

Anonymous booking remains an open, reproduced defect: cookie-free and
identity-free requests to `/gurpreet` on both DEV hostnames return a redirect to
the staff IdP. Staff profile rendering is not guest proof. The actual controller
is Traefik 3.7.15 with both native CRD and NGINX compatibility providers. A narrow
five-file adapter change is being implemented against its pinned matcher
behavior and the native application's routes, rewrites and 37 locales. It keeps
private Outpost enforcement and native booking logic, rejects route/marker
mismatches and strips forwarded identity from the anonymous path. This proposal
is not yet deployed. Public booking, reschedule and cancellation still require
real guest acceptance after source review and deployment.

The full-native source preservation work remains scratch-only. The 3,733
unambiguous source restorations have passed read-only patch checks, and all 123
programme deltas have explicit review classifications. Authentication proposals
retain native licensing, billing, organization, delegation, profile and provider
paths while narrowing stale role and foreign-profile session hints. Their
source fixture passed 117 cases plus two focused projection cases; six TCP OIDC
cases were not executed. Repository, license and organization dependencies were
explicit fixture doubles, so this is not full native compilation or database
qualification. UBS findings remain unsuppressed with coordinate dispositions.

Root's nine dependency proposals preserve the native graph and programme
security constraints, including restoring the native routing builder dependency.
Patch companions, lock generation, native type closure, Prisma, Node/image ABI
and advisory scans remain open. Native schema, platform and booking repository
proposals also remain unapplied. An executable native-capability admission guard
is being prepared for the existing application packaging paths, because recipe
equality alone cannot reject a reduced source tree. No CI, promoter, runner or
lane policy is being replaced.

All 39 task objects and previous graph fields are preserved. No task is closed
by this continuation. Stored task-kind counts and native migration name/checksum
comparison, scheduler safety, historical integrations, notification delivery,
API/Redis readiness, Apple/CalDAV, full native source adoption, image security,
backup/restore acceptance and production acceptance remain open.

## Continuation — native baseline enforcement and actual DEV migration comparison, 2026-10-20

The user reconfirmed that every previously available native Cal.com capability is the baseline. Native App Store, integrations, teams, workflows, routing, onboarding and public booking must be preserved and connected through their existing implementations. A reduced distribution and bespoke replacement flows do not satisfy that requirement. The reduced e8 artifact and all five capability-dropping cleanup migrations remain frozen. No full-native source adoption, dependency installation, build, migration, API/worker activation or production promotion is authorized by this evidence record.

### Actual DEV native SQL comparison

One bounded read-only PostgreSQL transaction observed all 588 applied migrations, with no unknown, incomplete, rolled-back or duplicate rows. Every native migration name and checksum matches the completed DEV database record. The transaction used the existing PostgreSQL container and its existing in-container connection environment; no values, payloads, IDs or arbitrary unknown names were output. All nine native operations exited 0 in 34.86 seconds and the source, PostgreSQL workload and storage identity checks stayed stable. Receipt: `g:/data/tmp/cal-native-dev-metadata-20261020/result-1.json`, SHA256 `22003e02e3407e7314f98edcd3c74076b4f8fb19364cc5bf5a96bb340c86209f`.

The native pending-work projection included all 20 actual Task kinds and native due eligibility (`scheduledAt < now`, unsucceeded and attempts below maximum). Task, WorkflowReminder, WebhookScheduledTriggers, Booking and ReminderMail counts were all zero. This is a bounded observation of DEV, not permission to run schedulers or send messages. The native task processor and all handlers remain the authority; its cleanup TODO is not represented as an implemented cleanup service.

A separate actual read on the freshly ready generation-44 web Pod `calcom-6df44c4f68-lv92n` (UID `0dfe0b58-9076-4362-8a3b-f07e239b0c34`) hashed the installed migration SQL files with one `sha256sum` process and one `wc` process. GET/exec/GET all exited 0 in 9.253 seconds, exact image digest matched, pre/post Pod UID/spec/readiness stayed stable, and web restarts stayed zero. No extra Node process, SQL, application endpoint or provider action was used. Receipt: `g:/data/tmp/cal-native-operations-EkrdIN/installed-native-migrations-batch-result-1.json`, SHA256 `fc577be8f0083b01f39225cb10305e74c4de5755861674cc58f50b1314b8bca9`.

The independently executed comparison now establishes equality of all 588 names/checksums across native source, installed DEV SQL files and completed DEV database records; source and installed byte sizes also agree. Comparison: `g:/data/tmp/cal-native-operations-EkrdIN/native-sql-three-set-comparison.json`. This does not qualify compiled application behavior, a future artifact or a database write. Earlier file-reader failures remain retained: attempt 1 failed its first Pod GET; attempt 2 returned only a completed GET before an unclassified refusal and could have started its remote exec. A subsequent exact owned-process count found zero owner shells, hash children and size readers before the successful batched read. No outage, eviction or deployment cause is inferred from those earlier refusals.

### Full-native web artifact guard published

Programme commit `9fa31274c88afc57ccb2801c880da453b8f0f2ec`, parent `cd4a102e8c63e1c4b1fe31f8897755c7bfa52899`, changes exactly five paths: the pinned native policy, standalone preparer, root legacy Dockerfile, prebuilt publisher and existing runtime packaging tests. It was published as Gurpreet with an Agent trailer by normal fast-forward push. Personal GitHub API readback verified complete remote bytes of all five files, including the 1,450,795-byte policy; the detached checkout, empty index and two pre-existing foreign files were preserved and all five leases were released.

The policy requires all 9,430 app/package Git identities from native commit `1c193cca8682b33b9866c792186033f7ef886682`, actual tree `20daa9e6fdceb7105dd1c065f29498adc243c0f0`, the native 119-model schema and all 588 original migration files. Root independently compared every source identity and every schema/SQL byte hash against native Git objects. Reviewed ports and extra migrations are empty, and root dependency closure is explicitly null: the current reduced tree and prior artifacts fail admission, and native source alone cannot qualify a new build. A future reviewed root package, lockfile, Yarn configuration/release and patch companion set is still required.

The standalone preparer validates source before copying/tracing and before completing its manifest. The legacy Dockerfile calls the no-dependency baseline checker before installation or compilation. The publisher independently binds source Git objects, policy, schema, SQL and dependency proof; its actual OCI collector checks final SQL bytes and active set through whiteouts/replacements and rejects aliases or extra migrations. The public literal Prisma environment symlink is hashed without following its target. Existing actor, security, secret, provenance and registry gates remain.

93 distinct focused registered cases passed across 119 executions, including actual Git objects, filesystem identity, both duplicate-path parsers and the miniature OCI collector. Biome, Python syntax, Gitleaks and diff checks passed. UBS remained unsuppressed exit 1: baseline 21 critical/69 warning/288 info, candidate 22/81/403 before the final duplicate-only test scan. The introduced critical compares a public migration checksum, and parser, strict-type, managed descriptor and synthetic-fixture findings have explicit dispositions. No clean security scan or image acceptance is claimed. Root fully read the code diff and dispositions and independently rehashed all 30 packet files: `g:/data/tmp/cal-native-admission-guard-Hpn6uP/PACKET.json`, SHA256 `4a0d98d505cdeb265ebf0a1ff31a5ebcf9211767887e158ce29fac4f7c49a625`.

This five-path enforcement covers the existing programme web artifact routes. The separate API-v2 Dockerfile/publication paths and any worker/service artifact remain outside its acceptance scope. All source-only test units, owner processes, cgroups, temporary homes and build slots were terminal/released before publication. No actual new image, full native build or release was attempted.

### DEV guest route adopted; public rendering still fails acceptance

Infrastructure commit `2bc5f7056b92591062a85971c62ef93d2e89fbd4`, parent `581b3609`, published exactly five reviewed guest-route/proxy/test files. All five remote API blobs match the reviewed source. DEV generation 44 adopted the guest flag/carrier, proxy source and exact Traefik route/middleware; Argo reported Synced/Healthy at that commit, one ready web Pod had zero web/proxy restarts, and the existing private ForwardAuth spec was unchanged. All 20 native observations exited 0. Adoption receipt: `g:/data/tmp/cal-native-public-booker-review-9v0cqhz0/publication-adoption/value-free-guest-adoption.json`, SHA256 `c37783c0a31b67d9abbf05e47d8620e01748d928c978828425a42e6766909860`.

Actual anonymous GET of `https://cal.mereka.dev/gurpreet` no longer redirected to the staff IdP, but returned native HTML with HTTP 404 after 11.415 seconds. No identity/cookie was sent, no redirect followed and no native session cookie issued. Public booking acceptance therefore FAILS and stays open. The full-HTML generic-error substring is not painted-DOM evidence and is not used to attribute a rendering exception. Receipt: `g:/data/tmp/cal-native-public-booker-review-9v0cqhz0/http-acceptance/receipt.json`, SHA256 `6215f108d5012a8ea6c243bc58271f0f3a6b7d2c3df6963c3a77d52522b1ad66`. The first isolated Linux browser refused before navigation because no usable sandbox was available; its process/unit was closed, host settings were unchanged, and no browser success is claimed. Staff/native profile comparison and native user/org-context lookup diagnosis continue. No booking or calendar write occurred.

Guest publication preserves existing crypto, cron, image and domain settings. Staging and production rendered shared proxy code but lack the DEV guest flag/carrier and received no rollout. Other native team, organisation, hashed-link, booking, cancellation, forms and video destinations remain separate open coverage; these are not silently accepted by the narrow personal booking predicate.

### Dedicated native Zoom user app recovery continues

The read-only historical projection found no Zoom App row or personal Zoom credential in the exact current production Cal database. DEV has no Deployment id-1 license fallback row. Staging PostgreSQL remained stopped/unqueried. These facts do not establish absence in March, another account or another database. Native user OAuth is still required; the existing Server-to-Server OAuth app is not a substitute.

After three fresh DEV secret-name metadata 404 results, exactly one General Zoom app shell was created through the native Marketplace UI with an external consumed-attempt record. Public controls confirmed User-managed and Development selected. No credential values were read. Root reviewed the full actual/preparation packet: `g:/data/tmp/cal-staff-resume-HAXRnC/zoom-shell-creation-and-followup-packet.json`, SHA256 `f594b56d3aa12953e183e9cca870dfb8c1fea43fd8a5ddf11c109207b04a749a`.

One exact ASCII name write (`Mereka Cal DEV`) and one native blur were invoked after a separate external consumed-attempt record. Name persistence is NOT yet qualified: a normal same-private-URL reload landed on Marketplace root, so the following Basic Info observers could not establish the name. No repeated rename or Create occurred. Native Build-row reconciliation and authoritative app-id mapping continue. Two opaque route components are not guessed. The private RAM-only pair reader and DEV three-key custody module remain prepared; no credential read, secret create, callback/scope configuration, consent, native Cal Zoom save/install, meeting or default assignment has occurred. The existing maintained Zoom desired-config/sync tools remain the configuration authority.

Native source/dependency restoration, browser-proved public/profile behavior, fresh passkey/global logout, integration breadth, notification delivery, workflow/routing entitlement, cron authorization/execution, API/Redis/service closure, Apple/CalDAV, backup integrity, image security and production release remain open. Existing Google Calendar and Meet limited staff proofs are retained without extending them to those unproved flows. No source task is closed, and all 39 task objects and prior graph fields remain unchanged.


## 2026-10-20 06:24 UTC: native public pages and restored database integrity

The complete prior native Cal.com product remains the baseline. The reduced artifact and all five capability-dropping cleanup migrations remain frozen. Source proposals below are preparation, not deployed features or full native build acceptance. No production release, API/worker/scheduler activation, booking/calendar/meeting send or data deletion is claimed.

### DEV public booking pages now paint

The personal guest routing change `2bc5f705` and reserved aliases `e2e4d6e` reached generation45 with the singleton web/proxy Ready and zero restarts. Both DEV aliases passed25/25 anonymous HTTP checks; existing private authentication, spoofed identity and native-cookie protections were retained. Root personally viewed the isolated browser's native Gurpreet profile, existing event cards and settled15-minute calendar with dates and time buttons. The earlier skeleton screenshot and observer failure remain in the packet. No slot was selected or booking created.

Final evidence: `/data/tmp/cal-native-reserved-review-3zx_z2ff/FINAL-RUNTIME-HANDOFF.json`, SHA `87482f5776a1348f3f621ac94115ce84dfe1abc59dbd7c2a8878e17911c06f79`; root independently checked all16 evidence file hashes. The current authorized private-auth owner is ScarletMoose: `e460d3e0` adopts the dedicated native outpost and preserves the public fixes. The stale Mac checkout must not roll it back. Agent Mail handoff148154/root acknowledgement148163 records ownership. Previous sanctioned fixture logout proofs for all three lanes remain bounded fixture evidence, not Gurpreet physical passkey or saved-cookie revocation proof.

### Existing restored DEV database passed bounded read-only integrity checks

The missing historical ownership files were not guessed. Four metadata GETs reconstructed exactly the original five-resource ledger digest in private RAM; only public success/counts were retained. Two subsequent read-only transactions validated PostgreSQL17.6,122 public regular tables,35 required-column checks,zero invalid indexes/unvalidated foreign keys,exactly588 completed native migration names/checksums,and empty Task/WorkflowReminder/WebhookScheduledTriggers/Booking/ReminderMail counts. All10 native calls exited0; restore/pod identities and specs were stable before/after. The first refusal over dual password environment names is retained; both aliases were then proven to reference the same nonoptional existing secret, with no value output or write.

Receipt: `/data/tmp/cal-native-operations-EkrdIN/restored-native-integrity-result-2.json`, SHA `ae8dd6861ff9591c68b77be86504ca9b2e1e3dcaed3a8fd1cd319fac7a7ff9d8`; summary `restored-native-integrity-summary.json`. This does not waive the two restore warnings or establish source-at-capture consistency, physical corruption freedom, effective CNI or full application restore acceptance. No new restore or cleanup ran. The source-qualified retention deadline is `2026-10-20T10:49:08Z`.

### Dedicated native Zoom app: current owned configuration verified, Cal connection pending

The native Build view proved the dedicated General app's exact persisted name and authoritative app-ID mapping. One private Development credential-pair capture produced exactly three new DEV version1 records with fresh404 guards and equal readbacks, app-ID last. Existing consumers, old client pairs and rotating Maker credentials were not changed. The earlier inventory observer had missed General routes; the existing `zoom-rtms-calendar-dev` General app is a separately qualified calendar consumer, and the old Cal.com Integration S2S app cannot substitute for native user authorization-code OAuth.

The maintained desired-config/sync library used explicit S2S-V2 administrative bootstrap. A single manifest PUT returned200, but its immediate readback failed verification. That failed attempt is retained and its discarded historical collateral diagnostics remain unknown. A later GET-only reconciliation, without a second PUT, observed all six owned fields equivalent: User-managed usage, exact DEV callback/one allowlist, both strict flags and exactly the six expected non-admin scopes. The app remains unpublished and production callback is empty. No inference about the immediate failure's cause is made.

Receipts under `/data/tmp/cal-staff-resume-HAXRnC/`: `zoom-authoritative-custody-integration-attempt-2/value-free-integration-result.json` (custody), `zoom-maintained-manifest-apply-attempt-1/value-free-manifest-result.json` (failed immediate verification), and `zoom-maintained-manifest-reconcile-check-attempt-1/value-free-manifest-result.json` (current owned state). The source helper's HTTP-module shadowing was corrected and a fake-connection control passed before requests. A later prepared diagnostic status bug received a genuine pure RED/GREEN test; the actual completed reconciliation had no error code and unchanged pins. Native Cal's exact card is **Zoom Video**; an earlier exact Zoom selector missed it. Native Cal save/install/consent and real meeting creation remain unproved at this checkpoint.

### Native source preservation preparation progressed

The eight auth entry proposals retain native account-route bodies, native mixed-provider/MFA/recovery/org/login paths and the existing explicit staff adapters. The malformed-enabled enum guard stays narrow; exact dual-false remains the established bridge contract.71 distinct source-fixture cases passed across retained runs, including two final added-provider success/rejection cases after a catch using native error state. Root full-read the source/catch and independently checked all54 packet file hashes/eight final blobs. Packet: `/data/tmp/cal-native-auth-entry-39KaCR/PACKET.json`, SHA `3f9e48dc6931bf1219239cab3851185d10ce24b420ba4fff4ebc15102e06bf30`. Required English translation is one explicit existing fragment, not the whole programme dictionary. Biome inherited errors, unsuppressed UBS dispositions and the optional UBS timeout remain recorded; no final full-suite/type/runtime claim is made.

The native host qualification proposals restore exact native DI/loadUsers and leave the native service's routing, reschedule, segment, subset, fairness, fallback and delegation core unchanged. One appended pure predicate prevents required fixed hosts or whole qualified RR groups disappearing through watchlist filtering; booking/slots call that native-service predicate. There is no parallel custom host service. The actual isolated command `node --test --test-concurrency=1 .../host-fixtures.test.cjs` passed10/10 in4.476s using native normalization/service/booking functions with explicit external service doubles. All six files parsed and Gitleaks returned0. UBS baseline0C21W111I/candidate4C25W138I preserves exactly every product critical/warning finding; the four added criticals/four warnings are fixture-only with explicit unsuppressed dispositions. Slots runtime is not exercised. Packet: `/data/tmp/cal-native-operations-EkrdIN/native-host-qualification-sources/PACKET.json`, SHA `fad405fdfadb5d77eabdd8a14b1a90571552795159bc15642998ad396ce42dff`.

The host phase consumed24.363CPU seconds/182.6MiB peak/swap0 under1CPU/2GiB/128tasks with actual IPv4/IPv6 denial. Its initial scratch-parent setup refusal occurred before any unit; corrected execution finished native0, and all known processes/cgroup/TMP/unit were absent before the actual slot release06:18:53Z. Shared HEAD/index/tracked source and both foreign artifacts were unchanged. Source/type/dependency/client/lock/build/image/security acceptance remains open and the publication guard's reviewed-port ledger/root dependency closure remain empty/null.

Native booking-management source review continues. All production Web cancellation calls use booking UID; the Web schema also accepts numeric ID alone, so a Web-route-local UID guard is being prepared without changing shared cancellation services/APIv2 jobs. The existing seven public procedures include markHostAsNoShow; its native capability/handler semantics are under source review and no noShow request was run. An empty native hashed-embed blob is not counted as an implemented destination. No source task, business operation, notification delivery, entitlement or full-system acceptance is closed. All39 task objects and previous fields are preserved.
