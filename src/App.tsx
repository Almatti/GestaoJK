import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolveDataMode } from '@/config/env';
import { ToastProvider } from '@/components/ui/Toast';
import { LoadingBlock, EmptyState } from '@/components/ui/Feedback';
import { AppShell } from '@/components/layout/AppShell';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { LoginPage } from '@/features/auth/LoginPage';
import { LocalLoginPage } from '@/features/auth/LocalLoginPage';
import { getDataClient } from '@/data/client';
import { SetupPage } from '@/features/auth/SetupPage';
import { PendingPage } from '@/features/auth/PendingPage';
import { PwaUpdatePrompt } from '@/components/layout/PwaUpdatePrompt';
import type { Resource } from '@/domain/permissions';
import { ShieldAlert } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true }, mutations: { retry: 0 } }
});

const p = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await loader())[name] as React.ComponentType }));

const Dashboard = p(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
const Notifications = p(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage');
const Assistant = p(() => import('@/features/assistant/AssistantPage'), 'AssistantPage');
const Customers = p(() => import('@/features/customers/CustomersPage'), 'CustomersPage');
const CustomerProfile = p(() => import('@/features/customers/CustomerProfilePage'), 'CustomerProfilePage');
const Conditions = p(() => import('@/features/customers/CommercialConditionsPage'), 'CommercialConditionsPage');
const Health = p(() => import('@/features/customers/HealthPage'), 'HealthPage');
const Orders = p(() => import('@/features/orders/OrdersPage'), 'OrdersPage');
const OrderEditor = p(() => import('@/features/orders/OrderEditorPage'), 'OrderEditorPage');
const OrderImport = p(() => import('@/features/orders/OrderImportPage'), 'OrderImportPage');
const Products = p(() => import('@/features/products/ProductsPage'), 'ProductsPage');
const Services = p(() => import('@/features/products/ServicesPage'), 'ServicesPage');
const Pricing = p(() => import('@/features/products/PricingSimulatorPage'), 'PricingSimulatorPage');
const FinanceOverview = p(() => import('@/features/finance/FinanceOverviewPage'), 'FinanceOverviewPage');
const Receivables = p(() => import('@/features/finance/ReceivablesPage'), 'ReceivablesPage');
const Payables = p(() => import('@/features/finance/PayablesPage'), 'PayablesPage');
const Boletos = p(() => import('@/features/finance/BoletosPage'), 'BoletosPage');
const Festas = p(() => import('@/features/festas/FestasPage'), 'FestasPage');
const FestaDetail = p(() => import('@/features/festas/FestaDetailPage'), 'FestaDetailPage');
const FestaNovo = p(() => import('@/features/festas/FestaForm'), 'FestaNovoPage');
const FestaEditar = p(() => import('@/features/festas/FestaForm'), 'FestaEditarPage');
const FestaImportar = p(() => import('@/features/festas/FestaForm'), 'FestaImportarPage');
const FestasPlanning = p(() => import('@/features/festas/FestasPlanningPage'), 'FestasPlanningPage');
const Pix = p(() => import('@/features/finance/PixPage'), 'PixPage');
const Collections = p(() => import('@/features/finance/CollectionsPage'), 'CollectionsPage');
const Protests = p(() => import('@/features/finance/ProtestsPage'), 'ProtestsPage');
const CashFlow = p(() => import('@/features/finance/CashFlowPage'), 'CashFlowPage');
const Reconciliation = p(() => import('@/features/finance/ReconciliationPage'), 'ReconciliationPage');
const Reports = p(() => import('@/features/finance/ReportsPage'), 'ReportsPage');
const Stock = p(() => import('@/features/operations/StockPage'), 'StockPage');
const Equipment = p(() => import('@/features/operations/EquipmentPage'), 'EquipmentPage');
const EquipmentDetail = p(() => import('@/features/operations/EquipmentDetailPage'), 'EquipmentDetailPage');
const ServiceOrders = p(() => import('@/features/operations/ServiceOrdersPage'), 'ServiceOrdersPage');
const ServiceOrderDetail = p(() => import('@/features/operations/ServiceOrderDetailPage'), 'ServiceOrderDetailPage');
const Logistics = p(() => import('@/features/operations/LogisticsPage'), 'LogisticsPage');
const Purchases = p(() => import('@/features/operations/PurchasesPage'), 'PurchasesPage');
const PurchaseDetail = p(() => import('@/features/operations/PurchaseDetailPage'), 'PurchaseDetailPage');
const Partners = p(() => import('@/features/partners/PartnersPage'), 'PartnersPage');
const PartnerDetail = p(() => import('@/features/partners/PartnerDetailPage'), 'PartnerDetailPage');
const Agenda = p(() => import('@/features/organization/AgendaPage'), 'AgendaPage');
const Tasks = p(() => import('@/features/organization/TasksPage'), 'TasksPage');
const Routines = p(() => import('@/features/organization/RoutinesPage'), 'RoutinesPage');
const Meetings = p(() => import('@/features/organization/MeetingsPage'), 'MeetingsPage');
const MeetingDetail = p(() => import('@/features/organization/MeetingDetailPage'), 'MeetingDetailPage');
const Notes = p(() => import('@/features/organization/NotesPage'), 'NotesPage');
const Marketing = p(() => import('@/features/strategy/MarketingPage'), 'MarketingPage');
const Goals = p(() => import('@/features/strategy/GoalsPage'), 'GoalsPage');
const Planning = p(() => import('@/features/strategy/PlanningPage'), 'PlanningPage');
const Users = p(() => import('@/features/admin/UsersPage'), 'UsersPage');
const Automations = p(() => import('@/features/admin/AutomationsPage'), 'AutomationsPage');
const Templates = p(() => import('@/features/admin/TemplatesPage'), 'TemplatesPage');
const Integrations = p(() => import('@/features/admin/IntegrationsPage'), 'IntegrationsPage');
const Settings = p(() => import('@/features/admin/SettingsPage'), 'SettingsPage');
const Audit = p(() => import('@/features/admin/AuditPage'), 'AuditPage');
const Backups = p(() => import('@/features/admin/BackupsPage'), 'BackupsPage');

function Guard({ resource, children }: { resource: Resource; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(resource)) {
    return <div className="card"><EmptyState icon={<ShieldAlert className="size-7" />} title="Acesso restrito" description="Seu perfil não tem permissão para acessar este módulo. Se precisar, solicite a um administrador." /></div>;
  }
  return <Suspense fallback={<div className="card"><LoadingBlock rows={6} /></div>}>{children}</Suspense>;
}

function Protected() {
  const { loading, user, profile } = useAuth();
  if (loading) return <div className="p-8"><LoadingBlock rows={6} /></div>;
  if (!user) return getDataClient().mode === 'local' ? <LocalLoginPage /> : <LoginPage />;
  if (!profile?.active) return <PendingPage />;
  return <AppShell />;
}

const g = (resource: Resource, el: ReactNode) => <Guard resource={resource}>{el}</Guard>;

// Hash router quando hospedado como arquivo estático sem reescrita de rotas (ex.: link de uso imediato).
const createRouter = import.meta.env.VITE_ROUTER === 'hash' ? createHashRouter : createBrowserRouter;
const router = createRouter([
  {
    element: <Protected />,
    children: [
      { path: '/', element: g('dashboard', <Dashboard />) },
      { path: '/notificacoes', element: g('organizacao', <Notifications />) },
      { path: '/assistente', element: g('ia', <Assistant />) },
      { path: '/clientes', element: g('clientes', <Customers />) },
      { path: '/clientes/:id', element: g('clientes', <CustomerProfile />) },
      { path: '/condicoes-comerciais', element: g('clientes', <Conditions />) },
      { path: '/inteligencia-comercial', element: g('clientes', <Health />) },
      { path: '/pedidos', element: g('pedidos', <Orders />) },
      { path: '/pedidos/novo', element: g('pedidos', <OrderEditor />) },
      { path: '/pedidos/importar', element: g('pedidos', <OrderImport />) },
      { path: '/pedidos/:id', element: g('pedidos', <OrderEditor />) },
      { path: '/festas', element: g('festas', <Festas />) },
      { path: '/festas/novo', element: g('festas', <FestaNovo />) },
      { path: '/festas/importar', element: g('festas', <FestaImportar />) },
      { path: '/festas/planejamento', element: g('festas', <FestasPlanning />) },
      { path: '/festas/:id', element: g('festas', <FestaDetail />) },
      { path: '/festas/:id/editar', element: g('festas', <FestaEditar />) },
      { path: '/produtos', element: g('produtos', <Products />) },
      { path: '/servicos', element: g('produtos', <Services />) },
      { path: '/precificacao', element: g('produtos', <Pricing />) },
      { path: '/financeiro', element: g('financeiro', <FinanceOverview />) },
      { path: '/financeiro/receber', element: g('cobranca', <Receivables />) },
      { path: '/financeiro/pagar', element: g('financeiro', <Payables />) },
      { path: '/financeiro/boletos', element: g('cobranca', <Boletos />) },
      { path: '/financeiro/pix', element: g('cobranca', <Pix />) },
      { path: '/financeiro/cobrancas', element: g('cobranca', <Collections />) },
      { path: '/financeiro/protestos', element: g('cobranca', <Protests />) },
      { path: '/financeiro/fluxo-de-caixa', element: g('financeiro', <CashFlow />) },
      { path: '/financeiro/conciliacao', element: g('financeiro', <Reconciliation />) },
      { path: '/relatorios', element: g('financeiro', <Reports />) },
      { path: '/estoque', element: g('estoque', <Stock />) },
      { path: '/equipamentos', element: g('equipamentos', <Equipment />) },
      { path: '/equipamentos/:id', element: g('equipamentos', <EquipmentDetail />) },
      { path: '/ordens-de-servico', element: g('tecnico', <ServiceOrders />) },
      { path: '/ordens-de-servico/:id', element: g('tecnico', <ServiceOrderDetail />) },
      { path: '/logistica', element: g('logistica', <Logistics />) },
      { path: '/logistica/entregas', element: g('logistica', <Logistics />) },
      { path: '/compras', element: g('estoque', <Purchases />) },
      { path: '/compras/:id', element: g('estoque', <PurchaseDetail />) },
      { path: '/parceiros', element: g('parceiros', <Partners />) },
      { path: '/parceiros/:id', element: g('parceiros', <PartnerDetail />) },
      { path: '/agenda', element: g('organizacao', <Agenda />) },
      { path: '/tarefas', element: g('organizacao', <Tasks />) },
      { path: '/rotinas', element: g('organizacao', <Routines />) },
      { path: '/reunioes', element: g('organizacao', <Meetings />) },
      { path: '/reunioes/:id', element: g('organizacao', <MeetingDetail />) },
      { path: '/notas', element: g('organizacao', <Notes />) },
      { path: '/marketing', element: g('marketing', <Marketing />) },
      { path: '/metas', element: g('estrategia', <Goals />) },
      { path: '/planejamento', element: g('estrategia', <Planning />) },
      { path: '/admin/usuarios', element: g('admin', <Users />) },
      { path: '/admin/automacoes', element: g('automacoes', <Automations />) },
      { path: '/admin/modelos', element: g('automacoes', <Templates />) },
      { path: '/admin/integracoes', element: g('admin', <Integrations />) },
      { path: '/admin/configuracoes', element: g('admin', <Settings />) },
      { path: '/admin/auditoria', element: g('admin', <Audit />) },
      { path: '/admin/backups', element: g('admin', <Backups />) },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
]);

export function App() {
  if (resolveDataMode() === 'unconfigured') return <SetupPage />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          <PwaUpdatePrompt />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export { Outlet };
