import dynamic from 'next/dynamic';
import Navbar from '../../components/Navbar/Navbar';
import { fetchMetricSeriesServer, fetchNodesServer } from '../../services/historyServiceServer';

// Code splitting: ChartCard is SVG-heavy, load it lazily to reduce initial bundle
const ChartCard = dynamic(() => import('../../components/ChartCard/ChartCard'), {
  loading: () => (
    <div className="h-[280px] animate-pulse rounded-2xl border border-white/5 bg-navy-900" />
  ),
});

const CHARTS = [
  {
    key: 'temperature',
    title: 'Analytics - Temperature',
    subtitle: 'Monitor environmental readings over time',
    unit: '\u00b0C',
    color: 'var(--color-accent-green)',
    summary: 'Temperature summary over the past 24 hours.',
  },
  {
    key: 'humidity',
    title: 'Analytics - Humidity',
    subtitle: 'Relative humidity',
    unit: '%',
    color: 'var(--color-accent-blue)',
    summary: 'Humidity summary over the past 24 hours.',
  },
  {
    key: 'airQuality',
    title: 'Analytics - Air Quality',
    subtitle: 'CO\u2082 concentration',
    unit: ' ppm',
    color: 'var(--color-accent-orange)',
    summary: 'Air quality summary over the past 24 hours.',
  },
  {
    key: 'luminosity',
    title: 'Analytics - Luminosity',
    subtitle: 'Raw LDR reading',
    unit: ' ADC',
    color: 'var(--color-accent-yellow)',
    summary: 'Luminosity summary over the past 24 hours.',
  },
];

/**
 * Analytics page. Server Component - fetches each metric's time series
 * from Supabase (sensor_readings) on the server, then composes ChartCard
 * (a Client Component) with the real data. Recharts hydrates on the
 * client where it can measure container size.
 *
 * NO MOCK DATA: series come from fetchMetricSeriesServer. With no Supabase
 * configured, each series is an empty array and the charts render blank.
 */
export default async function AnalyticsPage() {
  // AUDIT H17: wrap server fetches in try/catch so a Supabase failure
  // renders an error state instead of crashing the page.
  let seriesMap = {};
  let nodes = [];
  let fetchError = false;

  try {
    const [seriesByMetric, nodeList] = await Promise.all([
      Promise.all(
        CHARTS.map((chart) =>
          fetchMetricSeriesServer(chart.key, { rangeHours: 24 }).then((s) => [chart.key, s])
        )
      ),
      fetchNodesServer(),
    ]);
    seriesMap = Object.fromEntries(seriesByMetric);
    nodes = nodeList;
  } catch (err) {
    console.error('Analytics page: failed to fetch series:', err);
    fetchError = true;
  }

  // Label the page with the nodes actually reporting rather than a hardcoded
  // node name, which was wrong for every deployment but the original demo.
  const nodeLabel = nodes.length === 1
    ? nodes[0].name
    : nodes.length > 1
      ? `${nodes.length} sensor nodes`
      : 'No nodes reporting';

  if (fetchError) {
    return (
      <div className="min-h-screen bg-navy-950">
        <Navbar tone="dark" />
        <main id="main-content" className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">Analytics</h1>
          <div className="mt-6 rounded-xl border border-rose-500/20 bg-rose-500/5 p-8 text-center">
            <p className="text-sm text-rose-300">Failed to load analytics data.</p>
            <p className="mt-1 text-xs text-slate-400">Please check your connection and try again.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-950">
      <Navbar tone="dark" />
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 pb-20 sm:px-8 sm:py-8 lg:pb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{nodeLabel}</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-white sm:text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-slate-400">
          Deep dive into each metric&apos;s trend across the past 24 hours.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-6 sm:gap-5 lg:grid-cols-2">
          {CHARTS.map((chart) => (
            <ChartCard
              key={chart.key}
              title={chart.title}
              subtitle={chart.subtitle}
              data={seriesMap[chart.key] ?? []}
              unit={chart.unit}
              color={chart.color}
              summary={chart.summary}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
