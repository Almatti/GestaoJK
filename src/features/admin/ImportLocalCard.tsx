import { useRef, useState } from 'react';
import { DatabaseZap, Upload } from 'lucide-react';
import { db } from '@/data/hooks';
import { Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { formatDateTimeBR } from '@/domain/dates';
import { parseLocalBackup, summarizeBackup, LOCAL_DB_KEY, IMPORTED_FLAG_KEY, type LocalTables } from './localImport';

/**
 * Leva os dados usados no MODO LOCAL (navegador) para o servidor. A operação é feita por uma função SQL
 * transacional (tudo ou nada) e idempotente: repetir não duplica registros.
 */
export function ImportLocalCard() {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const read = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const inBrowser = read(LOCAL_DB_KEY);
  const importedAt = read(IMPORTED_FLAG_KEY);

  const run = async (data: LocalTables, origin: string) => {
    const s = summarizeBackup(data);
    if (s.total === 0) return toast('O backup não contém clientes, pedidos ou lançamentos para importar.', 'warning');
    if (!confirm(`Importar para o servidor os dados ${origin}?\n\n${s.text}\n\nOs registros já existentes no servidor são mantidos (nada é apagado). Os lançamentos ficam vinculados ao seu usuário.`)) return;
    setBusy(true);
    try {
      const r = await db().rpc<{ imported_rows: number }>('import_local_backup', { p_data: data });
      try {
        localStorage.setItem(IMPORTED_FLAG_KEY, new Date().toISOString());
      } catch {
        /* sem armazenamento: apenas não lembra a data */
      }
      setResult(`${r.imported_rows} registro(s) importado(s).`);
      toast(r.imported_rows > 0 ? `Importação concluída: ${r.imported_rows} registro(s).` : 'Nada novo para importar (os dados já estavam no servidor).');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setBusy(false);
  };

  const fromFile = async (file: File) => {
    try {
      await run(parseLocalBackup(await file.text()), 'do arquivo de backup');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <Card opaque title="Trazer dados do modo local" className="lg:col-span-2">
      <div className="space-y-3">
        <p className="text-sm">Se você usou o sistema no modo local (dados no navegador) antes de configurar o servidor, importe esses dados aqui. Preços, totais, status e números de pedido são mantidos exatamente como estavam.</p>
        {importedAt && <Alert tone="info">Importação já feita neste navegador em {formatDateTimeBR(importedAt)}. Repetir não duplica registros.</Alert>}
        {result && <Alert tone="success">{result}</Alert>}
        <div className="flex flex-wrap gap-2">
          {inBrowser && <Button icon={<DatabaseZap className="size-4" />} loading={busy} onClick={() => {
            try {
              void run(parseLocalBackup(inBrowser, true), 'salvos neste navegador');
            } catch (e) {
              toast(friendlyError(e), 'danger');
            }
          }}>Importar dados deste navegador</Button>}
          <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && fromFile(e.target.files[0])} />
          <Button variant={inBrowser ? 'secondary' : 'primary'} icon={<Upload className="size-4" />} loading={busy} onClick={() => input.current?.click()}>Importar arquivo de backup</Button>
        </div>
        {!inBrowser && <p className="text-xs text-cocoa-700">Não há dados do modo local neste navegador. Use o arquivo de backup baixado em Administração → Backups no modo local.</p>}
      </div>
    </Card>
  );
}
