#!/bin/bash

# Cal.com API v2 Deployment Script
# This script builds and deploys the API v2 service to Google Cloud Run

set -e

# Configuration
PROJECT_ID="biji-biji-calcom-250825084322"
REGION="us-central1"
SERVICE_NAME="calcom-api-v2"
IMAGE_NAME="gcr.io/${PROJECT_ID}/calcom-api-v2"
ENV_FILE="env-vars-api-v2.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v gcloud &> /dev/null; then
        log_error "gcloud CLI is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install it first."
        exit 1
    fi
    
    if [ ! -f "$ENV_FILE" ]; then
        log_error "Environment file $ENV_FILE not found!"
        exit 1
    fi
    
    log_info "Prerequisites check passed ✅"
}

# Build the API v2 service
build_api_v2() {
    log_info "Building API v2 service..."
    
    # Build the service
    cd apps/api/v2
    log_info "Installing dependencies..."
    yarn install
    
    log_info "Building service..."
    yarn workspace @calcom/api-v2 run build
    
    # Check if build was successful
    if [ ! -d "dist" ]; then
        log_error "Build failed! dist directory not found."
        exit 1
    fi
    
    log_info "API v2 build completed ✅"
    cd /Users/agent-g/cal.com
}

# Build Docker image
build_docker_image() {
    log_info "Building Docker image..."
    
    # Build the image
    docker build -t "$IMAGE_NAME" \
        --build-arg DATABASE_URL="postgresql://caluser:DWVdkG9MhMWu24HPCv0Gv0Gv0n@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable" \
        --build-arg DATABASE_DIRECT_URL="postgresql://caluser:DWVdkG9MhMWu24HPCv0Gv0Gv0n@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable" \
        -f apps/api/v2/Dockerfile .
    
    log_info "Docker image built successfully ✅"
}

# Push Docker image
push_docker_image() {
    log_info "Pushing Docker image to Google Container Registry..."
    
    # Configure Docker to use gcloud as a credential helper
    gcloud auth configure-docker
    
    # Push the image
    docker push "$IMAGE_NAME"
    
    log_info "Docker image pushed successfully ✅"
}

# Deploy to Cloud Run
deploy_to_cloud_run() {
    log_info "Deploying to Google Cloud Run..."
    
    # Deploy the service
    gcloud run deploy "$SERVICE_NAME" \
        --image "$IMAGE_NAME" \
        --region "$REGION" \
        --project "$PROJECT_ID" \
        --platform managed \
        --allow-unauthenticated \
        --port 8080 \
        --memory 2048Mi \
        --cpu 2 \
        --min-instances 1 \
        --max-instances 10 \
        --env-vars-file "$ENV_FILE" \
        --add-cloudsql-instances "biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517" \
        --quiet
    
    log_info "API v2 service deployed successfully ✅"
}

# Get service URL
get_service_url() {
    log_info "Getting service URL..."
    
    SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
        --region "$REGION" \
        --project "$PROJECT_ID" \
        --format "value(status.url)")
    
    log_info "API v2 service is available at: ${GREEN}$SERVICE_URL${NC}"
    log_info "API v2 documentation: ${GREEN}$SERVICE_URL/docs${NC}"
}

# Main deployment process
main() {
    log_info "Starting Cal.com API v2 deployment..."
    
    check_prerequisites
    build_api_v2
    build_docker_image
    push_docker_image
    deploy_to_cloud_run
    get_service_url
    
    log_info "🎉 API v2 deployment completed successfully!"
    log_info "Next steps:"
    log_info "1. Test the API: curl $SERVICE_URL/health"
    log_info "2. View documentation: $SERVICE_URL/docs"
    log_info "3. Update your web app to use the new API v2 endpoint"
}

# Run main function
main "$@"




