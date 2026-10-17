import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import {
  BookOpen,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FolderOpen,
  ListOrdered,
  MoreVertical,
  Pencil,
  TextCursorInput,
  Trash2,
  WrapText,
} from 'lucide-react'
import { api, rawUrl } from '../../api/client'
import { touchRecent, useMe } from '../../api/queries'
import { TopBar } from '../../components/TopBar'
import { Button, ErrorView, IconButton, Loading } from '../../components/ui'
import { Sheet, SheetItem } from '../../components/Sheet'
import { Page } from '../../components/Shell'
import { MarkdownView } from '../../components/MarkdownView'
import { useDialogs } from '../../components/dialogs'
import { CodeEditor } from '../../editor/CodeEditor'
import { EditorToolbar } from '../../editor/EditorToolbar'
import { ConflictSheet, DraftBanner, SaveIndicator } from '../../editor/EditorChrome'
import { useFileDoc } from '../../editor/useFileDoc'
import { basename, dirname, isMarkdown, relative, tildify } from '../../lib/path'
import { copyText, fileSize, fullTime, store } from '../../lib/util'
import { useGoUp } from '../../lib/nav'
import { useWorkspace } from '../workspaces/workspace'
import { useFileOps } from './FileActions'
import { FileTabs } from './FileTabs'
import { addOpenFile, closeOpenFile, dirUrl, openPath, renameOpenFile } from './openFiles'

// Each open tab remembers whether it was being read or edited.
const modes = new Map<string, 'view' | 'edit'>()

export function FilePage() {
  const [params] = useSearchParams()
  const path = params.get('path') ?? ''
  const isNew = params.get('new') === '1'
  // Keyed by path: switching tabs mounts a fresh editor for that file.
  return (
    <FileEditor
      key={path}
      path={path}
      isNew={isNew}
      edit={isNew || params.get('edit') === '1'}
      line={Number(params.get('line') ?? 0)}
    />
  )
}

