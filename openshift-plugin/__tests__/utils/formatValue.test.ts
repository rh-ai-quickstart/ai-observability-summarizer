/**
 * Tests for the enhanced formatValue function with unit-aware formatting
 * This tests the unit formatting logic that was added in Phase 3.2
 */

// Since formatValue is defined inside MetricCard component, we'll test it indirectly
// through component rendering. This file tests the formatting logic separately.

/**
 * Standalone implementation of the enhanced formatValue function for testing
 * This matches the implementation in MetricCard component
 */
export const formatValue = (val: number | null, unitType?: string): { value: string; unit: string } => {
  if (val === null || val === undefined || isNaN(val)) {
    return { value: '—', unit: unitType || '' };
  }

  // Handle energy units: Joules → kJ → MJ → GJ
  if (unitType === 'J') {
    if (val >= 1000000000) return { value: (val / 1000000000).toFixed(2), unit: 'GJ' };
    if (val >= 1000000) return { value: (val / 1000000).toFixed(2), unit: 'MJ' };
    if (val >= 1000) return { value: (val / 1000).toFixed(2), unit: 'kJ' };
    return { value: val.toFixed(2), unit: 'J' };
  }

  // Handle frequency units: Hz → kHz → MHz → GHz
  if (unitType === 'Hz') {
    if (val >= 1000000000) return { value: (val / 1000000000).toFixed(2), unit: 'GHz' };
    if (val >= 1000000) return { value: (val / 1000000).toFixed(2), unit: 'MHz' };
    if (val >= 1000) return { value: (val / 1000).toFixed(2), unit: 'kHz' };
    return { value: val.toFixed(0), unit: 'Hz' };
  }

  // Handle MHz → GHz conversion
  if (unitType === 'MHz') {
    if (val >= 1000) return { value: (val / 1000).toFixed(2), unit: 'GHz' };
    return { value: val.toFixed(0), unit: 'MHz' };
  }

  // Handle power units: W → kW → MW
  if (unitType === 'W') {
    if (val >= 1000000) return { value: (val / 1000000).toFixed(2), unit: 'MW' };
    if (val >= 1000) return { value: (val / 1000).toFixed(2), unit: 'kW' };
    return { value: val.toFixed(1), unit: 'W' };
  }

  // Handle bytes: B → KB → MB → GB → TB
  if (unitType === 'B') {
    if (val >= 1099511627776) return { value: (val / 1099511627776).toFixed(2), unit: 'TB' };
    if (val >= 1073741824) return { value: (val / 1073741824).toFixed(2), unit: 'GB' };
    if (val >= 1048576) return { value: (val / 1048576).toFixed(2), unit: 'MB' };
    if (val >= 1024) return { value: (val / 1024).toFixed(2), unit: 'KB' };
    return { value: val.toFixed(0), unit: 'B' };
  }

  // Generic number formatting for other units (%, cores, /s, etc.)
  let formattedValue: string;
  if (val >= 1000000000) formattedValue = `${(val / 1000000000).toFixed(2)}B`;
  else if (val >= 1000000) formattedValue = `${(val / 1000000).toFixed(2)}M`;
  else if (val >= 1000) formattedValue = `${(val / 1000).toFixed(1)}K`;
  else if (val < 0.01 && val > 0) formattedValue = val.toExponential(2);
  else if (Number.isInteger(val)) formattedValue = val.toString();
  else formattedValue = val.toFixed(2);

  return { value: formattedValue, unit: unitType || '' };
};

