'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';

const FEATURES = [
  {
    title: 'Comfort index calculation',
    description: 'Know exactly how your space feels right now.',
    image:
      'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=800&q=80',
    alt: 'Person checking a comfort index reading on a laptop',
    to: '/dashboard',
  },
  {
    title: 'Easy ESP32 setup',
    description: 'Connect and start monitoring in minutes.',
    image:
      'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=800&q=80',
    alt: 'ESP32 microcontroller being wired up on a desk',
    to: '/settings',
  },
  {
    title: 'Dashboard access',
    description: 'View all your data from anywhere anytime.',
    image:
      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80',
    alt: 'Team viewing a dashboard together on a laptop',
    to: '/dashboard',
  },
];

export default function Features() {
  return (
    <section id="features" className="bg-navy-950 pb-16 sm:pb-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">Sensing</p>
        <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
          Real-time air quality monitoring
        </h2>
        <p className="mt-2 max-w-lg text-sm text-slate-400">
          Measure pollutants, temperature, and humidity continuously.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="group overflow-hidden rounded-xl bg-navy-900"
            >
              <div className="overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <Image
                  src={feature.image}
                  alt={feature.alt}
                  width={800}
                  height={160}
                  className="h-40 w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />
              </div>
              <div className="p-5">
                <h3 className="font-display text-base font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  {feature.description}
                </p>
                <Link
                  href={feature.to}
                  className="mt-3 inline-flex items-center text-xs font-medium text-sky-400 hover:text-sky-300 focus-ring rounded"
                >
                  Learn &rsaquo;
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
