# 🚀 API v2 Service Setup Guide - Mereka Calendar

## 📋 **Overview**

The **Cal.com API v2** is a **separate service** from the main web application. It's a modern NestJS-based API that provides enhanced functionality and better performance than the v1 API.

### **Architecture:**
- **Web App**: `calcom-app-prod` (Next.js + v1 API) - Port 3000
- **API v2**: `calcom-api-v2` (NestJS) - Port 80 (internal)
- **Database**: Shared PostgreSQL instance
- **Deployment**: Separate Google Cloud Run services

## 🏗️ **What We Need to Deploy**

### **1. Separate Cloud Run Service**
- **Service Name**: `calcom-api-v2`
- **Port**: 80 (internal)
- **Memory**: 2048Mi (recommended)
- **CPU**: 2 (recommended)

### **2. Separate Environment Variables**
- **File**: `env-vars-api-v2.yaml`
- **Database**: Same connection strings
- **License**: Same staging key
- **API Configuration**: Specific to v2

### **3. Separate Build Process**
- **Build Command**: `yarn workspace @calcom/api-v2 run build`
- **Dockerfile**: `apps/api/v2/Dockerfile`
- **Output**: `dist/` directory

## 🚀 **Deployment Process**

### **Option 1: Automated Deployment (Recommended)**
```bash
# Make script executable
chmod +x deploy-api-v2.sh

# Run deployment
./deploy-api-v2.sh
```

### **Option 2: Manual Deployment**
```bash
# 1. Build the service
cd apps/api/v2
yarn install
yarn workspace @calcom/api-v2 run build

# 2. Build Docker image
docker build -t gcr.io/biji-biji-calcom-250825084322/calcom-api-v2 \
  --build-arg DATABASE_URL="postgresql://caluser:DWVdkG9MhMWu24HPCv0Gv0Gv0n@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable" \
  --build-arg DATABASE_DIRECT_URL="postgresql://caluser:DWVdkG9MhMWu24HPCv0Gv0Gv0n@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable" \
  -f apps/api/v2/Dockerfile .

# 3. Push to Google Container Registry
gcloud auth configure-docker
docker push gcr.io/biji-biji-calcom-250825084322/calcom-api-v2

# 4. Deploy to Cloud Run
gcloud run deploy calcom-api-v2 \
  --image gcr.io/biji-biji-calcom-250825084322/calcom-api-v2 \
  --region us-central1 \
  --project biji-biji-calcom-250825084322 \
  --platform managed \
  --allow-unauthenticated \
  --port 80 \
  --memory 2048Mi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --env-vars-file env-vars-api-v2.yaml \
  --add-cloudsql-instances biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517 \
  --quiet
```

## 🔧 **Environment Variables**

### **Required Variables for API v2:**
```yaml
# Core Configuration
NODE_ENV: "production"
API_PORT: "80"
API_URL: "https://api-v2.mereka.io"

# Database Configuration
DATABASE_READ_URL: "postgresql://caluser:DWVdkG9MhMWu24HPCv0Gv0Gv0n@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable"
DATABASE_WRITE_URL: "postgresql://caluser:DWVdkG9MhMWu24HPCv0Gv0Gv0n@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable"
DATABASE_URL: "postgresql://caluser:DWVdkG9MhMWu24HPCv0Gv0Gv0n@localhost:5432/calendso?host=/cloudsql/biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517&sslmode=disable"

# Authentication
NEXTAUTH_SECRET: "84T2YRb6IYGmzdn61ori7D1CMCUzHEnOjivvicWJVXk="
JWT_SECRET: "84T2YRb6IYGmzdn61ori7D1CMCUzHEnOjivvicWJVXk="

# Cal.com Configuration
WEB_APP_URL: "https://calendar.mereka.io"
CALCOM_LICENSE_KEY: "59c0bed7-8b21-4280-8514-e022fbfc24c7"
API_KEY_PREFIX: "mereka_"
IS_E2E: "true"

# API v2 Specific
REWRITE_API_V2_PREFIX: "1"
DOCS_URL: "https://api-v2.mereka.io/docs"
```

