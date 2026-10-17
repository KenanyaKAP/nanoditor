import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderGit2, FolderOpen, NotebookPen, Pencil, Trash2, X } from 'lucide-react'
import { api } from '../../api/client'
import { keys, useMe, useSaveSettings, useSettings, useWorkspaces } from '../../api/queries'
import type { Settings } from '../../api/types'
import { TopBar } from '../../components/TopBar'
import { Page } from '../../components/Shell'
import { Card, ErrorView, Loading, SectionTitle, Segmented, Toggle } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { tildify } from '../../lib/path'
import { FolderPicker } from '../workspaces/FolderPicker'
import { setCurrentWorkspace, useCurrentWorkspace } from '../workspaces/workspace'

type Picking = null | 'notes' | 'git'

export function SettingsPage() {
  const s = useSettings()
  const me = useMe()
  const ws = useWorkspaces()
  const save = useSaveSettings()
  const qc = useQueryClient()
  const [current] = useCurrentWorkspace()
  const { toast, toastError, prompt, confirm } = useDialogs()
  const [draft, setDraft] = useState<Settings | null>(null)
  const [picking, setPicking] = useState<Picking>(null)
  const home = me.data?.home

  useEffect(() => {
    if (s.data) setDraft(s.data)
  }, [s.data])

  if (s.isLoading || !draft) return s.error ? <ErrorView error={s.error} /> : <Loading />

  const commit = (next: Settings) => {
    setDraft(next)
    save.mutate(next, { onError: toastError })
  }

  return (
    <>
      <TopBar title="Settings" subtitle={save.isPending ? 'Saving…' : undefined} />
      <Page>
        <SectionTitle>Notes</SectionTitle>
        <Card>
          <PathRow
            icon={<NotebookPen className="h-5 w-5 text-accent" />}
            label="Notes folder"
            value={draft.notesRoot ? tildify(draft.notesRoot, home) : 'Not set'}
            onClick={() => setPicking('notes')}
          />
          <TextRow
            label="Daily notes folder"
            value={draft.dailyFolder}
            onSave={(v) => commit({ ...draft, dailyFolder: v })}
          />
          <TextRow label="Inbox file" value={draft.inboxFile} onSave={(v) => commit({ ...draft, inboxFile: v })} />
        </Card>

        <SectionTitle>Git</SectionTitle>
        <Card>
          {draft.gitRoots.length === 0 && (
            <div className="px-4 py-3 text-sm text-muted">Add the folder(s) that contain your repositories.</div>
          )}
          {draft.gitRoots.map((r) => (
            <div key={r} className="flex min-h-[52px] items-center gap-3 border-b border-line pl-4">
              <FolderGit2 className="h-5 w-5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{tildify(r, home)}</span>
              <button
                aria-label="Remove"
                className="flex h-12 w-12 items-center justify-center text-muted active:bg-raised"
                onClick={() => commit({ ...draft, gitRoots: draft.gitRoots.filter((x) => x !== r) })}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ))}
          <button className="w-full px-4 py-3.5 text-left font-medium text-accent active:bg-raised" onClick={() => setPicking('git')}>
            + Add git folder
          </button>
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
            <span className="text-[15px]">Scan depth</span>
            <Segmented
              className="w-48"
              value={String(draft.scanDepth)}
              onChange={(v) => commit({ ...draft, scanDepth: Number(v) })}
              options={['1', '2', '3', '4'].map((v) => ({ value: v, label: v }))}
            />
          </div>
        </Card>

        <SectionTitle>Workspaces</SectionTitle>
        <Card>
          {ws.data?.length === 0 && <div className="px-4 py-3 text-sm text-muted">Open a folder in Files to save it here.</div>}
          {ws.data?.map((w) => (
            <div key={w.id} className="flex min-h-[56px] items-center gap-3 border-b border-line pl-4 last:border-b-0">
              <FolderOpen className="h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1 py-1">
                <div className="truncate text-[15px]">
                  {w.name} {w.path === current && <span className="text-xs text-accent">· open</span>}
                </div>
                <div className="truncate text-xs text-muted">{tildify(w.path, home)}</div>
              </div>
              <button
                aria-label="Rename"
                className="flex h-12 w-10 items-center justify-center text-muted active:bg-raised"
                onClick={async () => {
                  const name = await prompt({ title: 'Rename workspace', initial: w.name, confirmLabel: 'Rename' })
                  if (!name) return
                  await api.patch(`/api/workspaces/${w.id}`, { name }).catch(toastError)
                  qc.invalidateQueries({ queryKey: keys.workspaces })
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                aria-label="Remove"
                className="flex h-12 w-12 items-center justify-center text-muted active:bg-raised"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Remove ${w.name}?`,
                    message: 'Only the shortcut is removed. Files are not touched.',
                    confirmLabel: 'Remove',
                  })
                  if (!ok) return
                  await api.del(`/api/workspaces/${w.id}`).catch(toastError)
                  if (w.path === current) setCurrentWorkspace(null)
                  qc.invalidateQueries({ queryKey: keys.workspaces })
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </Card>

        <SectionTitle>Display</SectionTitle>
        <Card>
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="text-[15px]">Theme</span>
            <Segmented
              className="w-56"
              value={draft.theme}
              onChange={(v) => commit({ ...draft, theme: v })}
              options={[
                { value: 'system', label: 'Auto' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </div>
          <div className="border-t border-line">
            <Toggle label="Show dotfiles by default" checked={draft.showHidden} onChange={(v) => commit({ ...draft, showHidden: v })} />
          </div>
        </Card>

        <SectionTitle>About</SectionTitle>
        <Card className="mb-8 px-4 py-3 text-sm">
          <div>
            Signed in via Tailscale as <span className="font-medium">{me.data?.identity?.login ?? '…'}</span>
          </div>
          <div className="text-muted">
            Device: {me.data?.identity?.node || 'unknown'} · KennyCode {me.data?.version}
          </div>
          <div className="mt-1 text-muted">Allowed roots: {me.data?.roots.map((r) => tildify(r, home)).join(', ')}</div>
        </Card>
      </Page>

      <FolderPicker
        open={picking !== null}
        title={picking === 'notes' ? 'Choose notes folder' : 'Add git folder'}
        confirmLabel={picking === 'notes' ? 'Use this folder' : 'Add this folder'}
        start={picking === 'notes' ? draft.notesRoot || null : null}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          if (picking === 'notes') commit({ ...draft, notesRoot: p })
          else if (!draft.gitRoots.includes(p)) commit({ ...draft, gitRoots: [...draft.gitRoots, p] })
          setPicking(null)
          toast('Saved')
        }}
      />
    </>
  )
}

function PathRow({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value: string; onClick: () => void }) {
  return (
    <button className="flex min-h-[56px] w-full items-center gap-3 border-b border-line px-4 text-left active:bg-raised" onClick={onClick}>
      {icon}
      <div className="min-w-0 flex-1 py-1">
        <div className="text-[15px]">{label}</div>
        <div className="truncate font-mono text-xs text-muted">{value}</div>
      </div>
      <span className="text-sm text-accent">Change</span>
    </button>
  )
}

function TextRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <label className="flex min-h-[52px] items-center gap-3 border-b border-line px-4 last:border-b-0">
      <span className="shrink-0 text-[15px]">{label}</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() && v !== value && onSave(v.trim())}
        autoCapitalize="off"
        autoCorrect="off"
        className="min-w-0 flex-1 bg-transparent text-right font-mono text-sm text-muted outline-none focus:text-fg"
      />
    </label>
  )
}

