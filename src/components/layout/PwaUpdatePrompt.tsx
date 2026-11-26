import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Atualizações controladas: o usuário decide quando aplicar a nova versão. */
export function PwaUpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    // App instalado costuma ficar aberto por dias: verifica novas versões a cada 15 min e ao voltar para o app.
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => { if (navigator.onLine) void reg.update().catch(() => undefined); };
      setInterval(check, 15 * 60_000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    }
  });
  if (!needRefresh) return null;
  return (
    <div role="status" className="glass fixed inset-x-3 bottom-24 z-[90] mx-auto flex max-w-md items-center gap-3 rounded-2xl p-3 md:bottom-6">
      <RefreshCw className="size-5 text-tangerine-800" aria-hidden />
      <p className="flex-1 text-sm">Nova versão disponível.</p>
      <Button size="sm" variant="secondary" onClick={() => setNeedRefresh(false)}>Depois</Button>
      <Button size="sm" onClick={() => updateServiceWorker(true)}>Atualizar</Button>
    </div>
  );
}
