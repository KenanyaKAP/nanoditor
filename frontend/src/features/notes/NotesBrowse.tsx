import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useSettings } from '../../api/queries'
import { TopBar } from '../../components/TopBar'
import { IconButton, Loading } from '../../components/ui'
import { isMarkdown } from '../../lib/path'
import { DirList } from '../files/DirList'
import { viewPath } from '../files/FilesPage'
import { noteEditPath, useNewNote } from './NotesHome'

export function NotesBrowse() {
  const settings = useSettings()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const newNote = useNewNote()
  const root = settings.data?.notesRoot ?? ''
  const path = params.get('path') || root
  if (!root) return <Loading />
  return (
    <>
      <TopBar
        back
        title="Vault"
        subtitle={path === root ? root.split('/').pop() : path.slice(root.length + 1)}
        actions={
          <IconButton
            label="New note here"
            onClick={async () => {
              const p = await newNote(path)
              if (p) navigate(noteEditPath(p, true))
            }}
          >
            <Plus className="h-6 w-6" />
          </IconButton>
        }
      />
      <DirList
        path={path}
        base={root}
        onOpenDir={(p) => setParams({ path: p }, { replace: true })}
        onOpenFile={(e) => navigate(isMarkdown(e.path) ? noteEditPath(e.path) : viewPath(e.path))}
      />
    </>
  )
}
