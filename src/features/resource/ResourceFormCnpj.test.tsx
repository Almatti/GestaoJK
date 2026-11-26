import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { ResourceForm } from './ResourceForm';
import { partnersDef } from './definitions';
import { normalizeCnpjaOffice } from '@/lib/integrations/cnpj';

vi.mock('@/lib/integrations/cnpj', async (orig) => {
  const mod = await orig<typeof import('@/lib/integrations/cnpj')>();
  return {
    ...mod,
    lookupCompany: vi.fn(async () => ({
      found: true, source: 'teste', checkedAt: '2026-11-26T12:00:00Z', registrationsChecked: true,
      data: mod.normalizeCnpjaOffice({
        taxId: '11222333000181', alias: 'BAR DO TESTE', status: { text: 'Ativa' }, company: { name: 'BAR DO TESTE LTDA' },
        address: { street: 'Rua A', number: '10', district: 'Centro', city: 'Araçatuba', state: 'SP', zip: '16010000' },
        registrations: [{ number: '123456789110', state: 'SP', enabled: true, status: { text: 'Sem restrição' } }]
      })
    }))
  };
});

// jsdom não implementa <dialog>.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };

it('parceiros: Consultar preenche razão social, fantasia, IE e endereço pelo CNPJ', async () => {
  void normalizeCnpjaOffice;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider><ResourceForm def={partnersDef} row={null} open onClose={() => {}} /></ToastProvider>
    </QueryClientProvider>
  );
  await userEvent.type(screen.getByLabelText(/CPF\/CNPJ/), '11.222.333/0001-81');
  await userEvent.click(screen.getByRole('button', { name: /Consultar/ }));
  await waitFor(() => expect(screen.getAllByLabelText(/^Nome/)[0]).toHaveValue('BAR DO TESTE LTDA'));
  expect(screen.getByLabelText(/Nome fantasia/)).toHaveValue('BAR DO TESTE');
  expect(screen.getByLabelText(/Inscrição estadual/)).toHaveValue('123456789110');
  expect(screen.getByLabelText(/^Rua/)).toHaveValue('Rua A');
  expect(screen.getByLabelText(/^Cidade/)).toHaveValue('Araçatuba');
  expect(screen.getByText(/IE 123456789110\/SP/)).toBeInTheDocument();
});
