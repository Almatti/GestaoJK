import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary:
    'text-white bg-gradient-to-br from-tangerine-700 to-tangerine-800 shadow-[var(--shadow-glow)] hover:brightness-105 active:brightness-95',
  secondary: 'bg-white text-tangerine-900 border border-tangerine-200 hover:bg-cream-100',
  soft: 'bg-tangerine-100 text-tangerine-900 hover:bg-tangerine-200/70',
  ghost: 'text-cocoa-900 hover:bg-white/60',
  danger: 'bg-danger-700 text-white hover:brightness-110'
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-[15px] gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-10 w-10 justify-center'
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center rounded-full font-medium transition-all duration-200 ease-[var(--ease-soft)] disabled:cursor-not-allowed disabled:opacity-55 select-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
