import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-navy-950 px-5 text-center">
      <p className="font-display text-6xl font-bold text-white">404</p>
      <p className="text-sm text-slate-400">This page drifted off the dashboard.</p>
      <Link
        href="/"
        className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-sky-300"
      >
        Back to Aether
      </Link>
    </div>
  );
}
