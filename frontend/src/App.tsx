import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useRouteError } from 'react-router-dom'
import { ApiError } from './api/client'
import { DialogProvider } from './components/dialogs'
import { Shell } from './components/Shell'
import { ErrorView } from './components/ui'
import { FilesPage } from './features/files/FilesPage'
import { FilePage } from './features/files/FilePage'
import { openPath } from './features/files/openFiles'
import { RepoList } from './features/git/RepoList'
import { RepoView } from './features/git/RepoView'
import { DiffPage } from './features/git/DiffPage'
import { CommitPage } from './features/git/CommitPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TerminalPage } from './features/terminal/TerminalPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})

const router = createBrowserRouter([
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Navigate to="/files" replace /> },
      { path: '/files', element: <FilesPage /> },
      { path: '/files/open', element: <FilePage /> },
      { path: '/files/view', element: <LegacyRedirect /> },
      { path: '/files/edit', element: <LegacyRedirect /> },
      { path: '/notes/*', element: <LegacyRedirect /> },
      { path: '/git', element: <RepoList /> },
      { path: '/git/repo', element: <RepoView /> },
      { path: '/git/diff', element: <DiffPage /> },
      { path: '/git/commit', element: <CommitPage /> },
      { path: '/terminal', element: <TerminalPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/files" replace /> },
    ],
  },
], {
  future: {
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
})

/** Addresses from older versions (Vault tab, separate view/edit pages): old links, remembered last screens. */
function LegacyRedirect() {
  const { pathname, search } = useLocation()
  const params = new URLSearchParams(search)
  const path = params.get('path')
  let to = '/files'
  if (path && pathname === '/notes/browse') to = '/files?path=' + encodeURIComponent(path)
  else if (path) to = openPath(path, { edit: pathname === '/files/edit', line: Number(params.get('line') ?? 0) })
  return <Navigate to={to} replace />
}

/** Shows what actually broke instead of a generic message. */
function RouteError() {
  const err = useRouteError()
  const e = err instanceof Error ? err : new Error(String((err as any)?.statusText ?? err ?? 'Something went wrong'))
  return <ErrorView error={e} onRetry={() => location.reload()} />
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </DialogProvider>
    </QueryClientProvider>
  )
}
