import { useState } from 'react';
import { Download, ShieldCheck, RotateCcw } from 'lucide-react';
import { db } from '@/data/hooks';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { resetDemoDb } from '@/data/demo/client';
import { LocalBackupCard } from './LocalBackupCard';
import { ImportLocalCard } from './ImportLocalCard';
import { useAuth } from '@/features/auth/AuthContext';

const EXPORT_TABLES = ['company', 'settings', 'customers', 'customer_contacts', 'commercial_conditions', 'customer_product_prices', 'products', 'product_variants', 'keg_sizes', 'orders', 'order_items', 'receivables', 'payables', 'payments', 'payment_allocations', 'financial_accounts', 'financial_transactions', 'boletos', 'pix_charges', 'protest_records', 'stock_items', 'inventory_lots', 'inventory_movements', 'equipment', 'equipment_movements', 'services', 'service_orders', 'service_order_items', 'partners', 'partner_ledger', 'partner_settlements', 'calendar_events', 'tasks', 'meetings', 'notes', 'marketing_campaigns', 'marketing_contents', 'goals', 'message_templates', 'automation_rules'];

/** Exportação controlada (JSON). Backup completo (esquema + dados + arquivos) é feito por script no servidor — ver BACKUP_AND_RESTORE.md. */
export function BackupsPage() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const demo = db().mode === 'demo';
  const { can } = useAuth();
  const exportJson = async () => {
    setBusy(true);
    try {
      const out: Record<string, unknown[]> = {};
      for (const t of EXPORT_TABLES) out[t] = (await db().list(t, { range: [0, 49999] })).rows;
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), app: 'JK CHOPP GESTÃO', tables: out }, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `jk-chopp-exportacao-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      toast('Exportação gerada. Guarde o arquivo em local protegido (contém dados pessoais).', 'warning');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setBusy(false);
  };
  return (
    <div className="animate-fade-in">
      <PageHeader title="Backups e restauração" subtitle={db().mode === 'local' ? 'Modo local: o backup é o arquivo que guarda todos os seus dados.' : 'Exportações comuns não substituem um backup completo do banco e dos arquivos.'} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {db().mode === 'local' && <LocalBackupCard />}
        {db().mode === 'supabase' && can('admin', 'edit') && <ImportLocalCard />}
        {db().mode === 'supabase' && <Card opaque title="Backup completo (recomendado)">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Execute <code>scripts/backup.sh</code> com <code>SUPABASE_DB_URL</code> (conexão direta do Postgres) — gera dump de esquema + dados compactado.</li>
            <li>Exporte os arquivos do bucket privado <code>documentos</code> (o script lista as instruções).</li>
            <li>Guarde em local independente e criptografado (ex.: drive corporativo com acesso restrito).</li>
            <li>Teste a restauração periodicamente com <code>scripts/restore.sh</code> em um banco descartável.</li>
          </ol>
          <div className="mt-3"><Alert tone="info">Planos pagos do Supabase oferecem backups automáticos diários. No plano gratuito, mantenha a rotina de backup manual documentada.</Alert></div>
        </Card>}
        {db().mode !== 'local' && <Card opaque title="Exportação controlada de dados">
          <p className="text-sm">Gera um arquivo JSON com as tabelas que seu perfil pode ler (RLS aplicada). Útil para portabilidade e conferências — não restaura o sistema sozinho.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button icon={<Download className="size-4" />} loading={busy} onClick={exportJson}>Exportar JSON</Button>
            {demo && <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => { if (confirm('Restaurar os dados fictícios iniciais da demonstração?')) { resetDemoDb(); location.reload(); } }}>Restaurar demonstração</Button>}
          </div>
          <div className="mt-3"><Alert tone="warning"><span className="flex items-center gap-1"><ShieldCheck className="size-4" />LGPD: o arquivo contém dados pessoais. Compartilhe apenas com quem tem necessidade e base legal.</span></Alert></div>
        </Card>}
      </div>
    </div>
  );
}
