/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * speedProfiles.ts: Time-dependent speed profiles and dynamic congestion models.
 *
 * Ingests historical LTA SpeedBand observations and temporal Singapore traffic curves:
 *  - 15-minute slot resolution across day-types (Weekday, Saturday, Sunday/PH).
 *  - Time-of-day traffic degradation across expressway, arterial, and sub-arterial corridors.
 *  - Regulatory overlays: Enhanced School Zones (40 km/h all-day) & Silver Zones (30-40 km/h).
 *  - Calculates edge travel seconds at vehicle arrival time.
 */

import { CompactEdge } from './graph';
import {
  EXP_INBOUND_FACTORS,
  EXP_OUTBOUND_FACTORS,
  EXP_CROSS_FACTORS,
  ART_INBOUND_FACTORS,
  ART_OUTBOUND_FACTORS,
  ART_CROSS_FACTORS,
  SAT_EXP_INBOUND_FACTORS,
  SAT_EXP_OUTBOUND_FACTORS,
  SAT_EXP_CROSS_FACTORS,
  SAT_ART_INBOUND_FACTORS,
  SAT_ART_OUTBOUND_FACTORS,
  SAT_ART_CROSS_FACTORS,
  SUN_EXP_INBOUND_FACTORS,
  SUN_EXP_OUTBOUND_FACTORS,
  SUN_EXP_CROSS_FACTORS,
  SUN_ART_INBOUND_FACTORS,
  SUN_ART_OUTBOUND_FACTORS,
  SUN_ART_CROSS_FACTORS,
  SUB_ART_FACTORS,
  SAT_SUB_ART_FACTORS,
  SUN_SUB_ART_FACTORS,
} from './speedProfileTables';

