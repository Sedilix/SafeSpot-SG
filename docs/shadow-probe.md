# SafeSpot Routing — Scheduled Drive Shadow Probe (Cloud Run Job & Scheduler)

> **Notice:** Required per `ROUTING_PLAN.md` §9 Fix F. Do NOT run IAM or billing commands automatically; provide these copy-paste commands for manual execution.

---

## 1. Objective & Architecture

A background probe runs SafeSpot's traffic-aware routing engine over **10 fixed Singapore Origin–Destination (O-D) corridors** 6 times per day and records the engine's ETA, distance and latency. That gives a time series per corridor and time of day, to compare with LTA speed bands and our own measured trips (see `docs/clean-room-calibration.md`).

> [!IMPORTANT]
> **Engine only since 2026-10-24.** The probe used to store Google Routes ETAs next to ours and report the error against them. The Google Maps Platform terms allow no caching of route durations or distances, and bar using Google results to build or tune a substitute (ToS §3.2.3 (b)–(d); Routes Service Specific Terms §19). So the probe no longer calls Google, and the report never reads the Google fields still present in rows written before that date. Section 5 covers removing those rows.

```
Cloud Scheduler (6x daily: 07:30, 08:30, 12:00, 17:30, 18:30, 22:00 SGT)
                    │
                    ▼
          Cloud Run Job: "routing-shadow-probe"
                    │
                    ├─► Downloads road graph from GCS (if not cached locally)
                    ├─► Computes SafeSpot traffic-aware ETA (SpeedProfileEngine + IncidentLayer + ErpEngine)
                    └─► Appends 10 structured records:
                            - Local: tools/routing/out/shadow/YYYY-MM-DD.jsonl
                            - GCS: gs://safespot-sg-speedbands/shadow/YYYY-MM-DD.jsonl
                    │
                    ▼
          shadow-report.ts: Engine ETA, distance and latency (median, p95) by time of day and corridor
```

### 10 Monitored Corridors
1. **Central -> CBD**: Blk 480 Toa Payoh -> Raffles Place (`toa-payoh-to-raffles-place`)
2. **Central -> East**: Blk 480 Toa Payoh -> Changi Airport T3 (`toa-payoh-to-changi-t3`)
3. **Central -> West**: Blk 480 Toa Payoh -> Jurong East MRT (`toa-payoh-to-jurong-east`)
4. **West -> North**: Jurong West St 64 -> Woodlands MRT (`jurong-west-to-woodlands`)
5. **West -> East (Cross-Island)**: Jurong West St 64 -> Tampines Hub (`jurong-west-to-tampines`)
6. **West -> North-East**: Jurong West St 64 -> Sengkang General Hospital (`jurong-west-to-sengkang`)
7. **East Intra-Corridor**: Pasir Ris MRT -> Bedok Mall (`pasir-ris-to-bedok`)
8. **North-East Radial**: Ang Mo Kio Hub -> Punggol Waterway Point (`ang-mo-kio-to-punggol`)
9. **West -> South**: Clementi Mall -> HarbourFront Centre (`clementi-to-harbourfront`)
10. **Central -> Marina Bay**: Novena Square -> Marina Bay Sands (`novena-to-mbs`)

> [!NOTE]
> Coordinates of these 10 public landmarks are fixed. No user coordinates, device IDs, or PII are ever collected or logged.

---

## 2. Cost

No Google Maps Platform calls. The job only reads LTA DataMall `TrafficIncidents` (free, commercial use allowed under the Singapore Open Data Licence) and runs the engine locally.

---

## 3. GCP Deployment Instructions (For User to Run)

Run the following commands in your authenticated shell.

### Step 1: Ensure Secrets in Secret Manager
Verify that `LTA_DATAMALL_KEY` exists in project `safespot-sg` (the probe no longer needs `MAPS_SERVER_KEY`):

```bash
# If not already present:
gcloud secrets create LTA_DATAMALL_KEY \
  --data-file="C:/Users/SIT EUC/lta_datamall_key.txt" \
  --project=safespot-sg
```

Ensure the logger / shadow service account has Secret Accessor permission:
```bash
gcloud secrets add-iam-policy-binding LTA_DATAMALL_KEY \
  --member="serviceAccount:speedbands-logger@safespot-sg.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=safespot-sg
```

### Step 2: Grant Bucket Access
Grant the service account Object Admin permission on `gs://safespot-sg-speedbands` (if not already granted):
```bash
gcloud storage buckets add-iam-policy-binding gs://safespot-sg-speedbands \
  --member="serviceAccount:speedbands-logger@safespot-sg.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

### Step 3: Build & Deploy the Cloud Run Job
Submit the container build:
```bash
gcloud builds submit \
  --tag=asia-southeast1-docker.pkg.dev/safespot-sg/safespot-repo/routing-shadow-probe:latest \
  --project=safespot-sg