describe('formatValue - Enhanced Unit Formatting', () => {
  describe('Energy Units (Joules)', () => {
    it('should format small joule values correctly', () => {
      expect(formatValue(500, 'J')).toEqual({ value: '500.00', unit: 'J' });
      expect(formatValue(999, 'J')).toEqual({ value: '999.00', unit: 'J' });
    });

    it('should convert J to kJ for thousands', () => {
      expect(formatValue(1000, 'J')).toEqual({ value: '1.00', unit: 'kJ' });
      expect(formatValue(2500, 'J')).toEqual({ value: '2.50', unit: 'kJ' });
      expect(formatValue(999999, 'J')).toEqual({ value: '1000.00', unit: 'kJ' });
    });

    it('should convert J to MJ for millions', () => {
      expect(formatValue(1000000, 'J')).toEqual({ value: '1.00', unit: 'MJ' });
      expect(formatValue(2500000, 'J')).toEqual({ value: '2.50', unit: 'MJ' });
      expect(formatValue(500000000, 'J')).toEqual({ value: '500.00', unit: 'MJ' });
    });

    it('should convert J to GJ for billions', () => {
      expect(formatValue(1000000000, 'J')).toEqual({ value: '1.00', unit: 'GJ' });
      expect(formatValue(3500000000, 'J')).toEqual({ value: '3.50', unit: 'GJ' });
    });
  });

  describe('Frequency Units (Hz)', () => {
    it('should format small Hz values correctly', () => {
      expect(formatValue(500, 'Hz')).toEqual({ value: '500', unit: 'Hz' });
      expect(formatValue(999, 'Hz')).toEqual({ value: '999', unit: 'Hz' });
    });

    it('should convert Hz to kHz for thousands', () => {
      expect(formatValue(1000, 'Hz')).toEqual({ value: '1.00', unit: 'kHz' });
      expect(formatValue(2500, 'Hz')).toEqual({ value: '2.50', unit: 'kHz' });
      expect(formatValue(999999, 'Hz')).toEqual({ value: '1000.00', unit: 'kHz' });
    });

    it('should convert Hz to MHz for millions', () => {
      expect(formatValue(1000000, 'Hz')).toEqual({ value: '1.00', unit: 'MHz' });
      expect(formatValue(2500000, 'Hz')).toEqual({ value: '2.50', unit: 'MHz' });
    });

    it('should convert Hz to GHz for billions', () => {
      expect(formatValue(1000000000, 'Hz')).toEqual({ value: '1.00', unit: 'GHz' });
      expect(formatValue(3200000000, 'Hz')).toEqual({ value: '3.20', unit: 'GHz' });
    });
  });

  describe('MHz to GHz conversion', () => {
    it('should keep MHz for values under 1000', () => {
      expect(formatValue(500, 'MHz')).toEqual({ value: '500', unit: 'MHz' });
      expect(formatValue(999, 'MHz')).toEqual({ value: '999', unit: 'MHz' });
    });

    it('should convert MHz to GHz for 1000+', () => {
      expect(formatValue(1000, 'MHz')).toEqual({ value: '1.00', unit: 'GHz' });
      expect(formatValue(2500, 'MHz')).toEqual({ value: '2.50', unit: 'GHz' });
      expect(formatValue(3600, 'MHz')).toEqual({ value: '3.60', unit: 'GHz' });
    });
  });

  describe('Power Units (Watts)', () => {
    it('should format small watt values correctly', () => {
      expect(formatValue(250, 'W')).toEqual({ value: '250.0', unit: 'W' });
      expect(formatValue(999, 'W')).toEqual({ value: '999.0', unit: 'W' });
    });

    it('should convert W to kW for thousands', () => {
      expect(formatValue(1000, 'W')).toEqual({ value: '1.00', unit: 'kW' });
      expect(formatValue(1200, 'W')).toEqual({ value: '1.20', unit: 'kW' });
      expect(formatValue(850000, 'W')).toEqual({ value: '850.00', unit: 'kW' });
    });

    it('should convert W to MW for millions', () => {
      expect(formatValue(1000000, 'W')).toEqual({ value: '1.00', unit: 'MW' });
      expect(formatValue(2500000, 'W')).toEqual({ value: '2.50', unit: 'MW' });
    });
  });

  describe('Bytes (Binary scaling)', () => {
    it('should format small byte values correctly', () => {
      expect(formatValue(512, 'B')).toEqual({ value: '512', unit: 'B' });
      expect(formatValue(1023, 'B')).toEqual({ value: '1023', unit: 'B' });
    });

    it('should convert B to KB', () => {
      expect(formatValue(1024, 'B')).toEqual({ value: '1.00', unit: 'KB' });
      expect(formatValue(2048, 'B')).toEqual({ value: '2.00', unit: 'KB' });
    });

    it('should convert B to MB', () => {
      expect(formatValue(1048576, 'B')).toEqual({ value: '1.00', unit: 'MB' });
      expect(formatValue(2097152, 'B')).toEqual({ value: '2.00', unit: 'MB' });
    });

    it('should convert B to GB', () => {
      expect(formatValue(1073741824, 'B')).toEqual({ value: '1.00', unit: 'GB' });
      expect(formatValue(2147483648, 'B')).toEqual({ value: '2.00', unit: 'GB' });
    });

    it('should convert B to TB', () => {
      expect(formatValue(1099511627776, 'B')).toEqual({ value: '1.00', unit: 'TB' });
      expect(formatValue(2199023255552, 'B')).toEqual({ value: '2.00', unit: 'TB' });
    });
  });

  describe('Generic Number Formatting', () => {
    it('should handle percentage values', () => {
      expect(formatValue(45.5, '%')).toEqual({ value: '45.50', unit: '%' });
      expect(formatValue(100, '%')).toEqual({ value: '100', unit: '%' });
    });

    it('should handle large numbers with K/M/B suffixes', () => {
      expect(formatValue(1500, 'count')).toEqual({ value: '1.5K', unit: 'count' });
      expect(formatValue(2500000, 'count')).toEqual({ value: '2.50M', unit: 'count' });
      expect(formatValue(3000000000, 'count')).toEqual({ value: '3.00B', unit: 'count' });
    });

    it('should handle very small numbers with exponential notation', () => {
      expect(formatValue(0.005, 'ratio')).toEqual({ value: '5.00e-3', unit: 'ratio' });
      expect(formatValue(0.0001, 'factor')).toEqual({ value: '1.00e-4', unit: 'factor' });
    });

    it('should handle integer values', () => {
      expect(formatValue(42, 'pods')).toEqual({ value: '42', unit: 'pods' });
      expect(formatValue(100, 'services')).toEqual({ value: '100', unit: 'services' });
    });

    it('should handle decimal values with proper precision', () => {
      expect(formatValue(3.14159, 'cores')).toEqual({ value: '3.14', unit: 'cores' });
      expect(formatValue(2.5, 's')).toEqual({ value: '2.50', unit: 's' });
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values', () => {
      expect(formatValue(null, 'W')).toEqual({ value: '—', unit: 'W' });
      expect(formatValue(null)).toEqual({ value: '—', unit: '' });
    });

    it('should handle undefined values', () => {
      expect(formatValue(undefined as any, 'MHz')).toEqual({ value: '—', unit: 'MHz' });
    });

    it('should handle NaN values', () => {
      expect(formatValue(NaN, 'J')).toEqual({ value: '—', unit: 'J' });
    });

    it('should handle zero values', () => {
      expect(formatValue(0, 'W')).toEqual({ value: '0.0', unit: 'W' });
      expect(formatValue(0, 'J')).toEqual({ value: '0.00', unit: 'J' });
      expect(formatValue(0, '%')).toEqual({ value: '0', unit: '%' });
    });

    it('should handle missing unit type', () => {
      expect(formatValue(100)).toEqual({ value: '100', unit: '' });
      expect(formatValue(1500)).toEqual({ value: '1.5K', unit: '' });
    });
  });

  describe('Precision and Rounding', () => {
    it('should maintain 2-decimal precision for energy conversions', () => {
      expect(formatValue(1234567, 'J')).toEqual({ value: '1.23', unit: 'MJ' });
      expect(formatValue(1999, 'J')).toEqual({ value: '2.00', unit: 'kJ' });
    });

    it('should maintain 2-decimal precision for frequency conversions', () => {
      expect(formatValue(3456789012, 'Hz')).toEqual({ value: '3.46', unit: 'GHz' });
      expect(formatValue(2775, 'MHz')).toEqual({ value: '2.77', unit: 'GHz' }); // 2775/1000 = 2.775 -> 2.77
    });

    it('should use 1-decimal precision for power base unit', () => {
      expect(formatValue(250.6, 'W')).toEqual({ value: '250.6', unit: 'W' });
      expect(formatValue(999.9, 'W')).toEqual({ value: '999.9', unit: 'W' });
    });

    it('should use integer precision for Hz base unit', () => {
      expect(formatValue(999.7, 'Hz')).toEqual({ value: '1000', unit: 'Hz' });
      expect(formatValue(500.3, 'Hz')).toEqual({ value: '500', unit: 'Hz' });
    });
  });
});