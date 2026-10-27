/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * seniorInstructions.edge-cases.test.ts: Dynamic behavioral validation tests
 * for senior-friendly pedestrian navigation instruction generator.
 *
 * Validates:
 * 1. Empty route segments array gracefully returns arrival instruction in all 4 languages ('en', 'zh', 'ms', 'ta').
 * 2. Graceful resilience against null or undefined input.
 * 3. Complex route containing consecutive steps (verifying contiguous step aggregation),
 *    ramp avoiding stairs, pedestrian crossing, and covered linkways in all 4 languages ('en', 'zh', 'ms', 'ta').
 */

import { describe, it, expect } from 'vitest';
import {
  generateSeniorInstructions,
  PedestrianRouteResult,
  SeniorGuidanceLang,
} from './pedestrianRouter';

describe('generateSeniorInstructions Dynamic Behavioral Validation & Edge Cases', () => {
  describe('1. Empty Route Segments & Zero-Distance Routes', () => {
    it('gracefully returns localized arrival message when route segments array is empty in all 4 languages', () => {
      const emptyRoute: PedestrianRouteResult = {
        durationSeconds: 0,
        distanceMeters: 0,
        shelteredDistanceMeters: 0,
        shelteredPercentage: 100,
        stepsCount: 0,
        isRaining: false,
        path: [{ lat: 1.3000, lng: 103.8000 }],
        nodeIds: [0],
        edgeIds: [],
        segments: [],
      };

      // English
      const en = generateSeniorInstructions(emptyRoute, 'en');
      expect(en).toEqual(['You have arrived at your destination.']);

      // Chinese (Simplified)
      const zh = generateSeniorInstructions(emptyRoute, 'zh');
      expect(zh).toEqual(['您已到达目的地。']);

      // Malay
      const ms = generateSeniorInstructions(emptyRoute, 'ms');
      expect(ms).toEqual(['Anda telah tiba di destinasi.']);

      // Tamil
      const ta = generateSeniorInstructions(emptyRoute, 'ta');
      expect(ta).toEqual(['உங்கள் இலக்கை அடைந்துவிட்டீர்கள்.']);
    });

    it('defaults to English arrival message when language is omitted', () => {
      const emptyRoute: PedestrianRouteResult = {
        durationSeconds: 0,
        distanceMeters: 0,
        shelteredDistanceMeters: 0,
        shelteredPercentage: 100,
        stepsCount: 0,
        isRaining: false,
        path: [],
        nodeIds: [],
        edgeIds: [],
        segments: [],
      };

      const result = generateSeniorInstructions(emptyRoute);
      expect(result).toEqual(['You have arrived at your destination.']);
    });

    it('gracefully handles null or undefined route input without throwing', () => {
      const langs: SeniorGuidanceLang[] = ['en', 'zh', 'ms', 'ta'];
      for (const lang of langs) {
        expect(() => generateSeniorInstructions(null as any, lang)).not.toThrow();
        expect(() => generateSeniorInstructions(undefined as any, lang)).not.toThrow();
      }

      expect(generateSeniorInstructions(null as any, 'en')).toEqual([
        'You have arrived at your destination.',
      ]);
      expect(generateSeniorInstructions(null as any, 'zh')).toEqual(['您已到达目的地。']);
      expect(generateSeniorInstructions(null as any, 'ms')).toEqual(['Anda telah tiba di destinasi.']);
      expect(generateSeniorInstructions(null as any, 'ta')).toEqual([
        'உங்கள் இலக்கை அடைந்துவிட்டீர்கள்.',
      ]);
    });
  });

  describe('2. Multi-Feature Route (Consecutive Steps, Ramp, Covered Linkways) in 4 Languages', () => {
    // Construct route containing:
    // - Covered linkway (50m)
    // - Consecutive steps (15m + 15m) -> should aggregate into single 30m warning stretch
    // - Ramp avoiding stairs (25m)
    // - Pedestrian crossing (20m)
    // - Another covered linkway (40m)
    const multiFeatureRoute: PedestrianRouteResult = {
      durationSeconds: 165,
      distanceMeters: 150,
      shelteredDistanceMeters: 90,
      shelteredPercentage: 60,
      stepsCount: 2,
      isRaining: false,
      path: [
        { lat: 1.3000, lng: 103.8000 },
        { lat: 1.3005, lng: 103.8005 },
        { lat: 1.3006, lng: 103.8006 },
        { lat: 1.3007, lng: 103.8007 },
        { lat: 1.3009, lng: 103.8009 },
        { lat: 1.3011, lng: 103.8011 },
        { lat: 1.3015, lng: 103.8015 },
      ],
      nodeIds: [0, 1, 2, 3, 4, 5, 6],
      edgeIds: [101, 102, 103, 104, 105, 106],
      segments: [
        {
          from: { lat: 1.3000, lng: 103.8000 },
          to: { lat: 1.3005, lng: 103.8005 },
          distanceMeters: 50,
          covered: true,
          isSteps: false,
          hasRamp: false,
          name: 'Linkway Segment A',
          highway: 'footway',
        },
        // Consecutive flight of steps 1
        {
          from: { lat: 1.3005, lng: 103.8005 },
          to: { lat: 1.3006, lng: 103.8006 },
          distanceMeters: 15,
          covered: false,
          isSteps: true,
          hasRamp: false,
          name: 'Stairs Flight 1',
          highway: 'steps',
        },
        // Consecutive flight of steps 2 (adjacent)
        {
          from: { lat: 1.3006, lng: 103.8006 },
          to: { lat: 1.3007, lng: 103.8007 },
          distanceMeters: 15,
          covered: false,
          isSteps: true,
          hasRamp: false,
          name: 'Stairs Flight 2',
          highway: 'steps',
        },
        // Barrier-free ramp avoiding stairs
        {
          from: { lat: 1.3007, lng: 103.8007 },
          to: { lat: 1.3009, lng: 103.8009 },
          distanceMeters: 25,
          covered: false,
          isSteps: true,
          hasRamp: true,
          name: 'Gentle Ramp Bypass',
          highway: 'footway',
        },
        // Pedestrian crossing
        {
          from: { lat: 1.3009, lng: 103.8009 },
          to: { lat: 1.3011, lng: 103.8011 },
          distanceMeters: 20,
          covered: false,
          isSteps: false,
          hasRamp: false,
          name: 'Signalized Crossing',
          highway: 'crossing',
        },
        // Second covered linkway
        {
          from: { lat: 1.3011, lng: 103.8011 },
          to: { lat: 1.3015, lng: 103.8015 },
          distanceMeters: 40,
          covered: true,
          isSteps: false,
          hasRamp: false,
          name: 'Linkway Segment B',
          highway: 'footway',
        },
      ],
    };

    it('aggregates consecutive steps into a single stretch and generates English instructions', () => {
      const en = generateSeniorInstructions(multiFeatureRoute, 'en');

      // Check structure:
      // 1. Linkway A (50m)
      // 2. Steps combined (15 + 15 = 30m)
      // 3. Ramp (25m)
      // 4. Crossing
      // 5. Linkway B (40m)
      // 6. Arrival safe pickup point
      expect(en).toHaveLength(6);

      expect(en[0]).toBe('Continue along the covered linkway for about 50 metres.');
      // Verify consecutive steps are aggregated into exactly ONE warning with 30 metres
      expect(en[1]).toBe(
        'Caution: steps ahead, please hold the handrail carefully (about 30 metres).'
      );
      expect(en[2]).toBe(
        'Take the gentle barrier-free ramp ahead (avoiding stairs), about 25 metres.'
      );
      expect(en[3]).toBe(
        'At the pedestrian crossing, wait for the green signal to cross safely.'
      );
      expect(en[4]).toBe('Continue along the covered linkway for about 40 metres.');
      expect(en[5]).toBe('You are arriving at the safe pickup point.');
    });

    it('generates accurate Chinese (zh) instructions with merged steps and ramp guidance', () => {
      const zh = generateSeniorInstructions(multiFeatureRoute, 'zh');

      expect(zh).toHaveLength(6);
      expect(zh[0]).toBe('沿着有盖走廊直行约 50 米。');
      // Aggregated consecutive steps
      expect(zh[1]).toBe('注意：前方有台阶，请扶好扶手小心上下（约 30 米）。');
      expect(zh[2]).toBe('走前方无障碍缓坡（避开楼梯），约 25 米。');
      expect(zh[3]).toBe('在行人过街横道处，等待绿灯安全过马路。');
      expect(zh[4]).toBe('沿着有盖走廊直行约 40 米。');
      expect(zh[5]).toBe('您即将到达安全上车点。');
    });

    it('generates accurate Malay (ms) instructions with merged steps and ramp guidance', () => {
      const ms = generateSeniorInstructions(multiFeatureRoute, 'ms');

      expect(ms).toHaveLength(6);
      expect(ms[0]).toBe('Teruskan di laluan berbumbung sejauh lebih kurang 50 meter.');
      // Aggregated consecutive steps
      expect(ms[1]).toBe(
        'Perhatian: ada tangga di hadapan, sila pegang pemegang dengan berhati-hati (kira-kira 30 meter).'
      );
      expect(ms[2]).toBe(
        'Gunakan tanjakan bebas halangan di hadapan (mengelak tangga), kira-kira 25 meter.'
      );
      expect(ms[3]).toBe(
        'Di lintasan pejalan kaki, tunggu lampu hijau sebelum melintas dengan selamat.'
      );
      expect(ms[4]).toBe('Teruskan di laluan berbumbung sejauh lebih kurang 40 meter.');
      expect(ms[5]).toBe('Anda hampir sampai di tempat menunggu yang selamat.');
    });

    it('generates accurate Tamil (ta) instructions with merged steps and ramp guidance', () => {
      const ta = generateSeniorInstructions(multiFeatureRoute, 'ta');

      expect(ta).toHaveLength(6);
      expect(ta[0]).toBe('கூரை வேய்ந்த நடைபாதையில் சுமார் 50 மீட்டர் நேராகச் செல்லவும்.');
      // Aggregated consecutive steps
      expect(ta[1]).toBe(
        'கவனம்: முன்னால் படிகள் உள்ளன, கைப்பிடியைப் பிடித்து கவனமாக நடக்கவும் (சுமார் 30 மீட்டர்).'
      );
      expect(ta[2]).toBe(
        'முன்னால் உள்ள தடையில்லா சாய்வுதளத்தைப் பயன்படுத்தவும் (படிக்கட்டுகளைத் தவிர்க்கவும்), சுமார் 25 மீட்டர்.'
      );
      expect(ta[3]).toBe(
        'பாதசாரி கடவையில், பாதுகாப்பாக கடக்க பச்சை விளக்குக்காக காத்திருக்கவும்.'
      );
      expect(ta[4]).toBe('கூரை வேய்ந்த நடைபாதையில் சுமார் 40 மீட்டர் நேராகச் செல்லவும்.');
      expect(ta[5]).toBe('நீங்கள் பாதுகாப்பான இடத்திற்கு வந்துவிட்டீர்கள்.');
    });
  });
});
