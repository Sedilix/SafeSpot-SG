/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * incidents.ts: Live traffic incidents and road closure layer for SafeSpot.
 *
 * Ingests LTA DataMall TrafficIncidents and maps them onto the road graph:
 *  - 'Road Block' / 'Road Closure' => edge becomes impassable (skipped during routing).
 *  - 'Accident' / 'Vehicle breakdown' => adds a decaying time penalty over 60 minutes.
 *  - Bus lanes => marks kerbside pickup stopping illegal during active hours.
 */

import { haversineMeters } from './graph';

export interface TrafficIncident {
  type: string;      // 'Accident', 'Road Block', 'Road Closure', 'Vehicle breakdown', etc.
  lat: number;
  lng: number;
  message: string;
  timestamp?: number; // Epoch ms when incident was reported (defaults to now)
}

export interface IncidentImpact {
  impassable: boolean;
  delaySec: number;
  reason?: string;
}

export class IncidentLayer {
  private incidents: TrafficIncident[] = [];
  private static readonly IMPACT_RADIUS_METERS = 40; // Incident spatial radius

  constructor(initialIncidents: TrafficIncident[] = []) {
    this.incidents = initialIncidents;
  }

  public setIncidents(incidents: TrafficIncident[]): void {
    this.incidents = incidents;
  }

  public addIncident(incident: TrafficIncident): void {
    this.incidents.push(incident);
  }

  /**
   * Evaluates the impact of live incidents on a specific road edge at arrival time.
   */
  public evaluateEdgeImpact(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    arrivalTime: Date
  ): IncidentImpact {
    const midLat = (startLat + endLat) / 2;
    const midLng = (startLng + endLng) / 2;
    const nowMs = arrivalTime.getTime();

    let isImpassable = false;
    let totalDelaySec = 0;
    let primaryReason = '';

    for (const inc of this.incidents) {
      const dist = haversineMeters(midLat, midLng, inc.lat, inc.lng);
      if (dist <= IncidentLayer.IMPACT_RADIUS_METERS) {
        const typeLower = inc.type.toLowerCase();
        const msgLower = inc.message.toLowerCase();

        // 1. Road Block / Road Closure: edge is impassable
        if (
          typeLower.includes('road block') ||
          typeLower.includes('closure') ||
          msgLower.includes('road closed') ||
          msgLower.includes('closed to traffic')
        ) {
          isImpassable = true;
          primaryReason = `Closure: ${inc.message}`;
          break; // Hard block takes immediate precedence
        }

        // 2. Accident / Breakdown: time penalty decaying over 60 min
        const incAgeMs = inc.timestamp ? Math.max(0, nowMs - inc.timestamp) : 0;
        const decay = Math.max(0.1, 1 - incAgeMs / (60 * 60 * 1000));

        let baseDelay = 0;
        if (typeLower.includes('accident')) baseDelay = 180; // 3 min
        else if (typeLower.includes('breakdown')) baseDelay = 90; // 1.5 min
        else if (typeLower.includes('obstacle')) baseDelay = 60; // 1 min
        else baseDelay = 30;

        totalDelaySec += baseDelay * decay;
        if (!primaryReason) primaryReason = `${inc.type}: ${inc.message}`;
      }
    }

    return {
      impassable: isImpassable,
      delaySec: Math.round(totalDelaySec),
      reason: primaryReason || undefined,
    };
  }

  /**
   * Checks whether kerbside stopping is prohibited by active bus lane regulations.
   * Singapore LTA Bus Lane Operating Hours:
   *  - Normal: Mon-Fri 07:30-09:30 and 17:00-20:00 (excluding Public Holidays)
   *  - Full-Day: Mon-Sat 07:30-23:00 (excluding Public Holidays)
   */
  public static isKerbsideStoppingProhibited(
    busLaneTag: string | undefined,
    checkTime: Date
  ): boolean {
    if (!busLaneTag) return false;

    // SGT is UTC+8
    const sgtDate = new Date(checkTime.getTime() + 8 * 3600 * 1000);
    const day = sgtDate.getUTCDay(); // 0=Sun, 1=Mon .. 6=Sat
    if (day === 0) return false; // Sunday: bus lanes inactive

    const hours = sgtDate.getUTCHours().toString().padStart(2, '0');
    const mins = sgtDate.getUTCMinutes().toString().padStart(2, '0');
    const hhmm = `${hours}:${mins}`;

    const tagLower = busLaneTag.toLowerCase();
    const isFullDay = tagLower.includes('full') || tagLower.includes('23:00');

    if (isFullDay) {
      // Mon-Sat 07:30-23:00
      return hhmm >= '07:30' && hhmm < '23:00';
    } else {
      // Normal: Mon-Fri 07:30-09:30 & 17:00-20:00
      if (day >= 1 && day <= 5) {
        return (hhmm >= '07:30' && hhmm < '09:30') || (hhmm >= '17:00' && hhmm < '20:00');
      }
      return false;
    }
  }
}