/** Any file: Markdown, code, images, PDF, media. Text files edit in place and autosave. */
function FileEditor({ path, isNew, edit, line }: { path: string; isNew: boolean; edit: boolean; line: number }) {
  const navigate = useNavigate()
  const goUp = useGoUp()
  const me = useMe()
  const ws = useWorkspace()
  const workspace = ws.path
  const { toast, toastError } = useDialogs()
  const ops = useFileOps()
  // Everything autosaves two seconds after you stop typing.
  const doc = useFileDoc(path, { autosaveMs: 2000 })
  const [mode, setModeState] = useState<'view' | 'edit'>(() => (edit ? 'edit' : modes.get(path) ?? 'view'))
  // A search hit opens Markdown as source, so the line can be shown.
  const [source, setSource] = useState(!!line)
  const [wrap, setWrap] = useState(() => store.get('nd.view.wrap', true))
  const [gutter, setGutter] = useState(() => store.get('nd.view.lines', true))
  const [view, setView] = useState<EditorView | null>(null)
  const [focused, setFocused] = useState(false)
  const [menu, setMenu] = useState(false)
  const jumped = useRef(false)

  const f = doc.file
  const loaded = !!f
  const md = isMarkdown(path)
  const mime = f?.mime ?? ''
  const isImage = mime.startsWith('image/')
  const isPdf = mime === 'application/pdf'
  const isMedia = mime.startsWith('video/') || mime.startsWith('audio/')
  // The server marks binary and truncated files as not writable.
  const editable = !!f && f.writable && !f.isBinary
  const editing = mode === 'edit' && editable
  const display = !f
    ? null
    : editing
      ? 'code'
      : isImage
        ? 'image'
        : isPdf || isMedia || f.isBinary
          ? 'binary'
          : md && !source
            ? 'markdown'
            : 'code'

  const setMode = (m: 'view' | 'edit') => {
    modes.set(path, m)
    setModeState(m)
  }

  useEffect(() => {
    if (!loaded) return
    touchRecent(path, 'file')
    addOpenFile(workspace, path)
  }, [loaded, path, workspace])

  // Put the cursor at the end of a brand-new file.
  useEffect(() => {
    if (!isNew || !view || !loaded) return
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
  }, [isNew, view, loaded])

  // Jump to a search hit once the contents are in the editor.
  useEffect(() => {
    if (!view || !line || !doc.resetKey || jumped.current) return
    jumped.current = true
    const l = Math.min(line, view.state.doc.lines)
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(l).from), scrollIntoView: true })
  }, [view, line, doc.resetKey])

  /** Save pending edits before leaving this file (tab switch, back, close). */
  const flush = async () => {
    if (doc.dirty && doc.saveState !== 'conflict') {
      try {
        await doc.save()
      } catch (e) {
        toastError(e)
      }
    }
  }

  const dir = dirname(path)
  const rel = workspace ? relative(workspace, dir) : null
  const name = basename(path)
  const title = md ? name.replace(/\.md$/i, '') : name

  return (
    <>
      <TopBar
        back
        onBack={async () => {
          await flush()
          goUp(dirUrl(dir, workspace))
        }}
        title={
          <span className="inline-flex items-center gap-2">
            {title} {editable && <SaveIndicator state={doc.saveState} dirty={doc.dirty} />}
          </span>
        }
        subtitle={rel === null ? tildify(dir, me.data?.home) : rel || basename(workspace!)}
        actions={
          <>
            {f && !f.isBinary && (
              <IconButton
                label="Copy contents"
                onClick={async () => {
                  const ok = await copyText(doc.content)
                  toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'error')
                }}
              >
                <Copy className="h-5 w-5" />
              </IconButton>
            )}
            {editable && (
              <IconButton
                label={editing ? (md ? 'Preview' : 'Done editing') : 'Edit'}
                onClick={() => {
                  if (editing) {
                    view?.contentDOM.blur()
                    flush()
                  }
                  setMode(editing ? 'view' : 'edit')
                }}
              >
                {!editing ? <Pencil className="h-5 w-5" /> : md ? <BookOpen className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </IconButton>
            )}
            <IconButton label="More" onClick={() => setMenu(true)}>
              <MoreVertical className="h-5 w-5" />
            </IconButton>
          </>
        }
      />
      {!focused && <FileTabs active={path} onSwitch={flush} />}
      {doc.query.isLoading && <Loading />}
      {doc.query.error && <ErrorView error={doc.query.error} onRetry={() => doc.query.refetch()} />}
      {f && (
        <>
          {f.truncated && (
            <div className="shrink-0 bg-warn/10 px-4 py-2 text-xs">Large file: showing the first 2 MB only. Editing is disabled.</div>
          )}
          <DraftBanner doc={doc} />
          {display === 'image' ? (
            <Page className="flex items-start justify-center bg-raised p-3">
              <img src={rawUrl(path)} alt={f.name} className="max-w-full rounded-lg" />
            </Page>
          ) : display === 'binary' ? (
            <Page>
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <FileCode2 className="h-10 w-10 text-muted" />
                <div className="font-semibold">{f.name}</div>
                <div className="text-sm text-muted">
                  {mime || 'binary'} · {fileSize(f.size)}
                </div>
                {isMedia &&
                  (mime.startsWith('video/') ? (
                    <video src={rawUrl(path)} controls playsInline className="mt-2 max-w-full rounded-lg" />
                  ) : (
                    <audio src={rawUrl(path)} controls className="mt-2 w-full" />
                  ))}
                <div className="mt-2 flex gap-2">
                  {(isPdf || isMedia) && (
                    <a href={rawUrl(path)} target="_blank" rel="noreferrer">
                      <Button variant="primary" icon={<ExternalLink className="h-4 w-4" />}>
                        Open
                      </Button>
                    </a>
                  )}
                  <a href={rawUrl(path, true)}>
                    <Button icon={<Download className="h-4 w-4" />}>Download</Button>
                  </a>
                </div>
              </div>
            </Page>
          ) : display === 'markdown' ? (
            <Page>
              <div onDoubleClick={() => editable && setMode('edit')}>
                <MarkdownView
                  content={doc.content}
                  filePath={path}
                  onOpenPath={async (p) => {
                    await flush()
                    navigate(openPath(p))
                  }}
                  onWikiLink={async (target) => {
                    try {
                      const r = await api.get<{ path: string }>('/api/notes/resolve', { ws: ws.id ?? undefined, name: target })
                      await flush()
                      navigate(openPath(r.path))
                    } catch {
                      toast(`No note named "${target}" yet`, 'error')
                    }
                  }}
                />
                {!doc.content.trim() && editable && (
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
                  readOnly={!editing}
                  wrap={wrap}
                  showLineNumbers={md && editing ? false : gutter}
                  onView={setView}
                />
              </div>
              {editing && focused && <EditorToolbar view={view} mode={md ? 'markdown' : 'code'} onDone={() => setFocused(false)} />}
            </>
          )}
        </>
      )}
      <ConflictSheet doc={doc} />
      <Sheet open={menu} onClose={() => setMenu(false)} title={name}>
        {md && !editing && (
          <SheetItem
            icon={source ? <BookOpen className="h-5 w-5" /> : <FileCode2 className="h-5 w-5" />}
            onClick={() => {
              setSource(!source)
              setMenu(false)
            }}
          >
            {source ? 'Show rendered' : 'Show source'}
          </SheetItem>
        )}
        {display === 'code' && (
          <>
            <SheetItem
              icon={<WrapText className="h-5 w-5" />}
              onClick={() => {
                setWrap(!wrap)
                store.set('nd.view.wrap', !wrap)
                setMenu(false)
              }}
            >
              {wrap ? 'Turn off line wrap' : 'Wrap long lines'}
            </SheetItem>
            {!(md && editing) && (
              <SheetItem
                icon={<ListOrdered className="h-5 w-5" />}
                onClick={() => {
                  setGutter(!gutter)
                  store.set('nd.view.lines', !gutter)
                  setMenu(false)
                }}
              >
                {gutter ? 'Hide line numbers' : 'Show line numbers'}
              </SheetItem>
            )}
          </>
        )}
        <SheetItem
          icon={<TextCursorInput className="h-5 w-5" />}
          onClick={async () => {
            setMenu(false)
            await flush()
            const p = await ops.rename(path)
            if (p) {
              renameOpenFile(workspace, path, p)
              navigate(openPath(p), { replace: true })
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
            navigate(dirUrl(dir, workspace))
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
        <a href={rawUrl(path)} target="_blank" rel="noreferrer" onClick={() => setMenu(false)}>
          <SheetItem icon={<ExternalLink className="h-5 w-5" />}>Open raw</SheetItem>
        </a>
        <a href={rawUrl(path, true)} onClick={() => setMenu(false)}>
          <SheetItem icon={<Download className="h-5 w-5" />}>Download</SheetItem>
        </a>
        <SheetItem
          danger
          icon={<Trash2 className="h-5 w-5" />}
          onClick={async () => {
            setMenu(false)
            if (await ops.remove(path, false)) {
              const next = closeOpenFile(workspace, path)
              navigate(next ? openPath(next) : dirUrl(dir, workspace), { replace: true })
            }
          }}
        >
          Delete
        </SheetItem>
        {f && (
          <div className="px-4 pb-4 pt-2 text-xs text-muted">
            {fileSize(f.size)} · modified {fullTime(f.mtime)}
          </div>
        )}
      </Sheet>
    </>
  )
}
