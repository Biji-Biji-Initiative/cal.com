# 🚀 Mereka Docs - Cal.com Deployment & Configuration

Welcome to the comprehensive documentation for your Mereka Calendar deployment on Google Cloud Run.

## 📚 **Documentation Index**

### 🚀 **Deployment & Setup**
- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Complete deployment guide with troubleshooting
- **[WORKING_CONFIG.md](WORKING_CONFIG.md)** - Working configuration reference
- **[deploy-calcom.sh](deploy-calcom.sh)** - Automated deployment script
- **[deploy-api-v2.sh](deploy-api-v2.sh)** - **NEW: API v2 service deployment script**

### 🔧 **Configuration & Environment**
- **[ENVIRONMENT_VARIABLES_REFERENCE.md](ENVIRONMENT_VARIABLES_REFERENCE.md)** - Complete environment variables reference
- **[INTEGRATION_SETUP.md](INTEGRATION_SETUP.md)** - Integration and API setup guide
- **[API_KEY_SETUP_GUIDE.md](API_KEY_SETUP_GUIDE.md)** - API key creation and troubleshooting
- **[LICENSE_SETUP_GUIDE.md](LICENSE_SETUP_GUIDE.md)** - **CRITICAL: License key setup process**
- **[API_V2_SETUP_GUIDE.md](API_V2_SETUP_GUIDE.md)** - **NEW: API v2 service deployment guide**

## 🎯 **Quick Start**

1. **Deploy**: Use `./deploy-calcom.sh` for automated deployment
2. **Configure**: Reference `WORKING_CONFIG.md` for current settings
3. **Troubleshoot**: Use `DEPLOYMENT_GUIDE.md` for common issues
4. **Environment**: Check `ENVIRONMENT_VARIABLES_REFERENCE.md` for all variables

## 🚨 **Critical Notes**

- **Never delete** `env-vars-production.yaml` - it's essential for deployments
- **Always use** 2048Mi memory allocation for Cloud Run
- **Must include** `CAL_SIGNATURE_TOKEN` to avoid TRPC errors
- **DNS must be** "DNS only" (gray cloud) in Cloudflare, not proxied

## 📊 **Current Status**

- **Service**: `calcom-app-prod` ✅
- **Domain**: `https://calendar.mereka.io` ✅
- **White-labeling**: Active with Mereka branding ✅
- **Environment Variables**: 24/24 ✅
- **TRPC API**: Working ✅

## 🔍 **Common Issues & Solutions**

| Issue | Solution | Document |
|-------|----------|----------|
| TRPC "Load failed" errors | Add `CAL_SIGNATURE_TOKEN` | [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) |
| Custom domain 503 errors | Fix Cloudflare DNS (gray cloud) | [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) |
| Memory exceeded | Increase to 2048Mi | [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) |
| Database connection | Check Cloud SQL connector | [WORKING_CONFIG.md](WORKING_CONFIG.md) |

---

**Last Updated**: August 25, 2025  
**Version**: 1.0  
**Status**: Production Ready ✅
