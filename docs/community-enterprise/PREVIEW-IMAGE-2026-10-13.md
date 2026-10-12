# Public-origin preview image: execution checkpoint

Date: 2026-10-13 (Pacific/Guadalcanal).
Compiled application source: `68a952ba52be9359d4bc87e4306e9d31b15d78e0`.
Status: public-origin web build passed; corrected container acceptance is UNKNOWN.
No registry publication, shared preview deployment or production promotion occurred.
This document is a recovery checkpoint, not an image-release receipt.

## Verified result

The exact candidate was installed and built for:

`https://cal-enterprise.mereka.dev`

The immutable installation, Prisma generation, app-store registry generation,
native tRPC build, static-asset copy and optimized standalone Next build each
returned exit zero. The Next build completed its full TypeScript check. No
application dependency or lockfile was upgraded and no live database was used.
Temporary build secrets and the unreachable fixture database URL were not recorded
in Git. This is a public-origin build, unlike the earlier localhost test artifacts.

Build ID: `cTHXRbQKRYcSve-OLRzTh`.
Build-manifest SHA-256:
`28d2cef8ca25f4ede46599b41f95fc0740225081747a8787161d12c2d47e92d7`.
Unchanged lockfile SHA-256:
`6c0963bd717b67e646216719c7c84f5a7d09da9cd76b8c0e916377549b98b828`.

The recorded build receipt is on the authorized coding machine:
`/data/tmp/gurpreet-cal-deploy-20261013/build-receipt.json`.
The release-build worktree is:
`/home/gurpreet/projects/cal.com-public-preview-20261013`.
It is detached at the compiled source above; the later GitHub checkpoint commit
must not be confused with a new application build.

## Packaging work present on the coding machine

The following new files were written in that release-build worktree but had NOT
been published or finally read back after the connection failure:

- `Dockerfile.enterprise-preview`
- `scripts/enterprise-runtime-entrypoint.cjs`
- `scripts/prepare-enterprise-runtime.cjs`
- `scripts/retain-enterprise-notices.cjs`
- `scripts/publish-enterprise-image.py`
- `.github/workflows/build-fork-image.yml`
- `tests/community-enterprise/runtime-package.test.cjs`
- `tests/community-enterprise/test_enterprise_publisher.py`

Do not reconstruct or overwrite them blindly; inspect the actual preserved files.
The runtime package has separate web and explicit migration modes. Web startup
never implicitly migrates the database. It checks the built HTTPS origin, native
callback, required identity configuration and runtime keys. The migration mode
requires one explicitly named database and matching direct/regular URLs.

The Docker runtime runs as UID/GID 1000. The acceptance runner uses read-only
rootfs, dropped capabilities, no-new-privileges, bounded temporary mounts and a
private disposable PostgreSQL database. The migration operation has no network
connection and uses only a private Unix socket. The web smoke uses an isolated
internal Docker network and a localhost-bound port. It does not connect to live
Authentik or send mail.

Twelve packaging/preflight tests passed, including a previously missing negative
for a mismatched direct migration URL. Five publisher-input tests passed. These
are bounded helper tests, not complete container or release acceptance.

The package traces the installed Prisma migration CLI, carries its schema and
migration history, rejects environment/Git data and escaping symlinks, and retains
the application license and dependency notices. A diagnostic package copied 760
notice/license files. Its 743-file migration trace had three warnings involving
xdg-open parsing and an optional generator path; they must not be dismissed without
successfully exercising the actual migration operation.

## Real container failure and attempted correction

The first container migration test failed before applying migrations. Node's slim
image had no OS OpenSSL libraries. Prisma selected openssl-1.1 and could not find
the matching schema-engine binary. Inspection also found that the root hoisted
`@prisma/engines` was 6.16.2 with no binary, whereas the actual Prisma 6.16.1 CLI
resolved its own nested 6.16.1 engine with the openssl-3.0 binary.

The corrected packaging source resolves the engine relative to the CLI, verifies
its version, and copies that actual engine. The Docker recipe adds exact package
versions observed in Debian's signed bookworm-security metadata:

- openssl and libssl3: `3.0.22-1~deb12u1`.
- ca-certificates: `20250419~deb12u1`.

The base is pinned to:
`node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`.
The package installation ran only during the container build, not on the host or
at pod startup. The corrected build log showed those packages installed and the
standalone copy progressing before remote access stopped returning results.

**The corrected image ID and final migration/web result have not been verified.**
The earlier diagnostic image
`sha256:8c8bf51ee55cf2d292fcbfb8fe22b423da04e2175f78ec0015211624a419c7ff`
FAILED migration and must not be promoted or represented as the corrected image.

The final launched wrapper was PID 3577452. It ran `fix_engine_closure.py`, formatted
the producer, ran `rebuild_ssl_image.py`, then `verify_container.py` in the task
scratch directory. First inspect process identity and these receipts; do not
restart an operation that is still running:

