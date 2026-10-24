import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** What the key row above the keyboard can do to the terminal on screen. */
export interface TermHandle {
  /** A key from the key row, with any sticky Ctrl/Alt. */
  key(data: string): void
  /** An arrow key, in whichever cursor mode the program asked for. */
  arrow(dir: 'A' | 'B' | 'C' | 'D'): void
  /** Text as a paste, which shells take whole instead of running line by line. */
  paste(text: string): void
  focus(): void
  blur(): void
  snapshot(): TermSnapshot
}

/**
 * Sticky modifiers from the key row: 'once' applies to the next key, then
 * turns off; 'locked' (a double tap) stays on until tapped off.
 */
export type Mod = false | 'once' | 'locked'
export interface Mods {
  ctrl: Mod
  alt: Mod
}
export const noMods: Mods = { ctrl: false, alt: false }

/** The terminal's text, for selecting and copying, with what's needed to lay it out the same. */
export interface TermSnapshot {
  /** Lines as the program wrote them; `row` is the buffer row each starts on. */
  lines: { row: number; text: string }[]
  /** The buffer row at the top of the screen. */
  top: number
  rowHeight: number
  width: number
}

export const termFont = { family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', size: 13 }

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
    mods: React.MutableRefObject<Mods>
    onModsUsed: (mods: Mods) => void
    onTitle: (title: string) => void
    onFocusChange: (focused: boolean) => void
    /** The connection failed or the shell exited: the parent rechecks the list. */
    onGone: () => void
    /** A finger held still on the terminal, at these screen coordinates. */
    onLongPress: (x: number, y: number) => void
  }
>(function TerminalView({ id, mods, onModsUsed, onTitle, onFocusChange, onGone, onLongPress }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<TermHandle | null>(null)
  const cb = useRef({ onModsUsed, onTitle, onFocusChange, onGone, onLongPress })
  cb.current = { onModsUsed, onTitle, onFocusChange, onGone, onLongPress }

  useImperativeHandle(ref, () => ({
    key: (d) => handle.current?.key(d),
    arrow: (k) => handle.current?.arrow(k),
    paste: (t) => handle.current?.paste(t),
    focus: () => handle.current?.focus(),
    blur: () => handle.current?.blur(),
    snapshot: () => handle.current!.snapshot(),
  }))

  useEffect(() => {
    const term = new Terminal({
      fontFamily: termFont.family,
      fontSize: termFont.size,
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

    // A key took the modifiers: one-shot ones turn off, locked ones stay.
    const used = () => {
      const { ctrl, alt } = mods.current
      if (ctrl !== 'once' && alt !== 'once') return
      mods.current = { ctrl: ctrl === 'once' ? false : ctrl, alt: alt === 'once' ? false : alt }
      cb.current.onModsUsed(mods.current)
    }

    // Apply sticky Ctrl/Alt to a key: Ctrl makes a control character,
    // Alt sends Escape first (what terminals do for Meta).
    const withMods = (d: string) => {
      const { ctrl, alt } = mods.current
      if (!ctrl && !alt) return d
      if (ctrl && d.length === 1) {
        const c = d.toUpperCase().charCodeAt(0)
        if (c >= 64 && c <= 95) d = String.fromCharCode(c & 31)
        else if (d === ' ') d = '\x00'
      }
      used()
      return alt ? '\x1b' + d : d
    }

    // Typing on the keyboard (one key at a time; longer input is autocorrect or a paste).
    term.onData((d) => send(d.length === 1 ? withMods(d) : d))
    term.onBinary((d) => sendBytes(Uint8Array.from(d, (c) => c.charCodeAt(0))))
    term.onResize(sendSize)
    term.onTitleChange((t) => cb.current.onTitle(t))
    const ta = term.textarea
    const onFocus = () => cb.current.onFocusChange(true)
    const onBlur = () => cb.current.onFocusChange(false)
    ta?.addEventListener('focus', onFocus)
    ta?.addEventListener('blur', onBlur)

    handle.current = {
      key: (d) => send(withMods(d)),
      arrow: (k) => {
        const { ctrl, alt } = mods.current
        if (!ctrl && !alt) return send((term.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b[') + k)
        // With modifiers: ESC [ 1 ; m, where m is 1 + 2 for Alt + 4 for Ctrl
        // (Alt+Left is a word back in most shells).
        used()
        send(`\x1b[1;${1 + (alt ? 2 : 0) + (ctrl ? 4 : 0)}${k}`)
      },
      paste: (t) => term.paste(t),
      focus: () => term.focus(),
      blur: () => term.blur(),
      snapshot: () => {
        const buf = term.buffer.active
        const lines: TermSnapshot['lines'] = []
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i)
          if (!line) continue
          // Rows the terminal wrapped join back into one line, so a long
          // command or URL copies whole.
          const text = line.translateToString(false)
          if (line.isWrapped && lines.length) lines[lines.length - 1].text += text
          else lines.push({ row: i, text })
        }
        for (const l of lines) l.text = l.text.trimEnd()
        const screen = host.current!.querySelector('.xterm-screen')!
        return { lines, top: buf.viewportY, rowHeight: screen.clientHeight / term.rows, width: screen.clientWidth }
      },
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
    let press = 0
    let pressed = false
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
      window.clearTimeout(press)
      pressed = false
      if (e.touches.length !== 1) return
      const { clientX, clientY } = e.touches[0]
      startY = lastY = clientY
      lastT = performance.now()
      velocity = 0
      dragging = false
      carry = 0
      press = window.setTimeout(() => {
        pressed = true
        cb.current.onLongPress(clientX, clientY)
      }, 500)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || pressed) return
      const y = e.touches[0].clientY
      // A small wobble is still a tap (which focuses the terminal).
      if (!dragging && Math.abs(y - startY) < 8) return
      dragging = true
      window.clearTimeout(press)
      e.preventDefault()
      const now = performance.now()
      const dy = lastY - y
      velocity = 0.8 * (dy / Math.max(now - lastT, 1)) + 0.2 * velocity
      lastY = y
      lastT = now
      scrollBy(dy)
    }
    const onTouchEnd = (e: TouchEvent) => {
      window.clearTimeout(press)
      // A long press isn't also a tap, which would open the keyboard.
      if (pressed) return e.preventDefault()
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
      window.clearTimeout(press)
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
  }, [id, mods])

  return <div ref={host} className="h-full w-full touch-none [-webkit-touch-callout:none]" />
})
