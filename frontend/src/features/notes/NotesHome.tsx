import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, FileText, FolderOpen, FolderTree, Gem, Inbox, Plus, Search, Send } from 'lucide-react'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { Note, WriteResult } from '../../api/types'
import { TopBar } from '../../components/TopBar'
import { Page } from '../../components/Shell'
import { Button, Card, EmptyState, ErrorView, IconButton, Loading, SectionTitle } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { basename, dirname, join } from '../../lib/path'
import { relTime, store } from '../../lib/util'
import { SearchSheet } from '../files/SearchSheet'
import { FolderPicker } from '../workspaces/FolderPicker'
import { useWorkspace } from '../workspaces/workspace'
import { NoteTabs, noteEditPath } from './NoteTabs'
import { VaultSetup } from './VaultSetup'

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

/** Gate for every Notes screen: needs an open workspace with a vault. */
export function useVaultGate(): { vault: string; ws: number } | { gate: JSX.Element } {
  const ws = useWorkspace()
  if (!ws.path) {
    return {
      gate: (
        <>
          <TopBar title="Notes" />
          <EmptyState
            icon={<FolderOpen className="h-10 w-10" />}
            title="No folder open"
            body="Open a project folder in Files first. Each project has its own vault."
            action={
              <Link to="/files">
                <Button variant="primary">Go to Files</Button>
              </Link>
            }
          />
        </>
      ),
    }
  }
  if (ws.loading) return { gate: <Loading /> }
  if (!ws.vault) {
    return {
      gate: (
        <>
          <TopBar title="Notes" subtitle={ws.record?.name} />
          <Page>
            <EmptyState
              icon={<Gem className="h-10 w-10" />}
              title={`No vault for ${ws.record?.name ?? basename(ws.path)}`}
              body="Choose the folder that holds this project's notes, like opening a vault in Obsidian."
            />
            <div className="px-4 pb-8">
              <VaultSetup workspace={ws.path} onPick={ws.setVault} />
            </div>
          </Page>
        </>
      ),
    }
  }
  return { vault: ws.vault, ws: ws.id! }
}

export function NotesHome() {
  const gate = useVaultGate()
  if ('gate' in gate) return gate.gate
  return <NotesHomeInner vault={gate.vault} ws={gate.ws} />
}

function NotesHomeInner({ vault, ws }: { vault: string; ws: number }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast, toastError } = useDialogs()
  const newNote = useNewNote()
  const draftKey = `kc.capture:${vault}`
  const [text, setText] = useState(() => store.get(draftKey, ''))
  const [searchOpen, setSearchOpen] = useState(false)
  const [pickFolder, setPickFolder] = useState(false)

  const recent = useQuery({
    queryKey: keys.notesRecent(vault),
    queryFn: () => api.get<Note[]>('/api/notes/recent', { ws }),
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
      navigate(noteEditPath(r.path))
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <>
      <TopBar
        title="Notes"
        subtitle={basename(vault)}
        actions={
          <>
            <IconButton label="Search notes" onClick={() => setSearchOpen(true)}>
              <Search className="h-5 w-5" />
            </IconButton>
            <IconButton label="New note" onClick={() => setPickFolder(true)}>
              <Plus className="h-6 w-6" />
            </IconButton>
          </>
        }
      />
      <NoteTabs vault={vault} active={null} />
      <Page onRefresh={() => recent.refetch()}>
        <SectionTitle>Quick capture</SectionTitle>
        <Card className="p-3">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              store.set(draftKey, e.target.value)
            }}
            rows={3}
            placeholder="A thought, a todo, a prompt…"
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
        </Card>

        <div className="mx-3 mt-3 grid grid-cols-2 gap-2">
          <button className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3.5 text-left active:bg-raised" onClick={openDaily}>
            <CalendarDays className="h-5 w-5 text-accent" />
            <span className="font-medium">Today's note</span>
          </button>
          <Link
            to={'/notes/browse?path=' + encodeURIComponent(vault)}
            className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3.5 active:bg-raised"
          >
            <FolderTree className="h-5 w-5 text-accent" />
            <span className="font-medium">Browse</span>
          </Link>
        </div>

        <SectionTitle>Recent</SectionTitle>
        {recent.isLoading && <Loading />}
        {recent.error && <ErrorView error={recent.error} onRetry={() => recent.refetch()} />}
        {recent.data && recent.data.length === 0 && <EmptyState title="No notes yet" body="Tap + to write the first one." />}
        {recent.data && recent.data.length > 0 && (
          <Card className="mb-6">
            {recent.data.map((n, i) => (
              <button
                key={n.path}
                className={'flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-raised ' + (i > 0 ? 'border-t border-line' : '')}
                onClick={() => navigate(noteEditPath(n.path))}
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
          </Card>
        )}
      </Page>
      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        root={vault}
        defaultMode="content"
        title="Search notes"
        onPick={(h) =>
          h.type === 'dir' ? navigate('/notes/browse?path=' + encodeURIComponent(h.path)) : navigate(noteEditPath(h.path))
        }
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
          if (p) navigate(noteEditPath(p, true))
        }}
      />
    </>
  )
}
