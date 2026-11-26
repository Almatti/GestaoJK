import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { ResourceForm } from './ResourceForm';
import { partnersDef } from './definitions';

const mutateAsync = vi.fn(async ({ values }: { values: Record<string, unknown> }) => ({ id: 'novo', ...values }));
vi.mock('@/data/hooks', () => ({
  useSave: () => ({ mutateAsync }),
  useList: () => ({ data: { rows: [] }, isLoading: false })
}));

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };

it('parceiro novo salva com campos numéricos em branco (padrões do banco, sem nulos)', async () => {
  render(<ToastProvider><ResourceForm def={partnersDef} row={null} open onClose={() => {}} /></ToastProvider>);
  expect(screen.getByLabelText(/Crédito em eventos/)).toHaveValue(0);
  await userEvent.type(screen.getAllByLabelText(/^Nome/)[0]!, 'Parceiro Teste');
  await userEvent.clear(screen.getByLabelText(/Crédito em eventos/));
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  const values = mutateAsync.mock.calls[0]![0].values;
  expect(values.name).toBe('Parceiro Teste');
  expect(Object.values(values)).not.toContain(null);
  expect(values).not.toHaveProperty('percent_event');
});
