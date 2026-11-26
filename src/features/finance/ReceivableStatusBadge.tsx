import { useMemo } from 'react';
import { useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { Badge } from '@/components/ui/Feedback';
import { combinedStatus, type FinancialStatus, type ProtestStatus } from '@/domain/collections';

/** Mapa receivable_id → situação cartorária (consulta única compartilhada via cache). */
export function useProtestMap() {
  const q = useList<Row>('protest_records', { select: 'receivable_id,status', range: [0, 9999] });
  return useMemo(() => new Map((q.data?.rows ?? []).map((p) => [String(p.receivable_id), p.status as ProtestStatus])), [q.data]);
}

/** Apresentação combinada: situação financeira + situação cartorária (ex.: "Pago via Pix, mas ainda em protesto"). */
export function ReceivableStatusBadge({ receivableId, financialStatus, paymentMethod }: { receivableId: string; financialStatus: string; paymentMethod?: string | null }) {
  const map = useProtestMap();
  const s = combinedStatus(financialStatus as FinancialStatus, map.get(receivableId) ?? 'nao_encaminhado', paymentMethod === 'pix' ? 'Pix' : paymentMethod);
  return <span title={s.detail}><Badge tone={s.tone}>{s.label}</Badge></span>;
}
