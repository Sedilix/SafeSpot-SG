# SafeSpot Routing — Scheduled Drive Shadow Probe (Cloud Run Job & Scheduler)

> **Notice:** Required per `ROUTING_PLAN.md` §9 Fix F. Do NOT run IAM or billing commands automatically; provide these copy-paste commands for manual execution.

---

## 1. Objective & Architecture

To evaluate the accuracy of SafeSpot's traffic-aware routing engine against Google Routes without waiting for user-initiated pickups, a background probe continuously monitors **10 fixed Singapore Origin–Destination (O-D) corridors** 6 times per day.

```
Cloud Scheduler (6x daily: 07:30, 08:30, 12:00, 17:30, 18:30, 22:00 SGT)
                    │
                    ▼
          Cloud Run Job: "routing-shadow-probe"
                    │
                    ├─► Downloads road graph from GCS (if not cached locally)
                    ├─► Computes SafeSpot traffic-aware ETA (SpeedProfileEngine + IncidentLayer + ErpEngine)
                    ├─► Queries Google Routes computeRoutes (TRAFFIC_AWARE)
                    └─► Appends 10 structured records:
                            - Local: tools/routing/out/shadow/YYYY-MM-DD.jsonl
                            - GCS: gs://safespot-sg-speedbands/shadow/YYYY-MM-DD.jsonl
                    │
                    ▼
          shadow-report.ts: Computes Median Abs Error, Mean Signed Error, Latency Quantiles
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

## 2. API SKU, Pricing & Free Quota Verification

- **API**: Google Maps Platform — Routes API (`v2:computeRoutes`)
- **SKU**: **Routes: Compute Routes - Advanced** (Traffic-Aware Driving: `travelMode: DRIVE`, `routingPreference: TRAFFIC_AWARE`)
- **Published Unit Price**: $10.00 USD per 1,000 calls (for 0 – 100,000 monthly calls).
- **Probed Frequency**: 10 corridors × 6 runs/day × 30 days = **1,800 requests/month**.
- **Monthly Cost**: 1,800 calls × $0.010 = **$18.00 USD / month**.
- **Free Monthly Allowance**: Google Cloud grants a **$200.00 USD recurring monthly credit** to every Google Maps Platform billing account (equivalent to 20,000 Compute Routes - Advanced calls).
- **Net Billable Cost**: 1,800 calls consumes **9.0%** of the monthly free tier allowance. **$0.00 billable spend**.
- **Source**: [Google Maps Platform Routes Pricing](https://developers.google.com/maps/documentation/routes/usage-and-billing) (accessed 2026-10-13).

---

## 3. GCP Deployment Instructions (For User to Run)

Run the following commands in your authenticated shell.

### Step 1: Ensure Secrets in Secret Manager
Verify that `MAPS_SERVER_KEY` and `LTA_DATAMALL_KEY` exist in project `safespot-sg`:

```bash
# If not already present:
gcloud secrets create MAPS_SERVER_KEY \
  --data-file="C:/Users/SIT EUC/maps_server_key.txt" \
  --project=safespot-sg

gcloud secrets create LTA_DATAMALL_KEY \
  --data-file="C:/Users/SIT EUC/lta_datamall_key.txt" \
  --project=safespot-sg
```

Ensure the logger / shadow service account has Secret Accessor permission:
```bash
gcloud secrets add-iam-policy-binding MAPS_SERVER_KEY \
  --member="serviceAccount:speedbands-logger@safespot-sg.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=safespot-sg

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
  --set-secrets=MAPS_SERVER_KEY=MAPS_SERVER_KEY:latest,LTA_DATAMALL_KEY=LTA_DATAMALL_KEY:latest \
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

## 4. Generating Comparative Shadow Reports

To download telemetry from Cloud Storage and generate the analysis report:

```bash
# Sync remote telemetry locally
gcloud storage cp -r "gs://safespot-sg-speedbands/shadow/*.jsonl" tools/routing/out/shadow/

# Compile report
npx tsx tools/routing/shadow-report.ts
```

The report is written to `tools/routing/out/shadow-report.md`, summarizing:
- Overall Median Absolute Error vs $\le 20.0\%$ target (Computed PASS/FAIL).
- Median & p95 search latency vs $< 200$ ms target (Computed PASS/FAIL).
- Time-of-day accuracy breakdown (Morning Peak, Midday, Evening Peak, Night).
- Corridor-level bias (Mean Signed Error).
