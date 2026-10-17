import { useSyncExternalStore } from 'react'
import { store } from '../../lib/util'

// Open note tabs, per vault, like Obsidian's tab bar. Kept on the device.
const key = (vault: string) => `kc.opennotes:${vault}`
const listeners = new Set<() => void>()
const cache = new Map<string, string[]>()

function read(vault: string): string[] {
  if (!cache.has(vault)) cache.set(vault, store.get<string[]>(key(vault), []))
  return cache.get(vault)!
}

function write(vault: string, paths: string[]) {
  cache.set(vault, paths)
  store.set(key(vault), paths)
  listeners.forEach((l) => l())
}

export function useOpenNotes(vault: string | null): string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (vault ? read(vault) : empty),
  )
}
const empty: string[] = []

/** Add a note to the tab bar (no-op if already open). */
export function addOpenNote(vault: string, path: string) {
  const cur = read(vault)
  if (!cur.includes(path)) write(vault, [...cur, path].slice(-12))
}

/** Close a tab; returns the path to show next (neighbour) or null. */
export function closeOpenNote(vault: string, path: string): string | null {
  const cur = read(vault)
  const i = cur.indexOf(path)
  if (i < 0) return null
  const next = cur.filter((p) => p !== path)
  write(vault, next)
  return next[Math.min(i, next.length - 1)] ?? null
}

export function renameOpenNote(vault: string, from: string, to: string) {
  write(
    vault,
    read(vault).map((p) => (p === from ? to : p)),
  )
}
