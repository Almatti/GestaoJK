import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router';
import { Search, MapPin } from 'lucide-react';
import { Modal } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert, Badge, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { formatDocument, isAlphanumericCnpj, isValidCnpj, isValidCpf, isValidEmail, isValidPhoneBR, normalizeCnpj, onlyDigits, VERIFICATION_STATUS } from '@/domain/documents';
import { lookupCep } from '@/lib/integrations/cep';
import { lookupCompany, companySnapshot, formatPhoneBR } from '@/lib/integrations/cnpj';

const optionalEmail = z.string().trim().refine((v) => !v || isValidEmail(v), 'E-mail inválido');
const optionalPhone = z.string().trim().refine((v) => !v || isValidPhoneBR(v), 'Telefone inválido (DDD + número)');

const schema = z
  .object({
    person_type: z.enum(['PF', 'PJ']),
    name: z.string().trim().min(2, 'Informe o nome / razão social'),
    trade_name: z.string().trim(),
    document: z.string().trim(),
    state_registration: z.string().trim(),
    segment: z.enum(['ponto_fixo', 'evento', 'ambos']),
    phone: optionalPhone, whatsapp: optionalPhone, email: optionalEmail, finance_email: optionalEmail,
    cep: z.string().trim(), street: z.string().trim(), number: z.string().trim(), complement: z.string().trim(),
    district: z.string().trim(), city: z.string().trim(), state: z.string().trim().max(2),
    manager_name: z.string().trim(), finance_contact_name: z.string().trim(), origin: z.string().trim(), notes: z.string().trim()
  })
  .superRefine((v, ctx) => {
    if (!v.document) return;
    const ok = v.person_type === 'PF' ? isValidCpf(v.document) : isValidCnpj(v.document);
    if (!ok) ctx.addIssue({ code: 'custom', path: ['document'], message: v.person_type === 'PF' ? 'CPF inválido (dígitos verificadores não conferem)' : 'CNPJ inválido (aceita numérico e alfanumérico)' });
  });
type FormValues = z.infer<typeof schema>;

const empty: FormValues = { person_type: 'PJ', name: '', trade_name: '', document: '', state_registration: '', segment: 'ponto_fixo', phone: '', whatsapp: '', email: '', finance_email: '', cep: '', street: '', number: '', complement: '', district: '', city: '', state: '', manager_name: '', finance_contact_name: '', origin: '', notes: '' };

