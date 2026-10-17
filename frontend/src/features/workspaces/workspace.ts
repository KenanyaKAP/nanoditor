import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { keys, useWorkspaces } from '../../api/queries'
import type { Workspace, WorkspaceSettings } from '../../api/types'
import { store } from '../../lib/util'

// The current workspace is per-device (the phone and a desktop browser can
// have different folders open), so it lives in localStorage.
const KEY = 'nd.workspace'
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

/**
 * The open workspace with its server record (name, vault). Git and Notes are
 * scoped to it: Git lists the repos inside its folder, Notes opens its vault.
 */
export function useWorkspace() {
  const [path] = useCurrentWorkspace()
  const qc = useQueryClient()
  const list = useWorkspaces()
  const record = path ? list.data?.find((w) => w.path === path) ?? null : null

  // A current path without a record (older state): register it once.
  useEffect(() => {
    if (path && list.data && !record) {
      api
        .post<Workspace>('/api/workspaces', { path })
        .then(() => qc.invalidateQueries({ queryKey: keys.workspaces }))
        .catch(() => {})
    }
  }, [path, list.data, record, qc])

  /** Save some of this workspace's settings (others are kept). */
  const updateSettings = useCallback(
    async (patch: Partial<WorkspaceSettings>) => {
      if (!record) return
      const settings = { ...record.settings, ...patch }
      // Optimistic, so toggles feel instant.
      qc.setQueryData<Workspace[]>(keys.workspaces, (all) => all?.map((w) => (w.id === record.id ? { ...w, settings } : w)))
      try {
        await api.patch<Workspace>(`/api/workspaces/${record.id}`, { settings })
      } finally {
        await qc.invalidateQueries({ queryKey: keys.workspaces })
      }
    },
    [record, qc],
  )

  return {
    path,
    record,
    id: record?.id ?? null,
    settings: record?.settings ?? null,
    vault: record?.settings.vaultPath || null,
    loading: !!path && (list.isLoading || (!!list.data && !record)),
    updateSettings,
    setVault: (vaultPath: string) => updateSettings({ vaultPath }),
  }
}