## 🌐 **DNS Configuration**

### **Required DNS Records:**
```bash
# API v2 subdomain
api-v2.mereka.io CNAME ghs.googlehosted.com

# Important: Use "DNS only" (gray cloud) in Cloudflare
# NOT "Proxied" (orange cloud)
```

### **Cloudflare Settings:**
1. **DNS Record**: `api-v2.mereka.io` → `ghs.googlehosted.com`
2. **Proxy Status**: DNS only (gray cloud)
3. **TTL**: Auto or 300 seconds

## 🔍 **Verification & Testing**

### **1. Service Health Check**
```bash
# Get service URL
gcloud run services describe calcom-api-v2 \
  --region us-central1 \
  --project biji-biji-calcom-250825084322 \
  --format "value(status.url)"

# Test health endpoint
curl https://api-v2.mereka.io/health
```

### **2. API Documentation**
```bash
# Swagger/OpenAPI docs
open https://api-v2.mereka.io/docs
```

### **3. Database Connection**
```bash
# Check logs for database connection
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=calcom-api-v2' \
  --limit=10 \
  --freshness=5m \
  --project biji-biji-calcom-250825084322
```

## 🔗 **Integration with Web App**

### **Update Web App Configuration:**
```yaml
# Add to env-vars-production.yaml
NEXT_PUBLIC_API_V2_URL: "https://api-v2.mereka.io"
```

### **API v2 Endpoints:**
- **Base URL**: `https://api-v2.mereka.io`
- **Documentation**: `https://api-v2.mereka.io/docs`
- **Health Check**: `https://api-v2.mereka.io/health`
- **API Endpoints**: `https://api-v2.mereka.io/v2/*`

## 🚨 **Common Issues & Solutions**

### **1. Build Failures**
```bash
# Clean and rebuild
cd apps/api/v2
rm -rf dist node_modules
yarn install
yarn workspace @calcom/api-v2 run build
```

### **2. Docker Build Issues**
```bash
# Check Docker context
docker build --no-cache -t test-image -f apps/api/v2/Dockerfile .

# Verify build args
docker build --build-arg DATABASE_URL="test" -f apps/api/v2/Dockerfile .
```

### **3. Deployment Failures**
```bash
# Check service logs
gcloud run services logs read calcom-api-v2 \
  --region us-central1 \
  --project biji-biji-calcom-250825084322

# Verify environment variables
gcloud run revisions describe calcom-api-v2-00001-xxx \
  --region us-central1 \
  --project biji-biji-calcom-250825084322 \
  --format "yaml(spec.containers[0].env)"
```

### **4. Database Connection Issues**
```bash
# Verify Cloud SQL connection
gcloud run services describe calcom-api-v2 \
  --region us-central1 \
  --project biji-biji-calcom-250825084322 \
  --format "yaml(spec.template.spec.template.spec.volumes)"
```

## 📚 **Additional Resources**

### **Cal.com Documentation:**
- [API v2 README](https://github.com/calcom/cal.com/tree/main/apps/api/v2)
- [Self-Hosting Guide](https://cal.com/docs/self-hosting/installation)
- [API Setup Guide](https://cal.com/docs/developing/guides/api/how-to-setup-api-in-a-local-instance)

### **Google Cloud Resources:**
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Container Registry](https://cloud.google.com/container-registry)
- [Cloud SQL](https://cloud.google.com/sql/docs)

## 🎯 **Next Steps After Deployment**

1. **Test API v2 endpoints** using the documentation
2. **Update web app** to use API v2 where appropriate
3. **Monitor performance** and logs
4. **Set up monitoring** and alerting
5. **Configure custom domain** if needed

---

**Status**: Ready for deployment ✅  
**Script**: `deploy-api-v2.sh` ✅  
**Configuration**: `env-vars-api-v2.yaml` ✅  
**Expected Result**: Separate API v2 service running on Cloud Run ✅