export function CustomerForm({ row, open, onClose }: { row: Row | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const [duplicate, setDuplicate] = useState<Row | null>(null);
  const [lookup, setLookup] = useState<{ status: keyof typeof VERIFICATION_STATUS; source: string; notes?: string; summary?: Row; snapshot?: Row; checkedAt?: string } | null>(null);
  const [busy, setBusy] = useState<'cep' | 'cnpj' | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: empty });
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty }, watch, setValue, reset } = form;
  const personType = watch('person_type');
  const doc = watch('document');

  useEffect(() => {
    if (!open) return;
    setLookup(null);
    setDuplicate(null);
    reset(row ? (Object.fromEntries(Object.keys(empty).map((k) => [k, row[k] == null ? '' : String(row[k])])) as FormValues) : empty);
  }, [open, row, reset]);

  // Verificação de duplicidade ao digitar documento válido
  useEffect(() => {
    const n = normalizeCnpj(doc ?? '');
    if (!(n.length === 11 || n.length === 14)) return setDuplicate(null);
    const t = setTimeout(async () => {
      const r = await db().list<Row>('customers', { select: 'id,name,trade_name', filters: [{ column: 'document', op: 'eq', value: n }] });
      setDuplicate(r.rows.find((x) => x.id !== row?.id) ?? null);
    }, 300);
    return () => clearTimeout(t);
  }, [doc, row]);

  const fillCep = async () => {
    setBusy('cep');
    try {
      const r = await lookupCep(form.getValues('cep'));
      if (!r) toast('CEP não encontrado.', 'warning');
      else {
        (['street', 'district', 'city', 'state'] as const).forEach((k) => r[k] && setValue(k, r[k], { shouldDirty: true }));
        toast('Endereço preenchido pelo CEP.');
      }
    } catch {
      toast('Consulta de CEP indisponível. Preencha manualmente.', 'warning');
    }
    setBusy(null);
  };

  const fillCnpj = async () => {
    setBusy('cnpj');
    const source = 'Consulta de CNPJ';
    try {
      const r = await lookupCompany(form.getValues('document'), { purpose: 'customer' });
      if (!r.found || !r.data) {
        setLookup({ status: 'divergencia', source: r.source || source, notes: 'CNPJ não encontrado na base consultada.' });
      } else {
        const d = r.data;
        const put = (k: 'name' | 'trade_name' | 'state_registration' | 'street' | 'number' | 'complement' | 'district' | 'city' | 'state' | 'cep' | 'phone' | 'email', val: string, onlyIfEmpty = false) => {
          if (!val || (onlyIfEmpty && form.getValues(k))) return;
          setValue(k, val, { shouldDirty: true, shouldValidate: true });
        };
        put('name', d.legalName);
        put('trade_name', d.tradeName);
        put('state_registration', d.stateRegistration);
        (['street', 'number', 'complement', 'district', 'city', 'state', 'cep'] as const).forEach((k) => put(k, d[k]));
        // Contatos informados pela empresa à Receita só preenchem campos vazios (não sobrescrevem o contato comercial).
        put('phone', d.phone ? formatPhoneBR(d.phone) : '', true);
        put('email', d.email.toLowerCase(), true);
        const extras = [d.simples != null && `Simples: ${d.simples ? 'sim' : 'não'}`, d.simei && 'MEI', d.mainActivity && `CNAE ${d.mainActivity.code}`].filter(Boolean).join(' · ');
        setLookup({
          status: 'verificado_fonte_oficial', source: r.source, checkedAt: r.checkedAt,
          notes: `Situação cadastral: ${d.status || 'não informada'}${extras ? ` · ${extras}` : ''}${d.stale ? ' · dados do cache (fonte indisponível no momento)' : ''}`,
          summary: { situacao: d.status, municipio: d.city, atualizado_na_fonte: d.sourceUpdated },
          snapshot: companySnapshot(d, r.source, r.checkedAt)
        });
      }
    } catch (e) {
      setLookup({ status: 'consulta_indisponivel', source, notes: friendlyError(e) });
      toast(`${friendlyError(e)} — se preferir, confira no site da Receita Federal.`, 'warning');
    }
    setBusy(null);
  };

  const onSubmit = handleSubmit(async (v) => {
    try {
      const values: Row = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val === '' ? null : val]));
      values.document = v.document ? normalizeCnpj(v.document) : null;
      values.cep = v.cep ? onlyDigits(v.cep) : null;
      values.state = v.state ? v.state.toUpperCase() : null;
      if (lookup?.status === 'verificado_fonte_oficial') {
        values.verification_status = 'verificado_fonte_oficial';
        values.registration_status = (lookup.summary?.situacao as string) ?? null;
        if (lookup.snapshot) {
          values.company_data = lookup.snapshot;
          values.registration_checked_at = lookup.checkedAt ?? new Date().toISOString();
        }
      }
      const saved = row ? await db().update<Row>('customers', String(row.id), values) : await db().insert<Row>('customers', values);
      if (lookup) {
        await db().insert('customer_verifications', { customer_id: saved.id, status: lookup.status, source: lookup.source, notes: lookup.notes ?? null, payload_summary: lookup.summary ?? null });
      }
      invalidate();
      toast(row ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      onClose();
      if (!row) navigate(`/clientes/${saved.id}`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  });

  const docValid = doc && (personType === 'PF' ? isValidCpf(doc) : isValidCnpj(doc));

  return (
    <Modal open={open} onClose={onClose} drawer title={row ? 'Editar cliente' : 'Novo cliente'} beforeClose={() => !isDirty || confirm('Descartar alterações não salvas?')}
      footer={<><Button variant="secondary" onClick={() => (!isDirty || confirm('Descartar alterações não salvas?')) && onClose()}>Cancelar</Button><Button type="submit" form="customer-form" loading={isSubmitting} disabled={!!duplicate}>Salvar</Button></>}>
      <form id="customer-form" onSubmit={onSubmit} noValidate className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectInput label="Tipo de pessoa" options={[{ value: 'PJ', label: 'Pessoa jurídica' }, { value: 'PF', label: 'Pessoa física' }]} {...register('person_type')} />
          <SelectInput label="Segmento" options={[{ value: 'ponto_fixo', label: 'Ponto fixo' }, { value: 'evento', label: 'Eventos' }, { value: 'ambos', label: 'Ambos' }]} {...register('segment')} />
          <div className="sm:col-span-2">
            <div className="flex items-end gap-2">
              <TextInput wrapperClassName="flex-1" label={personType === 'PF' ? 'CPF' : 'CNPJ'} placeholder={personType === 'PF' ? '000.000.000-00' : '00.000.000/0000-00 ou alfanumérico'} error={errors.document?.message}
                hint={docValid ? <span className="flex flex-wrap items-center gap-1.5"><Badge tone="success">Formato válido</Badge>{isAlphanumericCnpj(doc) && <Badge tone="info">CNPJ alfanumérico</Badge>} Validade matemática não comprova existência ou titularidade.</span> : 'Opcional, mas recomendado.'}
                {...register('document', { onBlur: (e) => setValue('document', formatDocument(e.target.value)) })} />
              {personType === 'PJ' && <Button variant="secondary" icon={<Search className="size-4" />} loading={busy === 'cnpj'} disabled={!docValid} onClick={fillCnpj}>Consultar</Button>}
            </div>
            {duplicate && <div className="mt-2"><Alert tone="danger" title="Documento já cadastrado">Cliente existente: {String(duplicate.trade_name ?? duplicate.name)}. <button type="button" className="font-semibold underline" onClick={() => { onClose(); navigate(`/clientes/${duplicate.id}`); }}>Abrir cadastro</button></Alert></div>}
            {lookup && <div className="mt-2"><Alert tone={lookup.status === 'verificado_fonte_oficial' ? 'success' : 'warning'} title={VERIFICATION_STATUS[lookup.status]}>Fonte: {lookup.source} · {new Date().toLocaleString('pt-BR')}. {lookup.notes}</Alert></div>}
          </div>
          <TextInput wrapperClassName="sm:col-span-2" label={personType === 'PF' ? 'Nome completo' : 'Razão social'} required error={errors.name?.message} {...register('name')} />
          <TextInput label="Nome fantasia" {...register('trade_name')} />
          <TextInput label="Inscrição estadual" {...register('state_registration')} />
        </div>
        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 font-display font-bold">Contato</legend>
          <TextInput label="Telefone" type="tel" error={errors.phone?.message} {...register('phone')} />
          <TextInput label="WhatsApp" type="tel" error={errors.whatsapp?.message} {...register('whatsapp')} />
          <TextInput label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
          <TextInput label="E-mail financeiro" type="email" error={errors.finance_email?.message} {...register('finance_email')} />
          <TextInput label="Responsável pelo estabelecimento" {...register('manager_name')} />
          <TextInput label="Responsável financeiro" {...register('finance_contact_name')} />
        </fieldset>
        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <legend className="mb-2 font-display font-bold">Endereço</legend>
          <div className="flex items-end gap-2 sm:col-span-3">
            <TextInput wrapperClassName="flex-1" label="CEP" inputMode="numeric" {...register('cep')} />
            <Button variant="secondary" icon={<MapPin className="size-4" />} loading={busy === 'cep'} onClick={fillCep}>Buscar</Button>
          </div>
          <TextInput wrapperClassName="sm:col-span-3" label="Rua" {...register('street')} />
          <TextInput wrapperClassName="sm:col-span-2" label="Número" {...register('number')} />
          <TextInput wrapperClassName="sm:col-span-4" label="Complemento" {...register('complement')} />
          <TextInput wrapperClassName="sm:col-span-2" label="Bairro" {...register('district')} />
          <TextInput wrapperClassName="sm:col-span-3" label="Cidade" {...register('city')} />
          <TextInput wrapperClassName="sm:col-span-1" label="UF" maxLength={2} {...register('state')} />
        </fieldset>
        <div className="grid grid-cols-1 gap-4">
          <TextInput label="Origem do cliente" placeholder="Indicação, Instagram, campanha…" {...register('origin')} />
          <TextArea label="Observações" {...register('notes')} />
        </div>
      </form>
    </Modal>
  );
}
