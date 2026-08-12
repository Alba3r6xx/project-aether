'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  RefreshCw, Activity, Thermometer, Droplets, Wind, AlertOctagon,
  Cpu, TrendingUp,
} from 'lucide-react';
import Navbar from '../../components/Navbar/Navbar';
import SensorCard from '../../components/SensorCard/SensorCard';
import AlertsPanel from '../../components/AlertsPanel/AlertsPanel';
import DataTable from '../../components/DataTable/DataTable';
import StatCard from '../../components/StatCard/StatCard';
import ConnectionBadge from '../../components/ConnectionBadge/ConnectionBadge';
import { SensorCardSkeleton } from '../../components/common/Skeleton';
import { useSensorNodes } from '../../hooks/useSensorNodes';
import { fetchAlerts, fetchLatestReading, fetchMetricSeries, subscribeToAlerts } from '../../services/historyService';
import { COMFORT_LEVELS } from '../../data/constants';

const METRIC_KEYS = ['temperature', 'humidity', 'airQuality', 'luminosity'];

/**
 * Enterprise sensor monitoring dashboard.
 *
 * Layout:
 *   1. KPI bar (active nodes, avg temp, avg humidity, active alerts)
 *   2. Sensor node grid (live cards with gauges)
 *   3. Bottom row: metric trends (sparklines) + active alerts feed
 */
