import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronUp, History, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { Commit, CommitResponse, LogCommit } from '../../api/types'
import { Sheet, SheetItem } from '../../components/Sheet'
import { useDialogs } from '../../components/dialogs'
import { cx, store } from '../../lib/util'

/** Sticky commit box at the bottom of the repo screen. */
export function CommitComposer({
  repo,
  stagedCount,
  hasUpstreamOrRemote,
  onOutput,
}: {
  repo: string
  stagedCount: number
  hasUpstreamOrRemote: boolean
  onOutput: (title: string, text: string) => void
}) {
  const draftKey = `nd.commitmsg:${repo}`
  const [msg, setMsg] = useState(() => store.get(draftKey, ''))
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState<false | 'commit' | 'push'>(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const qc = useQueryClient()
  const { toast, toastError } = useDialogs()

  const messages = useQuery({
    queryKey: keys.messages(repo),
    queryFn: () => api.get<string[]>('/api/git/messages', { repo }),
    enabled: historyOpen,
  })

  useEffect(() => {
    store.set(draftKey, msg)
  }, [draftKey, msg])

  // Amending with an empty box pre-fills the previous message.
  useEffect(() => {
    if (!amend || msg.trim()) return
    api
      .get<LogCommit[]>('/api/git/log', { repo, limit: 1 })
      .then((c) => c[0] && api.get<Commit>('/api/git/show', { repo, rev: c[0].hash }))
      .then((c) => c && setMsg(c.body ? `${c.subject}\n\n${c.body}` : c.subject))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amend])

  if (stagedCount === 0 && !amend) {
    return (
      <div className="shrink-0 border-t border-line bg-surface px-4 py-2.5 text-center text-sm text-muted">
        Stage files to commit
        <button className="ml-2 text-accent" onClick={() => setAmend(true)}>
          or amend last commit
        </button>
      </div>
    )
  }

  const subject = msg.split('\n')[0]
  const canCommit = (msg.trim() || amend) && !busy

  const commit = async (push: boolean) => {
    setBusy(push ? 'push' : 'commit')
    try {
      const r = await api.post<CommitResponse>('/api/git/commit', { repo, message: msg, amend, push })
      setMsg('')
      store.remove(draftKey)
      setAmend(false)
      setExpanded(false)
      ta.current?.blur()
      if (r.pushError) {
        onOutput('Committed, but push failed', `${r.pushError.message}\n\n${r.pushError.detail ?? ''}`)
      } else {
        toast(push ? `Committed ${r.commit.hash} and pushed` : `Committed ${r.commit.hash}`)
      }
    } catch (e) {
      const detail = (e as any)?.detail
      if (detail) onOutput('Commit failed', detail)
      else toastError(e)
    } finally {
      setBusy(false)
      qc.invalidateQueries({ queryKey: ['git'] })
    }
  }

  return (
    <div className="shrink-0 border-t border-line bg-surface px-3 pb-2 pt-2">
      <div className="flex items-start gap-2">
        <textarea
          ref={ta}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onFocus={() => setExpanded(true)}
          rows={expanded ? 4 : 1}
          placeholder={amend ? 'Amend message (empty keeps it)' : `Commit message (${stagedCount} staged)`}
          className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2 leading-snug outline-none focus:border-accent"
        />
        <button
          aria-label="Recent messages"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted active:bg-raised"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="h-5 w-5" />
        </button>
      </div>
      {expanded && (
        <div className="mt-1 flex items-center justify-between px-1 text-xs text-muted">
          <span className={cx(subject.length > 72 ? 'text-del' : subject.length > 50 ? 'text-warn' : '')}>
            Subject {subject.length}/50
          </span>
          <button className="inline-flex items-center gap-1" onClick={() => setExpanded(false)}>
            <ChevronUp className="h-3 w-3 rotate-180" /> collapse
          </button>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <label className="flex shrink-0 items-center gap-1.5 px-1 text-sm">
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
          Amend
        </label>
        <div className="flex-1" />
        {hasUpstreamOrRemote && (
          <button
            disabled={!canCommit}
            onClick={() => commit(true)}
            className="h-10 rounded-xl bg-raised px-3 text-sm font-medium active:bg-line disabled:opacity-50"
          >
            {busy === 'push' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Commit & Push'}
          </button>
        )}
        <button
          disabled={!canCommit}
          onClick={() => commit(false)}
          className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg active:opacity-80 disabled:opacity-50"
        >
          {busy === 'commit' ? <Loader2 className="h-4 w-4 animate-spin" /> : amend ? 'Amend' : 'Commit'}
        </button>
      </div>
      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Recent messages">
        {messages.data?.length === 0 && <div className="py-8 text-center text-sm text-muted">No messages yet</div>}
        {messages.data?.map((m) => (
          <SheetItem
            key={m}
            onClick={() => {
              setMsg(m)
              setHistoryOpen(false)
            }}
          >
            <span className="whitespace-normal">{m.split('\n')[0]}</span>
          </SheetItem>
        ))}
        <div className="h-3" />
      </Sheet>
    </div>
  )
}
