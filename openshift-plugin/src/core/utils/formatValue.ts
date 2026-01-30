/**
 * Enhanced formatValue function with unit-aware formatting
 * Handles automatic unit scaling for common metric types
 */

// Unit conversion constants
export const UNIT_CONVERSION = {
  // Decimal scaling (1000-based) - for Hz, W, J
  KILO: 1000,
  MEGA: 1000000,
  GIGA: 1000000000,
  
  // Binary scaling (1024-based) - for bytes, displayed as KB/MB/GB
  KILO_BYTE: 1024,
  MEGA_BYTE: 1048576,    // 1024²
  GIGA_BYTE: 1073741824, // 1024³
  TERA_BYTE: 1099511627776, // 1024⁴
} as const;

// Precision constants for different unit types
export const PRECISION = {
  ENERGY: 2,        // Joules, kJ, MJ, GJ
  FREQUENCY: 2,     // Hz → GHz conversions
  FREQUENCY_BASE: 0, // Base Hz (no decimals)
  POWER_BASE: 1,    // Base watts
  POWER_SCALED: 2,  // kW, MW
  BYTES: 2,         // All byte conversions
  BYTES_BASE: 0,    // Base bytes (no decimals)
  GENERIC: 2,       // Generic decimal precision
  GENERIC_K: 1,     // K formatting
  EXPONENTIAL: 2,   // Scientific notation
  MHZ_BASE: 0,      // Base MHz (no decimals)
} as const;

// Small value threshold for exponential notation
export const SMALL_VALUE_THRESHOLD = 0.01;

// GPU health monitoring thresholds
export const GPU_THRESHOLDS = {
  TEMPERATURE_WARNING: 75,  // °C
  TEMPERATURE_CRITICAL: 80, // °C
  TEMPERATURE_DANGER: 85,   // °C
  UTILIZATION_HIGH: 70,     // %
  UTILIZATION_WARNING: 90,  // %
  UTILIZATION_CRITICAL: 95, // %
  POWER_ESTIMATE_PER_GPU: 250, // Watts (for GPU count estimation)
} as const;

export interface FormattedValue {
  value: string;
  unit: string;
}

/**
 * Format a numeric value with intelligent unit scaling
 * 
 * @param val - The numeric value to format (can be null)
 * @param unitType - The base unit type (e.g., 'J', 'W', 'Hz', 'MHz', 'B', '%')
 * @returns An object with formatted value and scaled unit
 * 
 * @example
 * formatValue(1500000, 'J') // { value: '1.50', unit: 'MJ' }
 * formatValue(2500, 'MHz')  // { value: '2.50', unit: 'GHz' }
 * formatValue(1200, 'W')    // { value: '1.20', unit: 'kW' }
 */
