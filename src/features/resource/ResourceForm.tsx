import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Checkbox, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useList, useSave } from '@/data/hooks';
import type { Row } from '@/data/types';
import { buildSchema, toDbValues, toFormValues } from './schema';
import type { FieldDef, ResourceDef } from './types';

const draftKey = (table: string, id?: string) => `jk-draft:${table}:${id ?? 'novo'}`;

function RefSelect({ field, register, error }: { field: FieldDef; register: ReturnType<ReturnType<typeof useForm>['register']>; error?: string }) {
  const ref = field.ref!;
  const q = useList(ref.table, { select: `${ref.valueColumn ?? 'id'},${ref.label}`, filters: ref.filters, order: [{ column: ref.label }], range: [0, 499] });
  const options = (q.data?.rows ?? []).map((r) => ({ value: String(r[ref.valueColumn ?? 'id']), label: String(r[ref.label] ?? '') }));
  return <SelectInput label={field.label} required={field.required} error={error} hint={field.help} options={options} placeholder={q.isLoading ? 'Carregando…' : 'Selecione…'} {...register} />;
}

export function ResourceForm({ def, row, open, onClose, onSaved }: { def: ResourceDef; row: Row | null; open: boolean; onClose: () => void; onSaved?: (r: Row) => void }) {
  const id = row ? String(row[def.idColumn ?? 'id']) : undefined;
  const schema = useMemo(() => buildSchema(def.fields), [def.fields]);
  const save = useSave(def.table);
  const toast = useToast();
  const [restored, setRestored] = useState(false);
  const form = useForm<Row>({ resolver: zodResolver(schema) as never, defaultValues: toFormValues(def.fields, row) });
  const { register, handleSubmit, formState, reset, watch } = form;

  useEffect(() => {
    if (!open) return;
    let values = toFormValues(def.fields, row);
    setRestored(false);
    if (def.draft) {
      try {
        const raw = localStorage.getItem(draftKey(def.table, id));
        if (raw) {
          values = { ...values, ...(JSON.parse(raw) as Row) };
          setRestored(true);
        }
      } catch {
        /* sem rascunho */
      }
    }
    reset(values);
  }, [open, row, def, id, reset]);

  // Salvamento automático de rascunho (somente recursos não sensíveis)
  useEffect(() => {
    if (!def.draft || !open) return;
    const sub = watch((v) => {
      try {
        localStorage.setItem(draftKey(def.table, id), JSON.stringify(v));
      } catch {
        /* ignore */
      }
    });
    return () => sub.unsubscribe();
  }, [watch, def, id, open]);

  // Prevenção de perda de formulário ao fechar a aba
  useEffect(() => {
    if (!open || !formState.isDirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [open, formState.isDirty]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey(def.table, id));
    } catch {
      /* ignore */
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      let dbValues = toDbValues(def.fields, values);
      if (def.beforeSave) dbValues = def.beforeSave(dbValues, !id);
      const saved = (await save.mutateAsync({ id, values: dbValues })) as Row;
      clearDraft();
      toast(`${def.singular} ${id ? 'atualizado(a)' : 'cadastrado(a)'} com sucesso.`);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  });

  const beforeClose = () => !formState.isDirty || def.draft || confirm('Existem alterações não salvas. Deseja descartá-las?');

  return (
    <Modal open={open} onClose={onClose} beforeClose={beforeClose} drawer title={id ? `Editar ${def.singular.toLowerCase()}` : `Novo(a) ${def.singular.toLowerCase()}`}
      footer={<><Button variant="secondary" onClick={() => beforeClose() && onClose()}>Cancelar</Button><Button type="submit" form="resource-form" loading={formState.isSubmitting}>Salvar</Button></>}>
      {restored && (
        <div className="mb-4">
          <Alert tone="info" title="Rascunho restaurado" action={<button type="button" className="text-sm font-semibold underline" onClick={() => { clearDraft(); reset(toFormValues(def.fields, row)); setRestored(false); }}>Descartar</button>}>
            Recuperamos as informações que você estava preenchendo.
          </Alert>
        </div>
      )}
      <form id="resource-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {def.fields.map((f) => {
          const err = formState.errors[f.name]?.message as string | undefined;
          const common = { label: f.label, required: f.required, error: err, hint: f.help, placeholder: f.placeholder };
          const wide = f.wide || f.type === 'textarea' || f.type === 'json' ? 'sm:col-span-2' : '';
          const reg = register(f.name);
          return (
            <div key={f.name} className={wide}>
              {f.type === 'textarea' || f.type === 'json' ? (
                <TextArea {...common} {...reg} className={f.type === 'json' ? 'font-mono text-xs' : undefined} />
              ) : f.type === 'select' ? (
                <SelectInput {...common} options={f.options ?? []} placeholder="Selecione…" {...reg} />
              ) : f.type === 'ref' ? (
                <RefSelect field={f} register={reg} error={err} />
              ) : f.type === 'boolean' ? (
                <Checkbox label={f.label} hint={f.help} {...reg} />
              ) : (
                <TextInput
                  {...common}
                  {...reg}
                  type={{ number: 'number', money: 'number', percent: 'number', date: 'date', datetime: 'datetime-local', time: 'time', email: 'email', phone: 'tel', color: 'color' }[f.type as string] ?? 'text'}
                  step={f.type === 'money' ? '0.01' : f.type === 'number' || f.type === 'percent' ? 'any' : undefined}
                  inputMode={f.type === 'money' || f.type === 'number' || f.type === 'percent' ? 'decimal' : undefined}
                  className={f.type === 'money' || f.type === 'number' ? 'num' : undefined}
                />
              )}
            </div>
          );
        })}
      </form>
    </Modal>
  );
}
