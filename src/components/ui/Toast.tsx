import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from './Feedback';
import type { Tone } from '@/domain/collections';

interface ToastItem { id: number; tone: Tone; message: string }
const ToastCtx = createContext<(message: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, tone, message }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), tone === 'danger' ? 7000 : 4000);
  }, []);
  // Janelas (<dialog>) ficam na "camada superior" do navegador e cobriam os avisos. Os avisos também vão para a
  // camada superior (popover) e são reabertos a cada novo aviso para ficarem acima de qualquer janela aberta.
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = layer.current;
    if (!el || typeof el.showPopover !== 'function') return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      if (items.length) el.showPopover();
    } catch {
      /* navegador sem suporte a popover: continua como camada fixa comum */
    }
  }, [items]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div ref={layer} popover="manual" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 top-auto z-[100] m-0 flex w-full flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 px-4 lg:bottom-6 lg:items-end">
        {items.map((t) => (
          <div key={t.id} className="surface pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm animate-rise">
            <Badge tone={t.tone}>{t.tone === 'success' ? 'Sucesso' : t.tone === 'danger' ? 'Erro' : t.tone === 'warning' ? 'Atenção' : 'Info'}</Badge>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
