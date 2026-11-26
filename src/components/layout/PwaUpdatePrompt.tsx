import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Atualizações controladas: o usuário decide quando aplicar a nova versão. */
export function PwaUpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
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
