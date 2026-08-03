/**
 * Tests for the Comfort Index algorithm (closes G11 verification).
 *
 * These tests verify that the dashboard's computeHeatIndex and
 * getComfortStatus match the firmware's PDF §5.0 algorithm:
 *   Stage 1: Steadman Heat Index (Adafruit DHT computeHeatIndex)
 *   Stage 3: Status classification using heat index + AQ thresholds
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

describe('getComfortLevel (§5.0 thresholds)', () => {
  it('returns OPTIMAL when heat index 20-26°C and AQ < 30%', () => {
    expect(getComfortLevel(22, 15).key).toBe('OPTIMAL');
    expect(getComfortLevel(20, 29).key).toBe('OPTIMAL');
    expect(getComfortLevel(26, 10).key).toBe('OPTIMAL');
  });

  it('returns FAIR when heat index 26-29°C or AQ 30-60%', () => {
    expect(getComfortLevel(27, 20).key).toBe('FAIR');
    expect(getComfortLevel(22, 45).key).toBe('FAIR');
    expect(getComfortLevel(28, 55).key).toBe('FAIR');
  });

  it('returns FAIR for heat index 18-20 (between POOR and OPTIMAL)', () => {
    expect(getComfortLevel(19, 10).key).toBe('FAIR');
  });

  it('returns POOR when heat index > 29°C', () => {
    expect(getComfortLevel(30, 10).key).toBe('POOR');
    expect(getComfortLevel(35, 5).key).toBe('POOR');
  });

  it('returns POOR when heat index < 18°C', () => {
    expect(getComfortLevel(15, 10).key).toBe('POOR');
    expect(getComfortLevel(10, 5).key).toBe('POOR');
  });

  it('returns POOR when air quality > 60%', () => {
    expect(getComfortLevel(22, 70).key).toBe('POOR');
    expect(getComfortLevel(25, 100).key).toBe('POOR');
  });

  it('is worst-case: POOR overrides OPTIMAL/FAIR', () => {
    // Heat index is OPTIMAL (22°C) but AQ is POOR (>60%)
    expect(getComfortLevel(22, 70).key).toBe('POOR');
    // Heat index is POOR (>29°C) but AQ is OPTIMAL (<30%)
    expect(getComfortLevel(30, 10).key).toBe('POOR');
  });

  it('returns a COMFORT_LEVELS entry with display properties', () => {
    const level = getComfortLevel(22, 15);
    expect(level).toBe(COMFORT_LEVELS.OPTIMAL);
    expect(level).toHaveProperty('label');
    expect(level).toHaveProperty('message');
    expect(level).toHaveProperty('color');
  });
});

describe('evaluateComfort', () => {
  it('returns heatIndex, comfortStatus, and level', () => {
    const result = evaluateComfort({ temperature: 25, humidity: 50, airQuality: 20 });
    expect(result).toHaveProperty('heatIndex');
    expect(result).toHaveProperty('comfortStatus');
    expect(result).toHaveProperty('level');
    expect(typeof result.heatIndex).toBe('number');
    expect(['OPTIMAL', 'FAIR', 'POOR']).toContain(result.comfortStatus);
  });

  it('rounds heatIndex to 1 decimal place', () => {
    const result = evaluateComfort({ temperature: 30, humidity: 80, airQuality: 20 });
    const decimals = (result.heatIndex.toString().split('.')[1] || '').length;
    expect(decimals).toBeLessThanOrEqual(1);
  });

  it('produces OPTIMAL for ideal conditions', () => {
    // 24°C, 40% RH, AQ 10% → heat index ~24°C → OPTIMAL
    const result = evaluateComfort({ temperature: 24, humidity: 40, airQuality: 10 });
    expect(result.comfortStatus).toBe('OPTIMAL');
  });

  it('produces POOR for extreme heat', () => {
    // 35°C, 90% RH → heat index well above 29°C → POOR
    const result = evaluateComfort({ temperature: 35, humidity: 90, airQuality: 10 });
    expect(result.comfortStatus).toBe('POOR');
  });
});
