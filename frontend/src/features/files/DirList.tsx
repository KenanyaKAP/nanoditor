import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { api } from '../../api/client'
import type { Entry, ListResponse } from '../../api/types'
import { FileIcon } from '../../components/FileIcon'
import { EmptyState, ErrorView, Loading } from '../../components/ui'
import { Page } from '../../components/Shell'
import { cx, fileSize, relTime } from '../../lib/util'
import { basename, relative } from '../../lib/path'
import { FileActions } from './FileActions'

const gitColor: Record<string, string> = {
  M: 'text-warn',
  A: 'text-add',
  '?': 'text-add',
  D: 'text-del',
  U: 'text-del',
  R: 'text-accent',
  '•': 'text-warn',
}

export function useListing(path: string | null, hidden?: boolean) {
  return useQuery({
    queryKey: ['fs', 'list', path, hidden ?? null],
    queryFn: () => api.get<ListResponse>('/api/fs/list', { path: path!, git: true, hidden: hidden === undefined ? undefined : hidden ? '1' : '0' }),
    enabled: !!path,
  })
}

/** Breadcrumb trail relative to a base folder (the workspace or vault). */
export function Breadcrumbs({ base, path, onNavigate }: { base: string; path: string; onNavigate: (p: string) => void }) {
  const rel = relative(base, path)
  let crumbs: { label: string; path: string }[]
  if (rel === null) {
    const parts = path.split('/').filter(Boolean)
    crumbs = [{ label: '/', path: '/' }, ...parts.map((p, i) => ({ label: p, path: '/' + parts.slice(0, i + 1).join('/') }))]
  } else {
    const parts = rel ? rel.split('/') : []
    crumbs = [
      { label: basename(base), path: base },
      ...parts.map((p, i) => ({ label: p, path: base + '/' + parts.slice(0, i + 1).join('/') })),
    ]
  }
  return (
    <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-4 py-2 text-sm" ref={(el) => el && (el.scrollLeft = el.scrollWidth)}>
      {crumbs.map((c, i) => (
        <span key={c.path} className="flex shrink-0 items-center gap-1">
          {i > 0 && <span className="text-muted">/</span>}
          <button
            className={cx('rounded-md px-1.5 py-1', i === crumbs.length - 1 ? 'font-semibold' : 'text-accent active:bg-raised')}
            onClick={() => onNavigate(c.path)}
          >
            {c.label}
          </button>
        </span>
      ))}
    </div>
  )
}

export function DirList({
  path,
  base,
  hidden,
  onOpenDir,
  onOpenFile,
  header,
}: {
  path: string
  base: string
  hidden?: boolean
  onOpenDir: (p: string) => void
  onOpenFile: (e: Entry) => void
  header?: React.ReactNode
}) {
  const q = useListing(path, hidden)
  const qc = useQueryClient()
  const [menu, setMenu] = useState<Entry | null>(null)

  return (
    <Page onRefresh={() => qc.invalidateQueries({ queryKey: ['fs', 'list', path] })}>
      {header}
      <Breadcrumbs base={base} path={path} onNavigate={onOpenDir} />
      {q.data?.repo && q.data.branch && (
        <div className="px-4 pb-1 text-xs text-muted">
          git · <span className="font-medium text-fg">{q.data.branch}</span>
        </div>
      )}
      {q.isLoading && <Loading />}
      {q.error && <ErrorView error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.listing.entries.length === 0 && <EmptyState title="Empty folder" />}
      {q.data && (
        <ul className="pb-6">
          {q.data.listing.entries.map((e) => (
            <li key={e.path} className="flex items-center">
              <button
                className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 pl-4 text-left active:bg-raised"
                onClick={() => (e.type === 'dir' ? onOpenDir(e.path) : onOpenFile(e))}
              >
                <FileIcon name={e.name} type={e.type} symlink={e.isSymlink} />
                <div className="min-w-0 flex-1 py-1.5">
                  <div className="truncate text-[15px]">{e.name}</div>
                  <div className="truncate text-xs text-muted">
                    {e.type === 'file' ? `${fileSize(e.size)} · ` : ''}
                    {relTime(e.mtime)}
                  </div>
                </div>
                {e.git && (
                  <span className={cx('w-4 shrink-0 text-center font-mono text-sm font-bold', gitColor[e.git] ?? 'text-muted')}>
                    {e.git}
                  </span>
                )}
              </button>
              <button
                aria-label={`Actions for ${e.name}`}
                className="flex h-[52px] w-12 shrink-0 items-center justify-center text-muted active:bg-raised"
                onClick={() => setMenu(e)}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <FileActions entry={menu} base={base} onClose={() => setMenu(null)} />
    </Page>
  )
}
