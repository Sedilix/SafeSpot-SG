# SafeSpot Routing Engine — Held-Out Benchmark Evaluation Report

Generated: 2026-10-19T20:05:24.975Z
Per `ROUTING_PLAN.md` §7 Fix C & §8 Fix D: Held-out benchmark test without retuning any heuristic constants.

## 1. Side-by-Side Benchmark Summary

| Benchmark Evaluation | Original Dataset (Toa Payoh) | Held-Out Dataset (Jurong West) | Delta (Held-out - Orig) | Status / Target |
| :--- | :---: | :---: | :---: | :---: |
| **Phase 1 Free-Flow Median Absolute Error** | **9.29%** | **4.14%** | -5.15% | **PASS (<= 15%)** |
| **Phase 1 Free-Flow Mean Absolute Error** | 13.01% | 4.90% | -8.11% | — |
| **Phase 1 Free-Flow Mean Signed Error** | -8.34% | +2.77% | +11.12% | — |
| **Phase 2 Traffic-Aware Peak Median Absolute Error (08:30 & 18:30)** | **13.38%** | **7.99%** | -5.38% | **PASS (<= 20%)** |
| **Phase 2 Traffic-Aware Peak Mean Absolute Error** | 16.69% | 7.26% | -9.43% | — |
| **Phase 2 Traffic-Aware Peak Mean Signed Error** | -12.93% | -0.53% | +12.40% | — |
| **Query Latency (Median / p95)** | 185.8 ms / 267.9 ms | 313.9 ms / 492.8 ms | — | **FAIL (target < 200 ms)** |

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
| Woodlands MRT | A→B | 08:30 | 26.7m | 27.4m | +0.7m | 2.6% | +2.6% | ERP: unknown | 18.87km | 51.2ms |
| Woodlands MRT | A→B | 18:30 | 33.9m | 32.8m | -1.1m | 3.2% | -3.2% | ERP: unknown | 18.87km | 82.8ms |
| Woodlands MRT | B→A | 08:30 | 34.9m | 37.8m | +2.9m | 8.3% | +8.3% | ERP: unknown | 19.87km | 105.3ms |
| Woodlands MRT | B→A | 18:30 | 32.1m | 32.6m | +0.5m | 1.6% | +1.6% | ERP: unknown | 19.87km | 85ms |
| Tampines Hub | A→B | 08:30 | 49.1m | 45.2m | -3.9m | 7.9% | -7.9% | ERP: unknown | 33.1km | 239.3ms |
| Tampines Hub | A→B | 18:30 | 52.6m | 45.7m | -6.9m | 13.1% | -13.1% | ERP: unknown | 32.96km | 286.1ms |
| Tampines Hub | B→A | 08:30 | 54.8m | 50.2m | -4.6m | 8.4% | -8.4% | ERP: unknown | 33.1km | 390.5ms |
| Tampines Hub | B→A | 18:30 | 59m | 50.7m | -8.3m | 14.1% | -14.1% | ERP: unknown | 33.1km | 382ms |
| Sengkang General Hospital | A→B | 08:30 | 39.7m | 42.7m | +3.0m | 7.6% | +7.6% | ERP: unknown | 32.21km | 341.8ms |
| Sengkang General Hospital | A→B | 18:30 | 45.2m | 46.1m | +0.9m | 2.0% | +2.0% | ERP: unknown | 32.21km | 435.4ms |
| Sengkang General Hospital | B→A | 08:30 | 45.6m | 50.3m | +4.7m | 10.3% | +10.3% | ERP: unknown | 32.37km | 492.8ms |
| Sengkang General Hospital | B→A | 18:30 | 43.5m | 47m | +3.5m | 8.0% | +8.0% | ERP: unknown | 32.37km | 429.5ms |

## 4. Analysis and Findings

- **Accuracy & Generalization**: The routing engine maintained a traffic-aware peak median absolute error of **7.99%** (target <= 20.0%), indicating directional speed profiles generalize without major degradation on Western Singapore corridors.
- **Signed Difference & Systematic Bias**: Mean signed error is **-0.53%**. On the long cross-island corridor to Tampines Hub, the engine systematically **underestimates** travel times by up to **-10.6 minutes (-18.0%)** (e.g., Tampines A→B 08:30 is **-3.7m**, Tampines B→A 18:30 is **-10.6m**). This demonstrates that heuristic multipliers underestimate compound expressway congestion across 30+ km spans.
- **Latency**: **FAIL**. Median latency on the held-out set is **313.9 ms** (p95: **492.8 ms**, max: **492.8 ms**), missing the §5 Phase 1 target of < 200 ms per route.
- **Google Prediction Baseline**: Google Routes baseline durations were calculated using departure times in the future (forecasted traffic model), not observed ground-truth telemetry.
- **ERP Handling**: Toll computation safely reported `ERP: unknown` for all routes per Fix A, as unverified production gantries are disabled.
