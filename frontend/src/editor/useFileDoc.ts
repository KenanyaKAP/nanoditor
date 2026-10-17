import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { keys } from '../api/queries'
import type { FileContent, WriteResult } from '../api/types'
import { type Draft, readDraft, removeDraft, writeDraft } from './drafts'

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'

/**
 * Loads a text file for editing and handles saving with etag conflict
 * detection. Unsaved edits are kept as a draft on the device, so they survive
 * tab switches and Safari reloads; autosave is optional.
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
    const saved = readDraft(path)
    if (saved && saved.content !== d.content) {
      // Edits to this same version come back as they were; if the file
      // changed on disk since, ask first.
      if (saved.baseEtag === d.etag) setContent(saved.content)
      else setDraft(saved)
    } else removeDraft(path)
  }, [query.data, path])

  const dirty = query.data ? content !== (qc.getQueryData<FileContent>(editKey)?.content ?? '') : false

  const update = useCallback(
    (v: string) => {
      setContent(v)
      setSaveState((s) => (s === 'saved' ? 'idle' : s))
      // Typing back to what is on disk leaves nothing unsaved.
      if (v === qc.getQueryData<FileContent>(['fs', 'edit', path])?.content) removeDraft(path)
      else writeDraft(path, { content: v, baseEtag: etagRef.current, savedAt: Date.now() / 1000 })
    },
    [path, qc],
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
        if (contentRef.current === text) removeDraft(path)
        setConflictEtag(null)
        setSaveState('saved')
        qc.invalidateQueries({ queryKey: ['git'] })
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
    removeDraft(path)
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
    // Save against the version the edits started from, so the change on
    // disk shows up as a conflict instead of being overwritten.
    setEtag(draft.baseEtag)
    setContent(draft.content)
    setResetKey((k) => k + 1)
    setDraft(null)
  }, [draft])

  const discardDraft = useCallback(() => {
    removeDraft(path)
    setDraft(null)
  }, [path])

  // Optional debounced autosave.
  const autosavePending = !!opts.autosaveMs && dirty && saveState !== 'conflict' && saveState !== 'saving' && !draft
  useEffect(() => {
    if (!autosavePending) return
    const t = setTimeout(() => {
      save().catch(() => {})
    }, opts.autosaveMs)
    return () => clearTimeout(t)
  }, [content, autosavePending, opts.autosaveMs, save])

  // Leaving the screen (e.g. the bottom tab bar) must not drop an edit that
  // was still waiting for its autosave. The draft covers a failed save.
  const pendingRef = useRef(autosavePending)
  pendingRef.current = autosavePending
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(
    () => () => {
      // Skipped if the edits were discarded meanwhile (e.g. closing the tab).
      if (pendingRef.current && readDraft(path)) saveRef.current().catch(() => {})
    },
    [],
  )

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
