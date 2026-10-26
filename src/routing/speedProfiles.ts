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

// Data-derived 96-slot speed factors from LTA Traffic Speed Bands (37.1M observations, 2026-10-13 to 2026-10-22)
export const EXP_INBOUND_FACTORS = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 0.996, 0.996, 0.999, 0.996, 0.997, 0.994, 0.999, 1, 1, 1, 1, 1, 1, 1, 1, 0.997, 0.992, 0.987, 0.978, 0.954, 0.907, 0.896, 0.853, 0.841, 0.841, 0.831, 0.824, 0.831, 0.861, 0.874, 0.877, 0.883, 0.895, 0.88, 0.884, 0.896, 0.907, 0.92, 0.922, 0.923, 0.931, 0.944, 0.944, 0.947, 0.947, 0.942, 0.929, 0.923, 0.922, 0.917, 0.916, 0.919, 0.925, 0.923, 0.928, 0.928, 0.926, 0.929, 0.931, 0.931, 0.931, 0.931, 0.91, 0.902, 0.898, 0.893, 0.89, 0.898, 0.913, 0.917, 0.934, 0.944, 0.954, 0.959, 0.962, 0.965, 0.969, 0.971, 0.972, 0.975, 0.98, 0.983, 0.987, 0.989, 0.993, 0.994, 0.997]);
export const EXP_OUTBOUND_FACTORS = new Float32Array([0.996, 0.999, 0.999, 1, 1, 1, 1, 1, 1, 1, 1, 0.999, 0.999, 0.995, 0.998, 0.999, 0.999, 0.996, 1, 0.996, 0.993, 0.993, 0.992, 0.99, 0.987, 0.986, 0.98, 0.974, 0.97, 0.958, 0.946, 0.932, 0.916, 0.917, 0.92, 0.914, 0.908, 0.917, 0.916, 0.91, 0.904, 0.907, 0.903, 0.904, 0.903, 0.904, 0.906, 0.906, 0.913, 0.922, 0.923, 0.927, 0.927, 0.927, 0.926, 0.917, 0.916, 0.911, 0.904, 0.901, 0.901, 0.901, 0.903, 0.903, 0.898, 0.898, 0.895, 0.889, 0.891, 0.888, 0.881, 0.846, 0.824, 0.8, 0.797, 0.79, 0.79, 0.808, 0.827, 0.846, 0.87, 0.9, 0.91, 0.923, 0.929, 0.933, 0.936, 0.936, 0.942, 0.951, 0.954, 0.961, 0.974, 0.982, 0.987, 0.99]);
export const ART_INBOUND_FACTORS = new Float32Array([0.952, 0.957, 0.962, 0.972, 0.981, 0.984, 0.989, 0.991, 0.993, 0.993, 0.998, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.998, 0.991, 0.979, 0.957, 0.945, 0.935, 0.928, 0.918, 0.899, 0.887, 0.882, 0.879, 0.87, 0.862, 0.855, 0.862, 0.865, 0.87, 0.87, 0.87, 0.872, 0.874, 0.877, 0.877, 0.874, 0.877, 0.874, 0.877, 0.877, 0.882, 0.884, 0.882, 0.879, 0.877, 0.877, 0.874, 0.874, 0.877, 0.874, 0.874, 0.877, 0.877, 0.877, 0.877, 0.874, 0.877, 0.874, 0.877, 0.874, 0.872, 0.865, 0.862, 0.857, 0.862, 0.862, 0.862, 0.857, 0.867, 0.874, 0.882, 0.884, 0.887, 0.891, 0.896, 0.896, 0.901, 0.904, 0.911, 0.913, 0.923, 0.925, 0.933, 0.938, 0.945]);
export const ART_OUTBOUND_FACTORS = new Float32Array([0.952, 0.957, 0.964, 0.974, 0.981, 0.988, 0.991, 0.995, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.998, 0.993, 0.988, 0.974, 0.962, 0.942, 0.928, 0.918, 0.914, 0.911, 0.899, 0.892, 0.892, 0.889, 0.88, 0.875, 0.87, 0.87, 0.868, 0.868, 0.865, 0.863, 0.863, 0.865, 0.865, 0.865, 0.865, 0.865, 0.865, 0.87, 0.87, 0.873, 0.875, 0.875, 0.87, 0.868, 0.865, 0.865, 0.863, 0.865, 0.865, 0.868, 0.868, 0.868, 0.868, 0.87, 0.868, 0.87, 0.873, 0.87, 0.865, 0.858, 0.846, 0.841, 0.834, 0.834, 0.836, 0.841, 0.841, 0.856, 0.868, 0.877, 0.882, 0.885, 0.887, 0.892, 0.892, 0.897, 0.899, 0.906, 0.911, 0.918, 0.926, 0.933, 0.938, 0.942]);

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
   *
   * HEURISTIC (tuned on probe 2026-10-08, not from logged data).
   */
  public static getTemporalSpeedFactor(
    highway: string,
    dayType: DayType,
    slotIndex: number,
    bearing?: number
  ): number {
    if (dayType === 'SUNDAY_PH') return 1.0; // Weekend/PH free-flow

    const isExpressway = highway === 'motorway' || highway === 'motorway_link';
    const isArterial = highway === 'trunk' || highway === 'primary' || highway === 'primary_link';
    if (!isExpressway && !isArterial) return 1.0;

    const isInbound = bearing !== undefined && bearing >= 120 && bearing <= 240;
    const isOutbound = bearing !== undefined && (bearing <= 60 || bearing >= 300);

    if (dayType === 'WEEKDAY') {
      if (isExpressway) {
        return isInbound
          ? EXP_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? EXP_OUTBOUND_FACTORS[slotIndex]
            : (EXP_INBOUND_FACTORS[slotIndex] + EXP_OUTBOUND_FACTORS[slotIndex]) * 0.5;
      }
      if (isArterial) {
        return isInbound
          ? ART_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? ART_OUTBOUND_FACTORS[slotIndex]
            : (ART_INBOUND_FACTORS[slotIndex] + ART_OUTBOUND_FACTORS[slotIndex]) * 0.5;
      }
    }

    if (dayType === 'SATURDAY') {
      if (isExpressway) {
        if (slotIndex >= 28 && slotIndex <= 38) return 0.96;
        if (slotIndex >= 46 && slotIndex <= 56) return 0.90;
        if (slotIndex >= 68 && slotIndex <= 80) return 0.81;
        return 0.98;
      }
      if (isArterial) {
        if (slotIndex >= 28 && slotIndex <= 38) return 0.92;
        if (slotIndex >= 46 && slotIndex <= 56) return 0.88;
        if (slotIndex >= 68 && slotIndex <= 80) return 0.85;
        return 0.95;
      }
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

    if (dayType === 'SUNDAY_PH') {
      const speedKmh = Math.max(10, baseSpeed);
      return edgeLength / (speedKmh / 3.6);
    }

    let factor = 1.0;
    if (dayType === 'WEEKDAY') {
      const isInbound = bearing >= 120 && bearing <= 240;
      const isOutbound = bearing <= 60 || bearing >= 300;
      if (highwayType === 1) {
        factor = isInbound
          ? EXP_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? EXP_OUTBOUND_FACTORS[slotIndex]
            : (EXP_INBOUND_FACTORS[slotIndex] + EXP_OUTBOUND_FACTORS[slotIndex]) * 0.5;
      } else if (highwayType === 2) {
        factor = isInbound
          ? ART_INBOUND_FACTORS[slotIndex]
          : isOutbound
            ? ART_OUTBOUND_FACTORS[slotIndex]
            : (ART_INBOUND_FACTORS[slotIndex] + ART_OUTBOUND_FACTORS[slotIndex]) * 0.5;
      }
    } else if (dayType === 'SATURDAY') {
      if (highwayType === 1) {
        if (slotIndex >= 28 && slotIndex <= 38) factor = 0.96;
        else if (slotIndex >= 46 && slotIndex <= 56) factor = 0.90;
        else if (slotIndex >= 68 && slotIndex <= 80) factor = 0.81;
        else factor = 0.98;
      } else if (highwayType === 2) {
        if (slotIndex >= 28 && slotIndex <= 38) factor = 0.92;
        else if (slotIndex >= 46 && slotIndex <= 56) factor = 0.88;
        else if (slotIndex >= 68 && slotIndex <= 80) factor = 0.85;
        else factor = 0.95;
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
