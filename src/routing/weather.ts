/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * weather.ts: Live tropical rainfall and weather impact service.
 *
 * Ingests NEA (National Environment Agency) 5-minute real-time telemetry
 * across Singapore via data.gov.sg (open, no key required).
 *
 * Used to apply sheltered linkway preferences during heavy tropical downpours
 * (> 1.0 mm/5-min reading).
 */

import { haversineMeters } from './graph';

export interface RainStation {
  id: string;
  lat: number;
  lng: number;
  rainfallMm: number;
}

export interface WeatherAssessment {
  rainfallMm: number;
  isRaining: boolean; // true if rainfall > 1.0 mm (triggering sheltered routing)
  stationId?: string;
  stationDistanceMeters?: number;
}

const NEA_RAINFALL_URL = 'https://api-open.data.gov.sg/v2/real-time/api/rainfall';
const RAIN_THRESHOLD_MM = 1.0;
const MAX_STATION_DISTANCE_M = 6000; // 6 km radius

export class WeatherService {
  private cachedStations: RainStation[] = [];
  private lastFetchTime = 0;
  private static readonly CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  /**
   * Fetches latest 5-minute rainfall readings from NEA.
   */
  public async fetchLiveRainfall(): Promise<RainStation[]> {
    const now = Date.now();
    if (this.cachedStations.length > 0 && now - this.lastFetchTime < WeatherService.CACHE_TTL_MS) {
      return this.cachedStations;
    }

    try {
      const res = await fetch(NEA_RAINFALL_URL, {
        headers: { accept: 'application/json', 'User-Agent': 'SafeSpot-SG-Weather/1.0' },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        console.warn(`[WEATHER] NEA returned HTTP ${res.status}`);
        return this.cachedStations;
      }

      const data = (await res.json()) as any;
      const stationsList = data.data?.stations || [];
      const readingsList = data.data?.readings?.[0]?.data || [];

      const readingMap = new Map<string, number>();
      for (const r of readingsList) {
        readingMap.set(String(r.stationId), Number(r.value) || 0);
      }

      const stations: RainStation[] = [];
      for (const s of stationsList) {
        const lat = s.location?.latitude;
        const lng = s.location?.longitude;
        if (typeof lat === 'number' && typeof lng === 'number') {
          const rainfall = readingMap.get(String(s.id)) ?? 0;
          stations.push({ id: String(s.id), lat, lng, rainfallMm: rainfall });
        }
      }

      if (stations.length > 0) {
        this.cachedStations = stations;
        this.lastFetchTime = now;
      }
      return this.cachedStations;
    } catch (err: any) {
      console.warn('[WEATHER] Failed to fetch NEA rainfall:', err.message);
      return this.cachedStations;
    }
  }

  /**
   * Assesses weather conditions at a specific geographic coordinate.
   */
  public async assessWeatherAt(lat: number, lng: number): Promise<WeatherAssessment> {
    const stations = await this.fetchLiveRainfall();
    if (stations.length === 0) {
      return { rainfallMm: 0, isRaining: false };
    }

    let nearest: RainStation | null = null;
    let minDistance = Infinity;

    for (const station of stations) {
      const dist = haversineMeters(lat, lng, station.lat, station.lng);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = station;
      }
    }

    if (!nearest || minDistance > MAX_STATION_DISTANCE_M) {
      return { rainfallMm: 0, isRaining: false };
    }

    return {
      rainfallMm: nearest.rainfallMm,
      isRaining: nearest.rainfallMm >= RAIN_THRESHOLD_MM,
      stationId: nearest.id,
      stationDistanceMeters: Math.round(minDistance),
    };
  }

  /**
   * Evaluates maximum rainfall along a route or set of coordinates.
   */
  public async assessMaxRainfallAlongPath(
    points: Array<{ lat: number; lng: number }>
  ): Promise<WeatherAssessment> {
    const stations = await this.fetchLiveRainfall();
    if (stations.length === 0 || points.length === 0) {
      return { rainfallMm: 0, isRaining: false };
    }

    let maxRainMm = 0;
    let primaryStationId: string | undefined;

    // Sample along the points
    const step = Math.max(1, Math.floor(points.length / 10));
    for (let i = 0; i < points.length; i += step) {
      const pt = points[i];
      for (const s of stations) {
        const d = haversineMeters(pt.lat, pt.lng, s.lat, s.lng);
        if (d <= MAX_STATION_DISTANCE_M) {
          if (s.rainfallMm > maxRainMm) {
            maxRainMm = s.rainfallMm;
            primaryStationId = s.id;
          }
        }
      }
    }

    return {
      rainfallMm: maxRainMm,
      isRaining: maxRainMm >= RAIN_THRESHOLD_MM,
      stationId: primaryStationId,
    };
  }
}
