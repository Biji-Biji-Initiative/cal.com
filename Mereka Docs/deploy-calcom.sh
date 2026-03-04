#!/bin/bash

# Cal.com Automated Deployment Script
# This script deploys Cal.com to Google Cloud Run with proper configuration
# Based on the working configuration from August 25, 2025

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="biji-biji-calcom-250825084322"
REGION="us-central1"
SERVICE_NAME="calcom-app-prod"
CLOUDSQL_INSTANCE="biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517"
DOMAIN="calendar.mereka.io"
SECONDARY_DOMAIN="cal.mereka.io"

# Database configuration
DB_USER="caluser"
DB_PASS="DWVdkG9MhMWu24HPCv0Gv0n"
DB_NAME="calendso"

# Google OAuth configuration
GOOGLE_CLIENT_ID="840643300842-tkj3l0cfmkjspk34bpr68h70c9qf60f1.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="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"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if gcloud is installed and authenticated
    if ! command -v gcloud &> /dev/null; then
        log_error "gcloud CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check if authenticated
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
        log_error "Not authenticated with gcloud. Please run 'gcloud auth login'"
        exit 1
    fi
    
    # Check if project exists
    if ! gcloud projects describe $PROJECT_ID &> /dev/null; then
        log_error "Project $PROJECT_ID not found or not accessible"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

generate_secrets() {
    log_info "Generating secure secrets..."
    
    NEXTAUTH_SECRET=$(openssl rand -base64 32)
    CALENDSO_ENCRYPTION_KEY=$(openssl rand -hex 16)
    CALCOM_DEPLOYMENT_KEY=$(openssl rand -hex 32)
    
    # White-labeling configuration
    NEXT_PUBLIC_APP_NAME="Mereka Calendar"
    NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS="support@mereka.io"
    NEXT_PUBLIC_COMPANY_NAME="Mereka"
    NEXT_PUBLIC_SENDER_ID="Mereka"
    NEXT_PUBLIC_SENDGRID_SENDER_NAME="Mereka Calendar"
    
    log_success "Secrets and branding generated"
}

create_env_file() {
    log_info "Creating environment variables file..."
    
    # Create the Google API credentials JSON (properly escaped)
    GOOGLE_API_CREDENTIALS='{"web":{"client_id":"'$GOOGLE_CLIENT_ID'","client_secret":"'$GOOGLE_CLIENT_SECRET'","redirect_uris":["https://'$DOMAIN'/api/integrations/googlecalendar/callback","https://'$DOMAIN'/api/auth/callback/google","https://'$SECONDARY_DOMAIN'/api/integrations/googlecalendar/callback","https://'$SECONDARY_DOMAIN'/api/auth/callback/google"]}}'
    
    # Create database connection string
    DATABASE_CONNECTION="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?host=/cloudsql/$CLOUDSQL_INSTANCE&sslmode=disable"
    
    cat > env-vars.yaml << EOF
NEXTAUTH_SECRET: "$NEXTAUTH_SECRET"
CALENDSO_ENCRYPTION_KEY: "$CALENDSO_ENCRYPTION_KEY"
NEXTAUTH_URL: "https://$DOMAIN"
WEB_APP_URL: "https://$DOMAIN"
NEXT_PUBLIC_WEBAPP_URL: "https://$DOMAIN"
NEXT_PUBLIC_WEBSITE_URL: "https://$DOMAIN"
BASE_URL: "https://$DOMAIN"
NEXT_PUBLIC_BASE_URL: "https://$DOMAIN"
DATABASE_URL: "$DATABASE_CONNECTION"
DATABASE_DIRECT_URL: "$DATABASE_CONNECTION"
GOOGLE_CLIENT_ID: "$GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET: "$GOOGLE_CLIENT_SECRET"
GOOGLE_LOGIN_ENABLED: "true"
GOOGLE_API_CREDENTIALS: '$GOOGLE_API_CREDENTIALS'
CALCOM_DEPLOYMENT_KEY: "$CALCOM_DEPLOYMENT_KEY"
CALCOM_LICENSE_KEY: "1a1f8138-0bfc-4f37-b4af-1e24fd145839"

# White-labeling Configuration
NEXT_PUBLIC_APP_NAME: "Mereka Calendar"
NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS: "support@mereka.io"
NEXT_PUBLIC_COMPANY_NAME: "Mereka"
NEXT_PUBLIC_SENDER_ID: "Mereka"
NEXT_PUBLIC_SENDGRID_SENDER_NAME: "Mereka Calendar"

# API Configuration
API_KEY_PREFIX: "mereka_"
EOF
    
    log_success "Environment variables file created"
}

deploy_service() {
    log_info "Deploying to Cloud Run..."
    
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
    
    log_success "Service deployed successfully"
}

