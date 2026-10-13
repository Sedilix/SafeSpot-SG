# SafeSpot Routing Engine — Scheduled Drive Shadow Probe Report

**Generated**: 2026-10-13T06:36:41.704Z  
**Total Observations**: 10  
**Evaluation Basis**: SafeSpot Traffic-Aware Engine vs Google Routes API (TRAFFIC_AWARE)  

## Acceptance Criteria Summary

| Metric | Target | Status | Measured Value |
|---|---|---|---|
| **Median Absolute Error** | $\le 20.0\%$ | **PASS** | 0% |
| **Median Engine Latency** | $< 200$ ms | **PASS** | 156 ms (p95: 326 ms) |
| **Mean Signed Error** | Bias monitor | **INFO** | 0% |

## Time-of-Day Performance Breakdown

| Time Slot (SGT) | Probes | Median Abs Error | Mean Signed Error | Median Latency | p95 Latency |
|---|---|---|---|---|---|
| **Morning Peak (07:00-09:30)** | 0 | 0% | 0% | 0 ms | 0 ms |
| **Midday (11:30-14:00)** | 0 | 0% | 0% | 0 ms | 0 ms |
| **Evening Peak (17:00-20:00)** | 0 | 0% | 0% | 0 ms | 0 ms |
| **Night / Off-Peak** | 10 | 0% | 0% | 156 ms | 326 ms |

## Corridor Pairwise Breakdown (10 Fixed Corridors)

| Corridor ID | Observations | Median Abs Error | Mean Signed Error | Median Latency |
|---|---|---|---|---|
| `toa-payoh-to-raffles-place` | 1 | 0% | 0% | 228 ms |
| `toa-payoh-to-changi-t3` | 1 | 0% | 0% | 156 ms |
| `toa-payoh-to-jurong-east` | 1 | 0% | 0% | 166 ms |
| `jurong-west-to-woodlands` | 1 | 0% | 0% | 116 ms |
| `jurong-west-to-tampines` | 1 | 0% | 0% | 324 ms |
| `jurong-west-to-sengkang` | 1 | 0% | 0% | 326 ms |
| `pasir-ris-to-bedok` | 1 | 0% | 0% | 42 ms |
| `ang-mo-kio-to-punggol` | 1 | 0% | 0% | 89 ms |
| `clementi-to-harbourfront` | 1 | 0% | 0% | 76 ms |
| `novena-to-mbs` | 1 | 0% | 0% | 60 ms |

