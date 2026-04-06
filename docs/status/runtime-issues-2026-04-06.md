# Runtime Issues — 2026-04-06

Separate from repo maintenance. These are infrastructure/deploy issues.

## Issue 1: cal.mereka.io returns 500 (CRITICAL)

**Status**: Active — prod is down
**Component**: calcom web app on rke2-prod
**Namespace**: calcom-prod
**Pod**: calcom-78fccc955b-x22p4 (Running, 2/2)

**Symptom**: All routes return HTTP 500.

**Root cause**: Next.js "Failed to find Server Action" errors in logs. This means:
- The deployed image (`calcom/cal.com@sha256:ace3bb...`) is stale
- Server Actions compiled into the build don't match what incoming requests expect
- The image is from the upstream public registry, not a fork-specific build

**Fix options**:
1. Build a new image from the current fork main branch and deploy
2. Or deploy a known-working upstream image tag

**Ingress**: `cal.mereka.io` and `calendar.mereka.io` via nginx on rke2-prod workers (185.227.134.230, 185.227.135.166, 185.250.38.89)

---

## Issue 2: api-v2.cal.mereka.io TLS failure

**Status**: Active — endpoint unreachable
**Component**: DNS / Cloudflare SSL

**Root cause**: `api-v2.cal.mereka.io` is a multi-level subdomain. Cloudflare free SSL only covers `*.mereka.io`, not `*.*.mereka.io`. The TLS handshake fails because no certificate covers this hostname.

**Additional finding**: api-v2 is NOT deployed on RKE2. There are no `calcom-api-v2` deployments on either cluster. It was a Cloud Run service that was never migrated.

**Fix options**:
1. **If api-v2 is needed**: Deploy on RKE2, set DNS to gray cloud (DNS-only), use cert-manager for Let's Encrypt
2. **If api-v2 is not needed**: Remove the DNS record from Cloudflare
3. **Alternative**: Flatten to `api-v2-cal.mereka.io` (single-level subdomain, covered by wildcard cert)

---

## Issue 3: cal.mereka.io proxied through Cloudflare but origin is 500

**Status**: Cosmetic until Issue 1 is fixed
**Component**: Cloudflare proxy config

**Details**: cal.mereka.io is proxied (orange cloud) through Cloudflare, resolving to CF anycast IPs. The origin (rke2-prod ingress-nginx) returns 500, which Cloudflare passes through. Once Issue 1 is fixed, this setup should work.

---

## Cluster topology reference

| Item | Value |
|------|-------|
| rke2-prod control planes | 194.233.91.173, 194.233.94.5, 194.233.95.110 |
| rke2-prod workers | 185.227.134.230, 185.227.135.166, 185.250.38.89 |
| Ingress controller | nginx, DaemonSet on all workers (hostPort 80/443) |
| calcom-prod image | `calcom/cal.com@sha256:ace3bb1219fb73...` |
| calcom-prod namespace | calcom-prod |
| Database | calcom-postgresql (in-cluster, calcom-prod namespace) |
