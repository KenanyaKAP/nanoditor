import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, FolderGit2, GitBranch, RefreshCw, Search } from 'lucide-react'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { RepoSummary } from '../../api/types'
import { TopBar } from '../../components/TopBar'
import { Page } from '../../components/Shell'
import { Button, EmptyState, ErrorView, IconButton, Loading } from '../../components/ui'
import { cx, relTime } from '../../lib/util'
import { repoPath } from './gitApi'

export function RepoList() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('')
  const q = useQuery({
    queryKey: keys.repos,
    queryFn: () => api.get<{ roots: string[]; repos: RepoSummary[] }>('/api/git/repos'),
  })
  const refresh = () =>
    qc.fetchQuery({
      queryKey: keys.repos,
      queryFn: () => api.get<{ roots: string[]; repos: RepoSummary[] }>('/api/git/repos', { fresh: true }),
    })

  const repos = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const all = q.data?.repos ?? []
    return f ? all.filter((r) => r.name.toLowerCase().includes(f) || r.branch.head.toLowerCase().includes(f)) : all
  }, [q.data, filter])

  const dirtyCount = (q.data?.repos ?? []).filter((r) => r.staged + r.unstaged + r.untracked + r.conflicted > 0).length

  return (
    <>
      <TopBar
        title="Git"
        subtitle={q.data ? `${q.data.repos.length} repos · ${dirtyCount} with changes` : undefined}
        actions={
          <IconButton label="Refresh" onClick={() => refresh()}>
            <RefreshCw className={cx('h-5 w-5', q.isFetching && 'animate-spin')} />
          </IconButton>
        }
      />
      <Page onRefresh={refresh}>
        {q.isLoading && <Loading label="Scanning repositories…" />}
        {q.error && <ErrorView error={q.error} onRetry={() => q.refetch()} />}
        {q.data && q.data.roots.length === 0 && (
          <EmptyState
            icon={<FolderGit2 className="h-10 w-10" />}
            title="No git folders yet"
            body="Add the folder that holds your repos in Settings. KennyCode finds every repo inside it."
            action={
              <Link to="/settings">
                <Button variant="primary">Open Settings</Button>
              </Link>
            }
          />
        )}
        {q.data && q.data.roots.length > 0 && (
          <>
            {q.data.repos.length > 6 && (
              <div className="px-3 pt-3">
                <div className="flex items-center gap-2 rounded-xl bg-surface px-3">
                  <Search className="h-4 w-4 text-muted" />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter repos"
                    autoCapitalize="off"
                    autoCorrect="off"
                    className="h-10 min-w-0 flex-1 bg-transparent outline-none"
                  />
                </div>
              </div>
            )}
            {q.data.repos.length === 0 && <EmptyState title="No repositories found" body="Try a larger scan depth in Settings." />}
            <ul className="py-2">
              {repos.map((r) => (
                <RepoRow key={r.path} r={r} onOpen={() => navigate(repoPath(r.path))} />
              ))}
            </ul>
          </>
        )}
      </Page>
    </>
  )
}

function RepoRow({ r, onOpen }: { r: RepoSummary; onOpen: () => void }) {
  const changes = r.staged + r.unstaged + r.untracked + r.conflicted
  return (
    <li>
      <button className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-raised" onClick={onOpen}>
        <FolderGit2 className={cx('mt-0.5 h-5 w-5 shrink-0', changes ? 'text-warn' : 'text-muted')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-medium">{r.name}</span>
            {changes > 0 && (
              <span className="shrink-0 rounded-full bg-warn/15 px-2 py-px text-xs font-semibold text-warn">{changes}</span>
            )}
          </div>
          {r.error ? (
            <div className="truncate text-xs text-del">{r.error}</div>
          ) : (
            <>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span className="truncate">{r.branch.detached ? 'detached' : r.branch.head}</span>
                </span>
                {r.branch.ahead > 0 && (
                  <span className="inline-flex items-center text-accent">
                    <ArrowUp className="h-3 w-3" />
                    {r.branch.ahead}
                  </span>
                )}
                {r.branch.behind > 0 && (
                  <span className="inline-flex items-center text-warn">
                    <ArrowDown className="h-3 w-3" />
                    {r.branch.behind}
                  </span>
                )}
                {!r.branch.upstream && r.branch.oid && <span>· no upstream</span>}
              </div>
              {r.lastCommit && (
                <div className="mt-0.5 truncate text-xs text-muted">
                  {r.lastCommit.subject} · {relTime(r.lastCommit.time)}
                </div>
              )}
            </>
          )}
        </div>
      </button>
    </li>
  )
}