verify_deployment() {
    log_info "Verifying deployment..."
    
    # Get active revision
    REVISION=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.traffic[0].revisionName)")
    log_info "Active revision: $REVISION"
    
    # Check environment variables count
    ENV_COUNT=$(gcloud run revisions describe $REVISION --region=$REGION --project=$PROJECT_ID --format="yaml(spec.containers[0].env)" | grep "name:" | wc -l | tr -d ' ')
    if [ "$ENV_COUNT" -eq 23 ]; then
        log_success "All 23 environment variables are set"
    else
        log_error "Expected 23 environment variables, found $ENV_COUNT"
        exit 1
    fi
    
    # Check memory allocation
    MEMORY=$(gcloud run revisions describe $REVISION --region=$REGION --project=$PROJECT_ID --format="value(spec.containers[0].resources.limits.memory)")
    if [ "$MEMORY" = "2048Mi" ]; then
        log_success "Memory allocation is correct: $MEMORY"
    else
        log_error "Expected 2048Mi memory, found $MEMORY"
        exit 1
    fi
    
    # Test service endpoints
    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.url)")
    
    log_info "Testing service endpoints..."
    
    # Test root endpoint
    ROOT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL")
    if [ "$ROOT_STATUS" = "307" ]; then
        log_success "Root endpoint returns 307 (expected redirect)"
    else
        log_error "Root endpoint returned $ROOT_STATUS, expected 307"
        exit 1
    fi
    
    # Test auth login endpoint
    LOGIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/auth/login")
    if [ "$LOGIN_STATUS" = "200" ]; then
        log_success "Auth login endpoint returns 200"
    else
        log_error "Auth login endpoint returned $LOGIN_STATUS, expected 200"
        exit 1
    fi
    
    log_success "Service verification completed"
}

setup_domain_mapping() {
    log_info "Setting up domain mappings..."
    
    # Check if domain mappings already exist and delete them
    if gcloud beta run domain-mappings describe --domain=$DOMAIN --region=$REGION --project=$PROJECT_ID &> /dev/null; then
        log_warning "Existing domain mapping found for $DOMAIN, deleting..."
        gcloud beta run domain-mappings delete --domain=$DOMAIN --region=$REGION --project=$PROJECT_ID --quiet
    fi
    
    if gcloud beta run domain-mappings describe --domain=$SECONDARY_DOMAIN --region=$REGION --project=$PROJECT_ID &> /dev/null; then
        log_warning "Existing domain mapping found for $SECONDARY_DOMAIN, deleting..."
        gcloud beta run domain-mappings delete --domain=$SECONDARY_DOMAIN --region=$REGION --project=$PROJECT_ID --quiet
    fi
    
    # Create new domain mappings
    log_info "Creating domain mapping for $DOMAIN..."
    gcloud beta run domain-mappings create --domain=$DOMAIN --service=$SERVICE_NAME --region=$REGION --project=$PROJECT_ID
    
    log_info "Creating domain mapping for $SECONDARY_DOMAIN..."
    gcloud beta run domain-mappings create --domain=$SECONDARY_DOMAIN --service=$SERVICE_NAME --region=$REGION --project=$PROJECT_ID
    
    log_success "Domain mappings created"
}

show_dns_instructions() {
    log_warning "IMPORTANT: DNS Configuration Required"
    echo ""
    echo "You must update your DNS settings in Cloudflare:"
    echo ""
    echo "1. Go to Cloudflare Dashboard → Your domain"
    echo "2. Update these DNS records:"
    echo ""
    echo "   Record 1:"
    echo "   - Type: CNAME"
    echo "   - Name: calendar"
    echo "   - Target: ghs.googlehosted.com"
    echo "   - Proxy: DNS only (gray cloud) ← CRITICAL!"
    echo ""
    echo "   Record 2:"
    echo "   - Type: CNAME"
    echo "   - Name: cal"
    echo "   - Target: ghs.googlehosted.com"
    echo "   - Proxy: DNS only (gray cloud) ← CRITICAL!"
    echo ""
    echo "3. Wait 5-10 minutes for DNS propagation"
    echo "4. Test with: curl -I https://$DOMAIN"
    echo ""
}

cleanup() {
    log_info "Cleaning up temporary files..."
    rm -f env-vars.yaml
    log_success "Cleanup completed"
}

show_summary() {
    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.url)")
    
    echo ""
    log_success "🎉 Deployment completed successfully!"
    echo ""
    echo "Service Details:"
    echo "- Service Name: $SERVICE_NAME"
    echo "- Service URL: $SERVICE_URL"
    echo "- Memory: 2048Mi"
    echo "- Environment Variables: 14"
    echo ""
    echo "Custom Domains (after DNS configuration):"
    echo "- Primary: https://$DOMAIN"
    echo "- Secondary: https://$SECONDARY_DOMAIN"
    echo ""
    echo "Next Steps:"
    echo "1. Configure DNS in Cloudflare (see instructions above)"
    echo "2. Wait for SSL certificate provisioning"
    echo "3. Test Google OAuth login"
    echo ""
}

# Main execution
main() {
    echo ""
    log_info "🚀 Starting Cal.com deployment..."
    echo ""
    
    check_prerequisites
    generate_secrets
    create_env_file
    deploy_service
    verify_deployment
    setup_domain_mapping
    show_dns_instructions
    cleanup
    show_summary
    
    log_success "Deployment script completed!"
}

# Handle script interruption
trap cleanup EXIT

# Run main function
main "$@"
