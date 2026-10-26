# Clean-Room Speed Profile Evaluation Report (LTA Held-Out Dataset)

**Dataset**: LTA DataMall Traffic Speed Bands held-out days: **2026-10-23 (Friday)** and **2026-10-24 (Saturday)**  
**Sample Size**: 1128 15-minute slot corridors evaluated (7.3M raw speed observations)  
**Methodology**: Clean-room calibration against open government telemetry per `docs/clean-room-calibration.md`. Zero Google Maps data used.  
**Generated At**: 2026-10-26T07:37:18.789Z  

---

## 1. Executive Summary & Acceptance Gates

| Acceptance Gate | Target | Measured Value | Status |
| :--- | :---: | :---: | :---: |
| **Overall Mean Absolute Error (MAE)** | $\le 10.0\%$ | **1.23%** | **PASS** |
| **Mean Signed Error (Bias)** | $\pm 5.0\%$ | **+0.41%** | **PASS** |
| **p95 Absolute Error** | $\le 20.0\%$ | **5.08%** | **PASS** |

---

## 2. Road Class Breakdown

| Road Class | Slots (N) | Reference Free-Flow Speed | Mean Predicted Speed | Mean Observed Speed | MAE | Bias | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Expressway** | 564 | 68.0 km/h | 65.4 km/h | 65.3 km/h | **1.64%** | **+0.29%** | **PASS** |
| **Arterial** | 564 | 41.7 km/h | 38.1 km/h | 37.9 km/h | **0.82%** | **+0.54%** | **PASS** |

---

## 3. Day Type Breakdown

| Day Type | Slots (N) | MAE | Bias | p95 Error | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Weekday (Fri 23 Oct)** | 552 | **0.98%** | **+0.12%** | 3.57% | **PASS** |
| **Saturday (Sat 24 Oct)** | 576 | **1.47%** | **+0.69%** | 6.21% | **PASS** |

---

## 4. Time-of-Day Breakdown

| Time Window | Slots (N) | Target MAE | Measured MAE | Bias | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Morning Peak** | 132 | $\le 15.0\%$ | **1.52%** | **-0.76%** | **PASS** |
| **Midday** | 126 | $\le 10.0\%$ | **1.05%** | **+0.61%** | **PASS** |
| **Evening Peak** | 156 | $\le 15.0\%$ | **2.11%** | **-0.35%** | **PASS** |
| **Night / Off-Peak** | 714 | $\le 15.0\%$ | **1.02%** | **+0.76%** | **PASS** |

---

## 5. Directional Corridor Accuracy (Weekday vs Saturday)

| Day Type | Road Class | Direction | MAE | Bias |
| :--- | :--- | :--- | :---: | :---: |
| WEEKDAY | EXPRESSWAY | INBOUND | **1.83%** | **+0.13%** |
| WEEKDAY | EXPRESSWAY | OUTBOUND | **1.14%** | **-0.15%** |
| WEEKDAY | EXPRESSWAY | CROSS | **1.29%** | **-0.03%** |
| WEEKDAY | ARTERIAL | INBOUND | **0.69%** | **+0.30%** |
| WEEKDAY | ARTERIAL | OUTBOUND | **0.47%** | **+0.30%** |
| WEEKDAY | ARTERIAL | CROSS | **0.46%** | **+0.17%** |
| SATURDAY | EXPRESSWAY | INBOUND | **1.87%** | **+0.56%** |
| SATURDAY | EXPRESSWAY | OUTBOUND | **1.83%** | **+0.62%** |
| SATURDAY | EXPRESSWAY | CROSS | **1.83%** | **+0.57%** |
| SATURDAY | ARTERIAL | INBOUND | **1.16%** | **+0.86%** |
| SATURDAY | ARTERIAL | OUTBOUND | **1.13%** | **+0.83%** |
| SATURDAY | ARTERIAL | CROSS | **1.01%** | **+0.72%** |
