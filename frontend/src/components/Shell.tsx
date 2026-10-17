import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { FolderOpen, GitBranch, RefreshCw, Settings } from 'lucide-react'
import { cx, store } from '../lib/util'
import { useSettings } from '../api/queries'
import { recordLocation } from '../lib/nav'
import { useCurrentWorkspace } from '../features/workspaces/workspace'

const tabs = [
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/git', label: 'Git', icon: GitBranch },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/**
 * Track the visual viewport so the layout shrinks above the iOS keyboard
 * instead of being pushed off-screen. Exposes --vvh / --vv-top CSS vars and
 * returns whether the keyboard appears to be open.
 */
function useVisualViewport(): boolean {
  const [keyboard, setKeyboard] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const root = document.documentElement
      root.style.setProperty('--vvh', `${vv.height}px`)
      root.style.setProperty('--vv-top', `${vv.offsetTop}px`)
      setKeyboard(window.innerHeight - vv.height > 140)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return keyboard
}

function useTheme() {
  const { data } = useSettings()
  const theme = data?.theme ?? store.get<string>('nd.theme', 'system')
  useEffect(() => {
    store.set('nd.theme', theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

// Last screen per tab, per workspace: a repo or file from another workspace
// must not be resumed after switching.
const lastKey = (workspace: string | null, tab: string) => `nd.last:${workspace ?? ''}:${tab}`

export function Shell() {
  const keyboard = useVisualViewport()
  useTheme()
  const loc = useLocation()
  const navigate = useNavigate()
  const [workspace] = useCurrentWorkspace()

  // Remember the last screen of each tab, so switching tabs returns there.
  useEffect(() => {
    recordLocation(loc.pathname + loc.search)
    const tab = tabs.find((t) => loc.pathname.startsWith(t.to))
    if (tab) store.set(lastKey(workspace, tab.to), loc.pathname + loc.search)
    // Only on navigation: a workspace switch alone must not file the old
    // workspace's screen under the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc])

  return (
    <div
      className="fixed inset-x-0 flex flex-col bg-bg"
      style={{ top: 'var(--vv-top, 0px)', height: 'var(--vvh, 100dvh)' }}
    >
      <main className="relative flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      {!keyboard && (
        <nav className="shrink-0 border-t border-line bg-bg/95 pb-safe backdrop-blur px-safe">
          <div className="flex">
            {tabs.map((t) => {
              const active = loc.pathname.startsWith(t.to)
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  onClick={(e) => {
                    e.preventDefault()
                    // Tapping the active tab goes to its root; otherwise resume.
                    const last = store.get<string | null>(lastKey(workspace, t.to), null)
                    navigate(active || !last ? t.to : last)
                  }}
                  className={cx(
                    'flex h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                    active ? 'text-accent' : 'text-muted',
                  )}
                >
                  <t.icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 1.8} />
                  {t.label}
                </NavLink>
              )
            })}
          </div>
        </nav>
      )}
    </div>
  )
}

/** Scrollable page body under a TopBar, with optional pull-to-refresh. */
export function Page({
  children,
  className,
  onRefresh,
}: {
  children: React.ReactNode
  className?: string
  onRefresh?: () => Promise<unknown>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef<number | null>(null)
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)

  const handlers = onRefresh
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          start.current = (ref.current?.scrollTop ?? 1) <= 0 ? e.touches[0].clientY : null
        },
        onTouchMove: (e: React.TouchEvent) => {
          if (start.current === null || busy) return
          const dy = e.touches[0].clientY - start.current
          setPull(dy > 0 ? Math.min(dy * 0.45, 80) : 0)
        },
        onTouchEnd: async () => {
          const trigger = pull > 56
          start.current = null
          if (!trigger) {
            setPull(0)
            return
          }
          setBusy(true)
          setPull(44)
          try {
            await onRefresh()
          } finally {
            setBusy(false)
            setPull(0)
          }
        },
      }
    : {}

  return (
    <div ref={ref} className={cx('scroll-touch min-h-0 flex-1 overflow-y-auto px-safe', className)} {...handlers}>
      {onRefresh && (
        <div
          className="flex items-end justify-center overflow-hidden text-muted transition-[height]"
          style={{ height: pull, transitionDuration: start.current === null ? '200ms' : '0ms' }}
        >
          <RefreshCw
            className={cx('mb-2 h-5 w-5', busy && 'animate-spin')}
            style={{ transform: busy ? undefined : `rotate(${pull * 4}deg)`, opacity: Math.min(pull / 56, 1) }}
          />
        </div>
      )}
      {children}
    </div>
  )
}
