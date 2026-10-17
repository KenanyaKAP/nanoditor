import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from '../lib/util'

/** Bottom sheet for menus, pickers and forms. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  full,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Take most of the screen height (pickers, search). */
  full?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-x-0 z-50 flex flex-col justify-end" style={{ top: 'var(--vv-top, 0px)', height: 'var(--vvh, 100dvh)' }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={cx(
          'relative flex max-h-[90%] flex-col rounded-t-2xl bg-surface shadow-2xl pb-safe',
          full && 'h-[90%]',
        )}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <div className="min-w-0 flex-1 truncate font-semibold">{title}</div>
          <button aria-label="Close" onClick={onClose} className="-mr-2 flex h-10 w-10 items-center justify-center rounded-xl active:bg-raised">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="scroll-touch min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-line p-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function SheetItem({
  icon,
  children,
  onClick,
  danger,
  right,
  disabled,
}: {
  icon?: ReactNode
  children: ReactNode
  onClick?: () => void
  danger?: boolean
  right?: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex min-h-[50px] w-full items-center gap-3 px-4 text-left text-[15px] active:bg-raised disabled:opacity-40',
        danger && 'text-del',
      )}
    >
      {icon && <span className={cx('shrink-0', danger ? 'text-del' : 'text-muted')}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </button>
  )
}
