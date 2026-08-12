import Link from 'next/link';
import { Wind, Globe, MessageCircle, Mail, Link2 } from 'lucide-react';

// Every entry here points at a route or in-page anchor that actually
// exists in this project. Add a page (and its route in app/) before
// adding a new link here, so nothing in the footer ever leads nowhere.
const COLUMNS = [
  {
    links: [
      { label: 'Home', to: '/' },
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'History', to: '/history' },
      { label: 'Analytics', to: '/analytics' },
      { label: 'Settings', to: '/settings' },
    ],
  },
  {
    links: [
      { label: 'Features', to: '/#features' },
      { label: 'Benefits', to: '/#benefits' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-black/5 bg-white">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900/5 text-slate-900">
                <Wind size={18} />
              </span>
              <span className="font-display text-lg font-semibold italic text-slate-900">Aether</span>
            </div>
            <p className="mt-4 text-xs font-semibold text-slate-900">Address</p>
            <p className="mt-1 text-xs text-slate-500">Level 1, 12 Sample St, Sydney NSW 2000</p>
            <p className="mt-3 text-xs font-semibold text-slate-900">Contact</p>
            <p className="mt-1 text-xs text-slate-500">(000) 123 4567</p>
            <p className="text-xs text-slate-500">info@projectaether.com</p>
            <div className="mt-4 flex gap-3 text-slate-400">
              <Globe size={16} />
              <MessageCircle size={16} />
              <Mail size={16} />
              <Link2 size={16} />
            </div>
          </div>

          {COLUMNS.map((col, i) => (
            <ul key={i} className="flex flex-col gap-2.5 text-xs text-slate-500">
              {col.links.map((link) =>
                link.to.includes('#') ? (
                  <li key={link.label}>
                    <a href={link.to} className="hover:text-slate-900">
                      {link.label}
                    </a>
                  </li>
                ) : (
                  <li key={link.label}>
                    <Link href={link.to} className="hover:text-slate-900">
                      {link.label}
                    </Link>
                  </li>
                )
              )}
            </ul>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-black/5 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 ESP32 IoT Air Quality &amp; Comfort Dashboard. All rights reserved.</p>
          <div className="flex gap-5">
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
            <span>Cookies Settings</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
