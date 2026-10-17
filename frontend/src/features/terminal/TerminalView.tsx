import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** What the key row above the keyboard can do to the terminal on screen. */
export interface TermHandle {
  send(data: string): void
  /** An arrow key, in whichever cursor mode the program asked for. */
  arrow(dir: 'A' | 'B' | 'C' | 'D'): void
  focus(): void
  blur(): void
}

// VS Code's terminal colors; the background and text follow the app theme.
const darkAnsi = {
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5',
}
const lightAnsi = {
  black: '#000000', red: '#cd3131', green: '#00bc00', yellow: '#949800', blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
  brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5',
}

/** A theme color variable ("24 24 27") as #rrggbb. */
function cssColor(name: string): string {
  const parts = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number)
  return '#' + parts.map((n) => n.toString(16).padStart(2, '0')).join('')
}

function theme(): ITheme {
  const dark = document.documentElement.classList.contains('dark')
  return {
    ...(dark ? darkAnsi : lightAnsi),
    background: cssColor('--bg'),
    foreground: cssColor('--fg'),
    cursor: cssColor('--accent'),
    cursorAccent: cssColor('--bg'),
    selectionBackground: cssColor('--accent') + '55',
  }
}

/**
 * One shell, attached over a WebSocket. The shell runs on the server, so
 * leaving (tab switch, phone lock) only detaches; coming back reconnects and
 * the server replays recent output.
 */
export const TerminalView = forwardRef<
  TermHandle,
  {
    id: string
    /** Sticky Ctrl from the key row: turns the next typed key into a control key. */
    ctrl: React.MutableRefObject<boolean>
    onCtrlUsed: () => void
    onTitle: (title: string) => void
    onFocusChange: (focused: boolean) => void
    /** The connection failed or the shell exited: the parent rechecks the list. */
    onGone: () => void
  }
>(function TerminalView({ id, ctrl, onCtrlUsed, onTitle, onFocusChange, onGone }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<TermHandle | null>(null)
  const cb = useRef({ onCtrlUsed, onTitle, onFocusChange, onGone })
  cb.current = { onCtrlUsed, onTitle, onFocusChange, onGone }

  useImperativeHandle(ref, () => ({
    send: (d) => handle.current?.send(d),
    arrow: (k) => handle.current?.arrow(k),
    focus: () => handle.current?.focus(),
    blur: () => handle.current?.blur(),
  }))

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: theme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    fit.fit()

    const enc = new TextEncoder()
    let ws: WebSocket | null = null
    let disposed = false
    let exited = false
    let retry = 0
    let timer = 0
    const sendBytes = (b: Uint8Array) => ws?.readyState === WebSocket.OPEN && ws.send(b)
    const send = (d: string) => sendBytes(enc.encode(d))
    const sendSize = () =>
      ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))

    const connect = () => {
      if (disposed || exited || ws) return
      window.clearTimeout(timer)
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/term/${id}/ws`)
      s.binaryType = 'arraybuffer'
      let opened = false
      s.onopen = () => {
        opened = true
        retry = 0
        // The server replays recent output next; start from a clean screen.
        term.reset()
        sendSize()
      }
      s.onmessage = (e) => {
        if (typeof e.data !== 'string') term.write(new Uint8Array(e.data))
        else if (JSON.parse(e.data).type === 'exit') {
          exited = true
          cb.current.onGone()
        }
      }
      s.onclose = () => {
        if (ws !== s) return
        ws = null
        if (disposed || exited) return
        // Never connected: the shell may have exited while we were away.
        if (!opened) cb.current.onGone()
        if (document.visibilityState === 'visible') timer = window.setTimeout(connect, Math.min(500 * 2 ** retry++, 8000))
      }
      ws = s
    }
    connect()

    term.onData((d) => {
      if (ctrl.current && d.length === 1) {
        const c = d.toUpperCase().charCodeAt(0)
        if (c >= 64 && c <= 95) d = String.fromCharCode(c & 31)
        else if (d === ' ') d = '\x00'
        cb.current.onCtrlUsed()
      }
      send(d)
    })
    term.onBinary((d) => sendBytes(Uint8Array.from(d, (c) => c.charCodeAt(0))))
    term.onResize(sendSize)
    term.onTitleChange((t) => cb.current.onTitle(t))
    const ta = term.textarea
    const onFocus = () => cb.current.onFocusChange(true)
    const onBlur = () => cb.current.onFocusChange(false)
    ta?.addEventListener('focus', onFocus)
    ta?.addEventListener('blur', onBlur)

    handle.current = {
      send,
      arrow: (k) => send((term.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b[') + k),
      focus: () => term.focus(),
      blur: () => term.blur(),
    }

    // xterm 6 has no touch scrolling, so finger drags are handled here: the
    // scrollback follows the finger line by line, with a glide after a flick.
    // Full-screen programs get arrow keys, or wheel events if they use the mouse.
    const el = host.current!
    let startY = 0
    let lastY = 0
    let lastT = 0
    let velocity = 0
    let dragging = false
    let carry = 0
    let glide = 0
    const scrollBy = (dy: number) => {
      const screen = el.querySelector('.xterm-screen')
      // Programs that asked for the mouse get wheel events, as from a mouse.
      if (term.modes.mouseTrackingMode !== 'none') {
        screen?.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true }))
        return
      }
      carry += dy / ((screen?.clientHeight ?? 0) / term.rows || 17)
      const lines = Math.trunc(carry)
      if (!lines) return
      carry -= lines
      if (term.buffer.active.type === 'alternate') {
        // Full-screen programs (less, man, vim) have no scrollback: one arrow
        // key per line the finger moved.
        send(((term.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b[') + (lines > 0 ? 'B' : 'A')).repeat(Math.abs(lines)))
      } else {
        term.scrollLines(lines)
      }
    }
    const onTouchStart = (e: TouchEvent) => {
      cancelAnimationFrame(glide)
      if (e.touches.length !== 1) return
      startY = lastY = e.touches[0].clientY
      lastT = performance.now()
      velocity = 0
      dragging = false
      carry = 0
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const y = e.touches[0].clientY
      // A small wobble is still a tap (which focuses the terminal).
      if (!dragging && Math.abs(y - startY) < 8) return
      dragging = true
      e.preventDefault()
      const now = performance.now()
      const dy = lastY - y
      velocity = 0.8 * (dy / Math.max(now - lastT, 1)) + 0.2 * velocity
      lastY = y
      lastT = now
      scrollBy(dy)
    }
    const onTouchEnd = () => {
      if (!dragging || performance.now() - lastT > 100) return
      let v = velocity * 16 // px per frame
      const step = () => {
        v *= 0.95
        if (Math.abs(v) < 0.5) return
        scrollBy(v)
        glide = requestAnimationFrame(step)
      }
      glide = requestAnimationFrame(step)
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)

    // Refit when the keyboard opens or the phone rotates.
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fit.fit())
    })
    ro.observe(host.current!)
    // Follow the app theme.
    const mo = new MutationObserver(() => (term.options.theme = theme()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    // iOS drops the socket in the background; reconnect on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        retry = 0
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      disposed = true
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      cancelAnimationFrame(glide)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      document.removeEventListener('visibilitychange', onVisible)
      ta?.removeEventListener('focus', onFocus)
      ta?.removeEventListener('blur', onBlur)
      ro.disconnect()
      mo.disconnect()
      ws?.close()
      handle.current = null
      term.dispose()
    }
  }, [id, ctrl])

  return <div ref={host} className="h-full w-full touch-none" />
})
