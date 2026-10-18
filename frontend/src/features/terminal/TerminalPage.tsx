import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Copy, Keyboard, Plus, SquareTerminal, TextSelect, X } from 'lucide-react'
import { api } from '../../api/client'
import { useMe } from '../../api/queries'
import type { TermSession, TermStatus } from '../../api/types'
import { TopBar } from '../../components/TopBar'
import { Page } from '../../components/Shell'
import { Button, Card, EmptyState, ErrorView, IconButton, Loading } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { keyClass, pressProps, RepeatButton } from '../../components/press'
import { basename, tildify } from '../../lib/path'
import { copyText, cx, store } from '../../lib/util'
import { useWorkspace } from '../workspaces/workspace'
import { type TermHandle, type TermSnapshot, TerminalView } from './TerminalView'
import { TermSelect } from './TermSelect'

const statusKey = ['term'] as const

export function TerminalPage() {
  const me = useMe()
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => api.get<TermStatus>('/api/term'),
    enabled: !!me.data?.terminal,
  })
  if (me.isLoading) return <Loading />
  if (!me.data?.terminal) {
    return (
      <>
        <TopBar title="Terminal" />
        <EmptyState
          icon={<SquareTerminal className="h-10 w-10" />}
          title="The terminal is off"
          body="Set TERMINAL=on in .env on the server and restart it (make up). It gives full shell access, so it is off by default."
        />
      </>
    )
  }
  if (status.isLoading) return <Loading />
  if (status.error || !status.data) return <ErrorView error={status.error} onRetry={() => status.refetch()} />
  if (!status.data.authorized) return <Setup status={status.data} home={me.data.home} />
  return <Terminals status={status.data} home={me.data.home} />
}

