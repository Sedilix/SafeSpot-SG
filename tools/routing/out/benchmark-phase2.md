# SafeSpot Routing Engine — Phase 2 Traffic-Aware Benchmark Report

Generated: 2026-10-07T05:26:37.011Z

## Summary Metrics (Peak Hours: 08:30 & 18:30 SGT)

| Metric | Engine Result | Target | Status |
| :--- | :---: | :---: | :---: |
| **Median Absolute Error (MAE)** | **11.93%** | $\le 20.0\%$ | **PASS** |
| **Mean Absolute Error** | 15.54% | — | — |
| **Error Range** | 0.0% – 42.0% | — | — |
| **Median Query Latency** | **213.3 ms** | $< 400\text{ ms}$ | **PASS** |
| **Max Query Latency** | 340.0 ms | $< 500\text{ ms}$ | **PASS** |

## Trip-by-Trip Comparison vs Google Traffic-Aware Duration

| Destination | Dir | Departure | Google Traffic Min | Engine Min | Diff (min) | Error (%) | Toll SGD | Engine Km | Latency |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Raffles Place (CBD) | A→B | 08:30 | 32.4m | 21.6m | +10.8m | 33.3% | S$0 | 10.99km | 270.5ms |
| Raffles Place (CBD) | A→B | 18:30 | 32.4m | 18.8m | +13.6m | 42% | S$0 | 10.53km | 182.6ms |
| Raffles Place (CBD) | B→A | 08:30 | 25.4m | 21m | +4.4m | 17.3% | S$0 | 10.49km | 158.4ms |
| Raffles Place (CBD) | B→A | 18:30 | 31.1m | 23.2m | +7.9m | 25.4% | S$0 | 10.49km | 178.1ms |
| Changi Airport T3 | A→B | 08:30 | 24.3m | 25.6m | +1.3m | 5.3% | S$0 | 19.39km | 274.4ms |
| Changi Airport T3 | A→B | 18:30 | 29m | 26.2m | +2.8m | 9.7% | S$0 | 19.39km | 272ms |
| Changi Airport T3 | B→A | 08:30 | 26.4m | 31.7m | +5.3m | 20.1% | S$0 | 20.61km | 219.1ms |
| Changi Airport T3 | B→A | 18:30 | 31m | 30.9m | +0.1m | 0.3% | S$0 | 20.61km | 207.4ms |
| Jurong East MRT | A→B | 08:30 | 26.2m | 26.2m | +0m | 0% | S$0 | 16.08km | 304.6ms |
| Jurong East MRT | A→B | 18:30 | 29.3m | 26.6m | +2.7m | 9.2% | S$0 | 15.94km | 340ms |
| Jurong East MRT | B→A | 08:30 | 27.2m | 24.5m | +2.7m | 9.9% | S$0 | 15.03km | 124.2ms |
| Jurong East MRT | B→A | 18:30 | 28m | 24.1m | +3.9m | 13.9% | S$0 | 15.03km | 145.1ms |
