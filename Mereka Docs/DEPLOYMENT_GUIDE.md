# Cal.com Production Deployment Guide

## 🎯 Overview
This guide provides a bulletproof process for deploying Cal.com to Google Cloud Run with proper configuration. Follow this guide to avoid common deployment failures.

## 🚨 CRITICAL SUCCESS FACTORS

### 1. Environment Variables - THE MOST COMMON FAILURE POINT
**NEVER deploy without ALL required environment variables set correctly:**

```yaml
# Required Core Variables (env-vars.yaml)
NEXTAUTH_SECRET: "base64-encoded-random-string"  # Generate with: openssl rand -base64 32
CALENDSO_ENCRYPTION_KEY: "base64-encoded-random-string"  # Generate with: openssl rand -base64 32
NEXTAUTH_URL: "https://your-domain.com"
WEB_APP_URL: "https://your-domain.com"
NEXT_PUBLIC_WEBAPP_URL: "https://your-domain.com"
NEXT_PUBLIC_WEBSITE_URL: "https://your-domain.com"
BASE_URL: "https://your-domain.com"
NEXT_PUBLIC_BASE_URL: "https://your-domain.com"

# Database Variables (BOTH required!)
DATABASE_URL: "postgresql://user:pass@localhost:5432/db?host=/cloudsql/project:region:instance&sslmode=disable"
DATABASE_DIRECT_URL: "postgresql://user:pass@localhost:5432/db?host=/cloudsql/project:region:instance&sslmode=disable"

# Google OAuth (if using Google login)
GOOGLE_CLIENT_ID: "your-google-client-id"
GOOGLE_CLIENT_SECRET: "your-google-client-secret"
GOOGLE_LOGIN_ENABLED: "true"
GOOGLE_API_CREDENTIALS: '{"web":{"client_id":"...","client_secret":"...","redirect_uris":["..."]}}'
CALCOM_DEPLOYMENT_KEY: "generated-deployment-key"
CALCOM_LICENSE_KEY: "1a1f8138-0bfc-4f37-b4af-1e24fd145839"

# White-labeling Configuration
NEXT_PUBLIC_APP_NAME: "Mereka Calendar"
NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS: "support@mereka.io"
NEXT_PUBLIC_COMPANY_NAME: "Mereka"
NEXT_PUBLIC_SENDER_ID: "Mereka"
NEXT_PUBLIC_SENDGRID_SENDER_NAME: "Mereka Calendar"

# API Configuration
API_KEY_PREFIX: "mereka_"
```

### 2. Memory Allocation - SECOND MOST COMMON FAILURE
**ALWAYS use at least 2GB memory:**
- Minimum: 1024Mi (1GB)
- Recommended: 2048Mi (2GB)
- Never use 512Mi - it WILL cause memory exceeded errors

### 3. Cloud SQL Connection
**ALWAYS use socket connection for Cloud Run:**
- Format: `postgresql://user:pass@localhost:5432/db?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME&sslmode=disable`
- Never use public IP connection from Cloud Run

---

## 🔧 STEP-BY-STEP DEPLOYMENT PROCESS

### Step 1: Prepare Environment Variables File
```bash
# Generate secrets
NEXTAUTH_SECRET=$(openssl rand -base64 32)
CALENDSO_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Create env-vars.yaml
cat > env-vars.yaml << EOF
NEXTAUTH_SECRET: "$NEXTAUTH_SECRET"
CALENDSO_ENCRYPTION_KEY: "$CALENDSO_ENCRYPTION_KEY"
NEXTAUTH_URL: "https://calendar.mereka.io"
WEB_APP_URL: "https://calendar.mereka.io"
NEXT_PUBLIC_WEBAPP_URL: "https://calendar.mereka.io"
NEXT_PUBLIC_WEBSITE_URL: "https://calendar.mereka.io"
BASE_URL: "https://calendar.mereka.io"
NEXT_PUBLIC_BASE_URL: "https://calendar.mereka.io"
DATABASE_URL: "postgresql://caluser:DWVdkG9MhMWu24HPCv0Gv0n@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable"
DATABASE_DIRECT_URL: "postgresql://caluser:DWVdkG9MhMWu24HPCv0Gv0n@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable"
GOOGLE_CLIENT_ID: "840643300842-tkj3l0cfmkjspk34bpr68h70c9qf60f1.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET: "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"
GOOGLE_LOGIN_ENABLED: "true"
GOOGLE_API_CREDENTIALS: '{"web":{"client_id":"840643300842-tkj3l0cfmkjspk34bpr68h70c9qf60f1.apps.googleusercontent.com","client_secret":"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","redirect_uris":["https://calendar.mereka.io/api/integrations/googlecalendar/callback","https://calendar.mereka.io/api/auth/callback/google","https://cal.mereka.io/api/integrations/googlecalendar/callback","https://cal.mereka.io/api/auth/callback/google"]}}'
EOF
```

