/**
 * Gera supabase/tests/fixtures/local_backup.json a partir do MODO LOCAL real (dados fictícios de teste),
 * usado por supabase/tests/20_import_local_backup.sql para validar a importação no banco.
 */
import { writeFileSync } from 'node:fs';
import { createDemoDataClient } from './client';
import { exportDb, resetDb } from './store';

// Regerar: GEN_FIXTURE=1 npx vitest run src/data/demo/localBackupFixture.test.ts
it('backup do modo local é JSON serializável (e gera a fixture com GEN_FIXTURE=1)', async () => {
  localStorage.clear();
  resetDb();
  const c = createDemoDataClient('local');
  const keg = (await c.list<{ id: string; liters: number }>('keg_sizes')).rows.find((k) => k.liters === 50)!;
  const cust = await c.insert<{ id: string }>('customers', { person_type: 'PJ', name: 'Bar Teste Importação', document: '11444777000161', segment: 'ponto_fixo' });
  const prod = await c.insert<{ id: string }>('products', { name: 'Chopp Pilsen Importação', sku: 'IMP-1', cost_per_unit: 10, price_per_unit: 20 });
  const si = await c.insert<{ id: string }>('stock_items', { name: 'Barril Pilsen 50 L', kind: 'chopp', product_id: prod.id, keg_size_id: keg.id, min_quantity: 1 });
  await c.insert('inventory_movements', { stock_item_id: si.id, movement_type: 'entrada', quantity: 5 });
  const order = await c.insert<{ id: string }>('orders', { kind: 'ponto_fixo', customer_id: cust.id, installments: 1, payment_method: 'pix', delivery_date: '2026-11-20' });
  await c.insert('order_items', { order_id: order.id, product_id: prod.id, keg_size_id: keg.id, quantity: 2, liters_per_unit: 50, unit_price: 1000, price_per_liter: 20, price_source: 'tabela', unit_cost: 500 });
  await c.rpc('confirm_order', { p_order: order.id });
  const rec = (await c.list<{ id: string; amount: number }>('receivables')).rows[0]!;
  await c.rpc('register_receipt', { p_receivable: rec.id, p_amount: 500, p_method: 'pix' });
  const parent = await c.insert<{ id: string }>('tasks', { title: 'Tarefa pai', category: 'operacional' });
  await c.insert('tasks', { title: 'Subtarefa', category: 'operacional', parent_id: parent.id });
  const rules = (await c.list<{ id: string; customer_id: string | null }>('collection_rules')).rows;
  await c.update('collection_rules', rules[0]!.id, { fine_percent: 2, interest_percent: 1 });
  const json = JSON.stringify(exportDb());
  expect(JSON.parse(json).orders).toHaveLength(1);
  if (process.env.GEN_FIXTURE === '1') writeFileSync('supabase/tests/fixtures/local_backup.json', json);
});
