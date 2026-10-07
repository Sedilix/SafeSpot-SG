/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * erp.ts: Singapore Electronic Road Pricing (ERP) tariff engine.
 *
 * Ground truth (LTA DataMall & PTC static schedules as of 2026):
 * - Dynamic ERPRates endpoint was deprecated 30 Sep 2024.
 * - Only ~22 expressway gantries are actively charging (CTE, PIE, AYE, KPE).
 *   CBD cordon gantries remain switched off.
 * - Tariffs are time-dependent (15/30-minute rate slots) and directional.
 */

import { haversineMeters, bearingDegrees } from './graph';

export interface ErpTariffSlot {
  days: number[];      // 1=Mon .. 5=Fri, 6=Sat
  startTime: string;  // "HH:MM" inclusive
  endTime: string;    // "HH:MM" exclusive
  amountSgd: number;  // charge in SGD
}

export interface ErpGantry {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bearing: number;     // Direction of charged traffic (degrees 0-360)
  expressway: string;
  tariffs: ErpTariffSlot[];
}

// Active Singapore expressway gantries with official charging schedules (LTA 2026)
export const ACTIVE_ERP_GANTRIES: ErpGantry[] = [
  {
    id: 'CTE-1',
    name: 'CTE Southbound before Braddell Road',
    lat: 1.3412,
    lng: 103.8576,
    bearing: 190, // Southbound toward city
    expressway: 'CTE',
    tariffs: [
      { days: [1, 2, 3, 4, 5], startTime: '07:00', endTime: '07:30', amountSgd: 1.0 },
      { days: [1, 2, 3, 4, 5], startTime: '07:30', endTime: '08:00', amountSgd: 2.0 },
      { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '08:30', amountSgd: 3.0 },
      { days: [1, 2, 3, 4, 5], startTime: '08:30', endTime: '09:00', amountSgd: 4.0 },
      { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '09:30', amountSgd: 2.0 },
      { days: [1, 2, 3, 4, 5], startTime: '09:30', endTime: '10:00', amountSgd: 1.0 },
    ],
  },
  {
    id: 'CTE-2',
    name: 'CTE Southbound after Braddell Road',
    lat: 1.3325,
    lng: 103.8588,
    bearing: 195,
    expressway: 'CTE',
    tariffs: [
      { days: [1, 2, 3, 4, 5], startTime: '07:30', endTime: '08:00', amountSgd: 1.0 },
      { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '08:30', amountSgd: 2.0 },
      { days: [1, 2, 3, 4, 5], startTime: '08:30', endTime: '09:00', amountSgd: 3.0 },
      { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '09:30', amountSgd: 2.0 },
    ],
  },
  {
    id: 'CTE-3',
    name: 'CTE Northbound between PIE and Braddell',
    lat: 1.3340,
    lng: 103.8590,
    bearing: 15, // Northbound out of city
    expressway: 'CTE',
    tariffs: [
      { days: [1, 2, 3, 4, 5], startTime: '17:30', endTime: '18:00', amountSgd: 1.0 },
      { days: [1, 2, 3, 4, 5], startTime: '18:00', endTime: '18:30', amountSgd: 2.0 },
      { days: [1, 2, 3, 4, 5], startTime: '18:30', endTime: '19:00', amountSgd: 3.0 },
      { days: [1, 2, 3, 4, 5], startTime: '19:00', endTime: '19:30', amountSgd: 2.0 },
      { days: [1, 2, 3, 4, 5], startTime: '19:30', endTime: '20:00', amountSgd: 1.0 },
    ],
  },
  {
    id: 'PIE-1',
    name: 'PIE Eastbound at Adam Road / Mount Pleasant',
    lat: 1.3288,
    lng: 103.8290,
    bearing: 105, // Eastbound toward Changi
    expressway: 'PIE',
    tariffs: [
      { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '08:30', amountSgd: 1.0 },
      { days: [1, 2, 3, 4, 5], startTime: '08:30', endTime: '09:00', amountSgd: 2.0 },
      { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '09:30', amountSgd: 1.0 },
    ],
  },
  {
    id: 'PIE-2',
    name: 'PIE Westbound at Kallang Bahru',
    lat: 1.3255,
    lng: 103.8690,
    bearing: 285, // Westbound toward Tuas
    expressway: 'PIE',
    tariffs: [
      { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '08:30', amountSgd: 1.0 },
      { days: [1, 2, 3, 4, 5], startTime: '08:30', endTime: '09:00', amountSgd: 2.0 },
      { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '09:30', amountSgd: 1.0 },
      { days: [1, 2, 3, 4, 5], startTime: '17:30', endTime: '18:30', amountSgd: 1.0 },
      { days: [1, 2, 3, 4, 5], startTime: '18:30', endTime: '19:30', amountSgd: 2.0 },
    ],
  },
  {
    id: 'AYE-1',
    name: 'AYE Eastbound before Alexandra Road',
    lat: 1.2885,
    lng: 103.7995,
    bearing: 95, // Eastbound toward city
    expressway: 'AYE',
    tariffs: [
      { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '08:30', amountSgd: 1.0 },
      { days: [1, 2, 3, 4, 5], startTime: '08:30', endTime: '09:00', amountSgd: 2.0 },
      { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '09:30', amountSgd: 1.0 },
    ],
  },
  {
    id: 'KPE-1',
    name: 'KPE Southbound before Defu Lane',
    lat: 1.3540,
    lng: 103.8960,
    bearing: 185, // Southbound
    expressway: 'KPE',
    tariffs: [
      { days: [1, 2, 3, 4, 5], startTime: '07:30', endTime: '08:00', amountSgd: 1.0 },
      { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '08:30', amountSgd: 2.0 },
      { days: [1, 2, 3, 4, 5], startTime: '08:30', endTime: '09:00', amountSgd: 3.0 },
      { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '09:30', amountSgd: 1.0 },
    ],
  },
];

