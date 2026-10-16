# Runtime dependency remediation and matched image acceptance

Date: 16 October 2026 (Pacific/Guadalcanal). Existing repository
`Biji-Biji-Initiative/cal.com`, branch `work/cal-diy-enterprise-20261010`.
Application source **`e3a79afbffc3d81973d6f299a59e154f154d7cf8`**. This is a release-security slice under the
original graph, not a new repository, product, identity directory or deployment.

## Outcome

The identical scanner executable and vulnerability database report **113 to
56 HIGH package/advisory occurrences** between the old and new actual
runtime images. Both scans completed. The candidate retains **zero CRITICAL and
zero detected secrets**. Remaining HIGH findings are explicitly unresolved in
[the per-occurrence ledger](RUNTIME-SECURITY-REMAINING-2026-10-16.json); no finding
is waived by a lower total or by a zero-critical floor.

| Runtime filesystem surface | Baseline HIGH | Candidate HIGH |
| --- | ---: | ---: |
| Application and packaged migration dependencies | 59 | 13 |
| Unused global package-manager tools | 11 | 0 |
| Base operating-system packages | 43 | 43 |

Counts are scanner occurrences across installed packages and copies, not counts
of distinct exploitable endpoints. No deployed service or real account was
scanned invasively or changed. The [machine-readable receipt](RUNTIME-SECURITY-RECEIPT-2026-10-16.json)
records source, lock, build, image, scanner/data identities and raw evidence hashes.

## Repairs on the retained implementation

The existing patch/minor dependency lines are updated for Axios, form-data,
xmldom, Effect, Kysely, linkify-it, nanoid 3, PostCSS, source-map-js, Vite 6,
WebSocket 7/8, brace-expansion 1/2/5, and the shipping Next 16.3 patch. Exact
versions and integrity hashes are in the source lock. Separate major families
remain separate; no global Next or nanoid major override is used to mask
compatibility work. Complete before/after lock-line inventories are retained in
the receipt; this does not claim unrelated desktop/ancillary applications have
been built. No new application dependency or schema is introduced.

A concrete original-library control schedules 64 separate AsyncLocalStorage
contexts through Effect. The installed predecessor returns context 0 for all
64 continuations; the patched 3.20.0 library preserves contexts 0 through 63
with the same code. This demonstrates the dependency defect and correction,
**not a demonstrated live Cal account leak** or completion of the route audit.
The upstream diagnosis and fix are documented in the maintainer advisory
GHSA-38f7-945m-qr2g:
https://github.com/Effect-TS/effect/security/advisories/GHSA-38f7-945m-qr2g.

The final Docker runtime no longer exposes global npm/npx, Corepack or Yarn.
The actual entrypoint invokes Node and its packaged migration CLI directly.
Both old and new image filesystems were read: the baseline has all eight named
tool paths, the candidate has none. Host tooling is untouched. This is removal
of unused runtime executables/dependency trees, not deletion of scanner metadata.
The immutable base layer history is not erased and image-size reduction is not
claimed. The new image still runs as UID 1000 with a read-only root filesystem.

## Native verification, not just a version change

**22 dependency contracts** pass: every inspected major/minor line has nonempty
locked coverage above its reviewed advisory floor; real concurrent Effect context,
HTTP JSON/multipart/response limits, XML namespaces, links, identifiers and stylesheets
operate. The first updated run caught an additional exact xmldom 0.9.9 descriptor;
that lock entry was fixed and rerun before publication. **592 registered source
regressions** pass with zero failures/skips. They retain their individual source,
loopback and fixture scopes rather than implying 592 production journeys.

The current immutable install, generators, complete native tRPC/web types and
optimized Next build pass. The nine retained assembled browser journeys and the
additional fresh accepted-member onboarding invocation pass on one compiled
loopback build. Real native sessions/database services execute; TLS test identity,
non-relaying SMTP and intercepted external calendar traffic are explicit bounds.
No inherited IdP, permission or timeout requirement is weakened.

Native platform libraries and the API are compiled from the same source. Its
actual main/AppModule runtime passes with isolated PostgreSQL and Redis, including
native cookie/key admission, old-key/revoked-cookie rejection and transactional
audit. This is compiled API acceptance, not a new deployed or separately packaged
API image.

The separate public-origin image is built for **https://cal.mereka.dev**:

- Source: `e3a79afbffc3d81973d6f299a59e154f154d7cf8`
- Local image/index: `sha256:0b3f92174bcb45eb7b7cdda0a23b98dc3262f13d342efc22103d36dd1dd4d4aa`
- Build ID: `U--758br0OIRu3tLFI7z8`
- Image lock: `a1ad9263848c7edc8cead0ec3ee1ea1577b813d0845171a78b6273d1908daa7e`
- Applied empty-fixture migrations: **596**, followed by successful replay.

Non-root/read-only container checks prove the direct migration CLI still works
without global installers, the correct native HTTPS callback/login is rendered,
no loopback origin or fixture-secret leaks into the response, and an anonymous
caller remains unauthenticated. An empty-database replay is **not historical-data
migration, restore, live identity acceptance or release permission**.

