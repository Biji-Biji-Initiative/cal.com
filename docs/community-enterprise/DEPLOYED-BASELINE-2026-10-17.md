# Deployed baseline readback - 2026-10-17

This is a read-only inventory for CAL-08.BASELINE. It records the actual
production objects visible from the existing RKE2 context on 2026-10-17. It
does not promote the enterprise candidate, rotate credentials, change Argo,
or restore a database.

## Readback

| Item | Observed value |
| --- | --- |
| Kubernetes context | rke2-prod |
| Argo application | calcom-prod, Synced / Healthy |
| Argo revision | ddac90eb8b27f89fba95d7abce23a2749259e841 |
| Web deployment | 3 ready / 3 updated replicas |
| Web image | calcom/cal.com:v6.2.0@sha256:ace3bb1219fb7306585ab9f4d41af7ee064c343db049db0498173436bbe857bd49 |
| Web runtime sidecar | node:22-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd |
| API deployment | 1 ready / 1 updated replica |
| API image | ghcr.io/biji-biji-initiative/cal.com-api-v2:v6.2.0@sha256:40f5fc141a7090eeca8b14c09bd9a37d03c428500f75eddb7b35af3673c58507 |
| Redis image | redis:7-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99 |
| Legacy PostgreSQL pod | calcom-postgresql-0, Running and ready |
| CNPG cluster | calcom-prod-cnpg, healthy, 2/2 ready instances |
| Public web probes | cal.mereka.io and calendar.mereka.io returned HTTP 302 to the existing Authentik outpost; this is legacy identity protection, not enterprise candidate acceptance |
| API probe | calcom-api.mereka.io/ returned HTTP 404 with the live API security headers |
| Logical backup CronJob | 0 3 * * *, not suspended; last schedule 2026-10-17T03:00:00Z |
| Latest observed backup job | calcom-pg-backup-logical-backup-cron-29870100, succeeded at 2026-10-17T03:03:06Z |

The image and deployment readback identifies the currently served legacy
release. It does not identify the enterprise branch or the local candidate
image as served.

## Data and recovery boundary

The manifests point the production application at the existing calcom-prod
database identities and external-secret keys. The readback did not print secret
values. It confirmed the application, API, Redis, legacy PostgreSQL and CNPG
resources, but did not inspect table counts, booking URLs, credential
decryption, or a restored copy.

Therefore this evidence is intentionally partial:

- it proves the live object/image/configuration inventory at the recorded scope;
- it proves that the existing logical-backup job is scheduled and the latest
  observed job succeeded;
- it does not satisfy the isolated restore, stable-ID reconciliation or
  encryption/decryption requirements of CAL-08.BASELINE;
- it does not authorize touching production data or replacing the current
  legacy release.

The next acceptance step is a separately authorized, isolated restore using a
known backup object, with row counts, stable identifiers, existing booking-link
checks and credential decryption/re-encryption checks recorded without exposing
secrets.
