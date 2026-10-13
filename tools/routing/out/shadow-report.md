# SafeSpot Routing Engine — Scheduled Drive Shadow Probe Report

**Generated**: 2026-10-13T05:17:26.422Z  
**Total Observations**: 22  
**Evaluation Basis**: SafeSpot Traffic-Aware Engine vs Google Routes API (TRAFFIC_AWARE)  

## Acceptance Criteria Summary

| Metric | Target | Status | Measured Value |
|---|---|---|---|
| **Median Absolute Error** | $\le 20.0\%$ | **PASS** | 14% |
| **Median Engine Latency** | $< 200$ ms | **FAIL** | 821 ms (p95: 2241 ms) |
| **Mean Signed Error** | Bias monitor | **INFO** | +0.7% |

## Time-of-Day Performance Breakdown

| Time Slot (SGT) | Probes | Median Abs Error | Mean Signed Error | Median Latency | p95 Latency |
|---|---|---|---|---|---|
| **Morning Peak (07:00-09:30)** | 0 | 0% | 0% | 0 ms | 0 ms |
| **Midday (11:30-14:00)** | 22 | 14% | +0.7% | 821 ms | 2241 ms |
| **Evening Peak (17:00-20:00)** | 0 | 0% | 0% | 0 ms | 0 ms |
| **Night / Off-Peak** | 0 | 0% | 0% | 0 ms | 0 ms |

## Corridor Pairwise Breakdown (10 Fixed Corridors)

| Corridor ID | Observations | Median Abs Error | Mean Signed Error | Median Latency |
|---|---|---|---|---|
| `toa-payoh-to-raffles-place` | 4 | 10.9% | -5.28% | 713 ms |
| `toa-payoh-to-changi-t3` | 2 | 19.1% | -16.25% | 1528 ms |
| `toa-payoh-to-jurong-east` | 2 | 26.1% | +15.25% | 976 ms |
| `jurong-west-to-woodlands` | 2 | 15.1% | +14.3% | 413 ms |
| `jurong-west-to-tampines` | 2 | 20.6% | +20.05% | 2241 ms |
| `jurong-west-to-sengkang` | 2 | 14.6% | +14.2% | 2216 ms |
| `pasir-ris-to-bedok` | 2 | 0.9% | -0.55% | 241 ms |
| `ang-mo-kio-to-punggol` | 2 | 24.1% | +23.4% | 864 ms |
| `clementi-to-harbourfront` | 2 | 100% | -41.05% | 3517 ms |
| `novena-to-mbs` | 2 | 12.1% | -11.05% | 374 ms |

