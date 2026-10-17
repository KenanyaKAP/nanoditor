import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronDown, FileText, FolderTree, Gem, Inbox, Plus, Search, Send } from 'lucide-react'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { Note, WriteResult } from '../../api/types'
import { Button, Card } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { basename, dirname, join } from '../../lib/path'
import { cx, relTime, store } from '../../lib/util'
import { SearchSheet } from '../files/SearchSheet'
import { dirUrl, openPath } from '../files/openFiles'
import { FolderPicker } from '../workspaces/FolderPicker'

/** Ask for a title, create the note in folder, return its path. */
export function useNewNote() {
  const { prompt, toastError } = useDialogs()
  const qc = useQueryClient()
  return async (folder: string): Promise<string | null> => {
    const title = await prompt({ title: 'New note', placeholder: 'Title', confirmLabel: 'Create' })
    if (!title) return null
    const name = title.replace(/[/\\:*?"<>|]/g, '-').trim()
    const path = join(folder, name.toLowerCase().endsWith('.md') ? name : name + '.md')
    try {
      await api.put<WriteResult>('/api/fs/write', { path, content: `# ${title.replace(/\.md$/i, '')}\n\n`, etag: '' })
      qc.invalidateQueries({ queryKey: ['notes'] })
      qc.invalidateQueries({ queryKey: ['fs', 'list'] })
      return path
    } catch (e) {
      toastError(e)
      return null
    }
  }
}

/**
 * The workspace's vault at the top of Files: quick capture, today's note and
 * recent notes. Collapsible, so it stays out of the way of the folder list.
 */
export function VaultPanel({ vault, ws, workspace }: { vault: string; ws: number; workspace: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast, toastError } = useDialogs()
  const newNote = useNewNote()
  const draftKey = `nd.capture:${vault}`
  const expandedKey = `nd.vault.expanded:${vault}`
  const [expanded, setExpanded] = useState(() => store.get(expandedKey, true))
  const [text, setText] = useState(() => store.get(draftKey, ''))
  const [searchOpen, setSearchOpen] = useState(false)
  const [pickFolder, setPickFolder] = useState(false)

  const recent = useQuery({
    queryKey: keys.notesRecent(vault),
    queryFn: () => api.get<Note[]>('/api/notes/recent', { ws }),
    enabled: expanded,
  })

  const capture = useMutation({
    mutationFn: (target: 'inbox' | 'daily') => api.post<WriteResult>('/api/notes/capture', { ws: String(ws), text, target }),
    onSuccess: (_r, target) => {
      setText('')
      store.remove(draftKey)
      toast(target === 'inbox' ? 'Added to Inbox' : "Added to today's note")
      qc.invalidateQueries({ queryKey: ['notes'] })
      qc.invalidateQueries({ queryKey: ['fs'] })
    },
    onError: toastError,
  })

  const openDaily = async () => {
    try {
      const r = await api.post<{ path: string }>('/api/notes/daily', { ws: String(ws) })
      navigate(openPath(r.path))
    } catch (e) {
      toastError(e)
    }
  }

  const actions = [
    { label: 'Today', icon: CalendarDays, onClick: openDaily },
    // A vault that is the workspace folder itself is the list below.
    ...(vault !== workspace ? [{ label: 'Browse', icon: FolderTree, onClick: () => navigate(dirUrl(vault, workspace)) }] : []),
    { label: 'Search', icon: Search, onClick: () => setSearchOpen(true) },
    { label: 'New note', icon: Plus, onClick: () => setPickFolder(true) },
  ]

  return (
    <>
      <Card className="mt-3">
        <button
          className="flex w-full items-center gap-2 px-4 py-3 text-left active:bg-raised"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded)
            store.set(expandedKey, !expanded)
          }}
        >
          <Gem className="h-4 w-4 shrink-0 text-accent" />
          <span className="font-semibold">Vault</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{basename(vault)}</span>
          <ChevronDown className={cx('h-4 w-4 shrink-0 text-muted transition-transform', !expanded && '-rotate-90')} />
        </button>
        {expanded && (
          <>
            <div className="border-t border-line p-3">
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  store.set(draftKey, e.target.value)
                }}
                rows={2}
                placeholder="Quick capture: a thought, a todo, a prompt…"
                className="block w-full resize-none bg-transparent outline-none placeholder:text-muted"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  icon={<Inbox className="h-4 w-4" />}
                  disabled={!text.trim()}
                  loading={capture.isPending && capture.variables === 'inbox'}
                  onClick={() => capture.mutate('inbox')}
                >
                  Add to Inbox
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="flex-1"
                  icon={<Send className="h-4 w-4" />}
                  disabled={!text.trim()}
                  loading={capture.isPending && capture.variables === 'daily'}
                  onClick={() => capture.mutate('daily')}
                >
                  Add to Today
                </Button>
              </div>
            </div>
            <div className="flex border-t border-line">
              {actions.map((a) => (
                <button
                  key={a.label}
                  className="flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium active:bg-raised"
                  onClick={a.onClick}
                >
                  <a.icon className="h-5 w-5 text-accent" />
                  {a.label}
                </button>
              ))}
            </div>
            {recent.data?.slice(0, 3).map((n) => (
              <button
                key={n.path}
                className="flex w-full items-center gap-3 border-t border-line px-4 py-2.5 text-left active:bg-raised"
                onClick={() => navigate(openPath(n.path))}
              >
                <FileText className="h-5 w-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px]">{n.name}</div>
                  <div className="truncate text-xs text-muted">
                    {n.rel.includes('/') ? dirname(n.rel) + ' · ' : ''}
                    {relTime(n.mtime)}
                  </div>
                </div>
              </button>
            ))}
          </>
        )}
      </Card>
      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        root={vault}
        defaultMode="content"
        title="Search notes"
        onPick={(h) => navigate(h.type === 'dir' ? dirUrl(h.path, workspace) : openPath(h.path))}
      />
      <FolderPicker
        open={pickFolder}
        start={vault}
        title="New note in…"
        confirmLabel="Create note here"
        onClose={() => setPickFolder(false)}
        onPick={async (folder) => {
          setPickFolder(false)
          const p = await newNote(folder)
          if (p) navigate(openPath(p, { isNew: true }))
        }}
      />
    </>
  )
}
