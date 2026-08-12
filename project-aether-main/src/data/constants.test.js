/**
 * Tests for the Comfort Index algorithm (closes G11 verification).
 *
 * These tests verify that the dashboard's computeHeatIndex and
 * getComfortLevel match the firmware:
 *   Heat index: Steadman Heat Index (Adafruit DHT computeHeatIndex)
 *   Comfort status: classification from CO2 ppm alone (airStatusFor)
 *
 * The Steadman heat index expected values were cross-checked against
 * the NWS heat index calculator:
 *   https://www.wpc.ncep.noaa.gov/html/heatindex.shtml
 */
import { describe, it, expect } from 'vitest';
import {
  computeHeatIndex,
  getComfortLevel,
  evaluateComfort,
  COMFORT_LEVELS,
} from '../data/constants';

describe('computeHeatIndex', () => {
  it('returns a number', () => {
    expect(typeof computeHeatIndex(25, 50)).toBe('number');
  });

  it('matches the Adafruit DHT library for 25°C / 50% RH', () => {
    // dht.computeHeatIndex(25, 50, false) ≈ 24.9°C
    // The simple formula path (tempF <= 80) is used here since 25°C = 77°F.
    // hiF = 0.5 * (77 + 61 + (9*1.2) + (50*0.094)) = 76.75°F → 24.86°C
    const hi = computeHeatIndex(25, 50);
    expect(hi).toBeCloseTo(24.9, 0);
  });

  it('matches the Adafruit DHT library for 30°C / 80% RH', () => {
    // dht.computeHeatIndex(30, 80, false) ≈ 37.7°C
    // 30°C = 86°F, so the Rothfusz regression path is used.
    const hi = computeHeatIndex(30, 80);
    expect(hi).toBeCloseTo(37.7, 0);
  });

  it('clamps humidity to [0, 100]', () => {
    const hiLow = computeHeatIndex(25, -10);
    const hiHigh = computeHeatIndex(25, 150);
    const hi0 = computeHeatIndex(25, 0);
    const hi100 = computeHeatIndex(25, 100);

    expect(hiLow).toBeCloseTo(hi0, 5);
    expect(hiHigh).toBeCloseTo(hi100, 5);
  });

  it('produces a higher heat index with higher humidity at the same temperature', () => {
    const hiDry = computeHeatIndex(28, 20);
    const hiHumid = computeHeatIndex(28, 80);
    expect(hiHumid).toBeGreaterThan(hiDry);
  });
});

describe('getComfortLevel (CO2 ppm thresholds)', () => {
  it('returns GOOD at or below 1000 ppm', () => {
    expect(getComfortLevel(400).key).toBe('GOOD');
    expect(getComfortLevel(800).key).toBe('GOOD');
    expect(getComfortLevel(1000).key).toBe('GOOD');
  });

  it('returns FAIR between 1001 and 2000 ppm', () => {
    expect(getComfortLevel(1001).key).toBe('FAIR');
    expect(getComfortLevel(1500).key).toBe('FAIR');
    expect(getComfortLevel(2000).key).toBe('FAIR');
  });

  it('returns POOR between 2001 and 5000 ppm', () => {
    expect(getComfortLevel(2001).key).toBe('POOR');
    expect(getComfortLevel(3500).key).toBe('POOR');
    expect(getComfortLevel(5000).key).toBe('POOR');
  });

  it('returns HAZARD above 5000 ppm', () => {
    expect(getComfortLevel(5001).key).toBe('HAZARD');
    expect(getComfortLevel(20000).key).toBe('HAZARD');
  });

  it('returns a COMFORT_LEVELS entry with display properties', () => {
    const level = getComfortLevel(400);
    expect(level).toBe(COMFORT_LEVELS.GOOD);
    expect(level).toHaveProperty('label');
    expect(level).toHaveProperty('message');
    expect(level).toHaveProperty('color');
  });

  // The UI (StatusCard) keys its icons and styles off these exact values, so
  // a rename here silently degrades every card to "No Data".
  it('only ever returns keys the UI knows how to render', () => {
    for (const ppm of [400, 1500, 3500, 20000]) {
      expect(['GOOD', 'FAIR', 'POOR', 'HAZARD']).toContain(getComfortLevel(ppm).key);
    }
  });
});

describe('evaluateComfort', () => {
  it('returns heatIndex, comfortStatus, and level', () => {
    const result = evaluateComfort({ temperature: 25, humidity: 50, airQuality: 800 });
    expect(result).toHaveProperty('heatIndex');
    expect(result).toHaveProperty('comfortStatus');
    expect(result).toHaveProperty('level');
    expect(typeof result.heatIndex).toBe('number');
    expect(['GOOD', 'FAIR', 'POOR', 'HAZARD']).toContain(result.comfortStatus);
  });

  it('rounds heatIndex to 1 decimal place', () => {
    const result = evaluateComfort({ temperature: 30, humidity: 80, airQuality: 800 });
    const decimals = (result.heatIndex.toString().split('.')[1] || '').length;
    expect(decimals).toBeLessThanOrEqual(1);
  });

  it('produces GOOD for fresh air', () => {
    const result = evaluateComfort({ temperature: 24, humidity: 40, airQuality: 450 });
    expect(result.comfortStatus).toBe('GOOD');
  });

  it('produces HAZARD when CO2 exceeds the exposure limit', () => {
    const result = evaluateComfort({ temperature: 24, humidity: 40, airQuality: 6000 });
    expect(result.comfortStatus).toBe('HAZARD');
  });

  // Comfort status is CO2-only: temperature must not influence it, matching
  // the firmware's airStatusFor().
  it('ignores temperature and humidity when classifying', () => {
    const cool = evaluateComfort({ temperature: 10, humidity: 20, airQuality: 450 });
    const hot = evaluateComfort({ temperature: 40, humidity: 95, airQuality: 450 });
    expect(cool.comfortStatus).toBe('GOOD');
    expect(hot.comfortStatus).toBe('GOOD');
  });
});
