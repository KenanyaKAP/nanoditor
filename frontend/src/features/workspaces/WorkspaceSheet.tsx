import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Check, Clock, FolderOpen, FolderPlus } from 'lucide-react'
import { api } from '../../api/client'
import { keys, useMe, useWorkspaces } from '../../api/queries'
import type { Recent } from '../../api/types'
import { Sheet, SheetItem } from '../../components/Sheet'
import { SectionTitle } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { basename, dirname, tildify } from '../../lib/path'
import { relTime } from '../../lib/util'
import { FolderPicker } from './FolderPicker'
import { openWorkspace, useCurrentWorkspace } from './workspace'

export function WorkspaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspaces()
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toastError } = useDialogs()
  const [current] = useCurrentWorkspace()
  const [picking, setPicking] = useState(false)
  const recents = useQuery({
    queryKey: keys.recents('file'),
    queryFn: () => api.get<Recent[]>('/api/recents', { kind: 'file' }),
    enabled: open,
  })

  const choose = async (path: string) => {
    try {
      await openWorkspace(path)
      qc.invalidateQueries({ queryKey: keys.workspaces })
      onClose()
      navigate('/files')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <>
      <Sheet open={open && !picking} onClose={onClose} title="Workspaces">
        <SheetItem icon={<FolderPlus className="h-5 w-5" />} onClick={() => setPicking(true)}>
          <span className="font-medium text-accent">Open folder…</span>
        </SheetItem>
        {(ws.data?.length ?? 0) > 0 && <SectionTitle>Saved</SectionTitle>}
        {ws.data?.map((w) => (
          <SheetItem
            key={w.id}
            icon={<FolderOpen className="h-5 w-5" />}
            onClick={() => choose(w.path)}
            right={w.path === current ? <Check className="h-5 w-5 text-accent" /> : undefined}
          >
            <div className="truncate">{w.name}</div>
            <div className="truncate text-xs text-muted">{tildify(w.path, me.data?.home)}</div>
          </SheetItem>
        ))}
        {(recents.data?.length ?? 0) > 0 && <SectionTitle>Recent files</SectionTitle>}
        {recents.data?.slice(0, 12).map((r) => (
          <SheetItem
            key={r.path}
            icon={<Clock className="h-5 w-5" />}
            onClick={() => {
              onClose()
              navigate('/files/view?path=' + encodeURIComponent(r.path))
            }}
            right={<span className="text-xs text-muted">{relTime(r.openedAt)}</span>}
          >
            <div className="truncate">{basename(r.path)}</div>
            <div className="truncate text-xs text-muted">{tildify(dirname(r.path), me.data?.home)}</div>
          </SheetItem>
        ))}
        <div className="h-3" />
      </Sheet>
      <FolderPicker
        open={picking}
        start={current}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false)
          choose(p)
        }}
      />
    </>
  )
}
