export function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return Number(value).toFixed(digits);
}

export function formatWifiLabel(strength) {
  switch (strength) {
    case 'strong':
      return 'Strong';
    case 'moderate':
      return 'Moderate';
    case 'weak':
      return 'Weak';
    default:
      return 'Offline';
  }
}

export function severityStyles(severity) {
  switch (severity) {
    case 'critical':
      return { dot: 'bg-rose-400', text: 'text-rose-300', ring: 'ring-rose-400/20' };
    case 'warning':
      return { dot: 'bg-amber-400', text: 'text-amber-300', ring: 'ring-amber-400/20' };
    default:
      return { dot: 'bg-sky-400', text: 'text-sky-300', ring: 'ring-sky-400/20' };
  }
}
