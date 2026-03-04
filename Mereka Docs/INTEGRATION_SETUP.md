# Cal.com Integration Setup Guide

## 🎯 Overview
This guide will help you set up Zoom, Google Calendar, Google OAuth login, and 2FA for admin features in your Cal.com instance at `https://calendar.mereka.io`.

## 🔧 Prerequisites
- Your Cal.com instance is running at `https://calendar.mereka.io`
- Admin access to your Cal.com instance
- Access to Zoom Marketplace and Google Cloud Console

---

## 🔐 2FA SETUP FOR ADMIN FEATURES

### ⚠️ **IMPORTANT: 2FA is REQUIRED for Admin Access**
Cal.com requires **Two-Factor Authentication (2FA) to be enabled** for users to access admin features. Without 2FA, admin users are downgraded to `INACTIVE_ADMIN` role.

### Step 1: Enable 2FA for Your Admin User
1. **Login** to `https://calendar.mereka.io`
2. Go to **Settings** → **Security** → **Two-factor authentication**
3. **Click "Enable"** to start 2FA setup
4. **Enter your current password** to confirm

### Step 2: Complete 2FA Setup
1. **Scan the QR code** with an authenticator app:
   - Google Authenticator
   - Authy
   - Microsoft Authenticator
   - Any TOTP-compatible app
2. **Enter the 6-digit code** from your authenticator app
3. **Save your backup codes** (10 codes for account recovery)
4. **Click "Enable"** to complete setup

### Step 3: Verify Admin Access
1. **Logout and login again** with 2FA
2. **Check your role** - should now show as `ADMIN` instead of `INACTIVE_ADMIN`
3. **Access admin features** from the admin panel

### 🔍 **2FA Troubleshooting**
- **"Third-party identity provider"**: You need to set a password first
- **"User missing password"**: Set a password in your profile before enabling 2FA
- **"Incorrect 2FA code"**: Ensure your authenticator app time is synchronized

---

## 📹 ZOOM INTEGRATION

### Step 1: Create Zoom App
1. Go to [Zoom Marketplace](https://marketplace.zoom.us/)
2. Sign in with your Zoom account
3. Click **"Develop"** → **"Build App"**
4. Select **"OAuth"** → **"Create"**

### Step 2: Configure Zoom App
1. **App Name**: `Cal.com Integration` (or any name you prefer)
2. **App Type**: Select **"User-managed app"**
3. **Marketplace Visibility**: **Uncheck** "Publish on Zoom App Marketplace"

### Step 3: Set OAuth Redirect URL
- **Redirect URL**: `https://calendar.mereka.io/api/integrations/zoomvideo/callback`
- Add to **Allow List** and enable **"Subdomain check"**
- Ensure it shows "saved" below the form

### Step 4: Configure Scopes
1. Go to **"Scopes"** → **"+ Add Scopes"**
2. Select **"Meeting"** category
3. Check: `meeting:write`
4. Click **"Done"**

### Step 5: Get Credentials
1. Copy the **Client ID** and **Client Secret**
2. Set these environment variables in Cloud Run:
   ```bash
   ZOOM_CLIENT_ID=your_zoom_client_id
   ZOOM_CLIENT_SECRET=your_zoom_client_secret
   ```

---

## 📅 GOOGLE CALENDAR INTEGRATION

### Step 1: Enable Google APIs
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/dashboard)
2. Create a new project or select existing one
3. Search for **"Google Calendar API"** and enable it

### Step 2: Configure OAuth Consent Screen
1. Go to **"OAuth consent screen"**
2. **User Type**: Choose **"External"** (or "Internal" if using Google Workspace)
3. Fill in basic app information
4. **Scopes**: Add these scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/userinfo.profile`

### Step 3: Create OAuth Credentials
1. Go to **"Credentials"** → **"Create Credentials"** → **"OAuth 2.0 Client IDs"**
2. **Application Type**: **"Web application"**
3. **Authorized Redirect URIs**:
   - `https://calendar.mereka.io/api/integrations/googlecalendar/callback`
   - `https://calendar.mereka.io/api/auth/callback/google`

### Step 4: Download Credentials
1. Download the **OAuth Client ID JSON** file
2. Copy the entire JSON content
3. Set this environment variable in Cloud Run:
   ```bash
   GOOGLE_API_CREDENTIALS='{"web":{"client_id":"...","client_secret":"...","redirect_uris":["..."]}}'
   ```

---

## 🔑 GOOGLE OAUTH LOGIN

