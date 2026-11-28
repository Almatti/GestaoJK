import { useRef, useState } from 'react';
import { Paperclip, Download, Upload, Trash2 } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { Card } from './Layout';
import { Button } from './Button';
import { EmptyState, friendlyError, Alert } from './Feedback';
import { useToast } from './Toast';
import { formatDateTimeBR } from '@/domain/dates';

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(png|jpe?g|webp|heic)|text\/plain|application\/(vnd\.openxmlformats|msword|vnd\.ms-excel)|.*\.(ofx|ret|rem))/;

/** Anexos em bucket PRIVADO; download por URL temporária assinada (5 minutos). */
/**
 * Anexos. "Remover" arquiva o anexo (não apaga): ele sai da lista e a ação fica registrada na auditoria.
 * Só aparece quando `canRemove` for verdadeiro (quem pode editar o registro).
 */
export function Attachments({ entityType, entityId, title = 'Documentos e anexos', canRemove = false }: { entityType: string; entityId: string; title?: string; canRemove?: boolean }) {
  const q = useList<Row>('attachments', { filters: [{ column: 'entity_type', op: 'eq', value: entityType }, { column: 'entity_id', op: 'eq', value: entityId }, { column: 'archived_at', op: 'is', value: null }], order: [{ column: 'created_at', ascending: false }] });
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const demo = db().mode !== 'supabase';

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) return toast('Arquivo maior que 15 MB.', 'danger');
    if (!ALLOWED.test(file.type || file.name)) return toast('Tipo de arquivo não permitido.', 'danger');
    setBusy(true);
    try {
      const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
      const path = `${entityType}/${entityId}/${crypto.randomUUID()}-${safe}`;
      await db().storage.upload(path, file);
      await db().insert('attachments', { entity_type: entityType, entity_id: entityId, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
      invalidate();
      toast('Arquivo anexado.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setBusy(false);
  };

  const remove = async (a: Row) => {
    if (!confirm(`Remover o anexo "${String(a.file_name)}"? Ele sai da lista, mas fica registrado na auditoria.`)) return;
    try {
      await db().update('attachments', String(a.id), { archived_at: new Date().toISOString() });
      invalidate();
      toast('Anexo removido.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const open = async (path: string) => {
    try {
      window.open(await db().storage.signedUrl(path, 300), '_blank', 'noopener');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <Card opaque title={title} action={<><input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /><Button size="sm" variant="soft" icon={<Upload className="size-4" />} loading={busy} disabled={demo} onClick={() => input.current?.click()}>Anexar</Button></>}>
      {demo && <div className="mb-3"><Alert tone="info">Envio de arquivos ficará disponível quando o servidor (Supabase) for configurado. Por enquanto, guarde os arquivos na pasta da empresa e anote a referência nas observações.</Alert></div>}
      {(q.data?.rows ?? []).length === 0 ? <EmptyState icon={<Paperclip className="size-7" />} title="Nenhum arquivo" description="Contratos, comprovantes, fotos e documentos ficam em armazenamento privado." /> : (
        <ul className="divide-y divide-tangerine-100">{q.data!.rows.map((a) => (
          <li key={String(a.id)} className="flex items-center gap-3 py-2.5 text-sm">
            <Paperclip className="size-4 text-cocoa-700" aria-hidden /><span className="min-w-0 flex-1 truncate">{String(a.file_name)}</span>
            <span className="hidden text-xs text-cocoa-700 sm:inline">{formatDateTimeBR(a.created_at as string)}</span>
            <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => open(String(a.storage_path))}>Abrir</Button>
            {canRemove && <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => remove(a)}>Remover</Button>}
          </li>))}</ul>
      )}
    </Card>
  );
}
