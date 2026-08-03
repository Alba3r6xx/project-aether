'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import AuthShell from '../../components/auth/AuthShell';
import { useAuth } from '../../context/AuthContext';
import { validatePasswordStrength } from '../../utils/passwordStrength';
import { cn } from '../../utils/cn';

export default function SignupPage() {
  const { signUp, isSupabaseConfigured } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      setError('Password is too weak. Include uppercase, lowercase, numbers, and a special character.');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await signUp({ email, password, fullName });
      if (data.session) {
        router.replace('/dashboard');
      } else {
        setNeedsEmailConfirm(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (needsEmailConfirm) {
    return (
      <AuthShell title="Check your email">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 size={32} className="text-emerald-400" />
          <p className="text-sm text-slate-300">
            We sent a confirmation link to <span className="text-white">{email}</span>. Click it,
            then come back and sign in.
          </p>
          <Link
            href="/login"
            className="mt-2 rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-sky-300"
          >
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Get access to your team's live dashboard."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-sky-400 hover:text-sky-300">
            Sign in
          </Link>
        </>
      }
    >
      {!isSupabaseConfigured && (
        <div className="mb-4 flex gap-2 rounded-lg bg-amber-400/10 p-3 text-xs text-amber-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <p>
            Supabase isn&apos;t configured yet, so sign up is disabled. Add{' '}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> / <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{' '}
            <code>.env</code> to enable real accounts.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="fullName" className="mb-1.5 block text-xs font-medium text-slate-300">
            Full name
          </label>
          <input
            id="fullName"
            type="text"
            required
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus-ring"
            placeholder="Kobina Gyasi Assan"
          />
        </div>

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

        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-slate-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus-ring"
            placeholder="At least 8 characters"
          />
          {password && (
            <div className="mt-2">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors',
                      validatePasswordStrength(password).score > i
                        ? validatePasswordStrength(password).score <= 1
                          ? 'bg-rose-400'
                          : validatePasswordStrength(password).score <= 2
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                        : 'bg-white/10'
                    )}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Strength: {validatePasswordStrength(password).label}
              </p>
            </div>
          )}
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
          Create account
        </button>
      </form>
    </AuthShell>
  );
}
