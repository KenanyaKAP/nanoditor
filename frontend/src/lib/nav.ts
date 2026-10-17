import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

// What URL sits at each history index (React Router keeps `idx` in
// history.state). Lets "up" reuse a real back step when it leads there.
const entries = new Map<number, string>()

function historyIdx(): number | null {
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' ? idx : null
}

/** Normalise a URL so "?path=a%20b" and "?path=a+b" compare equal. */
function norm(url: string): string {
  const u = new URL(url, 'http://x')
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
  return u.pathname + '?' + new URLSearchParams(params).toString()
}

/** Called by the shell on every location change. */
export function recordLocation(url: string) {
  const idx = historyIdx()
  if (idx !== null) entries.set(idx, norm(url))
}

/**
 * Go to a screen's logical parent. If the previous history entry is that
 * parent, step back (keeps iOS swipe-back consistent); otherwise replace the
 * current entry, so switching tabs never makes Back jump to another tab.
 */
export function useGoUp() {
  const navigate = useNavigate()
  return useCallback(
    (to: string) => {
      const idx = historyIdx()
      if (idx !== null && idx > 0 && entries.get(idx - 1) === norm(to)) navigate(-1)
      else navigate(to, { replace: true })
    },
    [navigate],
  )
}
