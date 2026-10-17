import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ClipboardCopy, Copy, Download, FilePlus2, FolderPlus, Pencil, Trash2, TextCursorInput } from 'lucide-react'
import { api, rawUrl } from '../../api/client'
import type { Entry, FileContent } from '../../api/types'
import { Sheet, SheetItem } from '../../components/Sheet'
import { useDialogs } from '../../components/dialogs'
import { basename, dirname, join, relative } from '../../lib/path'
import { copyText } from '../../lib/util'
import { useCurrentWorkspace } from '../workspaces/workspace'
import { closeOpenFile, openPath, renameOpenFile } from './openFiles'

export function useFileOps() {
  const qc = useQueryClient()
  const { prompt, confirm, toast, toastError } = useDialogs()

  const refresh = (dir: string) => {
    qc.invalidateQueries({ queryKey: ['fs', 'list', dir] })
    qc.invalidateQueries({ queryKey: ['git'] })
    qc.invalidateQueries({ queryKey: ['notes'] })
  }

  return {
    async create(dir: string, type: 'file' | 'dir', initial?: string): Promise<string | null> {
      const name = await prompt({
        title: type === 'file' ? 'New file' : 'New folder',
        placeholder: type === 'file' ? 'name.md' : 'folder name',
        initial,
        selectStem: true,
        confirmLabel: 'Create',
      })
      if (!name) return null
      try {
        const res = await api.post<{ path: string }>('/api/fs/create', { path: join(dir, name), type })
        refresh(dir)
        return res.path
      } catch (e) {
        toastError(e)
        return null
      }
    },
    async rename(path: string): Promise<string | null> {
      const name = await prompt({ title: 'Rename', initial: basename(path), selectStem: true, confirmLabel: 'Rename' })
      if (!name || name === basename(path)) return null
      try {
        const res = await api.post<{ path: string }>('/api/fs/rename', { from: path, to: join(dirname(path), name) })
        refresh(dirname(path))
        toast('Renamed')
        return res.path
      } catch (e) {
        toastError(e)
        return null
      }
    },
    async remove(path: string, isDir: boolean): Promise<boolean> {
      const ok = await confirm({
        title: `Delete ${basename(path)}?`,
        message: `The ${isDir ? 'folder' : 'file'} is moved to Nanoditor's trash folder (data/trash), not erased.`,
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!ok) return false
      try {
        await api.post('/api/fs/delete', { path })
        refresh(dirname(path))
        toast('Moved to trash')
        return true
      } catch (e) {
        toastError(e)
        return false
      }
    },
    async copy(text: string, what = 'Copied') {
      const ok = await copyText(text)
      toast(ok ? what : 'Copy failed', ok ? 'ok' : 'error')
    },
  }
}

export function FileActions({ entry, base, onClose }: { entry: Entry | null; base: string; onClose: () => void }) {
  const ops = useFileOps()
  const navigate = useNavigate()
  const [workspace] = useCurrentWorkspace()
  // Load contents up front: iOS only allows clipboard writes synchronously
  // inside the tap, not after awaiting a request.
  const contents = useQuery({
    queryKey: ['fs', 'read', entry?.path ?? ''],
    queryFn: () => api.get<FileContent>('/api/fs/read', { path: entry!.path }),
    enabled: entry?.type === 'file' && entry.size <= 2 << 20,
    staleTime: 10_000,
  })
  if (!entry) return null
  const rel = relative(base, entry.path)
  const run = (fn: () => unknown) => () => {
    onClose()
    fn()
  }
  return (
    <Sheet open title={entry.name} onClose={onClose}>
      {entry.type === 'file' && (
        <SheetItem
          icon={<Pencil className="h-5 w-5" />}
          onClick={run(() => navigate(openPath(entry.path, { edit: true })))}
        >
          Edit
        </SheetItem>
      )}
      {entry.type === 'dir' && (
        <>
          <SheetItem icon={<FilePlus2 className="h-5 w-5" />} onClick={run(() => ops.create(entry.path, 'file'))}>
            New file inside
          </SheetItem>
          <SheetItem icon={<FolderPlus className="h-5 w-5" />} onClick={run(() => ops.create(entry.path, 'dir'))}>
            New folder inside
          </SheetItem>
        </>
      )}
      <SheetItem
        icon={<TextCursorInput className="h-5 w-5" />}
        onClick={run(async () => {
          const p = await ops.rename(entry.path)
          if (p && entry.type === 'file') renameOpenFile(workspace, entry.path, p)
        })}
      >
        Rename
      </SheetItem>
      <SheetItem icon={<Copy className="h-5 w-5" />} onClick={run(() => ops.copy(entry.path, 'Path copied'))}>
        Copy path
      </SheetItem>
      {rel !== null && rel !== '' && (
        <SheetItem icon={<Copy className="h-5 w-5" />} onClick={run(() => ops.copy(rel, 'Relative path copied'))}>
          Copy relative path
        </SheetItem>
      )}
      {entry.type === 'file' && (
        <>
          <SheetItem
            icon={<ClipboardCopy className="h-5 w-5" />}
            disabled={!contents.data || contents.data.isBinary}
            onClick={run(() => contents.data && ops.copy(contents.data.content, 'Contents copied'))}
          >
            {contents.isLoading ? 'Copy contents…' : contents.data?.isBinary ? 'Copy contents (binary file)' : 'Copy contents'}
          </SheetItem>
          <a href={rawUrl(entry.path, true)} onClick={onClose}>
            <SheetItem icon={<Download className="h-5 w-5" />}>Download</SheetItem>
          </a>
        </>
      )}
      <SheetItem
        danger
        icon={<Trash2 className="h-5 w-5" />}
        onClick={run(async () => {
          if ((await ops.remove(entry.path, entry.type === 'dir')) && entry.type === 'file') closeOpenFile(workspace, entry.path)
        })}
      >
        Delete
      </SheetItem>
      <div className="h-3" />
    </Sheet>
  )
}
