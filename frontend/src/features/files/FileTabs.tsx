import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Home, X } from 'lucide-react'
import { basename, dirname } from '../../lib/path'
import { cx } from '../../lib/util'
import { useCurrentWorkspace } from '../workspaces/workspace'
import { closeOpenFile, dirUrl, openPath, useOpenFiles } from './openFiles'

/**
 * Tab bar for open files, shown in the editor and above the folder list.
 * One file is on screen at a time; tabs make jumping between them one tap.
 * `active` is the file on screen (null on the Files screen, where Home is
 * lit). `onSwitch` lets the editor save before leaving.
 */
export function FileTabs({ active, onSwitch }: { active: string | null; onSwitch?: () => Promise<void> | void }) {
  const [workspace] = useCurrentWorkspace()
  const open = useOpenFiles(workspace)
  const navigate = useNavigate()
  const loc = useLocation()
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [active])

  // From the editor, switching replaces the entry so Back still leads to the
  // folder; from the folder list it pushes, so Back returns to the list.
  const go = async (to: string) => {
    if (onSwitch) await onSwitch()
    navigate(to, { replace: !!active })
  }

  // Two open README.md files get their folder in front.
  const names = open.map((p) => basename(p))
  const label = (p: string) => {
    const name = basename(p)
    const short = name.replace(/\.md$/i, '')
    return names.filter((n) => n === name).length > 1 ? `${basename(dirname(p))}/${short}` : short
  }

  if (open.length === 0 && !active) return null
  return (
    <div className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-bg px-2 py-1.5">
      <button
        aria-label="Files home"
        className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', !active ? 'bg-surface text-accent' : 'text-muted active:bg-raised')}
        onClick={() => (active || loc.search) && go('/files')}
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
              onClick={() => !isActive && go(openPath(p))}
            >
              {label(p)}
            </button>
            <button
              aria-label={`Close ${basename(p)}`}
              className="flex h-8 w-7 shrink-0 items-center justify-center"
              onClick={async () => {
                if (isActive && onSwitch) await onSwitch()
                const next = closeOpenFile(workspace, p)
                if (isActive) navigate(next ? openPath(next) : dirUrl(dirname(p), workspace), { replace: true })
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
