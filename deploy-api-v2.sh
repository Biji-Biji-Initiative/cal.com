#!/usr/bin/env bash

# Cal.com API v2 deployment helper for Cloud Run.
# Keep secrets in Secret Manager/Infisical and pass runtime config via --env-vars-file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

# Configuration (override via environment variables)
PROJECT_ID="${PROJECT_ID:-REPLACE_WITH_GCP_PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-calcom-api-v2}"
IMAGE_NAME="${IMAGE_NAME:-gcr.io/${PROJECT_ID}/calcom-api-v2}"
ENV_FILE="${ENV_FILE:-env-vars-api-v2.example.yaml}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-}"

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
    
    local env_file_path="$REPO_ROOT/$ENV_FILE"
    if [ ! -f "$env_file_path" ]; then
        log_error "Environment file $env_file_path not found!"
        exit 1
    fi

    if [[ "$PROJECT_ID" == "REPLACE_WITH_GCP_PROJECT_ID" ]]; then
        log_error "Set PROJECT_ID before deploying."
        exit 1
    fi

    log_info "Validating environment file..."
    if ! "$REPO_ROOT/scripts/verify-calcom-env.sh" "$env_file_path" --profile api-v2; then
        log_error "Environment preflight failed. Fix $ENV_FILE before deployment."
        exit 1
    fi
    
    log_info "Prerequisites check passed ✅"
}

# Build the API v2 service
build_api_v2() {
    log_info "Building API v2 service..."

    cd "$REPO_ROOT"

    log_info "Installing dependencies..."
    yarn install --immutable

    log_info "Building service..."
    yarn workspace @calcom/api-v2 run build

    # Check if build was successful
    if [ ! -d "dist/apps/api/v2" ] && [ ! -d "apps/api/v2/dist" ]; then
        log_error "Build failed! API v2 dist directory not found."
        exit 1
    fi

    log_info "API v2 build completed ✅"
}

# Build Docker image
build_docker_image() {
    log_info "Building Docker image..."

    cd "$REPO_ROOT"
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

    cloudsql_args=()
    if [ -n "$CLOUDSQL_INSTANCE" ]; then
        cloudsql_args+=(--add-cloudsql-instances "$CLOUDSQL_INSTANCE")
    fi

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
        --env-vars-file "$REPO_ROOT/$ENV_FILE" \
        "${cloudsql_args[@]}" \
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

