import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
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
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[100] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end">
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
