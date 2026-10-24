# Clean-room calibration plan for the SafeSpot routing engine

Proposed 2026-10-24. **Status: proposal; nothing here is decided until the user approves it.**

## 1. Why

The engine must be calibrated and judged on data we're allowed to use. Google Maps Platform results don't qualify. Terms checked 2026-10-24: ToS last modified 2026-08-26, Service Specific Terms 2026-10-15.

- **§3.2.3(b) No Caching.** Only lat/lng may be cached, for up to 30 days (Routes §19.3, Roads §17.3). Route durations and distances get no caching allowance.
- **§3.2.3(c) No Creating Content From Google Maps Content.** Item (vii) bars use "to train, test, validate or fine-tune" models.
- **§3.2.3(d) No Re-Creating Google Products or Features.** This includes building a substitute for the Core Services.
- **§3.2.3(e) No Use With Non-Google Maps.**

Google stays what it is today: the licensed service that serves users' ETAs, maps and kerb snapping. It is not a measuring stick. A model calibrated on Google outputs is also a liability in any sale or acquisition, so clean data protects the value of the work.

## 2. Ground truth, in order of value

| # | Source | What it gives | Licence / conditions |
|---|---|---|---|
| 1 | **Measured trips** (our own users, with consent) | Real door-to-door times and per-edge traversal times along real routes | Ours. Personal data under PDPA: explicit consent, a stated purpose and retention period, delete on request. Keep as a layer separate from OSM (no ODbL share-alike). |
| 2 | **Probe drives** (us driving the 10 fixed corridors with phone + watch logging) | A clean benchmark for the exact pairs the shadow probe runs | Ours. No third-party terms. |
| 3 | **LTA DataMall Traffic Speed Bands** | Per-link speed bands every few minutes on major roads; already logged since 2026-10-12 | Commercial use allowed. Singapore Open Data Licence v1.0 attribution notice required (§6). |
| 4 | **OneMap Routing API** (SLA) | Free walk / drive / cycle / public-transport / barrier-free routes | Commercial use allowed. **Storing or deriving from results is ambiguous: ask SLA before caching anything.** Driving is likely not traffic-aware (unverified). |
| 5 | **Licensed traffic data** (TomTom Traffic Stats, HERE historical speeds) | Historical speed profiles everywhere, including outside Singapore | Only under a contract that explicitly permits derived use and calibration. |

## 3. How each source is used

### 3.1 Measured trips: the main ground truth
- **When a pickup is planned:** record the engine's predicted ETA from the driver's position, the departure time, and the chosen pickup point's graph edge.
- **When the driver arrives** (within 30 m of the pickup point, or the user taps "picked up"): record the actual elapsed time.
- **Driver GPS trace** (if consented): map-match it to our OSM graph to get per-edge traversal times. Use the standard hidden-Markov map-matching method (Newson & Krumm, 2009; openly published).
- **Storage:** a `Trips` collection holding `{predictedSec, actualSec, departure, edgeTimes[]}`. Coordinates are dropped after matching; edges are keyed by graph edge ID and OSM way ID.
- **What this measures:** the error that matters for the product, predicted against actual. The comparison against Google goes away.

### 3.2 Probe drives: a fixed benchmark
- Drive each of the 10 shadow corridors at 08:30, 12:00 and 18:30 on weekdays, with the phone and watch logging.
- That's 30 runs: a clean replacement for the Google-based `benchmark.ts` and `benchmark-holdout.ts`.

### 3.3 LTA speed bands: speed factors (Fix H)
1. **Map LTA links to graph edges by geometry.** LTA's `TrafficSpeedBands` response carries each link's start and end coordinates. The logger drops them today, so record the link metadata once.
2. **Fit speed factors** per road class × direction × 15-minute slot × weekday/weekend, using the midpoint of each band. This replaces the hand-typed factors in `speedProfiles.ts`, including the 0.62 inbound expressway factor. Those were tuned on Google probe data, which the terms don't allow.
3. **Hold out** the last 3 days of logs.

### 3.4 Joint fit: free-flow caps, signal waits, turn delays
A trip's time is modelled as:

