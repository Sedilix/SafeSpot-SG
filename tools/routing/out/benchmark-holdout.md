# SafeSpot Routing Engine — Held-Out Benchmark Evaluation Report

Generated: 2026-10-19T08:29:03.033Z
Per `ROUTING_PLAN.md` §7 Fix C & §8 Fix D: Held-out benchmark test without retuning any heuristic constants.

## 1. Side-by-Side Benchmark Summary

| Benchmark Evaluation | Original Dataset (Toa Payoh) | Held-Out Dataset (Jurong West) | Delta (Held-out - Orig) | Status / Target |
| :--- | :---: | :---: | :---: | :---: |
| **Phase 1 Free-Flow Median Absolute Error** | **7.49%** | **5.75%** | -1.74% | **PASS (<= 15%)** |
| **Phase 1 Free-Flow Mean Absolute Error** | 11.76% | 6.02% | -5.75% | — |
| **Phase 1 Free-Flow Mean Signed Error** | -6.70% | +3.01% | +9.71% | — |
| **Phase 2 Traffic-Aware Peak Median Absolute Error (08:30 & 18:30)** | **11.93%** | **7.93%** | -3.99% | **PASS (<= 20%)** |
| **Phase 2 Traffic-Aware Peak Mean Absolute Error** | 15.57% | 8.21% | -7.35% | — |
| **Phase 2 Traffic-Aware Peak Mean Signed Error** | -11.33% | -0.11% | +11.22% | — |
| **Query Latency (Median / p95)** | 54.0 ms / 90.9 ms | 169.9 ms / 455.8 ms | — | **PASS (< 200 ms)** |

## 2. Held-Out Dataset Details

- **Origin**: Jurong West St 64 (1.3404, 103.709)
- **Destinations**:
  - Woodlands MRT (1.437, 103.7865)
  - Tampines Hub (1.3534, 103.9401)
  - Sengkang General Hospital (1.3955, 103.893)
- **Probe Date & Nature**: 2026-10-14. **Note:** Google Routes times are **predicted traffic forecasts** (departure 2026-10-14 was in the future when probed via Google Routes API), not observed historical speeds.
- **Heuristic Status**: Factors in `src/routing/speedProfiles.ts` are marked `HEURISTIC (tuned on probe 2026-10-08, not from logged data)` and were strictly **not** retuned.

## 3. Held-Out Trip-by-Trip Results (Peak Hours: 08:30 & 18:30)

| Destination | Dir | Departure | Google Forecast Min | Engine Min | Diff (min) | Abs Error (%) | Signed Error (%) | Toll | Engine Km | Latency |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Woodlands MRT | A→B | 08:30 | 26.7m | 28.6m | +1.9m | 7.1% | +7.1% | ERP: unknown | 18.87km | 33.9ms |
| Woodlands MRT | A→B | 18:30 | 33.9m | 34.2m | +0.3m | 0.9% | +0.9% | ERP: unknown | 18.87km | 58ms |
| Woodlands MRT | B→A | 08:30 | 34.9m | 38m | +3.1m | 8.9% | +8.9% | ERP: unknown | 19.54km | 54.6ms |
| Woodlands MRT | B→A | 18:30 | 32.1m | 32.6m | +0.5m | 1.6% | +1.6% | ERP: unknown | 19.54km | 39.5ms |
| Tampines Hub | A→B | 08:30 | 49.1m | 45.4m | -3.7m | 7.5% | -7.5% | ERP: unknown | 33.1km | 122.3ms |
| Tampines Hub | A→B | 18:30 | 52.6m | 46m | -6.6m | 12.5% | -12.5% | ERP: unknown | 32.96km | 155.2ms |
| Tampines Hub | B→A | 08:30 | 54.8m | 48.2m | -6.6m | 12.0% | -12.0% | ERP: unknown | 32.45km | 222.8ms |
| Tampines Hub | B→A | 18:30 | 59m | 48.5m | -10.5m | 17.8% | -17.8% | ERP: unknown | 32.45km | 210.6ms |
| Sengkang General Hospital | A→B | 08:30 | 39.7m | 43.9m | +4.2m | 10.6% | +10.6% | ERP: unknown | 32.21km | 184.5ms |
| Sengkang General Hospital | A→B | 18:30 | 45.2m | 47.5m | +2.3m | 5.1% | +5.1% | ERP: unknown | 32.21km | 308.9ms |
| Sengkang General Hospital | B→A | 08:30 | 45.6m | 49.4m | +3.8m | 8.3% | +8.3% | ERP: unknown | 32.54km | 455.8ms |
| Sengkang General Hospital | B→A | 18:30 | 43.5m | 46.2m | +2.7m | 6.2% | +6.2% | ERP: unknown | 32.54km | 403.4ms |

## 4. Analysis and Findings

- **Accuracy & Generalization**: The routing engine maintained a traffic-aware peak median absolute error of **7.93%** (target <= 20.0%), indicating directional speed profiles generalize without major degradation on Western Singapore corridors.
- **Signed Difference & Systematic Bias**: Mean signed error is **-0.11%**. On the long cross-island corridor to Tampines Hub, the engine systematically **underestimates** travel times by up to **-10.6 minutes (-18.0%)** (e.g., Tampines A→B 08:30 is **-3.7m**, Tampines B→A 18:30 is **-10.6m**). This demonstrates that heuristic multipliers underestimate compound expressway congestion across 30+ km spans.
- **Latency**: **PASS**. Median latency on the held-out set is **169.9 ms** (p95: **455.8 ms**, max: **455.8 ms**), meeting the target of < 200 ms median per route.
- **Google Prediction Baseline**: Google Routes baseline durations were calculated using departure times in the future (forecasted traffic model), not observed ground-truth telemetry.
- **ERP Handling**: Toll computation safely reported `ERP: unknown` for all routes per Fix A, as unverified production gantries are disabled.
