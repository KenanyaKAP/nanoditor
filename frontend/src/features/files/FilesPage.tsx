import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronsUpDown, Eye, EyeOff, FilePlus2, FolderOpen, FolderPlus, MoreVertical, Search } from 'lucide-react'
import { TopBar } from '../../components/TopBar'
import { Button, EmptyState, IconButton } from '../../components/ui'
import { Sheet, SheetItem } from '../../components/Sheet'
import { useMe } from '../../api/queries'
import { basename, relative, tildify } from '../../lib/path'
import { WorkspaceSheet } from '../workspaces/WorkspaceSheet'
import { useWorkspace } from '../workspaces/workspace'
import { DirList } from './DirList'
import { SearchSheet } from './SearchSheet'
import { useFileOps } from './FileActions'
import { FileTabs } from './FileTabs'
import { openPath } from './openFiles'

export function FilesPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const ws = useWorkspace()
  const workspace = ws.path
  const me = useMe()
  const ops = useFileOps()
  const [wsOpen, setWsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const hidden = ws.settings?.showHidden ?? false

  const path = params.get('path') || workspace
  const base = workspace && path && relative(workspace, path) !== null ? workspace : path

  if (!path || !base) {
    return (
      <>
        <TopBar title="Files" />
        <EmptyState
          icon={<FolderOpen className="h-10 w-10" />}
          title="No folder open"
          body="Open a folder on the server, like VS Code's Open Folder."
          action={
            <Button variant="primary" onClick={() => setWsOpen(true)}>
              Open folder…
            </Button>
          }
        />
        <WorkspaceSheet open={wsOpen} onClose={() => setWsOpen(false)} />
      </>
    )
  }

  const go = (p: string) => setParams(p === workspace ? {} : { path: p })

  return (
    <>
      <TopBar
        title={
          <span className="inline-flex items-center gap-1">
            {basename(base)}
            <ChevronsUpDown className="h-4 w-4 text-muted" />
          </span>
        }
        subtitle={tildify(base, me.data?.home)}
        onTitleClick={() => setWsOpen(true)}
        actions={
          <>
            <IconButton label="Search" onClick={() => setSearchOpen(true)}>
              <Search className="h-5 w-5" />
            </IconButton>
            <IconButton label="More" onClick={() => setMenuOpen(true)}>
              <MoreVertical className="h-5 w-5" />
            </IconButton>
          </>
        }
      />
      <FileTabs active={null} />
      <DirList
        path={path}
        base={base}
        hidden={hidden}
        onOpenDir={go}
        onOpenFile={(e) => navigate(openPath(e.path))}
      />
      <WorkspaceSheet open={wsOpen} onClose={() => setWsOpen(false)} />
      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        root={path}
        title={`Search in ${basename(path)}`}
        onPick={(h) => (h.type === 'dir' ? go(h.path) : navigate(openPath(h.path, { line: h.line })))}
      />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={basename(path)}>
        <SheetItem
          icon={<FilePlus2 className="h-5 w-5" />}
          onClick={async () => {
            setMenuOpen(false)
            const p = await ops.create(path, 'file')
            if (p) navigate(openPath(p, { isNew: true }))
          }}
        >
          New file
        </SheetItem>
        <SheetItem
          icon={<FolderPlus className="h-5 w-5" />}
          onClick={async () => {
            setMenuOpen(false)
            const p = await ops.create(path, 'dir')
            if (p) go(p)
          }}
        >
          New folder
        </SheetItem>
        <SheetItem
          icon={hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          onClick={() => {
            ws.updateSettings({ showHidden: !hidden })
            setMenuOpen(false)
          }}
        >
          {hidden ? 'Hide dotfiles' : 'Show dotfiles'}
        </SheetItem>
        <SheetItem
          icon={<FolderOpen className="h-5 w-5" />}
          onClick={() => {
            setMenuOpen(false)
            setWsOpen(true)
          }}
        >
          Switch workspace…
        </SheetItem>
        <div className="h-3" />
      </Sheet>
    </>
  )
}
