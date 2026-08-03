'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { Home, Users2, Monitor, ChevronRight } from 'lucide-react';

const BENEFITS = [
  {
    icon: Home,
    title: 'Healthier homes',
    description: 'Breathe easier knowing your air meets healthy standards daily.',
    linkLabel: 'Discover',
    to: '/dashboard',
  },
  {
    icon: Users2,
    title: 'Smarter offices',
    description: 'Optimise workspace conditions for productivity and employee wellbeing.',
    linkLabel: 'Explore',
    to: '/analytics',
  },
  {
    icon: Monitor,
    title: 'Better spaces',
    description: 'Monitor public areas to maintain safe comfortable environments.',
    linkLabel: 'Learn',
    to: '/history',
  },
];

export default function Benefits() {
  return (
    <section id="benefits" className="bg-white py-16 sm:py-24">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-7">
          {BENEFITS.map((b, i) => {
            const Icon = b.icon;
            return (
              <motion.div
                key={b.title}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.35, delay: i * 0.08 }}
                className="flex gap-4"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900/5 text-slate-700">
                  <Icon size={18} />
                </span>
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    {b.title}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">{b.description}</p>
                  <Link
                    href={b.to}
                    className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium text-slate-900 hover:underline focus-ring rounded"
                  >
                    {b.linkLabel}
                    <ChevronRight size={13} />
                  </Link>
                </div>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5 }}
          className="overflow-hidden rounded-2xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <Image
            src="https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80"
            alt="Team working in a bright, comfortable open office"
            width={1200}
            height={288}
            className="h-72 w-full object-cover lg:h-full"
            loading="lazy"
          />
        </motion.div>
      </div>
    </section>
  );
}
