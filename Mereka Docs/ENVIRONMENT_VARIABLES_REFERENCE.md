# Cal.com Environment Variables Reference

## Complete List of All 22 Environment Variables

### Core Authentication & Security
- `NEXTAUTH_SECRET` - NextAuth.js session encryption key
- `CALENDSO_ENCRYPTION_KEY` - Application encryption key (32 bytes for AES256)
- `CALCOM_DEPLOYMENT_KEY` - Internal signature verification key
- `CAL_SIGNATURE_TOKEN` - Signature token for deployment verification
- `CALCOM_LICENSE_KEY` - Cal.com license key (staging: REPLACE_WITH_CALCOM_LICENSE_KEY)
- `NEXT_PUBLIC_IS_E2E` - Development mode flag (bypasses license validation)

### URLs & Base Configuration
- `NEXTAUTH_URL` - NextAuth.js callback URL
- `WEB_APP_URL` - Main application URL
- `NEXT_PUBLIC_WEBAPP_URL` - Public webapp URL
- `NEXT_PUBLIC_WEBSITE_URL` - Public website URL
- `BASE_URL` - Base application URL
- `NEXT_PUBLIC_BASE_URL` - Public base URL

### Database Configuration
- `DATABASE_URL` - Primary database connection string
- `DATABASE_DIRECT_URL` - Direct database connection string

### Google OAuth Integration
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_LOGIN_ENABLED` - Enable Google login (true/false)
- `GOOGLE_API_CREDENTIALS` - Google API credentials JSON

### White-labeling Configuration
- `NEXT_PUBLIC_APP_NAME` - Application name (Mereka Calendar)
- `NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS` - Support email (support@mereka.io)
- `NEXT_PUBLIC_COMPANY_NAME` - Company name (Mereka)
- `NEXT_PUBLIC_SENDER_ID` - Sender ID (Mereka)
- `NEXT_PUBLIC_SENDGRID_SENDER_NAME` - Email sender name (Mereka Calendar)
- `API_KEY_PREFIX` - API key prefix (mereka_)

## Current Values (Production)

```yaml
NEXTAUTH_SECRET: "REPLACE_WITH_NEXTAUTH_SECRET"
CALENDSO_ENCRYPTION_KEY: "REPLACE_WITH_CALENDSO_ENCRYPTION_KEY"
NEXTAUTH_URL: "https://calendar.mereka.io"
WEB_APP_URL: "https://calendar.mereka.io"
NEXT_PUBLIC_WEBAPP_URL: "https://calendar.mereka.io"
NEXT_PUBLIC_WEBSITE_URL: "https://calendar.mereka.io"
BASE_URL: "https://calendar.mereka.io"
NEXT_PUBLIC_BASE_URL: "https://calendar.mereka.io"
DATABASE_URL: "postgresql://caluser:REPLACE_WITH_DB_PASSWORD@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable"
DATABASE_DIRECT_URL: "postgresql://caluser:REPLACE_WITH_DB_PASSWORD@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable"
GOOGLE_CLIENT_ID: "REPLACE_WITH_GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET: "REPLACE_WITH_GOOGLE_CLIENT_SECRET"
GOOGLE_LOGIN_ENABLED: "true"
GOOGLE_API_CREDENTIALS: '{"web":{"client_id":"REPLACE_WITH_GOOGLE_CLIENT_ID","client_secret":"REPLACE_WITH_GOOGLE_CLIENT_SECRET","redirect_uris":["https://calendar.mereka.io/api/integrations/googlecalendar/callback","https://calendar.mereka.io/api/auth/callback/google","https://cal.mereka.io/api/integrations/googlecalendar/callback","https://cal.mereka.io/api/auth/callback/google"]}}'
CALCOM_DEPLOYMENT_KEY: "REPLACE_WITH_CALCOM_DEPLOYMENT_KEY"
CALCOM_LICENSE_KEY: "REPLACE_WITH_CALCOM_LICENSE_KEY"
CAL_SIGNATURE_TOKEN: "REPLACE_WITH_CALCOM_DEPLOYMENT_KEY"
NEXT_PUBLIC_APP_NAME: "Mereka Calendar"
NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS: "support@mereka.io"
NEXT_PUBLIC_COMPANY_NAME: "Mereka"
NEXT_PUBLIC_SENDER_ID: "Mereka"
NEXT_PUBLIC_SENDGRID_SENDER_NAME: "Mereka Calendar"
API_KEY_PREFIX: "mereka_"
```

## Deployment Status

- **Service**: `calcom-app-prod` (revision 00008-68c)
- **Environment Variables**: 23/23 ✅
- **Memory**: 2048Mi ✅
- **Database**: Connected ✅
- **Custom Domain**: `https://calendar.mereka.io` ✅
- **White-labeling**: Active ✅
- **TRPC API**: Working ✅

## Files

- **Production Config**: `env-vars-production.yaml` ✅
- **Deployment Script**: `deploy-calcom.sh` ✅
- **Documentation**: `WORKING_CONFIG.md`, `DEPLOYMENT_GUIDE.md` ✅

## Notes

- The `env-vars-production.yaml` file contains all production values
- Never delete this file - it's essential for deployments
- All 22 environment variables are required for full functionality
- White-labeling is now active with Mereka branding
- TRPC errors have been resolved
