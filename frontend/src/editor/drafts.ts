import { useSyncExternalStore } from 'react'
import { api } from '../api/client'
import type { WriteResult } from '../api/types'
import { store } from '../lib/util'

/**
 * Unsaved edits, kept per file on this device until they are saved or
 * discarded, so they survive tab switches, leaving the editor and reloads.
 */
export interface Draft {
  content: string
  /** Etag of the version the edits started from. */
  baseEtag: string
  savedAt: number
}

const PREFIX = 'nd.draft:'
const listeners = new Set<() => void>()
let snapshot: ReadonlySet<string> | null = null

// Which files have drafts, read from storage once and then kept in step.
function paths(): ReadonlySet<string> {
  if (!snapshot) {
    const found = new Set<string>()
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(PREFIX)) found.add(k.slice(PREFIX.length))
      }
    } catch {
      // storage blocked
    }
    snapshot = found
  }
  return snapshot
}

function change(fn: (s: Set<string>) => void) {
  const next = new Set(paths())
  fn(next)
  snapshot = next
  listeners.forEach((l) => l())
}

export function readDraft(path: string): Draft | null {
  return store.get<Draft | null>(PREFIX + path, null)
}

export function writeDraft(path: string, d: Draft) {
  store.set(PREFIX + path, d)
  if (!paths().has(path)) change((s) => s.add(path))
}

export function removeDraft(path: string) {
  store.remove(PREFIX + path)
  if (paths().has(path)) change((s) => s.delete(path))
}

/** Keep a file's unsaved edits when it is renamed. */
export function moveDraft(from: string, to: string) {
  const d = readDraft(from)
  if (!d) return
  removeDraft(from)
  writeDraft(to, d)
}

/** Files with unsaved edits; re-renders when one is added or cleared. */
export function useDraftPaths(): ReadonlySet<string> {
  return useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, paths)
}

/** Save a file's unsaved edits without opening it. Throws a 409 ApiError if it changed on disk. */
export async function saveDraft(path: string) {
  const d = readDraft(path)
  if (!d) return
  await api.put<WriteResult>('/api/fs/write', { path, content: d.content, etag: d.baseEtag })
  removeDraft(path)
}
