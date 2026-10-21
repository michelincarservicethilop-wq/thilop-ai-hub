import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from './format';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T | null | ((prev: T | null) => T | null)) => void;
}

/**
 * Tải dữ liệu một lần (và khi deps đổi). `reload` để tải lại.
 * `silent` reload không bật lại cờ loading (dùng cho polling).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async (silent: boolean) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const d = await fnRef.current();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(errMsg(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => run(true), [run]);
  return { data, error, loading, reload, setData };
}

/** Gọi `fn` mỗi `ms` mili giây khi `enabled`; dừng khi tab ẩn. */
export function useInterval(fn: () => void, ms: number, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') ref.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}

/** Đồng bộ title tab trình duyệt. */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Thi Lốp AI Hub` : 'Thi Lốp AI Hub';
  }, [title]);
}
