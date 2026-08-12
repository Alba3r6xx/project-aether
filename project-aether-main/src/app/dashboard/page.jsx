import { Suspense } from 'react';
import DashboardClient from './DashboardClient';
import {
  fetchAlertsServer,
  fetchLatestReadingServer,
  fetchMetricSeriesServer,
} from '../../services/historyServiceServer';

const METRIC_KEYS = ['temperature', 'humidity', 'airQuality', 'luminosity'];

/**
 * Server Component wrapper for the Dashboard. Pre-fetches the static
 * parts (alerts feed, latest reading row, and per-metric sparkline series)
 * on the server so the first paint isn't empty, then hands them to the
 * client DashboardClient which owns the live MQTT subscription and
 * hydration.
 *
 * Returns empty arrays / null when Supabase isn't configured, so SSR
 * renders honest empty states instead of 500ing.
 */
export default async function DashboardPage() {
  // AUDIT H17: wrap server fetches in try/catch so a Supabase failure
  // doesn't crash the page — fall back to empty states.
  let initialAlerts = [];
  let initialLatestRow = null;
  let initialSeries = {};

  try {
    const [alerts, latestRow, seriesEntries] = await Promise.all([
      fetchAlertsServer(),
      fetchLatestReadingServer(),
      Promise.all(
        METRIC_KEYS.map((key) => fetchMetricSeriesServer(key, { rangeHours: 12 }).then((s) => [key, s]))
      ),
    ]);
    initialAlerts = alerts;
    initialLatestRow = latestRow;
    initialSeries = Object.fromEntries(seriesEntries);
  } catch (err) {
    console.error('Dashboard page: failed to fetch initial data:', err);
  }

  return (
    <Suspense fallback={null}>
      <DashboardClient
        initialAlerts={initialAlerts}
        initialLatestRow={initialLatestRow}
        initialSeries={initialSeries}
      />
    </Suspense>
  );
}
