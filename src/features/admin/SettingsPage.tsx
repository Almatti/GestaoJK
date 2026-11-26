import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { lookupCompany, companySnapshot, formatPhoneBR } from '@/lib/integrations/cnpj';
import { useAuth } from '@/features/auth/AuthContext';
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
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const company = q.data?.rows[0];
  const checkedAt = (company?.registry_checked_at as string | null) ?? null;
  const reg = (company?.registry_data as Record<string, unknown> | null) ?? null;
  const maxAge = Number((useList<Row>('settings', { range: [0, 499] }).data?.rows.find((r) => r.key === 'cnpj.max_age_days')?.value as number | undefined) ?? 30);

  /** Consulta o CNPJ e grava os dados oficiais da empresa (fonte e data registradas). */
  const refreshFromCnpj = async (silent = false) => {
    const doc = v.document || String(company?.document ?? '');
    if (!doc || !isValidCnpj(doc)) {
      if (!silent) toast('Informe um CNPJ válido da empresa.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const r = await lookupCompany(doc, { purpose: 'company', refresh: !silent });
      if (!r.found || !r.data) throw new Error('CNPJ não encontrado na Receita Federal.');
      const d = r.data;
      const next = {
        ...v, document: normalizeCnpj(doc), legal_name: d.legalName || (v.legal_name ?? ''), trade_name: d.tradeName || v.trade_name || d.legalName,
        state_registration: d.stateRegistration || (v.state_registration ?? ''),
        phone: v.phone || (d.phone ? formatPhoneBR(d.phone) : ''), email: v.email || d.email.toLowerCase()
      };
      const nextAddr = { ...addr, cep: d.cep, street: d.street, number: d.number, complement: d.complement, district: d.district, city: d.city, state: d.state };
      await db().update('company', '1', {
        legal_name: next.legal_name || null, trade_name: next.trade_name || null, document: next.document, state_registration: next.state_registration || null,
        phone: next.phone || null, email: next.email || null, address: nextAddr,
        registry_data: companySnapshot(d, r.source, r.checkedAt, r.registrationsChecked), registry_checked_at: r.checkedAt
      });
      setV(next);
      setAddr(nextAddr);
      invalidate();
      if (!silent) toast(`Dados da empresa atualizados pela Receita Federal (${r.source}).`);
    } catch (e) {
      if (!silent) toast(friendlyError(e), 'danger');
    }
    setBusy(false);
  };

  // Mantém os dados da empresa atualizados: ao abrir, se a última consulta passou do prazo configurado, reconsulta.
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoDone.current || !company?.document || db().mode !== 'supabase' || !can('admin', 'edit')) return;
    const age = checkedAt ? (Date.now() - new Date(checkedAt).getTime()) / 86_400_000 : Infinity;
    if (age > maxAge) {
      autoDone.current = true;
      void refreshFromCnpj(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.document, checkedAt, maxAge]);
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
        <div className="flex items-end gap-2">
          <TextInput wrapperClassName="flex-1" label="CNPJ" value={v.document ?? ''} onChange={set('document')} />
          <Button variant="soft" icon={<RefreshCw className="size-4" />} loading={busy} onClick={() => refreshFromCnpj(false)}>Atualizar pela Receita</Button>
        </div>
        <TextInput label="Inscrição estadual" value={v.state_registration ?? ''} onChange={set('state_registration')} />
        <TextInput label="Telefone" value={v.phone ?? ''} onChange={set('phone')} />
        <TextInput label="E-mail" value={v.email ?? ''} onChange={set('email')} />
        <TextInput label="CEP" value={addr.cep ?? ''} onChange={(e) => setAddr((s) => ({ ...s, cep: e.target.value }))} />
        <TextInput label="Endereço" value={addr.street ?? ''} onChange={(e) => setAddr((s) => ({ ...s, street: e.target.value }))} />
        <TextInput label="Número" value={addr.number ?? ''} onChange={(e) => setAddr((s) => ({ ...s, number: e.target.value }))} />
        <TextInput label="Complemento" value={addr.complement ?? ''} onChange={(e) => setAddr((s) => ({ ...s, complement: e.target.value }))} />
        <TextInput label="Bairro" value={addr.district ?? ''} onChange={(e) => setAddr((s) => ({ ...s, district: e.target.value }))} />
        <TextInput label="Cidade" value={addr.city ?? ''} onChange={(e) => setAddr((s) => ({ ...s, city: e.target.value }))} />
        <TextInput label="UF" maxLength={2} value={addr.state ?? ''} onChange={(e) => setAddr((s) => ({ ...s, state: e.target.value.toUpperCase() }))} />
        <TextInput label="Chave Pix" value={v.pix_key ?? ''} onChange={set('pix_key')} hint={v.pix_key ? `Tipo: ${detectPixKeyType(v.pix_key) ?? 'não reconhecido'}` : 'Usada no QR Code estático e nas mensagens.'} />
        <TextInput label="Nome do recebedor (Pix, até 25)" maxLength={25} value={v.pix_merchant_name ?? ''} onChange={set('pix_merchant_name')} />
        <TextInput label="Cidade do recebedor (Pix, até 15)" maxLength={15} value={v.pix_merchant_city ?? ''} onChange={set('pix_merchant_city')} />
      </div>
      {reg && (
        <div className="mt-4 rounded-xl border border-tangerine-100 bg-white/60 p-3 text-sm">
          <p className="font-semibold">Dados oficiais (Receita Federal)</p>
          <p className="text-xs text-cocoa-700">Consultado em {checkedAt ? formatDateTimeBR(checkedAt) : '—'} · {String(reg.source ?? '')}{reg.stale ? ' · dados do cache (fonte indisponível no momento)' : ''}. Atualização automática a cada {maxAge} dia(s), configurável em Parâmetros → Consulta CNPJ.</p>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <div><dt className="inline text-cocoa-700">Situação: </dt><dd className="inline font-semibold">{String(reg.status ?? '—')}</dd></div>
            <div><dt className="inline text-cocoa-700">Abertura: </dt><dd className="inline">{reg.founded ? String(reg.founded).split('-').reverse().join('/') : '—'}</dd></div>
            <div><dt className="inline text-cocoa-700">Natureza: </dt><dd className="inline">{String(reg.nature ?? '—')}</dd></div>
            <div><dt className="inline text-cocoa-700">Porte: </dt><dd className="inline">{String(reg.size ?? '—')}</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-cocoa-700">Inscrição estadual: </dt><dd className="inline font-semibold">{!reg.registrations_checked ? 'não consultada — cadastre a chave da API comercial CNPJá (CNPJA_API_KEY)' : (reg.registrations as { number: string; state: string; status: string; enabled: boolean }[] | undefined)?.length ? (reg.registrations as { number: string; state: string; status: string; enabled: boolean }[]).map((x) => `${x.number}/${x.state} (${x.status || (x.enabled ? 'ativa' : 'inativa')})`).join('; ') : 'nenhuma inscrição na UF (isenta ou não inscrita)'}</dd></div>
            <div><dt className="inline text-cocoa-700">Simples Nacional: </dt><dd className="inline">{reg.simples == null ? 'não consultado' : reg.simples ? 'optante' : 'não optante'}{reg.simei ? ' (MEI)' : ''}</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-cocoa-700">Atividade principal: </dt><dd className="inline">{reg.main_activity ? `${(reg.main_activity as { code: string }).code} — ${(reg.main_activity as { text: string }).text}` : '—'}</dd></div>
          </dl>
        </div>
      )}
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
