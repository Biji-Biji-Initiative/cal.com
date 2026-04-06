# AGENTS.md

## Repository Overview
Fork of [cal.com](https://github.com/calcom/cal.com) scheduling infrastructure with Biji-Biji customizations, including Authentik SSO integration and custom booking workflows.

## Upstream Sync
- Upstream: https://github.com/calcom/cal.com
- Sync frequency: Weekly (automated)
- Last sync: Automated weekly via auto-sync-upstream.yml

## Custom Modifications
- Authentik SSO integration for authentication
- Custom booking workflows for Biji-Biji use cases
- Branding changes (logos, colors, domain)
- Custom webhook integrations

## Core Commands
- Install: `yarn`
- Dev: `yarn dev`
- Test: `TZ=UTC yarn test`
- Build: `yarn build`
- Lint: `yarn lint`

## Environment Setup
- Node: 20.x (check `.nvmrc` or `package.json` engines)
- Package manager: yarn (>=4.12.0, use corepack)
- Database: PostgreSQL (via Docker or external)
- Required: Copy `.env.example` to `.env` and configure

## Validation Requirements
Before marking work as complete:
- Run: `yarn lint`
- Run: `TZ=UTC yarn test`
- Run: `yarn build`
- Test custom SSO flow locally

## Deployment
- Platform: RKE2 prod cluster (rke2-prod)
- Ask before: modifying deployment configuration

## Boundaries
- Always: Document custom changes clearly, test upstream merges on branch first, keep custom changes in designated files
- Ask First: Upstream version upgrades, new custom features, authentication changes
- Never: Force push to main, skip testing upstream changes, commit secrets

## Upstream Merge Process
1. **Automated**: `auto-sync-upstream.yml` runs weekly and opens a PR
2. Review the auto-generated PR (env-preflight CI validates automatically)
3. Merge the PR
4. Deploy and run smoke checks: `scripts/smoke-check-calcom.sh --web-url <url> --check-google --check-sso`
5. For manual sync: `git fetch upstream && git merge upstream/main`

---
Last updated: 2026-04-06
