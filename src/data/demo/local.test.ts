import { createDemoDataClient } from './client';
import { exportDb, importDb, resetDb } from './store';

describe('modo local (uso real sem servidor)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDb();
  });
  it('começa sem nenhum dado fictício e com regra de cobrança zerada', async () => {
    const c = createDemoDataClient('local');
    expect(c.mode).toBe('local');
    for (const t of ['customers', 'products', 'orders', 'receivables', 'payments', 'equipment', 'partners']) expect((await c.list(t)).rows).toHaveLength(0);
    const rule = (await c.list<Record<string, number>>('collection_rules')).rows[0]!;
    expect(rule.fine_percent).toBe(0);
    expect(rule.interest_percent).toBe(0);
    expect((await c.list('keg_sizes')).rows.length).toBeGreaterThan(0);
  });
  it('persiste no navegador e restaura por backup', async () => {
    const c = createDemoDataClient('local');
    await c.insert('customers', { person_type: 'PJ', name: 'Cliente Real', document: '11222333000181' });
    expect(localStorage.getItem('jk-local-db-v1')).toContain('Cliente Real');
    expect(localStorage.getItem('jk-demo-db-v1')).toBeNull();
    const backup = exportDb();
    await c.insert('customers', { person_type: 'PF', name: 'Outro' });
    importDb(backup);
    expect((await c.list('customers')).rows).toHaveLength(1);
  });
  it('valida documento também no modo local', async () => {
    const c = createDemoDataClient('local');
    await expect(c.insert('customers', { person_type: 'PJ', name: 'X', document: '11222333000182' })).rejects.toThrow(/CNPJ inválido/);
  });
});
