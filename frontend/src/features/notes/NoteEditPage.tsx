import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { EditorView } from '@codemirror/view'
import { BookOpen, Copy, MoreVertical, Pencil, Trash2, TextCursorInput, FolderOpen } from 'lucide-react'
import { api } from '../../api/client'
import { touchRecent } from '../../api/queries'
import { TopBar } from '../../components/TopBar'
import { ErrorView, IconButton, Loading } from '../../components/ui'
import { Sheet, SheetItem } from '../../components/Sheet'
import { Page } from '../../components/Shell'
import { MarkdownView } from '../../components/MarkdownView'
import { useDialogs } from '../../components/dialogs'
import { CodeEditor } from '../../editor/CodeEditor'
import { EditorToolbar } from '../../editor/EditorToolbar'
import { ConflictSheet, DraftBanner, SaveIndicator } from '../../editor/EditorChrome'
import { useFileDoc } from '../../editor/useFileDoc'
import { basename, dirname, isMarkdown, relative } from '../../lib/path'
import { copyText } from '../../lib/util'
import { useGoUp } from '../../lib/nav'
import { useFileOps } from '../files/FileActions'
import { viewPath } from '../files/FilesPage'
import { useVaultGate } from './NotesHome'
import { NoteTabs, noteEditPath } from './NoteTabs'
import { addOpenNote, closeOpenNote, renameOpenNote } from './openNotes'

// Each open tab remembers whether it was in edit or preview mode.
const modes = new Map<string, 'edit' | 'preview'>()

export function NoteEditPage() {
  const gate = useVaultGate()
  const [params] = useSearchParams()
  const path = params.get('path') ?? ''
  if ('gate' in gate) return gate.gate
  // Keyed by path: switching tabs mounts a fresh editor for that note.
  return <NoteEditor key={path} path={path} vault={gate.vault} ws={gate.ws} isNew={params.get('new') === '1'} />
}

function NoteEditor({ path, vault, ws, isNew }: { path: string; vault: string; ws: number; isNew: boolean }) {
  const navigate = useNavigate()
  const goUp = useGoUp()
  const { toast, toastError } = useDialogs()
  const ops = useFileOps()
  // Notes autosave two seconds after you stop typing.
  const doc = useFileDoc(path, { autosaveMs: 2000 })
  const [mode, setModeState] = useState<'edit' | 'preview'>(() => modes.get(path) ?? (isNew ? 'edit' : 'preview'))
  const [view, setView] = useState<EditorView | null>(null)
  const [focused, setFocused] = useState(false)
  const [menu, setMenu] = useState(false)

  const setMode = (m: 'edit' | 'preview') => {
    modes.set(path, m)
    setModeState(m)
  }

  useEffect(() => {
    if (!doc.file) return
    touchRecent(path, 'note')
    addOpenNote(vault, path)
  }, [doc.file, path, vault])

  // Put the cursor at the end of a brand-new note.
  useEffect(() => {
    if (!isNew || !view || !doc.file) return
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
  }, [isNew, view, doc.file])

  /** Save pending edits before leaving this note (tab switch, back, close). */
  const flush = async () => {
    if (doc.dirty && doc.saveState !== 'conflict') {
      try {
        await doc.save()
      } catch (e) {
        toastError(e)
      }
    }
  }

  const copyAll = async () => {
    const ok = await copyText(doc.content)
    toast(ok ? 'Note copied' : 'Copy failed', ok ? 'ok' : 'error')
  }

  const title = basename(path).replace(/\.md$/i, '')
  const folder = relative(vault, dirname(path))

  return (
    <>
      <TopBar
        back
        onBack={async () => {
          await flush()
          goUp('/notes')
        }}
        title={
          <span className="inline-flex items-center gap-2">
            {title} <SaveIndicator state={doc.saveState} dirty={doc.dirty} />
          </span>
        }
        subtitle={folder || basename(vault)}
        actions={
          <>
            <IconButton label="Copy note" onClick={copyAll}>
              <Copy className="h-5 w-5" />
            </IconButton>
            <IconButton
              label={mode === 'edit' ? 'Preview' : 'Edit'}
              onClick={() => {
                if (mode === 'edit') view?.contentDOM.blur()
                setMode(mode === 'edit' ? 'preview' : 'edit')
              }}
            >
              {mode === 'edit' ? <BookOpen className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
            </IconButton>
            <IconButton label="More" onClick={() => setMenu(true)}>
              <MoreVertical className="h-5 w-5" />
            </IconButton>
          </>
        }
      />
      {!focused && <NoteTabs vault={vault} active={path} onSwitch={flush} />}
      {doc.query.isLoading && <Loading />}
      {doc.query.error && <ErrorView error={doc.query.error} onRetry={() => doc.query.refetch()} />}
      {doc.file && (
        <>
          <DraftBanner doc={doc} />
          {mode === 'preview' ? (
            <Page>
              <div onDoubleClick={() => setMode('edit')}>
                <MarkdownView
                  content={doc.content}
                  filePath={path}
                  onOpenPath={(p) => navigate(isMarkdown(p) ? noteEditPath(p) : viewPath(p))}
                  onWikiLink={async (name) => {
                    try {
                      const r = await api.get<{ path: string }>('/api/notes/resolve', { ws, name })
                      await flush()
                      navigate(noteEditPath(r.path))
                    } catch {
                      toast(`No note named "${name}" yet`, 'error')
                    }
                  }}
                />
                {!doc.content.trim() && (
                  <button className="w-full px-4 py-10 text-center text-muted" onClick={() => setMode('edit')}>
                    Empty note. Tap to write.
                  </button>
                )}
              </div>
            </Page>
          ) : (
            <>
              <div className="min-h-0 flex-1" onFocusCapture={() => setFocused(true)} onBlurCapture={() => setFocused(false)}>
                <CodeEditor
                  value={doc.content}
                  filename={path}
                  onChange={doc.setContent}
                  resetKey={doc.resetKey}
                  showLineNumbers={false}
                  onView={setView}
                />
              </div>
              {focused && <EditorToolbar view={view} mode="markdown" onDone={() => setFocused(false)} />}
            </>
          )}
        </>
      )}
      <ConflictSheet doc={doc} />
      <Sheet open={menu} onClose={() => setMenu(false)} title={title}>
        <SheetItem
          icon={<TextCursorInput className="h-5 w-5" />}
          onClick={async () => {
            setMenu(false)
            await flush()
            const p = await ops.rename(path)
            if (p) {
              renameOpenNote(vault, path, p)
              navigate(noteEditPath(p), { replace: true })
            }
          }}
        >
          Rename
        </SheetItem>
        <SheetItem
          icon={<FolderOpen className="h-5 w-5" />}
          onClick={async () => {
            setMenu(false)
            await flush()
            navigate('/notes/browse?path=' + encodeURIComponent(dirname(path)))
          }}
        >
          Show in folder
        </SheetItem>
        <SheetItem
          icon={<Copy className="h-5 w-5" />}
          onClick={() => {
            setMenu(false)
            ops.copy(path, 'Path copied')
          }}
        >
          Copy path
        </SheetItem>
        <SheetItem
          danger
          icon={<Trash2 className="h-5 w-5" />}
          onClick={async () => {
            setMenu(false)
            if (await ops.remove(path, false)) {
              const next = closeOpenNote(vault, path)
              navigate(next ? noteEditPath(next) : '/notes', { replace: true })
            }
          }}
        >
          Delete note
        </SheetItem>
        <div className="h-3" />
      </Sheet>
    </>
  )
}