```
trip time ≈ Σ edge length / (cap[class] × factor[class, dir, slot])
           + n_signals × w_signal + Σ turn delays
```

- Fit `cap[class]`, `w_signal` and the turn delays by robust least squares (Huber loss) on measured trip times and per-edge times. The factors from §3.3 stay fixed during this fit.
- This settles the double counting PR #46 found: the current caps already include signal delays.
- **Hold out** 20% of trips, split by date rather than by trip, so that one day's traffic doesn't leak between the fitting and test sets.

### 3.5 Corridor audit without Google
- Rebuild the corridor audit (`tools/routing/gap-alignment-table.ts`) against map-matched trip traces instead of Google's polyline. The spatial divergence logic from PR #46 carries over unchanged.

## 4. Metrics and decision gates (statuses computed, never typed)

| Metric | Measured on | Target (proposed) |
|---|---|---|
| Median absolute error | Held-out trips, probe drives | ≤ 10% |
| Mean signed error (bias) | Same, by hour and by corridor | within ±5% |
| p95 absolute error | Same | ≤ 25% |
| Median / p95 latency | Shadow probe | < 200 ms / < 500 ms |

The decision to switch `ROUTING_ENGINE_DRIVE` to `local` stays with the user. It would come after the gates pass on at least 2 weeks of held-out trips.

## 5. What gets retired or cleaned up (each needs the user's go-ahead)

- [x] Shadow probe: engine only; it no longer calls or stores Google (this PR).
- [x] `[PICKUP_DRIVE_EVAL]`: logs engine fields only (this PR).
- [x] OpenStreetMap fallback map: shows raw device GPS only (this PR).
- [ ] Delete stored shadow rows that carry Google ETAs: `gs://safespot-sg-speedbands/shadow/2026-10-1*.jsonl` and earlier `2026-10-2*` files (commands in `docs/shadow-probe.md` §5), plus the local copies in `tools/routing/out/shadow/`.
- [ ] Delete the Google probe datasets: `tools/route-probe/out/probe-dataset.json` and `probe-dataset-holdout.json` (local, gitignored).
- [ ] Stop committing reports that contain Google times: `tools/routing/out/benchmark*.md` and `corridor-step-audit.md`. Replace them with the trip- and probe-drive-based reports.
- [ ] Retire `tools/route-probe/probe.ts`, plus `benchmark.ts` and `benchmark-holdout.ts` in their Google form.
- [ ] Rework PR #46's `--google-cache` audit mode onto trip traces (§3.5) before it merges.
- [ ] Replace the speed factors tuned on Google probe data (Fix H, §3.3).

## 6. Licence obligations once the engine serves users

- **OpenStreetMap credit.** Show "© OpenStreetMap contributors", linked to https://www.openstreetmap.org/copyright, wherever the engine's routes or ETAs appear (the OSMF Attribution Guidelines' routing safe harbour).
- **ODbL 4.6.** The road graph is a derivative database. Once its routes are served publicly, offer the graph or the method that builds it (`tools/osm/build-graph.ts` plus the OSM extract date) free of charge on request. LTA speeds and trip-derived speeds stay in separate layers keyed by edge ID, so they aren't share-alike.
- **LTA notice.** Use "Contains information from {dataset} accessed on {date} from LTA DataMall, which is made available under the terms of the Singapore Open Data Licence version 1.0". Never imply LTA endorses the product.

## 7. Outside Singapore

- **Regional adapters.** Make the Overpass area, the expressway-name patterns and the `inSingapore()` checks per-region settings.
- **Open speed feeds:** Hong Kong TD speed map (5 minutes), England NTIS (DATEX II), NYC DOT traffic speeds. None found for Malaysia: rely on measured trips and licensed data.
- **Engine core.** For multi-country graphs, consider building on Valhalla (MIT) or GraphHopper (Apache-2.0) instead of the custom router. Keep the differentiators in our layers: wearable fusion, pickup-point choice and trip-based calibration.

## 8. Open questions for the user

1. Approve the clean-ups in §5 (all deletions are permanent).
2. Consent wording and retention period for trip recording (PDPA).
3. Who emails SLA about storing OneMap routing results?
4. Who drives the probe-drive benchmark (§3.2), and when?
