import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FileText, Minus, Plus, Undo2 } from 'lucide-react'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { FileDiff, FileStatus, Hunk } from '../../api/types'
import { TopBar } from '../../components/TopBar'
import { Page } from '../../components/Shell'
import { Button, ErrorView, IconButton, Loading } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { basename, dirname, join } from '../../lib/path'
import { viewPath } from '../files/FilesPage'
import { DiffBody } from './DiffView'
import { diffPath, useGitAction, useStatus, type Section } from './gitApi'

const sectionLabel: Record<Section, string> = {
  staged: 'Staged changes',
  changes: 'Unstaged changes',
  untracked: 'New file (untracked)',
  conflicts: 'Merge conflict',
}

export function DiffPage() {
  const [params] = useSearchParams()
  const repo = params.get('repo') ?? ''
  const path = params.get('path') ?? ''
  const section = (params.get('section') as Section) || 'changes'
  const staged = section === 'staged'
  const untracked = section === 'untracked'
  const navigate = useNavigate()
  const { confirm } = useDialogs()
  const act = useGitAction(repo)
  const status = useStatus(repo)

  const q = useQuery({
    queryKey: keys.diff(repo, path, staged, untracked),
    queryFn: () => api.get<FileDiff>('/api/git/diff', { repo, path, staged, untracked }),
  })

  // Files in the same section, for prev/next navigation.
  const list: FileStatus[] = useMemo(() => {
    const st = status.data?.status
    if (!st) return []
    return section === 'staged' ? st.staged : section === 'untracked' ? st.untracked : section === 'conflicts' ? st.conflicts : st.changes
  }, [status.data, section])
  const idx = list.findIndex((f) => f.path === path)
  const go = (i: number) => list[i] && navigate(diffPath(repo, list[i], section), { replace: true })

  // When the file leaves this section (fully staged/unstaged), move on.
  useEffect(() => {
    if (!status.data || status.isFetching || idx >= 0) return
    if (list.length > 0) navigate(diffPath(repo, list[0], section), { replace: true })
    else navigate(-1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data, status.isFetching, idx])

  const hunkAction = async (h: Hunk, action: 'stage' | 'unstage' | 'discard') => {
    if (action === 'discard') {
      const ok = await confirm({ title: 'Discard this hunk?', message: 'The change is reverted in the working tree.', confirmLabel: 'Discard', danger: true })
      if (!ok) return
    }
    act.mutate({ url: '/api/git/hunk', body: { path, hunkId: h.id, action } })
  }

  const fileAction = async (action: 'stage' | 'unstage' | 'discard') => {
    if (action === 'discard') {
      const ok = await confirm({
        title: untracked ? `Delete ${basename(path)}?` : `Discard all changes to ${basename(path)}?`,
        message: untracked ? 'The file is moved to KennyCode\'s trash folder.' : 'Uncommitted edits to this file are lost.',
        confirmLabel: untracked ? 'Delete' : 'Discard',
        danger: true,
      })
      if (!ok) return
      act.mutate({ url: '/api/git/discard', body: untracked ? { paths: [], untracked: [path] } : { paths: [path] } })
      return
    }
    act.mutate({ url: `/api/git/${action}`, body: { paths: [path] } })
  }

  const d = q.data
  const hunkMode = !untracked && section !== 'conflicts' && d && !d.binary

  return (
    <>
      <TopBar
        back
        title={basename(path)}
        subtitle={`${sectionLabel[section]}${dirname(path) !== '/' ? ' · ' + dirname(path) : ''}`}
        actions={
          <>
            <IconButton label="Previous file" disabled={idx <= 0} onClick={() => go(idx - 1)}>
              <ChevronLeft className="h-5 w-5" />
            </IconButton>
            <span className="w-8 text-center text-xs text-muted">{list.length ? `${idx + 1}/${list.length}` : ''}</span>
            <IconButton label="Next file" disabled={idx < 0 || idx >= list.length - 1} onClick={() => go(idx + 1)}>
              <ChevronRight className="h-5 w-5" />
            </IconButton>
          </>
        }
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        {d && (
          <span className="mr-auto text-xs">
            <span className="text-add">+{d.added}</span> <span className="text-del">-{d.removed}</span>
          </span>
        )}
        {section !== 'staged' && (
          <Button size="sm" variant="ghost" className="text-del" icon={<Undo2 className="h-4 w-4" />} onClick={() => fileAction('discard')}>
            {untracked ? 'Delete' : 'Discard'}
          </Button>
        )}
        <IconButton label="Open file" onClick={() => navigate(viewPath(join(repo, path)))}>
          <FileText className="h-5 w-5" />
        </IconButton>
        {staged ? (
          <Button size="sm" icon={<Minus className="h-4 w-4" />} loading={act.isPending} onClick={() => fileAction('unstage')}>
            Unstage file
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} loading={act.isPending} onClick={() => fileAction('stage')}>
            Stage file
          </Button>
        )}
      </div>
      <Page onRefresh={() => q.refetch()}>
        {q.isLoading && <Loading />}
        {q.error && <ErrorView error={q.error} onRetry={() => q.refetch()} />}
        {d && (
          <DiffBody
            diff={d}
            hunkActions={
              hunkMode
                ? (h) =>
                    staged ? (
                      <HunkButton onClick={() => hunkAction(h, 'unstage')} disabled={act.isPending}>
                        Unstage
                      </HunkButton>
                    ) : (
                      <>
                        <HunkButton danger onClick={() => hunkAction(h, 'discard')} disabled={act.isPending}>
                          Discard
                        </HunkButton>
                        <HunkButton primary onClick={() => hunkAction(h, 'stage')} disabled={act.isPending}>
                          Stage
                        </HunkButton>
                      </>
                    )
                : undefined
            }
          />
        )}
        <div className="h-10" />
      </Page>
    </>
  )
}

function HunkButton({
  children,
  onClick,
  primary,
  danger,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={
        'h-8 shrink-0 rounded-lg px-3 text-xs font-semibold disabled:opacity-50 ' +
        (primary ? 'bg-accent text-accent-fg' : danger ? 'text-del active:bg-line' : 'bg-surface active:bg-line')
      }
    >
      {children}
    </button>
  )
}
