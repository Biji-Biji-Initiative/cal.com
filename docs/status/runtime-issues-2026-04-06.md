# Runtime Issues — 2026-04-06

## Issue 1: cal.mereka.io returns 500 — RESOLVED

**Root cause**: nginx-ingress auth subrequest to Authentik used internal service URL. Authentik's forward_domain proxy matches on Host header, but nginx sent `Host: authentik-server.authentik.svc.cluster.local` instead of `Host: cal.mereka.io`, causing 404 from Authentik → 500 from nginx.

**Fix**: Changed `auth-url` annotation to use external Authentik URL (`https://auth0.mereka.io/...`) which naturally carries the correct Host. PRs #2457, #2458 in bbi-infrastructure.

**Current status**: All environments returning 302 (SSO redirect to Authentik). Verified:
- cal.mereka.io → 302 to auth0.mereka.io
- cal.mereka.dev → 302 to auth0.mereka.dev
- staging.cal.mereka.io → 302 to auth0.mereka.io

**Note**: The calcom app itself works correctly (verified via `localhost:3000` inside the pod). The "Failed to find Server Action" errors in logs are from Cloudflare challenge requests that reach the app without proper session context — not a stale image issue.

---

## Issue 2: api-v2.cal.mereka.io TLS failure — DNS RECORD STALE

**Root cause**: Multi-level subdomain (`*.*.mereka.io`) not covered by Cloudflare free SSL wildcard (`*.mereka.io`). Additionally, api-v2 is NOT deployed on RKE2 — it was a Cloud Run service never migrated.

**Status**: DNS record exists but nothing behind it. Tracked as future deployment.

**Decision needed**: Deploy api-v2 on RKE2 (requires new Dockerfile build, K8s manifests, DNS fix) or remove the DNS record.

---

## Issue 3: Fork-specific image build — IN PROGRESS

**Context**: The fork uses upstream's `calcom/cal.com:v6.2.0` image which doesn't include Mereka branding at the client-side JS level. A fork-specific image build pipeline has been created.

**Status**: First build triggered (workflow `build-fork-image.yml`). Image will push to `ghcr.io/biji-biji-initiative/cal.com:main-<sha>`. Once built, the bbi-infrastructure prod overlay needs updating to reference the new image.

---

## Cluster topology

| Item | Value |
|------|-------|
| rke2-prod workers | 185.227.134.230, 185.227.135.166, 185.250.38.89 |
| Ingress controller | nginx DaemonSet on all workers (hostPort 80/443) |
| calcom-prod image | `calcom/cal.com@sha256:ace3bb...` (to be replaced with fork image) |
| calcom-prod namespace | calcom-prod |
| Authentik | authentik namespace, embedded outpost with Cal.com Proxy provider |
| auth-verify | 4/4 PASS for calcom |
