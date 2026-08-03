'use client';

import Link from 'next/link';
import { Wind } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-5 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-sm"
      >
        <Link href="/" className="flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-400/15 text-sky-300">
            <Wind size={18} strokeWidth={2.25} />
          </span>
          <span className="font-display text-xl font-semibold italic text-white">Aether</span>
        </Link>

        <div className="mt-8 rounded-2xl border border-white/5 bg-navy-900 p-6 shadow-lg shadow-black/20 sm:p-8">
          <h1 className="font-display text-xl font-bold text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>

        {footer && <p className="mt-5 text-center text-sm text-slate-400">{footer}</p>}
      </motion.div>
    </div>
  );
}
