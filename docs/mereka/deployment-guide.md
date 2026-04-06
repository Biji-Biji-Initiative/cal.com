# Cal.com Deployment Guide

## Overview

This guide covers deploying Cal.com for the Mereka/Biji-Biji fork. Production runs on the RKE2 prod cluster (rke2-prod). The patterns here apply whether you are deploying to RKE2, a VPS, or any container platform.

## Critical Success Factors

### 1. Environment Variables

Never deploy without ALL required environment variables set correctly:

```yaml
# Core Authentication
NEXTAUTH_SECRET: "base64-encoded-random-string"  # openssl rand -base64 32
CALENDSO_ENCRYPTION_KEY: "base64-encoded-random-string"  # openssl rand -base64 32
NEXTAUTH_URL: "https://your-domain.com"
WEB_APP_URL: "https://your-domain.com"
NEXT_PUBLIC_WEBAPP_URL: "https://your-domain.com"
NEXT_PUBLIC_WEBSITE_URL: "https://your-domain.com"

# Database (BOTH required)
DATABASE_URL: "postgresql://user:pass@host:5432/db"
DATABASE_DIRECT_URL: "postgresql://user:pass@host:5432/db"

# Google OAuth (if using Google login)
GOOGLE_LOGIN_ENABLED: "true"
GOOGLE_API_CREDENTIALS: '{"web":{"client_id":"...","client_secret":"...","redirect_uris":["..."]}}'

# Cal.com License & Internal API
CALCOM_LICENSE_KEY: "your-license-key"
CAL_SIGNATURE_TOKEN: "generated-random-hex-token"

# White-labeling
NEXT_PUBLIC_APP_NAME: "Mereka Calendar"
NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS: "support@mereka.io"
NEXT_PUBLIC_COMPANY_NAME: "Mereka"
NEXT_PUBLIC_SENDER_ID: "Mereka"
NEXT_PUBLIC_SENDGRID_SENDER_NAME: "Mereka Calendar"

# API Configuration
API_KEY_PREFIX: "mereka_"
```

Validate before deploying:
```bash
./scripts/verify-calcom-env.sh <env-file> --profile web --require-google --require-sso
```

### 2. Memory Allocation

- Minimum: 1024Mi (1GB)
- Recommended: 2048Mi (2GB)
- Never use 512Mi — it will cause memory exceeded errors

### 3. Database Connection

Both `DATABASE_URL` and `DATABASE_DIRECT_URL` must be set and identical. When using a connection proxy (e.g., Cloud SQL socket, pgbouncer sidecar), use the proxy format rather than a direct TCP connection.

### 4. DNS Configuration

For custom domains, use DNS-only (gray cloud) in Cloudflare — not proxied. This is required for Google-managed SSL and Let's Encrypt cert-manager to provision certificates correctly.

---

## Generating Secrets

```bash
NEXTAUTH_SECRET=$(openssl rand -base64 32)
CALENDSO_ENCRYPTION_KEY=$(openssl rand -hex 16)
CAL_SIGNATURE_TOKEN=$(openssl rand -hex 32)
```

---

## Build Commands

```bash
# Install dependencies
yarn

# Build the web app
yarn build

# Build API v2 (separate service)
yarn workspace @calcom/api-v2 run build

# Run database migrations
yarn workspace @calcom/prisma db-deploy
```

---

## Database Migrations

```bash
# Development
npx prisma migrate dev --name migration_name

# Production deployment
yarn workspace @calcom/prisma db-deploy

# Regenerate types after schema changes
yarn prisma generate
```

---

## App Store Repopulation

After deployment, if integrations are missing from the app store:

```bash
yarn workspace @calcom/prisma db-seed
```

---

## Domain and DNS Setup

For domains like `calendar.mereka.io`:

1. Create a DNS record pointing to your load balancer / ingress IP
2. Use DNS-only (gray cloud) in Cloudflare, not proxied
3. cert-manager will provision Let's Encrypt certificates automatically on RKE2

For multi-level subdomains (`api-v2.mereka.io`), see the [domain SSL management guide](~/docs/acfs/reference/domain-ssl-management.md).

---

## Common Failure Modes

### "Please set NEXTAUTH_SECRET"
Environment variables not applied to the running container. Redeploy with the env file and verify the active revision/pod has the variable.

### Prisma "DATABASE_DIRECT_URL missing"
Ensure both `DATABASE_URL` and `DATABASE_DIRECT_URL` are set.

### Memory exceeded errors
Increase memory allocation to at least 2048Mi.

### Custom domain returns 503
Check DNS — Cloudflare proxy (orange cloud) must be disabled.

### "Connection closed" / TRPC failures
Missing `CAL_SIGNATURE_TOKEN`. Add it and redeploy.
- Symptoms: TRPC errors "Load failed", "Could not fetch properties"
- Root cause: Cal.com requires this token for internal API verification

### Cannot create API keys
Missing `API_KEY_PREFIX`. Add it (e.g., `mereka_`) and redeploy. Failures are silent in the UI.

---

## Pre-deployment Checklist

- [ ] Database is running and accessible
- [ ] Database credentials are correct
- [ ] All environment variables are prepared
- [ ] `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` are freshly generated
- [ ] Google OAuth credentials are configured (if using Google login)
- [ ] Memory is set to at least 1024Mi (preferably 2048Mi)

## Post-deployment Checklist

- [ ] Service shows as healthy/ready
- [ ] All required environment variables are present on the active revision/pod
- [ ] Root endpoint returns 307 redirect
- [ ] `/auth/login` returns 200
- [ ] No errors in recent logs
- [ ] Custom domain is reachable
- [ ] SSL certificate is provisioned
- [ ] Google OAuth login works

---

## Automated Deployment Script

See `scripts/deploy-calcom.sh` for a complete automated deployment script.

---

## Support

If deployment fails after following this guide:
1. Check the common failure modes section above
2. Compare your config with `docs/mereka/working-config.md`
3. Check container logs for specific error messages
4. Run debugging commands from the scripts in `scripts/`
