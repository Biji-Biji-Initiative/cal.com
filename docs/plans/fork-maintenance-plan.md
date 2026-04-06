# Cal.com Fork Maintenance Plan

**Date**: 2026-04-06
**Repo**: Biji-Biji-Initiative/cal.com
**Branch**: `main` (at `c22629b9cd`, synced with `origin/main`)
**Status**: 89 commits behind `upstream/main`, no open PRs, no active work

---

## 1. Current State Summary

### Git State

| Metric | Value |
|--------|-------|
| Fork behind upstream | **89 commits** (last sync: March 4) |
| Fork-specific commits | 40 non-merge commits on `origin/main` |
| Actual code conflict surface | **1 file** (`packages/lib/constants.ts` - 2 logo lines) |
| Fork-only files | 33 files (all additive - scripts, docs, branding, CI) |
| Stale branches | 4 (`reconcile/*`, `g-branch`, `hardening/*`, `upgrade/*`) |
| PR #4 (last reconciliation) | Closed without merge (March 27) |

### CI/Cost State

| Problem | Impact |
|---------|--------|
| 11 cron workflows on `ubuntu-latest` (GitHub-hosted) | ~**16,560 min/month** (free tier: 2,000) |
| 2 cron workflows fire **every minute** (`checkSmsPrices`, `webhookTriggers`) | ~14,400 min/month alone |
| All crons have no secrets configured | Jobs spin up, hit the `if:` guard, skip, but still bill runner time |
| 32 workflows use Blacksmith runners (upstream's paid service) | Won't run without Blacksmith account, but attempt and fail |
| 0 workflows use ARC runners | ARC is deployed, online (19 runners), and unused by this repo |
| 6 Devin-specific workflows inherited from upstream | Unnecessary for our fork |

### Infrastructure State

| Item | Status |
|------|--------|
| ARC runners (`mereka-k8s-runners`) | **Online**, 17/19 busy (serving other repos), rke2-nonprod |
| ARC heavy builders (`mereka-k8s-heavy-builders`) | **Online**, 2 runners, rke2-nonprod |
| Runner groups | `Default` (visibility: all) + `heavy-builders` (visibility: all) |
| cal.com repo-level runners | 0 (relies on org-level ARC) |
| Production environment | **RKE2 prod** (not GKE - GKE references are stale) |

### Validation Tooling (preserve as-is)

The fork has a well-built three-layer deployment safety net (~920 lines):

1. **Env Preflight** - validates env files for dev/staging/prod against required key lists, profile-aware (web vs api-v2), CI-enforced
2. **Live Smoke Checks** - hits deployed endpoints (web, auth, Google login, Authentik SSO), includes DNS/TLS diagnostics on failure
3. **Release Gate** - orchestrates preflight + smoke into single go/no-go, supports `--skip-api-v2` for web-only rollouts

This tooling correctly separates "can we deploy?" from "did the deploy work?" and should be preserved unchanged.

---

## 2. Work Plan

### Phase 1: Stop the Bleeding (CI Cost)

**Goal**: Eliminate wasted GitHub Actions minutes immediately.

#### 1A. Disable cron workflows that have no secrets configured

These workflows spin up a runner, check `if: ${{ env.APP_URL && env.CRON_API_KEY }}`, skip, and exit. The runner startup still bills minutes. With no secrets configured on the fork, every run is a no-op.

**Workflows to disable** (11 files):

| Workflow | Schedule | Est. runs/month | Action |
|----------|----------|-----------------|--------|
| `cron-checkSmsPrices.yml` | `* * * * *` | 43,200 | Disable |
| `cron-webhooks-triggers.yml` | `* * * * *` | 43,200 | Disable |
| `cron-bookingReminder.yml` | `*/15 * * * *` | 2,880 | Disable |
| `cron-scheduleEmailReminders.yml` | `*/15 * * * *` | 2,880 | Disable |
| `cron-scheduleSMSReminders.yml` | `*/15 * * * *` | 2,880 | Disable |
| `cron-scheduleWhatsappReminders.yml` | `*/15 * * * *` | 2,880 | Disable |
| `cron-changeTimeZone.yml` | `0 * * * *` | 720 | Disable |
| `cron-stale-issue.yml` | `0 0 * * *` | 30 | Disable |
| `cron-downgradeUsers.yml` | `0 0 1 * *` | 1 | Disable |
| `cron-monthlyDigestEmail.yml` | Monthly | 1 | Disable |
| `cron-syncAppMeta.yml` | `0 0 1 * *` | 1 | Disable |

**Method**: Use the GitHub API to disable each workflow rather than deleting the files (preserves upstream compatibility for future syncs):

```bash
gh api -X PUT repos/Biji-Biji-Initiative/cal.com/actions/workflows/{id}/disable
```

**Estimated savings**: ~16,500 min/month of GitHub-hosted runner time.

#### 1B. Disable Devin-specific workflows

These are upstream's AI code review integrations. They serve no purpose on our fork.

| Workflow | Trigger |
|----------|---------|
| `cubic-devin-review.yml` | workflow_call |
| `cubic-devin-review-trigger.yml` | pull_request_review |
| `devin-conflict-resolver.yml` | pull_request_target |
| `stale-pr-devin-completion.yml` | pull_request_target |
| `sync-agents-to-devin.yml` | push to main |
| `validate-agents-format.yml` | push/PR |

**Method**: Disable via API (same as 1A).

#### 1C. Disable Blacksmith-dependent workflows

32 workflows reference `blacksmith-2vcpu-ubuntu-2404` or `blacksmith-4vcpu-ubuntu-2404`. Without a Blacksmith account, these either fail or fall back to GitHub-hosted runners (billing more minutes). They should be disabled until Phase 2 migrates them to ARC.

**Method**: Disable via API. These get re-enabled after Phase 2 rewrites them to use ARC runners.

---

### Phase 2: Migrate CI to ARC Runners

**Goal**: All workflows that should run on the fork use ARC self-hosted runners at zero GitHub Actions minute cost.

#### 2A. Classify workflows into 3 buckets

| Bucket | Description | Runner | Count |
|--------|-------------|--------|-------|
| **Run on ARC** | Fork-owned + needed upstream workflows (lint, type-check, build, tests) | `mereka-k8s-runners` or `mereka-k8s-heavy-builders` | TBD |
| **Disable permanently** | Upstream-specific (Devin, Blacksmith cache, Cubic, crons without secrets) | N/A | ~17 |
| **Defer** | E2E, atoms, embed tests - enable when/if needed | Disabled | ~10 |

#### 2B. Migrate fork-owned workflows first (3 files)

| Workflow | Current | Target |
|----------|---------|--------|
| `env-preflight.yml` | `ubuntu-latest` | `mereka-k8s-runners` |
| `smoke-check.yml` | `ubuntu-latest` | `mereka-k8s-runners` |
| `upstream-drift.yml` | `ubuntu-latest` | `mereka-k8s-runners` |

These are low-risk, fully under our control.

#### 2C. Migrate core upstream workflows (per ARC migration skill)

Following the `arc-ci-migration` skill checklist for each workflow:

1. Replace `runs-on: ubuntu-latest` / `blacksmith-*` with `mereka-k8s-runners`
2. Replace Docker build jobs with `mereka-k8s-heavy-builders`
3. Remove `actions/cache` steps and `cache:` params from `setup-node`
4. Pin third-party actions to SHA
5. Add `timeout-minutes:` to every job (30 standard, 45 heavy)
6. Add `permissions:` block (minimum `contents: read`)
7. Add `concurrency:` block to PR-triggered workflows

**Priority order** (by value to the fork):

| Priority | Workflow | Why |
|----------|----------|-----|
| 1 | `check-types.yml` | Type checking is the primary quality gate |
| 2 | `lint.yml` | Catches formatting/style issues |
| 3 | `unit-tests.yml` | Core test suite |
| 4 | `check-prisma-migrations.yml` | Catches migration issues after upstream sync |
| 5 | `production-build-without-database.yml` | Validates build works |
| 6 | `api-v2-unit-tests.yml` | API test coverage |
| 7 | `integration-tests.yml` | Integration coverage |
| 8 | `security-audit.yml` | Security scanning |

#### 2D. Verify with policy script

```bash
./scripts/qa/verify-selfhosted-ci-policy.sh  # Must exit 0
```

---

### Phase 3: Upstream Sync Automation

**Goal**: Upstream merges happen automatically with the existing validation tooling as the safety net.

#### 3A. Upgrade `upstream-drift.yml` to auto-sync

Current behavior: detects drift weekly, fails CI. Does not act.

New behavior:

```
Weekly (Monday 06:00 UTC):
  1. Fetch upstream/main
  2. Attempt merge into a new branch (sync/upstream-YYYY-MM-DD)
  3. If clean merge:
     → Open PR automatically
     → env-preflight CI runs on the PR (existing)
     → Label for human review + merge
  4. If conflict:
     → Open PR with conflict markers noted in body
     → Assign for manual resolution
     → Post expected conflict files
```

This preserves human review while eliminating the manual branch creation and merge work. The existing env-preflight CI runs automatically on the PR, validating env templates haven't drifted.

After merge + deploy, the existing smoke-check workflow can be dispatched to validate the live environment.

#### 3B. Document the sync → deploy → validate flow

Update `docs/runbooks/upstream-sync-and-rollout.md` to reflect:

1. Auto-sync PR opens weekly (or on drift detection)
2. Human reviews and merges
3. Deploy pipeline runs (build image → push → ArgoCD sync to rke2-prod)
4. Run smoke checks: `scripts/smoke-check-calcom.sh --web-url <url> --check-google --check-sso`
5. If smoke fails → rollback image tag, investigate

---

### Phase 4: Repo Hygiene

**Goal**: Clean working tree, accurate docs, no dead weight.

#### 4A. Fix .gitignore

Add entries for local symlinks and artifacts that pollute `git status`:

```gitignore
# Local development symlinks
infrastructure
platform-control-plane

# Beads issue tracker (local)
.beads/

# Stale artifacts
20m

# Template files (tracked elsewhere)
docs/adrs/
specs/_TEMPLATE.md
docs/runbooks/_TEMPLATE.md
```

#### 4B. Delete stale branches

| Branch | Reason |
|--------|--------|
| `reconcile/upstream-main-2026-03-05` | PR #4 closed without merge; triaged in 4C |
| `upgrade/upstream-main-sync-2026-03-04` | Predecessor to reconcile branch, fully merged |
| `g-branch` | Unknown purpose, stale |
| `hardening/upstream-security-seq` | Merged into main |

#### 4C. Triage reconcile branch commits

The 19 commits on `reconcile/upstream-main-2026-03-05` that never merged:

| Commit | Content | Verdict |
|--------|---------|---------|
| `14eceb02b6` | Fix calendar subscription route mocks | Cherry-pick if tests still fail |
| `d4784529d2` | Runbook status update | Stale, skip |
| `c8fb614409` | Merge upstream/main | Superseded by Phase 3 |
| `658e65be4d` | Fix webhook triggers OpenAPI type | Already in upstream, skip |
| `e2add3f2c9` | Enable Microsoft sign ups | Already in upstream, skip |
| Remaining | Runbook docs, smoke tooling, release gates | Already on `origin/main`, skip |

**Likely result**: 0-1 cherry-picks needed. Most was already merged or is now in upstream.

#### 4D. Update AGENTS.md

Fix stale/incorrect information:

| Field | Current | Correct |
|-------|---------|---------|
| Last sync | 2026-03-01 | Will be dynamic via auto-sync |
| Sync frequency | Monthly | Weekly (automated) |
| Node version | 18.x or 20.x | Check actual `.node-version` or `engines` |
| Package manager | pnpm | yarn (monorepo uses yarn workspaces) |
| Platform | `{UPDATE: GKE/VPS}` | RKE2 prod cluster |
| Core Commands | pnpm everywhere | yarn everywhere |

#### 4E. Consolidate fork docs

Move scattered root-level docs into `docs/mereka/`:

```
docs/mereka/
  deployment-guide.md     ← merge DEPLOYMENT_GUIDE.md + DEPLOYMENT_README.md + QUICK_START.md
  api-setup.md            ← merge Mereka Docs/API_KEY_SETUP_GUIDE.md + API_V2_SETUP_GUIDE.md
  env-reference.md        ← Mereka Docs/ENVIRONMENT_VARIABLES_REFERENCE.md
  integration-setup.md    ← Mereka Docs/INTEGRATION_SETUP.md + setup-integrations.sh docs
  license-setup.md        ← Mereka Docs/LICENSE_SETUP_GUIDE.md
```

Remove `Mereka Docs/` directory (space in name is a shell-quoting hazard).

---

## 3. Execution Order

| Step | Phase | Description | Risk | Dependencies |
|------|-------|-------------|------|-------------|
| 1 | 1A | Disable no-op cron workflows via API | **None** (no secrets = already no-ops) | - |
| 2 | 1B | Disable Devin workflows via API | None | - |
| 3 | 1C | Disable Blacksmith workflows via API | Blocks PR CI until Phase 2 | - |
| 4 | 4A | Fix .gitignore | None | - |
| 5 | 4B | Delete stale branches | None | 4C triage first |
| 6 | 4C | Triage reconcile branch | None | - |
| 7 | 2B | Migrate 3 fork-owned workflows to ARC | Low | ARC runners online |
| 8 | 2C | Migrate priority upstream workflows to ARC | Medium (test on branch) | Step 7 validates ARC works |
| 9 | 3A | Build auto-sync workflow | Low | - |
| 10 | 3A | Run first auto-sync (merge 89 upstream commits) | Low (1-file trivial conflict) | Step 9 |
| 11 | 4D | Update AGENTS.md | None | Step 10 (reflects new state) |
| 12 | 4E | Consolidate docs | None | Step 10 |
| 13 | 2D | Verify all CI with policy script | None | Step 8 |

Steps 1-6 can run in parallel. Steps 7-8 are sequential. Steps 9-12 can run in parallel after 8.

---

## 4. What We're NOT Changing

- **Validation scripts** (`verify-calcom-env.sh`, `check-rollout-readiness.sh`, `smoke-check-calcom.sh`, `run-release-gate.sh`) - well-built, proven, kept as-is
- **Fork branding** (logo in constants.ts, mereka-logo.png) - the only upstream code modification, trivial to maintain
- **Env templates** (calcom.env.example, env-vars-*.yaml) - deployment infrastructure, kept as-is
- **Deploy scripts** (deploy-api-v2.sh, cloudbuild.yaml) - operational tooling, review later if GKE→RKE2 migration changes them

---

## 5. Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| GitHub Actions minutes/month | ~16,560 | < 100 (only fork-owned + triggered) |
| Upstream drift | 89 commits, 33 days | < 7 days (weekly auto-sync) |
| `git status` noise | 7 untracked items | Clean |
| Stale branches | 4 | 0 |
| Workflows using ARC | 0 | All active workflows |
| AGENTS.md accuracy | Stale (5+ wrong fields) | Current |
