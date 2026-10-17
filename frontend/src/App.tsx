import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { ApiError } from './api/client'
import { DialogProvider } from './components/dialogs'
import { Shell } from './components/Shell'
import { ErrorView } from './components/ui'
import { FilesPage } from './features/files/FilesPage'
import { FileViewPage } from './features/files/FileViewPage'
import { FileEditPage } from './features/files/FileEditPage'
import { NotesHome } from './features/notes/NotesHome'
import { NotesBrowse } from './features/notes/NotesBrowse'
import { NoteEditPage } from './features/notes/NoteEditPage'
import { RepoList } from './features/git/RepoList'
import { RepoView } from './features/git/RepoView'
import { DiffPage } from './features/git/DiffPage'
import { CommitPage } from './features/git/CommitPage'
import { SettingsPage } from './features/settings/SettingsPage'

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
    errorElement: <ErrorView error={new Error('Something went wrong')} onRetry={() => location.reload()} />,
    children: [
      { path: '/', element: <Navigate to="/files" replace /> },
      { path: '/files', element: <FilesPage /> },
      { path: '/files/view', element: <FileViewPage /> },
      { path: '/files/edit', element: <FileEditPage /> },
      { path: '/notes', element: <NotesHome /> },
      { path: '/notes/browse', element: <NotesBrowse /> },
      { path: '/notes/edit', element: <NoteEditPage /> },
      { path: '/git', element: <RepoList /> },
      { path: '/git/repo', element: <RepoView /> },
      { path: '/git/diff', element: <DiffPage /> },
      { path: '/git/commit', element: <CommitPage /> },
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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </DialogProvider>
    </QueryClientProvider>
  )
}
