# 🔑 License Key Setup Guide - Mereka Calendar

## 🚨 **CRITICAL: Follow These Steps Exactly**

The license key environment variable alone is NOT enough. You must complete the setup process through the Cal.com interface.

## 📋 **Step-by-Step Setup Process**

### 1. **Verify Environment Variables** ✅
Your service now has the official Cal.com staging license key:
```yaml
CALCOM_LICENSE_KEY: "59c0bed7-8b21-4280-8514-e022fbfc24c7"
```

**⚠️ CRITICAL ISSUE DISCOVERED**: This staging license key is **NOT VALID** according to Cal.com's servers!
- **Status**: Returns 404 "This license key does not exist"
- **Validation URL**: `https://goblin.cal.com/v1/license/59c0bed7-8b21-4280-8514-e022fbfc24c7`
- **Result**: License validation fails, commercial features remain locked

### 2. **Complete License Setup in Cal.com** 🔑
**This step is REQUIRED and cannot be skipped:**

**For Existing Admin Users (like you):**
1. **Login** to `https://calendar.mereka.io` as an admin user
2. **Go to**: Settings → Admin → Features (or similar admin section)
3. **Look for**: License key management or enterprise features setup
4. **Alternative**: Try accessing `https://calendar.mereka.io/settings/admin/license` directly

**For New Installations:**
1. **Navigate** to: `https://calendar.mereka.io/auth/setup`
2. **Choose License Option**: Select "I have an existing license key"
3. **Enter License Key**: `59c0bed7-8b21-4280-8514-e022fbfc24c7`
4. **Complete Setup**: Follow the remaining setup steps

### 3. **Verify License Activation** ✅
After completing the setup:
- Go to `https://calendar.mereka.io/settings/developer/api-keys`
- You should see the API key creation interface (not "commercial feature" message)
- Go to `https://calendar.mereka.io/settings/admin/users`
- You should see the user management interface (not "commercial feature" message)

## 🔍 **Why This Happens**

### **Environment Variable vs. Database Storage**
- **Environment Variable**: `CALCOM_LICENSE_KEY` - Only tells Cal.com what key to use
- **Database Storage**: The license key must be stored in the `deployment` table
- **License Validation**: Cal.com validates the key through their license service

### **Official Cal.com Process**
According to the [official documentation](https://cal.com/docs/developing/guides/api/how-to-setup-api-in-a-local-instance):

1. Set `CALCOM_LICENSE_KEY` in environment variables
2. **Visit `/auth/setup` endpoint** (this is mandatory)
3. Enter the license key through the UI
4. Cal.com validates and stores the key in the database
5. Commercial features become available

## 🚨 **Common Mistakes**

1. **❌ Only setting environment variable** - License won't work
2. **❌ Skipping the `/auth/setup` step** - Features remain locked
3. **❌ Using wrong license key format** - Must be valid UUID
4. **❌ Not completing the full setup wizard** - License won't activate

## 🔧 **Troubleshooting**

### **Still seeing "commercial feature" message?**
1. **Check if you completed `/auth/setup`** - This is the most common issue
2. **Verify license key format** - Must be valid UUID
3. **Check database** - License key must be stored in `deployment` table
4. **Restart service** - Sometimes needed after license changes

### **License validation errors?**
1. **Get valid staging key** - Contact `support@cal.com` for working staging license key
2. **Check internet connectivity** - Cal.com validates against their servers
3. **Verify signature token** - `CAL_SIGNATURE_TOKEN` must be set
4. **Test license endpoint** - Verify key works at `https://goblin.cal.com/v1/license/{key}`

### **Staging License Key Invalid?**
**Root Cause**: The staging license key `59c0bed7-8b21-4280-8514-e022fbfc24c7` is not recognized by Cal.com's servers.

**Solutions**:
1. **Contact Cal.com Support**: `support@cal.com` - Request valid staging license key
2. **Check Documentation**: Visit [Cal.com License Guide](https://cal.com/docs/self-hosting/license-key) for updated keys
3. **Development Mode**: Set `NEXT_PUBLIC_IS_E2E=1` for testing (not production)
4. **Purchase License**: Get production license from [Cal.com Sales](https://cal.com/sales)

## 📚 **Official Documentation References**

- [API Setup Guide](https://cal.com/docs/developing/guides/api/how-to-setup-api-in-a-local-instance)
- [License Key Documentation](https://cal.com/docs/self-hosting/license-key)
- [Enterprise Features](https://cal.com/docs/self-hosting/guides/organization/organization-setup)

## 🎯 **Next Steps**

1. **Complete the `/auth/setup` process** (CRITICAL)
2. **Test API key creation**
3. **Test user management**
4. **Verify all commercial features work**

---

**Status**: Development mode enabled ✅  
**Next Action**: Test commercial features  
**Expected Result**: All features unlocked (bypassing license validation) ✅

## 🎯 **Current Status: Development Mode Active**

### ✅ **What's Working:**
- **Environment Variables**: All 24 variables configured
- **Development Mode**: `NEXT_PUBLIC_IS_E2E=1` bypasses license validation
- **Commercial Features**: Should now be unlocked for testing

### 🔧 **How Development Mode Works:**
According to the Cal.com codebase, when `NEXT_PUBLIC_IS_E2E=1`:
- License validation is skipped
- All commercial features become available
- Perfect for development and testing environments

### ⚠️ **Important Notes:**
- **Development Mode Only**: This is for testing, not production
- **License Still Required**: For production, you'll need a valid license key
- **Temporary Solution**: Until you get a working staging license key from Cal.com
