import { useNavigate } from 'react-router';
import { FileUp, Plus } from 'lucide-react';
import { ResourcePage } from '@/features/resource/ResourcePage';
import type { ResourceDef } from '@/features/resource/types';
import { opts } from '@/features/resource/definitions';
import { ORDER_KIND, ORDER_STATUS } from '@/domain/orders';
import type { Tone } from '@/domain/collections';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthContext';
import type { Row } from '@/data/types';

export const ORDER_TONE: Record<string, Tone> = { orcamento: 'neutral', aguardando_confirmacao: 'warning', confirmado: 'info', em_preparacao: 'info', aguardando_entrega: 'info', em_rota: 'info', entregue: 'success', aguardando_recolhimento: 'warning', finalizado: 'success', cancelado: 'neutral' };

const def: ResourceDef = {
  table: 'orders', title: 'Pedidos', singular: 'Pedido', resource: 'pedidos',
  subtitle: 'Registro interno de pedidos de eventos e pontos fixos. Preços seguem as condições comerciais vigentes do cliente.',
  select: '*,customer:customers(name,trade_name)', searchColumns: ['notes', 'delivery_address'], defaultOrder: [{ column: 'number', ascending: false }],
  filters: [{ column: 'status', label: 'Status', options: opts(ORDER_STATUS) }, { column: 'kind', label: 'Tipo', options: opts(ORDER_KIND) }],
  status: { column: 'status', map: Object.fromEntries(Object.entries(ORDER_STATUS).map(([k, v]) => [k, { label: v, tone: ORDER_TONE[k]! }])) },
  rowLink: (r) => `/pedidos/${r.id}`, fields: [],
  cardTitle: (r) => `Pedido nº ${r.number} · ${String((r.customer as Row | null)?.trade_name ?? (r.customer as Row | null)?.name ?? '')}`,
  columns: [
    { key: 'number', label: 'Nº', format: 'number' },
    { key: 'customer', label: 'Cliente', render: (r) => { const c = r.customer as Row | null; return String(c?.trade_name ?? c?.name ?? '—'); }, exportValue: (r) => (r.customer as Row | null)?.name },
    { key: 'kind', label: 'Tipo', render: (r) => ORDER_KIND[r.kind as keyof typeof ORDER_KIND], hideOnMobile: true },
    { key: 'order_date', label: 'Data', format: 'date', hideOnMobile: true },
    { key: 'delivery_date', label: 'Entrega', format: 'date' },
    { key: 'total_liters', label: 'Litros', format: 'liters', align: 'right', hideOnMobile: true },
    { key: 'total', label: 'Total', format: 'money', align: 'right' },
    { key: 'margin_percent', label: 'Margem', format: 'percent', align: 'right', hideOnMobile: true },
    { key: 'status', label: 'Status' }
  ]
};

export function OrdersPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  return <ResourcePage def={{ ...def, resource: 'pedidos' }} headerExtra={can('pedidos', 'create') ? <div className="flex flex-wrap gap-2"><Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => navigate('/pedidos/importar')}>Importar PDF</Button><Button icon={<Plus className="size-4" />} onClick={() => navigate('/pedidos/novo')}>Novo pedido</Button></div> : undefined} />;
}
