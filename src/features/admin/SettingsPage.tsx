import { useEffect, useState } from 'react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { SETTING_DEFS } from '@/config/settings';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { holidaysDef } from '@/features/resource/definitions';
import { isValidCnpj, normalizeCnpj } from '@/domain/documents';
import { detectPixKeyType } from '@/domain/pix';
import { formatDateTimeBR } from '@/domain/dates';

/** Configurações sem alteração de código: valores tipados, validados e versionados (settings_history). */
export function SettingsPage() {
  const [tab, setTab] = useState<'empresa' | 'parametros' | 'feriados' | 'historico'>('empresa');
  return (
    <div className="animate-fade-in">
      <PageHeader title="Configurações" subtitle="Dados da empresa, regras comerciais e parâmetros. Alterações críticas ficam registradas com versão e autor." />
      <Tabs tabs={[{ key: 'empresa', label: 'Empresa e Pix' }, { key: 'parametros', label: 'Parâmetros do sistema' }, { key: 'feriados', label: 'Feriados' }, { key: 'historico', label: 'Histórico de alterações' }]} value={tab} onChange={setTab} />
      {tab === 'empresa' && <CompanyForm />}
      {tab === 'parametros' && <Params />}
      {tab === 'feriados' && <ResourcePage def={holidaysDef} />}
      {tab === 'historico' && <History />}
      {tab === 'parametros' && <p className="mt-4 text-xs text-cocoa-700">Outras configurações: regras de cobrança (Financeiro → Cobranças), produtos/tamanhos/categorias (Produtos), modelos (Administração → Modelos), automações e integrações.</p>}
    </div>
  );
}

function CompanyForm() {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const q = useList<Row>('company', {});
  const [v, setV] = useState<Record<string, string>>({});
  const [addr, setAddr] = useState<Record<string, string>>({});
  useEffect(() => {
    const c = q.data?.rows[0];
    if (c) {
      setV(Object.fromEntries(['legal_name', 'trade_name', 'document', 'state_registration', 'phone', 'email', 'pix_key', 'pix_merchant_name', 'pix_merchant_city'].map((k) => [k, String(c[k] ?? '')])));
      setAddr((c.address as Record<string, string>) ?? {});
    }
  }, [q.data]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    if (v.document && !isValidCnpj(v.document)) return toast('CNPJ da empresa inválido.', 'warning');
    if (v.pix_key && !detectPixKeyType(v.pix_key)) return toast('Chave Pix em formato não reconhecido (CPF/CNPJ só dígitos, e-mail, +55… ou chave aleatória).', 'warning');
    try {
      await db().update('company', '1', { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x || null])), document: v.document ? normalizeCnpj(v.document) : null, address: addr });
      invalidate();
      toast('Dados da empresa salvos.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Card opaque>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Razão social" value={v.legal_name ?? ''} onChange={set('legal_name')} />
        <TextInput label="Nome fantasia" value={v.trade_name ?? ''} onChange={set('trade_name')} />
        <TextInput label="CNPJ" value={v.document ?? ''} onChange={set('document')} />
        <TextInput label="Inscrição estadual" value={v.state_registration ?? ''} onChange={set('state_registration')} />
        <TextInput label="Telefone" value={v.phone ?? ''} onChange={set('phone')} />
        <TextInput label="E-mail" value={v.email ?? ''} onChange={set('email')} />
        <TextInput label="Endereço" value={addr.street ?? ''} onChange={(e) => setAddr((s) => ({ ...s, street: e.target.value }))} />
        <TextInput label="Cidade" value={addr.city ?? ''} onChange={(e) => setAddr((s) => ({ ...s, city: e.target.value }))} />
        <TextInput label="Chave Pix" value={v.pix_key ?? ''} onChange={set('pix_key')} hint={v.pix_key ? `Tipo: ${detectPixKeyType(v.pix_key) ?? 'não reconhecido'}` : 'Usada no QR Code estático e nas mensagens.'} />
        <TextInput label="Nome do recebedor (Pix, até 25)" maxLength={25} value={v.pix_merchant_name ?? ''} onChange={set('pix_merchant_name')} />
        <TextInput label="Cidade do recebedor (Pix, até 15)" maxLength={15} value={v.pix_merchant_city ?? ''} onChange={set('pix_merchant_city')} />
      </div>
      <div className="mt-4"><Button onClick={save}>Salvar</Button></div>
    </Card>
  );
}

