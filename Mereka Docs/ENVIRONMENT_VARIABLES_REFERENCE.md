# Cal.com Environment Variables Reference

## Deployment Environment Variable Reference

### Core Authentication & Security
- `NEXTAUTH_SECRET` - NextAuth.js session encryption key
- `CALENDSO_ENCRYPTION_KEY` - Application encryption key (32 bytes for AES256)
- `CAL_SIGNATURE_TOKEN` - Signature token for deployment verification
- `CALCOM_LICENSE_KEY` - Cal.com license key (staging: REPLACE_WITH_CALCOM_LICENSE_KEY)
- `NEXT_PUBLIC_IS_E2E` - Development mode flag (bypasses license validation)

### URLs & Base Configuration
- `NEXTAUTH_URL` - NextAuth.js callback URL
- `WEB_APP_URL` - Main application URL
- `NEXT_PUBLIC_WEBAPP_URL` - Public webapp URL
- `NEXT_PUBLIC_WEBSITE_URL` - Public website URL

### Database Configuration
- `DATABASE_URL` - Primary database connection string
- `DATABASE_DIRECT_URL` - Direct database connection string

### Google OAuth Integration
- `GOOGLE_LOGIN_ENABLED` - Enable Google login (true/false)
- `GOOGLE_API_CREDENTIALS` - Google API credentials JSON

### Authentik / SSO Integration
- `SAML_DATABASE_URL` - SSO metadata database connection
- `SAML_ADMINS` - Comma-separated admin emails allowed to configure SSO

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
DATABASE_URL: "postgresql://caluser:REPLACE_WITH_DB_PASSWORD@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable"
DATABASE_DIRECT_URL: "postgresql://caluser:REPLACE_WITH_DB_PASSWORD@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable"
GOOGLE_LOGIN_ENABLED: "true"
GOOGLE_API_CREDENTIALS: '{"web":{"client_id":"REPLACE_WITH_GOOGLE_CLIENT_ID.apps.googleusercontent.com","client_secret":"REPLACE_WITH_GOOGLE_CLIENT_SECRET","redirect_uris":["https://calendar.mereka.io/api/integrations/googlecalendar/callback","https://calendar.mereka.io/api/auth/callback/google","https://cal.mereka.io/api/integrations/googlecalendar/callback","https://cal.mereka.io/api/auth/callback/google"]}}'
CALCOM_LICENSE_KEY: "REPLACE_WITH_CALCOM_LICENSE_KEY"
CAL_SIGNATURE_TOKEN: "REPLACE_WITH_CAL_SIGNATURE_TOKEN"
NEXT_PUBLIC_APP_NAME: "Mereka Calendar"
NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS: "support@mereka.io"
NEXT_PUBLIC_COMPANY_NAME: "Mereka"
NEXT_PUBLIC_SENDER_ID: "Mereka"
NEXT_PUBLIC_SENDGRID_SENDER_NAME: "Mereka Calendar"
API_KEY_PREFIX: "mereka_"
SAML_DATABASE_URL: "postgresql://REPLACE_WITH_SAML_DB_USER:REPLACE_WITH_SAML_DB_PASSWORD@REPLACE_WITH_SAML_DB_HOST:5432/REPLACE_WITH_SAML_DB_NAME"
SAML_ADMINS: "admin@example.com"
```

## Expected Deployment Status

- **Service**: `calcom-app-prod` is healthy and serving traffic.
- **Environment Variables**: Required keys are present and pass `scripts/verify-calcom-env.sh`.
- **Memory**: 2048Mi (or higher) configured.
- **Database**: Connection and migrations healthy.
- **Custom Domain**: `https://calendar.mereka.io` reachable.
- **TRPC/API**: Core app flows and API endpoints healthy.

## Files

- **Production Config**: `env-vars-production.example.yaml` ✅
- **Deployment Script**: `deploy-calcom.sh` ✅
- **Documentation**: `WORKING_CONFIG.md`, `DEPLOYMENT_GUIDE.md` ✅

## Notes

- The `env-vars-production.example.yaml` file contains all production values
- Never delete this file - it's essential for deployments
- All required environment variables should be validated before deploy using `scripts/verify-calcom-env.sh`
- White-labeling is now active with Mereka branding
- TRPC errors have been resolved
