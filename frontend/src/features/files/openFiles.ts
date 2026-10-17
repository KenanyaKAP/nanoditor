import { useSyncExternalStore } from 'react'
import { store } from '../../lib/util'

/** Editor URL for a file. `isNew` also starts editing with the cursor at the end. */
export function openPath(p: string, opts: { edit?: boolean; isNew?: boolean; line?: number } = {}) {
  const q = new URLSearchParams({ path: p })
  if (opts.isNew) q.set('new', '1')
  else if (opts.edit) q.set('edit', '1')
  if (opts.line) q.set('line', String(opts.line))
  return '/files/open?' + q.toString()
}

/** Files-tab URL for a folder (the workspace root is plain /files). */
export function dirUrl(dir: string, workspace: string | null) {
  return dir === workspace ? '/files' : '/files?path=' + encodeURIComponent(dir)
}

// Open file tabs, per workspace, like an editor's tab bar. Kept on the device.
const MAX_TABS = 12
const key = (workspace: string | null) => `nd.open:${workspace ?? ''}`
const listeners = new Set<() => void>()
const cache = new Map<string, string[]>()

function read(workspace: string | null): string[] {
  const k = key(workspace)
  if (!cache.has(k)) cache.set(k, store.get<string[]>(k, []))
  return cache.get(k)!
}

function write(workspace: string | null, paths: string[]) {
  cache.set(key(workspace), paths)
  store.set(key(workspace), paths)
  listeners.forEach((l) => l())
}

export function useOpenFiles(workspace: string | null): string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => read(workspace),
  )
}

/** Add a file to the tab bar (no-op if already open). */
export function addOpenFile(workspace: string | null, path: string) {
  const cur = read(workspace)
  if (!cur.includes(path)) write(workspace, [...cur, path].slice(-MAX_TABS))
}

/** Close a tab; returns the path to show next (neighbour) or null. */
export function closeOpenFile(workspace: string | null, path: string): string | null {
  const cur = read(workspace)
  const i = cur.indexOf(path)
  if (i < 0) return null
  const next = cur.filter((p) => p !== path)
  write(workspace, next)
  return next[Math.min(i, next.length - 1)] ?? null
}

export function renameOpenFile(workspace: string | null, from: string, to: string) {
  write(
    workspace,
    read(workspace).map((p) => (p === from ? to : p)),
  )
}