function Params() {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const q = useList<Row>('settings', { range: [0, 499] });
  const [vals, setVals] = useState<Record<string, unknown>>({});
  useEffect(() => {
    setVals(Object.fromEntries((q.data?.rows ?? []).map((r) => [String(r.key), r.value])));
  }, [q.data]);
  const save = async (key: string) => {
    const def = SETTING_DEFS.find((d) => d.key === key)!;
    let value = vals[key];
    try {
      if (def.type === 'number') {
        value = Number(value);
        if (!Number.isFinite(value) || (def.min !== undefined && (value as number) < def.min) || (def.max !== undefined && (value as number) > def.max)) throw new Error(`Valor fora do intervalo permitido (${def.min ?? '−∞'} a ${def.max ?? '∞'})`);
      }
      if (def.type === 'json' && typeof value === 'string') value = JSON.parse(value);
      const exists = q.data?.rows.some((r) => r.key === key);
      if (exists) await db().update('settings', key, { value }, 'key');
      else await db().insert('settings', { key, value, description: def.label });
      invalidate();
      toast('Configuração salva (versão registrada).');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const groups = [...new Set(SETTING_DEFS.map((d) => d.group))];
  return (
    <div className="space-y-4">
      <Alert tone="info">Margem mínima padrão: 20%. Indicador preferencial: margem de contribuição. Ambos configuráveis.</Alert>
      {groups.map((g) => (
        <Card key={g} opaque title={g}>
          <div className="space-y-4">
            {SETTING_DEFS.filter((d) => d.group === g).map((d) => {
              const v = vals[d.key] ?? d.default;
              return (
                <div key={d.key} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    {d.type === 'boolean' ? <Checkbox label={d.label} hint={d.help} checked={Boolean(v)} onChange={(e) => setVals((s) => ({ ...s, [d.key]: e.target.checked }))} />
                      : d.type === 'select' ? <SelectInput label={d.label} hint={d.help} options={d.options!} value={String(v)} onChange={(e) => setVals((s) => ({ ...s, [d.key]: e.target.value }))} />
                      : d.type === 'json' ? <TextArea label={d.label} hint={d.help} className="font-mono text-xs" value={typeof v === 'string' ? v : JSON.stringify(v, null, 2)} onChange={(e) => setVals((s) => ({ ...s, [d.key]: e.target.value }))} />
                      : <TextInput label={d.label} hint={d.help} type="number" step="any" min={d.min} max={d.max} value={String(v)} onChange={(e) => setVals((s) => ({ ...s, [d.key]: e.target.value }))} />}
                  </div>
                  <Button size="sm" variant="soft" onClick={() => save(d.key)}>Salvar</Button>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

function History() {
  const q = useList<Row>('settings_history', { order: [{ column: 'changed_at', ascending: false }], range: [0, 199] });
  return (
    <Card opaque>
      <ul className="divide-y divide-tangerine-100 text-sm">{(q.data?.rows ?? []).map((h) => (
        <li key={String(h.id)} className="py-2"><p className="font-semibold">{String(h.key)}</p><p className="text-xs text-cocoa-700">{formatDateTimeBR(h.changed_at as string)} · de <code>{JSON.stringify(h.old_value)}</code> para <code>{JSON.stringify(h.new_value)}</code></p></li>))}</ul>
      {(q.data?.rows ?? []).length === 0 && <p className="text-sm text-cocoa-700">Sem alterações registradas.</p>}
    </Card>
  );
}
