# Runtime Issues — 2026-04-06 (Updated 2026-04-07)

## Issue 1: All environments returned 500 — RESOLVED

**Root cause**: nginx-ingress auth subrequests to Authentik used internal service URLs. Authentik's forward_domain proxy matches on Host header, returning 404 → nginx returned 500.

**Fix**: Changed auth-url annotations to external Authentik URLs across all environments:
- Prod: `https://auth0.mereka.io/outpost.goauthentik.io/auth/nginx`
- Dev: `https://auth0.mereka.dev/outpost.goauthentik.io/auth/nginx`
- Staging: `https://auth0.mereka.io/outpost.goauthentik.io/auth/nginx`

**Status**: All environments returning 302 (SSO redirect).

---

## Issue 2: api-v2 not deployed — RESOLVED

**Previous state**: api-v2 was a Cloud Run service, never migrated to RKE2. DNS record `api-v2.cal.mereka.io` was stale (multi-level subdomain, TLS broken).

**Fix**:
- Built api-v2 Docker image from fork (`ghcr.io/biji-biji-initiative/cal.com-api-v2:v6.2.0`)
- Deployed to all 3 environments with per-env hostnames:
  - Prod: `calcom-api.mereka.io`
  - Dev: `calcom-api-dev.mereka.dev`
  - Staging: `calcom-api-staging.mereka.io`
- Redis cache deployed alongside api-v2 in each environment
- Network policies (K8s + Cilium) configured for api-v2 pods
- Stale `api-v2.cal.mereka.io` DNS record removed

**Status**: api-v2 running 1/1 in all environments. Health endpoint returning 200.

---

## Issue 3: Image build pipeline — RESOLVED

**Previous state**: Fork used upstream `calcom/cal.com:v6.2.0` with no way to build fork-specific images.

**Fix**:
- Web app uses upstream image + ConfigMap-mounted Mereka logo (no fork build needed)
- api-v2 has a build workflow (`build-fork-image.yml`) with Docker layer caching
- api-v2 image built locally on VPS and pushed to GHCR

**Status**: Operational. api-v2 builds on demand via workflow_dispatch or v*-mereka* tags.
