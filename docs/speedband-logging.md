# SafeSpot Singapore — Continuous Speed-Band Logging (Cloud Run Job & Scheduler)

This document provides exact, copy-paste `gcloud` instructions to set up 24/7 continuous LTA Traffic Speed Band logging in Google Cloud Platform per `ROUTING_PLAN.md` §7 Fix B.

---

## 1. Architecture Overview

Laptops sleep and disconnect, but historical speed profiles for Singapore road routing require weeks of continuous 5-minute telemetry (approx. 288 snapshots/day across ~143,000 links).

```
Cloud Scheduler (every 5 min)
         │
         ▼
Cloud Run Job ("speedbands-logger")
         │
         ├─► Reads LTA_DATAMALL_KEY from Secret Manager
         ├─► Fetches all pages of LTA DataMall v4/TrafficSpeedBands
         ├─► Compresses records into level-9 gzip JSONL stream
         └─► Writes to gs://safespot-sg-speedbands/speedbands/YYYY-MM-DD/HHmm.jsonl.gz
         │
         ▼
GCS Lifecycle Policy: Auto-deletes raw snapshots older than 120 days
         │
         ▼
Local Ingestion (tools/speedbands/download.ts): Pulls daily bundles to tools/speedbands/data/
```

---

## 2. GCP Setup Instructions (Run by User)

> [!NOTE]
> Run these commands in PowerShell or Bash with `gcloud` authenticated.
> Ensure active project is `safespot-sg` (region `asia-southeast1`).

### Step 1: Create GCS Storage Bucket & Lifecycle Policy

Create the target storage bucket in Singapore (`asia-southeast1`):

```bash
gcloud storage buckets create gs://safespot-sg-speedbands \
  --project=safespot-sg \
  --location=asia-southeast1 \
  --default-storage-class=STANDARD \
  --uniform-bucket-level-access
```

Create a local `lifecycle.json` file to automatically expire raw snapshot files after 120 days:

```json
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 120}
    }
  ]
}
```

Apply the lifecycle rule:

```bash
gcloud storage buckets update gs://safespot-sg-speedbands \
  --lifecycle-file=lifecycle.json
```

---

### Step 2: Store LTA DataMall AccountKey in Secret Manager

If `LTA_DATAMALL_KEY` does not exist yet in Secret Manager for project `safespot-sg`:

```bash
# Using key from C:\Users\SIT EUC\lta_datamall_key.txt:
gcloud secrets create LTA_DATAMALL_KEY \
  --data-file="C:/Users/SIT EUC/lta_datamall_key.txt" \
  --project=safespot-sg
```

---

### Step 3: Service Account & Permissions

Create a dedicated service account for the logger job:

```bash
gcloud iam service-accounts create speedbands-logger \
  --display-name="SafeSpot Speedbands Logger Service Account" \
  --project=safespot-sg
```

Grant read access to Secret Manager and write access to the GCS bucket:

```bash
# Grant Secret Manager secretAccessor
gcloud secrets add-iam-policy-binding LTA_DATAMALL_KEY \
  --member="serviceAccount:speedbands-logger@safespot-sg.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=safespot-sg

# Grant GCS Object Admin on the speedbands bucket
gcloud storage buckets add-iam-policy-binding gs://safespot-sg-speedbands \
  --member="serviceAccount:speedbands-logger@safespot-sg.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Grant Cloud Run invoker (for Cloud Scheduler trigger)
gcloud projects add-iam-policy-binding safespot-sg \
  --member="serviceAccount:speedbands-logger@safespot-sg.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

---

### Step 4: Build and Deploy the Cloud Run Job

Build the container image using Cloud Build:

```bash
gcloud builds submit \
  --tag=asia-southeast1-docker.pkg.dev/safespot-sg/safespot-repo/speedbands-logger:latest \
  --project=safespot-sg
```

Create the Cloud Run Job:

```bash
gcloud run jobs create speedbands-logger \
  --project=safespot-sg \
  --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/safespot-sg/safespot-repo/speedbands-logger:latest \
  --command=npx \
  --args=tsx,tools/speedbands/logger.ts,--once \
  --set-env-vars=SPEEDBANDS_BUCKET=safespot-sg-speedbands \
  --set-secrets=LTA_DATAMALL_KEY=LTA_DATAMALL_KEY:latest \
  --service-account=speedbands-logger@safespot-sg.iam.gserviceaccount.com \
  --tasks=1 \
  --max-retries=2 \
  --task-timeout=300s \
  --memory=512Mi \
  --cpu=1
```

---

### Step 5: Test Run the Job

Trigger a manual execution to verify data ingestion:

```bash
gcloud run jobs execute speedbands-logger \
  --project=safespot-sg \
  --region=asia-southeast1 \
  --wait
```

Verify the written object in Cloud Storage:

```bash
gcloud storage ls --recursive gs://safespot-sg-speedbands/speedbands/
```

---

### Step 6: Configure Cloud Scheduler (5-Minute Trigger)

Create a Cloud Scheduler job triggering the Cloud Run Job every 5 minutes:

```bash
gcloud scheduler jobs create http speedbands-logger-cron \
  --project=safespot-sg \
  --location=asia-southeast1 \
  --schedule="*/5 * * * *" \
  --time-zone="Asia/Singapore" \
  --uri="https://asia-southeast1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/safespot-sg/jobs/speedbands-logger:run" \
  --http-method=POST \
  --oauth-service-account-email="speedbands-logger@safespot-sg.iam.gserviceaccount.com"
```

---

## 3. Downloading Historical Data for Local Routing

To fetch recorded snapshots from Google Cloud Storage to local disk (`tools/speedbands/data/`):

```bash
# Download and bundle the last 14 days into daily speedbands-YYYY-MM-DD.jsonl.gz files:
npx tsx tools/speedbands/download.ts --bucket=safespot-sg-speedbands --days=14

# Download all available historical data:
npx tsx tools/speedbands/download.ts --bucket=safespot-sg-speedbands
```

The script automatically downloads individual snapshots and bundles them into the daily gzip format (`speedbands-YYYY-MM-DD.jsonl.gz`) required by `src/routing/speedProfiles.ts`.

---

## 4. Local Logging Fallback (Windows Task Scheduler)

If running locally without cloud infrastructure:

```powershell
$action = New-ScheduledTaskAction -Execute "npx.cmd" -Argument "tsx tools/speedbands/logger.ts --once" -WorkingDirectory "C:\Users\SIT EUC\Documents\Builds\SafeSpotSG"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "SafeSpot-Speedbands-Logger" -Action $action -Trigger $trigger -Description "SafeSpot LTA Speed-Bands Local Snapshot Logger"
```
