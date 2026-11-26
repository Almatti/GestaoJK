import { expect, test } from '@playwright/test';
import { login } from './helpers';

for (const route of ['/', '/clientes', '/financeiro/receber', '/agenda', '/pedidos/novo', '/tarefas']) {
  test(`sem rolagem horizontal no celular: ${route}`, async ({ page }) => {
    await login(page);
    await page.goto(route);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole('navigation', { name: 'Navegação rápida' })).toBeVisible();
  });
}