export {
  EXP_INBOUND_FACTORS,
  EXP_OUTBOUND_FACTORS,
  EXP_CROSS_FACTORS,
  ART_INBOUND_FACTORS,
  ART_OUTBOUND_FACTORS,
  ART_CROSS_FACTORS,
  SAT_EXP_INBOUND_FACTORS,
  SAT_EXP_OUTBOUND_FACTORS,
  SAT_EXP_CROSS_FACTORS,
  SAT_ART_INBOUND_FACTORS,
  SAT_ART_OUTBOUND_FACTORS,
  SAT_ART_CROSS_FACTORS,
  SUN_EXP_INBOUND_FACTORS,
  SUN_EXP_OUTBOUND_FACTORS,
  SUN_EXP_CROSS_FACTORS,
  SUN_ART_INBOUND_FACTORS,
  SUN_ART_OUTBOUND_FACTORS,
  SUN_ART_CROSS_FACTORS,
  SUB_ART_FACTORS,
  SAT_SUB_ART_FACTORS,
  SUN_SUB_ART_FACTORS,
};

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
   * Evaluates the Singapore temporal traffic factor for a highway class
   * based on observed congestion patterns at arrival time.
   */
  public static getTemporalSpeedFactor(
    highway: string,
    dayType: DayType,
    slotIndex: number,
    bearing?: number
  ): number {
    const isExpressway = highway === 'motorway' || highway === 'motorway_link';
    const isArterial = highway === 'trunk' || highway === 'primary' || highway === 'primary_link';
    const isInbound = bearing !== undefined && bearing >= 120 && bearing <= 240;
    const isOutbound = bearing !== undefined && (bearing <= 60 || bearing >= 300);

    if (dayType === 'WEEKDAY') {
      if (isExpressway) {
        return isInbound
          ? EXP_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? EXP_OUTBOUND_FACTORS[slotIndex]
            : EXP_CROSS_FACTORS[slotIndex];
      }
      if (isArterial) {
        return isInbound
          ? ART_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? ART_OUTBOUND_FACTORS[slotIndex]
            : ART_CROSS_FACTORS[slotIndex];
      }
      return SUB_ART_FACTORS[slotIndex];
    }

    if (dayType === 'SATURDAY') {
      if (isExpressway) {
        return isInbound
          ? SAT_EXP_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? SAT_EXP_OUTBOUND_FACTORS[slotIndex]
            : SAT_EXP_CROSS_FACTORS[slotIndex];
      }
      if (isArterial) {
        return isInbound
          ? SAT_ART_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? SAT_ART_OUTBOUND_FACTORS[slotIndex]
            : SAT_ART_CROSS_FACTORS[slotIndex];
      }
      return SAT_SUB_ART_FACTORS[slotIndex];
    }

    if (dayType === 'SUNDAY_PH') {
      if (isExpressway) {
        return isInbound
          ? SUN_EXP_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? SUN_EXP_OUTBOUND_FACTORS[slotIndex]
            : SUN_EXP_CROSS_FACTORS[slotIndex];
      }
      if (isArterial) {
        return isInbound
          ? SUN_ART_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? SUN_ART_OUTBOUND_FACTORS[slotIndex]
            : SUN_ART_CROSS_FACTORS[slotIndex];
      }
      return SUN_SUB_ART_FACTORS[slotIndex];
    }

    return 1.0;
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

  public get hasCustomProfiles(): boolean {
    return this.linkProfiles.size > 0;
  }

  /**
   * Fast path for edge travel duration using precomputed typed arrays and slot index.
   * Avoids all Date instantiations, string manipulations, and trigonometric calculations.
   */
  public calculateEdgeSecondsFast(
    edgeId: number,
    edgeLength: number,
    edgeMaxspeed: number,
    baseSpeed: number,
    bearing: number,
    highwayType: number,
    schoolSilver: number,
    dayType: DayType,
    slotIndex: number
  ): number {
    if (this.linkProfiles.size > 0) {
      const explicit = this.linkProfiles.get(String(edgeId));
      if (explicit && explicit.slots[slotIndex] > 0) {
        return edgeLength / (explicit.slots[slotIndex] / 3.6);
      }
    }

    if (schoolSilver === 1 || schoolSilver === 2) {
      const speedKmh = Math.min(40, edgeMaxspeed);
      return edgeLength / (speedKmh / 3.6);
    }
    if (schoolSilver === 3) {
      const speedKmh = Math.min(30, edgeMaxspeed);
      return edgeLength / (speedKmh / 3.6);
    }

    let factor = 1.0;
    const isInbound = bearing >= 120 && bearing <= 240;
    const isOutbound = bearing <= 60 || bearing >= 300;

    if (dayType === 'WEEKDAY') {
      if (highwayType === 1) {
        factor = isInbound
          ? EXP_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? EXP_OUTBOUND_FACTORS[slotIndex]
            : EXP_CROSS_FACTORS[slotIndex];
      } else if (highwayType === 2) {
        factor = isInbound
          ? ART_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? ART_OUTBOUND_FACTORS[slotIndex]
            : ART_CROSS_FACTORS[slotIndex];
      } else {
        factor = SUB_ART_FACTORS[slotIndex];
      }
    } else if (dayType === 'SATURDAY') {
      if (highwayType === 1) {
        factor = isInbound
          ? SAT_EXP_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? SAT_EXP_OUTBOUND_FACTORS[slotIndex]
            : SAT_EXP_CROSS_FACTORS[slotIndex];
      } else if (highwayType === 2) {
        factor = isInbound
          ? SAT_ART_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? SAT_ART_OUTBOUND_FACTORS[slotIndex]
            : SAT_ART_CROSS_FACTORS[slotIndex];
      } else {
        factor = SAT_SUB_ART_FACTORS[slotIndex];
      }
    } else if (dayType === 'SUNDAY_PH') {
      if (highwayType === 1) {
        factor = isInbound
          ? SUN_EXP_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? SUN_EXP_OUTBOUND_FACTORS[slotIndex]
            : SUN_EXP_CROSS_FACTORS[slotIndex];
      } else if (highwayType === 2) {
        factor = isInbound
          ? SUN_ART_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? SUN_ART_OUTBOUND_FACTORS[slotIndex]
            : SUN_ART_CROSS_FACTORS[slotIndex];
      } else {
        factor = SUN_SUB_ART_FACTORS[slotIndex];
      }
    }

    const speedKmh = Math.max(10, baseSpeed * factor);
    return edgeLength / (speedKmh / 3.6);
  }

  /**
   * Calculates the edge travel duration in seconds at arrival time.
   */
  public calculateEdgeSeconds(edge: CompactEdge, arrivalTime: Date, travelBearing?: number): number {
    const speedKmh = this.getEffectiveSpeed(edge, arrivalTime, travelBearing);
    return Number((edge.length / (speedKmh / 3.6)).toFixed(3));
  }
}
