/**
 * Matriz de permissões (fonte de verdade replicada no seed SQL `role_permissions`).
 * A interface usa esta matriz apenas para esconder ações; a autorização efetiva é feita pelo banco (RLS).
 */
export const ROLES = {
  admin: 'Administrador geral',
  administrativo: 'Administrativo',
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  logistica: 'Logística',
  tecnico: 'Técnico',
  marketing: 'Marketing',
  operacional: 'Colaborador operacional',
  leitura: 'Somente leitura'
} as const;
export type Role = keyof typeof ROLES;

export const ACTIONS = ['view', 'create', 'edit', 'approve', 'cancel', 'export', 'archive'] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCES = {
  dashboard: 'Dashboard',
  clientes: 'Clientes e CRM',
  produtos: 'Produtos e serviços',
  pedidos: 'Pedidos',
  financeiro: 'Financeiro',
  cobranca: 'Boletos, Pix, cobranças e protestos',
  estoque: 'Estoque e compras',
  equipamentos: 'Patrimônio',
  logistica: 'Logística',
  tecnico: 'Ordens de serviço e manutenção',
  parceiros: 'Parceiros',
  organizacao: 'Agenda, tarefas, reuniões e notas',
  marketing: 'Marketing',
  estrategia: 'Metas e planejamento',
  festas: 'Festas (eventos e compras)',
  ia: 'Assistente inteligente',
  automacoes: 'Automações e mensagens',
  admin: 'Usuários, configurações, integrações e auditoria'
} as const;
export type Resource = keyof typeof RESOURCES;

const ALL: Action[] = [...ACTIONS];
const RW: Action[] = ['view', 'create', 'edit', 'archive'];
const RO: Action[] = ['view'];

export const PERMISSION_MATRIX: Record<Role, Partial<Record<Resource, Action[]>>> = {
  admin: Object.fromEntries(Object.keys(RESOURCES).map((r) => [r, ALL])) as Record<Resource, Action[]>,
  administrativo: {
    dashboard: RO, clientes: [...RW, 'export'], produtos: RW, pedidos: [...RW, 'cancel', 'export'], financeiro: [...RW, 'export'],
    cobranca: [...RW, 'export'], estoque: RW, equipamentos: RW, logistica: RW, tecnico: RW, parceiros: RW, organizacao: RW, festas: [...RW, 'cancel', 'export'],
    marketing: RO, estrategia: RW, ia: RO, automacoes: RW
  },
  financeiro: {
    dashboard: RO, clientes: RO, produtos: RO, pedidos: RO, financeiro: ALL, cobranca: ALL, parceiros: [...RW, 'approve'],
    organizacao: RW, estrategia: RO, ia: RO, automacoes: RW, estoque: RO, festas: ALL
  },
  comercial: {
    dashboard: RO, clientes: [...RW, 'export'], produtos: RO, pedidos: [...RW, 'cancel'], cobranca: RO, equipamentos: RO,
    logistica: RO, parceiros: RO, organizacao: RW, marketing: RO, estrategia: RO, ia: RO, festas: RW
  },
  logistica: {
    dashboard: RO, clientes: RO, pedidos: ['view', 'edit'], estoque: RW, equipamentos: RW, logistica: ALL, tecnico: RO, organizacao: RW, festas: ['view', 'edit']
  },
  tecnico: {
    clientes: RO, equipamentos: ['view', 'edit'], tecnico: RW, logistica: RO, estoque: RO, organizacao: RW
  },
  marketing: { dashboard: RO, clientes: RO, marketing: ALL, estrategia: RW, organizacao: RW, ia: RO },
  operacional: { clientes: RO, pedidos: RO, estoque: ['view', 'create'], equipamentos: RO, logistica: ['view', 'edit'], organizacao: RW, festas: ['view', 'edit'] },
  leitura: Object.fromEntries(Object.keys(RESOURCES).filter((r) => r !== 'admin').map((r) => [r, RO])) as Partial<Record<Resource, Action[]>>
};

export function can(role: Role | null | undefined, resource: Resource, action: Action = 'view'): boolean {
  if (!role) return false;
  return PERMISSION_MATRIX[role]?.[resource]?.includes(action) ?? false;
}

/** Linhas para o seed SQL (role, resource, action). */
export function permissionRows(): [Role, Resource, Action][] {
  const rows: [Role, Resource, Action][] = [];
  for (const [role, res] of Object.entries(PERMISSION_MATRIX) as [Role, Partial<Record<Resource, Action[]>>][]) {
    for (const [resource, actions] of Object.entries(res) as [Resource, Action[]][]) {
      for (const a of actions) rows.push([role, resource, a]);
    }
  }
  return rows;
}
