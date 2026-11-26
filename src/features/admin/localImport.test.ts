import { parseLocalBackup, summarizeBackup } from './localImport';

describe('importação do modo local', () => {
  const data = { customers: [{ id: 'a' }], orders: [{ id: 'o1' }, { id: 'o2' }], receivables: [] };
  it('aceita o arquivo de backup do modo local', () => {
    expect(parseLocalBackup(JSON.stringify({ format: 'jk-chopp-gestao/backup-local', version: 1, data })).orders).toHaveLength(2);
  });
  it('aceita o conteúdo bruto salvo no navegador', () => {
    expect(parseLocalBackup(JSON.stringify(data), true).customers).toHaveLength(1);
  });
  it('recusa arquivos que não são backup', () => {
    expect(() => parseLocalBackup('{"tables":{}}')).toThrow(/não é um backup/);
    expect(() => parseLocalBackup('xx')).toThrow(/não é um backup/);
  });
  it('resume o conteúdo para confirmação', () => {
    const s = summarizeBackup(data);
    expect(s.total).toBe(3);
    expect(s.text).toContain('2 pedido(s)');
  });
});
