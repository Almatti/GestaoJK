import { Alert } from '@/components/ui/Feedback';
import { db } from '@/data/hooks';

/** O módulo Festas grava no servidor (Supabase). Fora dele a tela avisa, sem dados simulados. */
export function FestasDataNotice() {
  if (db().mode === 'supabase') return null;
  return (
    <Alert tone="warning" title="Módulo Festas indisponível neste modo">
      As festas são gravadas no servidor e exigem a conexão com o Supabase configurada. Neste modo nenhum dado é criado ou simulado.
    </Alert>
  );
}

/** SHA-256 do arquivo (identifica o PDF para impedir importações duplicadas). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Anexa o arquivo original à festa (bucket privado; mesmo padrão dos demais anexos). */
export async function attachFile(entityType: string, entityId: string, file: File) {
  const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${entityType}/${entityId}/${crypto.randomUUID()}-${safe}`;
  const { db } = await import('@/data/hooks');
  await db().storage.upload(path, file);
  await db().insert('attachments', { entity_type: entityType, entity_id: entityId, storage_path: path, file_name: file.name, mime_type: file.type || 'application/pdf', size_bytes: file.size });
}

/** Número a partir de texto digitado com vírgula ou ponto ("1.234,5" também aceito). */
export function num(v: string | number | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
