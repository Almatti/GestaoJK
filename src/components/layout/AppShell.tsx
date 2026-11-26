import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { Bell, ChevronsLeft, ChevronsRight, LogOut, Menu, Plus, Search, WifiOff, X, FlaskConical, HardDrive } from 'lucide-react';
import { table as localTable } from '@/data/demo/store';
import { NAVIGATION, MOBILE_NAV } from '@/config/navigation';
import { useAuth } from '@/features/auth/AuthContext';
import { ROLES } from '@/domain/permissions';
import { useList } from '@/data/hooks';
import { getDataClient } from '@/data/client';
import { Button } from '@/components/ui/Button';
import { CommandPalette } from './CommandPalette';
import { QuickCreate } from './QuickCreate';
import { Logo } from './Logo';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);
  return online;
}

const readPref = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};

/** Modo local: lembra de fazer backup (nunca feito ou há mais de 7 dias) e pede armazenamento persistente. */
function useBackupReminder(mode: string) {
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (mode !== 'local') return;
    navigator.storage?.persist?.().catch(() => undefined);
    const check = () => {
      try {
        const last = localTable('meta')[0]?.last_backup_at as string | null | undefined;
        setDue(!last || Date.now() - Date.parse(last) > 7 * 864e5);
      } catch {
        setDue(true);
      }
    };
    check();
    const t = setInterval(check, 60_000);
    addEventListener('jk-backup', check);
    return () => {
      clearInterval(t);
      removeEventListener('jk-backup', check);
    };
  }, [mode]);
  return due;
}

