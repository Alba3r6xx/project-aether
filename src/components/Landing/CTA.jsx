'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';

export default function CTA() {
  return (
    <section className="bg-white pb-16 sm:pb-24">
      <div className="mx-auto max-w-7xl px-5 text-center sm:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4 }}
          className="font-display text-2xl font-bold text-slate-900 sm:text-3xl"
        >
          See your air quality now
        </motion.h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Access the live dashboard or build your own ESP32 device today.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] focus-ring"
          >
            Dashboard
          </Link>
          <a
            href="#features"
            className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-ring"
          >
            Build
          </a>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-10 overflow-hidden rounded-2xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <Image
            src="https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1400&q=80"
            alt="Person relaxing comfortably in a well-monitored indoor space"
            width={1400}
            height={384}
            className="h-72 w-full object-cover sm:h-96"
            loading="lazy"
          />
        </motion.div>
      </div>
    </section>
  );
}
