import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { TopBar } from '../../components/TopBar'
import { IconButton } from '../../components/ui'
import { basename, isMarkdown, relative } from '../../lib/path'
import { DirList } from '../files/DirList'
import { viewPath } from '../files/FilesPage'
import { noteEditPath } from './NoteTabs'
import { useNewNote, useVaultGate } from './NotesHome'

export function NotesBrowse() {
  const gate = useVaultGate()
  if ('gate' in gate) return gate.gate
  return <NotesBrowseInner vault={gate.vault} />
}

function NotesBrowseInner({ vault }: { vault: string }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const newNote = useNewNote()
  const path = params.get('path') || vault
  return (
    <>
      <TopBar
        back
        title={basename(vault)}
        subtitle={relative(vault, path) || 'Vault'}
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
        base={vault}
        onOpenDir={(p) => setParams({ path: p }, { replace: true })}
        onOpenFile={(e) => navigate(isMarkdown(e.path) ? noteEditPath(e.path) : viewPath(e.path))}
      />
    </>
  )
}
