import { useCallback, useSyncExternalStore } from 'react'
import { api } from '../../api/client'
import { store } from '../../lib/util'

// The current workspace is per-device (the phone and a browser on the Mac can
// have different folders open), so it lives in localStorage.
const KEY = 'kc.workspace'
const listeners = new Set<() => void>()

function read(): string | null {
  return store.get<string | null>(KEY, null)
}

export function setCurrentWorkspace(path: string | null) {
  if (path) store.set(KEY, path)
  else store.remove(KEY)
  listeners.forEach((l) => l())
}

export function useCurrentWorkspace(): [string | null, (p: string | null) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    read,
  )
  return [value, useCallback((p: string | null) => setCurrentWorkspace(p), [])]
}

/** Save a folder as a workspace (server side) and make it current. */
export async function openWorkspace(path: string) {
  await api.post('/api/workspaces', { path })
  setCurrentWorkspace(path)
}
