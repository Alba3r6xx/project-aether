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
// Matches the firmware's airStatusFor() exactly: CO2 ppm only.
//   GOOD     <= 1000 ppm       Air is fresh
//   FAIR     1001-2000 ppm     Acceptable, monitor
//   POOR     2001-5000 ppm     Poor ventilation, drowsiness
//   HAZARD   > 5000 ppm        OSHA exposure limit exceeded
export const COMFORT_LEVELS = {
  GOOD: {
    key: 'GOOD',
    label: 'Good',
    message: 'Air quality is fresh, CO2 levels are within a healthy range.',
    color: 'var(--color-accent-green)',
    bg: 'from-emerald-900/60 to-emerald-800/40',
    ring: 'ring-emerald-400/30',
  },
  FAIR: {
    key: 'FAIR',
    label: 'Fair',
    message: 'CO2 levels are acceptable but rising, consider ventilating.',
    color: 'var(--color-accent-yellow)',
    bg: 'from-amber-900/60 to-amber-800/40',
    ring: 'ring-amber-400/30',
  },
  POOR: {
    key: 'POOR',
    label: 'Poor',
    message: 'CO2 levels indicate poor ventilation, open a window or ventilate.',
    color: 'var(--color-accent-red)',
    bg: 'from-rose-900/60 to-rose-800/40',
    ring: 'ring-rose-400/30',
  },
  HAZARD: {
    key: 'HAZARD',
    label: 'Hazard',
    message: 'CO2 levels exceed safe exposure limits, ventilate immediately.',
    color: 'var(--color-accent-red)',
    bg: 'from-red-900/70 to-red-800/50',
    ring: 'ring-red-500/40',
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
 * Classifies comfort status from CO2 ppm, matching the firmware's
 * airStatusFor() exactly:
 *
 *   Status   CO2 ppm          Meaning
 *   GOOD     <= 1000          Fresh air
 *   FAIR     1001 – 2000      Acceptable, monitor
 *   POOR     2001 – 5000      Poor ventilation, drowsiness
 *   HAZARD   > 5000           OSHA exposure limit exceeded
 *
 * @param {number} airQuality  - CO2 ppm (400-50000)
 * @returns {{key,label,message,color,bg,ring}}  - a COMFORT_LEVELS entry
 */
export function getComfortLevel(airQuality) {
  if (airQuality > 5000) return COMFORT_LEVELS.HAZARD;
  if (airQuality > 2000) return COMFORT_LEVELS.POOR;
  if (airQuality > 1000) return COMFORT_LEVELS.FAIR;
  return COMFORT_LEVELS.GOOD;
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
  const level = getComfortLevel(airQuality);
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
