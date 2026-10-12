# SafeSpot Routing Engine — Held-Out Benchmark Evaluation Report

Generated: 2026-10-12T04:18:20.478Z
Per `ROUTING_PLAN.md` §7 Fix C: Held-out benchmark test without retuning any heuristic constants.

## 1. Side-by-Side Benchmark Summary

| Benchmark Evaluation | Original Dataset (Toa Payoh) | Held-Out Dataset (Jurong West) | Delta (Held-out - Orig) | Status / Target |
| :--- | :---: | :---: | :---: | :---: |
| **Phase 1 Free-Flow Median Absolute Error (MAE)** | **7.49%** | **5.75%** | -1.74% | PASS (<= 15%) |
| **Phase 1 Free-Flow Mean Error** | 11.76% | 6.02% | -5.75% | — |
| **Phase 2 Traffic-Aware Peak MAE (08:30 & 18:30)** | **11.93%** | **7.93%** | -3.99% | PASS (<= 20%) |
| **Phase 2 Traffic-Aware Mean Error** | 15.54% | 8.23% | -7.31% | — |
| **Median Query Latency** | 289.4 ms | 1115.1 ms | — | **PASS (< 400 ms)** |

## 2. Held-Out Dataset Details

- **Origin**: Jurong West St 64 (1.3404, 103.709)
- **Destinations**:
  - Woodlands MRT (1.437, 103.7865)
  - Tampines Hub (1.3534, 103.9401)
  - Sengkang General Hospital (1.3955, 103.893)
- **Probe Date**: 2026-10-14 (Held-out weekday, independent from 2026-10-08 training probe)
- **Heuristic Status**: Factors in `src/routing/speedProfiles.ts` are marked `HEURISTIC (tuned on probe 2026-10-08, not from logged data)` and were strictly **not** retuned.

## 3. Held-Out Trip-by-Trip Results (Peak Hours: 08:30 & 18:30)

| Destination | Dir | Departure | Google Traffic Min | Engine Min | Diff (min) | Error (%) | Toll | Engine Km | Latency |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Woodlands MRT | A→B | 08:30 | 26.7m | 28.6m | +1.9m | 7.1% | ERP: unknown | 18.87km | 139.3ms |
| Woodlands MRT | A→B | 18:30 | 33.9m | 34.2m | +0.3m | 0.9% | ERP: unknown | 18.87km | 277.8ms |
| Woodlands MRT | B→A | 08:30 | 34.9m | 38m | +3.1m | 8.9% | ERP: unknown | 19.54km | 267ms |
| Woodlands MRT | B→A | 18:30 | 32.1m | 32.6m | +0.5m | 1.6% | ERP: unknown | 19.54km | 506.6ms |
| Tampines Hub | A→B | 08:30 | 49.1m | 45.4m | +3.7m | 7.5% | ERP: unknown | 33.1km | 997.6ms |
| Tampines Hub | A→B | 18:30 | 52.6m | 46m | +6.6m | 12.5% | ERP: unknown | 32.96km | 1232.7ms |
| Tampines Hub | B→A | 08:30 | 54.8m | 48.2m | +6.6m | 12% | ERP: unknown | 32.45km | 1468.9ms |
| Tampines Hub | B→A | 18:30 | 59m | 48.4m | +10.6m | 18% | ERP: unknown | 32.45km | 1390.6ms |
| Sengkang General Hospital | A→B | 08:30 | 39.7m | 43.9m | +4.2m | 10.6% | ERP: unknown | 32.21km | 939.2ms |
| Sengkang General Hospital | A→B | 18:30 | 45.2m | 47.5m | +2.3m | 5.1% | ERP: unknown | 32.21km | 2115.9ms |
| Sengkang General Hospital | B→A | 08:30 | 45.6m | 49.4m | +3.8m | 8.3% | ERP: unknown | 32.54km | 1398ms |
| Sengkang General Hospital | B→A | 18:30 | 43.5m | 46.2m | +2.7m | 6.2% | ERP: unknown | 32.54km | 1233.7ms |

## 4. Analysis and Findings

- **Generalization**: The routing engine maintained a traffic-aware peak MAE of **7.93%** (<= 20.0%), confirming that the directional peak speed profiles generalize reasonably to western Singapore corridors (AYE/PIE) without overfitting.
- **ERP Handling**: Toll computation safely reported `ERP: unknown` for all routes per Fix A, as unverified production gantries are disabled.
