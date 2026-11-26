import { useRef, useState } from 'react';
import { Download, Upload, KeyRound, HardDrive } from 'lucide-react';
import { Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { dbSize, exportDb, importDb, saveDb, table, type Tables } from '@/data/demo/store';
import { sha256 } from '@/data/demo/client';
import { formatDateTimeBR } from '@/domain/dates';

const FORMAT = 'jk-chopp-gestao/backup-local';

/**
 * Backup/restauração do MODO LOCAL. O arquivo contém TODOS os dados deste navegador e serve também
 * para levar os dados a outro dispositivo e, futuramente, migrar para o Supabase.
 */
export function LocalBackupCard() {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const meta = table('meta')[0] ?? {};
  const [last, setLast] = useState<string | null>((meta.last_backup_at as string) ?? null);
  const [pin, setPin] = useState('');
  const size = dbSize();

  const download = () => {
    try {
      const data = exportDb();
      const now = new Date().toISOString();
      const blob = new Blob([JSON.stringify({ format: FORMAT, version: 1, exported_at: now, data }, null, 1)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `jk-chopp-backup-${now.slice(0, 16).replace(/[:T]/g, '-')}.json` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      const m = table('meta')[0];
      if (m) m.last_backup_at = now;
      else table('meta').push({ id: 'meta', last_backup_at: now });
      saveDb();
      setLast(now);
      window.dispatchEvent(new Event('jk-backup'));
      toast('Backup baixado. Guarde o arquivo em local seguro (pendrive, nuvem da empresa).');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const restore = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { format?: string; data?: Tables };
      if (parsed.format !== FORMAT || !parsed.data || !Array.isArray(parsed.data.customers)) throw new Error('Arquivo não é um backup válido do JK CHOPP GESTÃO.');
      const counts = `${parsed.data.customers.length} cliente(s), ${(parsed.data.orders ?? []).length} pedido(s), ${(parsed.data.receivables ?? []).length} título(s)`;
      if (!confirm(`Restaurar este backup (${counts})?\n\nTODOS os dados atuais deste navegador serão substituídos. Recomenda-se baixar um backup atual antes.`)) return;
      importDb(parsed.data);
      toast('Backup restaurado. Recarregando…');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const savePin = async () => {
    const m = table('meta')[0] ?? (table('meta').push({ id: 'meta' }), table('meta')[0]!);
    if (pin && !/^\d{4,8}$/.test(pin)) return toast('Use de 4 a 8 números.', 'warning');
    m.pin_hash = pin ? await sha256(pin) : null;
    saveDb();
    setPin('');
    toast(pin ? 'PIN definido. Será pedido na próxima entrada.' : 'PIN removido.');
  };

  return (
    <Card opaque title="Modo local — seus dados neste dispositivo" className="lg:col-span-2">
      <div className="space-y-4">
        <Alert tone={last ? 'info' : 'warning'} title={last ? `Último backup: ${formatDateTimeBR(last)}` : 'Nenhum backup feito ainda'}>
          No modo local, os dados existem apenas neste navegador. Limpar os dados do navegador, trocar de aparelho ou usar janela anônima faz perder o acesso. <strong>Baixe um backup pelo menos uma vez por semana</strong> (ideal: ao fim de cada dia).
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Download className="size-4" />} onClick={download}>Baixar backup completo</Button>
          <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
          <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>Restaurar de um backup</Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-cocoa-700"><HardDrive className="size-3.5" /> Espaço usado: {(size / 1024 / 1024).toFixed(2)} MB (limite típico do navegador ≈ 5 MB). Para usar em outro aparelho, restaure o backup nele. Quando o servidor (Supabase) for configurado, este arquivo será importado para lá.</p>
        <div className="flex flex-wrap items-end gap-2 border-t border-tangerine-100 pt-4">
          <TextInput wrapperClassName="w-48" label={meta.pin_hash ? 'Novo PIN (vazio = remover)' : 'Definir PIN de acesso'} type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
          <Button variant="soft" icon={<KeyRound className="size-4" />} onClick={savePin}>Salvar PIN</Button>
          <p className="w-full text-xs text-cocoa-700">O PIN evita o uso por terceiros neste aparelho, mas não criptografa os dados. Para segurança completa e vários usuários com permissões, configure o servidor.</p>
        </div>
      </div>
    </Card>
  );
}
