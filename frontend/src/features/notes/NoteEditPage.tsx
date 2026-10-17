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
import { basename, dirname, isMarkdown } from '../../lib/path'
import { copyText } from '../../lib/util'
import { useFileOps } from '../files/FileActions'
import { viewPath } from '../files/FilesPage'
import { noteEditPath } from './NotesHome'

export function NoteEditPage() {
  const [params, setParams] = useSearchParams()
  const path = params.get('path') ?? ''
  const isNew = params.get('new') === '1'
  const navigate = useNavigate()
  const { toast, toastError } = useDialogs()
  const ops = useFileOps()
  // Notes autosave two seconds after you stop typing.
  const doc = useFileDoc(path, { autosaveMs: 2000 })
  const [mode, setMode] = useState<'edit' | 'preview'>(isNew ? 'edit' : 'preview')
  const [view, setView] = useState<EditorView | null>(null)
  const [focused, setFocused] = useState(false)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (doc.file) touchRecent(path, 'note')
  }, [doc.file, path])

  // Put the cursor at the end of a brand-new note.
  useEffect(() => {
    if (!isNew || !view || !doc.file) return
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
  }, [isNew, view, doc.file])

  const leave = async () => {
    if (doc.dirty && doc.saveState !== 'conflict') {
      try {
        await doc.save()
      } catch (e) {
        toastError(e)
        return
      }
    }
    navigate(-1)
  }

  const copyAll = async () => {
    const ok = await copyText(doc.content)
    toast(ok ? 'Note copied' : 'Copy failed', ok ? 'ok' : 'error')
  }

  const title = basename(path).replace(/\.md$/i, '')

  return (
    <>
      <TopBar
        back
        onBack={leave}
        title={
          <span className="inline-flex items-center gap-2">
            {title} <SaveIndicator state={doc.saveState} dirty={doc.dirty} />
          </span>
        }
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
                      const r = await api.get<{ path: string }>('/api/notes/resolve', { name })
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
            if (doc.dirty) await doc.save().catch(toastError)
            const p = await ops.rename(path)
            if (p) setParams({ path: p }, { replace: true })
          }}
        >
          Rename
        </SheetItem>
        <SheetItem
          icon={<FolderOpen className="h-5 w-5" />}
          onClick={() => {
            setMenu(false)
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
            if (await ops.remove(path, false)) navigate(-1)
          }}
        >
          Delete note
        </SheetItem>
        <div className="h-3" />
      </Sheet>
    </>
  )
}
