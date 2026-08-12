'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Stale-while-revalidate fetch hook (Phase D2).
 *
 * Returns cached data immediately (stale), then revalidates in the
 * background. While revalidating, `isValidating` is true but `data`
 * still holds the stale value so the UI never flashes empty.
 *
 * Features:
 *  - In-memory cache keyed by `key` (shared across hook instances on
 *    the same page, so multiple components fetching the same resource
 *    share one request).
 *  - Optional `refreshInterval` for polling.
 *  - Deduplication: concurrent calls with the same key share one fetch.
 *  - Window focus refetch (opt-in via `revalidateOnFocus`).
 *
 * Usage:
 *   const { data, error, isValidating, mutate } = useSWR(
 *     '/api/latest',
 *     fetcher,
 *     { refreshInterval: 5000 }
 *   );
 */

const cache = new Map();
const dedup = new Map();

export function useSWR(key, fetcher, options = {}) {
  const {
    refreshInterval = 0,
    revalidateOnFocus = false,
    initialData = null,
  } = options;

  const [data, setData] = useState(() => cache.get(key) ?? initialData);
  const [error, setError] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const execute = useCallback(
    async (opts = {}) => {
      if (!key) return;
      if (dedup.has(key) && !opts.force) return dedup.get(key);

      setIsValidating(true);
      const promise = (async () => {
        try {
          const result = await fetcherRef.current(key);
          cache.set(key, result);
          setData(result);
          setError(null);
          return result;
        } catch (err) {
          setError(err);
          throw err;
        } finally {
          setIsValidating(false);
          dedup.delete(key);
        }
      })();

      dedup.set(key, promise);
      return promise;
    },
    [key]
  );

  // Initial fetch + when key changes.
  useEffect(() => {
    execute();
  }, [key, execute]);

  // Polling.
  useEffect(() => {
    if (!refreshInterval) return undefined;
    const timer = setInterval(() => execute({ force: true }), refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, execute]);

  // Focus refetch.
  useEffect(() => {
    if (!revalidateOnFocus) return undefined;
    function handleFocus() {
      execute({ force: true });
    }
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, execute]);

  const mutate = useCallback(
    (newData) => {
      if (typeof newData === 'function') {
        setData((prev) => {
          const next = newData(prev);
          cache.set(key, next);
          return next;
        });
      } else if (newData) {
        cache.set(key, newData);
        setData(newData);
      } else {
        execute({ force: true });
      }
    },
    [key, execute]
  );

  return { data, error, isValidating, mutate, refresh: () => execute({ force: true }) };
}

/** Clears the in-memory cache (e.g. on sign-out). */
export function clearSWRCache() {
  cache.clear();
  dedup.clear();
}
