# 🚀 Cal.com Quick Start Guide

## 🎯 **What You Need to Do Right Now**

### 1. 🔐 **ENABLE 2FA FOR ADMIN ACCESS (REQUIRED)**
**Without 2FA, you cannot access admin features!**

1. **Login** to `https://calendar.mereka.io`
2. Go to **Settings** → **Security** → **Two-factor authentication**
3. **Click "Enable"** and follow the setup process
4. **Scan QR code** with Google Authenticator/Authy
5. **Enter 6-digit code** to complete setup
6. **Save backup codes** for account recovery

### 2. 🔑 **SETUP GOOGLE OAUTH LOGIN**
1. **Get Google credentials** from [Google Cloud Console](https://console.cloud.google.com/)
2. **Run the setup script**: `./setup-integrations.sh`
3. **Test Google login** by logging out and clicking "Sign in with Google"

### 3. 📱 **SETUP ZOOM & GOOGLE CALENDAR**
1. **Get Zoom credentials** from [Zoom Marketplace](https://marketplace.zoom.us/)
2. **Run the setup script**: `./setup-integrations.sh`
3. **Install integrations** from `https://calendar.mereka.io/settings/apps`

---

## ⚡ **Quick Commands**

```bash
# Run integration setup (Cloud Run env update)
./setup-integrations.sh

# Check service status (set these first)
SERVICE_NAME="REPLACE_WITH_SERVICE_NAME"
REGION="REPLACE_WITH_REGION"
PROJECT_ID="REPLACE_WITH_PROJECT_ID"
gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID"

# View logs
gcloud run services logs read "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID"
```

---

## 🔍 **Troubleshooting Quick Fixes**

### **2FA Issues:**
- **"Third-party identity provider"**: Set a password in your profile first
- **"User missing password"**: Add password before enabling 2FA

### **Integration Issues:**
- **"Invalid redirect URI"**: Use exact URLs from the setup guide
- **"OAuth consent screen not configured"**: Publish your Google app

---

## 📚 **Full Documentation**
- **Rollout Runbook**: `docs/runbooks/upstream-sync-and-rollout.md`
- **Complete Integration Guide**: `Mereka Docs/INTEGRATION_SETUP.md`
- **Deployment Guide**: `DEPLOYMENT_GUIDE.md`
- **Automated Script**: `setup-integrations.sh`

---

## 🎉 **Success Checklist**
- [ ] 2FA enabled and working
- [ ] Admin role shows as `ADMIN` (not `INACTIVE_ADMIN`)
- [ ] Google login button visible
- [ ] Zoom integration installed
- [ ] Google Calendar integration installed
- [ ] All OAuth flows working

**Need help?** Check `Mereka Docs/INTEGRATION_SETUP.md` for detailed troubleshooting steps.
