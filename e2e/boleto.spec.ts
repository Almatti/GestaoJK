import { test, expect } from '@playwright/test';
import { login, collectErrors } from './helpers';
import { mod11Bank, parseBoleto } from '../src/domain/boleto';

/** PDF mínimo (texto pesquisável) com os dados de um boleto FICTÍCIO. */
function makePdf(lines: string[], boxes: [number, number, number, string][] = []): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const positioned = boxes.map(([x, y, size, t]) => `BT /F1 ${size} Tf ${x} ${y} Td (${esc(t)}) Tj ET`).join(' ');
  const content = `BT /F1 10 Tf 40 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET ${positioned}`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

test('boleto: lê a linha digitável e importa o PDF, preenchendo valor, vencimento, cliente e título', async ({ page }) => {
  const errors = collectErrors(page);
  const body = `3419${'1656'}${'0000123450'}1090000012345678901234567`;
  const barcode = `${body.slice(0, 4)}${mod11Bank(body)}${body.slice(4)}`;
  const line = parseBoleto(barcode, '2026-11-26').digitableLine;

  await login(page);
  await page.goto('/financeiro/boletos');
  await page.getByRole('button', { name: 'Cadastrar boleto' }).click();

  // 1) Pela linha digitável
  await page.getByLabel('Linha digitável ou código de barras').fill(line);
  await expect(page.getByText(/Boleto lido: banco 341 \(Itaú\)/)).toBeVisible();
  await expect(page.getByLabel('Valor original (R$)')).toHaveValue('1234.50');
  await expect(page.getByLabel('Vencimento')).toHaveValue('2026-12-10');
  await expect(page.getByLabel('Título (conta a receber)')).toHaveValue('__novo__');

  // 2) Pelo PDF: identifica o pagador pelo CNPJ cadastrado
  await page.getByLabel('Linha digitável ou código de barras').fill('');
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({
    name: 'boleto.pdf', mimeType: 'application/pdf',
    buffer: makePdf(['Pagador: Bar Esquina Feliz 11.222.333/0001-81', line, 'Vencimento 10/12/2026'], [
      // Ficha de compensação: rótulo pequeno no alto da caixa, valor abaixo
      [40, 500, 6, 'Data do documento'], [130, 500, 6, 'N\xba do documento'], [230, 500, 6, 'Nosso n\xfamero'],
      [40, 490, 9, '20/11/2026'], [130, 490, 9, '000068'], [230, 490, 9, '109/00000123-4'],
      [40, 470, 6, 'Carteira'], [130, 470, 6, 'Seu n\xfamero'],
      [40, 460, 9, '109'], [130, 460, 9, 'PED-120']
    ])
  });
  await expect(page.getByText(/PDF lido: banco 341/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Nosso número')).toHaveValue('109/00000123-4');
  await expect(page.getByLabel('Carteira')).toHaveValue('109');
  await expect(page.getByLabel('Número do documento')).toHaveValue('000068');
  await expect(page.getByLabel('Seu número')).toHaveValue('PED-120');
  await expect(page.getByLabel('Emissão')).toHaveValue('2026-11-20');
  await expect(page.getByLabel('Cliente (pagador)')).not.toHaveValue('');

  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText(/Boleto cadastrado e conta a receber criada/)).toBeVisible();
  await expect(page.getByRole('cell', { name: /R\$\s*1\.234,50/ }).first()).toBeVisible();
  // Código visível e busca
  await expect(page.getByRole('cell', { name: /Nº 000068/ })).toBeVisible();
  await page.getByLabel('Buscar boleto').fill('000068');
  await expect(page.getByRole('row')).toHaveCount(2);

  // Gestão: pagamento via Pix → situação "Pago"
  await page.getByRole('row', { name: /000068/ }).getByRole('button', { name: 'Gerenciar' }).click();
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  await page.getByLabel('Forma').selectOption('pix');
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText(/Título quitado/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Pagos/ }).click();
  await expect(page.getByRole('row', { name: /000068/ }).getByText(/Pago/)).toBeVisible();

  // Pago via Pix, mas o título já estava protestado no cartório
  await page.getByRole('row', { name: /000068/ }).getByRole('button', { name: 'Gerenciar' }).click();
  await page.getByRole('button', { name: 'Já está no cartório' }).click();
  await page.getByLabel('Etapa atual no cartório').selectOption('protestado');
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText(/Pago, mas ainda em protesto/).first()).toBeVisible();
  await expect(page.getByText(/Aguardando anuência/).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Pago c\/ pendência no cartório/ }).click();
  await expect(page.getByRole('row', { name: /000068/ })).toBeVisible();
  expect(errors.filter((e) => !/favicon|manifest/i.test(e))).toEqual([]);
});

test('avisos aparecem POR CIMA da janela aberta (ex.: faltou o cliente ao salvar)', async ({ page }) => {
  await login(page);
  await page.goto('/financeiro/boletos');
  await page.getByRole('button', { name: 'Cadastrar boleto' }).click();
  await page.getByRole('button', { name: 'Salvar' }).click();
  const toast = page.getByText('Selecione o cliente do boleto.');
  await expect(toast).toBeVisible();
  // Janela modal fica na camada superior do navegador; o aviso precisa estar nela também (popover aberto),
  // senão fica desenhado POR TRÁS da janela (era o "clico em salvar e nada acontece").
  const inTopLayer = await toast.evaluate((el) => !!el.closest('[popover]')?.matches(':popover-open'));
  expect(inTopLayer).toBe(true);
  const box = (await toast.boundingBox())!;
  const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, 120), height: box.height } });
  const own = await toast.screenshot();
  expect(shot.length).toBeGreaterThan(0);
  expect(own.length).toBeGreaterThan(0);
});