The current dev GitOps overlay still explicitly runs `exec yarn start` for the
legacy image. Its pinned source/command identity is retained in the receipt.
The intentional old-command probe on the new local image exits 127 (Yarn absent),
while the image's native entrypoint and direct migration commands pass. This is
an explicit **cutover dependency, not drop-in image compatibility**: the approved
native deployment must use its native entrypoint and admitted database/configuration,
not carry over the legacy command. No live command override was changed here.

The actual image manifest, source/entrypoint/preflight hashes and shipped versions
were read back from the image. The build was not relabeled from a localhost origin
or assigned the later documentation commit. The exact image is **local only**, not
a registry digest, a live preview, or the application currently serving a domain.

## Security evidence and remaining work

The comparison requires both real OS and Node installed-package inventories and
identifies the actual Next/Axios/Effect application copies plus Prisma/Effect in
the migration tools. Nine controlled checks reject missing/empty analysis,
incorrect versions, duplicate OS identity, missing operations dependencies and
relabeling the old scan as the new candidate. The scanner ignores no advisory
file. This prevents an empty or partially analyzed image from masquerading as
an improvement. Actual inventory counts and required versions are in the receipt.

The matched comparison uses Trivy 0.75.0; its executable hash matches the binary
inside the previously verified release archive. Both image IDs are verified from
scan metadata; the database hash is checked before/after each scan with updates
disabled. No stale/failed/empty scan is counted as success. Database SHA-256:
`32c6ed2327c56930f4814c2f243bcdbf54fe4b6b42d85533e53d0a02ebe36e4d`.

Candidate severity counts: `{"HIGH": 56, "LOW": 63, "MEDIUM": 103, "UNKNOWN": 3}`.
Remaining application/migration HIGH package families: **@trigger.dev/core, deepmerge-ts, nanoid, nodemailer, sharp**.
Their compatibility upgrades and specific caller tests remain required. Base OS
entries without a fixed version in this database are not thereby harmless; retain
actual exposure/distribution review rather than deleting package metadata or
claiming unavailable fixes are applied. The ledger gives exact package, advisory,
path and available fix for each remaining occurrence.

Gitleaks passes the selected source/config/test inputs at its normal scan scope;
lock integrity is separately enforced by Yarn. UBS has zero critical findings
on the new tests, with seven unsuppressed synchronous-file/JSON parsing warnings
and 17 information findings. These are one-shot test input reads, not a new server
request handler. Existing compiler/export/peer/deprecation warnings remain visible.
An initial verifier lacked the repository's root binary directory and exited 127;
adding the existing directory to that verifier's PATH yielded the actual full
web type pass without changing application dependencies or suppressing diagnostics.

## Why publication is still a real prerequisite

The personal source-writing credential lacks the required package capability.
More importantly, fresh GitHub provider reads found **no currently admitted
runner for this public Cal repository**. The detailed private runner-group
inventory remains in operator evidence and the existing CI/CD owner's thread,
not this application repository. An enabled workflow that declares
`packages: write` does not prove an eligible executor. The inherited Build Fork Image still builds the old Dockerfile
with placeholder origins. It was not dispatched or granted broader trust.

The existing infrastructure release-asset mirror was inspected rather than
assuming no reusable route exists. Its declared scope is withdrawn upstream
images recovered from node caches and its target is restricted to `mirror/*`.
A newly built Cal application image is not that contract; no relabeling, substitute
credential, private-runner bypass or new repository was used to force publication.
The current provider evidence and required owner action were delivered on the
existing team-skills#960 thread, comment 6203663583. The unrelated private runner
and workflow inventory is not republished in this public application repository.

Native identity remains a separate controlled cutover: the current registry
still describes the legacy forward-auth product, while existing-account linking
and organization provisioning do not create the first login account. The intended
Authentik-only policy deliberately rejects public password/bootstrap routes.
Do not temporarily weaken that policy or seed an existing deployment to create a
successful screenshot. The admitted native client, test-account provisioning,
isolated database, guest routing and preservation evidence must precede preview.

## Graph and handoff

All original 39 nodes, requirements, states and dependencies are preserved. The
graph remains **12 of 29 executable tasks complete; 17 remaining**. This wave
strengthens the build/API/runtime security evidence but does not invent a closed
preview task or claim an upstream Cal.diy update rehearsal from dependency bumps.
Publication must return a real immutable registry digest; deployment must then
prove serving identity/configuration and the actual staff-to-guest journey.
The ten web fixtures and the API fixture each record PostgreSQL shutdown, with
their owned data directories absent afterward. The final image test's exact
container/network IDs are independently absent, its database stopped and was
removed, and the verification ports are released. Both old/new images and the
prepared context are intentionally retained; unrelated resources are untouched.
No production, main, domain, historical database, provider account, credential
scope or live Authentik configuration changed.

Reproduce the source contracts with `yarn test:community-enterprise` and the
registered native PostgreSQL/browser/API runners. Use the correct built origin
for each fixture. Exact commands and outcomes are in the receipt; raw detailed
reports remain at `/data/tmp/cal-delivery-next-20261016-i1k_6lbn` on g2.

Agent: ChatGPT-CalDeliverySecurity-20261016
