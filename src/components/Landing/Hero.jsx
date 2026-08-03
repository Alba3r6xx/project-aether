'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';

export default function Hero() {
  return (
    <section className="bg-navy-950">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl">
            Monitor air quality and comfort in real time
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-400 sm:text-base">
            Track temperature, humidity, and air pollutants with precision. Make
            informed decisions about your indoor environment instantly.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg bg-sky-400 px-5 py-2.5 text-sm font-semibold text-navy-950 transition-transform hover:scale-[1.02] hover:bg-sky-300 focus-ring"
            >
              Dashboard
            </Link>
            <a
              href="#features"
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:text-white focus-ring"
            >
              Learn more
            </a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="overflow-hidden rounded-2xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <Image
            src="https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80"
            alt="Two colleagues reviewing indoor air quality data together in a bright office"
            width={1200}
            height={384}
            className="h-64 w-full object-cover sm:h-80 lg:h-96"
            priority
          />
        </motion.div>
      </div>
    </section>
  );
}
