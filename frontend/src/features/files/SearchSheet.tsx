import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '../../api/client'
import type { SearchHit, SearchResult } from '../../api/types'
import { Sheet } from '../../components/Sheet'
import { FileIcon } from '../../components/FileIcon'
import { ErrorView, Segmented, Spinner } from '../../components/ui'
import { dirname, relative } from '../../lib/path'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function SearchSheet({
  open,
  onClose,
  root,
  onPick,
  defaultMode = 'name',
  title = 'Search',
}: {
  open: boolean
  onClose: () => void
  root: string
  onPick: (hit: SearchHit) => void
  defaultMode?: 'name' | 'content'
  title?: string
}) {
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<'name' | 'content'>(defaultMode)
  const dq = useDebounced(q.trim(), 300)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50)
  }, [open])

  const res = useQuery({
    queryKey: ['fs', 'search', root, mode, dq],
    queryFn: () => api.get<SearchResult>('/api/fs/search', { root, q: dq, mode }),
    enabled: open && dq.length >= 2,
  })

  return (
    <Sheet open={open} onClose={onClose} title={title} full>
      <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-surface p-3">
        <div className="flex items-center gap-2 rounded-xl bg-raised px-3">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={mode === 'name' ? 'File name' : 'Text in files'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="h-11 min-w-0 flex-1 bg-transparent outline-none"
          />
          {res.isFetching && <Spinner className="h-4 w-4" />}
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'name', label: 'Names' },
            { value: 'content', label: 'Contents' },
          ]}
        />
      </div>
      {res.error && <ErrorView error={res.error} />}
      {res.data && res.data.hits.length === 0 && <div className="py-10 text-center text-sm text-muted">No matches</div>}
      <ul>
        {res.data?.hits.map((h, i) => (
          <li key={h.path + ':' + (h.line ?? i)}>
            <button
              className="flex w-full items-start gap-3 px-4 py-2.5 text-left active:bg-raised"
              onClick={() => {
                onClose()
                onPick(h)
              }}
            >
              <span className="mt-0.5">
                <FileIcon name={h.name} type={h.type} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px]">
                  {h.name}
                  {h.line ? <span className="text-muted">:{h.line}</span> : null}
                </div>
                <div className="truncate text-xs text-muted">{relative(root, dirname(h.path)) || '.'}</div>
                {h.text && <div className="mt-1 line-clamp-2 break-all font-mono text-xs">{h.text.trim()}</div>}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {res.data?.truncated && <div className="py-4 text-center text-xs text-muted">Showing the first results only</div>}
    </Sheet>
  )
}
