#!/bin/bash

# Cal.com API v2 Deployment Script
# This script builds and deploys the API v2 service to Google Cloud Run.
# Do not commit real secrets in env files. Use Infisical or your secret manager.

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration (override with environment variables when needed)
PROJECT_ID="${PROJECT_ID:-REPLACE_WITH_GCP_PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-calcom-api-v2}"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/env-vars-api-v2.yaml}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-REPLACE_WITH_PROJECT:REGION:INSTANCE}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-gcr.io/${PROJECT_ID}/${SERVICE_NAME}}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)}"
IMAGE_NAME="${IMAGE_REPOSITORY}:${IMAGE_TAG}"

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

    if grep -Eq "REPLACE_WITH_|<set-in-infisical>" "$ENV_FILE"; then
        log_error "Environment file still contains placeholders. Resolve secrets before deploying."
        exit 1
    fi

    if [[ "$PROJECT_ID" == "REPLACE_WITH_GCP_PROJECT_ID" ]]; then
        log_error "PROJECT_ID is not configured."
        exit 1
    fi

    if [[ "$CLOUDSQL_INSTANCE" == "REPLACE_WITH_PROJECT:REGION:INSTANCE" ]]; then
        log_error "CLOUDSQL_INSTANCE is not configured."
        exit 1
    fi
    
    log_info "Prerequisites check passed ✅"
}

# Build the API v2 service
build_api_v2() {
    log_info "Building API v2 service..."
    
    cd "${ROOT_DIR}"
    cd apps/api/v2
    log_info "Installing dependencies..."
    yarn install --immutable
    
    log_info "Building service..."
    yarn workspace @calcom/api-v2 run build
    
    # Check if build was successful
    if [ ! -d "dist" ]; then
        log_error "Build failed! dist directory not found."
        exit 1
    fi
    
    log_info "API v2 build completed ✅"
    cd "${ROOT_DIR}"
}

# Build Docker image
build_docker_image() {
    log_info "Building Docker image..."
    
    # Database credentials belong in runtime env vars, not Docker build args.
    docker build -t "$IMAGE_NAME" -f apps/api/v2/Dockerfile .
    
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
    
    gcloud config set project "$PROJECT_ID" >/dev/null

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
        --add-cloudsql-instances "$CLOUDSQL_INSTANCE" \
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
    log_info "Using image: ${IMAGE_NAME}"
    
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


