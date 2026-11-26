import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}

export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label} {required && <span className="text-danger-700" aria-hidden>*</span>}
      </label>
      {children(id, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && !error && <p id={hintId} className="hint">{hint}</p>}
      {error && <p id={errId} role="alert" className="mt-1 text-xs font-medium text-danger-700">{error}</p>}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode; wrapperClassName?: string };
export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput({ label, error, hint, required, wrapperClassName, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      {(id, describedBy) => <input ref={ref} id={id} aria-invalid={!!error} aria-describedby={describedBy} aria-required={required} className={clsx('input', className)} {...rest} />}
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: ReactNode; options: { value: string; label: string }[]; placeholder?: string; wrapperClassName?: string };
export const SelectInput = forwardRef<HTMLSelectElement, SelectProps>(function SelectInput({ label, error, hint, options, placeholder, required, wrapperClassName, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      {(id, describedBy) => (
        <select ref={ref} id={id} aria-invalid={!!error} aria-describedby={describedBy} className={clsx('input appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)}
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2392543a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: ReactNode; wrapperClassName?: string };
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaProps>(function TextArea({ label, error, hint, required, wrapperClassName, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      {(id, describedBy) => <textarea ref={ref} id={id} rows={3} aria-invalid={!!error} aria-describedby={describedBy} className={clsx('input min-h-24', className)} {...rest} />}
    </Field>
  );
});

export function Checkbox({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5 py-1">
      <input id={id} type="checkbox" className="mt-0.5 size-5 rounded-md accent-[var(--color-tangerine-800)]" {...rest} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-cocoa-700">{hint}</span>}
      </label>
    </div>
  );
}