```

Create the Cloud Run Job:
```bash
gcloud run jobs create routing-shadow-probe \
  --project=safespot-sg \
  --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/safespot-sg/safespot-repo/routing-shadow-probe:latest \
  --command=node \
  --args=dist/shadow-probe.cjs,--once \
  --set-env-vars=SPEEDBANDS_BUCKET=safespot-sg-speedbands,ROUTING_GRAPH_URI=gs://safespot-sg-speedbands/graph/2026-10-12/singapore-road-graph.json.gz \
  --set-secrets=LTA_DATAMALL_KEY=LTA_DATAMALL_KEY:latest \
  --service-account=speedbands-logger@safespot-sg.iam.gserviceaccount.com \
  --tasks=1 \
  --max-retries=1 \
  --task-timeout=300s \
  --memory=1Gi \
  --cpu=1
```

### Step 4: Schedule Execution 6x Daily with Cloud Scheduler
Trigger at 07:30, 08:30, 12:00, 17:30, 18:30, and 22:00 SGT:

```bash
# Schedule 1: 07:30, 08:30, 17:30, 18:30 SGT (Minute 30 of hours 7, 8, 17, 18)
gcloud scheduler jobs create http routing-shadow-probe-half-hour \
  --project=safespot-sg \
  --location=asia-southeast1 \
  --schedule="30 7,8,17,18 * * *" \
  --time-zone="Asia/Singapore" \
  --uri="https://asia-southeast1-run.googleapis.com/v2/projects/safespot-sg/locations/asia-southeast1/jobs/routing-shadow-probe:run" \
  --http-method=POST \
  --oauth-service-account-email="speedbands-logger@safespot-sg.iam.gserviceaccount.com"

# Schedule 2: 12:00, 22:00 SGT (Minute 0 of hours 12, 22)
gcloud scheduler jobs create http routing-shadow-probe-on-the-hour \
  --project=safespot-sg \
  --location=asia-southeast1 \
  --schedule="0 12,22 * * *" \
  --time-zone="Asia/Singapore" \
  --uri="https://asia-southeast1-run.googleapis.com/v2/projects/safespot-sg/locations/asia-southeast1/jobs/routing-shadow-probe:run" \
  --http-method=POST \
  --oauth-service-account-email="speedbands-logger@safespot-sg.iam.gserviceaccount.com"
```

### Step 5: Test Execution Manually
```bash
gcloud run jobs execute routing-shadow-probe \
  --project=safespot-sg \
  --region=asia-southeast1 \
  --wait
```

---

## 4. Generating Shadow Reports

```bash
# Sync remote telemetry locally
gcloud storage cp -r "gs://safespot-sg-speedbands/shadow/*.jsonl" tools/routing/out/shadow/

# Compile report
npx tsx tools/routing/shadow-report.ts
```

The report is written to `tools/routing/out/shadow-report.md`:
- Median & p95 engine latency vs the $< 200$ ms target (computed PASS/FAIL), and rows with no route (computed PASS/FAIL).
- Median engine ETA by time of day (Morning Peak, Midday, Evening Peak, Night).
- Per corridor: median ETA, ETA range, median distance, median latency.

Accuracy is not measured here: it comes from measured trips and LTA speed bands (`docs/clean-room-calibration.md`).

---

## 5. Switching an existing deployment to engine-only (for the user to run)

The job deployed on 2026-10-13 still runs the old image, which calls Google and stores its ETAs. Rebuild and redeploy, and drop the Maps key from the job:

```bash
gcloud builds submit \
  --tag=asia-southeast1-docker.pkg.dev/safespot-sg/safespot-repo/routing-shadow-probe:latest \
  --project=safespot-sg

gcloud run jobs update routing-shadow-probe \
  --project=safespot-sg \
  --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/safespot-sg/safespot-repo/routing-shadow-probe:latest \
  --remove-secrets=MAPS_SERVER_KEY
```

Rows written from 2026-10-13 up to the redeploy hold Google ETAs (`googleSec`, `googleMeters`, `diffPct`). To stop storing them, delete those files. **This is permanent.** List them first, then remove only dates before the redeploy:

```bash
gcloud storage ls "gs://safespot-sg-speedbands/shadow/"
gcloud storage rm "gs://safespot-sg-speedbands/shadow/2026-10-1*.jsonl" "gs://safespot-sg-speedbands/shadow/2026-10-2*.jsonl"
```

If the redeploy happens on a date the second pattern covers, list that day's file and keep it out of the `rm`.
