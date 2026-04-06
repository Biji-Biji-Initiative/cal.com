# Repo Baseline — 2026-04-06

Snapshot taken after fork truth & cost stabilization. This is the reference point for future upstream syncs, CI cost reviews, and infrastructure decisions.

---

## Git State

| Property | Value |
|----------|-------|
| HEAD SHA (local main) | `fc37a2cac4702631b9d9959050543d254e8cf48a` |
| origin/main SHA | `e3e06bd6ea6e271358ee317aad45c13c75c1d7eb` |
| upstream/main SHA | `25857c07e1` (feat(bookings): add booking audit logging to instant bookings #28176) |
| Commits behind upstream | 89 |
| Commits ahead of upstream | 50 |
| Local branches | `main` (only) |
| Remote branches (origin) | `origin/main` (only) |

**Note:** Local HEAD is 2 commits ahead of origin/main (ci: add automated upstream sync workflow, ci: migrate fork-owned workflows to ARC self-hosted runners — not yet pushed at snapshot time).

---

## Fork Delta

Files owned or modified by this fork relative to `upstream/main`. These must be preserved on every upstream sync.

### CI / Workflows (fork-added)
- `.github/workflows/env-preflight.yml` — K8s environment preflight check
- `.github/workflows/smoke-check.yml` — Live environment smoke check (manual trigger)
- `.github/workflows/upstream-drift.yml` — Automated upstream drift detection with auto-PR

### Docs (Mereka-specific)
- `Mereka Docs/API_KEY_SETUP_GUIDE.md`
- `Mereka Docs/API_V2_SETUP_GUIDE.md`
- `Mereka Docs/DEPLOYMENT_GUIDE.md`
- `Mereka Docs/ENVIRONMENT_VARIABLES_REFERENCE.md`
- `Mereka Docs/INTEGRATION_SETUP.md`
- `Mereka Docs/LICENSE_SETUP_GUIDE.md`
- `Mereka Docs/README.md`
- `Mereka Docs/WORKING_CONFIG.md`
- `Mereka Docs/deploy-calcom.sh`
- `docs/runbooks/upstream-sync-and-rollout.md`

### Scripts
- `deploy-api-v2.sh` — **STALE**: references GCR/Cloud Run (see Known Stale References)
- `scripts/check-rollout-readiness.sh`
- `scripts/run-release-gate.sh`
- `scripts/smoke-check-calcom.sh`
- `scripts/test-verify-calcom-env.sh`
- `scripts/verify-calcom-env.sh`
- `setup-integrations.sh` — contains 1 GCR reference

### Config / Env Examples
- `calcom-k8s.env.example`
- `calcom.env.example`
- `cloudbuild.yaml` — **STALE**: Cloud Build / GCR (see Known Stale References)
- `env-vars-api-v2.example.yaml`
- `env-vars-production.example.yaml`
- `google-credentials.example.json`

### Fork Meta
- `.gitignore` — extended with fork-specific ignores
- `AGENTS.md` — agent coordination document
- `DEPLOYMENT_GUIDE.md`
- `DEPLOYMENT_README.md`
- `QUICK_START.md`

### App Code (modified)
- `apps/web/public/mereka-logo.png` — branding asset
- `packages/lib/constants.ts` — fork-specific constant overrides

---

## CI State

### Active Workflows (18)

| Name | Path | Runner |
|------|------|--------|
| Create PR containing updated CHANGELOG.md and release packages to NPM once PR is merged | `.github/workflows/changesets.yml` | upstream default |
| (cleanup-report) | `.github/workflows/cleanup-report.yml` | upstream default |
| Delete | `.github/workflows/cleanup.yml` | upstream default |
| Draft release | `.github/workflows/draft-release.yml` | upstream default |
| E2E Report | `.github/workflows/e2e-report.yml` | upstream default |
| Env Preflight | `.github/workflows/env-preflight.yml` | `mereka-k8s-runners` (ARC) |
| Pull Request Labeler | `.github/workflows/labeler.yml` | upstream default |
| (merge-reports) | `.github/workflows/merge-reports.yml` | upstream default |
| Changes Requested | `.github/workflows/on-changes-requested.yml` | upstream default |
| Performance Tests | `.github/workflows/performance-tests.yml` | upstream default |
| Post release | `.github/workflows/post-release.yml` | upstream default |
| (publish-report) | `.github/workflows/publish-report.yml` | upstream default |
| Re-draft | `.github/workflows/re-draft.yml` | upstream default |
| Release Docker | `.github/workflows/release-docker.yaml` | upstream default |
| Run CI | `.github/workflows/run-ci.yml` | upstream default |
| Validate PRs | `.github/workflows/semantic-pull-requests.yml` | upstream default |
| Live Smoke Check | `.github/workflows/smoke-check.yml` | `mereka-k8s-runners` (ARC) |
| Upstream Drift Check | `.github/workflows/upstream-drift.yml` | `mereka-k8s-runners` (ARC) |

Fork-owned workflows (`env-preflight`, `smoke-check`, `upstream-drift`) all target `runs-on: mereka-k8s-runners` (ARC self-hosted, RKE2 nonprod).

### Disabled Workflows (44)

All 44 disabled workflows are upstream-inherited and disabled manually to avoid GitHub-hosted runner spend. This is the primary cost-control lever.

| Name | Path |
|------|------|
| All checks | `.github/workflows/all-checks.yml` |
| Production Builds | `.github/workflows/api-v1-production-build.yml` |
| Production Build | `.github/workflows/api-v2-production-build.yml` |
| API v2 Unit | `.github/workflows/api-v2-unit-tests.yml` |
| Atoms production Build | `.github/workflows/atoms-production-build.yml` |
| cleanup caches by a branch | `.github/workflows/cache-clean.yml` |
| Check API v2 breaking changes | `.github/workflows/check-api-v2-breaking-changes.yml` |
| Check Prisma Migrations | `.github/workflows/check-prisma-migrations.yml` |
| Check types | `.github/workflows/check-types.yml` |
| Cron - bookingReminder | `.github/workflows/cron-bookingReminder.yml` |
| Cron - changeTimeZone | `.github/workflows/cron-changeTimeZone.yml` |
| Cron - checkSmsPrices | `.github/workflows/cron-checkSmsPrices.yml` |
| Cron - downgradeUsers | `.github/workflows/cron-downgradeUsers.yml` |
| Cron - monthlyDigestEmail | `.github/workflows/cron-monthlyDigestEmail.yml` |
| Cron - scheduleEmailReminders | `.github/workflows/cron-scheduleEmailReminders.yml` |
| Cron - scheduleSMSReminders | `.github/workflows/cron-scheduleSMSReminders.yml` |
| Cron - scheduleWhatsappReminders | `.github/workflows/cron-scheduleWhatsappReminders.yml` |
| Cron - mark stale for inactive issues | `.github/workflows/cron-stale-issue.yml` |
| Cron - syncAppMeta | `.github/workflows/cron-syncAppMeta.yml` |
| Cron - webhookTriggers | `.github/workflows/cron-webhooks-triggers.yml` |
| Cubic AI Review Trigger | `.github/workflows/cubic-devin-review-trigger.yml` |
| Cubic feedback addressed by Devin | `.github/workflows/cubic-devin-review.yml` |
| Delete Blacksmith Cache | `.github/workflows/delete-blacksmith-cache.yml` |
| Devin PR Conflict Resolver | `.github/workflows/devin-conflict-resolver.yml` |
| Build (docs) | `.github/workflows/docs-build.yml` |
| Check breaking changes and run E2E | `.github/workflows/e2e-api-v2.yml` |
| E2E App Store Tests | `.github/workflows/e2e-app-store.yml` |
| E2E Atoms | `.github/workflows/e2e-atoms.yml` |
| E2E Embed React tests | `.github/workflows/e2e-embed-react.yml` |
| E2E Embed Core tests | `.github/workflows/e2e-embed.yml` |
| E2E | `.github/workflows/e2e.yml` |
| Run i18n AI automation | `.github/workflows/i18n.yml` |
| Integration | `.github/workflows/integration-tests.yml` |
| Lint | `.github/workflows/lint.yml` |
| Next.js Bundle Analysis Annotation | `.github/workflows/nextjs-bundle-analysis-annotation.yml` |
| Next.js Bundle Analysis | `.github/workflows/nextjs-bundle-analysis.yml` |
| PR Update | `.github/workflows/pr.yml` |
| Production Builds (without database) | `.github/workflows/production-build-without-database.yml` |
| Security Audit | `.github/workflows/security-audit.yml` |
| Setup Database | `.github/workflows/setup-db.yml` |
| Stale Community PR Devin Completion | `.github/workflows/stale-pr-devin-completion.yml` |
| Sync Agents to Devin Knowledge | `.github/workflows/sync-agents-to-devin.yml` |
| Unit | `.github/workflows/unit-tests.yml` |
| Validate Agents Format | `.github/workflows/validate-agents-format.yml` |

### Runner Infrastructure

**Org runners (Biji-Biji-Initiative): 13 total**

| Name | Status | Busy |
|------|--------|------|
| mereka-k8s-heavy-builders-28qm9-runner-62s4r | online | no |
| mereka-k8s-heavy-builders-28qm9-runner-8h7b2 | online | yes |
| mereka-k8s-heavy-builders-28qm9-runner-zk7mw | online | no |
| mereka-k8s-runners-vfwtg-runner-47bxb | online | yes |
| mereka-k8s-runners-vfwtg-runner-bvpb7 | online | yes |
| mereka-k8s-runners-vfwtg-runner-d2xmh | online | yes |
| mereka-k8s-runners-vfwtg-runner-jk2nt | online | yes |
| mereka-k8s-runners-vfwtg-runner-p9zf5 | online | yes |
| mereka-k8s-runners-vfwtg-runner-q6ckk | online | yes |
| mereka-k8s-runners-vfwtg-runner-sprkr | online | yes |
| mereka-k8s-runners-vfwtg-runner-tfslp | offline | no |
| mereka-k8s-runners-vfwtg-runner-xf7lg | online | yes |
| mereka-k8s-runners-vfwtg-runner-zbhst | online | yes |

**Runner pools:**
- `mereka-k8s-runners-*` — standard ARC runners, label `mereka-k8s-runners`, hosted on RKE2 nonprod
- `mereka-k8s-heavy-builders-*` — larger ARC runners, label `mereka-k8s-heavy-builders`, hosted on RKE2 nonprod

**Runner groups (org-level):**

| ID | Name | Visibility |
|----|------|------------|
| 1 | Default | all |
| 3 | Default Larger Runners | all |
| 4 | Mereka Web | all |
| 5 | heavy-builders | all |

All groups have `allows_public_repositories=false`. No GitHub-hosted runners are used by fork-owned workflows.

---

## Branch Protection

**main is UNPROTECTED as of 2026-04-06.**

`GET /repos/Biji-Biji-Initiative/cal.com/branches/main/protection` returns HTTP 404 (`Branch not protected`).

`GET /repos/Biji-Biji-Initiative/cal.com/rulesets` returns `[]` (no rulesets configured).

This means direct pushes to main are permitted. Force-push protection is not enforced at the GitHub level. This is a known gap — protection rules should be added before the repo has multiple active contributors.

---

## Production Topology

- **Prod**: RKE2 prod cluster (`rke2-prod` kubectl context)
- **Staging**: RKE2 nonprod cluster (`rke2-nonprod` kubectl context); also hosts CI runners
- **GKE**: Decommissioning — stale references remain in several scripts (see Known Stale References below)
- **Known blocker**: `api-v2.cal.mereka.io` TLS handshake failure — tracked separately, not resolved in today's work

---

## Authoritative Repos

| Concern | Repo |
|---------|------|
| App behavior | `Biji-Biji-Initiative/cal.com` (this repo) |
| Environment config / K8s overlays | `bbi-infrastructure` |
| Ingress / domain / TLS | `bbi-infrastructure` |
| Runner infrastructure (ARC) | `bbi-infrastructure` |
| Control plane / tenant truth | `platform-control-plane` |

---

## Known Stale References

These files still contain GKE, Cloud Run, Cloud Build, or GCR references. They are fork-owned and can be corrected in a future cleanup pass — they do not affect the running system but are misleading.

| File | Reference type | Count |
|------|---------------|-------|
| `cloudbuild.yaml` | Cloud Build / GCR | 6 |
| `deploy-api-v2.sh` | GCR / Cloud Run / GKE | 10 |
| `setup-integrations.sh` | GCR | 1 |

**Action:** These files should be either deleted (if superseded by K8s deployment manifests in `bbi-infrastructure`) or updated to reflect the RKE2 deployment topology in a future PR.

---

## Changes Made Today (2026-04-06)

Summary of stabilization work committed to `origin/main` on this date:

1. **ci: migrate fork-owned workflows to ARC self-hosted runners** (`69526e4e55`)
   - `env-preflight.yml`, `smoke-check.yml`, `upstream-drift.yml` all changed from `ubuntu-latest` (GitHub-hosted) to `mereka-k8s-runners` (ARC self-hosted on RKE2 nonprod)
   - Eliminates GitHub Actions minutes spend for fork-owned CI

2. **ci: add automated upstream sync workflow with auto-PR creation** (`fc37a2cac4`)
   - `upstream-drift.yml` now creates a PR automatically when drift is detected
   - Runs on `mereka-k8s-runners`

3. **docs: consolidate fork documentation into docs/mereka/** (`ad260bc187`)
   - Moved scattered Mereka-specific docs into a single canonical location

4. **docs: remove old scattered doc locations** (`07b379c74e`)
   - Cleaned up previously consolidated docs from their old paths

5. **chore: add fork-specific entries to .gitignore** (`e3e06bd6ea`)

6. **docs: update AGENTS.md with correct tooling and automation references** (`90e4deb4b6`)

Prior work this session (earlier commits, not today's date but part of the same stabilization track):
- Release gate scripts and smoke check infrastructure (`feat(release-gate)`)
- Runbook additions for api-v2 TLS blocker, Kyverno replica failure, Authentik/Google probe
- Deploy script hardening

---

*Snapshot generated: 2026-04-06. Commands run against `Biji-Biji-Initiative/cal.com` via `gh` CLI and local git.*
