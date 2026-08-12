'use client';

import { Download } from 'lucide-react';
import Navbar from '../../components/Navbar/Navbar';
import Sidebar from '../../components/Sidebar/Sidebar';
import DataTable from '../../components/DataTable/DataTable';
import ChartCard from '../../components/ChartCard/ChartCard';

/**
 * History page (client). Receives server-fetched `rows` (daily history
 * table) and `comfortSeries` (comfort index trend) as props for the SSR
 * first paint, owns the CSV export interaction (which needs the browser
 * Blob/URL APIs).
 *
 * NO MOCK DATA: both `rows` and `comfortSeries` come from Supabase. With
 * no Supabase configured they're empty and the page renders empty states.
 */
export default function HistoryClient({ rows, comfortSeries }) {
  function handleExport() {
    const header = 'date,temperature,humidity,airQuality,luminosity,comfortIndex\n';
    const body = rows
      .map(
        (r) =>
          `${r.date},${r.temperature ?? ''},${r.humidity ?? ''},${r.airQuality ?? ''},${r.luminosity ?? ''},${r.comfortIndex ?? ''}`
      )
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project-aether-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-navy-950">
      <Navbar tone="dark" />
      <div className="mx-auto flex max-w-7xl">
        <Sidebar active="/history" />
        <main id="main-content" className="min-w-0 flex-1 px-4 py-6 pb-20 sm:px-8 sm:py-8 lg:pb-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Records</p>
              <h1 className="mt-1 font-display text-2xl font-bold text-white sm:text-3xl">
                Historical Sensor Readings
              </h1>
            </div>
            <button
              type="button"
              onClick={handleExport}
              disabled={rows.length === 0}
              className="flex items-center gap-2 rounded-lg bg-sky-400 px-3.5 py-2 text-xs font-semibold text-navy-950 transition-colors hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
            >
              <Download size={13} />
              Export CSV
            </button>
          </div>

          <div className="mt-6">
            <ChartCard
              title="Comfort Index Trend"
              subtitle="Living Room - Floor 1"
              data={comfortSeries}
              unit=""
              color="var(--color-accent-blue)"
              summary="Comfort index blends temperature, humidity, and air quality into a single score."
            />
          </div>

          <div className="mt-6">
            <DataTable rows={rows} variant="full" />
          </div>
        </main>
      </div>
    </div>
  );
}
