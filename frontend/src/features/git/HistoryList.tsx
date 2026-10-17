import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { Commit } from '../../api/types'
import { Button, ErrorView, Loading } from '../../components/ui'
import { relTime } from '../../lib/util'

const PAGE = 50

export function HistoryList({ repo }: { repo: string }) {
  const navigate = useNavigate()
  const q = useInfiniteQuery({
    queryKey: keys.log(repo),
    queryFn: ({ pageParam }) => api.get<Commit[]>('/api/git/log', { repo, limit: PAGE, skip: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length < PAGE ? undefined : all.length * PAGE),
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorView error={q.error} onRetry={() => q.refetch()} />
  const commits = q.data?.pages.flat() ?? []
  if (commits.length === 0) return <div className="px-6 py-16 text-center text-muted">No commits yet.</div>
  return (
    <div className="pb-6">
      <ul>
        {commits.map((c) => (
          <li key={c.hash}>
            <button
              className="flex w-full gap-3 border-b border-line px-4 py-2.5 text-left active:bg-raised"
              onClick={() => navigate(`/git/commit?repo=${encodeURIComponent(repo)}&rev=${c.hash}`)}
            >
              <div className="mt-1.5 flex flex-col items-center">
                <span className={'h-2.5 w-2.5 rounded-full ' + (c.unpushed ? 'bg-accent' : 'bg-line')} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] leading-snug">{c.subject}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="font-mono">{c.short}</span>
                  <span>{c.author}</span>
                  <span>{relTime(c.time)}</span>
                  {c.unpushed && <span className="text-accent">not pushed</span>}
                  {c.refs?.map((r) => (
                      <span key={r} className="rounded bg-raised px-1.5 py-px font-medium text-fg">
                        {r.replace('HEAD -> ', '→ ')}
                      </span>
                    ))}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <div className="p-4 text-center">
          <Button loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
