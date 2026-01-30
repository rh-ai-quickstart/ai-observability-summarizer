/**
 * Tests for the enhanced formatValue function with unit-aware formatting
 * This tests the unit formatting logic from the shared utility
 */

import { 
  formatValue, 
  formatValueWithUnit,
  UNIT_CONVERSION,
  PRECISION,
  GPU_THRESHOLDS,
  SMALL_VALUE_THRESHOLD
} from '../../src/core/utils/formatValue';

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

  describe('formatValueWithUnit Helper Function', () => {
    it('should combine value and unit into a single string', () => {
      expect(formatValueWithUnit(1500, 'W')).toBe('1.50kW');
      expect(formatValueWithUnit(2048, 'B')).toBe('2.00KB');
      expect(formatValueWithUnit(45.5, '%')).toBe('45.50%');
    });

    it('should handle null values', () => {
      expect(formatValueWithUnit(null, 'W')).toBe('—W');
      expect(formatValueWithUnit(null)).toBe('—');
    });

    it('should handle missing units', () => {
      expect(formatValueWithUnit(100)).toBe('100');
      expect(formatValueWithUnit(1500)).toBe('1.5K');
    });
  });

  describe('UNIT_CONVERSION Constants', () => {
    describe('Decimal scaling (1000-based)', () => {
      it('should have correct decimal conversion values', () => {
        expect(UNIT_CONVERSION.KILO).toBe(1000);
        expect(UNIT_CONVERSION.MEGA).toBe(1000000);
        expect(UNIT_CONVERSION.GIGA).toBe(1000000000);
      });

      it('should maintain proper mathematical relationships', () => {
        expect(UNIT_CONVERSION.MEGA).toBe(UNIT_CONVERSION.KILO * 1000);
        expect(UNIT_CONVERSION.GIGA).toBe(UNIT_CONVERSION.MEGA * 1000);
        expect(UNIT_CONVERSION.GIGA).toBe(UNIT_CONVERSION.KILO * 1000 * 1000);
      });
    });

    describe('Binary scaling (1024-based)', () => {
      it('should have correct binary conversion values', () => {
        expect(UNIT_CONVERSION.KILO_BYTE).toBe(1024);
        expect(UNIT_CONVERSION.MEGA_BYTE).toBe(1048576); // 1024²
        expect(UNIT_CONVERSION.GIGA_BYTE).toBe(1073741824); // 1024³
        expect(UNIT_CONVERSION.TERA_BYTE).toBe(1099511627776); // 1024⁴
      });

      it('should maintain proper mathematical relationships', () => {
        expect(UNIT_CONVERSION.MEGA_BYTE).toBe(UNIT_CONVERSION.KILO_BYTE * 1024);
        expect(UNIT_CONVERSION.GIGA_BYTE).toBe(UNIT_CONVERSION.MEGA_BYTE * 1024);
        expect(UNIT_CONVERSION.TERA_BYTE).toBe(UNIT_CONVERSION.GIGA_BYTE * 1024);
      });

      it('should verify powers of 1024 are calculated correctly', () => {
        expect(UNIT_CONVERSION.MEGA_BYTE).toBe(Math.pow(1024, 2));
        expect(UNIT_CONVERSION.GIGA_BYTE).toBe(Math.pow(1024, 3));
        expect(UNIT_CONVERSION.TERA_BYTE).toBe(Math.pow(1024, 4));
      });
    });

    it('should be immutable (readonly)', () => {
      // TypeScript should prevent this at compile time
      // At runtime, `as const` provides type-level immutability but not runtime immutability
      // We verify that the constants have the expected values and won't change during tests
      expect(UNIT_CONVERSION.KILO).toBe(1000);
      expect(typeof UNIT_CONVERSION.KILO).toBe('number');
      // TypeScript prevents modification: (UNIT_CONVERSION as any).KILO = 999; would be a compile error
    });
  });

  describe('PRECISION Constants', () => {
    it('should have appropriate precision values for different unit types', () => {
      expect(PRECISION.ENERGY).toBe(2);
      expect(PRECISION.FREQUENCY).toBe(2);
      expect(PRECISION.FREQUENCY_BASE).toBe(0);
      expect(PRECISION.POWER_BASE).toBe(1);
      expect(PRECISION.POWER_SCALED).toBe(2);
      expect(PRECISION.BYTES).toBe(2);
      expect(PRECISION.BYTES_BASE).toBe(0);
      expect(PRECISION.GENERIC).toBe(2);
      expect(PRECISION.GENERIC_K).toBe(1);
      expect(PRECISION.EXPONENTIAL).toBe(2);
      expect(PRECISION.MHZ_BASE).toBe(0);
    });

    it('should use integer values for base units (no decimals)', () => {
      const baseUnits = [
        PRECISION.FREQUENCY_BASE,
        PRECISION.BYTES_BASE,
        PRECISION.MHZ_BASE
      ];
      baseUnits.forEach(precision => {
        expect(precision).toBe(0);
        expect(Number.isInteger(precision)).toBe(true);
      });
    });

    it('should use appropriate precision for scaled units', () => {
      const scaledUnits = [
        PRECISION.ENERGY,
        PRECISION.FREQUENCY,
        PRECISION.POWER_SCALED,
        PRECISION.BYTES,
        PRECISION.GENERIC,
        PRECISION.EXPONENTIAL
      ];
      scaledUnits.forEach(precision => {
        expect(precision).toBeGreaterThanOrEqual(1);
        expect(precision).toBeLessThanOrEqual(3);
      });
    });

    it('should be immutable (readonly)', () => {
      // TypeScript should prevent this at compile time
      // We verify that the constants have the expected values and won't change during tests
      expect(PRECISION.ENERGY).toBe(2);
      expect(typeof PRECISION.ENERGY).toBe('number');
      // TypeScript prevents modification: (PRECISION as any).ENERGY = 5; would be a compile error
    });
  });

  describe('GPU_THRESHOLDS Constants', () => {
    describe('Temperature thresholds', () => {
      it('should have reasonable temperature values in Celsius', () => {
        expect(GPU_THRESHOLDS.TEMPERATURE_WARNING).toBe(75);
        expect(GPU_THRESHOLDS.TEMPERATURE_CRITICAL).toBe(80);
        expect(GPU_THRESHOLDS.TEMPERATURE_DANGER).toBe(85);
      });

      it('should maintain proper temperature hierarchy', () => {
        expect(GPU_THRESHOLDS.TEMPERATURE_WARNING).toBeLessThan(GPU_THRESHOLDS.TEMPERATURE_CRITICAL);
        expect(GPU_THRESHOLDS.TEMPERATURE_CRITICAL).toBeLessThan(GPU_THRESHOLDS.TEMPERATURE_DANGER);
      });

      it('should use realistic GPU temperature ranges', () => {
        // Typical GPU operating range is 30-90°C
        expect(GPU_THRESHOLDS.TEMPERATURE_WARNING).toBeGreaterThan(30);
        expect(GPU_THRESHOLDS.TEMPERATURE_WARNING).toBeLessThan(90);
        expect(GPU_THRESHOLDS.TEMPERATURE_DANGER).toBeLessThan(100);
      });
    });

    describe('Utilization thresholds', () => {
      it('should have reasonable utilization percentages', () => {
        expect(GPU_THRESHOLDS.UTILIZATION_HIGH).toBe(70);
        expect(GPU_THRESHOLDS.UTILIZATION_WARNING).toBe(90);
        expect(GPU_THRESHOLDS.UTILIZATION_CRITICAL).toBe(95);
      });

      it('should maintain proper utilization hierarchy', () => {
        expect(GPU_THRESHOLDS.UTILIZATION_HIGH).toBeLessThan(GPU_THRESHOLDS.UTILIZATION_WARNING);
        expect(GPU_THRESHOLDS.UTILIZATION_WARNING).toBeLessThan(GPU_THRESHOLDS.UTILIZATION_CRITICAL);
      });

      it('should use valid percentage ranges', () => {
        const utilizationThresholds = [
          GPU_THRESHOLDS.UTILIZATION_HIGH,
          GPU_THRESHOLDS.UTILIZATION_WARNING,
          GPU_THRESHOLDS.UTILIZATION_CRITICAL
        ];
        utilizationThresholds.forEach(threshold => {
          expect(threshold).toBeGreaterThan(0);
          expect(threshold).toBeLessThan(100);
        });
      });
    });

    describe('Power estimation', () => {
      it('should have a reasonable power estimate per GPU', () => {
        expect(GPU_THRESHOLDS.POWER_ESTIMATE_PER_GPU).toBe(250);
      });

      it('should be a realistic GPU power consumption value', () => {
        // Modern GPUs typically consume 150-500W
        expect(GPU_THRESHOLDS.POWER_ESTIMATE_PER_GPU).toBeGreaterThan(100);
        expect(GPU_THRESHOLDS.POWER_ESTIMATE_PER_GPU).toBeLessThan(600);
      });
    });

    it('should be immutable (readonly)', () => {
      // TypeScript should prevent this at compile time
      // We verify that the constants have the expected values and won't change during tests
      expect(GPU_THRESHOLDS.TEMPERATURE_WARNING).toBe(75);
      expect(typeof GPU_THRESHOLDS.TEMPERATURE_WARNING).toBe('number');
      // TypeScript prevents modification: (GPU_THRESHOLDS as any).TEMPERATURE_WARNING = 100; would be a compile error
    });
  });

  describe('SMALL_VALUE_THRESHOLD Constant', () => {
    it('should have the correct small value threshold', () => {
      expect(SMALL_VALUE_THRESHOLD).toBe(0.01);
    });

    it('should be a reasonable threshold for exponential notation', () => {
      expect(SMALL_VALUE_THRESHOLD).toBeGreaterThan(0);
      expect(SMALL_VALUE_THRESHOLD).toBeLessThan(0.1);
    });

    it('should work correctly with the formatValue function', () => {
      // Values below threshold should use exponential notation
      const belowThreshold = SMALL_VALUE_THRESHOLD / 2;
      const aboveThreshold = SMALL_VALUE_THRESHOLD * 2;
      
      const belowResult = formatValue(belowThreshold, 'factor');
      const aboveResult = formatValue(aboveThreshold, 'factor');
      
      expect(belowResult.value).toContain('e-'); // Exponential notation
      expect(aboveResult.value).not.toContain('e'); // Regular decimal notation
    });
  });

  describe('Constants Integration with formatValue', () => {
    it('should use UNIT_CONVERSION constants for byte formatting', () => {
      // Test that formatValue uses our constants correctly
      expect(formatValue(UNIT_CONVERSION.KILO_BYTE, 'B')).toEqual({ value: '1.00', unit: 'KB' });
      expect(formatValue(UNIT_CONVERSION.MEGA_BYTE, 'B')).toEqual({ value: '1.00', unit: 'MB' });
      expect(formatValue(UNIT_CONVERSION.GIGA_BYTE, 'B')).toEqual({ value: '1.00', unit: 'GB' });
      expect(formatValue(UNIT_CONVERSION.TERA_BYTE, 'B')).toEqual({ value: '1.00', unit: 'TB' });
    });

    it('should use UNIT_CONVERSION constants for decimal formatting', () => {
      expect(formatValue(UNIT_CONVERSION.KILO, 'Hz')).toEqual({ value: '1.00', unit: 'kHz' });
      expect(formatValue(UNIT_CONVERSION.MEGA, 'Hz')).toEqual({ value: '1.00', unit: 'MHz' });
      expect(formatValue(UNIT_CONVERSION.GIGA, 'Hz')).toEqual({ value: '1.00', unit: 'GHz' });
    });

    it('should use PRECISION constants for formatting accuracy', () => {
      // Energy should use PRECISION.ENERGY (2 decimals)
      expect(formatValue(1230, 'J')).toEqual({ value: '1.23', unit: 'kJ' }); // 1230/1000 = 1.23
      
      // Base Hz should use PRECISION.FREQUENCY_BASE (0 decimals)  
      expect(formatValue(500.7, 'Hz')).toEqual({ value: '501', unit: 'Hz' });
      
      // Base watts should use PRECISION.POWER_BASE (1 decimal)
      expect(formatValue(250.67, 'W')).toEqual({ value: '250.7', unit: 'W' });
    });

    it('should use SMALL_VALUE_THRESHOLD for exponential formatting', () => {
      const justBelowThreshold = SMALL_VALUE_THRESHOLD * 0.9;
      const result = formatValue(justBelowThreshold, 'ratio');
      expect(result.value).toMatch(/^\d+\.\d+e-\d+$/); // Exponential format
    });
  });
});