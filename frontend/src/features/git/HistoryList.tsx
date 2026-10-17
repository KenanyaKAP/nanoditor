import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, CircleDot, Cloud, GitBranch, Tag } from 'lucide-react'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { LogCommit, Ref } from '../../api/types'
import { Button, ErrorView, Loading, Segmented } from '../../components/ui'
import { cx, relTime, store } from '../../lib/util'
import { LANE_W, REF_COLOR, REMOTE_COLOR, ROW_H, type RowShape, laneX, layoutGraph, rowShape } from './graph'

const PAGE = 50
// Wider graphs are cut off so the commit text keeps room on a phone.
const MAX_GRAPH_W = laneX(9) + LANE_W

export function HistoryList({ repo }: { repo: string }) {
  const navigate = useNavigate()
  const scopeKey = `nd.git.graph:${repo}`
  const [scope, setScope] = useState(() => store.get<'all' | 'current'>(scopeKey, 'all'))
  const all = scope === 'all'
  const q = useInfiniteQuery({
    queryKey: keys.log(repo, all),
    queryFn: ({ pageParam }) => api.get<LogCommit[]>('/api/git/log', { repo, limit: PAGE, skip: pageParam, all }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < PAGE ? undefined : pages.length * PAGE),
  })
  const rows = useMemo(() => layoutGraph(q.data?.pages.flat() ?? []), [q.data])

  return (
    <div className="pb-6">
      <div className="px-4 pb-1 pt-3">
        <Segmented
          className="w-full"
          value={scope}
          onChange={(s) => {
            setScope(s)
            store.set(scopeKey, s)
          }}
          options={[
            { value: 'current', label: 'Current branch' },
            { value: 'all', label: 'All branches' },
          ]}
        />
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorView error={q.error} onRetry={() => q.refetch()} />}
      {q.data && rows.length === 0 && <div className="px-6 py-16 text-center text-muted">No commits yet.</div>}
      <ul>
        {rows.map((row) => {
          const c = row.commit
          const shape = rowShape(row)
          return (
            <li key={c.hash}>
              <button
                className="flex w-full items-stretch text-left active:bg-raised"
                style={{ height: ROW_H }}
                onClick={() => navigate(`/git/commit?repo=${encodeURIComponent(repo)}&rev=${c.hash}`)}
              >
                <GraphCell shape={shape} />
                <div className="flex min-w-0 flex-1 flex-col justify-center border-b border-line pr-4">
                  <div className={cx('truncate text-[15px] leading-tight', c.head && 'font-semibold')}>{c.subject}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted">
                    <RefBadges refs={c.refs} laneColor={shape.dot.color} />
                    {c.unpushed && <ArrowUp className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Not pushed" />}
                    <span className="truncate">
                      <span className="font-mono">{c.short}</span> · {c.author} · {relTime(c.time)}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
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

function GraphCell({ shape }: { shape: RowShape }) {
  const { dot } = shape
  const mid = ROW_H / 2
  return (
    <svg width={Math.min(shape.width, MAX_GRAPH_W)} height={ROW_H} className="shrink-0" aria-hidden>
      {shape.strokes.map((s, i) => (
        <path key={i} d={s.d} stroke={s.color} strokeWidth={2} fill="none" />
      ))}
      {dot.kind === 'head' ? (
        <circle cx={dot.x} cy={mid} r={6} fill="rgb(var(--bg))" stroke={dot.color} strokeWidth={2.5} />
      ) : dot.kind === 'merge' ? (
        <>
          <circle cx={dot.x} cy={mid} r={5} fill="rgb(var(--bg))" stroke={dot.color} strokeWidth={2} />
          <circle cx={dot.x} cy={mid} r={2} fill={dot.color} />
        </>
      ) : (
        <circle cx={dot.x} cy={mid} r={4} fill={dot.color} />
      )}
    </svg>
  )
}

const refIcon = { branch: GitBranch, remote: Cloud, tag: Tag }

/**
 * VS Code-style ref pills: the most important ref with its name, the
 * upstream as a purple cloud, and the rest as counts per kind.
 */
function RefBadges({ refs, laneColor }: { refs?: Ref[]; laneColor: string }) {
  if (!refs?.length) return null
  const rank = (r: Ref) => (r.current ? 0 : r.kind === 'branch' ? 1 : r.kind === 'tag' ? 2 : r.upstream ? 3 : 4)
  const [main, ...rest] = [...refs].sort((a, b) => rank(a) - rank(b))
  const upstream = rest.find((r) => r.upstream)
  const others = rest.filter((r) => r !== upstream)
  const MainIcon = main.current ? CircleDot : refIcon[main.kind]
  const mainColor = main.current ? REF_COLOR : main.upstream ? REMOTE_COLOR : laneColor
  return (
    <>
      <Pill color={mainColor} title={main.name}>
        <MainIcon className="h-3 w-3 shrink-0" />
        <span className="truncate">{main.name}</span>
      </Pill>
      {upstream && (
        <Pill color={REMOTE_COLOR} title={upstream.name}>
          <Cloud className="h-3 w-3" />
        </Pill>
      )}
      {(['branch', 'remote', 'tag'] as const).map((kind) => {
        const n = others.filter((r) => r.kind === kind).length
        if (!n) return null
        const Icon = refIcon[kind]
        return (
          <Pill key={kind} color={laneColor} title={others.filter((r) => r.kind === kind).map((r) => r.name).join(', ')}>
            {n}
            <Icon className="h-3 w-3" />
          </Pill>
        )
      })}
    </>
  )
}

function Pill({ color, title, children }: { color: string; title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex h-[18px] min-w-0 max-w-[10rem] shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] font-semibold leading-none text-[#111]"
      style={{ backgroundColor: color }}
    >
      {children}
    </span>
  )
}
