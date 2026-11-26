import { normalizeCnpjaOffice, companySnapshot, formatPhoneBR, lookupCnpjBrasilApi } from './cnpj';
import { cnpjaQuery } from '../../../supabase/functions/_shared/cnpja';

// Resposta no formato documentado da CNPJá (CNPJ de teste público da própria CNPJá).
const office = {
  taxId: '37335118000180', updated: '2024-06-05T17:52:39.136Z', alias: 'CNPJA', founded: '2020-06-05', head: true,
  statusDate: '2020-06-05', status: { id: 2, text: 'Ativa' },
  company: {
    id: '37335118', name: 'CNPJA TECNOLOGIA LTDA', equity: 1000, nature: { id: 2062, text: 'Sociedade Empresária Limitada' },
    size: { id: 1, acronym: 'ME', text: 'Microempresa' }, simples: { optant: true, since: '2020-06-05' }, simei: { optant: false, since: null },
    members: [{ since: '2020-06-05', role: { id: 49, text: 'Sócio-Administrador' }, person: { name: 'João Silva', taxId: '***123456**' } }]
  },
  address: { municipality: 3550308, street: 'Avenida Brigadeiro Faria Lima', number: '2369', details: 'Conj 1102', district: 'Jardim Paulistano', city: 'São Paulo', state: 'SP', zip: '01452922' },
  phones: [{ type: 'LANDLINE', area: '11', number: '30000000' }],
  emails: [{ ownership: 'CORPORATE', address: 'contato@cnpja.com', domain: 'cnpja.com' }],
  mainActivity: { id: 6311900, text: 'Tratamento de dados' }, sideActivities: [{ id: 6201501, text: 'Desenvolvimento de software' }],
  registrations: [{ number: '111222333', state: 'SP', enabled: true, status: { id: 1, text: 'Sem restrição' }, type: { id: 1, text: 'IE Normal' } }]
};

describe('consulta de CNPJ (CNPJá)', () => {
  it('normaliza dados cadastrais, endereço, contatos, Simples e IE', () => {
    const d = normalizeCnpjaOffice(office);
    expect(d.legalName).toBe('CNPJA TECNOLOGIA LTDA');
    expect(d.tradeName).toBe('CNPJA');
    expect(d.status).toBe('Ativa');
    expect(d.street).toBe('Avenida Brigadeiro Faria Lima');
    expect(d.complement).toBe('Conj 1102');
    expect(d.cep).toBe('01452922');
    expect(d.phone).toBe('1130000000');
    expect(d.email).toBe('contato@cnpja.com');
    expect(d.simples).toBe(true);
    expect(d.simei).toBe(false);
    expect(d.stateRegistration).toBe('111222333');
    expect(d.mainActivity).toEqual({ code: '6311900', text: 'Tratamento de dados' });
  });
  it('não guarda CPF de sócios', () => {
    const d = normalizeCnpjaOffice(office);
    expect(d.members).toEqual([{ name: 'João Silva', role: 'Sócio-Administrador', since: '2020-06-05' }]);
    expect(JSON.stringify(companySnapshot(d, 'teste', '2026-11-26T00:00:00Z'))).not.toContain('123456');
  });
  it('tolera respostas incompletas (API aberta)', () => {
    const d = normalizeCnpjaOffice({ taxId: '1', company: { name: 'X' } });
    expect(d.legalName).toBe('X');
    expect(d.simples).toBeNull();
    expect(d.stateRegistration).toBe('');
  });
  it('usa cache para economizar créditos e força atualização quando pedido', () => {
    expect(cnpjaQuery({ maxAgeDays: 30, simples: true, registrations: true })).toBe('strategy=CACHE_IF_ERROR&maxAge=30&maxStale=365&simples=true&registrations=ORIGIN');
    expect(cnpjaQuery({ maxAgeDays: 30, simples: false, registrations: false, refresh: true })).toBe('strategy=CACHE_IF_ERROR&maxAge=1&maxStale=365');
    expect(cnpjaQuery({ maxAgeDays: 99999, simples: false, registrations: false })).toContain('maxAge=3650');
  });
  it('formata telefone', () => {
    expect(formatPhoneBR('11987654321')).toBe('(11) 98765-4321');
    expect(formatPhoneBR('1130000000')).toBe('(11) 3000-0000');
  });
  it('modo sem servidor: BrasilAPI no mesmo formato', async () => {
    const fake = (async () => new Response(JSON.stringify({ razao_social: 'EMPRESA X', nome_fantasia: 'X', uf: 'SP', municipio: 'SAO PAULO', ddd_telefone_1: '1133334444' }), { status: 200 })) as unknown as typeof fetch;
    const d = await lookupCnpjBrasilApi('11.222.333/0001-81', fake);
    expect(d?.legalName).toBe('EMPRESA X');
    expect(d?.phone).toBe('1133334444');
  });
});
