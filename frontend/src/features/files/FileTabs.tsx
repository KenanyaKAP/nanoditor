import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Save, Trash2, X } from 'lucide-react'
import { ApiError } from '../../api/client'
import { Sheet, SheetItem } from '../../components/Sheet'
import { useDialogs } from '../../components/dialogs'
import { removeDraft, saveDraft, useDraftPaths } from '../../editor/drafts'
import { basename, dirname } from '../../lib/path'
import { cx } from '../../lib/util'
import { useCurrentWorkspace } from '../workspaces/workspace'
import { closeOpenFile, dirUrl, openPath, useOpenFiles } from './openFiles'

/**
 * Tab bar for open files, shown in the editor and above the folder list.
 * One file is on screen at a time; tabs make jumping between them one tap.
 * `active` is the file on screen (null on the Files screen, where Home is
 * lit). `onSwitch` lets the editor save before leaving (autosave).
 */
export function FileTabs({ active, onSwitch }: { active: string | null; onSwitch?: () => Promise<void> | void }) {
  const [workspace] = useCurrentWorkspace()
  const open = useOpenFiles(workspace)
  const unsaved = useDraftPaths()
  const navigate = useNavigate()
  const loc = useLocation()
  const qc = useQueryClient()
  const { toast, toastError } = useDialogs()
  const activeRef = useRef<HTMLButtonElement>(null)
  // A tab with unsaved edits asks before closing.
  const [closing, setClosing] = useState<string | null>(null)

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

  const close = (p: string) => {
    const next = closeOpenFile(workspace, p)
    if (p === active) navigate(next ? openPath(next) : dirUrl(dirname(p), workspace), { replace: true })
  }

  const saveAndClose = async (p: string) => {
    setClosing(null)
    try {
      await saveDraft(p)
      qc.invalidateQueries({ queryKey: ['fs'] })
      qc.invalidateQueries({ queryKey: ['git'] })
      toast('Saved')
      close(p)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast(`${basename(p)} changed on disk. Open it and save to choose.`, 'error')
      else toastError(e)
    }
  }

  if (open.length === 0 && !active) return null
  return (
    <>
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
          const dirty = unsaved.has(p)
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
                aria-label={dirty ? `Close ${basename(p)} (unsaved)` : `Close ${basename(p)}`}
                className="flex h-8 w-7 shrink-0 items-center justify-center"
                onClick={async () => {
                  // With autosave on, leaving the active tab saves it first.
                  if (isActive && onSwitch) await onSwitch()
                  if (unsaved.has(p)) setClosing(p)
                  else close(p)
                }}
              >
                {dirty ? <span className="h-2 w-2 rounded-full bg-warn" /> : <X className="h-3.5 w-3.5" />}
              </button>
            </div>
          )
        })}
      </div>
      <Sheet open={!!closing} onClose={() => setClosing(null)} title={closing ? `Unsaved changes in ${basename(closing)}` : undefined}>
        {closing && (
          <>
            <SheetItem icon={<Save className="h-5 w-5" />} onClick={() => saveAndClose(closing)}>
              Save and close
            </SheetItem>
            <SheetItem
              danger
              icon={<Trash2 className="h-5 w-5" />}
              onClick={() => {
                const p = closing
                setClosing(null)
                removeDraft(p)
                close(p)
              }}
            >
              Discard changes and close
            </SheetItem>
            <SheetItem icon={<X className="h-5 w-5" />} onClick={() => setClosing(null)}>
              Cancel
            </SheetItem>
            <div className="h-3" />
          </>
        )}
      </Sheet>
    </>
  )
}
