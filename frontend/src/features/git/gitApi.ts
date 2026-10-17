import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { keys } from '../../api/queries'
import type { FileStatus, StatusResponse } from '../../api/types'
import { useDialogs } from '../../components/dialogs'

export function repoPath(repo: string, tab?: string) {
  return '/git/repo?repo=' + encodeURIComponent(repo) + (tab ? '&tab=' + tab : '')
}

export type Section = 'staged' | 'changes' | 'untracked' | 'conflicts'

export function diffPath(repo: string, f: FileStatus, section: Section) {
  const p = new URLSearchParams({ repo, path: f.path, section })
  return '/git/diff?' + p.toString()
}

export function useStatus(repo: string) {
  return useQuery({
    queryKey: keys.status(repo),
    queryFn: () => api.get<StatusResponse>('/api/git/status', { repo }),
    enabled: !!repo,
    refetchInterval: 15_000,
  })
}

/** Run a git mutation, then refresh everything git-related for the repo. */
export function useGitAction<T = unknown>(repo: string) {
  const qc = useQueryClient()
  const { toastError } = useDialogs()
  return useMutation({
    mutationFn: ({ url, body }: { url: string; body: Record<string, unknown> }) =>
      api.post<T>(url, { repo, ...body }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['git'] })
      qc.invalidateQueries({ queryKey: ['fs', 'list'] })
    },
    onError: toastError,
  })
}

export const statusColor: Record<string, string> = {
  M: 'text-warn',
  A: 'text-add',
  D: 'text-del',
  R: 'text-accent',
  C: 'text-accent',
  U: 'text-del',
  T: 'text-warn',
  '?': 'text-add',
}

export function letterFor(f: FileStatus, section: Section): string {
  if (section === 'untracked') return '?'
  if (section === 'conflicts') return 'U'
  return section === 'staged' ? f.x : f.y
}
