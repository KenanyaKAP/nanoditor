import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, Check, Cloud, GitBranch, Plus } from 'lucide-react'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { BranchInfo, RemoteResult, Stash } from '../../api/types'
import { Sheet, SheetItem } from '../../components/Sheet'
import { Button, ErrorView, Loading, SectionTitle } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { relTime } from '../../lib/util'
import { useGitAction } from './gitApi'

export function BranchSheet({ repo, open, onClose }: { repo: string; open: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: keys.branches(repo),
    queryFn: () => api.get<BranchInfo[]>('/api/git/branches', { repo }),
    enabled: open,
  })
  const act = useGitAction(repo)
  const { prompt, toast } = useDialogs()
  const [filter, setFilter] = useState('')

  const checkout = (branch: string, create = false) =>
    act.mutate(
      { url: '/api/git/checkout', body: { branch, create } },
      {
        onSuccess: () => {
          toast(create ? `Created ${branch}` : `Switched to ${branch}`)
          onClose()
        },
      },
    )

  const f = filter.trim().toLowerCase()
  const match = (b: BranchInfo) => !f || b.name.toLowerCase().includes(f)
  const local = q.data?.filter((b) => !b.remote && match(b)) ?? []
  const localNames = new Set(q.data?.filter((b) => !b.remote).map((b) => b.name))
  // Hide remote branches that already have a local counterpart.
  const remote = q.data?.filter((b) => b.remote && match(b) && !localNames.has(b.name.split('/').slice(1).join('/'))) ?? []

  return (
    <Sheet open={open} onClose={onClose} title="Branches" full>
      <div className="sticky top-0 z-10 flex gap-2 border-b border-line bg-surface p-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter branches"
          autoCapitalize="off"
          autoCorrect="off"
          className="h-10 min-w-0 flex-1 rounded-xl bg-raised px-3 outline-none"
        />
        <Button
          size="sm"
          variant="primary"
          className="h-10"
          icon={<Plus className="h-4 w-4" />}
          onClick={async () => {
            const name = await prompt({ title: 'New branch from HEAD', placeholder: 'feature/name', confirmLabel: 'Create' })
            if (name) checkout(name, true)
          }}
        >
          New
        </Button>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorView error={q.error} />}
      {local.length > 0 && <SectionTitle>Local</SectionTitle>}
      {local.map((b) => (
        <SheetItem
          key={b.name}
          icon={<GitBranch className="h-5 w-5" />}
          disabled={act.isPending}
          onClick={() => !b.current && checkout(b.name)}
          right={b.current ? <Check className="h-5 w-5 text-accent" /> : <span className="text-xs text-muted">{relTime(b.time)}</span>}
        >
          <div className="truncate">{b.name}</div>
          {b.upstream && <div className="truncate text-xs text-muted">→ {b.upstream}</div>}
        </SheetItem>
      ))}
      {remote.length > 0 && <SectionTitle>Remote</SectionTitle>}
      {remote.map((b) => (
        <SheetItem
          key={b.name}
          icon={<Cloud className="h-5 w-5" />}
          disabled={act.isPending}
          onClick={() => checkout(b.name)}
          right={<span className="text-xs text-muted">{relTime(b.time)}</span>}
        >
          {b.name}
        </SheetItem>
      ))}
      <div className="h-4" />
    </Sheet>
  )
}

export function StashSheet({
  repo,
  open,
  onClose,
  onOutput,
}: {
  repo: string
  open: boolean
  onClose: () => void
  onOutput: (title: string, text: string) => void
}) {
  const q = useQuery({
    queryKey: keys.stash(repo),
    queryFn: () => api.get<Stash[]>('/api/git/stash', { repo }),
    enabled: open,
  })
  const act = useGitAction<RemoteResult>(repo)
  const { prompt, confirm } = useDialogs()

  const run = (action: string, ref?: string, message?: string) =>
    act.mutate(
      { url: '/api/git/stash', body: { action, ref, message } },
      { onSuccess: (r) => r.output && onOutput(`git stash ${action}`, r.output) },
    )

  return (
    <Sheet open={open} onClose={onClose} title="Stashes">
      <div className="p-3">
        <Button
          className="w-full"
          variant="primary"
          icon={<Archive className="h-4 w-4" />}
          loading={act.isPending}
          onClick={async () => {
            const m = await prompt({ title: 'Stash all changes', placeholder: 'Message (optional)', initial: 'WIP', confirmLabel: 'Stash' })
            if (m !== null) run('push', undefined, m)
          }}
        >
          Stash changes (incl. untracked)
        </Button>
      </div>
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <div className="pb-8 text-center text-sm text-muted">No stashes</div>}
      {q.data?.map((s) => (
        <div key={s.ref} className="border-t border-line px-4 py-3">
          <div className="text-[15px]">{s.message}</div>
          <div className="text-xs text-muted">
            {s.ref} · {relTime(s.time)}
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => run('apply', s.ref)}>
              Apply
            </Button>
            <Button size="sm" variant="primary" onClick={() => run('pop', s.ref)}>
              Pop
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-del"
              onClick={async () => {
                if (await confirm({ title: `Drop ${s.ref}?`, message: s.message, danger: true, confirmLabel: 'Drop' })) run('drop', s.ref)
              }}
            >
              Drop
            </Button>
          </div>
        </div>
      ))}
      <div className="h-3" />
    </Sheet>
  )
}

export function OutputSheet({ out, onClose }: { out: { title: string; text: string } | null; onClose: () => void }) {
  return (
    <Sheet open={!!out} onClose={onClose} title={out?.title}>
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed">{out?.text}</pre>
    </Sheet>
  )
}
