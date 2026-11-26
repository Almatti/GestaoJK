import { useState } from 'react';
import { Copy } from 'lucide-react';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { templatesDef } from '@/features/resource/definitions';
import { Button } from '@/components/ui/Button';
import { db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useToast } from '@/components/ui/Toast';
import { friendlyError } from '@/components/ui/Feedback';
import { useAuth } from '@/features/auth/AuthContext';

export function TemplatesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const duplicate = async (r: Row) => {
    setBusy(true);
    try {
      await db().insert('message_templates', { key: `${String(r.key)}_copia_${Date.now().toString(36)}`, name: `${String(r.name)} (cópia)`, category: r.category, body: r.body, channel: r.channel ?? 'whatsapp', active: false });
      invalidate();
      toast('Modelo duplicado (inativo). Edite e ative quando quiser.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setBusy(false);
  };
  return <ResourcePage def={{ ...templatesDef, rowActions: (r) => (can('automacoes', 'create') ? <Button size="icon" variant="ghost" aria-label="Duplicar" title="Duplicar" disabled={busy} onClick={() => duplicate(r)} icon={<Copy className="size-4" />} /> : null) }} />;
}
