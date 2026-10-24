import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, CircleDot, Copy } from 'lucide-react'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { CommitDetail, Ref } from '../../api/types'
import { TopBar } from '../../components/TopBar'
import { Page } from '../../components/Shell'
import { ErrorView, IconButton, Loading } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { basename, dirname } from '../../lib/path'
import { copyText, cx, fullTime } from '../../lib/util'
import { DiffBody } from './DiffView'
import { repoPath } from './gitApi'
import { REF_COLOR, REMOTE_COLOR } from './graph'
import { refIcon, refRank } from './HistoryList'

export function CommitPage() {
  const [params] = useSearchParams()
  const repo = params.get('repo') ?? ''
  const rev = params.get('rev') ?? ''
  const { toast } = useDialogs()
  const q = useQuery({
    queryKey: keys.show(repo, rev),
    queryFn: () => api.get<CommitDetail>('/api/git/show', { repo, rev }),
    staleTime: Infinity,
  })
  const c = q.data
  // Expand everything for small commits, nothing for large ones.
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isOpen = (p: string) => open[p] ?? (c ? c.files.length <= 3 : false)

  return (
    <>
      <TopBar
        back
        up={repoPath(repo, 'history')}
        title={c?.subject ?? rev.slice(0, 7)}
        subtitle={c ? `${c.short} · ${c.author}` : undefined}
        actions={
          c && (
            <IconButton
              label="Copy hash"
              onClick={async () => {
                const ok = await copyText(c.hash)
                toast(ok ? 'Hash copied' : 'Copy failed', ok ? 'ok' : 'error')
              }}
            >
              <Copy className="h-5 w-5" />
            </IconButton>
          )
        }
      />
      <Page>
        {q.isLoading && <Loading />}
        {q.error && <ErrorView error={q.error} />}
        {c && (
          <>
            <div className="border-b border-line px-4 py-3">
              <div className="text-[17px] font-semibold leading-snug">{c.subject}</div>
              {c.refs && <RefList refs={c.refs} />}
              {c.body && <pre className="mt-2 whitespace-pre-wrap font-sans text-[15px] text-fg/90">{c.body}</pre>}
              <div className="mt-2 text-xs text-muted">
                {c.author} &lt;{c.email}&gt;
                <br />
                {fullTime(c.time)} · <span className="font-mono">{c.hash.slice(0, 12)}</span>
                {c.parents && c.parents.length > 1 && <> · merge</>}
              </div>
            </div>
            {c.files.map((f) => (
              <div key={f.path} className="border-b border-line">
                <button
                  className="sticky top-0 z-20 flex w-full items-center gap-2 bg-bg px-3 py-2.5 text-left active:bg-raised"
                  onClick={() => setOpen({ ...open, [f.path]: !isOpen(f.path) })}
                >
                  {isOpen(f.path) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px]">{basename(f.path)}</div>
                    <div className="truncate text-xs text-muted">
                      {f.status !== 'modified' && <span className="mr-1 capitalize">{f.status}</span>}
                      {f.oldPath ? `${f.oldPath} → ` : dirname(f.path) === '/' ? '' : dirname(f.path)}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs">
                    <span className="text-add">+{f.added}</span> <span className="text-del">-{f.removed}</span>
                  </span>
                </button>
                {isOpen(f.path) && <DiffBody diff={f} />}
              </div>
            ))}
            {c.truncated && <div className="px-4 py-6 text-center text-sm text-muted">Commit too large; some files are not shown.</div>}
            <div className="h-10" />
          </>
        )}
      </Page>
    </>
  )
}

const refTitle = (r: Ref) =>
  r.current ? 'Current branch' : r.upstream ? 'Upstream' : r.kind === 'branch' ? 'Branch' : r.kind === 'remote' ? 'Remote branch' : 'Tag'

/** Every branch and tag at this commit, by name; the history list only has room for counts. */
function RefList({ refs }: { refs: Ref[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {[...refs]
        .sort((a, b) => refRank(a) - refRank(b) || a.name.localeCompare(b.name))
        .map((r) => {
          const Icon = r.current ? CircleDot : refIcon[r.kind]
          // Colored as in the history graph; the rest plain.
          const color = r.current ? REF_COLOR : r.upstream ? REMOTE_COLOR : undefined
          return (
            <span
              key={`${r.kind}:${r.name}`}
              title={refTitle(r)}
              className={cx(
                'inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-xs font-semibold',
                color ? 'text-[#111]' : 'border border-line bg-raised text-fg',
              )}
              style={color ? { backgroundColor: color } : undefined}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-label={refTitle(r)} />
              <span className="truncate">{r.name}</span>
            </span>
          )
        })}
    </div>
  )
}
