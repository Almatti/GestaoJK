import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, Info, XCircle, Circle, Inbox } from 'lucide-react';
import type { Tone } from '@/domain/collections';

const toneStyles: Record<Tone, string> = {
  success: 'bg-success-50 text-success-700 border-success-700/20',
  warning: 'bg-warning-50 text-warning-700 border-warning-700/20',
  danger: 'bg-danger-50 text-danger-700 border-danger-700/20',
  info: 'bg-info-50 text-info-700 border-info-700/20',
  neutral: 'bg-cream-100 text-cocoa-700 border-tangerine-200'
};
const toneIcon: Record<Tone, typeof Info> = { success: CheckCircle2, warning: AlertTriangle, danger: XCircle, info: Info, neutral: Circle };

/** Badge de status: sempre texto + ícone (nunca apenas cor). */
export function Badge({ tone = 'neutral', children, className, icon = true }: { tone?: Tone; children: ReactNode; className?: string; icon?: boolean }) {
  const Icon = toneIcon[tone];
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', toneStyles[tone], className)}>
      {icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

export function Alert({ tone = 'info', title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-[var(--radius-card-sm)] border p-4', toneStyles[tone])}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="mt-0.5 opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center animate-fade-in">
      <div className="grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-tangerine-200 to-tangerine-400/70 text-tangerine-900 shadow-[var(--shadow-soft)]">
        {icon ?? <Inbox className="size-7" aria-hidden />}
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      {description && <p className="max-w-md text-sm text-cocoa-700">{description}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={clsx('skeleton block h-4', className)} aria-hidden />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-2" role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={i === 0 ? 'h-8 w-1/3' : 'h-12 w-full'} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert tone="danger" title="Não foi possível carregar as informações" action={onRetry && <button className="text-sm font-semibold underline" onClick={onRetry}>Tentar novamente</button>}>
      {friendlyError(error)}
    </Alert>
  );
}

/** Converte erros técnicos (Postgres/Supabase/rede) em mensagens compreensíveis. */
export function friendlyError(error: unknown): string {
  const e = error as { message?: string; code?: string; details?: string } | null;
  const msg = e?.message ?? String(error ?? 'Erro desconhecido');
  if (e?.code === '42501' || /permission denied|Permissão negada|row-level security/i.test(msg)) return 'Você não tem permissão para esta ação. Fale com um administrador.';
  if (e?.code === '23505' || /duplicate key/i.test(msg)) return 'Já existe um registro com estes dados (duplicidade).';
  if (e?.code === '23P01' || /conflicting key value violates exclusion/i.test(msg)) return 'Conflito de agenda ou vigência: já existe um registro no mesmo período.';
  if (e?.code === '23503') return 'Este registro está vinculado a outros e não pode ser alterado desta forma.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente novamente — nada foi salvo.';
  return msg.replace(/^FALHOU: /, '');
}