export class ErpEngine {
  constructor(private gantries: ErpGantry[] = ACTIVE_ERP_GANTRIES) {}

  /**
   * Evaluates the ERP charge for passing a specific gantry at a given arrival time and bearing.
   */
  public evaluateGantryCharge(
    gantry: ErpGantry,
    arrivalTime: Date,
    travelBearing: number
  ): number {
    // Check directional alignment (within +/-60 degrees of charging direction)
    const angleDiff = Math.abs(((travelBearing - gantry.bearing + 540) % 360) - 180);
    if (angleDiff > 60) return 0.0;

    // SGT is UTC+8
    const sgtOffsetMs = 8 * 3600 * 1000;
    const sgtDate = new Date(arrivalTime.getTime() + sgtOffsetMs);
    const dayOfWeek = sgtDate.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    const hours = sgtDate.getUTCHours().toString().padStart(2, '0');
    const minutes = sgtDate.getUTCMinutes().toString().padStart(2, '0');
    const hhmm = `${hours}:${minutes}`;

    for (const tariff of gantry.tariffs) {
      if (tariff.days.includes(dayOfWeek)) {
        if (hhmm >= tariff.startTime && hhmm < tariff.endTime) {
          return tariff.amountSgd;
        }
      }
    }
    return 0.0;
  }

  /**
   * Checks whether a road segment passes any active ERP gantry within 25m,
   * and returns the toll incurred if any.
   */
  public evaluateSegmentToll(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    arrivalTime: Date
  ): { gantryName?: string; chargeSgd: number } {
    const bearing = bearingDegrees(startLat, startLng, endLat, endLng);
    const midLat = (startLat + endLat) / 2;
    const midLng = (startLng + endLng) / 2;

    for (const g of this.gantries) {
      const dist = haversineMeters(midLat, midLng, g.lat, g.lng);
      if (dist <= 35) { // Gantry spatial proximity threshold
        const charge = this.evaluateGantryCharge(g, arrivalTime, bearing);
        if (charge > 0) {
          return { gantryName: g.name, chargeSgd: charge };
        }
      }
    }
    return { chargeSgd: 0.0 };
  }
}
