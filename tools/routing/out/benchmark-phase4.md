# SafeSpot Routing Engine — Phase 4 Alternatives & Multi-Criteria Benchmark

**Generated**: 2026-10-12T04:32:48.258Z  
**Origin**: Blk 480 Toa Payoh (1.3327, 103.8479)  
**Departure**: 2026-10-14 08:30:00 SGT (Morning Peak)  
**Engine**: SafeSpot A* with Edge Penalty Method (x1.35) & 3-Objective Pareto Ranking  

## Acceptance Criteria Summary

| Criterion | Target | Status | Detail |
|---|---|---|---|
| **Spatially Distinct** | Max overlap < 65% | **PASS** | All alternative pairs verified < 65% length overlap |
| **Pareto Non-Dominated** | Frontier identified | **PASS** | Time vs Money vs Risk trade-offs evaluated |
| **Execution Latency** | Interactive | **PASS** | Average 3880 ms for up to 3 full alternatives |

## Trip Evaluations

### Blk 480 Toa Payoh → Raffles Place (CBD)

*Generated 3 routes in 1722 ms.*

#### Pairwise Spatial Overlap
| Route Pair | Spatial Overlap | Status (< 65%) |
|---|---|---|
| Route 1 vs Route 2 | **19.2%** | PASS (Distinct) |
| Route 1 vs Route 3 | **11.2%** | PASS (Distinct) |
| Route 2 vs Route 3 | **5.2%** | PASS (Distinct) |

#### Multi-Criteria Top-3 Ranked Alternatives

| Rank | Archetype | Time (min) | Dist (km) | Fuel (L) | Money (SGD) | Risk Score | Pareto Status | Trade-off Summary |
|---|---|---|---|---|---|---|---|---|
| #1 | **FASTEST** | 21.6 min | 10.99 km | 0.943 L | $2.78 | 0 | Non-Dominated | 21.6 min • $2.78 |
| #2 | **BALANCED** | 21.8 min | 10.53 km | 0.926 L | $2.73 | 0 | Non-Dominated | 21.8 min • $2.73 |
| #3 | **CHEAPEST** | 25.4 min | 8.16 km | 0.911 L | $2.69 | 0 | Non-Dominated | 25.4 min • $2.69 |

### Blk 480 Toa Payoh → Changi Airport T3

*Generated 3 routes in 6118 ms.*

#### Pairwise Spatial Overlap
| Route Pair | Spatial Overlap | Status (< 65%) |
|---|---|---|
| Route 1 vs Route 2 | **27.7%** | PASS (Distinct) |
| Route 1 vs Route 3 | **23.7%** | PASS (Distinct) |
| Route 2 vs Route 3 | **16.1%** | PASS (Distinct) |

#### Multi-Criteria Top-3 Ranked Alternatives

| Rank | Archetype | Time (min) | Dist (km) | Fuel (L) | Money (SGD) | Risk Score | Pareto Status | Trade-off Summary |
|---|---|---|---|---|---|---|---|---|
| #1 | **FASTEST** | 25.6 min | 19.39 km | 1.461 L | $4.31 | 0 | Non-Dominated | 25.6 min • $4.31 |
| #2 | **BALANCED** | 31.1 min | 22.04 km | 1.682 L | $4.96 | 0 | Dominated | 31.1 min • $4.96 |
| #3 | **BALANCED** | 42.3 min | 26.62 km | 2.099 L | $6.19 | 0 | Dominated | 42.3 min • $6.19 |

### Blk 480 Toa Payoh → Jurong East MRT

*Generated 3 routes in 3801 ms.*

#### Pairwise Spatial Overlap
| Route Pair | Spatial Overlap | Status (< 65%) |
|---|---|---|
| Route 1 vs Route 2 | **3.9%** | PASS (Distinct) |
| Route 1 vs Route 3 | **39.9%** | PASS (Distinct) |
| Route 2 vs Route 3 | **3.8%** | PASS (Distinct) |

#### Multi-Criteria Top-3 Ranked Alternatives

| Rank | Archetype | Time (min) | Dist (km) | Fuel (L) | Money (SGD) | Risk Score | Pareto Status | Trade-off Summary |
|---|---|---|---|---|---|---|---|---|
| #1 | **FASTEST** | 26.2 min | 16.08 km | 1.279 L | $3.77 | 0 | Non-Dominated | 26.2 min • $3.77 |
| #2 | **BALANCED** | 32.5 min | 16.41 km | 1.413 L | $4.17 | 0 | Dominated | 32.5 min • $4.17 |
| #3 | **BALANCED** | 38.4 min | 24.49 km | 1.923 L | $5.67 | 0 | Dominated | 38.4 min • $5.67 |

