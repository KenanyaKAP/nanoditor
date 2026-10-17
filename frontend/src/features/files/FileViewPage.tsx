import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Copy, Download, ExternalLink, FileCode2, ListOrdered, MoreVertical, Pencil, WrapText, BookOpen } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { api, rawUrl } from '../../api/client'
import { keys, touchRecent, useMe } from '../../api/queries'
import type { FileContent } from '../../api/types'
import { TopBar } from '../../components/TopBar'
import { Button, ErrorView, IconButton, Loading } from '../../components/ui'
import { Sheet, SheetItem } from '../../components/Sheet'
import { MarkdownView } from '../../components/MarkdownView'
import { useDialogs } from '../../components/dialogs'
import { CodeEditor } from '../../editor/CodeEditor'
import { dirname, isMarkdown, tildify } from '../../lib/path'
import { copyText, fileSize, fullTime, store } from '../../lib/util'
import { Page } from '../../components/Shell'
import { useFileOps } from './FileActions'

export function FileViewPage() {
  const [params] = useSearchParams()
  const path = params.get('path') ?? ''
  const line = Number(params.get('line') ?? 0)
  const navigate = useNavigate()
  const me = useMe()
  const { toast } = useDialogs()
  const ops = useFileOps()
  const [menu, setMenu] = useState(false)
  const [wrap, setWrap] = useState(() => store.get('kc.view.wrap', true))
  const [gutter, setGutter] = useState(() => store.get('kc.view.lines', true))
  const [source, setSource] = useState(false)
  const [view, setView] = useState<EditorView | null>(null)

  const q = useQuery({
    queryKey: keys.file(path),
    queryFn: () => api.get<FileContent>('/api/fs/read', { path }),
    enabled: !!path,
  })
  const f = q.data

  useEffect(() => {
    if (f) touchRecent(path, 'file')
  }, [f, path])

  // Jump to a search hit.
  useEffect(() => {
    if (!view || !line || !f) return
    const l = Math.min(line, view.state.doc.lines)
    const pos = view.state.doc.line(l).from
    view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true })
  }, [view, line, f])

  const md = isMarkdown(path)
  const mime = f?.mime ?? ''
  const isImage = mime.startsWith('image/')
  const isPdf = mime === 'application/pdf'
  const isMedia = mime.startsWith('video/') || mime.startsWith('audio/')
  const showMarkdown = md && !source && !line

  return (
    <>
      <TopBar
        back
        title={f?.name ?? path.split('/').pop()}
        subtitle={tildify(dirname(path), me.data?.home)}
        actions={
          <>
            {f && !f.isBinary && (
              <IconButton
                label="Copy contents"
                onClick={async () => {
                  const ok = await copyText(f.content)
                  toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'error')
                }}
              >
                <Copy className="h-5 w-5" />
              </IconButton>
            )}
            {f?.writable && (
              <IconButton label="Edit" onClick={() => navigate('/files/edit?path=' + encodeURIComponent(path), { replace: false })}>
                <Pencil className="h-5 w-5" />
              </IconButton>
            )}
            <IconButton label="More" onClick={() => setMenu(true)}>
              <MoreVertical className="h-5 w-5" />
            </IconButton>
          </>
        }
      />
      {q.isLoading && <Loading />}
      {q.error && <ErrorView error={q.error} onRetry={() => q.refetch()} />}
      {f && (
        <>
          {f.truncated && (
            <div className="shrink-0 bg-warn/10 px-4 py-2 text-xs">
              Large file: showing the first 2 MB only. Editing is disabled.
            </div>
          )}
          {isImage ? (
            <Page className="flex items-start justify-center bg-raised p-3">
              <img src={rawUrl(path)} alt={f.name} className="max-w-full rounded-lg" />
            </Page>
          ) : isPdf || isMedia || f.isBinary ? (
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
          ) : showMarkdown ? (
            <Page>
              <MarkdownView
                content={f.content}
                filePath={path}
                onOpenPath={(p) => navigate('/files/view?path=' + encodeURIComponent(p))}
                onWikiLink={async (name) => {
                  try {
                    const r = await api.get<{ path: string }>('/api/notes/resolve', { name })
                    navigate('/files/view?path=' + encodeURIComponent(r.path))
                  } catch {
                    toast(`No note named "${name}"`, 'error')
                  }
                }}
              />
            </Page>
          ) : (
            <div className="min-h-0 flex-1">
              <CodeEditor value={f.content} filename={path} readOnly wrap={wrap} showLineNumbers={gutter} onView={setView} resetKey={f.etag} />
            </div>
          )}
        </>
      )}
      <Sheet open={menu} onClose={() => setMenu(false)} title={f?.name}>
        {md && (
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
        <SheetItem
          icon={<WrapText className="h-5 w-5" />}
          onClick={() => {
            setWrap(!wrap)
            store.set('kc.view.wrap', !wrap)
            setMenu(false)
          }}
        >
          {wrap ? 'Turn off line wrap' : 'Wrap long lines'}
        </SheetItem>
        <SheetItem
          icon={<ListOrdered className="h-5 w-5" />}
          onClick={() => {
            setGutter(!gutter)
            store.set('kc.view.lines', !gutter)
            setMenu(false)
          }}
        >
          {gutter ? 'Hide line numbers' : 'Show line numbers'}
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
        {f && (
          <div className="px-4 pb-4 pt-2 text-xs text-muted">
            {fileSize(f.size)} · modified {fullTime(f.mtime)}
          </div>
        )}
      </Sheet>
    </>
  )
}
