import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, FolderOpen, Gem, Pencil, Trash2, X } from 'lucide-react'
import { api } from '../../api/client'
import { keys, useMe, useSaveSettings, useSettings, useWorkspaces } from '../../api/queries'
import type { Workspace } from '../../api/types'
import { TopBar } from '../../components/TopBar'
import { Page } from '../../components/Shell'
import { Card, ErrorView, Loading, SectionTitle, Segmented, Toggle } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { relative, tildify } from '../../lib/path'
import { VaultSetup } from '../notes/VaultSetup'
import { setCurrentWorkspace, useWorkspace } from '../workspaces/workspace'

export function SettingsPage() {
  const s = useSettings()
  const me = useMe()
  const save = useSaveSettings()
  const ws = useWorkspace()
  const { toastError } = useDialogs()
  const home = me.data?.home

  if (s.isLoading) return <Loading />
  if (s.error || !s.data) return <ErrorView error={s.error} />

  return (
    <>
      <TopBar title="Settings" subtitle={save.isPending ? 'Saving…' : undefined} />
      <Page>
        {ws.path ? (
          ws.record ? (
            <WorkspaceSection ws={ws.record} home={home} update={ws.updateSettings} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            <SectionTitle>This workspace</SectionTitle>
            <Card className="px-4 py-4 text-sm text-muted">
              No folder open.{' '}
              <Link to="/files" className="font-medium text-accent">
                Open one in Files
              </Link>{' '}
              to set its vault and git options.
            </Card>
          </>
        )}

        <WorkspaceList current={ws.path} home={home} />

        <SectionTitle>App</SectionTitle>
        <Card>
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="text-[15px]">Theme</span>
            <Segmented
              className="w-56"
              value={s.data.theme}
              onChange={(theme) => save.mutate({ ...s.data, theme }, { onError: toastError })}
              options={[
                { value: 'system', label: 'Auto' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </div>
        </Card>

        <SectionTitle>About</SectionTitle>
        <Card className="mb-8 px-4 py-3 text-sm">
          {me.data?.identity?.login && (
            <div>
              Signed in via Tailscale as <span className="font-medium">{me.data.identity.login}</span>
            </div>
          )}
          <div className="text-muted">
            {me.data?.identity?.node ? `Device: ${me.data.identity.node} · ` : ''}Nanoditor {me.data?.version}
          </div>
          <div className="mt-1 text-muted">Allowed folders: {me.data?.roots.map((r) => tildify(r, home)).join(', ')}</div>
        </Card>
      </Page>
    </>
  )
}

/** Settings saved for the open workspace only. */
function WorkspaceSection({
  ws,
  home,
  update,
}: {
  ws: Workspace
  home?: string
  update: (patch: Partial<Workspace['settings']>) => Promise<void>
}) {
  const { toast, toastError, confirm } = useDialogs()
  const set = ws.settings
  const run = (patch: Partial<Workspace['settings']>, msg?: string) =>
    update(patch)
      .then(() => msg && toast(msg))
      .catch(toastError)

  return (
    <>
      <SectionTitle>This workspace</SectionTitle>
      <Card>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <FolderOpen className="h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{ws.name}</div>
            <div className="truncate font-mono text-xs text-muted">{tildify(ws.path, home)}</div>
          </div>
        </div>

        <div className="border-b border-line px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[15px]">
            <Gem className="h-4 w-4 text-accent" /> Notes vault
          </div>
          {set.vaultPath ? (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-raised px-3 py-2.5">
              <div className="min-w-0 flex-1 truncate font-mono text-sm">
                {relative(ws.path, set.vaultPath) ?? tildify(set.vaultPath, home)}
                {relative(ws.path, set.vaultPath) === '' && '(workspace folder)'}
              </div>
              <button
                aria-label="Remove vault"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted active:bg-line"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Remove vault from this workspace?',
                    message: 'Notes stay on disk; the Notes tab just stops opening them here.',
                    confirmLabel: 'Remove',
                  })
                  if (ok) run({ vaultPath: '' })
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="mb-3 text-sm text-muted">Not set. The Notes tab opens once you choose one.</div>
          )}
          <VaultSetup workspace={ws.path} current={set.vaultPath} onPick={(p) => update({ vaultPath: p }).then(() => toast('Vault set'))} />
        </div>

        <TextRow label="Daily notes folder" value={set.dailyFolder} onSave={(v) => run({ dailyFolder: v }, 'Saved')} />
        <TextRow label="Inbox file" value={set.inboxFile} onSave={(v) => run({ inboxFile: v }, 'Saved')} />
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
          <div>
            <div className="text-[15px]">Git scan depth</div>
            <div className="text-xs text-muted">How deep to look for repos</div>
          </div>
          <Segmented
            className="w-44"
            value={String(set.scanDepth)}
            onChange={(v) => run({ scanDepth: Number(v) })}
            options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))}
          />
        </div>
        <Toggle label="Show dotfiles" checked={set.showHidden} onChange={(v) => run({ showHidden: v })} />
      </Card>
    </>
  )
}

function WorkspaceList({ current, home }: { current: string | null; home?: string }) {
  const ws = useWorkspaces()
  const qc = useQueryClient()
  const { prompt, confirm, toast, toastError } = useDialogs()
  if (!ws.data?.length) return null
  return (
    <>
      <SectionTitle>Workspaces</SectionTitle>
      <Card>
        {ws.data.map((w) => (
          <div key={w.id} className="flex min-h-[56px] items-center border-b border-line last:border-b-0">
            <button
              className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left active:bg-raised"
              onClick={() => {
                if (w.path === current) return
                setCurrentWorkspace(w.path)
                toast(`Switched to ${w.name}`)
              }}
            >
              {w.path === current ? (
                <Check className="h-5 w-5 shrink-0 text-accent" />
              ) : (
                <FolderOpen className="h-5 w-5 shrink-0 text-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px]">{w.name}</div>
                <div className="truncate text-xs text-muted">
                  {tildify(w.path, home)}
                  {w.settings.vaultPath ? ' · vault ✓' : ''}
                </div>
              </div>
            </button>
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
                  message: 'Only the shortcut and its settings are removed. Files are not touched.',
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
    </>
  )
}

function TextRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <label className="flex min-h-[52px] items-center gap-3 border-b border-line px-4">
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

