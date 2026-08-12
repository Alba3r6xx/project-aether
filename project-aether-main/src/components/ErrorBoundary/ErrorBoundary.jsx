'use client';

import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Global error boundary (closes G12). Catches render errors in the
 * component tree and shows a friendly fallback instead of a white screen.
 * Users can click "Reload" to retry.
 *
 * Wrap the entire app (or individual route segments) with this.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
  }

  handleReload() {
    this.setState({ hasError: false, error: null });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-navy-950 px-5 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-400/10 text-rose-400">
            <AlertTriangle size={24} />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold text-white">Something went wrong</h1>
            <p className="mt-2 max-w-sm text-sm text-slate-400">
              An unexpected error occurred while rendering this page. Try reloading —
              your data is safe.
            </p>
          </div>
          <button
            type="button"
            onClick={() => this.handleReload()}
            className="flex items-center gap-2 rounded-lg bg-sky-400 px-4 py-2.5 text-sm font-semibold text-navy-950 transition-colors hover:bg-sky-300 focus-ring"
          >
            <RefreshCw size={14} />
            Reload page
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="mt-4 max-w-lg overflow-x-auto rounded-lg bg-white/5 p-4 text-left text-xs text-slate-400">
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
