import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, CornerDownLeft } from 'lucide-react';
import { db } from '@/data/hooks';
import { NAVIGATION } from '@/config/navigation';
import { useAuth } from '@/features/auth/AuthContext';
import { Modal } from '@/components/ui/Overlay';

interface Hit { kind: string; id: string; title: string; subtitle?: string; link: string }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { can } = useAuth();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const search = useQuery({ queryKey: ['search', debounced], queryFn: () => db().rpc<Hit[]>('global_search', { p_query: debounced }), enabled: debounced.length >= 2 });
  const pages = useMemo(() => {
    const term = q.toLowerCase();
    return NAVIGATION.flatMap((g) => g.items.filter((i) => can(i.resource) && i.label.toLowerCase().includes(term)).map((i) => ({ kind: 'página', id: i.to, title: i.label, subtitle: g.label, link: i.to })));
  }, [q, can]);
  const hits: Hit[] = [...(search.data ?? []), ...(q ? pages.slice(0, 6) : pages.slice(0, 8))];

  const go = (h?: Hit) => {
    if (!h) return;
    navigate(h.link);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Busca global" size="md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-cocoa-700" aria-hidden />
        <input
          autoFocus
          className="input pl-10"
          placeholder="Digite nome, CNPJ, nº do pedido, código patrimonial…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            if (e.key === 'Enter') go(hits[active]);
          }}
          aria-label="Termo de busca"
        />
      </div>
      <ul className="mt-3 max-h-[50dvh] space-y-1 overflow-y-auto" role="listbox">
        {search.isFetching && <li className="px-3 py-2 text-sm text-cocoa-700">Buscando…</li>}
        {hits.map((h, i) => (
          <li key={`${h.kind}-${h.id}`} role="option" aria-selected={i === active}>
            <button onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${i === active ? 'bg-tangerine-100' : 'hover:bg-cream-100'}`}>
              <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-tangerine-900">{h.kind}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{h.title}</span>
              <span className="hidden truncate text-xs text-cocoa-700 sm:block">{h.subtitle}</span>
              {i === active && <CornerDownLeft className="size-4 text-cocoa-700" aria-hidden />}
            </button>
          </li>
        ))}
        {debounced.length >= 2 && !search.isFetching && hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-cocoa-700">Nada encontrado para “{debounced}”.</li>}
      </ul>
    </Modal>
  );
}