export function AppShell() {
  const { profile, can, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(() => readPref('jk-sidebar-collapsed', false));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const online = useOnline();
  const location = useLocation();
  const navigate = useNavigate();
  const mode = getDataClient().mode;
  const demo = mode === 'demo';
  const backupDue = useBackupReminder(mode);
  const notif = useList('notifications', { filters: [{ column: 'status', op: 'eq', value: 'nao_lida' }], count: true, range: [0, 0] }, { refetchInterval: 60_000 });

  useEffect(() => setMobileOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    try {
      localStorage.setItem('jk-sidebar-collapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const groups = useMemo(() => NAVIGATION.map((g) => ({ ...g, items: g.items.filter((i) => can(i.resource)) })).filter((g) => g.items.length), [can]);
  const unread = notif.data?.count ?? 0;

  const navList = (compact: boolean) => (
    <nav aria-label="Menu principal" className="flex-1 space-y-4 overflow-y-auto px-3 pb-6 [scrollbar-width:thin]">
      {groups.map((g) => (
        <div key={g.label}>
          {!compact && <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-cocoa-700/80">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  end={i.to === '/' || i.to === '/financeiro'}
                  title={compact ? i.label : undefined}
                  className={({ isActive }) =>
                    clsx(
                      'group flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition-all duration-200',
                      compact && 'justify-center px-0',
                      isActive && !i.to.includes('?')
                        ? 'bg-gradient-to-r from-tangerine-700 to-tangerine-800 text-white shadow-[var(--shadow-glow)]'
                        : 'text-cocoa-900 hover:bg-white/70'
                    )
                  }
                >
                  <i.icon className="size-[18px] shrink-0" aria-hidden />
                  {!compact && <span className="truncate">{i.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-xl focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>

      {/* Sidebar desktop/tablet */}
      <aside className={clsx('glass sticky top-0 z-30 hidden h-dvh shrink-0 flex-col rounded-r-[28px] border-l-0 transition-[width] duration-200 md:flex', collapsed ? 'w-[84px]' : 'w-[272px]')}>
        <div className={clsx('flex items-center gap-2 px-5 pb-4 pt-5', collapsed && 'justify-center px-0')}>
          <Logo compact={collapsed} />
        </div>
        {navList(collapsed)}
        <div className={clsx('border-t border-white/70 p-3', collapsed && 'flex flex-col items-center')}>
          <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            icon={collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}>{!collapsed && 'Recolher menu'}</Button>
        </div>
      </aside>

      {/* Drawer mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-cocoa-900/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="glass absolute inset-y-0 left-0 flex w-[86vw] max-w-[320px] flex-col rounded-r-[28px] animate-rise">
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <Logo />
              <Button variant="ghost" size="icon" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} icon={<X className="size-5" />} />
            </div>
            {navList(false)}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        {demo && (
          <div className="flex items-center justify-center gap-2 bg-gradient-to-r from-tangerine-800 to-tangerine-700 px-4 py-1.5 text-center text-xs font-semibold text-white">
            <FlaskConical className="size-4" aria-hidden /> AMBIENTE DE DEMONSTRAÇÃO — dados fictícios, salvos apenas neste navegador. Não use para dados reais.
          </div>
        )}
        {mode === 'local' && (
          <div className={`flex flex-wrap items-center justify-center gap-x-2 px-4 py-1.5 text-center text-xs font-semibold ${backupDue ? 'bg-warning-700 text-white' : 'bg-cocoa-900 text-cream-100'}`}>
            <HardDrive className="size-4" aria-hidden /> MODO LOCAL — os dados ficam salvos somente neste navegador/dispositivo.
            <NavLink to="/admin/backups" className="underline">{backupDue ? 'Faça um backup agora' : 'Backups'}</NavLink>
          </div>
        )}
        {!online && mode === 'supabase' && (
          <div role="alert" className="flex items-center justify-center gap-2 bg-danger-700 px-4 py-1.5 text-xs font-semibold text-white">
            <WifiOff className="size-4" aria-hidden /> Sem conexão. Alterações não serão salvas até a conexão voltar.
          </div>
        )}
        <header className="sticky top-0 z-20 px-3 pt-3 sm:px-6">
          <div className="glass flex items-center gap-2 rounded-[22px] px-3 py-2">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu" onClick={() => setMobileOpen(true)} icon={<Menu className="size-5" />} />
            <button onClick={() => setPaletteOpen(true)} className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/70 px-4 text-left text-sm text-cocoa-700 transition hover:bg-white sm:max-w-md">
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="truncate">Buscar clientes, pedidos, equipamentos…</span>
              <kbd className="ml-auto hidden rounded-md border border-tangerine-200 bg-white px-1.5 text-[11px] sm:inline">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <QuickCreate />
              <Button variant="ghost" size="icon" aria-label={`Notificações${unread ? ` (${unread} não lidas)` : ''}`} onClick={() => navigate('/notificacoes')}
                icon={<span className="relative"><Bell className="size-5" />{unread > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-tangerine-800 px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}</span>} />
              <div className="hidden items-center gap-2 pl-2 sm:flex">
                <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-tangerine-500 to-tangerine-800 text-sm font-bold text-white" aria-hidden>
                  {(profile?.full_name || profile?.email || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="hidden leading-tight xl:block">
                  <p className="max-w-40 truncate text-sm font-semibold">{profile?.full_name || profile?.email}</p>
                  <p className="text-xs text-cocoa-700">{profile ? ROLES[profile.role] : ''}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Sair" title="Sair" onClick={() => signOut()} icon={<LogOut className="size-5" />} />
            </div>
          </div>
        </header>

        <main id="conteudo" className="mx-auto w-full max-w-[1500px] px-3 pb-28 pt-5 sm:px-6 md:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Navegação inferior (celular) */}
      <nav aria-label="Navegação rápida" className="glass fixed inset-x-3 bottom-3 z-30 flex items-center justify-around rounded-[24px] px-2 py-1.5 md:hidden">
        {MOBILE_NAV.filter((i) => can(i.resource)).slice(0, 2).map((i) => <MobileLink key={i.to} {...i} />)}
        <button onClick={() => navigate('/pedidos/novo')} aria-label="Novo pedido" className="-mt-7 grid size-14 place-items-center rounded-full bg-gradient-to-br from-tangerine-700 to-tangerine-800 text-white shadow-[var(--shadow-glow)]">
          <Plus className="size-6" />
        </button>
        {MOBILE_NAV.filter((i) => can(i.resource)).slice(2).map((i) => <MobileLink key={i.to} {...i} />)}
      </nav>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function MobileLink({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Bell }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => clsx('flex w-16 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[11px] font-medium', isActive ? 'text-tangerine-900' : 'text-cocoa-700')}>
      <Icon className="size-5" aria-hidden />
      {label}
    </NavLink>
  );
}