- `image-receipt.json`, `image-ssl-build.log`.
- `container-test.json`, `image-migration.log`, `image-migration-replay.log`.
- `image-web-log.log` and owned container/network state.

The container test must apply the full migration history to a fresh database,
replay it with no pending changes, then run the non-root/read-only web smoke.
A Prisma `db push` run is not a substitute for that acceptance check. Earlier
failed receipts are retained under `before-ssl-*` for comparison.

## Scanner and publication boundary

Trivy 0.75.0 was downloaded into task-owned scratch and its immutable upstream
archive digest verified:
`c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f`.
No host installation or production tool setting was changed.

`scan_image.py` is prepared but had NOT been run against a verified corrected
image. Therefore there is no image vulnerability or secret-scan PASS. It writes
raw findings privately and a value-free exact-image summary; do not expose secret
matches in a transcript or Git.

The operator's current GitHub credential has no package-publishing scope. Do not
widen it or repurpose the read-only GHCR pull credential. The existing
`Build Fork Image` workflow, ID 256866796, has repository-scoped packages:write.
The uncommitted candidate packaging restores that workflow with a checked prebuilt
publication mode, retaining its existing runner class. This is publication only,
not a new CI execution system or runner-sizing change.

The proposed publisher requires exact source/archive/image identity, fresh image
scan evidence, non-root metadata, matching recipe hashes and a versioned tag. It
refuses conflicting existing tags. It was not dispatched, no prerelease/archive
was uploaded, and no GHCR digest has been read back. Inspect/test that source and
its actual runner prerequisites before use. Its helper tests alone do not prove
end-to-end publication.

## Shared preview and coordination blockers

A fresh read-only nonproduction check found no `calcom-enterprise-dev` namespace.
Existing Cal dev/staging web/API workloads were parked, with retained databases.
They were not repurposed. The proposed public name resolves through Cloudflare,
but wildcard resolution is not deployed-ingress or domain-ownership acceptance.

The current storage report found usable-looking worker headroom, but also incomplete
coverage unrelated to this app. This does not admit a new PVC or prove a combined
placement. Fresh resource/storage admission is still required before provisioning.

The new dev Infisical path `/k8s/calcom-enterprise` was absent. No new secret values,
existing credential changes or live Authentik provider changes were made. No empty
first-user setup screen should be exposed before controlled bootstrap and reviewed
real account mapping. Local protocol tests are not real MFA/SCIM/revocation proof.

The mandatory public Agent Mail session request returned Cloudflare HTTP 403,
error 1010 `browser_signature_banned`, at 2026-10-12T20:39:51Z, ray
`a498ea90acfefdf4`, retryable=false and owner_action_required=true. The response
explicitly said not to retry. No user-agent spoofing, local-hub alternate path,
WAF change or fabricated identity/reservation was used. The blocker is recorded
for the programme owner in team-skills#960, comment 6132392107. Infrastructure
source publication and managed runtime changes were not attempted without the
required coordination.

The original shared infrastructure checkout was clean apart from a preserved
untracked tracker lock and was locally fast-forwarded to its current remote main
`3e3afb32f9d1d72daf401419188215bbc27e39ca`. That is not a new commit, push or deploy.
The original Cal main and its unrelated unfinished edits were not changed.

## Connection-loss recovery and next executable actions

Desktop Commander stopped returning results from the build device. The known
read call `1c002802-62d8-4dee-9f8b-b96ed5a3bb31` failed with no device response.
Attempts to use the other authorized connected machines did not produce a working
terminal either. This is distinct from the explicit Agent Mail access denial.
Do not claim worktree cleanup, test-server termination or final image status after
the loss of access; those postconditions have not been checked.

1. Restore normal authorized access to the build device and inspect the exact
   owned process, receipts, Docker objects and source state. Preserve existing
   artifacts; do not restart a migration or build blindly.
2. Complete the corrected container migration/replay/startup proof. Then scan that
   exact image. Resolve findings or retain the release block; do not weaken gates.
3. Review and publish the preserved packaging files, create the versioned candidate
   artifact, execute the existing publisher and read back its GHCR digest.
4. After the public coordination owner restores the supported route, reserve the
   shared paths and commit the isolated preview/secret/identity configuration via
   existing GitOps. Preserve the parked databases and production unchanged.
5. Admit storage/resources, bootstrap without public first-user exposure, and use
   the reviewed identity-link workflow for real preview mappings. Run the real
   Authentik-to-team-booking acceptance before staff rollout.
6. Archive exact source/image/test receipts and remove the owned build worktree
   and test-only resources only after their identities and completed state are
   confirmed. Do not touch other agents' edits or shared runtime resources.

CAL-02.PREVIEW and the overall enterprise programme remain OPEN. API v2, identity
lifecycle/60-second revocation, remaining scheduling write paths, external provider
acceptance, migration/restore and production gates are not closed by this build.
