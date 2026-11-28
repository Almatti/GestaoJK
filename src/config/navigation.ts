import {
  LayoutDashboard, Bell, Sparkles, Users, Store, PartyPopper, ClipboardList, Beer, Wrench, Handshake, Wallet, ArrowDownCircle,
  ArrowUpCircle, Barcode, QrCode, MessageCircle, Gavel, LineChart, ArrowLeftRight, Receipt, FileBarChart, Truck, PackageOpen,
  Boxes, Cpu, ClipboardCheck, CalendarDays, ListTodo, Repeat, Presentation, StickyNote, ShoppingCart, Megaphone, Target,
  Gauge, Users2, Compass, Bot, UserCog, ShieldCheck, Zap, MessageSquareText, Plug, Settings, History, DatabaseBackup, Calculator, Music, ShoppingBasket, type LucideIcon
} from 'lucide-react';
import type { Resource } from '@/domain/permissions';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  resource: Resource;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  { label: 'Visão geral', items: [
    { label: 'Dashboard', to: '/', icon: LayoutDashboard, resource: 'dashboard' },
    { label: 'Notificações', to: '/notificacoes', icon: Bell, resource: 'organizacao' },
    { label: 'Assistente inteligente', to: '/assistente', icon: Sparkles, resource: 'ia' }
  ] },
  { label: 'Comercial', items: [
    { label: 'Clientes', to: '/clientes', icon: Users, resource: 'clientes' },
    { label: 'Pontos fixos', to: '/clientes?segment=ponto_fixo', icon: Store, resource: 'clientes' },
    { label: 'Eventos', to: '/pedidos?kind=evento', icon: PartyPopper, resource: 'pedidos' },
    { label: 'Pedidos', to: '/pedidos', icon: ClipboardList, resource: 'pedidos' },
    { label: 'Festas', to: '/festas', icon: Music, resource: 'festas' },
    { label: 'Produtos', to: '/produtos', icon: Beer, resource: 'produtos' },
    { label: 'Serviços', to: '/servicos', icon: Wrench, resource: 'produtos' },
    { label: 'Condições comerciais', to: '/condicoes-comerciais', icon: Handshake, resource: 'clientes' },
    { label: 'Simulador de preços', to: '/precificacao', icon: Calculator, resource: 'produtos' }
  ] },
  { label: 'Financeiro', items: [
    { label: 'Visão financeira', to: '/financeiro', icon: Wallet, resource: 'financeiro' },
    { label: 'Contas a receber', to: '/financeiro/receber', icon: ArrowDownCircle, resource: 'cobranca' },
    { label: 'Contas a pagar', to: '/financeiro/pagar', icon: ArrowUpCircle, resource: 'financeiro' },
    { label: 'Boletos', to: '/financeiro/boletos', icon: Barcode, resource: 'cobranca' },
    { label: 'Pix', to: '/financeiro/pix', icon: QrCode, resource: 'cobranca' },
    { label: 'Cobranças', to: '/financeiro/cobrancas', icon: MessageCircle, resource: 'cobranca' },
    { label: 'Protestos', to: '/financeiro/protestos', icon: Gavel, resource: 'cobranca' },
    { label: 'Fluxo de caixa', to: '/financeiro/fluxo-de-caixa', icon: LineChart, resource: 'financeiro' },
    { label: 'Conciliação', to: '/financeiro/conciliacao', icon: ArrowLeftRight, resource: 'financeiro' },
    { label: 'Despesas', to: '/financeiro/pagar?status=em_aberto', icon: Receipt, resource: 'financeiro' },
    { label: 'Relatórios', to: '/relatorios', icon: FileBarChart, resource: 'financeiro' }
  ] },
  { label: 'Operacional', items: [
    { label: 'Logística', to: '/logistica', icon: Truck, resource: 'logistica' },
    { label: 'Entregas e recolhimentos', to: '/logistica/entregas', icon: PackageOpen, resource: 'logistica' },
    { label: 'Estoque', to: '/estoque', icon: Boxes, resource: 'estoque' },
    { label: 'Equipamentos', to: '/equipamentos', icon: Cpu, resource: 'equipamentos' },
    { label: 'Ordens de serviço', to: '/ordens-de-servico', icon: ClipboardCheck, resource: 'tecnico' },
    { label: 'Compras de festas', to: '/festas/planejamento', icon: ShoppingBasket, resource: 'festas' },
    { label: 'Compras e fornecedores', to: '/compras', icon: ShoppingCart, resource: 'estoque' }
  ] },
  { label: 'Organização', items: [
    { label: 'Agenda', to: '/agenda', icon: CalendarDays, resource: 'organizacao' },
    { label: 'Tarefas', to: '/tarefas', icon: ListTodo, resource: 'organizacao' },
    { label: 'Rotinas e hábitos', to: '/rotinas', icon: Repeat, resource: 'organizacao' },
    { label: 'Reuniões', to: '/reunioes', icon: Presentation, resource: 'organizacao' },
    { label: 'Blocos de notas', to: '/notas', icon: StickyNote, resource: 'organizacao' }
  ] },
  { label: 'Estratégia', items: [
    { label: 'Marketing', to: '/marketing', icon: Megaphone, resource: 'marketing' },
    { label: 'Metas e indicadores', to: '/metas', icon: Target, resource: 'estrategia' },
    { label: 'Saúde comercial', to: '/inteligencia-comercial', icon: Gauge, resource: 'clientes' },
    { label: 'Parceiros', to: '/parceiros', icon: Users2, resource: 'parceiros' },
    { label: 'Planejamento estratégico', to: '/planejamento', icon: Compass, resource: 'estrategia' }
  ] },
  { label: 'Administração', items: [
    { label: 'Usuários e permissões', to: '/admin/usuarios', icon: UserCog, resource: 'admin' },
    { label: 'Automações', to: '/admin/automacoes', icon: Zap, resource: 'automacoes' },
    { label: 'Modelos de mensagens', to: '/admin/modelos', icon: MessageSquareText, resource: 'automacoes' },
    { label: 'Integrações', to: '/admin/integracoes', icon: Plug, resource: 'admin' },
    { label: 'Configurações', to: '/admin/configuracoes', icon: Settings, resource: 'admin' },
    { label: 'Auditoria', to: '/admin/auditoria', icon: History, resource: 'admin' },
    { label: 'Backups', to: '/admin/backups', icon: DatabaseBackup, resource: 'admin' }
  ] }
];

export const MOBILE_NAV: { label: string; to: string; icon: LucideIcon; resource: Resource }[] = [
  { label: 'Início', to: '/', icon: LayoutDashboard, resource: 'dashboard' },
  { label: 'Clientes', to: '/clientes', icon: Users, resource: 'clientes' },
  { label: 'Financeiro', to: '/financeiro/receber', icon: Wallet, resource: 'cobranca' },
  { label: 'Agenda', to: '/agenda', icon: CalendarDays, resource: 'organizacao' }
];

export { Bot, ShieldCheck };
