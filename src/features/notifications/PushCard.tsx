import { useEffect, useState } from 'react';
import { BellRing, BellOff } from 'lucide-react';
import { Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { db } from '@/data/hooks';

/** Ativa/desativa as notificações no celular deste aparelho. */
export function PushCard() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => pushState().then(setState).catch(() => setState('unsupported'));
  useEffect(() => { void refresh(); }, []);
  if (db().mode !== 'supabase') return null;

  const on = async () => {
    setBusy(true);
    try { await enablePush(); toast('Notificações no celular ativadas neste aparelho.'); }
    catch (e) { toast(friendlyError(e), 'warning'); }
    setBusy(false); void refresh();
  };
  const off = async () => {
    setBusy(true);
    try { await disablePush(); toast('Notificações no celular desativadas neste aparelho.'); }
    catch (e) { toast(friendlyError(e), 'danger'); }
    setBusy(false); void refresh();
  };

  return (
    <Card opaque title="Notificações no celular" className="mb-4">
      <div className="space-y-3 text-sm">
        {state === 'unsupported' && <Alert tone="info">Este navegador não aceita notificações no celular. Use o Chrome (Android) ou instale o app na tela inicial.</Alert>}
        {state === 'needs-install' && <Alert tone="warning" title="No iPhone, instale o app primeiro">Toque em Compartilhar → "Adicionar à Tela de Início", abra o JK Gestão por esse ícone e ative aqui.</Alert>}
        {state === 'denied' && <Alert tone="warning">As notificações estão bloqueadas neste navegador. Libere em Configurações do site.</Alert>}
        {state === 'on' && <p>Este aparelho recebe avisos mesmo com o app fechado.</p>}
        {state === 'off' && <p>Ative para receber avisos de cobrança, protesto, estoque e tarefas direto no celular. A mensagem é genérica; os detalhes aparecem no sistema.</p>}
        {state === 'on' ? (
          <Button variant="secondary" icon={<BellOff className="size-4" />} loading={busy} onClick={off}>Desativar neste aparelho</Button>
        ) : state === 'off' ? (
          <Button icon={<BellRing className="size-4" />} loading={busy} onClick={on}>Ativar notificações no celular</Button>
        ) : null}
      </div>
    </Card>
  );
}
