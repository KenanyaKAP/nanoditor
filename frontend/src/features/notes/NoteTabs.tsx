import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Home, X } from 'lucide-react'
import { basename } from '../../lib/path'
import { cx } from '../../lib/util'
import { closeOpenNote, useOpenNotes } from './openNotes'

export function noteEditPath(p: string, isNew = false) {
  return '/notes/edit?path=' + encodeURIComponent(p) + (isNew ? '&new=1' : '')
}

/**
 * Obsidian-style tab bar for open notes. One note is on screen at a time;
 * tabs make jumping between them one tap. `onSwitch` lets the editor save
 * before leaving.
 */
export function NoteTabs({
  vault,
  active,
  onSwitch,
}: {
  vault: string
  active: string | null
  onSwitch?: (to: string) => Promise<void> | void
}) {
  const open = useOpenNotes(vault)
  const navigate = useNavigate()
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [active])

  const go = async (to: string) => {
    if (onSwitch) await onSwitch(to)
    navigate(to, { replace: true })
  }

  if (open.length === 0 && !active) return null
  return (
    <div className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-bg px-2 py-1.5">
      <button
        aria-label="Notes home"
        className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', !active ? 'bg-surface text-accent' : 'text-muted active:bg-raised')}
        onClick={() => active && go('/notes')}
      >
        <Home className="h-4 w-4" />
      </button>
      {open.map((p) => {
        const isActive = p === active
        return (
          <div
            key={p}
            className={cx(
              'flex h-8 max-w-[11rem] shrink-0 items-center rounded-lg text-sm',
              isActive ? 'bg-surface font-medium text-fg shadow-sm' : 'text-muted',
            )}
          >
            <button
              ref={isActive ? activeRef : undefined}
              className="min-w-0 truncate pl-2.5 pr-1"
              onClick={() => !isActive && go(noteEditPath(p))}
            >
              {basename(p).replace(/\.md$/i, '')}
            </button>
            <button
              aria-label={`Close ${basename(p)}`}
              className="flex h-8 w-7 shrink-0 items-center justify-center"
              onClick={async () => {
                if (isActive && onSwitch) await onSwitch('')
                const next = closeOpenNote(vault, p)
                if (isActive) navigate(next ? noteEditPath(next) : '/notes', { replace: true })
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
