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
