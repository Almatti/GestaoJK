import { useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card, Tabs, Stat } from '@/components/ui/Layout';
import { Alert, Badge } from '@/components/ui/Feedback';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { campaignsDef, contentsDef, leadsDef, opts } from '@/features/resource/definitions';
import type { ResourceDef } from '@/features/resource/types';
import { formatReais, formatNumber, formatPercent } from '@/domain/money';
import { todaySP } from '@/domain/dates';

const METRICS = { seguidores: 'Seguidores', alcance: 'Alcance', impressoes: 'Impressões', visualizacoes: 'Visualizações', engajamento: 'Engajamento', curtidas: 'Curtidas', comentarios: 'Comentários', compartilhamentos: 'Compartilhamentos', salvamentos: 'Salvamentos', cliques: 'Cliques', leads: 'Leads', conversoes: 'Conversões', investimento: 'Investimento (R$)', receita_atribuida: 'Receita atribuída (R$)' };
const SOURCE_TONE = { manual: 'info', sincronizado: 'success', estimado: 'warning', importado: 'info' } as const;

const metricsDef: ResourceDef = {
  table: 'marketing_metrics', title: 'Métricas', singular: 'Métrica', resource: 'marketing', searchColumns: ['channel'], defaultOrder: [{ column: 'metric_date', ascending: false }],
  select: '*,campaign:marketing_campaigns(name)', allowDelete: true,
  filters: [{ column: 'metric', label: 'Métrica', options: opts(METRICS) }, { column: 'source', label: 'Origem', options: opts({ manual: 'Manual', sincronizado: 'Sincronizada', estimado: 'Estimada', importado: 'Importada' }) }],
  fields: [
    { name: 'campaign_id', label: 'Campanha', type: 'ref', ref: { table: 'marketing_campaigns', label: 'name' } },
    { name: 'channel', label: 'Canal', type: 'select', options: opts({ instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', google: 'Google', tiktok: 'TikTok', offline: 'Offline', outro: 'Outro' }), required: true },
    { name: 'metric_date', label: 'Data', type: 'date', required: true, defaultValue: todaySP() },
    { name: 'metric', label: 'Métrica', type: 'select', options: opts(METRICS), required: true },
    { name: 'value', label: 'Valor', type: 'number', required: true },
    { name: 'source', label: 'Origem do dado', type: 'select', options: opts({ manual: 'Lançamento manual', estimado: 'Estimado', importado: 'Importado' }), defaultValue: 'manual', help: '"Sincronizado" só é usado por integrações oficiais.' }
  ],
  columns: [{ key: 'metric_date', label: 'Data', format: 'date' }, { key: 'channel', label: 'Canal' }, { key: 'metric', label: 'Métrica', render: (r) => METRICS[r.metric as keyof typeof METRICS] }, { key: 'value', label: 'Valor', format: 'number', align: 'right' }, { key: 'campaign.name', label: 'Campanha', sortable: false }, { key: 'source', label: 'Origem', render: (r) => <Badge tone={SOURCE_TONE[r.source as keyof typeof SOURCE_TONE]}>{String(r.source)}</Badge> }]
};

export function MarketingPage() {
  const [tab, setTab] = useState<'analytics' | 'campanhas' | 'conteudos' | 'leads' | 'metricas'>('analytics');
  const campaigns = useList<Row>('marketing_campaigns', { range: [0, 499] });
  const metrics = useList<Row>('marketing_metrics', { range: [0, 9999] });
  const orders = useList<Row>('orders', { select: 'campaign_id,total,total_cost,status', filters: [{ column: 'campaign_id', op: 'neq', value: '00000000-0000-0000-0000-000000000000' }], range: [0, 9999] });
  const leads = useList<Row>('leads', { select: 'campaign_id,stage', range: [0, 9999] });

  const perCampaign = useMemo(() => (campaigns.data?.rows ?? []).map((c) => {
    const ms = (metrics.data?.rows ?? []).filter((m) => m.campaign_id === c.id);
    const sum = (k: string) => ms.filter((m) => m.metric === k).reduce((s, m) => s + Number(m.value), 0);
    const os = (orders.data?.rows ?? []).filter((o) => o.campaign_id === c.id && !['orcamento', 'aguardando_confirmacao', 'cancelado'].includes(String(o.status)));
    const revenue = os.reduce((s, o) => s + Number(o.total), 0);
    const profit = os.reduce((s, o) => s + Number(o.total) - Number(o.total_cost), 0);
    const invest = Number(c.spent ?? 0) || sum('investimento');
    const ls = (leads.data?.rows ?? []).filter((l) => l.campaign_id === c.id);
    const won = ls.filter((l) => l.stage === 'ganho').length;
    return { c, revenue, profit, invest, leads: ls.length || sum('leads'), won, cpl: ls.length ? invest / ls.length : null, cac: won ? invest / won : null, roas: invest ? revenue / invest : null, roi: invest ? ((profit - invest) / invest) * 100 : null, conv: ls.length ? (won / ls.length) * 100 : null, sources: [...new Set(ms.map((m) => String(m.source)))] };
  }), [campaigns.data, metrics.data, orders.data, leads.data]);

  const tot = perCampaign.reduce((a, x) => ({ revenue: a.revenue + x.revenue, profit: a.profit + x.profit, invest: a.invest + x.invest, leads: a.leads + x.leads }), { revenue: 0, profit: 0, invest: 0, leads: 0 });
  return (
    <div className="animate-fade-in">
      <PageHeader title="Marketing" subtitle="Planejamento, conteúdo e analytics integrados às vendas reais. Métricas sem integração são lançadas manualmente e identificadas pela origem." />
      <Tabs tabs={[{ key: 'analytics', label: 'Analytics' }, { key: 'campanhas', label: 'Campanhas' }, { key: 'conteudos', label: 'Conteúdos e calendário' }, { key: 'leads', label: 'Leads e funil' }, { key: 'metricas', label: 'Métricas' }]} value={tab} onChange={setTab} />
      {tab === 'analytics' && (
        <>
          <Alert tone="info" title="Integrações Meta/Instagram não configuradas">Nenhum resultado é inventado: sem integração, os números vêm de lançamentos manuais e dos pedidos vinculados às campanhas (receita atribuída ≠ lucro).</Alert>
          <div className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Investimento" value={formatReais(tot.invest)} />
            <Stat label="Receita atribuída" value={formatReais(tot.revenue)} hint="Pedidos com campanha vinculada" />
            <Stat label="Lucro bruto atribuído" value={formatReais(tot.profit)} />
            <Stat label="Leads" value={formatNumber(tot.leads)} hint={tot.leads ? `CPL ${formatReais(tot.invest / tot.leads)}` : undefined} />
          </div>
          <Card opaque title="Desempenho por campanha">
            {perCampaign.length === 0 ? <p className="text-sm text-cocoa-700">Cadastre campanhas e vincule clientes/pedidos pela origem.</p> : (
              <>
                <div className="mb-4 h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={perCampaign.map((x) => ({ name: String(x.c.name), Receita: x.revenue, Investimento: x.invest }))}><CartesianGrid strokeDasharray="3 6" stroke="#FFCC97" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11, fill: '#92543A' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: '#92543A' }} axisLine={false} tickLine={false} width={60} /><Tooltip formatter={(v) => formatReais(Number(v))} contentStyle={{ borderRadius: 14 }} /><Bar dataKey="Receita" fill="#FC6500" radius={[8, 8, 0, 0]} /><Bar dataKey="Investimento" fill="#FFCC97" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className="text-left text-xs uppercase text-cocoa-700"><tr><th className="py-2">Campanha</th><th className="text-right">Invest.</th><th className="text-right">Receita</th><th className="text-right">Leads</th><th className="text-right">CPL</th><th className="text-right">CAC</th><th className="text-right">ROAS</th><th className="text-right">ROI</th><th className="text-right">Conversão</th><th>Origem dos dados</th></tr></thead>
                  <tbody>{perCampaign.map((x) => (<tr key={String(x.c.id)} className="border-t border-tangerine-100"><td className="py-2">{String(x.c.name)}</td><td className="num text-right">{formatReais(x.invest)}</td><td className="num text-right">{formatReais(x.revenue)}</td><td className="num text-right">{x.leads}</td><td className="num text-right">{x.cpl === null ? '—' : formatReais(x.cpl)}</td><td className="num text-right">{x.cac === null ? '—' : formatReais(x.cac)}</td><td className="num text-right">{x.roas === null ? '—' : `${x.roas.toFixed(2)}x`}</td><td className="num text-right">{x.roi === null ? '—' : formatPercent(x.roi)}</td><td className="num text-right">{x.conv === null ? '—' : formatPercent(x.conv)}</td><td>{x.sources.length ? x.sources.map((s) => <Badge key={s} className="mr-1" tone={SOURCE_TONE[s as keyof typeof SOURCE_TONE] ?? 'neutral'}>{s}</Badge>) : <Badge>indisponível</Badge>}</td></tr>))}</tbody></table></div>
              </>
            )}
          </Card>
        </>
      )}
      {tab === 'campanhas' && <ResourcePage def={campaignsDef} />}
      {tab === 'conteudos' && <ResourcePage def={contentsDef} />}
      {tab === 'leads' && <ResourcePage def={leadsDef} />}
      {tab === 'metricas' && <ResourcePage def={metricsDef} />}
    </div>
  );
}