### Step 2: Deploy to Cloud Run
```bash
# Set variables
PROJECT_ID="biji-biji-calcom-250825084322"
REGION="us-central1"
SERVICE_NAME="calcom-app-prod"
CLOUDSQL_INSTANCE="biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517"

# Deploy with all settings in one command
gcloud run services update $SERVICE_NAME \
  --region=$REGION \
  --project=$PROJECT_ID \
  --env-vars-file=env-vars.yaml \
  --add-cloudsql-instances=$CLOUDSQL_INSTANCE \
  --memory=2048Mi \
  --timeout=300 \
  --min-instances=1 \
  --port=3000 \
  --quiet
```

### Step 3: Verify Deployment
```bash
# Get active revision
REVISION=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.traffic[0].revisionName)")

# Verify environment variables (should show 23 variables)
gcloud run revisions describe $REVISION --region=$REGION --project=$PROJECT_ID --format="yaml(spec.containers[0].env)" | grep "name:" | wc -l

# Verify memory allocation (should show 2048Mi)
gcloud run revisions describe $REVISION --region=$REGION --project=$PROJECT_ID --format="value(spec.containers[0].resources.limits.memory)"

# Test endpoints
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.url)")
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL"  # Should return 307
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/auth/login"  # Should return 200
```

### Step 4: Configure Custom Domain
```bash
# Map domain to service
gcloud beta run domain-mappings create --domain=calendar.mereka.io --service=$SERVICE_NAME --region=$REGION --project=$PROJECT_ID

# Get DNS record requirements
gcloud beta run domain-mappings describe --domain=calendar.mereka.io --region=$REGION --project=$PROJECT_ID --format="value(status.resourceRecords[0].rrdata)"
```

### Step 5: Update DNS in Cloudflare
**CRITICAL: DNS must point directly to Google, not through Cloudflare proxy**

1. Go to Cloudflare Dashboard → Your domain
2. Find DNS record for `calendar`
3. Set:
   - Type: `CNAME`
   - Name: `calendar`
   - Target: `ghs.googlehosted.com`
   - **Proxy status: DNS only (gray cloud)** ← MUST be gray, not orange!

### Step 6: Wait and Verify
```bash
# Wait for DNS propagation (5-10 minutes)
nslookup calendar.mereka.io  # Should resolve to ghs.googlehosted.com

# Test custom domain
curl -s -o /dev/null -w "%{http_code}\n" "https://calendar.mereka.io"  # Should return 307
curl -s -o /dev/null -w "%{http_code}\n" "https://calendar.mereka.io/auth/login"  # Should return 200
```

---

## 🚨 COMMON FAILURE MODES & SOLUTIONS

### 1. "Please set NEXTAUTH_SECRET" Error
**Cause:** Environment variables not applied to active revision
**Solution:**
```bash
# Check if NEXTAUTH_SECRET exists on active revision
REVISION=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.traffic[0].revisionName)")
gcloud run revisions describe $REVISION --region=$REGION --project=$PROJECT_ID --format="yaml(spec.containers[0].env)" | grep -A1 "NEXTAUTH_SECRET"

# If missing, redeploy with env-vars.yaml
gcloud run services update $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --env-vars-file=env-vars.yaml
```

### 2. Prisma "DATABASE_DIRECT_URL missing" Error
**Cause:** Missing DATABASE_DIRECT_URL environment variable
**Solution:** Ensure both DATABASE_URL and DATABASE_DIRECT_URL are set to the same socket connection string

### 3. Memory Exceeded Errors
**Cause:** Insufficient memory allocation (512Mi is too low)
**Solution:**
```bash
gcloud run services update $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --memory=2048Mi
```

