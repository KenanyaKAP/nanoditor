import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Minus, MoreHorizontal, Plus, Undo2, Copy } from 'lucide-react'
import type { FileStatus, Status } from '../../api/types'
import { Sheet, SheetItem } from '../../components/Sheet'
import { useDialogs } from '../../components/dialogs'
import { basename, dirname, join } from '../../lib/path'
import { copyText, cx } from '../../lib/util'
import { viewPath } from '../files/FilesPage'
import { diffPath, letterFor, statusColor, useGitAction, type Section } from './gitApi'

const titles: Record<Section, string> = {
  conflicts: 'Merge conflicts',
  staged: 'Staged',
  changes: 'Changes',
  untracked: 'Untracked',
}

export function ChangesList({ repo, status }: { repo: string; status: Status }) {
  const act = useGitAction(repo)
  const { confirm, toast } = useDialogs()
  const navigate = useNavigate()
  const [menu, setMenu] = useState<{ f: FileStatus; section: Section } | null>(null)

  const stage = (paths: string[]) => act.mutate({ url: '/api/git/stage', body: { paths } })
  const unstage = (paths: string[]) => act.mutate({ url: '/api/git/unstage', body: { paths } })
  const discard = async (paths: string[], untracked: string[]) => {
    const n = paths.length + untracked.length
    const ok = await confirm({
      title: n === 1 ? `Discard changes to ${basename(paths[0] ?? untracked[0])}?` : `Discard ${n} files?`,
      message:
        untracked.length > 0
          ? 'Changes are reverted; untracked files are moved to Nanoditor\'s trash folder.'
          : 'This reverts the file to its staged/committed version. Uncommitted edits are lost.',
      confirmLabel: 'Discard',
      danger: true,
    })
    if (ok) act.mutate({ url: '/api/git/discard', body: { paths, untracked } })
  }

  const sections: { key: Section; files: FileStatus[] }[] = [
    { key: 'conflicts', files: status.conflicts },
    { key: 'staged', files: status.staged },
    { key: 'changes', files: status.changes },
    { key: 'untracked', files: status.untracked },
  ]
  const total = sections.reduce((n, s) => n + s.files.length, 0)

  if (total === 0) {
    return <div className="px-6 py-16 text-center text-muted">Working tree clean. Nothing to commit.</div>
  }

  return (
    <div className="pb-4">
      {sections
        .filter((s) => s.files.length > 0)
        .map((s) => (
          <div key={s.key}>
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                {titles[s.key]} <span className="ml-1 font-normal">{s.files.length}</span>
              </div>
              {s.key === 'staged' ? (
                <button className="px-1 text-sm font-medium text-accent" onClick={() => unstage(s.files.map((f) => f.path))}>
                  Unstage all
                </button>
              ) : (
                <button className="px-1 text-sm font-medium text-accent" onClick={() => stage(s.files.map((f) => f.path))}>
                  Stage all
                </button>
              )}
            </div>
            <ul>
              {s.files.map((f) => {
                const letter = letterFor(f, s.key)
                return (
                  <li key={s.key + f.path} className="flex items-center">
                    <button
                      className="flex min-h-[48px] min-w-0 flex-1 items-center gap-3 pl-4 text-left active:bg-raised"
                      onClick={() => navigate(diffPath(repo, f, s.key))}
                    >
                      <span className={cx('w-4 shrink-0 text-center font-mono text-sm font-bold', statusColor[letter] ?? 'text-muted')}>
                        {letter}
                      </span>
                      <div className="min-w-0 flex-1 py-1">
                        <div className="truncate text-[15px]">{basename(f.path)}</div>
                        <div className="truncate text-xs text-muted">
                          {f.origPath ? `${f.origPath} → ` : ''}
                          {dirname(f.path) === '/' ? '' : dirname(f.path)}
                        </div>
                      </div>
                    </button>
                    <button
                      aria-label="More"
                      className="flex h-12 w-10 shrink-0 items-center justify-center text-muted active:bg-raised"
                      onClick={() => setMenu({ f, section: s.key })}
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </button>
                    <button
                      aria-label={s.key === 'staged' ? 'Unstage' : 'Stage'}
                      disabled={act.isPending}
                      className="mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised active:bg-line disabled:opacity-50"
                      onClick={() => (s.key === 'staged' ? unstage([f.path]) : stage([f.path]))}
                    >
                      {s.key === 'staged' ? <Minus className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      {menu && (
        <Sheet open title={basename(menu.f.path)} onClose={() => setMenu(null)}>
          {menu.section !== 'staged' ? (
            <SheetItem
              icon={<Plus className="h-5 w-5" />}
              onClick={() => {
                stage([menu.f.path])
                setMenu(null)
              }}
            >
              Stage file
            </SheetItem>
          ) : (
            <SheetItem
              icon={<Minus className="h-5 w-5" />}
              onClick={() => {
                unstage([menu.f.path])
                setMenu(null)
              }}
            >
              Unstage file
            </SheetItem>
          )}
          {(menu.section === 'changes' || menu.section === 'untracked') && (
            <SheetItem
              danger
              icon={<Undo2 className="h-5 w-5" />}
              onClick={() => {
                const m = menu
                setMenu(null)
                if (m.section === 'untracked') discard([], [m.f.path])
                else discard([m.f.path], [])
              }}
            >
              {menu.section === 'untracked' ? 'Delete file' : 'Discard changes'}
            </SheetItem>
          )}
          {menu.f.y !== 'D' && (
            <SheetItem
              icon={<FileText className="h-5 w-5" />}
              onClick={() => {
                setMenu(null)
                navigate(viewPath(join(repo, menu.f.path)))
              }}
            >
              Open file
            </SheetItem>
          )}
          <SheetItem
            icon={<Copy className="h-5 w-5" />}
            onClick={async () => {
              const p = menu.f.path
              setMenu(null)
              const ok = await copyText(p)
              toast(ok ? 'Path copied' : 'Copy failed', ok ? 'ok' : 'error')
            }}
          >
            Copy path
          </SheetItem>
          {(menu.section === 'changes' || menu.section === 'untracked') && unstagedCount(status) > 1 && (
            <SheetItem
              danger
              icon={<Undo2 className="h-5 w-5" />}
              onClick={() => {
                setMenu(null)
                discard(
                  status.changes.map((f) => f.path),
                  status.untracked.map((f) => f.path),
                )
              }}
            >
              Discard all unstaged changes…
            </SheetItem>
          )}
          <div className="h-3" />
        </Sheet>
      )}
    </div>
  )
}

function unstagedCount(s: Status) {
  return s.changes.length + s.untracked.length
}