export default function Dashboard({ initialAlerts = [], initialLatestRow = null, initialSeries = {} }) {
  const { nodes, isLoading, isRefreshing, lastRefreshed, refresh, mode, connectionStatus } =
    useSensorNodes();
  const [alerts, setAlerts] = useState(initialAlerts);
  const [latestRow, setLatestRow] = useState(initialLatestRow);
  const [series, setSeries] = useState(initialSeries);

  useEffect(() => {
    if (initialAlerts.length) return;
    fetchAlerts().then(setAlerts).catch((err) => console.error('[Dashboard] Failed to fetch alerts:', err));
  }, [initialAlerts]);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAlerts((newAlert) => {
      setAlerts((prev) => [newAlert, ...prev].slice(0, 8));
    }).then((fn) => { unsubscribe = fn; });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (initialLatestRow) return;
    fetchLatestReading().then(setLatestRow).catch((err) => console.error('[Dashboard] Failed to fetch latest reading:', err));
  }, [initialLatestRow]);

  useEffect(() => {
    if (Object.keys(initialSeries).length) return;
    Promise.all(
      METRIC_KEYS.map((key) => fetchMetricSeries(key, { rangeHours: 12 }).then((s) => [key, s]))
    )
      .then((entries) => setSeries(Object.fromEntries(entries)))
      .catch((err) => console.error('[Dashboard] Failed to fetch metric series:', err));
  }, [initialSeries]);

  // Compute KPI values from live node data
  const kpis = useMemo(() => {
    const activeNodes = nodes.filter((n) => n.status === 'live').length;
    const nodesWithTemp = nodes.filter((n) => n.temperature !== null && n.temperature !== undefined);
    const nodesWithHum = nodes.filter((n) => n.humidity !== null && n.humidity !== undefined);
    const nodesWithAq = nodes.filter((n) => n.airQuality !== null && n.airQuality !== undefined);

    const avgTemp = nodesWithTemp.length
      ? (nodesWithTemp.reduce((sum, n) => sum + n.temperature, 0) / nodesWithTemp.length).toFixed(1)
      : null;
    const avgHum = nodesWithHum.length
      ? Math.round(nodesWithHum.reduce((sum, n) => sum + n.humidity, 0) / nodesWithHum.length)
      : null;
    const avgAq = nodesWithAq.length
      ? Math.round(nodesWithAq.reduce((sum, n) => sum + n.airQuality, 0) / nodesWithAq.length)
      : null;

    // Overall comfort: worst case across all nodes
    const comfortLevels = nodes.map((n) => n.comfort).filter(Boolean);
    const overallComfort = comfortLevels.includes('HAZARD') ? 'HAZARD'
      : comfortLevels.includes('POOR') ? 'POOR'
      : comfortLevels.includes('FAIR') ? 'FAIR'
      : comfortLevels.includes('GOOD') ? 'GOOD'
      : null;

    return { activeNodes, totalNodes: nodes.length, avgTemp, avgHum, avgAq, overallComfort, alertCount: alerts.length };
  }, [nodes, alerts]);

  const lastRefreshedLabel = lastRefreshed
    ? lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '--';

  const comfortInfo = kpis.overallComfort ? COMFORT_LEVELS[kpis.overallComfort] : null;

  return (
    <div className="min-h-screen bg-navy-950">
      <Navbar tone="dark" />

      <main id="main-content" className="mx-auto max-w-[1400px] px-4 py-5 pb-20 sm:px-6 lg:px-8 lg:py-7 lg:pb-7">
        {/* Page header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-lg font-bold text-white sm:text-xl">Monitoring Dashboard</h1>
              <ConnectionBadge status={connectionStatus} mode={mode} />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {kpis.totalNodes > 0
                ? `${kpis.activeNodes} of ${kpis.totalNodes} nodes active`
                : 'No nodes registered'}
              {comfortInfo && ` \u00b7 Overall: ${comfortInfo.label}`}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh sensor data"
            className="flex min-h-[44px] items-center gap-2 rounded-lg border border-white/[0.08] px-4 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-white/15 hover:text-white focus-ring"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Updated {lastRefreshedLabel}</span>
            <span className="sm:hidden">Refresh</span>
          </button>
        </div>

        {/* KPI bar */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
          <StatCard
            icon={Cpu}
            label="Active Nodes"
            value={kpis.activeNodes}
            unit={`/ ${kpis.totalNodes}`}
            accent="blue"
            delay={0}
          />
          <StatCard
            icon={Thermometer}
            label="Avg Temperature"
            value={kpis.avgTemp ?? '--'}
            unit={kpis.avgTemp ? '\u00b0C' : ''}
            accent="green"
            delay={0.05}
          />
          <StatCard
            icon={Droplets}
            label="Avg Humidity"
            value={kpis.avgHum ?? '--'}
            unit={kpis.avgHum ? '%' : ''}
            accent="cyan"
            delay={0.1}
          />
          <StatCard
            icon={AlertOctagon}
            label="Active Alerts"
            value={kpis.alertCount}
            accent={kpis.alertCount > 0 ? 'red' : 'purple'}
            delay={0.15}
          />
        </div>

        {/* Sensor node grid */}
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <Activity size={14} className="text-slate-500" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sensor Nodes</h2>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 lg:gap-5">
              {Array.from({ length: 3 }).map((_, i) => <SensorCardSkeleton key={i} />)}
            </div>
          ) : nodes.length > 0 ? (
            <motion.div
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 lg:gap-5"
            >
              {nodes.map((node) => (
                <SensorCard
                  key={node.id}
                  node={node}
                  onRefresh={refresh}
                  isRefreshing={isRefreshing}
                />
              ))}
            </motion.div>
          ) : (
            <div className="grid-pattern flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-navy-900 py-16 text-center">
              <Cpu size={32} className="text-slate-700" />
              <p className="mt-3 text-sm font-medium text-slate-400">No sensor nodes reporting</p>
              <p className="mt-1 max-w-sm text-xs text-slate-600">
                Connect an ESP32 to HiveMQ and claim it in Settings to start receiving live data.
              </p>
            </div>
          )}
        </div>

        {/* Bottom row: trends + alerts */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
          <div className="lg:col-span-2">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp size={14} className="text-slate-500" />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Metric Trends</h2>
            </div>
            <DataTable variant="mini" rows={latestRow ? [latestRow] : []} series={series} />
          </div>
          <div className="lg:col-span-1" aria-live="polite" aria-atomic="false">
            <div className="mb-3 flex items-center gap-2">
              <AlertOctagon size={14} className="text-slate-500" />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Alerts</h2>
            </div>
            <AlertsPanel alerts={alerts} />
          </div>
        </div>
      </main>
    </div>
  );
}
