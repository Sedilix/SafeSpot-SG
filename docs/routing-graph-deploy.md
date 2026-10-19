# SafeSpot Routing — Road Graph Deployment to Cloud Run

> **Notice:** Required per `ROUTING_PLAN.md` §8 Fix E (E4) and §9. Do NOT run IAM, billing, or cloud commands automatically; run these copy-paste commands manually.

---

## 1. Context & Architecture

The production road graph (`singapore-road-graph.json`, ~48.8 MB raw) is gitignored and not bundled inside Git commits. 

To enable SafeSpot's driver ETA shadow evaluation on Cloud Run (`ROUTING_SHADOW_DRIVE=1`):
1. The compressed road graph (`singapore-road-graph.json.gz`, ~5.78 MB) is stored in Google Cloud Storage at `gs://safespot-sg-speedbands/graph/<YYYY-MM-DD>/`.
2. **Immutability Rule:** Every graph upload goes to a **new dated path** (e.g. `gs://safespot-sg-speedbands/graph/<YYYY-MM-DD>/singapore-road-graph.json.gz`). **Never overwrite the one currently in production.** Using immutable paths prevents race conditions while active Cloud Run instances download the graph and guarantees instant rollback if needed.
3. At Cloud Run container startup, if `ROUTING_GRAPH_URI` is configured, the server downloads the compressed graph in the background to `/tmp/singapore-road-graph.json.gz`, extracts it, and initializes the drive worker thread.
4. While the graph is downloading or parsing, production requests are **never blocked**: Google Routes continues serving all driver ETAs, and shadow evaluation skips safely (`[PICKUP_DRIVE_EVAL] graph not ready: skipped`).
5. Only the road graph is loaded in the driver worker. The 116 MB pedestrian graph is never loaded into the driving worker.

---

## 2. Google Cloud Projects Split

SafeSpot SG cloud infrastructure spans two distinct Google Cloud projects:

| Component | Project ID | Description |
|---|---|---|
| **`safespot-sg` Service** | **`cybrdeck`** | Main Cloud Run web application hosting pickup planning and driving worker |
| **`routing-shadow-probe` Job** | **`safespot-sg`** | Cloud Run Job executing scheduled pairwise probe comparisons against Google Routes |
| **`gs://safespot-sg-speedbands`** | **`safespot-sg`** | Cloud Storage bucket storing road graphs, historical speed bands, and probe logs |

The Cloud Run compute service account for `cybrdeck` (`258662267000-compute@developer.gserviceaccount.com`) is granted `roles/storage.objectViewer` on `gs://safespot-sg-speedbands` to fetch the road graph at startup.

---

## 3. Memory Sizing & Justification

Empirical profiling of `RoadGraph` loading on Node.js v20:
- **Raw graph JSON:** 48.81 MB
- **Gzip compressed archive:** 5.78 MB (11.8% size)
- **Heap Used Delta:** 235.2 MB
- **Total Heap Used:** 242.5 MB
- **Total Process RSS:** 311.9 MB
- **Parse & Index Time:** ~1,350 ms

### Cloud Run Memory Setting: `--memory 1Gi`
Cloud Run's default memory is 512 MiB. Under 512 MiB, transient JSON string allocations and V8 garbage collection spikes during initial graph ingestion create an OOM risk. Therefore, Cloud Run instances running the routing engine require `--memory 1Gi`.

---

## 4. Build & Deployment Commands (For User to Run)

Execute these commands in your authenticated terminal or Cloud Shell:

### Step 1: Rebuild the Road Graph (Generates .json and .json.gz natively)
```bash
npm run build:graph
```
This runs `tsx tools/osm/build-graph.ts`, reading from `data/graph/overpass-cache.json` and generating both `data/graph/singapore-road-graph.json` and `data/graph/singapore-road-graph.json.gz` natively using Node.js `zlib`.

### Step 2: Upload the Compressed Road Graph to a NEW Dated Path
> **Reminder:** Never overwrite an existing path. Use today's date (e.g. `2026-10-20`).
```bash
gcloud storage cp data/graph/singapore-road-graph.json.gz \
  gs://safespot-sg-speedbands/graph/2026-10-20/singapore-road-graph.json.gz
```

### Step 3: (If not already granted) Grant Storage Object Viewer to the Service Account
```bash
gcloud storage buckets add-iam-policy-binding gs://safespot-sg-speedbands \
  --member="serviceAccount:258662267000-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

### Step 4: Update Cloud Run Service (`safespot-sg` in project `cybrdeck`)
```bash
gcloud run services update safespot-sg \
  --region asia-southeast1 \
  --project cybrdeck \
  --update-env-vars ROUTING_GRAPH_URI=gs://safespot-sg-speedbands/graph/2026-10-20/singapore-road-graph.json.gz,ROUTING_SHADOW_DRIVE=1 \
  --memory 1Gi
```

### Step 5: Rebuild the Probe Image After a Graph or Probe Code Change
After any road graph change or probe update, rebuild the probe container image:
```bash
gcloud builds submit \
  --tag=asia-southeast1-docker.pkg.dev/safespot-sg/safespot-repo/routing-shadow-probe:latest \
  --project=safespot-sg
```

### Step 6: Update Cloud Run Scheduled Shadow Probe Job (`routing-shadow-probe` in project `safespot-sg`)
```bash
gcloud run jobs update routing-shadow-probe \
  --region asia-southeast1 \
  --project safespot-sg \
  --update-env-vars ROUTING_GRAPH_URI=gs://safespot-sg-speedbands/graph/2026-10-20/singapore-road-graph.json.gz
```

---

## 5. Operational Telemetry & Log Monitoring

When `ROUTING_SHADOW_DRIVE=1` is active:
- Google Routes serves `/api/pickup/options` in production as normal.
- SafeSpot's background worker executes `Router.findRoutesToMany` asynchronously.
- Cloud Run logs emit structured evaluation JSON lines:
  ```json
  [PICKUP_DRIVE_EVAL] {"candidateId":"lta-42","departure":"08:30","localSec":720,"googleSec":690,"diffSec":30,"diffPct":"4.3","localMs":185}
  ```
- No user PII, coordinates, device IDs, or names are ever logged.
