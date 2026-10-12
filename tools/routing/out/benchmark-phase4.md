# SafeSpot Routing Engine — Phase 4 Alternatives & Multi-Criteria Benchmark

**Generated**: 2026-10-12T05:35:10.571Z  
**Origin**: Blk 480 Toa Payoh (1.3327, 103.8479)  
**Departure**: 2026-10-14 08:30:00 SGT (Morning Peak)  
**Engine**: SafeSpot A* with Edge Penalty Method (x1.35) & 3-Objective Pareto Ranking  

## Acceptance Criteria Summary

| Criterion | Target | Status | Detail |
|---|---|---|---|
| **Spatially Distinct** | Max overlap < 65% | **PASS** | All generated alternative pairs verified < 65% length overlap |
| **Pareto Non-Dominated Survivors** | 100% survivors non-dominated | **PASS** | Pruned all dominated candidates; 1 to 3 non-dominated routes returned per trip |
| **Alternatives Latency** | < 1,000 ms (Interactive) | **FAIL** | Average 8730 ms for sequential alternative explorations (FAIL for interactive use; production pickup uses E3 one-to-many worker search < 1 s) |

## Trip Evaluations

### Blk 480 Toa Payoh → Raffles Place (CBD)

*Generated 3 non-dominated routes in 1349 ms.*  

#### Pairwise Spatial Overlap
| Route Pair | Spatial Overlap | Status (< 65%) |
|---|---|---|
| Route 1 vs Route 2 | **19.2%** | PASS (Distinct) |
| Route 1 vs Route 3 | **11.2%** | PASS (Distinct) |
| Route 2 vs Route 3 | **5.2%** | PASS (Distinct) |

#### Multi-Criteria Non-Dominated Alternatives

| Rank | Archetype | Time (min) | Dist (km) | Fuel (L) | Money (SGD) | Risk Score | Pareto Status | Trade-off Summary |
|---|---|---|---|---|---|---|---|---|
| #1 | **FASTEST** | 21.6 min | 10.99 km | 0.943 L | fuel $2.78 + ERP unknown | 0 | Non-Dominated | 21.6 min • fuel $2.78 + ERP unknown |
| #2 | **BALANCED** | 21.8 min | 10.53 km | 0.926 L | fuel $2.73 + ERP unknown | 0 | Non-Dominated | 21.8 min • fuel $2.73 + ERP unknown |
| #3 | **BALANCED** | 25.4 min | 8.16 km | 0.911 L | fuel $2.69 + ERP unknown | 0 | Non-Dominated | 25.4 min • fuel $2.69 + ERP unknown |

### Blk 480 Toa Payoh → Changi Airport T3

*Generated 1 non-dominated route in 19819 ms (dominated slower & dearer candidates and >1.5x detours were strictly pruned).*  

#### Pairwise Spatial Overlap
| Route Pair | Spatial Overlap | Status (< 65%) |
|---|---|---|
| Route 1 vs Route 2 | **27.7%** | PASS (Distinct) |

#### Multi-Criteria Non-Dominated Alternatives

| Rank | Archetype | Time (min) | Dist (km) | Fuel (L) | Money (SGD) | Risk Score | Pareto Status | Trade-off Summary |
|---|---|---|---|---|---|---|---|---|
| #1 | **FASTEST** | 25.6 min | 19.39 km | 1.461 L | fuel $4.31 + ERP unknown | 0 | Non-Dominated | 25.6 min • fuel $4.31 + ERP unknown |

### Blk 480 Toa Payoh → Jurong East MRT

*Generated 1 non-dominated route in 5023 ms (dominated slower & dearer candidates and >1.5x detours were strictly pruned).*  

#### Pairwise Spatial Overlap
| Route Pair | Spatial Overlap | Status (< 65%) |
|---|---|---|
| Route 1 vs Route 2 | **3.9%** | PASS (Distinct) |
| Route 1 vs Route 3 | **39.9%** | PASS (Distinct) |
| Route 2 vs Route 3 | **3.8%** | PASS (Distinct) |

#### Multi-Criteria Non-Dominated Alternatives

| Rank | Archetype | Time (min) | Dist (km) | Fuel (L) | Money (SGD) | Risk Score | Pareto Status | Trade-off Summary |
|---|---|---|---|---|---|---|---|---|
| #1 | **FASTEST** | 26.2 min | 16.08 km | 1.279 L | fuel $3.77 + ERP unknown | 0 | Non-Dominated | 26.2 min • fuel $3.77 + ERP unknown |

