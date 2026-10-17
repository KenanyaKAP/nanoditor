import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Archive, ArrowDown, ArrowUp, ChevronDown, CloudDownload, FolderOpen, GitBranch, MoreVertical, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { RemoteResult } from '../../api/types'
import { TopBar } from '../../components/TopBar'
import { Page } from '../../components/Shell'
import { ErrorView, IconButton, Loading, Segmented } from '../../components/ui'
import { Sheet, SheetItem } from '../../components/Sheet'
import { useDialogs } from '../../components/dialogs'
import { useMe } from '../../api/queries'
import { cx } from '../../lib/util'
import { tildify } from '../../lib/path'
import { ChangesList } from './ChangesList'
import { CommitComposer } from './CommitComposer'
import { HistoryList } from './HistoryList'
import { BranchSheet, OutputSheet, StashSheet } from './RepoSheets'
import { useGitAction, useStatus } from './gitApi'

export function RepoView() {
  const [params, setParams] = useSearchParams()
  const repo = params.get('repo') ?? ''
  const tab = (params.get('tab') as 'changes' | 'history') || 'changes'
  const navigate = useNavigate()
  const me = useMe()
  const qc = useQueryClient()
  const { toast } = useDialogs()
  const status = useStatus(repo)
  const remote = useGitAction<RemoteResult>(repo)
  const [branchOpen, setBranchOpen] = useState(false)
  const [stashOpen, setStashOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [out, setOut] = useState<{ title: string; text: string } | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const st = status.data?.status
  const b = st?.branch
  const changeCount = st ? st.staged.length + st.changes.length + st.untracked.length + st.conflicts.length : 0

  const runRemote = (op: 'fetch' | 'pull' | 'push', rebase = false) => {
    setPending(op)
    remote.mutate(
      { url: `/api/git/${op}`, body: { rebase } },
      {
        onSuccess: (r) => {
          const text = r.output.trim()
          // Short successful output becomes a toast; anything longer is shown in full.
          if (text.split('\n').length <= 2 && text.length < 120) toast(text || `${op} done`)
          else setOut({ title: `git ${op}`, text })
        },
        onError: (e: any) => e?.detail && setOut({ title: `git ${op} failed`, text: e.detail }),
        onSettled: () => setPending(null),
      },
    )
  }

  return (
    <>
      <TopBar
        back
        title={status.data?.name ?? repo.split('/').pop()}
        subtitle={tildify(repo, me.data?.home)}
        actions={
          <>
            <IconButton label="Refresh" onClick={() => qc.invalidateQueries({ queryKey: ['git'] })}>
              <RefreshCw className={cx('h-5 w-5', status.isFetching && 'animate-spin')} />
            </IconButton>
            <IconButton label="More" onClick={() => setMenu(true)}>
              <MoreVertical className="h-5 w-5" />
            </IconButton>
          </>
        }
      />
      {status.isLoading && <Loading />}
      {status.error && <ErrorView error={status.error} onRetry={() => status.refetch()} />}
      {st && b && (
        <>
          <div className="shrink-0 space-y-2 border-b border-line px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                className="flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-xl bg-surface px-3 active:bg-raised"
                onClick={() => setBranchOpen(true)}
              >
                <GitBranch className="h-4 w-4 shrink-0 text-accent" />
                <span className="truncate text-[15px] font-medium">{b.detached ? `detached @ ${b.oid.slice(0, 7)}` : b.head}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
              </button>
              <RemoteButton label="Fetch" icon={<CloudDownload className="h-4 w-4" />} busy={pending === 'fetch'} onClick={() => runRemote('fetch')} />
              <RemoteButton
                label="Pull"
                count={b.behind}
                icon={<ArrowDown className="h-4 w-4" />}
                busy={pending === 'pull'}
                onClick={() => runRemote('pull')}
              />
              <RemoteButton
                label="Push"
                count={b.ahead}
                icon={<ArrowUp className="h-4 w-4" />}
                busy={pending === 'push'}
                highlight={b.ahead > 0 || (!b.upstream && !!b.oid)}
                onClick={() => runRemote('push')}
              />
            </div>
            <Segmented
              value={tab}
              onChange={(t) => setParams({ repo, tab: t }, { replace: true })}
              options={[
                { value: 'changes', label: `Changes${changeCount ? ` (${changeCount})` : ''}` },
                { value: 'history', label: 'History' },
              ]}
            />
          </div>
          {tab === 'changes' ? (
            <>
              <Page onRefresh={() => status.refetch()}>
                <ChangesList repo={repo} status={st} />
              </Page>
              <CommitComposer
                repo={repo}
                stagedCount={st.staged.length}
                hasUpstreamOrRemote={!b.detached}
                onOutput={(title, text) => setOut({ title, text })}
              />
            </>
          ) : (
            <Page onRefresh={() => qc.invalidateQueries({ queryKey: ['git', 'log', repo] })}>
              <HistoryList repo={repo} />
            </Page>
          )}
        </>
      )}
      <BranchSheet repo={repo} open={branchOpen} onClose={() => setBranchOpen(false)} />
      <StashSheet repo={repo} open={stashOpen} onClose={() => setStashOpen(false)} onOutput={(title, text) => setOut({ title, text })} />
      <OutputSheet out={out} onClose={() => setOut(null)} />
      <Sheet open={menu} onClose={() => setMenu(false)} title={status.data?.name}>
        <SheetItem
          icon={<ArrowDown className="h-5 w-5" />}
          onClick={() => {
            setMenu(false)
            runRemote('pull', true)
          }}
        >
          Pull with rebase
        </SheetItem>
        <SheetItem
          icon={<Archive className="h-5 w-5" />}
          onClick={() => {
            setMenu(false)
            setStashOpen(true)
          }}
        >
          Stashes…
        </SheetItem>
        <SheetItem
          icon={<FolderOpen className="h-5 w-5" />}
          onClick={() => {
            setMenu(false)
            navigate('/files?path=' + encodeURIComponent(repo))
          }}
        >
          Browse files
        </SheetItem>
        <div className="h-3" />
      </Sheet>
    </>
  )
}

function RemoteButton({
  label,
  icon,
  count,
  busy,
  highlight,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  count?: number
  busy?: boolean
  highlight?: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={cx(
        'flex h-10 shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-medium disabled:opacity-60',
        highlight ? 'bg-accent text-accent-fg' : 'bg-surface active:bg-raised',
      )}
    >
      {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : icon}
      {count ? <span>{count}</span> : <span className="sr-only">{label}</span>}
    </button>
  )
}