### Step 1: Enable Google Login
1. In the same Google Cloud project, ensure you have the OAuth consent screen configured
2. Add the redirect URI: `https://calendar.mereka.io/api/auth/callback/google`
3. **Publish your app** in the OAuth consent screen

### Step 2: Set Environment Variables
Add these to your Cloud Run service:
```bash
GOOGLE_LOGIN_ENABLED=true
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### Step 3: Test Google Login
1. **Logout** of your Cal.com instance
2. **Click "Sign in with Google"** on the login page
3. **Complete OAuth flow** with your Google account
4. **Verify login** works correctly

---

## 🚀 DEPLOYMENT STEPS

⚠️ **IMPORTANT**: For production deployment, use the comprehensive guides:
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - Complete deployment process with troubleshooting
- **[WORKING_CONFIG.md](./WORKING_CONFIG.md)** - Exact working configuration reference
- **[deploy-calcom.sh](./deploy-calcom.sh)** - Automated deployment script

### Quick Deployment (Automated)
```bash
# Run the automated deployment script
./deploy-calcom.sh
```

### Manual Deployment Steps
1. **Create environment variables file** (see DEPLOYMENT_GUIDE.md for complete list)
2. **Deploy to Cloud Run with proper memory allocation** (minimum 2GB)
3. **Set up domain mappings**
4. **Configure DNS in Cloudflare** (gray cloud, not orange!)
5. **Wait for SSL certificate provisioning**

### Step 2: Repopulate App Store
```bash
cd /Users/agent-g/cal.com
yarn workspace @calcom/prisma db-seed
```

### Step 3: Test Integrations
1. Go to `https://calendar.mereka.io/settings/apps`
2. Look for Zoom and Google Calendar in the app store
3. Click "Install" and follow the OAuth flow

---

## ✅ VERIFICATION CHECKLIST

### 2FA Setup:
- [ ] 2FA enabled for admin user
- [ ] Authenticator app configured
- [ ] Backup codes saved
- [ ] Admin role shows as `ADMIN` (not `INACTIVE_ADMIN`)
- [ ] Admin features accessible

### Zoom Integration:
- [ ] Zoom app created with correct redirect URL
- [ ] Environment variables set
- [ ] App store repopulated
- [ ] Zoom integration visible in Cal.com settings

### Google Calendar Integration:
- [ ] Google Calendar API enabled
- [ ] OAuth consent screen configured
- [ ] OAuth credentials created with correct redirect URIs
- [ ] Environment variables set
- [ ] Google Calendar integration visible in app store

### Google OAuth Login:
- [ ] Google login enabled
- [ ] Environment variables set
- [ ] OAuth consent screen published
- [ ] Google login button visible on login page
- [ ] OAuth flow working correctly

---

## 🆘 TROUBLESHOOTING

⚠️ **For deployment issues, see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for comprehensive troubleshooting**

### Common Deployment Failures:
1. **503/500 errors**: Usually missing environment variables or insufficient memory
2. **"Please set NEXTAUTH_SECRET"**: Environment variables not applied to active revision
3. **Prisma DATABASE_DIRECT_URL missing**: Missing DATABASE_DIRECT_URL environment variable
4. **Memory exceeded**: Need at least 2GB memory allocation
5. **Custom domain 503**: DNS misconfigured in Cloudflare (must be gray cloud)

### 2FA Issues:
1. **"Third-party identity provider"**: Set a password in your profile first
2. **"User missing password"**: Add password before enabling 2FA
3. **"Incorrect 2FA code"**: Check authenticator app time sync

### Integration Issues:
1. **"Invalid redirect URI"**: Double-check redirect URLs match exactly
2. **"OAuth consent screen not configured"**: Ensure consent screen is published
3. **"API not enabled"**: Verify Google Calendar API is enabled
4. **"Client ID/Secret missing"**: Check environment variables are set correctly

### Debug Steps:
1. Check Cloud Run logs: `gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=calcom-app-prod' --limit=20 --freshness=10m`
2. Verify environment variables: `gcloud run revisions describe REVISION_NAME --region=us-central1 --format="yaml(spec.containers[0].env)"`
3. Test service endpoints: `curl -I SERVICE_URL` and `curl -I SERVICE_URL/auth/login`
4. Check domain mapping status: `gcloud beta run domain-mappings describe --domain=calendar.mereka.io --region=us-central1`

---

## 📞 SUPPORT
- [Cal.com Documentation](https://developer.cal.com/)
- [GitHub Issues](https://github.com/calcom/cal.com/issues)
- [Community Discord](https://cal.com/discord)
