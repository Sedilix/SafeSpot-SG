# SafeSpot Routing Engine — Scheduled Drive Shadow Probe Report

**Generated**: 2026-10-26T06:03:59.491Z  
**Rows with an engine ETA**: 850 of 850  
**Basis**: engine only. Accuracy is not measured here; see docs/clean-room-calibration.md.  

## Acceptance Criteria Summary

| Metric | Target | Status | Measured Value |
|---|---|---|---|
| **Median Engine Latency** | $< 200$ ms | **PASS** | 172 ms (p95: 579 ms) |
| **Rows Without a Route** | 0 | **PASS** | 0 |

## Time-of-Day Breakdown

| Time Slot (SGT) | Rows | Median ETA | Median Latency | p95 Latency |
|---|---|---|---|---|
| **Morning Peak (07:00-09:30)** | 260 | 23.5 min | 150 ms | 515 ms |
| **Midday (11:30-14:00)** | 130 | 21.6 min | 219 ms | 805 ms |
| **Evening Peak (17:00-20:00)** | 260 | 25.5 min | 197 ms | 593 ms |
| **Night / Off-Peak** | 200 | 21.0 min | 149 ms | 451 ms |

## Corridor Breakdown (10 Fixed Corridors)

| Corridor ID | Rows | Median ETA | ETA Range | Median Distance | Median Latency |
|---|---|---|---|---|---|
| `toa-payoh-to-raffles-place` | 85 | 18.0 min | 15.6–22.0 min | 10.53 km | 368 ms |
| `toa-payoh-to-changi-t3` | 85 | 25.0 min | 21.0–33.5 min | 19.39 km | 240 ms |
| `toa-payoh-to-jurong-east` | 85 | 25.9 min | 21.8–31.4 min | 16.08 km | 247 ms |
| `jurong-west-to-woodlands` | 85 | 27.4 min | 24.1–38.1 min | 18.87 km | 112 ms |
| `jurong-west-to-tampines` | 85 | 45.2 min | 37.6–52.5 min | 33.10 km | 398 ms |
| `jurong-west-to-sengkang` | 85 | 42.7 min | 36.1–53.6 min | 32.21 km | 376 ms |
| `pasir-ris-to-bedok` | 85 | 20.6 min | 17.5–24.4 min | 10.33 km | 52 ms |
| `ang-mo-kio-to-punggol` | 85 | 20.8 min | 18.3–26.6 min | 10.95 km | 89 ms |
| `clementi-to-harbourfront` | 85 | 19.7 min | 17.2–24.0 min | 9.48 km | 87 ms |
| `novena-to-mbs` | 85 | 16.6 min | 14.5–18.8 min | 6.58 km | 72 ms |

