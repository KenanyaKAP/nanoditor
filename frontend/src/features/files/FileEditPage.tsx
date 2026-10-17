import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { EditorView } from '@codemirror/view'
import { TopBar } from '../../components/TopBar'
import { Button, ErrorView, Loading } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { useMe } from '../../api/queries'
import { CodeEditor } from '../../editor/CodeEditor'
import { EditorToolbar } from '../../editor/EditorToolbar'
import { ConflictSheet, DraftBanner, SaveIndicator } from '../../editor/EditorChrome'
import { useFileDoc } from '../../editor/useFileDoc'
import { basename, dirname, isMarkdown, tildify } from '../../lib/path'
import { store } from '../../lib/util'

export function FileEditPage() {
  const [params] = useSearchParams()
  const path = params.get('path') ?? ''
  const navigate = useNavigate()
  const me = useMe()
  const { confirm, toast, toastError } = useDialogs()
  const doc = useFileDoc(path)
  const [view, setView] = useState<EditorView | null>(null)
  const [focused, setFocused] = useState(false)
  const wrap = store.get('kc.view.wrap', true)

  const leave = async () => {
    if (doc.dirty) {
      const ok = await confirm({
        title: 'Leave without saving?',
        message: 'Your changes stay as a draft on this device and can be restored next time.',
        confirmLabel: 'Leave',
      })
      if (!ok) return
    }
    navigate(-1)
  }

  const file = doc.file
  const blocked = file && (!file.writable || file.isBinary)

  return (
    <>
      <TopBar
        back
        onBack={leave}
        title={
          <span className="inline-flex items-center gap-2">
            {basename(path)} <SaveIndicator state={doc.saveState} dirty={doc.dirty} />
          </span>
        }
        subtitle={tildify(dirname(path), me.data?.home)}
        actions={
          <Button
            size="sm"
            variant="primary"
            className="mr-2"
            disabled={!doc.dirty || !!blocked}
            loading={doc.saveState === 'saving'}
            onClick={() =>
              doc
                .save()
                .then((ok) => ok && toast('Saved'))
                .catch(toastError)
            }
          >
            Save
          </Button>
        }
      />
      {doc.query.isLoading && <Loading />}
      {doc.query.error && <ErrorView error={doc.query.error} onRetry={() => doc.query.refetch()} />}
      {blocked && <ErrorView error={new Error(file!.isBinary ? 'Binary files cannot be edited' : 'This file is read-only')} />}
      {file && !blocked && (
        <>
          <DraftBanner doc={doc} />
          <div
            className="min-h-0 flex-1"
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={() => setFocused(false)}
          >
            <CodeEditor
              value={doc.content}
              filename={path}
              onChange={doc.setContent}
              resetKey={doc.resetKey}
              wrap={wrap}
              onView={setView}
            />
          </div>
          {focused && <EditorToolbar view={view} mode={isMarkdown(path) ? 'markdown' : 'code'} onDone={() => setFocused(false)} />}
        </>
      )}
      <ConflictSheet doc={doc} />
    </>
  )
}