### 4. Custom Domain Returns 503
**Cause:** DNS misconfiguration in Cloudflare (orange cloud proxy enabled)
**Solution:** Change DNS record to "DNS only" (gray cloud) in Cloudflare

### 5. SSL Certificate Not Provisioning
**Cause:** DNS not pointing to ghs.googlehosted.com
**Solution:** Verify DNS with `nslookup` and ensure CNAME points to `ghs.googlehosted.com`

### 6. "Connection closed" Error & TRPC Failures
**Cause:** Missing `CAL_SIGNATURE_TOKEN` environment variable
**Symptoms:** 
- Browser shows "Connection closed" error
- Console shows TRPC errors: "Load failed", "Could not fetch properties"
- Logs show: "Signature token not found in database or set in environment variable"
**Solution:** 
```bash
# Add CAL_SIGNATURE_TOKEN to environment variables
CAL_SIGNATURE_TOKEN: "same-value-as-CALCOM_DEPLOYMENT_KEY"

# Redeploy service
gcloud run services update $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --env-vars-file=env-vars.yaml
```
**Root Cause:** Cal.com requires `CAL_SIGNATURE_TOKEN` for internal API verification. Without it, TRPC endpoints fail with "Load failed" errors.

### 7. Cannot Create API Keys
**Cause:** Missing `API_KEY_PREFIX` environment variable
**Symptoms:** 
- API key creation fails silently
- No error message shown in UI
- API key generation endpoint returns errors
**Solution:** 
```bash
# Add API_KEY_PREFIX to environment variables
API_KEY_PREFIX: "mereka_"  # or any prefix you prefer

# Redeploy service
gcloud run services update $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --env-vars-file=env-vars.yaml
```
**Root Cause:** Cal.com requires `API_KEY_PREFIX` for API key generation. Without it, the API key creation process fails.

---

## 🔍 DEBUGGING COMMANDS

### Check Service Status
```bash
gcloud run services list --region=$REGION --project=$PROJECT_ID
```

### View Recent Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME" --limit=20 --freshness=10m --format='value(timestamp,severity,textPayload)' --project=$PROJECT_ID
```

### Check Environment Variables
```bash
REVISION=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.traffic[0].revisionName)")
gcloud run revisions describe $REVISION --region=$REGION --project=$PROJECT_ID --format="yaml(spec.containers[0].env)"
```

### Test Endpoints
```bash
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.url)")
curl -I "$SERVICE_URL"
curl -I "$SERVICE_URL/auth/login"
```

### Check Domain Mapping Status
```bash
gcloud beta run domain-mappings describe --domain=calendar.mereka.io --region=$REGION --project=$PROJECT_ID --format="yaml(status)"
```

---

## 📋 PRE-DEPLOYMENT CHECKLIST

- [ ] Cloud SQL instance is running and accessible
- [ ] Database credentials are correct
- [ ] All environment variables are prepared in env-vars.yaml
- [ ] NEXTAUTH_SECRET and CALENDSO_ENCRYPTION_KEY are generated
- [ ] Google OAuth credentials are configured (if using Google login)
- [ ] Memory is set to at least 1024Mi (preferably 2048Mi)
- [ ] Cloud SQL connector instance name is correct

## 📋 POST-DEPLOYMENT CHECKLIST

- [ ] Service shows as "Ready" in Cloud Run console
- [ ] All 14 environment variables are present on active revision
- [ ] Memory allocation is 2048Mi
- [ ] Root endpoint returns 307 redirect
- [ ] /auth/login endpoint returns 200
- [ ] No errors in recent logs
- [ ] Custom domain mapping is created
- [ ] DNS points to ghs.googlehosted.com (not Cloudflare IPs)
- [ ] SSL certificate is provisioned
- [ ] Custom domain returns 200/307 (not 503)

---

## 🛠️ AUTOMATED DEPLOYMENT SCRIPT

See `deploy-calcom.sh` for a complete automated deployment script that follows this guide.

---

## 📞 SUPPORT

If deployment fails after following this guide:
1. Check the debugging commands above
2. Review the common failure modes section
3. Ensure all checklist items are completed
4. Check Cloud Run logs for specific error messages
