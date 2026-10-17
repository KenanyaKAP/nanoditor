import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Me, Settings, Workspace } from './types'

export const keys = {
  me: ['me'] as const,
  settings: ['settings'] as const,
  workspaces: ['workspaces'] as const,
  recents: (kind?: string) => ['recents', kind ?? ''] as const,
  list: (path: string, hidden?: boolean) => ['fs', 'list', path, !!hidden] as const,
  file: (path: string) => ['fs', 'read', path] as const,
  notesRecent: (vault: string) => ['notes', 'recent', vault] as const,
  repos: (root: string) => ['git', 'repos', root] as const,
  status: (repo: string) => ['git', 'status', repo] as const,
  diff: (repo: string, path: string, staged: boolean, untracked: boolean) =>
    ['git', 'diff', repo, path, staged, untracked] as const,
  log: (repo: string) => ['git', 'log', repo] as const,
  show: (repo: string, rev: string) => ['git', 'show', repo, rev] as const,
  branches: (repo: string) => ['git', 'branches', repo] as const,
  stash: (repo: string) => ['git', 'stash', repo] as const,
  messages: (repo: string) => ['git', 'messages', repo] as const,
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/api/me'), staleTime: 5 * 60_000 })
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => api.get<Settings>('/api/settings'),
    staleTime: 60_000,
  })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: Settings) => api.put<Settings>('/api/settings', s),
    onSuccess: (s) => {
      qc.setQueryData(keys.settings, s)
      qc.invalidateQueries({ queryKey: ['git', 'repos'] })
      qc.invalidateQueries({ queryKey: ['notes'] })
      qc.invalidateQueries({ queryKey: ['fs', 'list'] })
    },
  })
}

export function useWorkspaces() {
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: () => api.get<Workspace[]>('/api/workspaces'),
  })
}

export function touchRecent(path: string, kind: 'file' | 'note') {
  api.post('/api/recents', { path, kind }).catch(() => {})
}
