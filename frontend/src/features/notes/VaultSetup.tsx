import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderSearch, Gem } from 'lucide-react'
import { api } from '../../api/client'
import { Button } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { relative } from '../../lib/path'
import { FolderPicker } from '../workspaces/FolderPicker'

/**
 * Pick the notes vault for a workspace: detected Obsidian vaults (folders with
 * .obsidian) inside it, or any folder.
 */
export function VaultSetup({
  workspace,
  current,
  onPick,
}: {
  workspace: string
  current?: string | null
  onPick: (vault: string) => Promise<void>
}) {
  const [picking, setPicking] = useState(false)
  const { toastError } = useDialogs()
  const detected = useQuery({
    queryKey: ['notes', 'detect', workspace],
    queryFn: () => api.get<string[]>('/api/notes/detect', { root: workspace }),
  })
  const choose = (p: string) => onPick(p).catch(toastError)
  const others = detected.data?.filter((d) => d !== current) ?? []

  return (
    <div className="space-y-2">
      {others.map((d) => (
        <button
          key={d}
          className="flex w-full items-center gap-3 rounded-xl bg-raised px-3 py-3 text-left active:bg-line"
          onClick={() => choose(d)}
        >
          <Gem className="h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">{relative(workspace, d) || 'This folder'}</div>
            <div className="text-xs text-muted">Obsidian vault found</div>
          </div>
          <span className="text-sm font-medium text-accent">Use</span>
        </button>
      ))}
      <Button className="w-full" icon={<FolderSearch className="h-4 w-4" />} onClick={() => setPicking(true)}>
        Choose a folder…
      </Button>
      <FolderPicker
        open={picking}
        start={current || workspace}
        title="Choose vault folder"
        confirmLabel="Use as vault"
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false)
          choose(p)
        }}
      />
    </div>
  )
}
