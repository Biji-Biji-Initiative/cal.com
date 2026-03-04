#!/bin/bash

# Cal.com Integration Setup Script
# Run this after you've obtained your Zoom and Google credentials

echo "🚀 Cal.com Integration Setup Script"
echo "=================================="
echo ""

# Check if running from correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the cal.com directory"
    exit 1
fi

# Function to prompt for input
prompt_input() {
    local prompt="$1"
    local var_name="$2"
    local is_secret="$3"
    
    if [ "$is_secret" = "true" ]; then
        read -s -p "$prompt: " input
        echo ""
    else
        read -p "$prompt: " input
    fi
    
    if [ -n "$input" ]; then
        eval "$var_name='$input'"
    fi
}

echo "📋 Please provide your integration credentials:"
echo ""

# Zoom credentials
prompt_input "Zoom Client ID" "ZOOM_CLIENT_ID" false
prompt_input "Zoom Client Secret" "ZOOM_CLIENT_SECRET" true

# Google credentials
prompt_input "Google Client ID" "GOOGLE_CLIENT_ID" false
prompt_input "Google Client Secret" "GOOGLE_CLIENT_SECRET" true
prompt_input "Google API Credentials JSON (paste the entire JSON)" "GOOGLE_API_CREDENTIALS" false

echo ""
echo "🔧 Updating Cloud Run environment variables..."

# Update Cloud Run service with new environment variables
gcloud run services update calcom-app --region=us-central1 \
  --update-env-vars="ZOOM_CLIENT_ID=$ZOOM_CLIENT_ID,ZOOM_CLIENT_SECRET=$ZOOM_CLIENT_SECRET,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET,GOOGLE_API_CREDENTIALS='$GOOGLE_API_CREDENTIALS',GOOGLE_LOGIN_ENABLED=true" \
  --quiet

if [ $? -eq 0 ]; then
    echo "✅ Environment variables updated successfully!"
    echo ""
    echo "🔄 Repopulating app store..."
    
    # Repopulate app store
    yarn workspace @calcom/prisma db-seed
    
    if [ $? -eq 0 ]; then
        echo "✅ App store repopulated successfully!"
        echo ""
        echo "🎉 Setup complete! Your integrations should now be available."
        echo ""
        echo "📱 Next steps:"
        echo "1. Go to https://calendar.mereka.io/settings/apps"
        echo "2. Look for Zoom and Google Calendar in the app store"
        echo "3. Click 'Install' and follow the OAuth flow"
        echo ""
        echo "🔐 IMPORTANT: Enable 2FA for admin access:"
        echo "1. Go to https://calendar.mereka.io/settings/security"
        echo "2. Enable Two-factor authentication"
        echo "3. Scan QR code with authenticator app"
        echo "4. Enter 6-digit code to complete setup"
        echo ""
        echo "🔍 If you encounter issues, check the INTEGRATION_SETUP.md file for troubleshooting steps."
    else
        echo "❌ Failed to repopulate app store. Please run manually:"
        echo "   yarn workspace @calcom/prisma db-seed"
    fi
else
    echo "❌ Failed to update environment variables. Please check your gcloud configuration."
fi
