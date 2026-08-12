import { describe, it, expect } from 'vitest';
import { validatePasswordStrength } from '../utils/passwordStrength';

describe('validatePasswordStrength', () => {
  it('returns score 0 for empty password', () => {
    const result = validatePasswordStrength('');
    expect(result.score).toBe(0);
    expect(result.valid).toBe(false);
  });

  it('returns invalid for short passwords', () => {
    expect(validatePasswordStrength('abc').valid).toBe(false);
    expect(validatePasswordStrength('Ab1!').valid).toBe(false);
  });

  it('returns invalid for passwords missing character classes', () => {
    expect(validatePasswordStrength('abcdefgh').valid).toBe(false);
    expect(validatePasswordStrength('ABCDEFGH').valid).toBe(false);
  });

  it('returns valid for strong passwords', () => {
    expect(validatePasswordStrength('Abcdef1!').valid).toBe(true);
    expect(validatePasswordStrength('MyP@ssw0rd').valid).toBe(true);
  });

  it('returns a score between 0 and 4', () => {
    const weak = validatePasswordStrength('abc');
    const strong = validatePasswordStrength('MyP@ssw0rd');
    expect(weak.score).toBeLessThanOrEqual(4);
    expect(strong.score).toBeLessThanOrEqual(4);
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it('returns checks array with 5 items', () => {
    const result = validatePasswordStrength('test');
    expect(result.checks).toHaveLength(5);
    expect(result.checks[0].label).toBe('At least 8 characters');
  });
});
