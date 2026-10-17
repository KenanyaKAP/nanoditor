import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Props for a toolbar button that must not take focus from the editor
 * (that would close the keyboard). The action runs on click, not on
 * pointerdown, so swiping the row to scroll it doesn't press the button under
 * the finger: a scroll cancels the click.
 */
export function pressProps(run: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: run,
  }
}

/** Style for a key in a row above the on-screen keyboard. */
export const keyClass = 'flex h-11 min-w-[42px] shrink-0 select-none items-center justify-center px-2 text-fg active:bg-line [-webkit-touch-callout:none]'

/** A toolbar button that repeats while held, like a keyboard's arrow keys. */
export function RepeatButton({ label, onFire, children }: { label: string; onFire: () => void; children: ReactNode }) {
  const timer = useRef<number>()
  const repeated = useRef(false)
  const fire = useRef(onFire)
  fire.current = onFire
  const stop = () => {
    window.clearTimeout(timer.current)
    window.clearInterval(timer.current)
    timer.current = undefined
  }
  useEffect(() => stop, [])
  return (
    <button
      aria-label={label}
      className={keyClass}
      onPointerDown={(e) => {
        e.preventDefault()
        stop()
        repeated.current = false
        timer.current = window.setTimeout(() => {
          repeated.current = true
          fire.current()
          timer.current = window.setInterval(() => fire.current(), 70)
        }, 400)
      }}
      onMouseDown={(e) => e.preventDefault()}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      // A tap fires once; a hold already fired while held.
      onClick={() => !repeated.current && fire.current()}
    >
      {children}
    </button>
  )
}
