import { useLayoutEffect, useRef } from 'react'
import { termFont, type TermSnapshot } from './TerminalView'

/**
 * The terminal's text as plain page text, laid over the terminal at the same
 * size and scroll position. xterm's own selection is mouse-only; here the
 * phone's selection works: long-press, drag the handles, Copy.
 */
export function TermSelect({ snap, at }: { snap: TermSnapshot; at?: { x: number; y: number } }) {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current!
    const lines = [...el.querySelectorAll<HTMLElement>('[data-row]')]
    let top = 0
    for (const l of lines) {
      const row = Number(l.dataset.row)
      if (row > snap.top) break
      top = l.offsetTop - lines[0].offsetTop + (snap.top - row) * snap.rowHeight
    }
    el.scrollTop = top
    if (at) selectWordAt(at.x, at.y)
  }, [snap, at])

  return (
    <div
      ref={box}
      className="scroll-touch absolute inset-0 overflow-auto bg-bg pl-1 pt-1 text-fg"
      style={{ userSelect: 'text', WebkitUserSelect: 'text', WebkitTouchCallout: 'default' }}
    >
      <div
        style={{
          width: snap.width,
          // Room to scroll as far as the terminal, whose last row can sit
          // above the bottom edge.
          paddingBottom: snap.rowHeight,
          fontFamily: termFont.family,
          fontSize: termFont.size,
          lineHeight: `${snap.rowHeight}px`,
          // Wrap where the terminal did: at the edge, mid-word if need be.
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          lineBreak: 'anywhere',
        }}
      >
        {snap.lines.map((l) => (
          <div key={l.row} data-row={l.row} style={{ minHeight: snap.rowHeight }}>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Select the word under a point. A word runs to whitespace, so paths and URLs come whole. */
function selectWordAt(x: number, y: number) {
  const r = document.caretRangeFromPoint?.(x, y)
  const node = r?.startContainer
  if (!r || !(node instanceof Text)) return
  const s = node.data
  let a = r.startOffset
  let b = r.startOffset
  while (a > 0 && !/\s/.test(s[a - 1])) a--
  while (b < s.length && !/\s/.test(s[b])) b++
  if (a === b) return
  const word = document.createRange()
  word.setStart(node, a)
  word.setEnd(node, b)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(word)
}
