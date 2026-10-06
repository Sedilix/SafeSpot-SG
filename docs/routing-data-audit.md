# SafeSpot SG Routing Data Audit

Audit completed on **2026-10-07** per `ROUTING_PLAN.md` §3 and §5 Phase 0.
This document assesses all data sources required by SafeSpot's routing engine, verifying which official datasets exist, which are deprecated, and what fallbacks must be employed.

---

## Summary Matrix

| Data Item | Status | Official Source | Ingestion Strategy & Fallback |
| :--- | :---: | :--- | :--- |
| **ERP Tariff Rates** | **SOURCED (Static)** | [LTA DataMall Static Datasets](https://datamall.lta.gov.sg) ("ERP Rates" under Traffic & Trips) | Dynamic `ERPRates` API was removed on 30 Sep 2024. Ingest LTA's quarterly static tariff table into an in-memory matrix `[GantryID, DayOfWeek, TimeSlot, VehicleClass]`. |
| **Active ERP Gantries** | **SOURCED (OSM + LTA)** | OpenStreetMap (`highway=toll_gantry`, 105 tagged) + LTA press releases | OSM includes switched-off cordons and bi-directional gantries (~22 active on expressways, CBD cordon inactive). Filter against LTA's active charging schedule. |
| **Enhanced School Zones** | **NOT AVAILABLE (Direct)** | LTA / MOE Primary Schools Proxy | No standalone ESZ list on data.gov.sg. LTA applies 40 km/h all-day (as of 1 Jan 2026) to primary/SPED schools. **Proxy**: Buffer MOE Primary School coordinates from data.gov.sg by 150m onto adjacent OSM roads. |
| **Silver Zones** | **SOURCED (GeoJSON)** | [data.gov.sg](https://data.gov.sg) ("LTA Silver Zone") & LTA DataMall | Download official GeoJSON spatial boundaries. Tag matching OSM roads with 30–40 km/h limits and senior safety profile. |
| **Public Transport Fares** | **SOURCED (Static Table)** | [Public Transport Council](https://ptc.gov.sg) & SimplyGo Distance Fare Tables | No machine-readable REST API. Maintain static distance fare table: Adult card vs Senior concession card (`[kmBand, cardType, cents]`). |
| **PUB Flood & Water Level** | **SOURCED (data.gov.sg API)** | [data.gov.sg](https://data.gov.sg) ("PUB Water Level Sensors" / "Flood Alerts") | API available on data.gov.sg. 1,000+ sensors across Singapore. Real-time alerting for road ponding and flash floods. |
| **Covered Walkways** | **SOURCED (OSM + SLA OneMap)** | OpenStreetMap (`highway=footway` + `covered=yes`) & SLA OneMap Routing API | OSM has dense community and GovTech (Undercover) coverage of sheltered linkways under the Walk2Ride scheme. Use OSM `covered=yes` for local graph; fallback to OneMap sheltered route API. |
| **Traffic Speed Bands** | **SOURCED (Live API)** | LTA DataMall `v4/TrafficSpeedBands` | Live REST API, paginated with `$skip` in steps of 500 (approx. 143,800 link records per 5-min snapshot). Captured by `tools/speedbands/logger.ts`. |
| **Traffic Incidents** | **SOURCED (Live API)** | LTA DataMall `TrafficIncidents` | Live REST API returning accidents, road closures, breakdowns, and obstacles with latitude/longitude coordinates. |
| **Road Works** | **SOURCED (Live API)** | LTA DataMall `RoadWorks` | Live REST API returning planned roadworks and lane restrictions. |
| **Weather & Rainfall** | **SOURCED (Live API)** | NEA via data.gov.sg (`api-open.data.gov.sg/v2/real-time/api/rainfall`) | Real-time 5-minute rainfall readings from 89 telemetry stations across Singapore. Free, no API key required. |

---

## Detailed Findings & Specifications

### 1. Electronic Road Pricing (ERP)
* **Status**: Static Tariff Download only.
* **Finding**: The dynamic `ERPRates` endpoint on LTA DataMall was removed on 30 September 2024 and returns 0 rows. LTA publishes downloadable consolidated PDF/tables on DataMall.
* **Active Infrastructure**: As of 2026, only ~22 gantries are actively charging, all located on expressways (CTE, PIE, AYE, KPE). The CBD cordon gantries remain switched off. Google Routes does not return ERP tolls for Singapore.
* **Implementation Plan**: Ingest LTA's official static tariff schedule. Apply charges based on arrival timestamp at the gantry edge, matched by vehicle type and direction.

### 2. Enhanced School Zones (40 km/h All-Day)
* **Status**: Direct dataset not published.
* **Finding**: As of 1 January 2026, the 40 km/h speed limit applies throughout the day (24/7, including weekends and public holidays) in Enhanced School Zones. However, neither LTA nor data.gov.sg provides a standalone CSV/GeoJSON layer specifically titled "Enhanced School Zones".
* **Engineering Solution**: Ingest the official MOE `School Directory and Information` dataset from data.gov.sg, filter for primary schools and SPED schools, and compute a 150-meter spatial intersection with adjacent local/collector road segments in OpenStreetMap.

### 3. Silver Zones
* **Status**: Fully sourced and verified.
* **Finding**: LTA publishes the complete geospatial dataset on data.gov.sg as `LTA Silver Zone` (GeoJSON).
* **Implementation Plan**: Ingest the GeoJSON polygons. Any road segment falling within the zone boundary is flagged with `regulatoryZone: 'SILVER_ZONE'`, enforcing 30–40 km/h limits and pedestrian-friendly acceleration limits.

### 4. Public Transport Fares (PTC)
* **Status**: Static Distance-Based Structure.
* **Finding**: Public transport fares in Singapore are regulated by the Public Transport Council (PTC) based purely on cumulative journey distance (allowing up to 5 transfers). There is no official real-time fare calculation API.
* **Implementation Plan**: Ingest the official distance band table:
  - Band 1: Up to 3.2 km
  - Band 2: 3.3 km to 4.2 km ... up to > 40.2 km
  - Separate pricing tracks for Adult card vs Senior Concession card.

### 5. PUB Water-Level & Flash Flood Sensors
* **Status**: Sourced on data.gov.sg.
* **Finding**: PUB provides "Flood Alerts across Singapore" and "PUB Water Level Sensors" datasets on data.gov.sg.
* **Implementation Plan**: Use data.gov.sg API with API key. When a sensor reports water level $\ge 15\text{ cm}$, the intersecting road segment is treated as impassable.

### 6. Covered Walkways (Senior Weather Routing)
* **Status**: Sourced via OSM and OneMap.
* **Finding**: LTA's Walk2Ride programme has constructed $>200\text{ km}$ of covered walkways connecting public housing (HDB) estates to MRT stations. These are mapped extensively in OpenStreetMap as `highway=footway` with `covered=yes` or `indoor=yes`.
* **Implementation Plan**: In the pedestrian graph (Phase 3), extract all footways with `covered=yes`. When NEA rainfall $> 1.0\text{ mm/h}$, unsheltered footpaths receive an impedance penalty ($3.0\times$), routing elderly users through dry corridors.
