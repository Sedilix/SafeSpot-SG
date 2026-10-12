# SafeSpot Routing — Road Graph Deployment to Cloud Run

> **Notice:** Required per `ROUTING_PLAN.md` §8 Fix E (E4). Do NOT run IAM or billing commands automatically; run these copy-paste commands manually.

---

## 1. Context & Architecture

The production road graph (`singapore-road-graph.json`, ~48.8 MB raw) is gitignored and not bundled inside Git commits. 

To enable SafeSpot's driver ETA shadow evaluation on Cloud Run (`ROUTING_SHADOW_DRIVE=1`):
1. The compressed road graph (`singapore-road-graph.json.gz`, 5.54 MB) is stored in Google Cloud Storage at `gs://safespot-sg-speedbands/graph/<YYYY-MM-DD>/`.
2. At Cloud Run container startup, if `ROUTING_GRAPH_URI` is configured, the server downloads the compressed graph in the background to `/tmp/singapore-road-graph.json.gz`, extracts it, and initializes the drive worker thread.
3. While the graph is downloading or parsing, production requests are **never blocked**: Google Routes continues serving all driver ETAs, and shadow evaluation skips safely (`[PICKUP_DRIVE_EVAL] graph not ready: skipped`).
4. Only the 49 MB road graph is loaded in the driver worker. The 116 MB pedestrian graph is never loaded into the driving worker.

---

## 2. Memory Sizing & Justification

Empirical profiling of `RoadGraph` loading on Node.js v20:
- **Raw graph JSON:** 48.81 MB
- **Gzip compressed archive:** 5.54 MB (11.4% size)
- **Heap Used Delta:** 235.2 MB
- **Total Heap Used:** 242.5 MB
- **Total Process RSS:** 311.9 MB
- **Parse & Index Time:** ~1,350 ms

### Cloud Run Memory Setting: `--memory 1Gi`
Cloud Run's default memory is 512 MiB. Under 512 MiB, transient JSON string allocations and V8 garbage collection spikes during initial graph ingestion create an OOM risk. Therefore, Cloud Run instances running the routing engine require `--memory 1Gi`.

---

## 3. Deployment Commands (For User to Run)

Execute these commands in Google Cloud Shell or your local authenticated terminal:

### Step 1: Upload the Compressed Road Graph to Cloud Storage
```bash
# Generated locally via: npx tsx tools/osm/upload-graph.ts
gcloud storage cp data/graph/singapore-road-graph.json.gz \
  gs://safespot-sg-speedbands/graph/2026-10-12/singapore-road-graph.json.gz
```

### Step 2: Grant Storage Object Viewer to the Cloud Run Service Account
```bash
gcloud storage buckets add-iam-policy-binding gs://safespot-sg-speedbands \
  --member="serviceAccount:258662267000-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

### Step 3: Configure Cloud Run Environment & Memory Limit
```bash
gcloud run services update safespot-sg \
  --region asia-southeast1 \
  --project cybrdeck \
  --update-env-vars ROUTING_GRAPH_URI=gs://safespot-sg-speedbands/graph/2026-10-12/singapore-road-graph.json.gz,ROUTING_SHADOW_DRIVE=1 \
  --memory 1Gi
```

---

## 4. Operational Telemetry & Log Monitoring

When `ROUTING_SHADOW_DRIVE=1` is active:
- Google Routes serves `/api/pickup/options` in production as normal.
- SafeSpot's background worker executes `Router.findRoutesToMany` asynchronously.
- Cloud Run logs emit structured evaluation JSON lines:
  ```json
  [PICKUP_DRIVE_EVAL] {"candidateId":"lta-42","departure":"08:30","localSec":720,"googleSec":690,"diffSec":30,"diffPct":"4.3","localMs":185}
  ```
- No user PII, coordinates, device IDs, or names are ever logged.
