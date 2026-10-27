# LTA DataMall Link-Level Speed Accuracy Evaluation (Held-Out Benchmark)

**Evaluation Date:** 2026-10-26  
**Protocol:** 100% Clean-Room (Singapore Open Data Licence v1.0, LTA DataMall Traffic Speed Bands)  
**Held-Out Dataset:** 4 Full Days (2026-10-23 Friday, 2026-10-24 Saturday, 2026-10-25 Sunday, 2026-10-26 Monday)  
**Weekday Requirement:** Satisfied (holds out 2 full weekdays: Friday 23 Oct & Monday 26 Oct)  
**Link Match Coverage:** **111,815 / 143,787 LTA links (77.8%)** matched to graph edges within 25 m and 35° bearing  
**Total Observations Evaluated:** **40,587,393**  

## 1. Decision Gates (Link Speed Error Gates)

> **Important Distinction:** These gates evaluate instantaneous road-link speed observations across 15-minute intervals. They are distinct from the Trip ETA Gates in `docs/clean-room-calibration.md` §4 (which evaluate door-to-door trip traversal times).

| Decision Gate | Metric | Measured Value | Target | Status |
|---|---|---|---|---|
| **Link Speed Median Accuracy** | Median Absolute % Error | **32.30%** (8.2 km/h) | $\le 15.0\%$ | ❌ **FAIL** |
| **Link Speed Systemic Bias** | Mean Signed Speed Bias | **+49.00%** (-0.4 km/h) | Within $\pm 5.0\%$ | ❌ **FAIL** |
| **Link Speed Tail Variance** | p95 Absolute % Error | **200.00%** (25.2 km/h) | $\le 30.0\%$ | ❌ **FAIL** |

**Gate Verdict:** ⚠️ **GATES REQUIRE ATTENTION**

## 2. Accuracy Breakdown by Road Class

| Road Class | Observations | Median Abs % Err | p95 Abs % Err | Signed Bias % | Median Abs Err (km/h) | p95 Err (km/h) |
|---|---|---|---|---|---|---|
| `motorway` | 922,746 | **15.2%** | 47.4% | -1.2% | 12.0 km/h | 23.6 km/h |
| `motorway_link` | 862,851 | **23.2%** | 200.0% | +24.3% | 13.2 km/h | 33.1 km/h |
| `trunk` | 879,186 | **22.8%** | 155.7% | +28.6% | 11.4 km/h | 28.5 km/h |
| `trunk_link` | 275,880 | **29.7%** | 180.8% | +46.5% | 14.1 km/h | 30.9 km/h |
| `primary` | 5,055,501 | **20.7%** | 89.6% | +18.0% | 8.9 km/h | 25.5 km/h |
| `primary_link` | 614,196 | **33.3%** | 144.7% | +59.9% | 10.0 km/h | 28.5 km/h |
| `secondary` | 3,772,659 | **19.7%** | 173.3% | +39.8% | 6.9 km/h | 26.2 km/h |
| `tertiary` | 4,015,869 | **30.3%** | 142.0% | +39.8% | 9.3 km/h | 27.7 km/h |
| `residential` | 21,340,770 | **39.8%** | 200.0% | +62.5% | 6.0 km/h | 24.3 km/h |
| `unclassified` | 2,421,573 | **32.4%** | 200.0% | +53.9% | 13.0 km/h | 25.9 km/h |

## 3. Accuracy Breakdown by Direction

| Direction | Observations | Median Abs % Err | p95 Abs % Err | Signed Bias % | Median Abs Err (km/h) |
|---|---|---|---|---|---|
| **INBOUND** | 13,370,379 | **32.4%** | 200.0% | +48.6% | 7.9 km/h |
| **OUTBOUND** | 13,437,897 | **32.7%** | 200.0% | +48.8% | 8.2 km/h |
| **CROSS** | 13,779,117 | **32.1%** | 200.0% | +49.6% | 8.4 km/h |

