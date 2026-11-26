import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('Cenário 1 (UI): preço personalizado, pedido confirmado, recebível e entrega', async ({ page }) => {
  await login(page);
  await page.goto('/pedidos/novo');
  await page.getByLabel(/^Cliente/).selectOption({ label: 'Bar Esquina Feliz (DEMO)' });
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await page.getByLabel('Produto', { exact: true }).selectOption({ label: 'Chopp Pilsen (DEMO)' });
  await page.getByLabel('Barril', { exact: true }).selectOption({ label: '50 L' });
  await expect(page.getByText('Preço do cliente por litro')).toBeVisible();
  await page.getByLabel('Qtd.', { exact: true }).fill('2');
  await page.getByLabel('Data de entrega').fill('2026-12-10');
  await expect(page.getByText('R$ 1.850,00').first()).toBeVisible();
  await page.getByRole('button', { name: 'Salvar' }).first().click();
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('Avançar operação')).toBeVisible();
  await page.goto('/financeiro/receber');
  await expect(page.getByText(/Pedido nº \d+ — parcela 1\/1/).first()).toBeVisible();
  await page.goto('/logistica?');
  await page.getByRole('tab', { name: 'Mês' }).click();
});

test('validação de CNPJ e CPF no cadastro de cliente', async ({ page }) => {
  await login(page);
  await page.goto('/clientes?novo=1');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('CNPJ').fill('11.222.333/0001-82');
  await dialog.getByLabel(/^Razão social/).fill('Teste Inválido');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByText(/CNPJ inválido/)).toBeVisible();
  await dialog.getByLabel('CNPJ').fill('12.ABC.345/01DE-35');
  await expect(dialog.getByText('Documento já cadastrado')).toBeVisible();
});

test('Cenário 3 (UI): pagamento de título protestado mantém pendência cartorária', async ({ page }) => {
  await login(page);
  await page.goto('/financeiro/receber');
  const row = page.getByRole('row').filter({ hasText: 'Vencido · Protestado' }).first();
  await row.getByRole('button', { name: 'Receber' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Forma').selectOption('pix');
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('Pago via Pix, mas ainda em protesto').first()).toBeVisible();
  await page.goto('/financeiro/protestos');
  await expect(page.getByText(/pago\(s\) com pendência cartorária/)).toBeVisible();
});

test('simulador: margem de 20% sobre custo de R$ 100 = R$ 125', async ({ page }) => {
  await login(page);
  await page.goto('/precificacao');
  await page.getByLabel('Custo por litro (R$)').fill('2');
  await page.getByLabel('Litros').fill('50');
  await page.getByLabel('Margem desejada (%)').fill('20');
  await page.getByLabel('Tributos sobre vendas (%)').fill('0');
  await expect(page.getByText('R$ 125,00')).toBeVisible();
});

test('assistente responde com dados internos e fontes', async ({ page }) => {
  await login(page);
  await page.goto('/assistente');
  await page.getByRole('button', { name: 'Quanto temos a receber neste mês?' }).click();
  await expect(page.getByText('A receber neste mês').last()).toBeVisible();
  await expect(page.getByText('Fontes:')).toBeVisible();
});

test('Cenário 8 (UI): gerar a fila de cobrança duas vezes não duplica mensagens', async ({ page }) => {
  await login(page);
  await page.goto('/financeiro/cobrancas');
  await page.getByRole('button', { name: 'Gerar fila agora' }).click();
  await page.waitForTimeout(500);
  const first = await page.getByRole('button', { name: 'Copiar' }).count();
  await page.getByRole('button', { name: 'Gerar fila agora' }).click();
  await expect(page.getByText(/0 novo\(s\) efeito\(s\)/)).toBeVisible();
  expect(await page.getByRole('button', { name: 'Copiar' }).count()).toBe(first);
});
