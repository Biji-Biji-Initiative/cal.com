# AGENTS.md

## Repository Overview
Fork of [cal.com](https://github.com/calcom/cal.com) scheduling infrastructure with Biji-Biji customizations, including Authentik SSO integration and custom booking workflows.

## Upstream Sync
- Upstream: https://github.com/calcom/cal.com
- Sync frequency: Monthly
- Last sync: 2026-03-01

## Custom Modifications
- Authentik SSO integration for authentication
- Custom booking workflows for Biji-Biji use cases
- Branding changes (logos, colors, domain)
- Custom webhook integrations

## Core Commands
- Install: `pnpm install`
- Dev: `pnpm dev`
- Test: `pnpm test`
- Build: `pnpm build`
- Lint: `pnpm lint`

## Environment Setup
- Node: 18.x or 20.x
- Package manager: pnpm (use corepack)
- Database: PostgreSQL (via Docker or external)
- Required: Copy `.env.example` to `.env` and configure

## Validation Requirements
Before marking work as complete:
- Run: `pnpm lint`
- Run: `pnpm test`
- Run: `pnpm build`
- Test custom SSO flow locally

## Deployment
- Platform: {UPDATE: GKE/VPS}
- Ask before: modifying deployment configuration

## Boundaries
- ✅ Always: Document custom changes clearly, test upstream merges on branch first, keep custom changes in designated files
- ⚠️ Ask First: Upstream version upgrades, new custom features, authentication changes
- 🚫 Never: Force push to main, skip testing upstream changes, commit secrets

## Upstream Merge Process
1. Fetch upstream: `git fetch upstream`
2. Create branch: `git checkout -b sync/upstream-{date}`
3. Merge: `git merge upstream/main`
4. Resolve conflicts (preserve custom changes)
5. Test thoroughly: `pnpm test && pnpm build`
6. Create PR for review

---
Last updated: 2026-03-02