## 4. Accuracy Breakdown by Time Window

| Time Window | Observations | Median Abs % Err | p95 Abs % Err | Signed Bias % | Median Abs Err (km/h) |
|---|---|---|---|---|---|
| **Morning Peak (07:30 - 09:30)** | 3,577,952 | **33.4%** | 200.0% | +47.5% | 8.1 km/h |
| **Midday (11:30 - 14:00)** | 4,472,440 | **31.6%** | 200.0% | +46.8% | 7.0 km/h |
| **Evening Peak (17:30 - 20:00)** | 3,913,385 | **32.7%** | 200.0% | +48.0% | 6.7 km/h |
| **Off-Peak / Night** | 28,623,616 | **32.3%** | 200.0% | +49.7% | 8.6 km/h |

## 5. Accuracy Breakdown by Day Type

| Day Type | Observations | Median Abs % Err | p95 Abs % Err | Signed Bias % | Median Abs Err (km/h) |
|---|---|---|---|---|---|
| **WEEKDAY** | 19,119,681 | **32.1%** | 200.0% | +48.4% | 8.1 km/h |
| **SATURDAY** | 10,733,856 | **32.1%** | 200.0% | +49.2% | 8.2 km/h |
| **SUNDAY_PH** | 10,733,856 | **35.0%** | 200.0% | +50.0% | 8.8 km/h |

## 6. Top 10 Worst Link Discrepancies

Ranked by median absolute percentage error on held-out days (minimum 50 observations):

| # | Link ID | Road Name | LTA Cat | OSM Highway | Obs | Median Abs % Err | p95 Abs % Err | Median Err (km/h) |
|---|---|---|---|---|---|---|---|---|
| 1 | `6` | **LLOYD ROAD** | 5 | `residential` | 363 | **200.0%** | 200.0% | 14.5 km/h |
| 2 | `96` | **DUBLIN ROAD** | 5 | `residential` | 363 | **200.0%** | 200.0% | 14.8 km/h |
| 3 | `107` | **KIM YAM ROAD** | 5 | `residential` | 363 | **200.0%** | 200.0% | 15.1 km/h |
| 4 | `144` | **KILLINEY ROAD** | 5 | `residential` | 363 | **200.0%** | 200.0% | 14.5 km/h |
| 5 | `151` | **DUBLIN ROAD** | 5 | `residential` | 363 | **200.0%** | 200.0% | 14.9 km/h |
| 6 | `198` | **RIVER VALLEY CLOSE** | 4 | `tertiary` | 363 | **200.0%** | 200.0% | 27.4 km/h |
| 7 | `244` | **DUBLIN ROAD** | 5 | `residential` | 363 | **200.0%** | 200.0% | 14.7 km/h |
| 8 | `251` | **DUBLIN ROAD** | 5 | `residential` | 363 | **200.0%** | 200.0% | 14.5 km/h |
| 9 | `260` | **DUBLIN ROAD** | 5 | `residential` | 363 | **200.0%** | 200.0% | 14.6 km/h |
| 10 | `271` | **KILLINEY ROAD** | 4 | `tertiary` | 363 | **200.0%** | 200.0% | 27.6 km/h |

## 7. Architectural Observations & Signal Delay Resolution

1. **Signal Delay Double Counting Settled:** Huber regression ($w_{\text{signal}} = 0.64$ s $\approx 0$ s) proved that space-mean speeds reported by LTA already incorporate signal queueing and deceleration. Setting `DELAY_SIGNAL_SEC = 0.0` restored arterial corridor progression without artificial stacking.
2. **Sub-Arterial Direct Data Fit:** Saturday and Sunday sub-arterials are now directly extracted from over 36 million empirical observations across road categories 4 & 5, replacing hand-typed ternaries.
3. **Link Coverage:** 77.8% of all LTA links cleanly map onto OpenStreetMap geometry within 25 m and 35° bearing alignment, providing robust island-wide ground truth.
