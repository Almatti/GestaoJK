import { expect, test } from '@playwright/test';
import { collectErrors, login } from './helpers';

const ROUTES: [string, RegExp][] = [
  ['/clientes', /Clientes/], ['/pedidos', /Pedidos/], ['/produtos', /Produtos/], ['/precificacao', /precificação/], ['/inteligencia-comercial', /Saúde comercial/],
  ['/financeiro', /Visão financeira/], ['/financeiro/receber', /Contas a receber/], ['/financeiro/pagar', /Contas a pagar/], ['/financeiro/boletos', /Boletos/],
  ['/financeiro/pix', /Pix/], ['/financeiro/cobrancas', /Cobranças/], ['/financeiro/protestos', /Protestos/], ['/financeiro/fluxo-de-caixa', /Fluxo de caixa/],
  ['/relatorios', /Relatórios/], ['/estoque', /Estoque/], ['/equipamentos', /Equipamentos/], ['/ordens-de-servico', /Ordens de serviço/], ['/logistica', /Logística/],
  ['/compras', /Compras/], ['/festas', /Festas/], ['/festas/novo', /Nova festa/], ['/festas/importar', /Importar pedido em PDF/], ['/festas/planejamento', /Compras e checklist/], ['/parceiros', /Parceiros/], ['/agenda', /Agenda/], ['/tarefas', /Tarefas/], ['/reunioes', /Reuniões/], ['/notas', /notas/],
  ['/marketing', /Marketing/], ['/metas', /Metas/], ['/planejamento', /Planejamento/], ['/assistente', /Assistente/], ['/notificacoes', /notificações/],
  ['/admin/usuarios', /Usuários/], ['/admin/automacoes', /automações/], ['/admin/integracoes', /Integrações/], ['/admin/configuracoes', /Configurações/], ['/admin/auditoria', /Auditoria/], ['/admin/backups', /Backups/]
];

test('todas as telas abrem sem erros de execução', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  for (const [route, title] of ROUTES) {
    await page.goto(route);
    await expect(page.locator('h1').first(), route).toHaveText(title);
  }
  expect(errors).toEqual([]);
});

test('busca global encontra cliente', async ({ page }) => {
  await login(page);
  await page.keyboard.press('Control+k');
  await page.getByLabel('Termo de busca').fill('Esquina');
  await expect(page.getByRole('option').filter({ hasText: 'Bar Esquina Feliz' })).toBeVisible();
});

test('ambiente de demonstração é claramente sinalizado', async ({ page }) => {
  await login(page);
  await expect(page.getByText('AMBIENTE DE DEMONSTRAÇÃO')).toBeVisible();
});

test('festas no modo demonstração avisa que exige servidor e não simula dados', async ({ page }) => {
  await login(page);
  await page.goto('/festas');
  await expect(page.getByText('Módulo Festas indisponível neste modo')).toBeVisible();
  await page.goto('/festas/novo');
  await expect(page.getByText('Módulo Festas indisponível neste modo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar festa' })).toBeDisabled();
});
