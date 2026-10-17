import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useGoUp } from '../lib/nav'

export function TopBar({
  title,
  subtitle,
  back,
  up,
  onBack,
  actions,
  onTitleClick,
}: {
  title: ReactNode
  subtitle?: ReactNode
  /** Show a back button. */
  back?: boolean
  /** The screen Back leads to (its logical parent). Without it, history back. */
  up?: string
  /** Custom back handler (e.g. to confirm or save first); overrides `up`. */
  onBack?: () => void
  actions?: ReactNode
  onTitleClick?: () => void
}) {
  const navigate = useNavigate()
  const goUp = useGoUp()
  return (
    <header className="z-20 shrink-0 border-b border-line bg-bg/95 pt-safe px-safe backdrop-blur">
      <div className="flex h-12 items-center gap-1 px-1">
        {back ? (
          <button
            aria-label="Back"
            onClick={() => (onBack ? onBack() : up ? goUp(up) : navigate(-1))}
            className="flex h-11 w-10 shrink-0 items-center justify-center rounded-xl active:bg-raised"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : (
          <div className="w-3" />
        )}
        <button
          className="min-w-0 flex-1 text-left disabled:cursor-default"
          onClick={onTitleClick}
          disabled={!onTitleClick}
        >
          <div className="truncate text-[17px] font-semibold leading-tight">{title}</div>
          {subtitle && <div className="truncate text-xs leading-tight text-muted">{subtitle}</div>}
        </button>
        {actions && <div className="flex shrink-0 items-center">{actions}</div>}
      </div>
    </header>
  )
}
