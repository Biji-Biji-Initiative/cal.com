# Cal.com Deployment Notes

## GKE (bbi-k8-std, asia-southeast1-b)
- Context: `gke_bbi-k8_asia-southeast1-b_bbi-k8-std`.
- Manifests used: `/home/dev/manifests/calcom/deploy.yaml` (pinned prod image digest, Cloud SQL proxy, ingress `calendar.mereka.io`).
- Secret: `calcom-env` created from `env-vars-production.example.yaml` (not committed); applied to namespace `calcom`.
- Cloud SQL proxy: `biji-biji-calcom-250825084322:us-central1:calcom-sql-250825084517`; nodeSelector targets pool `sql-scope` with cloud-platform scope.
- Ingress/TLS: ingress-nginx + cert-manager (ClusterIssuer `letsencrypt-dns`); LB IP `35.240.151.137`. Set Cloudflare DNS A/AAAA for `calendar.mereka.io` to this IP.

## Local (kind) parity
- Use local overlays (self-signed issuer, `/etc/hosts`, local Postgres) to validate config; do not use prod data.
- Pin the same image digest for consistency; adjust DB URLs to local Postgres.
- Keep env vars aligned; only change DB/issuer/storage specifics per env.

## Rollback
- Keep Cloud Run live; DNS rollback by pointing `calendar.mereka.io` back if needed.

## Credentials
- Production secrets live in `env-vars-production.example.yaml`; do not commit. Recreate `calcom-env` K8s secret from that file when needed. Cloudflare token secret is created in `cert-manager` namespace for DNS-01.
