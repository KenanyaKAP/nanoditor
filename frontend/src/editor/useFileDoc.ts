import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { keys } from '../api/queries'
import type { FileContent, WriteResult } from '../api/types'
import { store } from '../lib/util'

interface Draft {
  content: string
  baseEtag: string
  savedAt: number
}

const draftKey = (path: string) => `nd.draft:${path}`

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'

/**
 * Loads a text file for editing and handles saving with etag conflict
 * detection plus a localStorage draft so edits survive Safari reloads.
 */
export function useFileDoc(path: string, opts: { autosaveMs?: number } = {}) {
  const qc = useQueryClient()
  // A separate, uncached key: the editor must always start from what is on
  // disk now, never from a cached copy shared with the viewer.
  const editKey = ['fs', 'edit', path] as const
  const query = useQuery({
    queryKey: editKey,
    queryFn: () => api.get<FileContent>('/api/fs/read', { path }),
    enabled: !!path,
    gcTime: 0,
    // Don't refetch under the user's feet while editing.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })

  const [content, setContent] = useState<string>('')
  const [etag, setEtag] = useState<string>('')
  const [resetKey, setResetKey] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [conflictEtag, setConflictEtag] = useState<string | null>(null)
  const loadedFor = useRef<string | null>(null)
  const contentRef = useRef(content)
  contentRef.current = content
  const etagRef = useRef(etag)
  etagRef.current = etag

  // Initialise from the server copy once per path.
  useEffect(() => {
    const d = query.data
    if (!d || loadedFor.current === path) return
    loadedFor.current = path
    setContent(d.content)
    setEtag(d.etag)
    setResetKey((k) => k + 1)
    const saved = store.get<Draft | null>(draftKey(path), null)
    if (saved && saved.content !== d.content) setDraft(saved)
    else store.remove(draftKey(path))
  }, [query.data, path])

  const dirty = query.data ? content !== (qc.getQueryData<FileContent>(editKey)?.content ?? '') : false

  const update = useCallback(
    (v: string) => {
      setContent(v)
      setSaveState((s) => (s === 'saved' ? 'idle' : s))
      store.set(draftKey(path), { content: v, baseEtag: etagRef.current, savedAt: Date.now() / 1000 } satisfies Draft)
    },
    [path],
  )

  const save = useCallback(
    async (force = false): Promise<boolean> => {
      const text = contentRef.current
      setSaveState('saving')
      try {
        const res = await api.put<WriteResult>('/api/fs/write', { path, content: text, etag: etagRef.current, force })
        setEtag(res.etag)
        qc.setQueryData<FileContent>(['fs', 'edit', path], (old) =>
          old ? { ...old, content: text, etag: res.etag, size: res.size, mtime: res.mtime } : old,
        )
        qc.invalidateQueries({ queryKey: keys.file(path) })
        qc.invalidateQueries({ queryKey: ['fs', 'list'] })
        if (contentRef.current === text) store.remove(draftKey(path))
        setConflictEtag(null)
        setSaveState('saved')
        qc.invalidateQueries({ queryKey: ['git'] })
        qc.invalidateQueries({ queryKey: ['notes'] })
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setConflictEtag(String(e.extra?.etag ?? ''))
          setSaveState('conflict')
          return false
        }
        setSaveState('error')
        throw e
      }
    },
    [path, qc],
  )

  /** Throw away local edits and load what's on disk now. */
  const reload = useCallback(async () => {
    store.remove(draftKey(path))
    const fresh = await api.get<FileContent>('/api/fs/read', { path })
    qc.setQueryData(['fs', 'edit', path], fresh)
    setContent(fresh.content)
    setEtag(fresh.etag)
    setResetKey((k) => k + 1)
    setConflictEtag(null)
    setDraft(null)
    setSaveState('idle')
  }, [path, qc])

  /** Close the conflict prompt and keep editing; the next save asks again. */
  const dismissConflict = useCallback(() => setSaveState('error'), [])

  const restoreDraft = useCallback(() => {
    if (!draft) return
    setContent(draft.content)
    setResetKey((k) => k + 1)
    setDraft(null)
  }, [draft])

  const discardDraft = useCallback(() => {
    store.remove(draftKey(path))
    setDraft(null)
  }, [path])

  // Optional debounced autosave (notes).
  useEffect(() => {
    if (!opts.autosaveMs || !dirty || saveState === 'conflict' || saveState === 'saving' || draft) return
    const t = setTimeout(() => {
      save().catch(() => {})
    }, opts.autosaveMs)
    return () => clearTimeout(t)
  }, [content, dirty, opts.autosaveMs, save, saveState, draft])

  return {
    query,
    file: query.data,
    content,
    setContent: update,
    resetKey,
    dirty,
    save,
    saveState,
    conflictEtag,
    dismissConflict,
    reload,
    draft,
    restoreDraft,
    discardDraft,
  }
}
