# SafeSpot Routing Engine â€” Phase 1 Benchmark Report

Generated: 2026-10-13T05:37:46.343Z

## Summary Metrics

| Metric | Engine Result | Target | Status |
| :--- | :---: | :---: | :---: |
| **Median Absolute Error (MAE)** | **7.49%** | $\le 15.0\%$ | **PASS** |
| **Mean Absolute Error** | 11.76% | — | — |
| **Error Range** | 1.4% – 31.5% | — | — |
| **Median Query Latency** | **42.5 ms** | $< 200\text{ ms}$ | **PASS** |
| **Max Query Latency** | 93.6 ms | $< 200\text{ ms}$ | **PASS** |

## Trip-by-Trip Comparison vs Google Free-Flow (staticDuration)

| Trip | Dir | Departure | Google Min | Engine Min | Diff (min) | Error (%) | Engine Km | Google Km | Latency |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | A→B | 07:30 | 23.8m | 16.3m | +7.5m | 31.5% | 10.53km | 10.4km | 66ms |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | A→B | 08:30 | 23.8m | 16.3m | +7.5m | 31.5% | 10.53km | 10.4km | 42.7ms |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | A→B | 11:00 | 23.8m | 16.3m | +7.5m | 31.5% | 10.53km | 10.4km | 35.2ms |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | A→B | 18:30 | 23.8m | 16.3m | +7.5m | 31.5% | 10.53km | 10.4km | 30.1ms |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | A→B | 22:00 | 20.6m | 16.3m | +4.3m | 20.9% | 10.53km | 12.4km | 35.3ms |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | B→A | 07:30 | 22.5m | 18.2m | +4.3m | 19.1% | 10.49km | 10km | 40.1ms |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | B→A | 08:30 | 22.5m | 18.2m | +4.3m | 19.1% | 10.49km | 10km | 44.9ms |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | B→A | 11:00 | 22.5m | 18.2m | +4.3m | 19.1% | 10.49km | 10km | 42ms |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | B→A | 18:30 | 22.5m | 18.2m | +4.3m | 19.1% | 10.49km | 10km | 34.3ms |
| Blk 480 Toa Payoh ↔ Raffles Place (CBD) | B→A | 22:00 | 20m | 18.2m | +1.8m | 9% | 10.49km | 11.9km | 36.5ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | A→B | 07:30 | 22.6m | 21.5m | +1.1m | 4.9% | 19.39km | 19.3km | 50.5ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | A→B | 08:30 | 22.6m | 21.5m | +1.1m | 4.9% | 19.39km | 19.3km | 60.8ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | A→B | 11:00 | 21.8m | 21.5m | +0.3m | 1.4% | 19.39km | 19.8km | 51.8ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | A→B | 18:30 | 22.6m | 21.5m | +1.1m | 4.9% | 19.39km | 19.3km | 45ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | A→B | 22:00 | 21.8m | 21.5m | +0.3m | 1.4% | 19.39km | 19.8km | 40.3ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | B→A | 07:30 | 23.1m | 26m | +2.9m | 12.6% | 20.61km | 20.5km | 40.5ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | B→A | 08:30 | 23.1m | 26m | +2.9m | 12.6% | 20.61km | 20.5km | 42.3ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | B→A | 11:00 | 23.1m | 26m | +2.9m | 12.6% | 20.61km | 20.5km | 65.6ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | B→A | 18:30 | 23.1m | 26m | +2.9m | 12.6% | 20.61km | 20.5km | 56.3ms |
| Blk 480 Toa Payoh ↔ Changi Airport T3 | B→A | 22:00 | 23.1m | 26m | +2.9m | 12.6% | 20.61km | 20.5km | 93.6ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | A→B | 07:30 | 21.3m | 22m | +0.7m | 3.3% | 17.05km | 15.6km | 60.6ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | A→B | 08:30 | 23.4m | 22m | +1.4m | 6% | 17.05km | 17.8km | 54.2ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | A→B | 11:00 | 21.3m | 22m | +0.7m | 3.3% | 17.05km | 15.6km | 58.4ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | A→B | 18:30 | 21.3m | 22m | +0.7m | 3.3% | 17.05km | 15.6km | 57ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | A→B | 22:00 | 21.3m | 22m | +0.7m | 3.3% | 17.05km | 15.6km | 55.4ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | B→A | 07:30 | 21.2m | 20.3m | +0.9m | 4.2% | 15.03km | 15.2km | 27.2ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | B→A | 08:30 | 21.2m | 20.3m | +0.9m | 4.2% | 15.03km | 15.2km | 33.5ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | B→A | 11:00 | 21.2m | 20.3m | +0.9m | 4.2% | 15.03km | 15.2km | 30.2ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | B→A | 18:30 | 21.2m | 20.3m | +0.9m | 4.2% | 15.03km | 15.2km | 30.1ms |
| Blk 480 Toa Payoh ↔ Jurong East MRT | B→A | 22:00 | 21.2m | 20.3m | +0.9m | 4.2% | 15.03km | 15.2km | 38.7ms |
