import { ResourcePage } from '@/features/resource/ResourcePage';
import type { ResourceDef } from '@/features/resource/types';
import { Badge } from '@/components/ui/Feedback';
import { formatDocument, VERIFICATION_STATUS, type VerificationStatus } from '@/domain/documents';
import { formatPhoneBR } from '@/domain/documents';
import { CustomerForm } from './CustomerForm';

const SEGMENT = { ponto_fixo: 'Ponto fixo', evento: 'Eventos', ambos: 'Ambos' };

export const customersDef: ResourceDef = {
  table: 'customers', title: 'Clientes', singular: 'Cliente', resource: 'clientes',
  subtitle: 'CRM: cadastro único que alimenta pedidos, financeiro, cobrança, patrimônio e indicadores.',
  searchColumns: ['name', 'trade_name', 'document', 'city'], defaultOrder: [{ column: 'name' }],
  archive: { column: 'status', value: 'arquivado', activeValue: 'ativo' },
  filters: [
    { column: 'segmento', label: 'Segmento', options: Object.entries(SEGMENT).map(([value, label]) => ({ value, label })) },
    { column: 'status', label: 'Status', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] }
  ],
  status: { column: 'status', map: { ativo: { label: 'Ativo', tone: 'success' }, inativo: { label: 'Inativo', tone: 'neutral' }, arquivado: { label: 'Arquivado', tone: 'neutral' } } },
  rowLink: (r) => `/clientes/${r.id}`,
  cardTitle: (r) => String(r.trade_name ?? r.name),
  cardSubtitle: (r) => [r.city, SEGMENT[r.segment as keyof typeof SEGMENT]].filter(Boolean).join(' · '),
  fields: [],
  renderForm: (p) => <CustomerForm {...p} />,
  columns: [
    { key: 'name', label: 'Cliente', render: (r) => <div><p className="font-semibold">{String(r.trade_name ?? r.name)}</p>{r.trade_name ? <p className="text-xs text-cocoa-700">{String(r.name)}</p> : null}</div>, exportValue: (r) => r.name },
    { key: 'document', label: 'CPF/CNPJ', render: (r) => formatDocument(r.document as string) || '—', exportValue: (r) => formatDocument(r.document as string) },
    { key: 'segment', label: 'Segmento', render: (r) => SEGMENT[r.segment as keyof typeof SEGMENT], hideOnMobile: true },
    { key: 'city', label: 'Cidade', hideOnMobile: true },
    { key: 'whatsapp', label: 'WhatsApp', render: (r) => (r.whatsapp ? formatPhoneBR(String(r.whatsapp)) : '—'), hideOnMobile: true },
    { key: 'verification_status', label: 'Verificação', render: (r) => { const s = r.verification_status as VerificationStatus; return <Badge tone={s === 'verificado_fonte_oficial' ? 'success' : s === 'divergencia' ? 'danger' : s === 'formato_valido' || s === 'conferencia_manual' ? 'info' : 'neutral'}>{VERIFICATION_STATUS[s] ?? '—'}</Badge>; } },
    { key: 'status', label: 'Status' }
  ]
};

// "segmento" é um alias amigável na URL; mapeia para a coluna real.
const def: ResourceDef = { ...customersDef, filters: customersDef.filters!.map((f) => (f.column === 'segmento' ? { ...f, column: 'segment' } : f)) };

export function CustomersPage() {
  return <ResourcePage def={def} />;
}
