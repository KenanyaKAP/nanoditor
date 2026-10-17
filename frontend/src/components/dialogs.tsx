import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { Button } from './ui'
import { Sheet } from './Sheet'
import { cx } from '../lib/util'
import { errorMessage } from '../api/client'

type ToastKind = 'ok' | 'error' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface ConfirmOpts {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
}

interface PromptOpts {
  title: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  /** Select only the file-name stem (before the extension) initially. */
  selectStem?: boolean
}

interface DialogApi {
  toast: (text: string, kind?: ToastKind) => void
  toastError: (e: unknown) => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
  prompt: (o: PromptOpts) => Promise<string | null>
}

const Ctx = createContext<DialogApi | null>(null)

export function useDialogs(): DialogApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('DialogProvider missing')
  return c
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const [promptState, setPrompt] = useState<(PromptOpts & { resolve: (v: string | null) => void }) | null>(null)
  const nextId = useRef(1)

  const toast = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-2), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2500)
  }, [])

  const api: DialogApi = {
    toast,
    toastError: useCallback((e: unknown) => toast(errorMessage(e), 'error'), [toast]),
    confirm: useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []),
    prompt: useCallback((o: PromptOpts) => new Promise<string | null>((resolve) => setPrompt({ ...o, resolve })), []),
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-safe">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                'pointer-events-auto mt-2 flex max-w-md items-start gap-2 rounded-2xl px-4 py-3 text-sm shadow-lg',
                t.kind === 'error' ? 'bg-del text-white' : 'bg-fg text-bg',
              )}
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              {t.kind === 'ok' && <CheckCircle2 className="mt-px h-4 w-4 shrink-0" />}
              {t.kind === 'error' && <XCircle className="mt-px h-4 w-4 shrink-0" />}
              {t.kind === 'info' && <Info className="mt-px h-4 w-4 shrink-0" />}
              <span className="break-words">{t.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
      {confirmState && (
        <Sheet
          open
          title={confirmState.title}
          onClose={() => {
            confirmState.resolve(false)
            setConfirm(null)
          }}
        >
          <div className="p-4">
            {confirmState.message && <div className="mb-4 text-[15px] text-muted">{confirmState.message}</div>}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => {
                  confirmState.resolve(false)
                  setConfirm(null)
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant={confirmState.danger ? 'danger' : 'primary'}
                onClick={() => {
                  confirmState.resolve(true)
                  setConfirm(null)
                }}
              >
                {confirmState.confirmLabel ?? 'OK'}
              </Button>
            </div>
          </div>
        </Sheet>
      )}
      {promptState && (
        <PromptSheet
          opts={promptState}
          onDone={(v) => {
            promptState.resolve(v)
            setPrompt(null)
          }}
        />
      )}
    </Ctx.Provider>
  )
}

function PromptSheet({ opts, onDone }: { opts: PromptOpts; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const v = opts.initial ?? ''
    const dot = v.lastIndexOf('.')
    if (opts.selectStem && dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [opts])
  return (
    <Sheet open title={opts.title} onClose={() => onDone(null)}>
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onDone(value.trim())
        }}
      >
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={opts.placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mb-4 h-12 w-full rounded-xl border border-line bg-bg px-3 outline-none focus:border-accent"
        />
        <div className="flex gap-2">
          <Button type="button" className="flex-1" onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-1" disabled={!value.trim()}>
            {opts.confirmLabel ?? 'OK'}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
