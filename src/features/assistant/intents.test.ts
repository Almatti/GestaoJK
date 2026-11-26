import { matchIntent, sanitizeForAi } from './intents';
describe('assistente determinístico', () => {
  it('reconhece perguntas do documento', () => {
    expect(matchIntent('Quais clientes estão consumindo menos?')?.key).toBe('consumo_baixo');
    expect(matchIntent('Quanto temos a receber neste mês?')?.key).toBe('receber_mes');
    expect(matchIntent('Quais clientes precisam de cobrança?')?.key).toBe('cobranca');
    expect(matchIntent('Quais equipamentos estão ociosos?')?.key).toBe('ociosos');
    expect(matchIntent('Resuma a última reunião')?.key).toBe('reuniao');
    expect(matchIntent('Organize minha rotina semanal')?.key).toBe('rotina');
    expect(matchIntent('qual a cor do céu')).toBeNull();
  });
  it('anonimiza dados pessoais antes de enviar à IA', () => {
    const s = sanitizeForAi('CPF 529.982.247-25, CNPJ 12.ABC.345/01DE-35, email a@b.com, tel (11) 98765-4321');
    expect(s).toBe('CPF [CPF], CNPJ [CNPJ], email [EMAIL], tel [TELEFONE]');
  });
});
