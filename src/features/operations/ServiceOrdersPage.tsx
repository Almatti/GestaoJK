import { useSearchParams } from 'react-router';
import { ResourcePage } from '@/features/resource/ResourcePage';
import type { ResourceDef } from '@/features/resource/types';
import { opts } from '@/features/resource/definitions';
import type { Row } from '@/data/types';

export const SO_STATUS = { aberta: 'Aberta', agendada: 'Agendada', em_execucao: 'Em execução', concluida: 'Concluída', cancelada: 'Cancelada' };

export function serviceOrdersDef(equipmentId?: string | null): ResourceDef {
  return {
    table: 'service_orders', title: 'Ordens de serviço', singular: 'Ordem de serviço', resource: 'tecnico',
    subtitle: 'Ao finalizar: consumo de peças do estoque, histórico patrimonial, agenda e cobrança (quando não gratuita) são atualizados automaticamente.',
    select: '*,customer:customers(name,trade_name),service:services(name),equipment:equipment(asset_code)',
    searchColumns: ['reason', 'diagnosis'], defaultOrder: [{ column: 'number', ascending: false }],
    filters: [{ column: 'status', label: 'Situação', options: opts(SO_STATUS) }, { column: 'priority', label: 'Prioridade', options: opts({ baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' }) }],
    status: { column: 'status', map: { aberta: { label: 'Aberta', tone: 'info' }, agendada: { label: 'Agendada', tone: 'info' }, em_execucao: { label: 'Em execução', tone: 'warning' }, concluida: { label: 'Concluída', tone: 'success' }, cancelada: { label: 'Cancelada', tone: 'neutral' } } },
    rowLink: (r) => `/ordens-de-servico/${r.id}`,
    fields: [
      { name: 'customer_id', label: 'Cliente', type: 'ref', ref: { table: 'customers', label: 'name' } },
      { name: 'equipment_id', label: 'Equipamento', type: 'ref', ref: { table: 'equipment', label: 'asset_code' }, defaultValue: equipmentId ?? '' },
      { name: 'service_id', label: 'Serviço', type: 'ref', ref: { table: 'services', label: 'name', filters: [{ column: 'active', op: 'eq', value: true }] }, required: true },
      { name: 'technician_id', label: 'Técnico responsável', type: 'ref', ref: { table: 'profiles', label: 'full_name', filters: [{ column: 'active', op: 'eq', value: true }] } },
      { name: 'scheduled_date', label: 'Data', type: 'date' },
      { name: 'scheduled_time', label: 'Horário', type: 'time' },
      { name: 'priority', label: 'Prioridade', type: 'select', options: opts({ baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' }), defaultValue: 'normal' },
      { name: 'is_free', label: 'Serviço gratuito (incluso no contrato)', type: 'boolean' },
      { name: 'charged_amount', label: 'Valor a cobrar (R$)', type: 'money', min: 0, defaultValue: 0 },
      { name: 'cost', label: 'Custo de mão de obra (R$)', type: 'money', min: 0, defaultValue: 0 },
      { name: 'reason', label: 'Motivo', type: 'textarea' },
      { name: 'notes', label: 'Observações', type: 'textarea' }
    ],
    columns: [
      { key: 'number', label: 'OS', format: 'number' },
      { key: 'customer', label: 'Cliente', render: (r) => String((r.customer as Row | null)?.trade_name ?? (r.customer as Row | null)?.name ?? '—') },
      { key: 'service', label: 'Serviço', render: (r) => String((r.service as Row | null)?.name ?? '—') },
      { key: 'equipment', label: 'Equipamento', render: (r) => String((r.equipment as Row | null)?.asset_code ?? '—'), hideOnMobile: true },
      { key: 'scheduled_date', label: 'Data', format: 'date' },
      { key: 'priority', label: 'Prioridade', hideOnMobile: true },
      { key: 'status', label: 'Situação' }
    ]
  };
}

export function ServiceOrdersPage() {
  const [params] = useSearchParams();
  return <ResourcePage def={serviceOrdersDef(params.get('equipamento'))} />;
}
