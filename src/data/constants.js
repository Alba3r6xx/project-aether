/**
 * Static configuration constants for the Aether dashboard.
 *
 * These are NOT mock data - they're the canonical definitions of comfort
 * levels, metric metadata, and the comfort-index formula, used by gauges,
 * cards, and the comfort banner regardless of where the readings come
 * from. Pulled out of the former mockSensorData.js when mock data was
 * removed.
 */

// Comfort status thresholds, shared by gauges, cards and the comfort banner.
export const COMFORT_LEVELS = {
  OPTIMAL: {
    key: 'OPTIMAL',
    label: 'Optimal',
    message: 'All parameters within ideal range, environment is comfortable.',
    color: 'var(--color-accent-green)',
    bg: 'from-emerald-900/60 to-emerald-800/40',
    ring: 'ring-emerald-400/30',
  },
  FAIR: {
    key: 'FAIR',
    label: 'Fair',
    message: 'All parameters within an okay range, environment is fairly comfortable.',
    color: 'var(--color-accent-yellow)',
    bg: 'from-amber-900/60 to-amber-800/40',
    ring: 'ring-amber-400/30',
  },
  POOR: {
    key: 'POOR',
    label: 'Poor',
    message: 'Some parameters are outside the ideal range, improvements need to be made.',
    color: 'var(--color-accent-red)',
    bg: 'from-rose-900/60 to-rose-800/40',
    ring: 'ring-rose-400/30',
  },
};

// Metric metadata: units, icon keys (lucide-react names) and gauge ranges.
export const METRIC_CONFIG = {
  temperature: {
    label: 'Temperature',
    unit: '\u00b0C',
    icon: 'Thermometer',
    color: 'var(--color-accent-green)',
    min: 0,
    max: 50,
  },
  humidity: {
    label: 'Humidity',
    unit: '%',
    icon: 'Droplets',
    color: 'var(--color-accent-blue)',
    min: 0,
    max: 100,
  },
  airQuality: {
    label: 'Air Quality',
    unit: 'AQI',
    icon: 'Wind',
    color: 'var(--color-accent-orange)',
    min: 0,
    max: 100,
  },
  luminosity: {
    label: 'Luminosity',
    unit: 'LUX',
    icon: 'Sun',
    color: 'var(--color-accent-yellow)',
    min: 0,
    max: 3000,
  },
};

// ---------------------------------------------------------------------------
// Comfort Index — aligned with the ESP32 firmware (PDF §5.0)
//
// The firmware computes the Comfort Index in three stages:
//   Stage 1: Steadman Heat Index via Adafruit DHT's computeHeatIndex()
//   Stage 2: Air quality percentage (0-100, already in the payload)
//   Stage 3: Status classification using heat index + AQ thresholds
//
// The functions below replicate that exact logic so the dashboard and the
// server-side Edge Function (ingest-mqtt) produce the same results as the
// firmware. This closes gap G11 from the roadmap.
// ---------------------------------------------------------------------------

const cToF = (c) => c * 1.8 + 32;
const fToC = (f) => (f - 32) * 0.55555;

/**
 * Computes the Steadman Heat Index in Celsius, matching the Adafruit DHT
 * library's `computeHeatIndex(temp, humidity, false)` implementation.
 *
 * Source: NWS heat index equation
 *   http://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
 *
 * @param {number} tempC       - temperature in Celsius
 * @param {number} humidity    - relative humidity (0-100)
 * @returns {number}           - heat index in Celsius
 */
export function computeHeatIndex(tempC, humidity) {
  const tempF = cToF(tempC);
  const h = Math.max(0, Math.min(100, humidity));

  let hiF;
  if (tempF <= 80) {
    // Simple formula for cooler temperatures
    hiF = 0.5 * (tempF + 61.0 + ((tempF - 68.0) * 1.2) + (h * 0.094));
  } else {
    // Rothfusz regression
    hiF =
      -42.379 +
      2.04901523 * tempF +
      10.14333127 * h -
      0.22475541 * tempF * h -
      0.00683783 * tempF * tempF -
      0.05481717 * h * h +
      0.00122874 * tempF * tempF * h +
      0.00085282 * tempF * h * h -
      0.00000199 * tempF * tempF * h * h;

    // Low-humidity adjustment
    if (h < 13 && tempF >= 80 && tempF <= 112) {
      hiF -= ((13 - h) / 4) * Math.sqrt((17 - Math.abs(tempF - 95)) / 17);
    }
    // High-humidity adjustment
    else if (h > 85 && tempF >= 80 && tempF <= 87) {
      hiF += ((h - 85) / 10) * ((87 - tempF) / 5);
    }
  }

  return fToC(hiF);
}

/**
 * Classifies comfort status using the §5.0 thresholds:
 *
 *   Status   Heat Index (°C)   Air Quality (%)   Meaning
 *   OPTIMAL  20 – 26           < 30              Ideal conditions
 *   FAIR     26 – 29           30 – 60           Acceptable — monitor
 *   POOR     > 29 or < 18      > 60              Uncomfortable / unsafe
 *
 * Classification is worst-case: if EITHER metric falls into POOR, the
 * status is POOR. If either falls into FAIR (but neither is POOR), it's
 * FAIR. Only when both are OPTIMAL is the status OPTIMAL.
 *
 * @param {number} heatIndexC   - Steadman heat index in Celsius
 * @param {number} airQuality   - air quality percentage (0-100)
 * @returns {{key,label,message,color,bg,ring}}  - a COMFORT_LEVELS entry
 */
export function getComfortLevel(heatIndexC, airQuality) {
  // Stage 3: POOR if either metric is in the POOR band
  if (heatIndexC > 29 || heatIndexC < 18 || airQuality > 60) {
    return COMFORT_LEVELS.POOR;
  }
  // OPTIMAL only if both metrics are in the OPTIMAL band
  if (heatIndexC >= 20 && heatIndexC <= 26 && airQuality < 30) {
    return COMFORT_LEVELS.OPTIMAL;
  }
  // Everything else is FAIR (18-20, 26-29, or AQ 30-60)
  return COMFORT_LEVELS.FAIR;
}

/**
 * Convenience: takes a raw reading and returns both the heat index and the
 * comfort level. Used by the Edge Function and any client-side code that
 * needs to recompute comfort from raw temp/humidity/AQ values.
 *
 * @param {{temperature:number, humidity:number, airQuality:number}} reading
 * @returns {{heatIndex:number, comfortStatus:string, level:object}}
 */
export function evaluateComfort({ temperature, humidity, airQuality }) {
  const heatIndex = computeHeatIndex(temperature, humidity);
  const level = getComfortLevel(heatIndex, airQuality);
  return {
    heatIndex: Math.round(heatIndex * 10) / 10,
    comfortStatus: level.key,
    level,
  };
}

export const DEVICE_STATS = {
  devicesDeployed: '50K',
  usersImproved: '92%',
  monitoring: '24/7',
};
