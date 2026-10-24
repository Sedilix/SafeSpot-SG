# Corridor audit: engine vs Google Routes

- Departure: 2026-10-22T00:30:00.000Z (engine and Google; Google times are predicted traffic)
- Graph: 169316 nodes, 4933 traffic-signal nodes
- An engine edge more than 35 m from Google's polyline is **divergent**; each run is compared with Google's route between the points where the engine leaves and rejoins it.
- Google per-stretch seconds are step static durations scaled to the traffic-aware route total.

## Novena Square -> Marina Bay Sands (`novena-to-mbs`)

| | Distance | Time | Signals |
|---|---|---|---|
| Google | 8128 m | 1333 s | |
| Engine | 6580 m | 1236 s | 16 |
| Engine − Google | -1548 m | -97 s (-7.3%) | |
| Engine timing of Google's road | 8094 m | 1445 s | 21 |

Shared corridor: 21% of the engine's distance; 2 divergent run(s).

"Engine s on Google's road" is the engine's own time for Google's stretch (its route forced onto Google's corridor).

| # | Kind | Engine roads | Engine m | Engine s | Signals | Google roads | Google m | Google s | Diff (s) | Engine s on Google's road (signals) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | shared | Sinaran Drive | 113 | 25 | 0 | Head northeast; Keep right to continue toward Sinaran Dr | 87 | 34 | -9 | 18 (0) |
| 2 | **divergent** | Sinaran Drive, tertiary_link, Irrawaddy Road, Thomson Road | 1018 | 240 | 3 | Keep right to continue toward Sinaran Dr; Turn right onto Sinaran Dr; Turn left after Novelis @ Novena (on the left); Continue onto Balestier Rd; Turn right onto the Rangoon Rd/CTE ramp to City; Take the CTE ramp to City; Merge onto Central Expw. | 2419 | 384 | -143 | 405 (3) |
| 3 | shared | Thomson Road | 84 | 16 | 0 | Merge onto Central Expw. | 44 | 3 | +13 | 4 (0) |
| 4 | **divergent** | Keng Lee Road, trunk_link, Bukit Timah Road, Sungei Road, Ophir Road, Republic Boulevard, Raffles Avenue | 4205 | 733 | 11 | Merge onto Central Expw.; Keep right to stay on Central Expw.; Slight left toward Buyong Rd (signs for Orchard Rd); Keep left to continue on Buyong Rd; Turn left onto Orchard Rd; Continue onto Bras Basah Rd; Continue onto Raffles Blvd; Turn right onto Temasek Ave | 4402 | 644 | +89 | 798 (16) |
| 5 | shared | Raffles Avenue, Bayfront Avenue, Sheares Link, Sheares Avenue | 1158 | 222 | 2 | Turn right onto Temasek Ave; Continue onto Bayfront Ave; Turn left onto Sheares Link; Turn left onto Sheares Ave; Turn left; Turn right | 1176 | 268 | -46 | 220 (2) |

---

## Blk 480 Toa Payoh -> Raffles Place (CBD) (`toa-payoh-to-raffles-place`)

| | Distance | Time | Signals |
|---|---|---|---|
| Google | 9377 m | 1566 s | |
| Engine | 10528 m | 1310 s | 11 |
| Engine − Google | +1151 m | -256 s (-16.3%) | |
| Engine timing of Google's road | 9058 m | 1400 s | 13 |

Shared corridor: 5% of the engine's distance; 1 divergent run(s).

"Engine s on Google's road" is the engine's own time for Google's stretch (its route forced onto Google's corridor).

| # | Kind | Engine roads | Engine m | Engine s | Signals | Google roads | Google m | Google s | Diff (s) | Engine s on Google's road (signals) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | shared | Lorong 2 Toa Payoh, motorway_link | 315 | 67 | 1 | Head west toward Toa Payoh Central; Turn left onto Toa Payoh Central; Turn left onto Lor 2 Toa Payoh; Take the PIE ramp; Take the Pan Island Expressway ramp | 660 | 250 | -183 | 73 (1) |
| 2 | **divergent** | motorway_link, Jalan Toa Payoh, Pan-Island Expressway, Kallang Way Flyover, Sims Way, Kallang Paya Lebar Expressway, Lorong 4 Geylang, primary_link, Nicoll Underpass, Nicoll Highway, Esplanade Drive, Fullerton Road, Collyer Quay, Raffles Quay, Cross Street, Cecil Street | 9957 | 1178 | 9 | Take the Pan Island Expressway ramp; Keep left, follow signs for Jln Datoh/Balestier Rd; Continue onto Jalan Datoh; Turn left onto Balestier Rd; Slight left to stay on Balestier Rd; Turn right onto the Rangoon Rd/CTE ramp to City; Take the CTE ramp to City; Merge onto Central Expw.; Keep right to stay on Central Expw.; Take exit 2 toward Havelock Rd; Merge onto Upper Cross St; Merge onto Havelock Rd; Continue onto Upper Pickering St; Continue onto Church St | 8500 | 1229 | -51 | 1270 (11) |
| 3 | shared | Cecil Street, Collyer Quay, D'Almeida Street, Malacca Street | 257 | 65 | 1 | Continue onto Church St; Church St turns left and becomes Collyer Quay; Turn left onto D'almeida St | 209 | 87 | -22 | 56 (1) |

---

