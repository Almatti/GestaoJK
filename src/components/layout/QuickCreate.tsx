import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, ClipboardList, UserPlus, ArrowDownCircle, ClipboardCheck, ListTodo, CalendarPlus } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import type { Resource } from '@/domain/permissions';

const ACTIONS: { label: string; to: string; icon: typeof Plus; resource: Resource }[] = [
  { label: 'Novo pedido', to: '/pedidos/novo', icon: ClipboardList, resource: 'pedidos' },
  { label: 'Novo cliente', to: '/clientes?novo=1', icon: UserPlus, resource: 'clientes' },
  { label: 'Registrar recebimento', to: '/financeiro/receber', icon: ArrowDownCircle, resource: 'cobranca' },
  { label: 'Nova ordem de serviço', to: '/ordens-de-servico?novo=1', icon: ClipboardCheck, resource: 'tecnico' },
  { label: 'Nova tarefa', to: '/tarefas?novo=1', icon: ListTodo, resource: 'organizacao' },
  { label: 'Novo compromisso', to: '/agenda?novo=1', icon: CalendarPlus, resource: 'organizacao' }
];

export function QuickCreate() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { can } = useAuth();
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    addEventListener('mousedown', close);
    return () => removeEventListener('mousedown', close);
  }, []);
  const items = ACTIONS.filter((a) => can(a.resource, 'create') || (a.resource === 'cobranca' && can('cobranca', 'edit')));
  if (!items.length) return null;
  return (
    <div className="relative" ref={ref}>
      <span className="hidden sm:block"><Button size="sm" icon={<Plus className="size-4" />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Criar</Button></span>
      <span className="sm:hidden"><Button size="icon" aria-label="Criar" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} icon={<Plus className="size-5" />} /></span>
      {open && (
        <div role="menu" className="surface absolute right-0 top-12 z-40 w-64 rounded-2xl p-1.5 animate-rise">
          {items.map((a) => (
            <button key={a.to} role="menuitem" onClick={() => { navigate(a.to); setOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-cream-100">
              <a.icon className="size-4 text-tangerine-800" aria-hidden /> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
