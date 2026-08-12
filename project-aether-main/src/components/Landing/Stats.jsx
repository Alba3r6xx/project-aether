'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import Image from 'next/image';

function useCountUp(target, isNumeric) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!isNumeric) return;
    let frame;
    const start = performance.now();
    const duration = 1200;
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, isNumeric]);
  return value;
}

function StatBlock({ label, description, display, numeric, suffix }) {
  const count = useCountUp(numeric, numeric !== undefined);
  return (
    <div className="rounded-xl bg-slate-50 p-6">
      <p className="font-display text-3xl font-bold text-slate-900">
        {numeric !== undefined ? `${count}${suffix ?? ''}` : display}
      </p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{label}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  );
}

export default function Stats() {
  return (
    <section className="bg-white pb-16 sm:pb-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <h2 className="font-display text-2xl font-bold text-slate-900 sm:text-3xl">
          Thousands of devices protecting indoor air quality worldwide
        </h2>
        <p className="mt-2 max-w-lg text-sm text-slate-500">
          Users report improved air quality within weeks. Deployments span
          homes, offices, and public facilities. Real data drives change.
        </p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4 }}
          className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <StatBlock
            key="devices"
            numeric={50}
            suffix="K"
            label="Devices deployed globally"
            description="Monitoring air in homes and workplaces"
          />
          <div key="img-dashboard" className="col-span-2 row-span-2 overflow-hidden rounded-xl lg:col-span-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Image
              src="https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80"
              alt="Person monitoring air quality dashboard on a laptop"
              width={600}
              height={220}
              className="h-full min-h-[160px] w-full object-cover sm:min-h-[220px]"
              loading="lazy"
            />
          </div>
          <StatBlock
            key="monitoring"
            numeric={24}
            suffix="/7"
            label="Continuous monitoring"
            description="Real-time data never stops working"
          />
          <StatBlock
            key="improvement"
            numeric={92}
            suffix="%"
            label="Users report improvement"
            description="In air quality within first month"
          />
          <div className="overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Image
              src="https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=600&q=80"
              alt="Colleagues discussing workplace comfort improvements"
              width={600}
              height={140}
              className="h-full min-h-[120px] w-full object-cover sm:min-h-[140px]"
              loading="lazy"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
