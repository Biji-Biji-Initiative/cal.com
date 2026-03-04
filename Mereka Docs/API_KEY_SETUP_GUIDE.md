# 🔑 API Key Setup Guide - Mereka Calendar

## Overview
This guide explains how to set up and troubleshoot API key creation in your Mereka Calendar deployment.

## ✅ **Current Status**
- **Service**: `calcom-app-prod` (revision 00009-jml)
- **Environment Variables**: 23/23 ✅
- **API_KEY_PREFIX**: `mereka_` ✅
- **CALCOM_LICENSE_KEY**: Staging license active ✅

## 🔧 **Required Environment Variables for API Keys**

### Core API Variables
```yaml
API_KEY_PREFIX: "mereka_"                    # Required for API key generation
CALCOM_LICENSE_KEY: "REPLACE_WITH_CALCOM_LICENSE_KEY"  # Required for commercial features
CAL_SIGNATURE_TOKEN: "REPLACE_WITH_CAL_SIGNATURE_TOKEN"  # Required for internal verification
```

### Database & Authentication
```yaml
DATABASE_URL: "postgresql://caluser:...@localhost:5432/calendso?host=/cloudsql/..."
DATABASE_DIRECT_URL: "postgresql://caluser:...@localhost:5432/calendso?host=/cloudsql/..."
NEXTAUTH_SECRET: "REPLACE_WITH_NEXTAUTH_SECRET"
CALENDSO_ENCRYPTION_KEY: "REPLACE_WITH_CALENDSO_ENCRYPTION_KEY"
```

## 🚀 **How to Create API Keys**

### 1. Access API Key Settings
- Navigate to: `https://calendar.mereka.io/settings/developer/api-keys`
- You must be logged in with a user account

### 2. Create New API Key
- Click "Create New API Key"
- Fill in:
  - **Note**: Description of the key's purpose
  - **Expires**: Choose expiration date or "Never expires"
  - **Team**: Select team if applicable

### 3. Generated API Key Format
Your API keys will be generated with the prefix: `mereka_xxxxxxxxxxxxxxxx`

## 🔍 **Troubleshooting API Key Creation**

### Issue: Cannot Create API Keys
**Symptoms:**
- Create button doesn't work
- No error message shown
- Silent failure

**Solutions:**
1. **Check Environment Variables:**
   ```bash
   gcloud run revisions describe calcom-app-prod-00009-jml \
     --region=us-central1 \
     --project=biji-biji-calcom-250825084322 \
     --format="yaml(spec.containers[0].env)" | grep -A1 "API_KEY_PREFIX"
   ```

2. **Verify License Key:**
   ```bash
   gcloud run revisions describe calcom-app-prod-00009-jml \
     --region=us-central1 \
     --project=biji-biji-calcom-250825084322 \
     --format="yaml(spec.containers[0].env)" | grep -A1 "CALCOM_LICENSE_KEY"
   ```

3. **Check Service Health:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "https://calendar.mereka.io/settings/developer/api-keys"
   ```

### Issue: API Key Creation Fails Silently
**Root Cause:** Missing `API_KEY_PREFIX` environment variable
**Solution:** Add to environment variables and redeploy

### Issue: "Invalid License" Error
**Root Cause:** Missing or invalid `CALCOM_LICENSE_KEY`
**Solution:** Ensure staging license key is set correctly

## 📊 **API Key Usage Examples**

### Using Your API Key
```bash
# Example API call
curl "https://calendar.mereka.io/api/v1/users?apiKey=mereka_xxxxxxxxxxxxxxxx"

# Headers (alternative method)
curl -H "Authorization: Bearer mereka_xxxxxxxxxxxxxxxx" \
     "https://calendar.mereka.io/api/v1/users"
```

### API Key Prefix
- **Default Cal.com**: `cal_xxxxxxxxxxxxxxxx`
- **Your Mereka**: `mereka_xxxxxxxxxxxxxxxx`
- **Custom**: Set via `API_KEY_PREFIX` environment variable

## 🚨 **Common Mistakes to Avoid**

1. **Missing API_KEY_PREFIX** - Causes silent API key creation failures
2. **Invalid License Key** - Prevents commercial features from working
3. **Missing CAL_SIGNATURE_TOKEN** - Causes TRPC errors
4. **Insufficient Memory** - Cloud Run needs 2048Mi minimum

## 📚 **Related Documentation**

- **[ENVIRONMENT_VARIABLES_REFERENCE.md](ENVIRONMENT_VARIABLES_REFERENCE.md)** - Complete environment variables list
- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Deployment troubleshooting
- **[WORKING_CONFIG.md](WORKING_CONFIG.md)** - Current working configuration

---

**Last Updated**: August 25, 2025  
**Status**: API Key Creation Enabled ✅  
**Test**: Try creating an API key now - it should work!


