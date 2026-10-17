import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, CornerLeftUp, Folder, HardDrive } from 'lucide-react'
import { api } from '../../api/client'
import type { ListResponse } from '../../api/types'
import { Sheet } from '../../components/Sheet'
import { Button, ErrorView, Loading } from '../../components/ui'
import { useMe } from '../../api/queries'
import { basename, tildify } from '../../lib/path'

/** Sheet for choosing a folder, like VS Code's "Open Folder". */
export function FolderPicker({
  open,
  onClose,
  onPick,
  title = 'Open folder',
  start,
  confirmLabel = 'Open this folder',
}: {
  open: boolean
  onClose: () => void
  onPick: (path: string) => void
  title?: string
  start?: string | null
  confirmLabel?: string
}) {
  const me = useMe()
  const home = me.data?.home
  const [path, setPath] = useState<string | null>(null)
  // "All locations": the list of allowed roots (ALLOWED_ROOTS), above every root.
  const [showRoots, setShowRoots] = useState(false)
  const [hidden, setHidden] = useState(false)
  // Start in home only if it's inside an allowed root; otherwise the first root.
  const roots = me.data?.roots ?? []
  const homeAllowed = !!home && roots.some((r) => r === '/' || home === r || home.startsWith(r + '/'))
  const current = path ?? start ?? (homeAllowed ? home : roots[0]) ?? ''
  useEffect(() => {
    if (open) {
      setPath(null)
      setShowRoots(false)
    }
  }, [open])
  const goTo = (p: string) => {
    setShowRoots(false)
    setPath(p)
  }

  const q = useQuery({
    queryKey: ['fs', 'dirs', current, hidden],
    queryFn: () => api.get<ListResponse>('/api/fs/list', { path: current, dirs: true, hidden }),
    enabled: open && !!current && !showRoots,
  })
  const listing = q.data?.listing

  return (
    <Sheet
      open={open}
      onClose={onClose}
      full
      title={title}
      footer={
        <Button
          variant="primary"
          className="w-full"
          disabled={!listing || showRoots}
          onClick={() => {
            if (listing) onPick(listing.path)
          }}
        >
          {confirmLabel}
        </Button>
      }
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
        {/* rtl so long paths truncate at the start; LRMs keep "~/" in place. */}
        <div className="min-w-0 flex-1 truncate text-left font-mono text-xs text-muted" dir="rtl">
          {showRoots ? 'All locations' : '‎' + tildify(listing?.path ?? current, home) + '‎'}
        </div>
        <button className="shrink-0 text-xs text-accent" onClick={() => setHidden((h) => !h)}>
          {hidden ? 'Hide dotfolders' : 'Show dotfolders'}
        </button>
      </div>
      {showRoots && (
        <div>
          {roots.map((r) => (
            <button
              key={r}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-raised"
              onClick={() => goTo(r)}
            >
              <HardDrive className="h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{basename(r) || r}</div>
                <div className="truncate font-mono text-xs text-muted">{tildify(r, home)}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
            </button>
          ))}
        </div>
      )}
      {!showRoots && q.isLoading && <Loading />}
      {!showRoots && q.error && (
        <>
          {roots.length > 1 && <AllLocations onClick={() => setShowRoots(true)} />}
          <ErrorView error={q.error} onRetry={() => q.refetch()} />
        </>
      )}
      {!showRoots && listing && (
        <div>
          {listing.parent ? (
            <button
              className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-muted active:bg-raised"
              onClick={() => goTo(listing.parent!)}
            >
              <CornerLeftUp className="h-5 w-5" />
              <span>Up one level</span>
            </button>
          ) : (
            roots.length > 1 && <AllLocations onClick={() => setShowRoots(true)} />
          )}
          {listing.entries.map((e) => (
            <button
              key={e.path}
              className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left active:bg-raised"
              onClick={() => goTo(e.path)}
            >
              <Folder className="h-5 w-5 shrink-0 text-accent" fill="currentColor" fillOpacity={0.15} />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
            </button>
          ))}
          {listing.entries.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">No subfolders</div>}
        </div>
      )}
    </Sheet>
  )
}

function AllLocations({ onClick }: { onClick: () => void }) {
  return (
    <button className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-muted active:bg-raised" onClick={onClick}>
      <CornerLeftUp className="h-5 w-5" />
      <span>All locations</span>
    </button>
  )
}
