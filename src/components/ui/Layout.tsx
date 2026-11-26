import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Link } from 'react-router';
import { ChevronRight, Info } from 'lucide-react';

export function PageHeader({ title, subtitle, actions, breadcrumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; breadcrumbs?: { label: string; to?: string }[] }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs && (
          <nav aria-label="Trilha" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-cocoa-700">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {b.to ? <Link className="hover:text-tangerine-900 hover:underline" to={b.to}>{b.label}</Link> : <span>{b.label}</span>}
                {i < breadcrumbs.length - 1 && <ChevronRight className="size-3" aria-hidden />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-extrabold text-cocoa-900 sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-cocoa-700">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, opaque, title, action, as: As = 'section' }: { children: ReactNode; className?: string; opaque?: boolean; title?: ReactNode; action?: ReactNode; as?: 'section' | 'div' | 'article' }) {
  return (
    <As className={clsx(opaque ? 'surface rounded-[var(--radius-card)] p-5' : 'card', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {typeof title === 'string' ? <h2 className="text-base font-bold">{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </As>
  );
}

export function Stat({ label, value, hint, tone, icon, to, help }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'up' | 'down' | 'neutral'; icon?: ReactNode; to?: string; help?: string }) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1 text-sm font-medium text-cocoa-700">
          {label}
          {help && <span title={help} aria-label={help}><Info className="size-3.5" aria-hidden /></span>}
        </p>
        {icon && <span className="grid size-9 place-items-center rounded-xl bg-tangerine-100 text-tangerine-900">{icon}</span>}
      </div>
      <p className="num mt-1 font-display text-2xl font-extrabold text-cocoa-900">{value}</p>
      {hint && <p className={clsx('mt-1 text-xs', tone === 'up' ? 'text-success-700' : tone === 'down' ? 'text-danger-700' : 'text-cocoa-700')}>{hint}</p>}
    </>
  );
  const cls = 'card card-sm block transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]';
  return to ? <Link to={to} className={cls}>{content}</Link> : <div className={cls}>{content}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-white/50 p-1 [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            'shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors duration-200',
            value === t.key ? 'bg-white text-tangerine-900 shadow-[var(--shadow-soft)]' : 'text-cocoa-700 hover:bg-white/60'
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-tangerine-100 px-1.5 text-xs">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-cocoa-700">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-cocoa-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
