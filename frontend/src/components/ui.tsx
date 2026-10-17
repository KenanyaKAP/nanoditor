import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cx } from '../lib/util'
import { errorMessage } from '../api/client'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg active:opacity-80',
  secondary: 'bg-raised text-fg active:bg-line',
  ghost: 'text-fg active:bg-raised',
  danger: 'bg-del text-white active:opacity-80',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium select-none transition-colors disabled:opacity-50',
        size === 'md' ? 'h-11 px-4 text-[15px]' : 'h-9 px-3 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
}

export function IconButton({ label, active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl select-none active:bg-raised disabled:opacity-40',
        active ? 'text-accent' : 'text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-muted', className)} />
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <Spinner />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {body && <div className="mt-1 text-sm text-muted">{body}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const detail = (error as any)?.detail as string | undefined
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <AlertTriangle className="mb-3 h-8 w-8 text-warn" />
      <div className="font-semibold">{errorMessage(error)}</div>
      {detail && <div className="mt-2 max-w-full break-words font-mono text-xs text-muted">{detail}</div>}
      {onRetry && (
        <Button className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-1.5 pt-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{children}</div>
      {right}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-3 overflow-hidden rounded-2xl bg-surface', className)}>{children}</div>
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cx('flex rounded-xl bg-raised p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 flex-1 rounded-lg text-sm font-medium transition-colors',
            value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex min-h-[48px] items-center justify-between gap-3 px-4">
      <span className="text-[15px]">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line')}
      >
        <span
          className={cx(
            'absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  )
}
