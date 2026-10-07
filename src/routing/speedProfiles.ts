/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * speedProfiles.ts: Time-dependent speed profiles and dynamic congestion models.
 *
 * Ingests historical LTA SpeedBand observations and temporal Singapore traffic curves:
 *  - 15-minute slot resolution across day-types (Weekday, Saturday, Sunday/PH).
 *  - Time-of-day traffic degradation across expressway and arterial corridors.
 *  - Regulatory overlays: Enhanced School Zones (40 km/h all-day) & Silver Zones (30-40 km/h).
 *  - Calculates edge travel seconds at vehicle arrival time.
 */

import { CompactEdge } from './graph';

export type DayType = 'WEEKDAY' | 'SATURDAY' | 'SUNDAY_PH';

export interface SpeedProfile {
  linkId?: string;
  // Median speeds (km/h) for 96 15-minute slots (0 = 00:00, 95 = 23:45)
  slots: Float32Array;
}

export class SpeedProfileEngine {
  private linkProfiles = new Map<string, SpeedProfile>();

  /**
   * Resolves the DayType for an SGT timestamp.
   */
  public static getDayType(date: Date): DayType {
    const sgtDate = new Date(date.getTime() + 8 * 3600 * 1000);
    const day = sgtDate.getUTCDay();
    if (day === 0) return 'SUNDAY_PH';
    if (day === 6) return 'SATURDAY';
    return 'WEEKDAY';
  }

  /**
   * Resolves the 15-minute slot index [0..95] for an SGT timestamp.
   */
  public static getSlotIndex(date: Date): number {
    const sgtDate = new Date(date.getTime() + 8 * 3600 * 1000);
    const hours = sgtDate.getUTCHours();
    const minutes = sgtDate.getUTCMinutes();
    return Math.floor((hours * 60 + minutes) / 15);
  }

  /**
   * Registers a specific historical link profile.
   */
  public registerLinkProfile(linkId: string, profile: SpeedProfile): void {
    this.linkProfiles.set(linkId, profile);
  }

  /**
   * Evaluates the Singapore temporal traffic factor [0.0 - 1.0] for a highway class
   * based on observed congestion patterns at arrival time.
   */
  public static getTemporalSpeedFactor(
    highway: string,
    dayType: DayType,
    slotIndex: number,
    bearing?: number
  ): number {
    if (dayType === 'SUNDAY_PH') return 1.0; // Weekend/PH free-flow

    // Slot 28 = 07:00, Slot 38 = 09:30 (Morning Peak)
    // Slot 70 = 17:30, Slot 80 = 20:00 (Evening Peak)
    const isMorningPeak = slotIndex >= 28 && slotIndex <= 38;
    const isEveningPeak = slotIndex >= 70 && slotIndex <= 80;

    const isExpressway = highway === 'motorway' || highway === 'motorway_link';
    const isArterial = highway === 'trunk' || highway === 'primary' || highway === 'primary_link';

    if (isMorningPeak) {
      // Inbound toward CBD / city center experiences higher morning congestion
      const isInbound = bearing !== undefined && bearing >= 120 && bearing <= 240;
      if (isExpressway) {
        return isInbound ? 0.62 : 0.88; // e.g. CTE inbound ~42 km/h vs outbound ~60 km/h
      }
      if (isArterial) {
        return isInbound ? 0.68 : 0.85;
      }
      return 0.85;
    }

    if (isEveningPeak) {
      // Outbound away from CBD experiences higher evening congestion
      const isOutbound = bearing !== undefined && (bearing <= 60 || bearing >= 300);
      if (isExpressway) {
        return isOutbound ? 0.65 : 0.85;
      }
      if (isArterial) {
        return isOutbound ? 0.70 : 0.85;
      }
      return 0.88;
    }

    // Midday slight moderation (11:30 - 14:00, lunch peak slots 46-56)
    if (slotIndex >= 46 && slotIndex <= 56) {
      if (isArterial) return 0.90;
    }

    return 1.0; // Off-peak free-flow
  }

  /**
   * Computes the effective operational speed (km/h) for an edge at arrival time.
   */
  public getEffectiveSpeed(edge: CompactEdge, arrivalTime: Date, travelBearing?: number): number {
    const dayType = SpeedProfileEngine.getDayType(arrivalTime);
    const slot = SpeedProfileEngine.getSlotIndex(arrivalTime);

    // 1. Check if an explicit LTA link profile exists for this edge
    const explicitProfile = this.linkProfiles.get(String(edge.id));
    if (explicitProfile && explicitProfile.slots[slot] > 0) {
      return explicitProfile.slots[slot];
    }

    // 2. Regulatory overlays
    const nameLower = (edge.name || '').toLowerCase();
    const isSchoolZone = nameLower.includes('school') || nameLower.includes('primary');
    const isSilverZone = nameLower.includes('silver zone');

    if (isSchoolZone) {
      // Enhanced School Zone: 40 km/h all day, every day
      return Math.min(40, edge.maxspeed);
    }
    if (isSilverZone) {
      // Silver Zone: 40 km/h (or 30 km/h on residential)
      return Math.min(edge.highway === 'residential' ? 30 : 40, edge.maxspeed);
    }

    // 3. Base free-flow operational speed from calibrated Phase 1 graph
    const baseSpeed = (edge.length / edge.seconds) * 3.6;

    // 4. Apply time-dependent congestion curve
    const factor = SpeedProfileEngine.getTemporalSpeedFactor(edge.highway, dayType, slot, travelBearing);
    return Math.max(10, baseSpeed * factor);
  }

  /**
   * Calculates the edge travel duration in seconds at arrival time.
   */
  public calculateEdgeSeconds(edge: CompactEdge, arrivalTime: Date, travelBearing?: number): number {
    const speedKmh = this.getEffectiveSpeed(edge, arrivalTime, travelBearing);
    return Number((edge.length / (speedKmh / 3.6)).toFixed(3));
  }
}
