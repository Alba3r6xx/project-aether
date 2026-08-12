'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import AuthShell from '../../components/auth/AuthShell';
import { requestPasswordReset } from '../../services/authService';
import { useAuth } from '../../context/AuthContext';

export default function ForgotPasswordPage() {
  const { isSupabaseConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 size={32} className="text-emerald-400" />
          <p className="text-sm text-slate-300">
            If an account exists for <span className="text-white">{email}</span>, a reset link is
            on its way.
          </p>
          <Link
            href="/login"
            className="mt-2 rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-sky-300"
          >
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a reset link."
      footer={
        <Link href="/login" className="font-medium text-sky-400 hover:text-sky-300">
          Back to sign in
        </Link>
      }
    >
      {!isSupabaseConfigured && (
        <div className="mb-4 flex gap-2 rounded-lg bg-amber-400/10 p-3 text-xs text-amber-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <p>Supabase isn&apos;t configured yet, so password reset is disabled.</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-slate-300">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus-ring"
            placeholder="you@example.com"
          />
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-xs text-rose-400">
            <AlertCircle size={13} />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !isSupabaseConfigured}
          className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-sky-400 px-4 py-2.5 text-sm font-semibold text-navy-950 transition-colors hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
        >
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Send reset link
        </button>
      </form>
    </AuthShell>
  );
}