export const formatValue = (val: number | null, unitType?: string): FormattedValue => {
  if (val === null || val === undefined || isNaN(val)) {
    return { value: '—', unit: unitType || '' };
  }

  // Handle energy units: Joules → kJ → MJ → GJ
  if (unitType === 'J') {
    if (val >= UNIT_CONVERSION.GIGA) return { value: (val / UNIT_CONVERSION.GIGA).toFixed(PRECISION.ENERGY), unit: 'GJ' };
    if (val >= UNIT_CONVERSION.MEGA) return { value: (val / UNIT_CONVERSION.MEGA).toFixed(PRECISION.ENERGY), unit: 'MJ' };
    if (val >= UNIT_CONVERSION.KILO) return { value: (val / UNIT_CONVERSION.KILO).toFixed(PRECISION.ENERGY), unit: 'kJ' };
    return { value: val.toFixed(PRECISION.ENERGY), unit: 'J' };
  }

  // Handle frequency units: Hz → kHz → MHz → GHz
  if (unitType === 'Hz') {
    if (val >= UNIT_CONVERSION.GIGA) return { value: (val / UNIT_CONVERSION.GIGA).toFixed(PRECISION.FREQUENCY), unit: 'GHz' };
    if (val >= UNIT_CONVERSION.MEGA) return { value: (val / UNIT_CONVERSION.MEGA).toFixed(PRECISION.FREQUENCY), unit: 'MHz' };
    if (val >= UNIT_CONVERSION.KILO) return { value: (val / UNIT_CONVERSION.KILO).toFixed(PRECISION.FREQUENCY), unit: 'kHz' };
    return { value: val.toFixed(PRECISION.FREQUENCY_BASE), unit: 'Hz' };
  }

  // Handle MHz → GHz conversion
  if (unitType === 'MHz') {
    if (val >= UNIT_CONVERSION.KILO) return { value: (val / UNIT_CONVERSION.KILO).toFixed(PRECISION.FREQUENCY), unit: 'GHz' };
    return { value: val.toFixed(PRECISION.MHZ_BASE), unit: 'MHz' };
  }

  // Handle power units: W → kW → MW
  if (unitType === 'W') {
    if (val >= UNIT_CONVERSION.MEGA) return { value: (val / UNIT_CONVERSION.MEGA).toFixed(PRECISION.POWER_SCALED), unit: 'MW' };
    if (val >= UNIT_CONVERSION.KILO) return { value: (val / UNIT_CONVERSION.KILO).toFixed(PRECISION.POWER_SCALED), unit: 'kW' };
    return { value: val.toFixed(PRECISION.POWER_BASE), unit: 'W' };
  }

  // Handle bytes: B → KB → MB → GB → TB (binary scaling)
  if (unitType === 'B') {
    if (val >= UNIT_CONVERSION.TERA_BYTE) return { value: (val / UNIT_CONVERSION.TERA_BYTE).toFixed(PRECISION.BYTES), unit: 'TB' };
    if (val >= UNIT_CONVERSION.GIGA_BYTE) return { value: (val / UNIT_CONVERSION.GIGA_BYTE).toFixed(PRECISION.BYTES), unit: 'GB' };
    if (val >= UNIT_CONVERSION.MEGA_BYTE) return { value: (val / UNIT_CONVERSION.MEGA_BYTE).toFixed(PRECISION.BYTES), unit: 'MB' };
    if (val >= UNIT_CONVERSION.KILO_BYTE) return { value: (val / UNIT_CONVERSION.KILO_BYTE).toFixed(PRECISION.BYTES), unit: 'KB' };
    return { value: val.toFixed(PRECISION.BYTES_BASE), unit: 'B' };
  }

  // Generic number formatting for other units (%, cores, /s, etc.)
  let formattedValue: string;
  if (val >= UNIT_CONVERSION.GIGA) formattedValue = `${(val / UNIT_CONVERSION.GIGA).toFixed(PRECISION.GENERIC)}B`;
  else if (val >= UNIT_CONVERSION.MEGA) formattedValue = `${(val / UNIT_CONVERSION.MEGA).toFixed(PRECISION.GENERIC)}M`;
  else if (val >= UNIT_CONVERSION.KILO) formattedValue = `${(val / UNIT_CONVERSION.KILO).toFixed(PRECISION.GENERIC_K)}K`;
  else if (val < SMALL_VALUE_THRESHOLD && val > 0) formattedValue = val.toExponential(PRECISION.EXPONENTIAL);
  else if (Number.isInteger(val)) formattedValue = val.toString();
  else formattedValue = val.toFixed(PRECISION.GENERIC);

  return { value: formattedValue, unit: unitType || '' };
};

/**
 * Format a value with its unit as a single string
 * 
 * @param val - The numeric value to format
 * @param unitType - The base unit type
 * @returns A formatted string like "1.50MJ" or "45%"
 */
export const formatValueWithUnit = (val: number | null, unitType?: string): string => {
  const { value, unit } = formatValue(val, unitType);
  return unit ? `${value}${unit}` : value;
};
