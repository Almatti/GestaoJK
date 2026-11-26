import { useEffect, useRef, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Gaveta lateral (desktop) em vez de diálogo central. */
  drawer?: boolean;
  /** Retorna false para impedir o fechamento (ex.: formulário com alterações). */
  beforeClose?: () => boolean;
}

const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' };

export function Modal({ open, onClose, title, description, children, footer, size = 'md', drawer, beforeClose }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const requestClose = () => {
    if (beforeClose && !beforeClose()) return;
    onClose();
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => e.target === ref.current && requestClose()}
      className={clsx(
        'm-0 max-h-none max-w-none bg-transparent p-0 backdrop:bg-cocoa-900/30 backdrop:backdrop-blur-sm',
        drawer ? 'ml-auto h-dvh w-full sm:w-[min(640px,92vw)]' : 'mx-auto mt-auto h-auto w-full sm:my-auto ' + widths[size]
      )}
    >
      {open && (
        <div
          className={clsx(
            'surface flex max-h-dvh flex-col animate-rise',
            drawer ? 'h-dvh rounded-l-[var(--radius-card)]' : 'max-h-[92dvh] rounded-t-[var(--radius-card)] sm:rounded-[var(--radius-card)]'
          )}
        >
          <header className="flex items-start gap-3 border-b border-tangerine-100 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id="modal-title" className="text-lg font-bold">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-cocoa-700">{description}</p>}
            </div>
            <Button variant="ghost" size="icon" aria-label="Fechar" onClick={requestClose} icon={<X className="size-5" />} />
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-tangerine-100 px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirmar', danger, onConfirm, onCancel, loading, children
}: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean;
  onConfirm: () => void; onCancel: () => void; children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onCancel}>Voltar</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <div className="space-y-3 text-sm text-cocoa-900">{message}{children}</div>
    </Modal>
  );
}
