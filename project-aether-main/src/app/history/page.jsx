import HistoryClient from './HistoryClient';
import Navbar from '../../components/Navbar/Navbar';
import {
  fetchDailyHistoryServer,
  fetchMetricSeriesServer,
} from '../../services/historyServiceServer';

/**
 * History page (Server Component). Pre-fetches the daily history rows and
 * the comfort-index trend series on the server so the table and chart
 * render with real data in the initial HTML, then hands them to the client
 * HistoryClient which owns the CSV export interaction.
 *
 * Returns empty arrays when Supabase isn't configured, so SSR renders
 * empty states instead of 500ing.
 */
export default async function HistoryPage() {
  // AUDIT H17: wrap server fetches in try/catch to prevent page crash.
  let rows = [];
  let comfortSeries = [];
  let fetchError = false;

  try {
    [rows, comfortSeries] = await Promise.all([
      fetchDailyHistoryServer(),
      fetchMetricSeriesServer('comfortIndex', { rangeHours: 24 }),
    ]);
  } catch (err) {
    console.error('History page: failed to fetch data:', err);
    fetchError = true;
  }

  if (fetchError) {
    return (
      <div className="min-h-screen bg-navy-950">
        <Navbar tone="dark" />
        <main id="main-content" className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">History</h1>
          <div className="mt-6 rounded-xl border border-rose-500/20 bg-rose-500/5 p-8 text-center">
            <p className="text-sm text-rose-300">Failed to load history data.</p>
            <p className="mt-1 text-xs text-slate-400">Please check your connection and try again.</p>
          </div>
        </main>
      </div>
    );
  }

  return <HistoryClient rows={rows} comfortSeries={comfortSeries} />;
}
