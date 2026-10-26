# Corridor audit: engine vs Google Routes

- Departure: 2026-10-26T06:03:40.532Z (engine and Google)
- Graph: 169316 nodes, 4933 traffic-signal nodes
- An engine edge more than 35 m from Google's polyline is **divergent**; each run is compared with Google's route between the points where the engine leaves and rejoins it.
- Google per-stretch seconds are step static durations scaled to the traffic-aware route total.

## Novena Square -> Marina Bay Sands (`novena-to-mbs`)

| | Distance | Time | Signals |
|---|---|---|---|
| Google | 8746 m | 1061 s | |
| Engine | 6580 m | 1063 s | 16 |
| Engine − Google | -2166 m | +2 s (+0.2%) | |
| Engine timing of Google's road | 8738 m | 1140 s | 14 |

Shared corridor: 6% of the engine's distance; 2 divergent run(s).

"Engine s on Google's road" is the engine's own time for Google's stretch (its route forced onto Google's corridor).

| # | Kind | Engine roads | Engine m | Engine s | Signals | Google roads | Google m | Google s | Diff (s) | Engine s on Google's road (signals) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | shared | Sinaran Drive | 113 | 22 | 0 | Head northeast; Keep right to continue toward Sinaran Dr | 87 | 33 | -11 | 15 (0) |
| 2 | **divergent** | Sinaran Drive, tertiary_link, Irrawaddy Road, Thomson Road | 1018 | 201 | 3 | Keep right to continue toward Sinaran Dr; Turn right onto Sinaran Dr; Turn left after Novelis @ Novena (on the left); Continue onto Balestier Rd; Turn right onto the Rangoon Rd/CTE ramp to City; Take the CTE ramp to City; Merge onto Central Expw. | 2419 | 371 | -170 | 373 (3) |
| 3 | shared | Thomson Road | 84 | 12 | 0 | Merge onto Central Expw. | 44 | 3 | +10 | 3 (0) |
| 4 | **divergent** | Keng Lee Road, trunk_link, Bukit Timah Road, Sungei Road, Ophir Road, Republic Boulevard, Raffles Avenue, Bayfront Avenue, Sheares Link | 5146 | 789 | 13 | Merge onto Central Expw.; Keep right to stay on Central Expw.; Take exit 2 toward Havelock Rd; Merge onto Upper Cross St; Merge onto Havelock Rd; Continue onto Upper Pickering St; Continue onto Church St; Church St turns left and becomes Collyer Quay; Turn right onto Finlayson Green; Continue onto Marina Blvd; Turn left onto Sheares Ave | 5991 | 598 | +190 | 721 (11) |
| 5 | shared | Sheares Link, Sheares Avenue | 218 | 39 | 0 | Turn left onto Sheares Ave; Turn left; Turn right | 203 | 56 | -17 | 28 (0) |

---

## Blk 480 Toa Payoh -> Raffles Place (CBD) (`toa-payoh-to-raffles-place`)

| | Distance | Time | Signals |
|---|---|---|---|
| Google | 12701 m | 1176 s | |
| Engine | 12368 m | 1075 s | 9 |
| Engine − Google | -333 m | -101 s (-8.6%) | |
| Engine timing of Google's road | 12368 m | 1075 s | 9 |

Shared corridor: 98% of the engine's distance; 1 divergent run(s).

"Engine s on Google's road" is the engine's own time for Google's stretch (its route forced onto Google's corridor).

| # | Kind | Engine roads | Engine m | Engine s | Signals | Google roads | Google m | Google s | Diff (s) | Engine s on Google's road (signals) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | shared | Lorong 2 Toa Payoh, motorway_link, Jalan Toa Payoh, Pan-Island Expressway, Central Expressway | 9773 | 731 | 4 | Head west toward Toa Payoh Central; Turn left onto Toa Payoh Central; Turn left onto Lor 2 Toa Payoh; Take the PIE ramp; Slight left onto the Pan Island Expressway ramp; Merge onto PIE; Take exit 15 toward SLE/TPE; Take the Braddell Rd ramp; Take the ramp to Braddell Rd/Upp Serangoon Rd; Turn right onto the ramp to Central Expw.; Take the CTE ramp to City; Merge onto Central Expw.; Keep right to stay on Central Expw. | 10134 | 835 | -104 | 731 (4) |
| 2 | **divergent** | Central Expressway | 198 | 11 | 0 | Keep right to stay on Central Expw. | 191 | 11 | +1 | 11 (0) |
| 3 | shared | Central Expressway, motorway_link, Havelock Road, Upper Pickering Street, Pickering Street, Church Street, Cecil Street, Collyer Quay, D'Almeida Street, Malacca Street | 2397 | 333 | 5 | Keep right to stay on Central Expw.; Take exit 2 toward Havelock Rd; Merge onto Upper Cross St; Merge onto Havelock Rd; Continue onto Upper Pickering St; Continue onto Church St; Church St turns left and becomes Collyer Quay; Turn left onto D'almeida St | 2372 | 330 | +2 | 333 (5) |

---

