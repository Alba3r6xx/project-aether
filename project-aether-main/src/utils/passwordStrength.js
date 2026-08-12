/**
 * Password strength validation (B4: auth hardening).
 *
 * Enforces minimum length + a mix of character classes. Returns a score
 * (0-4) and a human-readable label so the signup form can show a strength
 * meter. This is client-side validation only — Supabase Auth enforces its
 * own rules server-side; this just gives the user immediate feedback.
 */

export function validatePasswordStrength(password) {
  if (!password) return { score: 0, label: 'Empty', valid: false, checks: [] };

  const checks = [
    { label: 'At least 8 characters', passed: password.length >= 8 },
    { label: 'Contains a lowercase letter', passed: /[a-z]/.test(password) },
    { label: 'Contains an uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'Contains a number', passed: /\d/.test(password) },
    { label: 'Contains a special character', passed: /[^a-zA-Z0-9]/.test(password) },
  ];

  const passedCount = checks.filter((c) => c.passed).length;
  const score = Math.min(4, Math.floor(passedCount * 0.8));
  const valid = password.length >= 8 && passedCount >= 4;

  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const label = labels[score];

  return { score, label, valid, checks };
}
