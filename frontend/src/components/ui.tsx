import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { money } from '../lib/format';
import { IconClose } from './icons';

export function PageHead({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="topbar">
      <div>
        <h1 className="h1">{title}</h1>
        {subtitle && <div className="small muted">{subtitle}</div>}
      </div>
      {right && <div className="topbar-right">{right}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={'card' + (className ? ' ' + className : '')}>
      {(title || actions) && (
        <div className="card-head">
          {title ? <h2 className="h2">{title}</h2> : <span />}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type TagKind = 'ok' | 'warn' | 'off' | 'err' | 'info';
export function Tag({ kind, children }: { kind: TagKind; children: ReactNode }) {
  return <span className={'tag ' + kind}>{children}</span>;
}

export function Progress({ value, warn, dark, label }: { value: number; warn?: boolean; dark?: boolean; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={'track' + (dark ? ' dark' : '')}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      aria-label={label}
    >
      <div className={'fill' + (warn ? ' warn' : '')} style={{ width: v + '%' }} />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled || !onChange}
      className={'switch' + (checked ? ' on' : '')}
      onClick={() => onChange?.(!checked)}
    />
  );
}

export function Pills<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="pills" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={'pill' + (o.value === value ? ' on' : '')}
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Nhiều lựa chọn (bật/tắt từng pill). */
export function MultiPills({
  options,
  value,
  onChange,
  label,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  return (
    <div className="pills" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            className={'pill' + (on ? ' on' : '')}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          className={'tab' + (t.value === value ? ' on' : '')}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  return <p className="empty">{children ?? 'Chưa có dữ liệu'}</p>;
}

export function Loading({ text }: { text?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {text ?? 'Đang tải…'}
    </p>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="errbox" role="alert">
      {children}
    </div>
  );
}

export function Note({ children, kind = 'ok' }: { children: ReactNode; kind?: 'ok' | 'warn' | 'info' }) {
  return <div className={'note ' + kind}>{children}</div>;
}

export function Cost({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return null;
  return <div className="cost">Chi phí lượt này: {money(v)}</div>;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = 'Sao chép', small }: { text: string; label?: string; small?: boolean }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), 1800);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className={'btn btn-ghost' + (small ? ' btn-sm' : '')}
      onClick={async () => setState((await copyText(text)) ? 'ok' : 'fail')}
      aria-live="polite"
    >
      {state === 'ok' ? 'Đã chép' : state === 'fail' ? 'Không chép được' : label}
    </button>
  );
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, select, textarea, button:not(.dialog-x)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-head">
          <h2 className="h2" id={titleId} style={{ margin: 0 }}>
            {title}
          </h2>
          <button type="button" className="icon-btn dialog-x" onClick={onClose} aria-label="Đóng">
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={'fld' + (className ? ' ' + className : '')}>
      <span className="fld-label">{label}</span>
      {children}
      {hint && <span className="fld-hint">{hint}</span>}
    </label>
  );
}

function fileSize(n: number): string {
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

export function FilePick({
  accept,
  file,
  onFile,
  hint,
  title = 'Bấm để chọn file',
}: {
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  hint: string;
  title?: string;
}) {
  const id = useId();
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <label
        className={'drop' + (drag ? ' drag' : '')}
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
      >
        <span className="drop-title">{file ? file.name : title}</span>
        <span className="small">{file ? `${fileSize(file.size)} · bấm để đổi file` : hint}</span>
      </label>
      <input
        id={id}
        type="file"
        className="sr"
        accept={accept}
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export interface BarItem {
  key: string | number;
  label: string;
  value: number;
  max: number;
  text: string;
  warn?: boolean;
}

export function BarList({ items }: { items: BarItem[] }) {
  if (!items.length) return <Empty />;
  return (
    <div className="barlist">
      {items.map((b) => (
        <div className="bar-row" key={b.key}>
          <div className="bar-label" title={b.label}>
            {b.label}
          </div>
          <Progress value={b.max > 0 ? (b.value / b.max) * 100 : 0} warn={b.warn} label={b.label} />
          <div className="bar-val">{b.text}</div>
        </div>
      ))}
    </div>
  );
}

/** Bảng đơn giản cuộn ngang trong card. */
export function Table({ children, minWidth }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="tbl" tabIndex={0} role="region" aria-label="Bảng dữ liệu (cuộn ngang được)">
      <table style={minWidth ? { minWidth } : undefined}>{children}</table>
    </div>
  );
}
