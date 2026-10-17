import { Check, Cloud, CloudOff, Loader2 } from 'lucide-react'
import { Button } from '../components/ui'
import { Sheet } from '../components/Sheet'
import { useDialogs } from '../components/dialogs'
import { copyText, relTime } from '../lib/util'
import type { SaveState } from './useFileDoc'

type Doc = {
  content: string
  saveState: SaveState
  save: (force?: boolean) => Promise<boolean>
  reload: () => Promise<void>
  dismissConflict: () => void
  draft: { savedAt: number } | null
  restoreDraft: () => void
  discardDraft: () => void
}

/** Shown when a save hit a 409 because the file changed on disk. */
export function ConflictSheet({ doc }: { doc: Doc }) {
  const { toast, toastError } = useDialogs()
  return (
    <Sheet open={doc.saveState === 'conflict'} onClose={doc.dismissConflict} title="File changed on disk">
      <div className="space-y-3 p-4">
        <p className="text-[15px] text-muted">
          Something (another editor or Obsidian) changed this file after you opened it. What should happen to your
          version?
        </p>
        <Button
          variant="danger"
          className="w-full"
          onClick={() => doc.save(true).then(() => toast('Overwrote the file')).catch(toastError)}
        >
          Overwrite with my version
        </Button>
        <Button
          className="w-full"
          onClick={async () => {
            const ok = await copyText(doc.content)
            await doc.reload().catch(toastError)
            toast(ok ? 'Your version is on the clipboard. Loaded theirs.' : 'Loaded their version', 'info')
          }}
        >
          Copy mine, then load theirs
        </Button>
        <Button className="w-full" onClick={() => doc.reload().catch(toastError)}>
          Discard mine, load theirs
        </Button>
        <Button variant="ghost" className="w-full" onClick={doc.dismissConflict}>
          Keep editing
        </Button>
      </div>
    </Sheet>
  )
}

export function DraftBanner({ doc }: { doc: Doc }) {
  if (!doc.draft) return null
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-warn/10 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">Unsaved draft from {relTime(doc.draft.savedAt)}</span>
      <Button size="sm" variant="ghost" onClick={doc.discardDraft}>
        Discard
      </Button>
      <Button size="sm" variant="primary" onClick={doc.restoreDraft}>
        Restore
      </Button>
    </div>
  )
}

export function SaveIndicator({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state === 'saving') return <Loader2 className="h-4 w-4 animate-spin text-muted" />
  if (state === 'error' || state === 'conflict') return <CloudOff className="h-4 w-4 text-del" />
  if (dirty) return <span className="h-2.5 w-2.5 rounded-full bg-warn" aria-label="Unsaved changes" />
  if (state === 'saved') return <Check className="h-4 w-4 text-add" />
  return <Cloud className="h-4 w-4 text-muted" />
}
