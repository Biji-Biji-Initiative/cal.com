# CI Runner Policy — Biji-Biji-Initiative/cal.com

## Default: ARC self-hosted runners

All CI workflows in this fork MUST use ARC self-hosted runners unless explicitly exempted.

| Job type | Runner label | Timeout |
|----------|-------------|---------|
| Standard CI (lint, typecheck, tests, scripts) | `mereka-k8s-runners` | 30 min |
| Docker builds, heavy compilation, DinD | `mereka-k8s-heavy-builders` | 45 min |
| GitHub-hosted | **By explicit exemption only** | — |
| Blacksmith | **Prohibited** | — |

## Runner infrastructure

Runners are deployed on **rke2-nonprod** via ARC (Actions Runner Controller), managed in `bbi-infrastructure`.

- `mereka-k8s-runners`: 4–20 ephemeral pods, 2 vCPU / 4GB RAM each
- `mereka-k8s-heavy-builders`: 2–6 pods with DinD, 4 vCPU / 12GB RAM each

## Required workflow settings

Every workflow MUST have:

```yaml
permissions:
  contents: read  # minimum; expand as needed

jobs:
  job-name:
    runs-on: mereka-k8s-runners  # or mereka-k8s-heavy-builders
    timeout-minutes: 30           # or 45 for heavy
```

PR-triggered workflows SHOULD have:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

## Prohibited patterns

- `runs-on: ubuntu-latest` — use `mereka-k8s-runners` instead
- `runs-on: blacksmith-*` — Blacksmith is not configured for this fork
- `actions/cache` steps — ARC runners are ephemeral; caching is not effective
- `cache:` parameter in `actions/setup-node` — same reason
- `useblacksmith/*` actions — Blacksmith-specific, not available

## Exemptions

GitHub-hosted runners may be used only when:
1. The workflow genuinely requires hosted-runner features not available on ARC
2. The exemption is documented here with a reason

| Workflow | Runner | Reason |
|----------|--------|--------|
| *(none currently)* | | |

## Upstream workflow handling

This is a fork of calcom/cal.com. Upstream workflows use Blacksmith runners.

- **Fork-owned workflows**: Migrated to ARC in source
- **Upstream workflows we use**: Migrated to ARC in source (diverges from upstream — handled during sync)
- **Upstream workflows we don't need**: Disabled via GitHub API (not modified in source to avoid merge conflicts)

## Scheduled jobs

GitHub Actions cron workflows that hit application API endpoints (e.g., `/api/cron/*`) are **disabled** on this fork because:
1. No `APP_URL` or `CRON_API_KEY` secrets are configured
2. These are better served by K8s CronJobs on RKE2 when needed

If the fork needs scheduled jobs in the future, prefer K8s-native scheduling over GitHub Actions crons.