/** First run: show the line the user adds to authorized_keys themselves. */
function Setup({ status, home }: { status: TermStatus; home: string }) {
  const qc = useQueryClient()
  const { toast, toastError } = useDialogs()
  const command = `echo '${status.authorizedKey}' >> ~/.ssh/authorized_keys`
  const check = useMutation({
    mutationFn: async () => {
      const st = await qc.fetchQuery({ queryKey: statusKey, queryFn: () => api.get<TermStatus>('/api/term') })
      if (!st.authorized) throw new Error(`The key isn't in ${tildify(home + '/.ssh/authorized_keys', home)} yet`)
      await api.post('/api/term/check', {})
    },
    onSuccess: () => {
      toast('Terminal ready')
      qc.invalidateQueries({ queryKey: statusKey })
    },
    onError: toastError,
  })
  const copy = async (text: string) => toast((await copyText(text)) ? 'Copied' : 'Copy failed', 'info')
  return (
    <>
      <TopBar title="Terminal" subtitle="Setup" />
      <Page>
        <Card className="mt-3 p-4 text-[15px]">
          <p>
            The terminal opens your own shell on this machine, with your usual environment, by connecting over SSH to{' '}
            <span className="font-mono text-sm">{status.addr}</span> as <span className="font-medium">{status.user}</span>.
          </p>
          <p className="mt-3">Allow it once by running this on the machine (it adds Nanoditor's key to your authorized keys):</p>
          <div className="mt-2 flex items-start gap-2 rounded-xl bg-raised p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{command}</code>
            <IconButton label="Copy command" onClick={() => copy(command)}>
              <Copy className="h-4 w-4" />
            </IconButton>
          </div>
          <p className="mt-3 text-sm text-muted">
            The key only works from this machine itself and only for a shell (no forwarding). To revoke it later, delete the
            line ending in <span className="font-mono">nanoditor-terminal</span>.
          </p>
          <Button variant="primary" className="mt-4 w-full" loading={check.isPending} onClick={() => check.mutate()}>
            I've added it, check
          </Button>
        </Card>
      </Page>
    </>
  )
}

function Terminals({ status, home }: { status: TermStatus; home: string }) {
  const qc = useQueryClient()
  const ws = useWorkspace()
  const { confirm, toast, toastError } = useDialogs()
  const sessions = status.sessions
  const [activeId, setActiveId] = useState(() => store.get<string | null>('nd.term.active', null))
  const active = sessions.find((s) => s.id === activeId) ?? sessions[sessions.length - 1] ?? null
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [focused, setFocused] = useState(false)
  const [ctrl, setCtrl] = useState(false)
  const ctrlRef = useRef(false)
  ctrlRef.current = ctrl
  const view = useRef<TermHandle>(null)
  // Selecting text: a still copy of the terminal's text, over the live terminal.
  // The tab row stays as it was, so the text doesn't shift under the finger.
  const [selecting, setSelecting] = useState<{ snap: TermSnapshot; at?: { x: number; y: number }; hideTabs: boolean } | null>(
    null,
  )

  // A copy of one terminal's text doesn't belong over another.
  useEffect(() => setSelecting(null), [active?.id])

  const select = (id: string) => {
    setActiveId(id)
    store.set('nd.term.active', id)
  }

  const startSelecting = (at?: { x: number; y: number }) => {
    const v = view.current
    if (!v) return
    setSelecting({ snap: v.snapshot(), at, hideTabs: focused })
    v.blur()
  }

  const copy = async (text: string) => {
    if (!text) return toast('Long-press the text to select it', 'info')
    const ok = await copyText(text)
    toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'error')
    if (ok) setSelecting(null)
  }
  const refresh = () => qc.invalidateQueries({ queryKey: statusKey })

  const create = useMutation({
    mutationFn: () => api.post<TermSession>('/api/term', { cwd: ws.path ?? '', cols: 80, rows: 24 }),
    onSuccess: (s) => {
      qc.setQueryData<TermStatus>(statusKey, (old) => (old ? { ...old, sessions: [...old.sessions, s] } : old))
      select(s.id)
    },
    onError: toastError,
  })

  const close = async (s: TermSession) => {
    const ok = await confirm({
      title: 'Close this terminal?',
      message: 'The shell and anything still running in it will be stopped.',
      confirmLabel: 'Close',
      danger: true,
    })
    if (!ok) return
    await api.del(`/api/term/${s.id}`).catch(toastError)
    qc.setQueryData<TermStatus>(statusKey, (old) => (old ? { ...old, sessions: old.sessions.filter((x) => x.id !== s.id) } : old))
    refresh()
  }

  const label = (s: TermSession, i: number) => titles[s.id] || `Terminal ${i + 1}`

  return (
    <>
      <TopBar
        title="Terminal"
        subtitle={active ? `${status.user} · ${active.cwd ? tildify(active.cwd, home) : '~'}` : status.user}
        actions={
          <>
            {active && (
              <IconButton
                label="Select text"
                active={!!selecting}
                {...pressProps(() => (selecting ? setSelecting(null) : startSelecting()))}
              >
                <TextSelect className="h-5 w-5" />
              </IconButton>
            )}
            <IconButton label="New terminal" onClick={() => create.mutate()} disabled={create.isPending}>
              <Plus className="h-6 w-6" />
            </IconButton>
          </>
        }
      />
      {sessions.length === 0 ? (
        <EmptyState
          icon={<SquareTerminal className="h-10 w-10" />}
          title="No terminals"
          body={`Opens your shell in ${ws.path ? basename(ws.path) : 'your home folder'}. It keeps running when you leave the app.`}
          action={
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              New terminal
            </Button>
          }
        />
      ) : (
        <>
          {!focused && !selecting?.hideTabs && (
            <div className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-bg px-2 py-1.5">
              {sessions.map((s, i) => {
                const isActive = s.id === active?.id
                return (
                  <div
                    key={s.id}
                    className={cx(
                      'flex h-8 max-w-[12rem] shrink-0 items-center rounded-lg text-sm',
                      isActive ? 'bg-surface font-medium text-fg shadow-sm' : 'text-muted',
                    )}
                  >
                    <button className="min-w-0 truncate pl-2.5 pr-1" onClick={() => select(s.id)}>
                      {label(s, i)}
                    </button>
                    <button aria-label={`Close ${label(s, i)}`} className="flex h-8 w-7 shrink-0 items-center justify-center" onClick={() => close(s)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
              <button
                aria-label="New terminal"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted active:bg-raised"
                onClick={() => create.mutate()}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
          {active && (
            <>
              <div className="relative min-h-0 flex-1 bg-bg pl-1 pt-1">
                <TerminalView
                  key={active.id}
                  ref={view}
                  id={active.id}
                  ctrl={ctrlRef}
                  onCtrlUsed={() => setCtrl(false)}
                  onTitle={(t) => setTitles((old) => ({ ...old, [active.id]: t }))}
                  onFocusChange={setFocused}
                  onGone={refresh}
                  onLongPress={(x, y) => startSelecting({ x, y })}
                />
                {selecting && <TermSelect snap={selecting.snap} at={selecting.at} />}
              </div>
              {selecting ? (
                <SelectBar
                  onDone={() => setSelecting(null)}
                  onCopy={() => copy(window.getSelection()?.toString() ?? '')}
                  onCopyAll={() => copy(selecting.snap.lines.map((l) => l.text).join('\n').trim())}
                />
              ) : (
                <TermKeys view={view} ctrl={ctrl} setCtrl={setCtrl} keyboardOpen={focused} />
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

/** Keys the phone keyboard lacks, in a row above it. Ctrl is sticky: it applies to the next key typed. */
function TermKeys({
  view,
  ctrl,
  setCtrl,
  keyboardOpen,
}: {
  view: React.RefObject<TermHandle>
  ctrl: boolean
  setCtrl: (on: boolean) => void
  keyboardOpen: boolean
}) {
  const send = (d: string) => view.current?.send(d)
  const text = (label: string, seq: string, aria = label) => (
    <button key={label} aria-label={aria} className={cx(keyClass, 'text-xs font-semibold')} {...pressProps(() => send(seq))}>
      {label}
    </button>
  )
  const arrows = [
    { k: 'D', label: 'Left', Icon: ArrowLeft },
    { k: 'A', label: 'Up', Icon: ArrowUp },
    { k: 'B', label: 'Down', Icon: ArrowDown },
    { k: 'C', label: 'Right', Icon: ArrowRight },
  ] as const
  return (
    <div className="flex shrink-0 items-center border-t border-line bg-raised px-safe">
      <div className="no-scrollbar flex min-w-0 flex-1 touch-pan-x overflow-x-auto">
        {text('esc', '\x1b')}
        {text('tab', '\t')}
        {text('⇧tab', '\x1b[Z', 'Shift+Tab')}
        <button
          aria-label="Ctrl"
          aria-pressed={ctrl}
          className={cx(keyClass, 'text-xs font-semibold', ctrl && 'bg-accent text-accent-fg active:bg-accent')}
          {...pressProps(() => {
            setCtrl(!ctrl)
            view.current?.focus()
          })}
        >
          ctrl
        </button>
        {arrows.map((a) => (
          <RepeatButton key={a.k} label={a.label} onFire={() => view.current?.arrow(a.k)}>
            <a.Icon className="h-[18px] w-[18px]" />
          </RepeatButton>
        ))}
        {['|', '~', '/', '-'].map((c) => (
          <button key={c} aria-label={c} className={keyClass} {...pressProps(() => send(c))}>
            <span className="font-mono text-[15px]">{c}</span>
          </button>
        ))}
      </div>
      <button
        aria-label={keyboardOpen ? 'Hide keyboard' : 'Show keyboard'}
        className="flex h-11 w-11 shrink-0 select-none items-center justify-center border-l border-line text-muted active:bg-line"
        {...pressProps(() => (keyboardOpen ? view.current?.blur() : view.current?.focus()))}
      >
        {keyboardOpen ? <ChevronDown className="h-5 w-5" /> : <Keyboard className="h-5 w-5" />}
      </button>
    </div>
  )
}

/** In place of the key row while selecting text. */
function SelectBar({ onDone, onCopy, onCopyAll }: { onDone: () => void; onCopy: () => void; onCopyAll: () => void }) {
  // pressProps keeps the selection: a plain tap on a button would clear it first.
  return (
    <div className="flex shrink-0 items-center border-t border-line bg-raised px-safe">
      <button className={cx(keyClass, 'px-4 text-sm font-medium')} {...pressProps(onDone)}>
        Done
      </button>
      <span className="min-w-0 flex-1 truncate text-center text-xs text-muted">Long-press to select</span>
      <button className={cx(keyClass, 'px-3 text-sm')} {...pressProps(onCopyAll)}>
        Copy all
      </button>
      <button className={cx(keyClass, 'gap-1.5 px-4 text-sm font-semibold text-accent')} {...pressProps(onCopy)}>
        <Copy className="h-4 w-4" />
        Copy
      </button>
    </div>
  )
}
